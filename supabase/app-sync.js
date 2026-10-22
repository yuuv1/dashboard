/* EdgeControl browser sync: local-first, authenticated, private Storage. */
(function (root) {
  'use strict';
  const CONFIG = root.EC_SUPABASE_CONFIG || {};
  const META_KEY = 'ecSupabaseSyncMeta';
  const OPTIONS_KEY = 'ecSupabaseOptions';
  const BUCKET = CONFIG.storageBucket || 'edgecontrol-prints';
  let client = null;
  let session = null;
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
  function paintAccount() {
    const logged = !!(session && session.user);
    const login = document.getElementById('sbLoginBox');
    const account = document.getElementById('sbAccountBox');
    const email = document.getElementById('sbAccountEmail');
    const auto = document.getElementById('sbAuto');
    if (login) login.style.display = logged ? 'none' : 'block';
    if (account) account.style.display = logged ? 'block' : 'none';
    if (email) email.textContent = session.user.email || 'conta conectada';
    if (auto) auto.checked = options().auto !== false;
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
      const userId = session.user.id;
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
      paintAccount();
      if (session && options().auto !== false) await sync(false);
      else if (!session) showStatus('Pronto para conectar. Os dados atuais permanecem neste aparelho.');
    } catch (error) { showStatus('Não consegui conferir a sessão: ' + normalizeError(error), true); }
  }

  root.ECSupabaseApp = {
    configure(appAdapter) { adapter = appAdapter; },
    boot,
    trackLocalChanges(previousRaw, nextState) { stampLocalChanges(previousRaw, nextState); },
    onLocalSave,
    sendLoginLink,
    signOut,
    updateOptions,
    syncNow() { return sync(true); },
    _mergeOperationRows: mergeOperationRows
  };
  root.sbSendLoginLink = sendLoginLink;
  root.sbSignOut = signOut;
  root.sbSaveOptions = updateOptions;
  root.sbSyncNow = () => sync(true);
})(window);
