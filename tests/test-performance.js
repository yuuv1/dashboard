/* Performance regressions for v2. No real backups are imported or rewritten.
   npm run test:performance — jsdom + fake IndexedDB; actual Chart.js is covered
   separately by test-performance-browser.js. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const html = fs.readFileSync(path.join(__dirname, '../edgecontrol-glass-v2.html'), 'utf8');
const core = html.split('/*PERFORMANCE-CORE-START*/')[1].split('/*PERFORMANCE-CORE-END*/')[0];
const C = vm.runInNewContext(core + ';({chartLineIndices,chartLineData})');
const json = value => JSON.parse(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) {
  const deadline = Date.now() + 3000;
  while (!condition() && Date.now() < deadline) await sleep(10);
  assert.ok(condition(), 'async panel must finish');
}
let passed = 0;
async function test(name, fn) {
  await fn(); passed++; console.log('✅ ' + name);
}
function syntheticOperations(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'perf-' + i, date: '2026-09-' + String(1 + i % 28).padStart(2, '0'),
    time: String(9 + i % 8).padStart(2, '0') + ':15:00.123', asset: 'EUR/USD',
    result: i % 3 ? 'WIN' : 'LOSS', value: i % 3 ? 8 : 10,
    investment: 10, payout: 80, plan: i % 2 ? 'yes' : 'no',
    direction: 'CALL', shots: [], reason: 'Operação sintética', extra: { retained: i }
  }));
}
async function boot(state = {}, reduced = false) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  vc.on('warn', (...args) => {
    if (/^(gráficos avançados:|slot )/.test(String(args[0]))) errors.push(args.map(String).join(' '));
  });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://edgecontrol.test/edgecontrol-glass-v2.html', virtualConsole: vc,
    beforeParse(w) {
      w.indexedDB = new IDBFactory(); w.confirm = () => true; w.print = () => {};
      w.matchMedia = query => ({ matches: reduced && query.includes('reduced-motion'),
        addEventListener() {}, removeEventListener() {}, addListener() {} });
      w.Chart = class {
        static defaults = {}; static instances = {}; static created = 0; static destroyed = 0;
        static version = 'test-double';
        constructor(ctx, config) {
          this.id = ++w.Chart.created; this.config = config;
          this.data = config.data; this.options = config.options;
          w.Chart.instances[this.id] = this;
        }
        destroy() { delete w.Chart.instances[this.id]; w.Chart.destroyed++; }
        resize() {} update() {}
      };
      w.HTMLCanvasElement.prototype.getContext = function () {
        const noop = () => {};
        return new Proxy({ canvas: this }, { get: (obj, key) => {
          if (key === 'createLinearGradient') return () => ({ addColorStop: noop });
          if (key === 'measureText') return text => ({ width: String(text).length * 8 });
          return obj[key] === undefined ? noop : obj[key];
        }, set: (obj, key, value) => { obj[key] = value; return true; } });
      };
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,dGVzdA==';
      w.URL.createObjectURL = blob => { w.__export = blob; return 'blob:test'; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = () => {};
      w.fetch = async url => ({ ok: String(url).endsWith('/registro.json'),
        text: async () => JSON.stringify({ ferramentas: [] }) });
      w.localStorage.setItem('ec7', JSON.stringify({ _img_migrated: true, ...state }));
    }
  });
  const w = dom.window;
  if (w.document.readyState !== 'complete') await new Promise(resolve => w.addEventListener('load', resolve, { once: true }));
  await w.eval('mediaReady'); await sleep(25);
  assert.deepEqual(errors, [], 'app must boot without runtime errors');
  return { w, dom, errors };
}
(async () => {
  console.log('\n── Desempenho / linhas limitadas ──');
  await test('séries pequenas mantêm todos os pontos, inclusive a série vazia', () => {
    for (const n of [0, 1, 2, 12, 599, 600])
      assert.deepEqual(json(C.chartLineIndices(Array.from({ length: n }, (_, i) => i))), Array.from({ length: n }, (_, i) => i));
  });
  await test('50 mil pontos preservam extremos, primeiro/último, ordem e valores originais', () => {
    const values = Array.from({ length: 50001 }, (_, i) => Math.sin(i) * 10);
    values[12345] = -100000; values[37777] = 100000;
    const before = [...values], indices = json(C.chartLineIndices(values));
    assert.ok(indices.length <= 600); assert.equal(indices[0], 0); assert.equal(indices.at(-1), 50000);
    assert.ok(indices.includes(12345)); assert.ok(indices.includes(37777));
    assert.ok(indices.every((value, i) => !i || value > indices[i - 1]));
    assert.deepEqual(values, before);
    assert.deepEqual(json(C.chartLineData(values)), indices.map(i => ({ x: i, y: values[i] })));
  });
  await test('limites inválidos e séries planas não ultrapassam o orçamento de desenho', () => {
    for (const limit of [-1, 0, 2, 4, 20, 100, Infinity, NaN, 90000]) {
      const indices = C.chartLineIndices(Array(10000).fill(1), limit);
      assert.ok(indices.length <= 600); assert.equal(indices[0], 0); assert.equal(indices.at(-1), 9999);
    }
  });
  await test('runtime fixado é incorporado com licença, sem script Chart.js remoto', () => {
    assert.match(html, /data-vendor="chart\.js@4\.4\.1"/);
    assert.match(html, /Copyright \(c\) 2014-2022 Chart\.js Contributors/);
    assert.match(html, /Copyright \(c\) 2018-2021 Jukka Kurkela/);
    assert.doesNotMatch(html, /<script\s+src="[^"\n]*chart/i);
    assert.doesNotMatch(html, /stepSize:1(?:[,}])/);
  });
  const app = await boot({ operations: syntheticOperations(6000), charts: { auto: true } });
  const { w } = app;
  const q = selector => w.document.querySelector(selector);
  const ev = code => w.eval(code);
  try {
    console.log('\n── Catálogo / paginação / dados integrais ──');
    await test('6 mil operações geram só 100 linhas e o runtime de teste não é substituído', () => {
      w.nav('operations');
      assert.equal(q('#opsTb').children.length, 100);
      assert.match(q('#opsPageInfo').textContent, /de 6000/);
      assert.equal(w.Chart.version, 'test-double');
      assert.equal(ev('S.operations.length'), 6000);
      assert.equal(ev('ecxOpsFiltradas().length'), 6000);
      assert.equal(ev('ecxSerie({filtradas:false}).operacoes.length'), 6000);
      assert.equal(ev('ecxSerie({filtradas:false}).equity.length'), 6001);
      assert.equal(w.Chart.defaults.animation, false);
      assert.equal(w.Chart.defaults.resizeDelay, 0);
    });
    const all = ev('JSON.stringify(S.operations)');
    await test('página seguinte, última página, tamanhos e limites usam índices corretos', () => {
      w.opsPageMove(1); assert.equal(q('#opsTb tr td').textContent, '101');
      w.opsPageMove(9000); assert.equal(q('#opsTb tr td').textContent, '5901');
      assert.equal(q('#opsPageNext').disabled, true);
      w.opsPageResize(200); assert.equal(q('#opsTb').children.length, 200);
      assert.equal(q('#opsPageSize').value, '200');
      w.opsPageResize(5000); assert.equal(q('#opsTb').children.length, 200);
      w.opsPageResize(50); assert.equal(q('#opsTb').children.length, 50);
      w.opsPageMove(-9000); assert.equal(q('#opsPagePrev').disabled, true);
      assert.equal(ev('JSON.stringify(S.operations)'), all);
    });
    await test('filtro consulta o histórico inteiro, não apenas a página atual', () => {
      q('#fRes').value = 'LOSS'; w.applyFilter();
      assert.equal(ev('ecxOpsFiltradas().length'), 2000);
      assert.match(q('#opsPageInfo').textContent, /de 2000/);
      w.opsPageMove(9000); assert.equal(q('#opsPageNext').disabled, true);
      assert.equal(q('#opsTb').children.length, 50);
      assert.ok([...q('#opsTb').children].every(row => row.textContent.includes('LOSS')));
      w.clearFilter(); assert.match(q('#opsPageInfo').textContent, /de 6000/);
      assert.equal(ev('JSON.stringify(S.operations)'), all);
    });
    await test('caminho do backup mantém o envelope e todas as operações, sem paginar o export', async () => {
      await w.exportData();
      const exported = await new Promise((resolve, reject) => {
        const reader = new w.FileReader(); reader.onload = () => resolve(JSON.parse(reader.result));
        reader.onerror = () => reject(reader.error); reader.readAsText(w.__export);
      });
      assert.equal(exported.__ec, 3); assert.equal(exported.state.operations.length, 6000);
      assert.equal(JSON.stringify(exported.state.operations), all);
    });
    console.log('\n── Gráficos / ciclo de vida / modo leve ──');
    await test('atualizações sem alteração reutilizam gráficos; salvar invalida o cache', () => {
      w.nav('dashboard'); w.chartsRefresh();
      const created = w.Chart.created;
      w.chartsRefresh(); w.chartsRefresh(); assert.equal(w.Chart.created, created);
      w.save(); w.chartsRefresh(); assert.ok(w.Chart.created > created);
      assert.ok(Object.values(w.Chart.instances).every(c => !c.data.datasets.some(d => d.data.length > 600)));
      assert.equal(ev('JSON.stringify(S.operations)'), all);
    });
    await test('sair libera todos os charts e cancela a alternância', async () => {
      assert.notEqual(ev('slotTimer'), null);
      w.nav('operations'); assert.equal(Object.keys(w.Chart.instances).length, 0);
      assert.equal(ev('slotTimer'), null);
      w.nav('analytics'); await until(() => ev('!!CH.anROLL&&!!CH.anBUCK'));
      assert.ok(Object.keys(w.Chart.instances).length > 5);
      assert.ok(ev('CH.anDD.data.datasets[0].data.length') <= 600);
      assert.ok(ev('CH.anROLL.data.datasets.every(d=>d.data.length<=600)'));
      w.nav('dashboard'); assert.equal(Object.keys(w.Chart.instances).length, 3);
      assert.equal(ev('heatRedraw'), null);
    });
    await test('Analytics pendente não recria gráficos depois de sair da página', async () => {
      w.nav('analytics'); w.nav('dashboard'); await sleep(100);
      assert.equal(Object.keys(w.Chart.instances).length, 3);
      assert.equal(ev("Object.keys(CH).filter(k=>k.startsWith('an')).length"), 0);
    });
    await test('modal interrompe o timer; aba oculta também, e voltar restaura a preferência', () => {
      w.showMod('profileModal'); assert.equal(ev('slotTimer'), null);
      const created = w.Chart.created; w.slotStep(); assert.equal(w.Chart.created, created);
      w.closeMod('profileModal'); assert.notEqual(ev('slotTimer'), null);
      Object.defineProperty(w.document, 'hidden', { configurable: true, value: true });
      w.document.dispatchEvent(new w.Event('visibilitychange'));
      assert.equal(ev('slotTimer'), null);
      assert.ok(w.document.documentElement.classList.contains('app-hidden'));
      Object.defineProperty(w.document, 'hidden', { configurable: true, value: false });
      w.document.dispatchEvent(new w.Event('visibilitychange'));
      assert.notEqual(ev('slotTimer'), null);
    });
    await test('todos fixados não deixam timer ativo; escolher uma bolinha retoma o rodízio', () => {
      ev('S.charts.fixed={...slotCur};'); w.slotStart(); assert.equal(ev('slotTimer'), null);
      w.slotJump('main', 1); assert.notEqual(ev('slotTimer'), null);
      ev('S.charts.fixed={};'); w.slotJump('main', 0);
    });
    await test('modo leve vem ativo e pode ser desativado/recarregado sem mudar operações', () => {
      assert.equal(w.document.documentElement.dataset.performance, 'light');
      w.performanceModeChange(false); assert.equal(w.document.documentElement.dataset.performance, 'full');
      w.load(); w.applyPerformanceMode(); assert.equal(w.document.documentElement.dataset.performance, 'full');
      w.performanceModeChange(true); assert.equal(w.document.documentElement.dataset.performance, 'light');
      assert.equal(ev('JSON.stringify(S.operations)'), all);
    });
    await test('avatar padrão é SVG local escapado e o fallback nunca entra em loop', () => {
      const svg = decodeURIComponent(w.avFallback('< >').split(',')[1]);
      assert.ok(svg.includes('&lt;')); assert.ok(svg.includes('&gt;'));
      assert.doesNotMatch(html, /https:\/\/ui-avatars\.com/);
      ev("S.profile.avatarData='';S.profile.avatar='https://unreachable.test/avatar.png';applyProfUI();");
      const image = q('#sbAv'); image.onerror();
      assert.equal(image.onerror, null); assert.ok(image.src.startsWith('data:image/svg+xml'));
    });
    console.log('\n── Mídia / leitura leve / vínculos preservados ──');
    await test('metadata usa cursor, preserva owners e exclui Blobs/data URLs do resultado', async () => {
      w.__record = { id: 'perf-shot', opId: 'perf-0', note: 'Teste', name: 'print.png',
        at: '2026-09-01T12:00:00.000Z', size: 1234, blob: new Blob(['payload'], { type: 'image/png' }),
        dataurl: 'data:image/png;base64,' + 'A'.repeat(100000), originalData: 'big', annotations: { private: true } };
      await ev('IMGDB.put(window.__record)');
      const meta = await ev('IMGDB.metadata()');
      assert.equal(meta.length, 1); assert.equal(meta[0].opId, 'perf-0');
      for (const key of ['blob', 'dataurl', 'originalData', 'annotations']) assert.ok(!(key in meta[0]));
      ev("window.__all=IMGDB.all;IMGDB.all=()=>{throw new Error('getAll must not be used');};");
      try {
        const usage = await w.mediaUsage(); assert.equal(usage.count, 1); assert.equal(usage.bytes, 1234);
        await w.reconcileShots(); assert.ok(ev("S.operations.find(o=>o.id==='perf-0').shots.includes('perf-shot')"));
      } finally { ev('IMGDB.all=window.__all;'); }
      const record = await ev("IMGDB.get('perf-shot')");
      assert.equal(record.blob.size, w.__record.blob.size);
      assert.equal(record.dataurl, w.__record.dataurl);
      assert.equal(record.annotations.private, true);
    });
    assert.deepEqual(app.errors, [], 'no late runtime errors');
  } finally { app.dom.window.close(); }
  await test('instalação nova deixa o rodízio desligado; movimento reduzido prevalece', async () => {
    const other = await boot({ performance: { light: false } }, true);
    try {
      assert.equal(other.w.eval('S.charts.auto'), false);
      assert.equal(other.w.eval('slotTimer'), null);
      assert.equal(other.w.document.documentElement.dataset.performance, 'light');
      assert.equal(other.w.document.getElementById('lightModeToggle').disabled, true);
    } finally { other.dom.window.close(); }
  });
  console.log(`\n🎉 DESEMPENHO OK — ${passed} grupos de verificações passaram`);
})().catch(error => { console.error('❌ DESEMPENHO:', error); process.exitCode = 1; });
