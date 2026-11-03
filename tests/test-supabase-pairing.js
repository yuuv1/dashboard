/* Pareamento por código + PIN: contrato do fluxo "sem e-mail".
   Cobre o caminho real do app: sessão técnica do aparelho (signUp), chamada
   ec_pair, memória do dono e sincronização usando a conta da nuvem. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'app-sync.js'), 'utf8');
const OWNER = 'owner-uuid';
const DEVICE = 'device-uuid';

function makeApp({ paired } = {}) {
  const mem = new Map();
  const upserts = [];
  const calls = [];
  const elements = new Map([
    ['sbCode', { value: 'EC-7K4M-9Q2X', style: {} }],
    ['sbPin', { value: '', style: {} }],
    ['sbLoginBox', { style: {} }],
    ['sbAccountBox', { style: {} }],
    ['sbAccountEmail', { textContent: '' }],
    ['sbAccountCode', { textContent: '' }],
    ['sbOwnerBox', { style: {} }],
    ['sbStatus', { textContent: '', style: {} }]
  ]);
  const tables = { ec_user_state: [], ec_operations: [], ec_shots: [] };
  const backend = {
    auth: {
      async getSession() { return { data: { session: null }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signUp(cred) { calls.push(['signUp', cred.email]); return { data: { session: { user: { id: DEVICE, email: cred.email } } }, error: null }; },
      async signInWithPassword(cred) { calls.push(['signInWithPassword', cred.email]); return { data: { session: null }, error: new Error('sem conta') }; }
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (name === 'ec_pair') {
        if (paired === false) return { data: null, error: new Error('codigo ou PIN invalido') };
        return { data: OWNER, error: null };
      }
      if (name === 'ec_home') return { data: paired === false ? null : OWNER, error: null };
      if (name === 'ec_code') return { data: 'EC-7K4M-9Q2X', error: null };
      return { data: null, error: null };
    },
    from(table) {
      const query = { table, filters: {} };
      query.select = () => query;
      query.eq = (key, value) => { query.filters[key] = value; return query; };
      query.limit = () => query;
      query.upsert = async rows => {
        upserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
        return { error: null };
      };
      query.then = (resolve, reject) => Promise.resolve({ data: tables[table], error: null }).then(resolve, reject);
      return query;
    },
    storage: { from: () => ({ async upload() { return { error: null }; }, async download() { return { data: null, error: new Error('vazio') }; } }) }
  };
  const win = {
    EC_SUPABASE_CONFIG: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test', storageBucket: 'edgecontrol-prints', accountCode: 'EC-7K4M-9Q2X' },
    supabase: { createClient: () => backend },
    addEventListener() {}, setInterval() {}, toast() {}
  };
  const ctx = {
    window: win,
    localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
    document: { hidden: false, getElementById: id => elements.get(id) || null, addEventListener() {} },
    navigator: { onLine: true },
    crypto: require('node:crypto').webcrypto,
    Blob, Date, JSON, Object, Array, Map, Set, String, Number, Promise, Math, setTimeout, clearTimeout, console, Uint8Array
  };
  vm.runInNewContext(source, ctx);
  const api = win.ECSupabaseApp;
  api.configure({ getState: () => ({ settings: { initialCapital: 10 }, operations: [{ id: 'op-1', pnl: 1 }] }), getShots: async () => [], getBlob: async () => null, putShot: async () => {}, applyState() {}, refresh() {}, persist() {} });
  return { api, elements, calls, upserts, mem };
}

(async () => {
  {
    const app = makeApp();
    await app.api.boot();
    assert.equal(app.elements.get('sbCode').value, 'EC-7K4M-9Q2X', 'o código público já vem preenchido no campo');
    assert.equal(app.elements.get('sbLoginBox').style.display, 'block', 'aparelho novo pede o pareamento');
    assert.match(app.elements.get('sbStatus').textContent, /código e o PIN/, 'status explica o que digitar');
    assert.equal(app.calls.filter(c => c[0] === 'signUp').length, 0, 'abrir o site não cria sessão técnica antes do usuário agir');
  }
  {
    const app = makeApp();
    await app.api.boot();
    app.elements.get('sbPin').value = '123';
    await app.api.pairDevice();
    assert.match(app.elements.get('sbStatus').textContent, /6 números/, 'PIN curto é recusado antes de chamar a nuvem');
    assert.equal(app.calls.filter(c => c[1] === 'ec_pair').length, 0);
  }
  {
    const app = makeApp();
    await app.api.boot();
    app.elements.get('sbPin').value = '743921';
    await app.api.pairDevice();
    const pairCall = app.calls.find(c => c[1] === 'ec_pair');
    assert.ok(pairCall, 'o pareamento chama ec_pair');
    assert.deepEqual(JSON.parse(JSON.stringify(pairCall[2])), { p_code: 'EC-7K4M-9Q2X', p_pin: '743921' }, 'código e PIN vão para a função');
    assert.ok(app.calls.some(c => c[0] === 'signUp'), 'o aparelho ganha uma sessão técnica própria (sem e-mail do usuário)');
    assert.equal(app.mem.get('ecHomeAccount'), OWNER, 'o dono da conta fica guardado no aparelho');
    assert.equal(app.elements.get('sbAccountBox').style.display, 'block', 'depois de pareado o card mostra a conta conectada');
    const opWrite = app.upserts.find(u => u.table === 'ec_operations');
    assert.ok(opWrite, 'a sincronização envia as operações');
    assert.equal(opWrite.rows[0].user_id, OWNER, 'os dados sobem na conta da nuvem, não no usuário técnico do aparelho');
  }
  {
    const app = makeApp({ paired: false });
    await app.api.boot();
    app.elements.get('sbPin').value = '000000';
    await app.api.pairDevice();
    assert.match(app.elements.get('sbStatus').textContent, /Não consegui conectar/, 'PIN errado aparece no status, sem quebrar o app');
    assert.equal(app.mem.get('ecHomeAccount'), undefined, 'PIN errado não grava dono no aparelho');
  }
  console.log('✅ Pareamento por código + PIN: sessão do aparelho, vínculo com a conta e envio na conta certa');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
