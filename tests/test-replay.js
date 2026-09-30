/* Replay v1: UTC preciso, ajustes não destrutivos, UI, persistência,
   contrato ECX (iframe/script) e adaptador do futuro motor. Sem cotações falsas.
   npm run test:replay */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'edgecontrol-glass-v2.html'), 'utf8');
const core = html.split('/*REPLAY-CORE-START*/')[1].split('/*REPLAY-CORE-END*/')[0];
const sdk = fs.readFileSync(path.join(ROOT, 'ferramentas/replay-adapter.js'), 'utf8');
const bridge = fs.readFileSync(path.join(ROOT, 'ferramentas/ponte.js'), 'utf8');
const exportsCode = '\n({replayOffset,replayWallTime,replayCaptureExecution,replayExecution,replaySettings,replayPatch,replayBuildContext,replayCloneState,replaySummary})';
const C = vm.runInNewContext(core + exportsCode, { Date, TextEncoder });
const plain = value => JSON.parse(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let fails = 0, checks = 0;
async function test(name, fn) {
  try { await fn(); checks++; console.log('✅', name); }
  catch (e) { fails++; console.error('❌', name, '\n', e.stack || e); }
}
function operation(id = 'op1', time = '09:15:32.123') {
  return { id, date: '2026-09-30', time, asset: 'EUR/USD', direction: 'CALL',
    type: 'CALL', result: 'WIN', value: 12, usd: 2.4, notes: 'original', shots: [],
    createdAt: '2026-10-01T19:00:00.000Z',
    execution: plain(C.replayCaptureExecution('2026-09-30', time, '-03:00')) };
}
const baseOperation = operation();
const engineManifest = mode => ({ id: 'future-replay', nome: 'Motor futuro', modo: mode || 'iframe',
  entrada: 'index.html', script: 'index.js', montagem: ['operacoes', 'analytics'], 'api-host': 1,
  recursos: { replay: 1 } });
const nativeScript = `EC.host.registrar('future-replay', {
  mount(el, ctx) { window.__mountContext = ctx; window.__nativeEvents = []; el.textContent = 'motor de teste'; },
  update(ctx, reason) { window.__nativeEvents.push({ctx, reason}); },
  unmount() { window.__nativeUnmounted = true; }
});`;
async function boot(options = {}) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...args) => errors.push(args.map(String).join(' ')));
  const initial = options.state || { settings: { initialCapital: 1000, currentCapital: 1012 }, operations: [operation()] };
  const dom = new JSDOM(html, {
    url: 'https://edgecontrol.local/edgecontrol-glass-v2.html', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.indexedDB = new IDBFactory(); w.IDBKeyRange = IDBKeyRange; w.TextEncoder = TextEncoder;
      w.Blob = Blob; w.confirm = () => true;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.Chart = class { destroy() {} resize() {} update() {} }; w.Chart.defaults = {};
      w.HTMLCanvasElement.prototype.getContext = function () {
        const noop = () => {};
        return new Proxy({ canvas: this }, { get: (obj, k) => {
          if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
          if (k === 'measureText') return text => ({ width: String(text).length * 8 });
          return obj[k] === undefined ? noop : obj[k];
        }, set: (obj, k, value) => { obj[k] = value; return true; } });
      };
      w.URL.createObjectURL = blob => { w.__capturedBlob = blob; return 'blob:test'; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = () => {};
      w.localStorage.setItem('ec7', JSON.stringify(initial));
      if (options.off) w.localStorage.setItem('ecxOff', '1');
      const response = (data, status = 200) => ({ ok: status === 200, status,
        text: async () => typeof data === 'string' ? data : JSON.stringify(data) });
      w.fetch = async (url) => {
        const name = String(url).replace(/^https:\/\/edgecontrol.local\//, '');
        if (name === 'ferramentas/registro.json') return response({ ferramentas: options.engine ? ['future-replay'] : [] });
        if (name === 'ferramentas/future-replay/ferramenta.json' && options.engine) return response(engineManifest(options.mode));
        if (name === 'ferramentas/future-replay/index.js') {
          if (options.slowScript) return new Promise(resolve => { w.__releaseScript = () => resolve(response(nativeScript)); });
          return response(nativeScript);
        }
        if (name === 'ferramentas/visual-operacoes/ferramenta.json')
          return response(fs.readFileSync(path.join(ROOT, name), 'utf8'));
        return response('', 404);
      };
    }
  });
  await new Promise(resolve => dom.window.document.readyState === 'complete' ? resolve() : dom.window.addEventListener('load', resolve, { once: true }));
  await sleep(80);
  dom.window.__errors = errors;
  return dom.window;
}
function evalJson(w, code) { return JSON.parse(w.eval('JSON.stringify(' + code + ')')); }
function rpc(w, data, source, origin = w.location.origin) {
  w.dispatchEvent(new w.MessageEvent('message', { data, source, origin }));
}
(async () => {
  console.log('\n── Núcleo puro / instante da operação ──');
  await test('UTC preserva segundos e milissegundos, não usa createdAt', () => {
    const c = C.replayBuildContext(baseOperation);
    assert.equal(c.anchorAt, '2026-09-30T12:15:32.123Z');
    assert.equal(c.marker.timeMs, Date.parse(c.anchorAt));
    assert.equal(c.execution.precision, 'millisecond');
    assert.equal(c.startPaused, true); assert.equal(c.settings.hideFuture, true);
    assert.equal(c.range.fromMs, c.anchorMs - 120 * 60000);
    assert.equal(c.range.toMs, c.anchorMs + 30 * 60000);
    assert.equal(c.ready, true); assert.ok(!('candles' in c));
  });
  await test('instante é independente do fuso do computador', () => {
    const probe = `const vm=require('vm');const C=vm.runInNewContext(${JSON.stringify(core + exportsCode)},{Date,TextEncoder});process.stdout.write(C.replayCaptureExecution('2026-09-30','09:15:32.123','-03:00').at);`;
    for (const TZ of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo', 'America/New_York']) {
      assert.equal(execFileSync(process.execPath, ['-e', probe], { env: { ...process.env, TZ } }).toString(), '2026-09-30T12:15:32.123Z');
    }
  });
  await test('offsets fracionários e virada de dia funcionam', () => {
    assert.equal(C.replayCaptureExecution('2026-01-01', '00:00:00.7', '+05:45').at, '2025-12-31T18:15:00.700Z');
    assert.equal(C.replayCaptureExecution('2026-01-01', '23:30', '-03:00').at, '2026-01-02T02:30:00.000Z');
    assert.equal(C.replayOffset('-00:00').text, '+00:00');
  });
  await test('datas, relógio e offsets inválidos são recusados', () => {
    for (const [date, time, offset] of [
      ['2026-02-29', '12:00', '-03:00'], ['2026-04-31', '12:00', '-03:00'],
      ['2026-01-01', '24:00', '-03:00'], ['2026-01-01', '12:60', '-03:00'],
      ['2026-01-01', '12:00:60', '-03:00'], ['2026-01-01', '12:00', '+14:15'],
      ['2026-01-01', '12:00', '-12:01'], ['2026-01-01', '12:00', '-03:99'],
      ['2026-01-01', '12:00:00.1234', '-03:00'], ['', '', '-03:00']
    ]) assert.throws(() => C.replayCaptureExecution(date, time, offset));
    assert.equal(C.replayCaptureExecution('2024-02-29', '12:00', '+00:00').at, '2024-02-29T12:00:00.000Z');
  });
  await test('operações antigas nunca ganham precisão/fuso inventados', () => {
    const old = { ...baseOperation }; delete old.execution;
    const c = C.replayBuildContext(old);
    assert.equal(c.ready, false); assert.equal(c.anchorMs, null); assert.equal(c.marker, null);
    assert.equal(c.issues[0].code, 'unconfirmed-time');
    const minute = C.replayBuildContext(operation('minute', '09:15'));
    assert.equal(minute.execution.precision, 'minute'); assert.equal(minute.warnings.length, 1);
  });
  await test('horário editado pela v1 sem atualizar execution é detectado', () => {
    const c = C.replayBuildContext({ ...baseOperation, time: '10:15:32.123' });
    assert.equal(c.ready, false); assert.equal(c.issues[0].code, 'stale-time');
    assert.equal(C.replayBuildContext({ ...baseOperation, execution: { version: 9 } }).ready, false);
  });
  await test('ajuste do cursor não modifica o marcador/horário original', () => {
    const c = C.replayBuildContext({ ...baseOperation, replay: { offsetMs: -30500, timeframeSeconds: 300, beforeBars: 4, afterBars: 2 } });
    assert.equal(c.anchorAt, '2026-09-30T12:15:01.623Z');
    assert.equal(c.marker.timeMs, Date.parse(baseOperation.execution.at));
    assert.equal(c.range.fromMs, c.anchorMs - 4 * 300000);
    assert.equal(c.range.toMs, c.anchorMs + 2 * 300000);
    assert.equal(baseOperation.execution.at, '2026-09-30T12:15:32.123Z');
  });
  await test('símbolo/provedor explícitos preservam OTC sem mapear fonte errada', () => {
    const c = C.replayBuildContext({ ...baseOperation, asset: 'EUR/USD OTC', replay: { symbol: 'broker:EURUSD_otc', provider: 'minha-corretora' } });
    assert.equal(c.symbol, 'broker:EURUSD_otc'); assert.equal(c.provider, 'minha-corretora');
    const fallback = C.replayBuildContext({ ...baseOperation, asset: 'EUR/USD OTC' });
    assert.equal(fallback.symbol, 'EUR/USD OTC');
    assert.equal(C.replayBuildContext({ ...baseOperation, asset: '' }).ready, false);
  });
  await test('validação dos ajustes limita tamanhos, tipos e valores', () => {
    for (const patch of [{timeframeSeconds:0}, {timeframeSeconds:86401}, {beforeBars:-1}, {afterBars:1001},
      {beforeBars:1.5}, {offsetMs:0.5}, {offsetMs:86400001}, {speed:0}, {speed:17}, {speed:Infinity},
      {hideFuture:1}, {timeframeSeconds:'60'}, {symbol:'x'.repeat(121)}, {provider:null}])
      assert.throws(() => C.replaySettings(patch));
    assert.throws(() => C.replaySettings([])); assert.throws(() => C.replaySettings({version:2}));
    assert.equal(C.replayBuildContext({ ...baseOperation, replay: { timeframeSeconds: -1 } }).ready, false);
  });
  await test('escritas são allowlist; campos da operação/protótipo não podem ser alterados', () => {
    for (const field of ['value', 'result', 'execution', 'date', 'settings', 'version'])
      assert.throws(() => C.replayPatch({}, { [field]: 1 }));
    assert.throws(() => C.replayPatch({}, JSON.parse('{"__proto__":{"polluted":true}}')));
    assert.equal({}.polluted, undefined);
    const current = { chartState: { drawings: [{ x: 1 }] }, timeframeSeconds: 60 };
    const next = C.replayPatch(current, { speed: 2 }); next.chartState.drawings[0].x = 9;
    assert.equal(current.chartState.drawings[0].x, 1);
    assert.equal(C.replayPatch({timeframeSeconds: -1}, {timeframeSeconds: 300}).timeframeSeconds, 300);
  });
  await test('metadados de listas não duplicam snapshots do gráfico', () => {
    const op = {...baseOperation,replay:{chartState:{drawings:[{type:'line',x:10}]}}};
    const summary = C.replaySummary(op);
    assert.equal(summary.ready, true); assert.equal(summary.hasChartState, true);
    assert.equal('chartState' in summary, false); assert.equal('settings' in summary, false);
    assert.equal(C.replayBuildContext(op).settings.chartState.drawings[0].x, 10);
  });
  await test('snapshot é JSON limitado a 64 KiB reais, separado de velas', () => {
    assert.throws(() => C.replayCloneState({text:'é'.repeat(40000)}));
    const cycle = {}; cycle.self = cycle; assert.throws(() => C.replayCloneState(cycle));
    for (const bad of [{a:undefined}, {a:NaN}, {a:() => {}}, ['array'], 'text']) assert.throws(() => C.replayCloneState(bad));
    assert.deepEqual(plain(C.replayCloneState({engine:'futuro',schema:1,drawings:[]})), {engine:'futuro',schema:1,drawings:[]});
  });

  console.log('\n── UI / catálogo / persistência ──');
  const w = await boot(), d = w.document;
  await test('abrir preparação não grava dados; placeholder não se anuncia como replay', () => {
    const before = w.localStorage.getItem('ec7');
    w.eval("nav('operations');openReplayModal('op1')");
    assert.equal(w.localStorage.getItem('ec7'), before);
    assert.equal(d.getElementById('replayLaunchBtn').disabled, true);
    assert.match(d.getElementById('replayPreview').textContent, /Aguardando motor/);
    assert.equal(w.eval('replayTools().length'), 0);
    assert.equal(d.querySelectorAll('.replay-row-btn').length, 1);
  });
  await test('salvar ajustes não altera capital, operação, prints nem instante', () => {
    const before = evalJson(w, 'S.operations[0]'), settings = evalJson(w, 'S.settings');
    d.getElementById('replayTimeframe').value = '300'; d.getElementById('replayOffset').value = '-2.125';
    d.getElementById('replaySymbol').value = 'BROKER:EURUSD'; w.eval('replaySaveModal(false)');
    const op = evalJson(w, 'S.operations[0]');
    assert.equal(op.replay.offsetMs, -2125); assert.equal(op.replay.timeframeSeconds, 300);
    assert.ok(op.replay.updatedAt); delete op.replay;
    assert.deepEqual(op, before); assert.deepEqual(evalJson(w, 'S.settings'), settings);
    assert.equal(JSON.parse(w.localStorage.getItem('ec7')).operations[0].replay.symbol, 'BROKER:EURUSD');
  });
  await test('campo inválido não grava; Padrão não apaga desenhos guardados', () => {
    w.eval("EC.host.salvarReplay({id:'op1',alteracoes:{chartState:{drawings:[{type:'line',x:1}]}}})");
    const saved = w.localStorage.getItem('ec7');
    d.getElementById('replayTimeframe').value = ''; w.eval('replayPreview()');
    assert.equal(d.getElementById('replaySaveBtn').disabled, true);
    assert.equal(w.localStorage.getItem('ec7'), saved);
    w.eval('replayResetDraft();replaySaveModal(false)');
    assert.equal(w.eval('S.operations[0].replay.chartState.drawings.length'), 1);
  });
  await test('quota cheia não deixa replay salvo só em memória', () => {
    const before = evalJson(w, 'S.operations[0]'), stored = w.localStorage.getItem('ec7');
    const original = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    try { assert.throws(() => w.EC.host.salvarReplay({id:'op1',alteracoes:{speed:8}}), /armazenamento/); }
    finally { w.Storage.prototype.setItem = original; }
    assert.deepEqual(evalJson(w, 'S.operations[0]'), before); assert.equal(w.localStorage.getItem('ec7'), stored);
  });
  await test('nova operação captura instante UTC explícito e aceita milissegundos', () => {
    w.eval('closeMod("replayModal");openNewOpModal()');
    const values = {opDate:'2026-09-29',opTime:'23:58:07.456',opUtcOffset:'-03:00',opVal:'10',opRes:'LOSS',opAsset:'GBP/JPY OTC'};
    for (const id in values) d.getElementById(id).value = values[id];
    w.eval('saveOp()');
    const op = evalJson(w, 'S.operations[S.operations.length-1]');
    assert.equal(op.execution.at, '2026-09-30T02:58:07.456Z');
    assert.equal(op.execution.precision, 'millisecond'); assert.equal(op.time, '23:58:07.456');
    assert.notEqual(op.createdAt, op.execution.at);
    assert.equal(w.EC.host.operacoes({filtradas:false}).find(o => o.id === op.id).ts, Date.parse(op.execution.at));
  });
  await test('editar instante recalcula UTC, sem perder ajustes/desenhos', () => {
    w.eval("editOp('op1')"); d.getElementById('opTime').value = '10:00:05.111';
    d.getElementById('opUtcOffset').value = '+02:00'; w.eval('saveOp()');
    const op = evalJson(w, 'S.operations[0]');
    assert.equal(op.execution.at, '2026-09-30T08:00:05.111Z');
    assert.equal(op.replay.chartState.drawings.length, 1);
  });
  await test('exportação/importação existentes preservam execution e replay sem mudar formato', async () => {
    const expected = evalJson(w, 'S.operations');
    await w.exportData();
    const text = await w.__capturedBlob.text(), pack = JSON.parse(text);
    assert.equal(pack.__ec, 3); assert.deepEqual(pack.state.operations, expected);
    w.eval('S.operations=[]');
    await w.importData({ target: {files:[new w.File([text], 'replay-test.json', {type:'application/json'})],value:''} });
    assert.deepEqual(evalJson(w, 'S.operations'), expected);
    assert.equal(w.EC.host.replayAtual(), null);
  });
  await test('UI usa texto escapado para símbolos/notas da operação', () => {
    w.eval(`S.operations[0].asset='<img src=x onerror="window.__xss=1">';openReplayModal('op1')`);
    assert.equal(d.querySelector('#replayTitle img'), null);
    w.eval("openDet('op1')"); assert.equal(d.querySelector('.replay-card img'), null);
    assert.equal(w.__xss, undefined);
  });
  await test('não há erros de JavaScript no uso do catálogo', () => assert.deepEqual(w.__errors, []));
  w.close();
  const legacy = { ...baseOperation }; delete legacy.execution;
  const old = await boot({ state: {operations:[legacy]} });
  await test('legado sem fuso continua editável, mas replay aguarda confirmação', () => {
    old.eval("openReplayModal('op1')"); assert.equal(old.document.getElementById('replayLaunchBtn').disabled, true);
    old.eval("editOp('op1')"); assert.equal(old.document.getElementById('opUtcOffset').value, '');
    old.document.getElementById('opUtcOffset').value = '-03:00'; old.eval('saveOp()');
    assert.equal(old.EC.host.replay({id:'op1'}).ready, true);
  }); old.close();

  console.log('\n── Entrega ao futuro motor / ECX ──');
  const e = await boot({engine:true}), responses = [];
  let frame;
  await test('contexto vai à ferramenta com suporte, não ao painel de saldo', () => {
    const request = e.EC.host.abrirReplay({id:'op1',ferramenta:'future-replay'});
    frame = e.document.querySelector('#ecxHost iframe'); assert.ok(frame);
    frame.contentWindow.postMessage = message => responses.push(message);
    e.eval("ecxQuadroPronto(ECX.tools.find(t=>t.id==='future-replay'))");
    const ready = responses.find(m => m.evt === 'pronto');
    assert.equal(ready.data.replay.requestId, request.requestId);
    assert.equal(responses.find(m => m.evt === 'replay').data.anchorAt, baseOperation.execution.at);
    assert.equal(request.toolId, 'future-replay'); assert.equal(e.EC.host.versao().recursos.replay, 1);
    assert.equal(e.EC.host.operacoes()[0].replay.ready, true);
  });
  await test('replay só aceita versão de capacidade conhecida no manifesto', () => {
    const m = {...engineManifest(),id:'other-engine',recursos:{replay:2}};
    assert.equal(e.eval(`ecxValidar(${JSON.stringify(m)},'other').ok`), false);
    m.recursos.replay = true; assert.equal(e.eval(`ecxValidar(${JSON.stringify(m)},'other').ok`), false);
  });
  await test('RPC de escrita exige origem, quadro montado e identidade verdadeira', async () => {
    const stored = e.localStorage.getItem('ec7');
    rpc(e, {ecx:1,req:1,metodo:'salvarReplay',args:{id:'op1',alteracoes:{speed:2}}}, {postMessage() {}});
    rpc(e, {ecx:1,req:2,metodo:'salvarReplay',args:{id:'op1',alteracoes:{speed:2}}}, frame.contentWindow, 'https://evil.example');
    await sleep(20); assert.equal(e.localStorage.getItem('ec7'), stored);
    const current = e.EC.host.replayAtual();
    rpc(e, {ecx:1,req:3,metodo:'salvarReplay',args:{id:'op1',ferramenta:'spoof',requestId:current.requestId,alteracoes:{speed:2}}}, frame.contentWindow);
    await sleep(20);
    assert.equal(responses.find(m => m.res === 3).ok, true);
    assert.equal(e.EC.host.replay({id:'op1'}).settings.speed, 2);
    rpc(e, {ecx:1,req:4,metodo:'salvarReplay',args:{id:'op1',alteracoes:{value:999}}}, frame.contentWindow);
    await sleep(20); assert.equal(responses.find(m => m.res === 4).ok, false);
    assert.equal(e.eval('S.operations[0].value'), 12);
  });
  await test('pedido substituído/encerrado não pode sobrescrever análise', async () => {
    const previous = e.EC.host.replayAtual();
    const next = e.EC.host.abrirReplay({id:'op1',ferramenta:'future-replay'});
    assert.notEqual(previous.requestId, next.requestId);
    rpc(e, {ecx:1,req:5,metodo:'salvarReplay',args:{id:'op1',requestId:previous.requestId,alteracoes:{speed:4}}}, frame.contentWindow);
    await sleep(20); assert.equal(responses.find(m => m.res === 5).ok, false);
    e.eval("ecxSetView('tabela','operacoes')"); assert.equal(e.EC.host.replayAtual(), null);
    assert.throws(() => e.EC.host.salvarReplay({id:'op1',requestId:next.requestId,alteracoes:{speed:4}}), /expirado/);
  }); e.close();
  const noTiming = await boot({engine:true,state:{operations:[legacy]}});
  await test('sem horário confirmado, nem um motor conectado recebe abertura', () => {
    assert.throws(() => noTiming.EC.host.abrirReplay({id:'op1'}), /fuso/);
    assert.equal(noTiming.EC.host.replayAtual(), null);
  }); noTiming.close();
  const disabled = await boot({engine:true,off:true});
  await test('kill switch do ECX também desliga a abertura de replay', () => {
    assert.throws(() => disabled.EC.host.abrirReplay({id:'op1'}), /desativado/);
    assert.equal(disabled.EC.host.replayAtual(), null);
  }); disabled.close();
  const native = await boot({engine:true,mode:'script'});
  await test('script nativo recebe seleção após montagem assíncrona', async () => {
    const request = native.EC.host.abrirReplay({id:'op1'}); await sleep(40);
    assert.equal(native.__mountContext.replay.requestId, request.requestId);
    assert.ok(native.__nativeEvents.some(x => x.reason === 'replay' && x.ctx.replay.requestId === request.requestId));
    native.eval("nav('dashboard')"); assert.equal(native.EC.host.replayAtual(), null);
    assert.equal(native.__nativeUnmounted, true);
  }); native.close();
  const slow = await boot({engine:true,mode:'script',slowScript:true});
  await test('sair enquanto o script carrega cancela montagem e pedido pendentes', async () => {
    slow.EC.host.abrirReplay({id:'op1'}); await sleep(5);
    assert.equal(typeof slow.__releaseScript, 'function');
    slow.eval("ecxSetView('tabela','operacoes')"); assert.equal(slow.EC.host.replayAtual(), null);
    slow.__releaseScript(); await sleep(30);
    assert.equal(slow.__mountContext, undefined);
    assert.equal(slow.eval("ECX.tools.find(t=>t.id==='future-replay').montado"), false);
    assert.equal(slow.document.querySelector('#ecxHost .ecx-nativo'), null);
  }); slow.close();

  console.log('\n── Ponte e adaptador (sem implementar o motor) ──');
  await test('ponte só aceita respostas e eventos do pai na mesma origem', async () => {
    const win = new JSDOM('', {url:'https://edgecontrol.local/ferramentas/future/index.html',runScripts:'outside-only'}).window;
    const sent = [], parent = {postMessage: m => sent.push(m)};
    Object.defineProperty(win, 'parent', {value:parent}); win.eval(bridge);
    let seen = 0; win.EC.ponte.on('replay', () => seen++);
    rpc(win, {ecx:1,evt:'replay',data:{}}, parent, 'https://evil.example');
    rpc(win, {ecx:1,evt:'replay',data:{}}, {}, win.location.origin);
    assert.equal(seen, 0);
    rpc(win, {ecx:1,evt:'replay',data:{}}, parent); assert.equal(seen, 1);
    const promise = win.EC.ponte.salvarReplay('op1',{speed:2},'r1');
    const req = sent.find(m => m.metodo === 'salvarReplay');
    assert.equal(req.args.requestId, 'r1'); assert.equal(req.args.id, 'op1');
    rpc(win, {ecx:1,res:req.req,ok:true,data:{settings:{speed:2}}}, parent);
    assert.equal((await promise).settings.speed, 2); win.close();
  });
  await test('adaptador deduplica handshake, cancela carregamento antigo e salva por operação', async () => {
    const win = new JSDOM('', {runScripts:'outside-only'}).window;
    const listeners = {}, calls = [], errors = [], saves = []; let resolveQuery, ready;
    const P = {on: (name,fn) => { (listeners[name] ||= []).push(fn); },
      off: (name,fn) => {listeners[name] = (listeners[name] || []).filter(f => f !== fn);},
      pronto: fn => {ready = fn;}, replayAtual: () => new Promise(resolve => {resolveQuery = resolve;}),
      salvarReplay: (id,patch,requestId) => {saves.push({id,patch,requestId});return Promise.resolve({settings:{speed:2}});} };
    win.EC = {ponte:P}; win.eval(sdk);
    const adapter = win.EC.replay.conectar({ferramenta:'future-replay',abrir:(r,ctx) => {calls.push({r,ctx});},erro:e => errors.push(e.message)});
    const request = {...plain(C.replayBuildContext(baseOperation)),requestId:'r1',toolId:'future-replay'};
    ready({replay:request}); listeners.replay[0](request); await sleep(5);
    assert.equal(calls.length, 1);
    listeners.replay[0]({...request,requestId:'r2'}); await sleep(5);
    assert.equal(calls.length, 2); assert.equal(calls[0].ctx.signal.aborted, true); assert.equal(calls[0].ctx.atual(), false);
    resolveQuery(request); await sleep(5); assert.equal(calls.length, 2);
    const copy = adapter.pedido(); copy.settings.speed = 999; assert.notEqual(adapter.pedido().settings.speed, 999);
    await adapter.salvar({chartState:{drawings:[]}}); assert.equal(saves[0].id, 'op1'); assert.equal(saves[0].requestId, 'r2');
    listeners['replay-cancel'][0]({requestId:'r2',toolId:'future-replay'});
    assert.equal(adapter.pedido(), null); assert.equal(calls[1].ctx.signal.aborted, true);
    adapter.destruir(); assert.equal(listeners.replay.length, 0); assert.equal(errors.length, 0);
    await assert.rejects(adapter.salvar({speed:1}), /ativo/); win.close();
  });
  await test('cancelamento antes da consulta inicial não ressuscita pedido antigo', async () => {
    const win = new JSDOM('', {runScripts:'outside-only'}).window;
    const listeners = {}; let resolve, opens = 0;
    win.EC = {ponte:{on:(k,f) => {listeners[k]=f;},off:() => {},pronto:() => {},
      replayAtual:() => new Promise(r => {resolve=r;}),salvarReplay:() => Promise.resolve({})}};
    win.eval(sdk);
    const adapter = win.EC.replay.conectar({ferramenta:'future-replay',abrir:() => {opens++;}});
    listeners['replay-cancel']({requestId:'r1',toolId:'future-replay'});
    resolve({...plain(C.replayBuildContext(baseOperation)),requestId:'r1',toolId:'future-replay'}); await sleep(5);
    assert.equal(opens, 0); adapter.destruir(); win.close();
  });
  await test('arquivos históricos e backups não foram incorporados ao novo código', () => {
    const v1 = fs.readFileSync(path.join(ROOT,'edgecontrol-glass.html'),'utf8');
    assert.equal(v1.includes('REPLAY-CORE-START'), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT,'ferramentas/visual-operacoes/ferramenta.json'),'utf8'));
    assert.equal(manifest.recursos && manifest.recursos.replay, undefined);
    new vm.Script(sdk); new vm.Script(bridge);
  });
  console.log(fails ? `\n❌ ${fails} FALHA(S) em replay` : `\n🎉 REPLAY OK — ${checks} grupos de verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
