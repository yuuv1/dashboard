/* ------------------------------------------------------------------
   Teste da importação SOMANDO (rotina trabalho → casa).

   O botão "➕ Somar backup" junta o .json do e-mail com o que já está
   no aparelho SEM apagar nada:
     · id novo → entra; · idem ao que já tem → pula;
     · mesmo id com conteúdo diferente → conflito: mantém o daqui e avisa;
     · operação sem id estável → compara pela impressão digital;
     · configurações daqui vencem; prints novos entram no IndexedDB.
   E o "⬇ Importar substituindo tudo" continua apagando (com aviso).

   Rodar:  node tests/test-merge.js   (ou: npm run test:merge)
   Requer: npm install  (jsdom, fake-indexeddb)
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');

const HTML = path.join(__dirname, '..', 'edgecontrol-glass-v2.html');
const html = fs.readFileSync(HTML, 'utf8');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* GIF 1x1 transparente, para montar prints de teste */
const GIF_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const casaA = { id: 'opA', date: '2026-10-12', time: '10:00', value: 10, usd: 2, result: 'WIN', asset: 'EUR/USD', direction: 'CALL', operationals: [], emotions: [], reason: '', plan: 'yes', img: '', yt: '', notes: 'versão de casa', shots: [], createdAt: '2026-10-12T10:00:00.000Z' };
const casaB = { id: 'opB', date: '2026-10-13', time: '11:00', value: 20, usd: 4, result: 'LOSS', asset: 'GBP/USD', direction: 'PUT', operationals: [], emotions: [], reason: '', plan: '', img: '', yt: '', notes: '', shots: [], createdAt: '2026-10-13T11:00:00.000Z' };
/* o que vem no backup do trabalho: A’ (mesmo id, conteúdo diferente),
   B idêntica, C nova com print, D nova sem id (estilo v1) */
const trabA = { ...casaA, value: 99, notes: 'versão do trabalho' };
const trabC = { id: 'opC', date: '2026-10-14', time: '09:30', value: 30, usd: 6, result: 'WIN', asset: 'XAU/USD', direction: 'CALL', operationals: ['Pullback'], emotions: [], reason: '', plan: 'yes', img: '', yt: '', notes: 'nova do trabalho', shots: ['shot_C1'], createdAt: '2026-10-14T09:30:00.000Z' };
const trabD = { date: '2026-10-14', time: '10:00', value: 5, result: 'WIN', asset: 'EUR/USD', notes: 'sem id' };
const shotsTrab = { shot_C1: { d: GIF_URL, note: '', name: 'c1.png', at: '2026-10-14T09:30:00.000Z', opId: 'opC', marks: [], crop: null } };

