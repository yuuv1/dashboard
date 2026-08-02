/* ═══════════════════════════════════════════════
   EdgeControl — Camada de dados (IndexedDB)
   ───────────────────────────────────────────────
   Bancos:
     kv       -> estado do app (perfil, settings, rainbow, operações)
     boards   -> quadros do canvas (nós + arestas)
     blobs    -> imagens (prints) como Blob binário
   Por que IndexedDB: localStorage tem ~5MB e quebra
   silenciosamente com prints em base64. Aqui cabem
   centenas de MB e as imagens não viram string.
═══════════════════════════════════════════════ */

const DB_NAME = 'edgecontrol';
const DB_VER  = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv'))     db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs'))  db.createObjectStore('blobs',  { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  }));
}

/* ── KV: estado geral ── */
export const kv = {
  get:  k       => tx('kv', 'readonly',  s => s.get(k)),
  set:  (k, v)  => tx('kv', 'readwrite', s => s.put(v, k)),
  del:  k       => tx('kv', 'readwrite', s => s.delete(k)),
};

/* ── BOARDS: quadros do canvas ── */
export const boards = {
  all:  ()  => tx('boards', 'readonly',  s => s.getAll()),
  get:  id  => tx('boards', 'readonly',  s => s.get(id)),
  put:  b   => tx('boards', 'readwrite', s => s.put(b)),
  del:  id  => tx('boards', 'readwrite', s => s.delete(id)),
};

/* ── BLOBS: imagens ── */
export const blobs = {
  put: async (id, blob) => {
    await tx('blobs', 'readwrite', s => s.put({ id, blob, at: Date.now() }));
    return id;
  },
  get: async id => {
    const r = await tx('blobs', 'readonly', s => s.get(id));
    return r ? r.blob : null;
  },
  del:  id => tx('blobs', 'readwrite', s => s.delete(id)),
  keys: ()  => tx('blobs', 'readonly',  s => s.getAllKeys()),
};

/* ── URLs de objeto com cache, para não vazar memória ── */
const _urls = new Map();
export async function blobURL(id) {
  if (_urls.has(id)) return _urls.get(id);
  const b = await blobs.get(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  _urls.set(id, u);
  return u;
}
export function revokeURL(id) {
  const u = _urls.get(id);
  if (u) { URL.revokeObjectURL(u); _urls.delete(id); }
}

/* ── Coleta de lixo: apaga blobs que nenhum board referencia ── */
export async function gcBlobs() {
  const [all, keys] = await Promise.all([boards.all(), blobs.keys()]);
  const used = new Set();
  all.forEach(b => (b.nodes || []).forEach(n => { if (n.blobId) used.add(n.blobId); }));
  const orphans = keys.filter(k => !used.has(k));
  await Promise.all(orphans.map(k => blobs.del(k)));
  return orphans.length;
}

/* ── Migração automática do localStorage (chave 'ec7') ── */
export async function migrateFromLocalStorage() {
  const already = await kv.get('migrated');
  if (already) return { migrated: false, reason: 'já migrado' };

  let raw = null;
  try { raw = localStorage.getItem('ec7'); } catch (e) {}
  if (!raw) { await kv.set('migrated', true); return { migrated: false, reason: 'nada a migrar' }; }

  try {
    const old = JSON.parse(raw);

    // avatar em base64 -> vira Blob
    if (old.profile && old.profile.avatarData && old.profile.avatarData.startsWith('data:')) {
      try {
        const blob = await (await fetch(old.profile.avatarData)).blob();
        const id = 'avatar-' + Date.now();
        await blobs.put(id, blob);
        old.profile.avatarBlobId = id;
        delete old.profile.avatarData;
      } catch (e) {}
    }

    await kv.set('state', old);
    await kv.set('migrated', true);
    await kv.set('migratedAt', new Date().toISOString());
    try { localStorage.setItem('ec7_backup', raw); } catch (e) {}
    return { migrated: true, ops: (old.operations || []).length };
  } catch (e) {
    await kv.set('migrated', true);
    return { migrated: false, reason: 'JSON inválido' };
  }
}

/* ── Estimativa de uso de disco ── */
export async function usage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const e = await navigator.storage.estimate();
  return { used: e.usage || 0, quota: e.quota || 0, pct: e.quota ? (e.usage / e.quota) * 100 : 0 };
}

/* ── Pede armazenamento persistente (evita limpeza automática) ── */
export async function requestPersist() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
