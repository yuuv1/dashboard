/* EdgeControl browser sync: local-first, authenticated, private Storage. */
(function (root) {
  'use strict';
  const CONFIG = root.EC_SUPABASE_CONFIG || {};
  const META_KEY = 'ecSupabaseSyncMeta';
  const OPTIONS_KEY = 'ecSupabaseOptions';
  const DEVICE_KEY = 'ecDeviceCred';
  const HOME_KEY = 'ecHomeAccount';
  const BUCKET = CONFIG.storageBucket || 'edgecontrol-prints';
  let client = null;
  let session = null;
  let homeId = '';
  let adapter = null;
  let busy = false;
  let queued = false;
  let timer = null;
  let authSubscription = null;
  let listenersAdded = false;

  const nowIso = () => new Date().toISOString();
  const clone = value => JSON.parse(JSON.stringify(value));
  const parseTime = value => {
    const n = Date.parse(value || '');
    return Number.isFinite(n) ? n : 0;
  };
  function stable(value) {
    const normalize = v => {
      if (Array.isArray(v)) return v.map(normalize);
      if (v && typeof v === 'object') return Object.keys(v).sort().reduce((out, key) => { out[key] = normalize(v[key]); return out; }, {});
      return v;
    };
    return JSON.stringify(normalize(value === undefined ? null : value));
  }
  function options() {
    try { return Object.assign({ auto: true }, JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}')); }
    catch (_) { return { auto: true }; }
  }
  function saveOptions(patch) {
    const next = Object.assign(options(), patch || {});
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    return next;
  }
  function readMeta() {
    try {
      return Object.assign({ opChanges: {}, deletedOps: {}, shotHashes: {}, stateAt: '', lastSyncAt: '' },
        JSON.parse(localStorage.getItem(META_KEY) || '{}'));
    } catch (_) {
      return { opChanges: {}, deletedOps: {}, shotHashes: {}, stateAt: '', lastSyncAt: '' };
    }
  }
  function writeMeta(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) { /* local app data remains safe */ }
  }
  function stripOperations(state) {
    const copy = clone(state || {});
    copy.operations = [];
    return copy;
  }
  function showStatus(message, error) {
    const el = document.getElementById('sbStatus');
    if (el) {
      el.textContent = message;
      el.style.color = error ? 'var(--red)' : 'var(--dim)';
    }
  }
  function getClient() {
    if (client) return client;
    if (!CONFIG.url || !CONFIG.publishableKey || !root.supabase || !root.supabase.createClient) return null;
    client = root.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    });
    return client;
  }
  function randomToken(size) {
    const bytes = new Uint8Array(size || 8);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  function readDeviceCred() {
    try { return JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch (_) { return null; }
  }
  function writeDeviceCred(cred) {
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(cred)); } catch (_) { /* modo privado */ }
  }
  function readHome() {
    try { return localStorage.getItem(HOME_KEY) || ''; } catch (_) { return ''; }
  }
  function writeHome(id) {
    try { if (id) localStorage.setItem(HOME_KEY, String(id)); else localStorage.removeItem(HOME_KEY); } catch (_) { /* modo privado */ }
  }
  function paintAccount() {
    const logged = !!(session && session.user);
    const paired = !!(logged && homeId);
    const login = document.getElementById('sbLoginBox');
    const account = document.getElementById('sbAccountBox');
    const email = document.getElementById('sbAccountEmail');
    const auto = document.getElementById('sbAuto');
    const owner = document.getElementById('sbOwnerBox');
    const code = document.getElementById('sbAccountCode');
    if (login) login.style.display = paired ? 'none' : 'block';
    if (account) account.style.display = paired ? 'block' : 'none';
    if (email) email.textContent = (session && session.user && session.user.email) || 'aparelho conectado';
    if (auto) auto.checked = options().auto !== false;
    if (owner) owner.style.display = (logged && !paired) ? 'block' : 'none';
    if (code) code.textContent = displayCode || '••••';
  }
  let displayCode = '';

  /* Sessão do aparelho: cada aparelho tem a própria conta técnica (sem e-mail
     visível ao usuário). Ela só dá acesso depois de um pareamento com
     código + PIN — o vínculo vive em ec_members e é checado pelas políticas. */
  async function ensureDeviceSession(sb) {
    if (session && session.user) return session;
    const cred = readDeviceCred();
    if (cred && cred.email && cred.password && typeof sb.auth.signInWithPassword === 'function') {
      try {
        const attempt = await sb.auth.signInWithPassword({ email: cred.email, password: cred.password });
        if (!attempt.error && attempt.data && attempt.data.session) {
          session = attempt.data.session;
          return session;
        }
      } catch (_) { /* segue para criar um novo */ }
    }
    if (typeof sb.auth.signUp !== 'function') throw new Error('módulo de login indisponível');
    const password = randomToken(16) + randomToken(8);
    const email = 'aparelho-' + randomToken(10) + '@edgecontrol.app';
    const created = await sb.auth.signUp({ email, password });
    if (created.error) throw created.error;
    if (!created.data || !created.data.session) throw new Error('o servidor não devolveu a sessão do aparelho');
    session = created.data.session;
    writeDeviceCred({ email, password });
    paintAccount();
    return session;
  }
  async function resolveHome(sb) {
    if (homeId) return homeId;
    const saved = readHome();
    if (!session) return null;
    if (typeof sb.rpc === 'function') {
      try {
        const { data, error } = await sb.rpc('ec_home');
        if (error) throw error;
        if (data) { homeId = String(data); writeHome(homeId); return homeId; }
        return null;
      } catch (_) { /* projeto antigo, sem a função: usa o próprio usuário */ }
    }
    homeId = session.user.id;
    return homeId;
  }
  function normalizeError(error) {
    if (!error) return 'erro desconhecido';
    return error.message || String(error);
  }
  async function sendLoginLink() {
    const emailEl = document.getElementById('sbEmail');
    const email = (emailEl && emailEl.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showStatus('Digite um endereço de e-mail válido.', true);
      return;
    }
    const sb = getClient();
    if (!sb) { showStatus('O módulo Supabase não carregou. Recarregue o app quando estiver online.', true); return; }
    showStatus('Enviando link de acesso…');
    try {
      const redirectTo = location.origin + location.pathname + location.search;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
      if (error) throw error;
      showStatus('Link enviado. Abra o e-mail neste aparelho para entrar no EdgeControl.');
    } catch (error) {
      showStatus('Não consegui enviar o link: ' + normalizeError(error), true);
    }
  }
  /* Entrar com senha: caminho que funciona dentro do app instalado (PWA), onde
     o link do e-mail pode abrir em outro navegador e a sessão não é herdada. */
  async function passwordSignIn() {
    const emailEl = document.getElementById('sbEmail');
    const passEl = document.getElementById('sbPassword');
    const email = (emailEl && emailEl.value || '').trim();
    const password = (passEl && passEl.value || '');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showStatus('Digite seu e-mail antes de entrar com senha.', true);
      return;
    }
    if (!password) { showStatus('Digite a senha.', true); return; }
    const sb = getClient();
    if (!sb) { showStatus('O módulo Supabase não carregou. Recarregue o app quando estiver online.', true); return; }
    showStatus('Entrando com senha…');
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (passEl) passEl.value = '';
      showStatus('Conectado. Sincronizando os dados…');
    } catch (error) {
      showStatus('Não consegui entrar: ' + normalizeError(error), true);
    }
  }
  /* Primeira vez: entra pelo link do e-mail e salva uma senha neste e-mail.
     Depois disso, todo aparelho novo entra só com e-mail + senha. */
  async function savePassword() {
    const el = document.getElementById('sbNewPassword');
    const password = (el && el.value || '');
    if (password.length < 6) { showStatus('A senha precisa ter pelo menos 6 caracteres.', true); return; }
    const sb = getClient();
    if (!sb) { showStatus('O módulo Supabase não carregou. Recarregue o app quando estiver online.', true); return; }
    if (!session) { showStatus('Entre com o link do e-mail primeiro para poder definir a senha.', true); return; }
    try {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      if (el) el.value = '';
      showStatus('Senha salva. Agora você entra com e-mail + senha em qualquer aparelho.');
    } catch (error) {
      showStatus('Não consegui salvar a senha: ' + normalizeError(error), true);
    }
  }
  async function pairDevice() {
    const codeEl = document.getElementById('sbCode');
    const pinEl = document.getElementById('sbPin');
    const code = (codeEl && codeEl.value || '').trim().toUpperCase();
    const pin = (pinEl && pinEl.value || '').replace(/\D/g, '');
    if (!code || code.length < 4) { showStatus('Digite o código da conta (EC-XXXX-XXXX).', true); return; }
    if (!/^\d{6}$/.test(pin)) { showStatus('O PIN tem 6 números.', true); return; }
    const sb = getClient();
    if (!sb) { showStatus('O módulo Supabase não carregou. Recarregue o app quando estiver online.', true); return; }
    showStatus('Conectando este aparelho…');
    try {
      await ensureDeviceSession(sb);
      const { data, error } = await sb.rpc('ec_pair', { p_code: code, p_pin: pin });
      if (error) throw error;
      if (!data) throw new Error('código ou PIN inválido');
      homeId = String(data);
      writeHome(homeId);
      if (pinEl) pinEl.value = '';
      if (codeEl) codeEl.value = '';
      paintAccount();
      showStatus('Conectado. Baixando seus dados da nuvem…');
      await sync(false);
    } catch (error) {
      showStatus('Não consegui conectar: ' + normalizeError(error), true);
    }
  }
  /* Dono da conta: define (ou troca) o PIN de 6 números — o código é gerado
     uma vez e mostrado na tela para digitar nos outros aparelhos. */
  async function savePin() {
    /* dois campos na tela (dono e conta conectada); usa o que estiver preenchido */
    const fields = ['sbPinNew', 'sbPinNew2'].map(id => document.getElementById(id));
    const el = fields.find(field => field && field.value) || fields[0];
    const pin = (el && el.value || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(pin)) { showStatus('Escolha um PIN com 6 números.', true); return; }
    const sb = getClient();
    if (!sb) { showStatus('O módulo Supabase não carregou. Recarregue o app quando estiver online.', true); return; }
    const current = session;
    if (!current || !current.user) { showStatus('Entre com seu e-mail neste aparelho antes de criar o PIN.', true); return; }
    try {
      const { data, error } = await sb.rpc('ec_new_account', { p_pin: pin });
      if (error) throw error;
      displayCode = data || '';
      homeId = current.user.id;
      writeHome(homeId);
      if (el) el.value = '';
      paintAccount();
      showStatus('PIN salvo. Código da conta: ' + displayCode + ' — digite esse código e o PIN nos outros aparelhos.');
      await sync(false);
    } catch (error) {
      showStatus('Não consegui salvar o PIN: ' + normalizeError(error), true);
    }
  }
  async function loadAccountCode() {
    const sb = getClient();
    if (!sb || !session || typeof sb.rpc !== 'function') return '';
    try {
      const { data, error } = await sb.rpc('ec_code');
      if (error) throw error;
      displayCode = data || '';
      paintAccount();
      return displayCode;
    } catch (_) { return ''; }
  }
  async function signOut() {
    const sb = getClient();
    if (!sb) return;
    try {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      session = null;
      paintAccount();
      showStatus('Sessão encerrada. Os dados locais deste aparelho foram mantidos.');
    } catch (error) { showStatus('Falha ao sair: ' + normalizeError(error), true); }
  }
  function updateOptions() {
    const el = document.getElementById('sbAuto');
    saveOptions({ auto: !el || el.checked !== false });
    showStatus(options().auto ? 'Sincronização automática ligada.' : 'Sincronização automática pausada.');
  }
  function stampLocalChanges(previousRaw, nextState) {
    if (root.__EC_SUPABASE_APPLYING || !nextState) return;
    const meta = readMeta();
    let previous = null;
    try { previous = previousRaw ? JSON.parse(previousRaw) : null; } catch (_) { previous = null; }
    const oldOps = new Map(((previous && previous.operations) || []).map(op => [String(op.id), op]));
    const newOps = new Map(((nextState && nextState.operations) || []).map(op => [String(op.id), op]));
    const at = nowIso();
    for (const [id, op] of newOps) {
      if (!oldOps.has(id) || stable(oldOps.get(id)) !== stable(op)) {
        meta.opChanges[id] = at;
        delete meta.deletedOps[id];
      }
    }
    for (const id of oldOps.keys()) {
      if (!newOps.has(id)) {
        meta.deletedOps[id] = at;
        delete meta.opChanges[id];
      }
    }
    if (stable(stripOperations(previous || {})) !== stable(stripOperations(nextState))) meta.stateAt = at;
    writeMeta(meta);
  }
  function onLocalSave() {
    if (root.__EC_SUPABASE_APPLYING || !session || options().auto === false) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync(false), 1600);
  }
  function rowIsNewer(a, b) { return parseTime(a) >= parseTime(b); }

  function mergeOperationRows(localOperations, remoteRows, meta) {
    const local = new Map((localOperations || []).map(op => [String(op.id), op]));
    const remote = new Map((remoteRows || []).map(row => [String(row.operation_id), row]));
    const ids = new Set([...local.keys(), ...remote.keys(), ...Object.keys(meta.deletedOps || {})]);
    const result = new Map();
    const writes = [];
    for (const id of ids) {
      const op = local.get(id);
      const row = remote.get(id);
      const localDeleteAt = meta.deletedOps && meta.deletedOps[id];
      const localEditAt = meta.opChanges && meta.opChanges[id];
      const remoteAt = row && row.updated_at;
      if (localDeleteAt && (!row || rowIsNewer(localDeleteAt, remoteAt))) {
        writes.push({ operation_id: id, payload: {}, updated_at: localDeleteAt, deleted: true });
        continue;
      }
      if (!op) {
        if (row && !row.deleted) result.set(id, row.payload);
        continue;
      }
      if (!row) {
        writes.push({ operation_id: id, payload: op, updated_at: localEditAt || nowIso(), deleted: false });
        result.set(id, op);
        continue;
      }
      if (row.deleted) {
        if (localEditAt && rowIsNewer(localEditAt, remoteAt)) {
          writes.push({ operation_id: id, payload: op, updated_at: localEditAt, deleted: false });
          result.set(id, op);
        }
        continue;
      }
      if (localEditAt && rowIsNewer(localEditAt, remoteAt)) {
        writes.push({ operation_id: id, payload: op, updated_at: localEditAt, deleted: false });
        result.set(id, op);
      } else result.set(id, row.payload);
    }
    return { operations: Array.from(result.values()), writes };
  }
  function shotMetadata(record) {
    return {
      name: record.name || '', note: record.note || '', at: record.at || '', opId: record.opId || null,
      marks: Array.isArray(record.marks) ? record.marks : [], crop: record.crop || null,
      marksAt: record.marksAt || '', parentId: record.parentId || null, kind: record.kind || '',
      w: Number(record.w) || 0, h: Number(record.h) || 0, size: Number(record.size) || 0
    };
  }
  async function digest(blob) {
    const bytes = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
  }
  function objectPath(userId, shotId) { return userId + '/' + encodeURIComponent(String(shotId)); }
  function clearSyncedChanges(started, latest, syncedShotHashes) {
    for (const [id, at] of Object.entries(started.opChanges || {})) {
      if (latest.opChanges[id] === at) delete latest.opChanges[id];
    }
    for (const [id, at] of Object.entries(started.deletedOps || {})) {
      if (latest.deletedOps[id] === at) delete latest.deletedOps[id];
    }
    if (latest.stateAt === started.stateAt) latest.stateAt = '';
    latest.lastSyncAt = nowIso();
    latest.shotHashes = Object.assign(latest.shotHashes || {}, syncedShotHashes || {});
    writeMeta(latest);
  }

  async function syncShots(sb, userId, meta) {
    const localRows = await adapter.getShots();
    const { data: remoteRows, error } = await sb.from('ec_shots').select('shot_id,object_path,metadata,sha256,updated_at,deleted').eq('user_id', userId);
    if (error) throw error;
    const remote = new Map((remoteRows || []).map(row => [String(row.shot_id), row]));
    const local = new Map((localRows || []).map(row => [String(row.id), row]));
    const ids = new Set([...local.keys(), ...remote.keys()]);
    const hashes = {};
    let uploaded = 0, downloaded = 0;
    for (const id of ids) {
      const localRow = local.get(id);
      const remoteRow = remote.get(id);
      if (remoteRow && remoteRow.deleted) continue;
      if (localRow) {
        const metadata = shotMetadata(localRow);
        const metadataFingerprint = stable(metadata);
        const prior = (meta.shotHashes || {})[id];
        const priorHash = prior && typeof prior === 'object' ? prior.sha256 : prior;
        const priorMetadata = prior && typeof prior === 'object' ? prior.metadata : '';
        const metadataMatches = priorMetadata === metadataFingerprint || priorMetadata === JSON.stringify(metadata);
        const hasSource = !!((localRow.blob && typeof localRow.blob.arrayBuffer === 'function') || typeof localRow.dataUrl === 'string');
        const cachedValid = !!(priorHash && metadataMatches && hasSource);
        let localHash = cachedValid ? priorHash : '';
        let blob = null;
        if (!localHash) {
          blob = await adapter.getBlob(localRow);
          if (blob && blob.size && String(blob.type || '').startsWith('image/')) localHash = await digest(blob);
          else blob = null;
        }
        const localChanged = !priorHash || (localHash && priorHash !== localHash) || (priorMetadata && !metadataMatches);
        const remoteSame = !!(remoteRow && localHash && remoteRow.sha256 === localHash);
        if (remoteSame && hasSource) {
          hashes[id] = { sha256: localHash, metadata: metadataFingerprint };
          if (stable(metadata) !== stable(remoteRow.metadata || {})) {
            const { error: rowError } = await sb.from('ec_shots').upsert({
              user_id: userId, shot_id: id, object_path: remoteRow.object_path,
              metadata, sha256: localHash, updated_at: nowIso(), deleted: false
            }, { onConflict: 'user_id,shot_id' });
            if (rowError) throw rowError;
          }
          continue;
        }
        if (remoteRow && (!localChanged || !blob || !hasSource)) {
          const { data: remoteBlob, error: downloadError } = await sb.storage.from(BUCKET).download(remoteRow.object_path);
          if (downloadError) throw downloadError;
          const restored = Object.assign({ id, blob: remoteBlob, size: remoteBlob.size }, remoteRow.metadata || {});
          await adapter.putShot(restored);
          hashes[id] = { sha256: remoteRow.sha256, metadata: stable(shotMetadata(restored)) };
          downloaded++;
          continue;
        }
        if (!blob) {
          blob = await adapter.getBlob(localRow);
          if (!blob || !blob.size || !String(blob.type || '').startsWith('image/')) {
            if (!remoteRow) throw new Error('O print ' + id + ' não tem um arquivo de imagem legível.');
            continue;
          }
          localHash = await digest(blob);
        }
        const path = remoteRow && remoteRow.object_path || objectPath(userId, id);
        const { error: uploadError } = await sb.storage.from(BUCKET).upload(path, blob, {
          upsert: true, contentType: blob.type || 'image/jpeg', cacheControl: '3600'
        });
        if (uploadError) throw uploadError;
        const rec = {
          user_id: userId, shot_id: id, object_path: path, metadata,
          sha256: localHash, updated_at: nowIso(), deleted: false
        };
        const { error: rowError } = await sb.from('ec_shots').upsert(rec, { onConflict: 'user_id,shot_id' });
        if (rowError) throw rowError;
        uploaded++;
        hashes[id] = { sha256: localHash, metadata: metadataFingerprint };
      } else if (remoteRow && !remoteRow.deleted) {
        const { data: remoteBlob, error: downloadError } = await sb.storage.from(BUCKET).download(remoteRow.object_path);
        if (downloadError) throw downloadError;
        const restored = Object.assign({ id, blob: remoteBlob, size: remoteBlob.size }, remoteRow.metadata || {});
        await adapter.putShot(restored);
        hashes[id] = { sha256: remoteRow.sha256, metadata: stable(shotMetadata(restored)) };
        downloaded++;
      }
    }
    return { uploaded, downloaded, hashes };
  }

  async function sync(manual) {
    if (!session || !adapter) {
      if (manual) showStatus('Entre com seu e-mail para sincronizar.', true);
      return;
    }
    if (!navigator.onLine) {
      showStatus('Sem internet. Os dados ficam salvos neste aparelho; vou tentar de novo quando a conexão voltar.');
      return;
    }
    if (busy) { queued = true; return; }
    const sb = getClient();
    if (!sb) { showStatus('Módulo Supabase indisponível.'); return; }
    busy = true;
    const started = readMeta();
    showStatus('Sincronizando operações e prints…');
    try {
      const userId = homeId || session.user.id;
      const localState = adapter.getState();
      const localOps = Array.isArray(localState.operations) ? localState.operations : [];
      const [{ data: stateRows, error: stateError }, { data: remoteOps, error: opError }] = await Promise.all([
        sb.from('ec_user_state').select('payload,updated_at').eq('user_id', userId).limit(1),
        sb.from('ec_operations').select('operation_id,payload,updated_at,deleted').eq('user_id', userId)
      ]);
      if (stateError) throw stateError;
      if (opError) throw opError;
      const remoteState = stateRows && stateRows[0] || null;
      const merged = mergeOperationRows(localOps, remoteOps || [], started);
      if (merged.writes.length) {
        const rows = merged.writes.map(row => Object.assign({ user_id: userId }, row));
        const { error: writeError } = await sb.from('ec_operations').upsert(rows, { onConflict: 'user_id,operation_id' });
        if (writeError) throw writeError;
      }

      const localHasOps = localOps.length > 0;
      const localStateChanged = !!started.lastSyncAt && !!started.stateAt && parseTime(started.stateAt) > parseTime(started.lastSyncAt);
      const firstLocalImport = localHasOps && !started.lastSyncAt;
      let chosenState = stripOperations(localState);
      let stateAt = started.stateAt || nowIso();
      const localStateWins = !remoteState || firstLocalImport ||
        (localStateChanged && parseTime(stateAt) > parseTime(remoteState && remoteState.updated_at));
      let shouldWriteState = localStateWins;
      if (remoteState && !localStateWins) chosenState = remoteState.payload || {};
      if (shouldWriteState) {
        const { error: stateWriteError } = await sb.from('ec_user_state').upsert({
          user_id: userId, payload: chosenState, updated_at: stateAt
        }, { onConflict: 'user_id' });
        if (stateWriteError) throw stateWriteError;
      }

      root.__EC_SUPABASE_APPLYING = true;
      try {
        const mergedState = Object.assign({}, chosenState, { operations: merged.operations });
        const stateChanged = stable(mergedState) !== stable(localState);
        if (stateChanged) {
          adapter.applyState(mergedState);
          adapter.persist();
        }
        const shotResult = await syncShots(sb, userId, started);
        if (shotResult.downloaded && adapter.refresh) adapter.refresh();
        const latest = readMeta();
        clearSyncedChanges(started, latest, shotResult.hashes);
        const totalOps = merged.operations.length;
        showStatus('✅ Sincronizado: ' + totalOps + ' operação(ões); prints enviados ' + shotResult.uploaded + ', recebidos ' + shotResult.downloaded + '.');
        if (manual) root.toast('Supabase atualizado. Seus dados continuam salvos neste aparelho e na nuvem.', 's');
      } finally { root.__EC_SUPABASE_APPLYING = false; }
    } catch (error) {
      showStatus('Falha na sincronização: ' + normalizeError(error) + '. Os dados locais foram mantidos.', true);
      if (manual) root.toast('Supabase: ' + normalizeError(error), 'e');
    } finally {
      busy = false;
      if (queued) { queued = false; setTimeout(() => sync(false), 250); }
    }
  }
  async function boot(appAdapter) {
    adapter = appAdapter || adapter;
    /* O código da conta é público (serve só para identificar a conta em todos
       os aparelhos); o PIN continua sendo o segredo digitado pelo usuário. */
    const codeField = document.getElementById('sbCode');
    if (codeField && !codeField.value && CONFIG.accountCode) codeField.value = CONFIG.accountCode;
    const sb = getClient();
    if (!sb) {
      showStatus('Supabase não carregou. O app continua salvando localmente; conecte à internet e recarregue.', true);
      paintAccount();
      return;
    }
    if (!listenersAdded) {
      listenersAdded = true;
      root.addEventListener('online', () => { if (session && options().auto !== false) sync(false); });
      root.addEventListener('focus', () => { if (session && options().auto !== false) sync(false); });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && session && options().auto !== false) sync(false);
      });
      const mobile = !!(root.matchMedia && root.matchMedia('(max-width: 820px)').matches);
      root.setInterval(() => {
        if (!document.hidden && navigator.onLine && session && options().auto !== false) sync(false);
      }, mobile ? 180000 : 60000);
    }
    if (!authSubscription) {
      const result = sb.auth.onAuthStateChange((event, nextSession) => {
        session = nextSession || null;
        paintAccount();
        if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) setTimeout(() => sync(false), 0);
      });
      authSubscription = result && result.data && result.data.subscription;
    }
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      session = data && data.session || null;
      /* Sem sessão salva, tenta as credenciais do próprio aparelho (pareado antes). */
      if (!session) {
        const cred = readDeviceCred();
        if (cred && cred.email) {
          try { session = await ensureDeviceSession(sb); } catch (_) { session = null; }
        }
      }
      paintAccount();
      const home = await resolveHome(sb);
      if (session && home) {
        if (session.user && session.user.id === home) loadAccountCode();
        if (options().auto !== false) await sync(false);
        else showStatus('Pronto para sincronizar. Toque em “Sincronizar agora”.');
      } else if (session) {
        showStatus('Aparelho conectado. Informe o código e o PIN da sua conta para ver os dados.');
      } else {
        showStatus('Pronto para conectar: informe o código e o PIN da sua conta.');
      }
    } catch (error) { showStatus('Não consegui conferir a sessão: ' + normalizeError(error), true); }
  }

  root.ECSupabaseApp = {
    configure(appAdapter) { adapter = appAdapter; },
    boot,
    trackLocalChanges(previousRaw, nextState) { stampLocalChanges(previousRaw, nextState); },
    onLocalSave,
    sendLoginLink,
    pairDevice,
    savePin,
    loadAccountCode,
    passwordSignIn,
    savePassword,
    signOut,
    updateOptions,
    syncNow() { return sync(true); },
    _mergeOperationRows: mergeOperationRows
  };
  root.sbSendLoginLink = sendLoginLink;
  root.sbPairDevice = pairDevice;
  root.sbSavePin = savePin;
  root.sbPasswordSignIn = passwordSignIn;
  root.sbSavePassword = savePassword;
  root.sbSignOut = signOut;
  root.sbSaveOptions = updateOptions;
  root.sbSyncNow = () => sync(true);
})(window);
