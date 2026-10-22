const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const stored = new Map();
const localStorage = {
  getItem: key => stored.has(key) ? stored.get(key) : null,
  setItem: (key, value) => stored.set(key, String(value))
};
const win = { EC_SUPABASE_CONFIG: {}, addEventListener() {} };
const context = {
  window: win, localStorage, document: { getElementById: () => null }, navigator: { onLine: true },
  Date, JSON, Object, Array, Map, Set, String, Number, Promise, Math, crypto: {},
  setTimeout, clearTimeout, console
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'app-sync.js'), 'utf8'), context);
const sync = win.ECSupabaseApp;
const at = value => new Date(value).toISOString();

{
  const result = sync._mergeOperationRows([{ id: 'local', pnl: 12 }], [], { opChanges: {}, deletedOps: {} });
  assert.equal(result.operations.length, 1);
  assert.equal(result.writes[0].operation_id, 'local', 'local-only operations are sent to the cloud');
  assert.equal(result.writes[0].deleted, false);
}
{
  const remote = { operation_id: 'remote', payload: { id: 'remote', pnl: 8 }, updated_at: at('2026-10-01T00:00:00Z'), deleted: false };
  const result = sync._mergeOperationRows([], [remote], { opChanges: {}, deletedOps: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(result.operations)), [{ id: 'remote', pnl: 8 }], 'remote-only operations are restored locally');
}
{
  const remote = { operation_id: 'edit', payload: { id: 'edit', pnl: 5 }, updated_at: at('2026-10-02T00:00:00Z'), deleted: false };
  const result = sync._mergeOperationRows([{ id: 'edit', pnl: 9 }], [remote], {
    opChanges: { edit: at('2026-10-03T00:00:00Z') }, deletedOps: {}
  });
  assert.equal(result.operations[0].pnl, 9, 'a newer local edit wins');
  assert.equal(result.writes[0].payload.pnl, 9);
}
{
  const remote = { operation_id: 'edit', payload: { id: 'edit', pnl: 5 }, updated_at: at('2026-10-04T00:00:00Z'), deleted: false };
  const result = sync._mergeOperationRows([{ id: 'edit', pnl: 9 }], [remote], { opChanges: {}, deletedOps: {} });
  assert.equal(result.operations[0].pnl, 5, 'without a pending local edit, cloud wins');
}
{
  const remote = { operation_id: 'gone', payload: { id: 'gone' }, updated_at: at('2026-10-01T00:00:00Z'), deleted: false };
  const result = sync._mergeOperationRows([], [remote], { opChanges: {}, deletedOps: { gone: at('2026-10-02T00:00:00Z') } });
  assert.equal(result.operations.length, 0, 'newer local deletion is retained');
  assert.equal(result.writes[0].deleted, true, 'deletion is sent as a tombstone');
}
{
  const remote = { operation_id: 'gone', payload: { id: 'gone' }, updated_at: at('2026-10-03T00:00:00Z'), deleted: true };
  const result = sync._mergeOperationRows([{ id: 'gone', pnl: 2 }], [remote], { opChanges: {}, deletedOps: {} });
  assert.equal(result.operations.length, 0, 'remote deletion does not resurrect a stale local operation');
}
{
  const previous = JSON.stringify({ operations: [{ id: 'x', pnl: 10 }], settings: { theme: 'a' } });
  sync.trackLocalChanges(previous, { operations: [{ id: 'x', pnl: 11 }], settings: { theme: 'a' } });
  const meta = JSON.parse(localStorage.getItem('ecSupabaseSyncMeta'));
  assert.ok(meta.opChanges.x, 'local edits are queued with a timestamp');
  assert.equal(meta.stateAt, '', 'an operation-only edit does not mark settings dirty');
}
async function endToEndCloudRoundTrip() {
  const db = { ec_user_state: [], ec_operations: [], ec_shots: [] };
  const files = new Map();
  const backend = {
    from(table) {
      const query = { table, filters: {}, max: Infinity };
      query.select = () => query;
      query.eq = (key, value) => { query.filters[key] = value; return query; };
      query.limit = n => { query.max = n; return query; };
      query.upsert = async rows => {
        for (const row of Array.isArray(rows) ? rows : [rows]) {
          const key = table === 'ec_user_state' ? row.user_id : table === 'ec_operations' ? row.user_id + ':' + row.operation_id : row.user_id + ':' + row.shot_id;
          const list = db[table];
          const idx = list.findIndex(old => (table === 'ec_user_state' ? old.user_id : table === 'ec_operations' ? old.user_id + ':' + old.operation_id : old.user_id + ':' + old.shot_id) === key);
          if (idx < 0) list.push({ ...row }); else list[idx] = { ...row };
        }
        return { error: null };
      };
      query.then = (resolve, reject) => Promise.resolve({
        data: db[table].filter(row => Object.entries(query.filters).every(([k, v]) => row[k] === v)).slice(0, query.max),
        error: null
      }).then(resolve, reject);
      return query;
    },
    storage: {
      from() {
        return {
          async upload(path, blob) { files.set(path, blob); return { error: null }; },
          async download(path) { return files.has(path) ? { data: files.get(path), error: null } : { data: null, error: new Error('missing file') }; }
        };
      }
    }
  };
  function makeApp(localState, localShots) {
    const mem = new Map();
    const ls = { getItem: k => mem.get(k) || null, setItem: (k, v) => mem.set(k, String(v)) };
    const win = {
      EC_SUPABASE_CONFIG: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test', storageBucket: 'edgecontrol-prints' },
      supabase: { createClient: () => Object.assign({}, backend, { auth: {
        async getSession() { return { data: { session: { user: { id: 'user-1', email: 'test@example.com' } } }, error: null }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        async signOut() { return { error: null }; }, async signInWithOtp() { return { error: null }; }
      } }) },
      addEventListener() {}, setInterval() {}, toast() {}
    };
    let state = localState;
    let blobReads = 0;
    const shots = new Map(localShots.map(shot => [shot.id, shot]));
    const elements = new Map();
    const doc = { hidden: false, getElementById: id => elements.get(id) || null, addEventListener() {} };
    const ctx = {
      window: win, localStorage: ls, document: doc, navigator: { onLine: true }, crypto: require('node:crypto').webcrypto,
      Blob, Date, JSON, Object, Array, Map, Set, String, Number, Promise, Math, setTimeout, clearTimeout, console
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'app-sync.js'), 'utf8'), ctx);
    const api = win.ECSupabaseApp;
    api.configure({
      getState: () => state,
      getShots: async () => Array.from(shots.values()),
      getBlob: async rec => { blobReads++; return rec.blob; },
      putShot: async rec => { shots.set(String(rec.id), rec); },
      applyState: next => { state = next; },
      refresh() {}, persist() {}
    });
    return { api, getState: () => state, shots, getBlobReads: () => blobReads };
  }
  const firstShot = { id: 'shot-1', blob: new Blob(['image-bytes'], { type: 'image/jpeg' }), name: 'chart.jpg', note: 'entrada', at: '2026-10-22', opId: 'op-1', marks: [], crop: null };
  const first = makeApp({ settings: { initialCapital: 1000 }, operations: [{ id: 'op-1', pnl: 25 }] }, [firstShot]);
  await first.api.boot();
  assert.equal(db.ec_operations.length, 1, 'first device uploads local operations');
  assert.equal(db.ec_user_state.length, 1, 'first device uploads settings/state');
  assert.equal(db.ec_shots.length, 1, 'first device uploads print metadata');
  assert.equal(files.size, 1, 'print image is stored in private Storage');
  const readsAfterFirstSync = first.getBlobReads();
  await first.api.syncNow();
  assert.equal(first.getBlobReads(), readsAfterFirstSync, 'routine sync reuses the cached print hash instead of reopening image blobs');

  const second = makeApp({ settings: { initialCapital: 0 }, operations: [] }, []);
  await second.api.boot();
  assert.equal(second.getState().operations.length, 1, 'second device downloads cloud operations');
  assert.equal(second.getState().settings.initialCapital, 1000, 'second device receives cloud settings');
  assert.equal(second.shots.size, 1, 'second device downloads the print into IndexedDB');
}

endToEndCloudRoundTrip().then(() => {
  console.log('✅ Supabase app sync: merge local/cloud, tombstones, fila e round-trip de dados/prints');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
