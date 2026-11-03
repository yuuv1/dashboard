/* Dados padrão do site: o painel publicado abre preenchido na primeira visita,
   sem sobrescrever quem já usa o app. Também confere os arquivos publicados. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const APP = 'edgecontrol-glass-v2.html';

/* ── 1. Os arquivos do padrão ─────────────────────────────────────────── */
const full = JSON.parse(read('dados/padrao.json'));
const state = JSON.parse(read('dados/padrao-estado.json'));
assert.equal(full.__ec, 3, 'padrão usa o envelope atual do backup');
assert.ok(Array.isArray(full.state.operations) && full.state.operations.length >= 1, 'padrão tem operações');
assert.ok(Object.keys(full.shots || {}).length >= 1, 'padrão tem prints');
assert.deepEqual(state.state, full.state, 'o arquivo leve é exatamente o estado do backup completo');
assert.equal(state.prints, Object.keys(full.shots).length, 'o arquivo leve informa quantos prints vêm no completo');
assert.ok(fs.statSync(path.join(root, 'dados/padrao-estado.json')).size < 200 * 1024, 'o arquivo leve continua pequeno (primeira pintura)');

/* ── 2. O app sabe usar o padrão ──────────────────────────────────────── */
const html = read(APP);
assert.match(html, /dados\/padrao-estado\.json/, 'o app busca o estado padrão');
assert.match(html, /dados\/padrao\.json/, 'o app busca o backup completo (prints)');
assert.match(html, /panelAlreadyUsed/, 'há guarda para não sobrescrever quem já tem dados');
assert.match(html, /await seedDefaultData\(\)/, 'o padrão entra antes da primeira pintura');

/* ── 3. Publicação (Pages e pacote do Netlify) ────────────────────────── */
const pages = read('.github/workflows/pages.yml');
for (const asset of ['dados/padrao.json', 'dados/padrao-estado.json']) {
  assert.ok(pages.includes(asset), `o deploy publica ${asset}`);
  assert.ok(fs.existsSync(path.join(root, '_public', asset)), `_public leva ${asset}`);
}

/* ── 4. Comportamento real no navegador (jsdom) ───────────────────────── */
function bootApp({ savedState, seed }) {
  const idb = new IDBFactory();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://edgecontrol.local/',
    beforeParse(w) {
      w.confirm = () => true;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.indexedDB = idb;
      w.IDBKeyRange = IDBKeyRange;
      w.URL.createObjectURL = () => 'blob:mock-' + Math.random();
      w.URL.revokeObjectURL = () => {};
      const ctx = new Proxy({}, {
        get: (t, k) => {
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
          if (k === 'canvas') return null;
          return () => ({});
        }
      });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      w.Chart = class { constructor(c, cfg) { this.config = cfg || {}; } destroy() {} update() {} resize() {} reset() {} };
      w.Chart.defaults = {};
      w.TextEncoder = TextEncoder;
      w.Blob = Blob;
      w.fetch = async url => {
        const body = String(url).includes('padrao-estado') ? JSON.stringify(seed.state) : JSON.stringify(seed.full);
        return { ok: true, status: 200, async text() { return body; }, async json() { return JSON.parse(body); } };
      };
      if (savedState) w.localStorage.setItem('ec7', savedState);
    }
  });
  return dom.window;
}

const seedPack = {
  state: { __ec: 3, exportedAt: '2026-11-03T00:00:00Z', state: { settings: { initialCapital: 500, currentCapital: 640 }, operations: [{ id: 'seed-1', date: '2026-10-29', result: 'WIN', value: 40, asset: 'EUR/USD' }] }, prints: 1 },
  full: { __ec: 3, exportedAt: '2026-11-03T00:00:00Z', state: { settings: { initialCapital: 500, currentCapital: 640 }, operations: [{ id: 'seed-1', date: '2026-10-29', result: 'WIN', value: 40, asset: 'EUR/USD' }] }, shots: {} }
};

(async () => {
  {
    const win = bootApp({ seed: seedPack });
    await new Promise(r => setTimeout(r, 900));
    const saved = JSON.parse(win.localStorage.getItem('ec7') || '{}');
    assert.equal((saved.operations || []).length, 1, 'primeira visita: o painel abre com as operações publicadas');
    assert.equal(saved.operations[0].id, 'seed-1', 'a operação publicada é a que aparece');
    assert.equal(saved.settings.initialCapital, 500, 'os ajustes (capital) vêm junto');
    win.close();
  }
  {
    const mine = JSON.stringify({ settings: { initialCapital: 999 }, operations: [{ id: 'meu', date: '2026-01-01' }] });
    const win = bootApp({ savedState: mine, seed: seedPack });
    await new Promise(r => setTimeout(r, 500));
    const saved = JSON.parse(win.localStorage.getItem('ec7'));
    assert.equal(saved.operations.length, 1, 'quem já usa o app não recebe o padrão por cima');
    assert.equal(saved.operations[0].id, 'meu', 'os dados do aparelho continuam intactos');
    win.close();
  }
  {
    /* painel vazio (já abriu o app alguma vez, mas sem operações): completa com o padrão */
    const empty = JSON.stringify({ settings: { initialCapital: 0 }, operations: [] });
    const win = bootApp({ savedState: empty, seed: seedPack });
    await new Promise(r => setTimeout(r, 900));
    const saved = JSON.parse(win.localStorage.getItem('ec7'));
    assert.equal((saved.operations || []).length, 1, 'painel vazio também abre preenchido');
    assert.equal(win.localStorage.getItem('ecSeeded'), '1', 'marca que já veio do padrão (não repete depois)');
    win.close();
  }
  console.log('✅ Dados padrão: abre preenchido na primeira visita e nunca sobrescreve o aparelho');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
