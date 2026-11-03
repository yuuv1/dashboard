/* Dois aparelhos de verdade contra a mesma nuvem (simulada em memória):
   o que um altera — operação, ajuste ou print — chega no outro sozinho.
   É o contrato que o usuário pediu: "altera aqui, aparece em todos". */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'app-sync.js'), 'utf8');
const OWNER = 'owner-uuid';
const SITE_EMAIL = 'site@edgecontrol.app';
const SITE_PASS = 'ecsite_9f4c2b71d85a3e60';

/* ── nuvem simulada: tabelas + bucket, compartilhada pelos dois aparelhos ── */
function createCloud() {
  const tables = { ec_operations: new Map(), ec_user_state: new Map(), ec_shots: new Map() };
  const files = new Map();
  const keyOf = (table, row) => table === 'ec_operations'
    ? row.user_id + '|' + row.operation_id
    : table === 'ec_shots' ? row.user_id + '|' + row.shot_id : row.user_id;

  function client() {
    return {
      auth: {
        async getSession() { return { data: { session: null }, error: null }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        async signInWithPassword({ email, password }) {
          if (email !== SITE_EMAIL || password !== SITE_PASS) {
            return { data: { session: null }, error: new Error('credenciais inválidas') };
          }
          return { data: { session: { user: { id: 'site-user-uuid', email: SITE_EMAIL } } }, error: null };
        },
        async signUp() { return { data: { session: null }, error: new Error('sem cadastro no teste') }; }
      },
      async rpc(name) {
        if (name === 'ec_home') return { data: OWNER, error: null };
        if (name === 'ec_code') return { data: 'EC-7K4M-9Q2X', error: null };
        return { data: null, error: null };
      },
      from(table) {
        const q = { filters: [], limitN: null };
        q.select = () => q;
        q.eq = (k, v) => { q.filters.push([k, v]); return q; };
        q.limit = n => { q.limitN = n; return q; };
        q.upsert = async rows => {
          for (const row of (Array.isArray(rows) ? rows : [rows])) {
            tables[table].set(keyOf(table, row), Object.assign({}, row));
          }
          return { error: null };
        };
        q.then = (resolve, reject) => {
          let data = [...tables[table].values()].filter(row =>
            q.filters.every(([k, v]) => String(row[k]) === String(v)));
          if (q.limitN) data = data.slice(0, q.limitN);
          return Promise.resolve({ data: JSON.parse(JSON.stringify(data)), error: null }).then(resolve, reject);
        };
        return q;
      },
      storage: {
        from() {
          return {
            async upload(path, blob) {
              files.set(path, { type: blob.type, bytes: Buffer.from(await blob.arrayBuffer()) });
              return { error: null };
            },
            async download(path) {
              const file = files.get(path);
              if (!file) return { data: null, error: new Error('não existe: ' + path) };
              return { data: new Blob([file.bytes], { type: file.type }), error: null };
            }
          };
        }
      }
    };
  }
  return { tables, files, client };
}

/* ── um "aparelho": localStorage próprio + IndexedDB de prints próprio ── */
function createDevice(cloud, { state, savedMeta }) {
  const mem = new Map();
  if (savedMeta) mem.set('ecSupabaseSyncMeta', savedMeta);
  const shots = new Map();
  const adapter = {
    state: JSON.parse(JSON.stringify(state)),
    getState() { return this.state; },
    applyState(next) { this.state = next; },
    persist() {},
    refresh() {},
    async getShots() { return [...shots.values()]; },
    async getBlob(row) { return row.blob || null; },
    async putShot(record) { shots.set(String(record.id), record); }
  };
  const win = {
    EC_SUPABASE_CONFIG: {
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
      storageBucket: 'edgecontrol-prints',
      accountCode: 'EC-7K4M-9Q2X',
      deviceLogin: { email: SITE_EMAIL, password: SITE_PASS }
    },
    supabase: { createClient: () => cloud.client() },
    addEventListener() {}, setInterval() { return 0; }, toast() {},
    crypto: require('node:crypto').webcrypto,
    matchMedia: () => ({ matches: false })
  };
  const ctx = {
    window: win,
    localStorage: {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: k => mem.delete(k)
    },
    document: { hidden: false, getElementById: () => null, addEventListener() {} },
    navigator: { onLine: true },
    crypto: require('node:crypto').webcrypto,
    Blob, Buffer, Date, JSON, Object, Array, Map, Set, String, Number, Promise, Math,
    setTimeout, clearTimeout, console, Uint8Array
  };
  vm.runInNewContext(source, ctx);
  win.ECSupabaseApp.configure(adapter);
  return { api: win.ECSupabaseApp, adapter, shots, mem, win };
}

const jpeg = text => new Blob([Buffer.from(text)], { type: 'image/jpeg' });
/* O que o app faz em save(): guarda o estado anterior, grava o novo e avisa o
   sincronizador de que houve mudança local. */
function edit(device, next) {
  const before = JSON.stringify(device.adapter.state);
  device.adapter.state = next;
  device.api.trackLocalChanges(before, next);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const cloud = createCloud();

  /* ── PC: já tem dados e entra sozinho na conta ── */
  const pc = createDevice(cloud, {
    state: { settings: { initialCapital: 1000, currentCapital: 1000 }, operations: [{ id: 'op-1', date: '2026-10-28', result: 'WIN', value: 40 }] }
  });
  await pc.api.boot();
  await sleep(50);
  assert.ok(cloud.tables.ec_operations.size >= 1, 'o PC envia as operações dele para a nuvem sem pedir nada');
  assert.equal(cloud.tables.ec_user_state.get(OWNER).payload.settings.initialCapital, 1000, 'os ajustes sobem junto');

  /* ── PC altera: nova operação + novo print ── */
  edit(pc, {
    settings: { initialCapital: 1000, currentCapital: 1180 },
    operations: [
      { id: 'op-1', date: '2026-10-28', result: 'WIN', value: 40 },
      { id: 'op-2', date: '2026-11-03', result: 'LOSS', value: -20, asset: 'EUR/USD' }
    ]
  });
  pc.adapter.getShots = async () => [{
    id: 'print-2', blob: jpeg('print-novo-do-pc'), note: 'entrada de hoje',
    name: 'print2.jpg', opId: 'op-2', at: '2026-11-03T12:00:00Z', size: 'print-novo-do-pc'.length
  }];
  await pc.api.syncNow();
  await sleep(30);
  assert.equal(cloud.tables.ec_operations.get(OWNER + '|op-2').payload.value, -20, 'operação nova chega na nuvem');
  assert.ok([...cloud.files.keys()].some(p => p.includes('print-2')), 'o print sobe para o bucket');

  /* ── CELULAR: abre novo, com os dados publicados do site (seed) ── */
  const phone = createDevice(cloud, {
    state: { settings: { initialCapital: 900, currentCapital: 900 }, operations: [{ id: 'op-1', date: '2026-10-28', result: 'WIN', value: 40 }] }
  });
  phone.api.markSeeded();          /* abriu com dados/padrao*.json */
  await phone.api.boot();
  await sleep(80);

  const phoneIds = phone.adapter.state.operations.map(op => op.id).sort();
  assert.deepEqual(phoneIds, ['op-1', 'op-2'], 'o celular recebe a operação criada no PC automaticamente');
  assert.equal(phone.adapter.state.settings.initialCapital, 1000, 'os ajustes do PC vencem o retrato antigo do site');
  assert.equal(phone.adapter.state.settings.currentCapital, 1180, 'o capital atualizado desce junto');
  assert.ok(phone.shots.has('print-2'), 'o print do PC chega no celular (com o arquivo)');
  const arrived = phone.shots.get('print-2');
  assert.ok(arrived.blob && arrived.blob.size === 'print-novo-do-pc'.length, 'o arquivo do print é baixado, não só o registro');
  assert.equal(Buffer.from(await arrived.blob.arrayBuffer()).toString(), 'print-novo-do-pc', 'os bytes do print são idênticos');
  assert.equal(arrived.note, 'entrada de hoje', 'a legenda do print também viaja');

  /* ── CAMINHO DE VOLTA: celular altera, PC recebe ── */
  edit(phone, {
    settings: { initialCapital: 1000, currentCapital: 1300 },
    operations: phone.adapter.state.operations.concat([{ id: 'op-3', date: '2026-11-03', result: 'WIN', value: 120 }])
  });
  const oldGetShots = phone.adapter.getShots;
  phone.adapter.getShots = async () => (await oldGetShots()).concat([{
    id: 'print-3', blob: jpeg('print-tirado-no-celular'), note: 'saída', name: 'print3.jpg',
    opId: 'op-3', at: '2026-11-03T13:00:00Z', size: 'print-tirado-no-celular'.length
  }]);
  await phone.api.syncNow();
  await sleep(30);
  await pc.api.syncNow();
  await sleep(30);

  assert.ok(pc.adapter.state.operations.some(op => op.id === 'op-3'), 'o PC recebe a operação criada no celular');
  assert.equal(pc.adapter.state.settings.currentCapital, 1300, 'o ajuste feito no celular chega no PC');
  assert.ok(pc.shots.has('print-3'), 'o print tirado no celular aparece no PC');
  const back = pc.shots.get('print-3');
  assert.equal(Buffer.from(await back.blob.arrayBuffer()).toString(), 'print-tirado-no-celular', 'bytes do print de volta idênticos');

  /* ── Apagar de verdade não volta: quem abre depois não ressuscita ── */
  edit(phone, {
    settings: phone.adapter.state.settings,
    operations: phone.adapter.state.operations.filter(op => op.id !== 'op-2')
  });
  await phone.api.syncNow();
  await sleep(30);
  const late = createDevice(cloud, {
    state: { settings: { initialCapital: 900 }, operations: [{ id: 'op-1' }, { id: 'op-2' }] }
  });
  late.api.markSeeded();
  await late.api.boot();
  await sleep(80);
  const lateIds = late.adapter.state.operations.map(op => op.id);
  assert.ok(!lateIds.includes('op-2'), 'operação apagada em um aparelho não volta em outro');
  assert.ok(lateIds.includes('op-3'), 'e o aparelho novo já nasce com tudo o que ficou');

  console.log('✅ Dois aparelhos: operações, ajustes e prints (arquivo incluído) aparecem sozinhos no outro, e o que foi apagado não volta');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