(async () => {
  const confirms = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://edgecontrol.local/',
    beforeParse(w) {
      w.indexedDB = new IDBFactory();
      Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true, writable: true });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      w.print = () => {};
      w.fetch = async () => { throw new Error('sem rede no teste'); };
      w.confirm = msg => { confirms.push(String(msg)); return true; };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      const ctx = new Proxy({}, { get: (t, k) => (k === 'canvas' ? null : ((k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop() {} }) : () => ({}))) });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      w.Chart = class { constructor(c, cfg) { this.config = cfg || {}; } get data() { return this.config.data || {}; } get options() { return this.config.options || {}; } destroy() {} update() {} resize() {} reset() {} };
      w.Chart.defaults = {};
      w.URL.createObjectURL = () => 'blob:mock';
      w.URL.revokeObjectURL = () => {};
      Object.defineProperty(w.HTMLImageElement.prototype, 'complete', { get() { return true; } });
    }
  });
  const w = dom.window;
  const ev = code => w.eval(code);
  await sleep(700);
  ok(ev('typeof S') === 'object', 'app v2 carregou no jsdom');

  /* ── 1. funções novas existem ─────────────────────────────────── */
  console.log('\n── 1. API de mesclagem ──');
  ok(ev('typeof mergeBackupState') === 'function', 'mergeBackupState() existe');
  ok(ev('typeof mergeKey') === 'function' && ev('typeof mergeSame') === 'function', 'mergeKey()/mergeSame() existem');
  ok(ev(`mergeSame(${JSON.stringify(casaA)},${JSON.stringify({ ...casaA })})`) === true, 'mesmo id + mesmo conteúdo = igual');
  ok(ev(`mergeSame(${JSON.stringify(casaA)},${JSON.stringify(trabA)})`) === false, 'mesmo id + conteúdo diferente = conflito');
  ok(ev(`mergeKey(${JSON.stringify(trabD)})===mergeKey(${JSON.stringify({ ...trabD })})`) === true, 'impressão digital igual para duplicadas sem id');

  /* ── 2. somar: entra o novo, mantém o daqui ───────────────────── */
  console.log('\n── 2. somar backup (trabalho → casa) ──');
  ev(`S=migrateState({settings:{initialCapital:111},operations:${JSON.stringify([casaA, casaB])}});save();`);
  ok(ev('S.operations.length') === 2, 'casa começa com 2 operações');
  const packTrab = { __ec: 3, exportedAt: '2026-10-16T21:00:00.000Z', state: { settings: { initialCapital: 999 }, operations: [trabA, casaB, trabC, trabD] }, shots: shotsTrab };
  const arqTrab = new w.File([JSON.stringify(packTrab)], 'edgecontrol_backup_2026-10-16.json', { type: 'application/json' });
  ev(`_importMode='merge'`);
  await w.importData({ target: { files: [arqTrab], value: 'x' } });
  ok(ev('S.operations.length') === 4, 'somou: 2 + 2 novas = 4', String(ev('S.operations.length')));
  ok(ev(`S.operations.find(o=>o.id==='opA').notes`) === 'versão de casa', 'conflito: manteve a versão de casa');
  ok(ev(`S.operations.find(o=>o.id==='opA').value`) === 10, 'conflito: valor de casa intacto');
  ok(ev(`S.operations.find(o=>o.id==='opC').notes`) === 'nova do trabalho', 'operação nova do trabalho entrou');
  ok(ev(`S.operations.filter(o=>String(o.id).startsWith('mrg_')).length`) === 1, 'operação sem id ganhou id novo e entrou');
  ok(ev('S.settings.initialCapital') === 111, 'configuração de casa venceu (capital 111, não 999)');
  ok(ev(`S.assets.includes('XAU/USD')`) === true, 'catálogo de ativos somou o novo');
  ok(ev(`S.operationals.includes('Pullback')`) === true, 'catálogo de operacionais somou o novo');
  const toast1 = String((w.document.getElementById('ecT') || {}).textContent || '');
  ok(/\+2 nova/.test(toast1) && /4 no total/.test(toast1), 'aviso conta as novas e o total', toast1.slice(0, 80));
  ok(/1 conflito/.test(toast1), 'aviso menciona o conflito mantido', toast1.slice(0, 120));
  ok(confirms.length === 1 && /Nada será apagado/.test(confirms[0]), 'confirmação promete não apagar', (confirms[0] || '').slice(0, 60));
  ok(ev(`_importMode`) === 'replace', 'modo volta ao seguro depois de somar');

  /* prints do backup somado */
  const recs = await ev('IMGDB.all()');
  const c1 = (recs || []).find(r => r.id === 'shot_C1');
  ok(!!(c1 && c1.dataUrl === GIF_URL), 'print novo do backup entrou no IndexedDB');
  ok(ev(`(S.operations.find(o=>o.id==='opC').shots||[]).includes('shot_C1')`) === true, 'vínculo op↔print da operação somada');

  /* ── 3. somar de novo o mesmo arquivo: nada duplica ───────────── */
  console.log('\n── 3. segunda soma do mesmo arquivo ──');
  ev(`_importMode='merge'`);
  await w.importData({ target: { files: [new w.File([JSON.stringify(packTrab)], 'b.json', { type: 'application/json' })], value: 'x' } });
  ok(ev('S.operations.length') === 4, 'nada duplicou na segunda soma', String(ev('S.operations.length')));
  const toast2 = String((w.document.getElementById('ecT') || {}).textContent || '');
  ok(/\+0 nova/.test(toast2), 'aviso mostra +0 novas', toast2.slice(0, 80));

  /* ── 4. substituir continua substituindo (com aviso) ──────────── */
  console.log('\n── 4. importar substituindo tudo ──');
  const packNovo = { __ec: 3, exportedAt: '2026-10-16T21:00:00.000Z', state: { settings: { initialCapital: 50 }, operations: [trabC] }, shots: {} };
  ev(`_importMode='replace'`);
  await w.importData({ target: { files: [new w.File([JSON.stringify(packNovo)], 'n.json', { type: 'application/json' })], value: 'x' } });
  ok(ev('S.operations.length') === 1 && ev(`S.operations[0].id`) === 'opC', 'substituir troca tudo pelo arquivo');
  ok(/substituídos/.test(confirms[confirms.length - 1] || ''), 'substituir avisa que apaga', (confirms[confirms.length - 1] || '').slice(0, 70));

  /* ── 5. botões e texto do cartão ──────────────────────────────── */
  console.log('\n── 5. cartão Backup de Dados ──');
  const bkp = w.document.body.innerHTML;
  ok(bkp.includes('➕ Somar backup'), 'botão Somar backup existe');
  ok(bkp.includes('Importar substituindo tudo'), 'botão substituir deixa claro que apaga');
  ok(/Trabalho → casa/.test(bkp), 'cartão explica a rotina trabalho → casa');

  console.log(fails ? `\n❌ ${fails} FALHA(S)` : '\n🎉 SOMA OK — TODOS OS TESTES PASSARAM');
  dom.window.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ erro fatal no teste:', (e && e.stack) || e); process.exit(1); });
