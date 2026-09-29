/* ------------------------------------------------------------------
   Testes do ECX — hospedeiro de ferramentas externas (pasta /ferramentas)
   de edgecontrol-glass-v2.html.

   Três camadas:
     1. estrutura  — a v1 continua intacta, a v2 traz o hospedeiro completo
                     (abas, slot, modal, kill switch, sandbox, @media print)
                     e a pasta /ferramentas é coerente (manifestos válidos,
                     ponte compila, modelo não é carregado).
     2. integração — o app inteiro em jsdom: sem a pasta nada muda; com a
                     pasta a aba aparece; iframe e script montam; o RPC por
                     postMessage responde e ignora origem estranha; o kill
                     switch desliga tudo; manifesto inválido é recusado;
                     hooks emitem eventos sem alterar o comportamento.
     3. contrato   — a matemática da série (saldo acumulado, velas diárias,
                     resumo, drawdown, sequências) conferida contra um
                     cálculo independente feito aqui no teste.

   Rodar:  npm run test:ecx   (ou: node tests/test-extensions.js)
   Requer: npm install  (jsdom, fake-indexeddb)
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'edgecontrol-glass-v2.html');
const V1 = path.join(ROOT, 'edgecontrol-glass.html');
const FERR = path.join(ROOT, 'ferramentas');
const FIXTURE = path.join(ROOT, 'edgecontrol_2026-09-17 (1).json');

const srcV2 = fs.readFileSync(V2, 'utf8');
const srcV1 = fs.readFileSync(V1, 'utf8');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};
const eq = (a, b, msg) => {
  const same = (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) < 1e-6 : a === b;
  ok(same, msg, same ? (typeof a === 'number' ? String(a) : '') : `=> ${JSON.stringify(a)} esperado ${JSON.stringify(b)}`);
};
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg, `${(+a).toFixed(4)} ≈ ${(+b).toFixed(4)}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ══════════════════════════════════════════════════════════════════
   1. ESTRUTURA
══════════════════════════════════════════════════════════════════ */
console.log('\n── 1. estrutura (v1 intacta, hospedeiro completo) ──');
/* marcadores com . ( ) - : não aparecem dentro de base64 (que só tem A-Za-z0-9+/=) */
ok(srcV1.indexOf('ecxInit(') < 0 && srcV1.indexOf('ECX_ROOT') < 0 && srcV1.indexOf('EC.host') < 0
  && srcV1.indexOf('ecx-slot') < 0 && srcV1.indexOf('ferramentas/') < 0,
  'v1 não recebeu nada do hospedeiro');
ok(srcV1.indexOf("EC_BUILD='2026-09-18.3-ticker'") > 0, 'v1 mantém o build antigo');
ok(srcV2.indexOf("EC_BUILD='2026-09-29.3-ecx-hospedeiro-v2'") > 0, 'v2 tem o build do hospedeiro');

['id="ecxTabs"', 'id="ecxSlot"', 'id="ecxHost"', 'id="ecxMod"', 'id="ecxLista"', 'id="ecxStatus"'].forEach(id =>
  ok(srcV2.indexOf(id) > 0, `v2 tem ${id}`));
ok(srcV2.indexOf('<div class="ecx-tabs" id="ecxTabs" hidden></div>') > 0, 'as abas nascem escondidas');
ok(srcV2.indexOf('<div class="ecx-slot" id="ecxSlot" hidden>') > 0, 'o slot de montagem nasce escondido');
ok(srcV2.indexOf('<div class="ops-tbl">') > srcV2.indexOf('id="ecxSlot"'),
  'o slot fica ANTES da tabela de operações');
ok(srcV2.indexOf('id="ecxTabs"') > srcV2.indexOf('id="page-operations"'),
  'as abas ficam dentro da página Operações');

ok(srcV2.indexOf("const ECX_ROOT='ferramentas/'") > 0, 'raiz das ferramentas declarada');
ok(srcV2.indexOf('async function ecxInit()') > 0, 'existe ecxInit()');
ok(srcV2.indexOf('  ecxInit();\n}') > 0, 'ecxInit() é chamado no fim do init()');
ok(srcV2.indexOf('maybeLoadDemoData();') < srcV2.indexOf('ecxInit();'),
  'o hospedeiro entra por último (não atrasa a abertura do app)');
ok(srcV2.indexOf('/[?&]ecx=0(&|$)/') > 0 && srcV2.indexOf("localStorage.getItem('ecxOff')==='1'") > 0,
  'kill switch por URL e por localStorage');
ok(srcV2.indexOf("allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-pointer-lock") > 0,
  'iframe com sandbox explícito');
ok(srcV2.indexOf('if(ev.origin&&ev.origin!==location.origin) return;') > 0,
  'postMessage só aceita a mesma origem');
ok(srcV2.indexOf('@media print{.ecx-tabs,.ecx-slot{display:none!important;}}') > 0,
  'as abas/painel não saem na impressão');
ok(srcV2.indexOf("cache:'no-cache'") > 0 && srcV2.indexOf("cache:'no-store'") < 0,
  'fetch pede no-cache (compatível com o Cache Storage do service worker)');
ok(srcV2.indexOf('function ecxHooks()') > 0 && srcV2.indexOf('original.apply(this,arguments)') > 0,
  'hooks embrulham as funções existentes sem reescrevê-las');
ok(srcV2.indexOf('__ecx') > 0, 'hook marcado para não ser embrulhado duas vezes');
ok(srcV2.indexOf('window.EC.host=ecxPonte()') > 0, 'ponte publicada em window.EC.host');
{
  const dup = {};
  const appJs = srcV2.split('<script>').pop().split('</script>')[0];
  new vm.Script(appJs, { filename: 'edgecontrol-v2.js' });
  ok(true, 'o script da v2 continua compilando');
  appJs.replace(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm, (_, n) => { dup[n] = (dup[n] || 0) + 1; return _; });
  const dups = Object.keys(dup).filter(k => dup[k] > 1);
  eq(dups.length, 0, 'nenhuma função duplicada (o hospedeiro não sobrescreveu nada)', dups.join(','));
  const ecx = Object.keys(dup).filter(k => /^ecx/.test(k));
  ok(ecx.length >= 20, 'funções do hospedeiro presentes', `${ecx.length} ecx*`);
}
{
  const css = srcV2.split('<style>')[1].split('</style>')[0];
  ok(css.indexOf('.ecx-tab.on{') > 0 && css.indexOf('.ecx-frame{') > 0, 'CSS do hospedeiro presente');
  eq(css.split('{').length, css.split('}').length, 'CSS continua balanceado');
}

/* ── pasta ferramentas coerente ── */
console.log('\n── 1b. pasta ferramentas/ ──');
['LEIA-ME.md', 'registro.json', 'ferramenta.schema.json', 'ponte.js'].forEach(f =>
  ok(fs.existsSync(path.join(FERR, f)), `existe ferramentas/${f}`));
const registro = JSON.parse(fs.readFileSync(path.join(FERR, 'registro.json'), 'utf8'));
eq(registro.versao, 1, 'registro.json versionado');
const pastas = (registro.ferramentas || []).map(f => f.pasta || f);
ok(pastas.indexOf('visual-operacoes') >= 0, 'a pasta reservada está no registro', pastas.join(','));
ok(pastas.indexOf('_modelo') < 0, 'o modelo NÃO está no registro (não é carregado)');
new vm.Script(fs.readFileSync(path.join(FERR, 'ponte.js'), 'utf8'), { filename: 'ponte.js' });
ok(true, 'ponte.js compila');
{
  const m = JSON.parse(fs.readFileSync(path.join(FERR, 'visual-operacoes', 'ferramenta.json'), 'utf8'));
  eq(m.id, 'visual-operacoes', 'manifesto da pasta reservada: id');
  eq(m.modo, 'iframe', 'modo padrão é iframe (isolamento total)');
  eq(m.entrada, 'index.html', 'entrada do iframe');
  eq(m.montagem, 'operacoes', 'montagem na página Operações');
  eq(m['api-host'], 1, 'api-host compatível');
  const html = fs.readFileSync(path.join(FERR, 'visual-operacoes', 'index.html'), 'utf8');
  ok(html.indexOf('<script src="../ponte.js"></script>') > 0, 'o painel de referência inclui a ponte');
  ok(html.indexOf('window.EC.ponte') > 0 && /P\.pronto\(/.test(html),
    'o painel usa a ponte (EC.ponte + pronto)');
  ok(/P\.serie\(\)/.test(html) && /P\.on\(/.test(html)
    && /'dados'/.test(html) && /'tema'/.test(html) && /'filtro'/.test(html),
    'o painel pede a série e assina dados/tema/filtro');
  ok(/P\.abrirPrint\(/.test(html) && /P\.abrirOperacao\(/.test(html),
    'o painel navega no app (abrir print / abrir operação)');
  ok(fs.existsSync(path.join(FERR, 'visual-operacoes', 'estilo.css')), 'estilo do painel existe');
}
{
  const m = JSON.parse(fs.readFileSync(path.join(FERR, '_modelo', 'ferramenta.json'), 'utf8'));
  eq(m.modo, 'script', 'modelo é modo script');
  eq(m.ativa, false, 'modelo nasce desativado');
  const js = fs.readFileSync(path.join(FERR, '_modelo', 'index.js'), 'utf8');
  new vm.Script(js, { filename: '_modelo/index.js' });
  ok(true, 'index.js do modelo compila');
  ok(js.indexOf("EC.host.registrar(ID,{") > 0 || js.indexOf('host.registrar(ID, {') > 0,
    'o modelo se registra pelo EC.host.registrar');
  const css = fs.readFileSync(path.join(FERR, '_modelo', 'estilo.css'), 'utf8');
  const soltos = css.split('\n').filter(l => /^[a-z]+\{|^\*|^\./.test(l) && !/^\./.test(l));
  eq(soltos.length, 0, 'CSS do modelo não tem seletor solto (tudo prefixado)', soltos.join(' | '));
}

/* ══════════════════════════════════════════════════════════════════
   2. INTEGRAÇÃO EM JSDOM
══════════════════════════════════════════════════════════════════ */
let JSDOM, VirtualConsole, IDBFactory, IDBKeyRange;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
  ({ IDBFactory, IDBKeyRange } = require('fake-indexeddb'));
} catch (e) {
  console.log('\n⚠️  jsdom/fake-indexeddb não instalados — pulando integração (npm install).');
  console.log(fails ? `\n💥 ${fails} FALHA(S)` : '\n🎉 ECX OK (estrutura)');
  process.exit(fails ? 1 : 0);
}

/* fetch que serve a pasta ferramentas/ do disco, com sobrescritas por teste */
function fetchStub(sobrescrever) {
  const over = sobrescrever || {};
  return async function fetch(url) {
    const u = String(url);
    const rel = decodeURIComponent(u.replace(/^https?:\/\/[^/]+\//, '').split('?')[0]);
    if (Object.prototype.hasOwnProperty.call(over, rel)) {
      const v = over[rel];
      if (v === 404) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => v };
    }
    if (!/^ferramentas\//.test(rel)) return { ok: false, status: 404, text: async () => '' };
    const abs = path.join(ROOT, rel);
    if (!abs.startsWith(FERR)) return { ok: false, status: 403, text: async () => '' };
    try { return { ok: true, status: 200, text: async () => fs.readFileSync(abs, 'utf8') }; }
    catch (e) { return { ok: false, status: 404, text: async () => '' }; }
  };
}

/* simula a pasta ferramentas/ ausente: tudo 404 */
function fetch404() {
  return async function fetch() { return { ok: false, status: 404, text: async () => '' }; };
}

function boot(opts) {
  const o = opts || {};
  const idb = o.idb || new IDBFactory();
  const win = new JSDOM(srcV2, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: o.url || 'https://edgecontrol.local/',
    virtualConsole: o.console || new VirtualConsole(),
    beforeParse(w) {
      w.confirm = () => true;
      w.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } });
      w.indexedDB = idb;
      w.IDBKeyRange = IDBKeyRange;
      w.TextEncoder = TextEncoder;
      w.Blob = Blob;
      w.URL.createObjectURL = () => 'blob:mock-' + Math.random();
      w.URL.revokeObjectURL = () => { };
      w.fetch = o.fetch === undefined ? fetchStub() : o.fetch;
      if (o.storage) Object.keys(o.storage).forEach(k => w.localStorage.setItem(k, o.storage[k]));
      w.HTMLCanvasElement.prototype.getContext = function () {
        const noop = () => { };
        return new Proxy({ canvas: this }, {
          get: (t, k) => (k === 'measureText' ? (s => ({ width: String(s || '').length * 8 }))
            : (k === 'createLinearGradient' ? (() => ({ addColorStop: noop })) : (t[k] !== undefined ? t[k] : noop))),
          set: (t, k, v) => { t[k] = v; return true; },
          has: () => true
        });
      };
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,QUJD';
      w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(['x'], { type: 'image/png' })); };
      w.Image = class {
        constructor() { this.naturalWidth = 1200; this.naturalHeight = 800; this.width = 1200; this.height = 800; this.complete = true; }
        set src(v) { this._src = v; setTimeout(() => { if (typeof this.onload === 'function') this.onload(); }, 0); }
        get src() { return this._src; }
        addEventListener(t, f) { if (t === 'load') setTimeout(f, 0); }
      };
      w.Chart = class { constructor(c, cfg) { this.config = cfg || {}; } destroy() { } update() { } resize() { } reset() { } };
      w.Chart.defaults = {};
      if (w.File) w.File.prototype.text = undefined;
      {
        const orig = w.FileReader.prototype.readAsDataURL;
        w.FileReader.prototype.readAsDataURL = function (blob) {
          try { return orig.call(this, blob); }
          catch (e) {
            blob.arrayBuffer().then(buf => {
              Object.defineProperty(this, 'result', { value: 'data:application/json;base64,' + Buffer.from(buf).toString('base64'), configurable: true });
              if (typeof this.onload === 'function') this.onload({ target: this });
            }, () => { if (typeof this.onerror === 'function') this.onerror({ target: this }); });
          }
        };
      }
    }
  }).window;
  return { win: win, idb };
}
async function runImport(w, backup) {
  const txt = typeof backup === 'string' ? backup : JSON.stringify(backup);
  const file = new w.File([txt], 'backup.json', { type: 'application/json' });
  w.__ev = { target: { files: [file], value: '' } };
  await w.eval('(async()=>{ await importData(window.__ev); })()');
}
function mensagem(w, data, origin, source) {
  const ev = new w.MessageEvent('message', { data: data, origin: origin || w.location.origin });
  if (source) Object.defineProperty(ev, 'source', { value: source });
  w.dispatchEvent(ev);
}

(async () => {
  console.log('\n── 2. integração (jsdom) ──');

  /* ── A. SEM a pasta ferramentas: o app é o mesmo de antes ── */
  const bA = boot({ fetch: fetch404() });             /* nenhuma ferramenta no disco */
  const wA = bA.win;
  await sleep(420);
  eq(wA.eval('ECX.tools.length'), 0, 'sem a pasta, nenhuma ferramenta registrada');
  eq(wA.eval('ECX.off'), false, 'hospedeiro ligado (só não achou nada)');
  eq(wA.eval('ECX.errors.length'), 0, 'pasta ausente NÃO gera erro (404 é o caso normal)');
  eq(wA.document.getElementById('ecxTabs').hidden, true, 'as abas continuam escondidas');
  eq(wA.document.getElementById('ecxSlot').hidden, true, 'o slot continua escondido');
  eq(wA.eval('typeof EC.host.serie'), 'function', 'a ponte existe mesmo sem ferramenta');
  eq(wA.eval('EC.host.versao().api'), 1, 'EC.host.versao() responde');
  await runImport(wA, fs.readFileSync(FIXTURE, 'utf8'));
  await sleep(260);
  await wA.eval("nav('operations',document.getElementById('navOps'))");
  await sleep(120);
  eq(wA.document.querySelectorAll('#opsTb tr').length, 51, 'a tabela de operações continua com 51 linhas');
  eq(wA.document.querySelector('#page-operations .ops-tbl').style.display, '',
    'e continua visível (nenhum estilo herdado do hospedeiro)');

  /* ── B. COM a pasta: aba aparece, montagem preguiçosa ── */
  const bReal = boot({});                  /* fetch padrão: serve a pasta real do disco */
  const wR = bReal.win;
  await sleep(420);
  eq(wR.eval('ECX.tools.length'), 1, 'a ferramenta da pasta reservada é registrada');
  eq(wR.eval('ECX.tools[0].id'), 'visual-operacoes', 'id lido do manifesto');
  eq(wR.eval('ECX.tools[0].modo'), 'iframe', 'modo lido do manifesto');
  eq(wR.eval('ECX.tools[0].entrada'), 'ferramentas/visual-operacoes/index.html', 'caminho da entrada montado');
  eq(wR.document.getElementById('ecxTabs').hidden, false, 'as abas aparecem');
  ok(/Análise gráfica/.test(wR.document.getElementById('ecxTabs').textContent), 'a aba usa o rótulo do manifesto');
  eq(wR.eval('ECX.view'), 'tabela', 'a visão inicial continua sendo a tabela');
  eq(wR.document.getElementById('ecxSlot').hidden, true, 'e nada foi montado ainda (montagem preguiçosa)');

  await runImport(wR, fs.readFileSync(FIXTURE, 'utf8'));
  await sleep(280);
  await wR.eval("nav('operations',document.getElementById('navOps'))");
  await sleep(120);
  eq(wR.document.querySelectorAll('#opsTb tr').length, 51, 'tabela ok antes de abrir a ferramenta');

  /* abre a aba → iframe */
  await wR.eval("ecxSetView('visual-operacoes')");
  await sleep(160);
  eq(wR.eval('ECX.view'), 'visual-operacoes', 'a visão trocou');
  eq(wR.document.getElementById('ecxSlot').hidden, false, 'o slot aparece');
  eq(wR.document.querySelector('#page-operations .ops-tbl').style.display, 'none', 'a tabela é escondida (não destruída)');
  const frame = wR.document.querySelector('#ecxHost iframe.ecx-frame');
  ok(!!frame, 'um iframe foi criado no slot');
  ok(frame && /ferramentas\/visual-operacoes\/index\.html$/.test(frame.getAttribute('src')), 'src aponta para a pasta da ferramenta', frame && frame.getAttribute('src'));
  ok(frame && /allow-scripts/.test(frame.getAttribute('sandbox')), 'iframe com sandbox');
  eq(wR.eval("ECX.tools[0].montado"), true, 'ferramenta marcada como montada');
  eq(wR.document.querySelectorAll('#opsTb tr').length, 51, 'a tabela continua no DOM (só escondida)');

  /* ── C. RPC por postMessage ── */
  const respostas = [];
  const fonte = { postMessage: m => respostas.push(m) };
  mensagem(wR, { ecx: 1, req: 7, metodo: 'serie' }, wR.location.origin, fonte);
  await sleep(140);
  eq(respostas.length, 1, 'o hospedeiro respondeu ao RPC');
  eq(respostas[0] && respostas[0].ok, true, 'resposta ok');
  eq(respostas[0] && respostas[0].res, 7, 'resposta traz o id do pedido');
  const serieRpc = respostas[0] && respostas[0].data;
  ok(serieRpc && serieRpc.operacoes && serieRpc.operacoes.length === 51, 'a série veio com as 51 operações', serieRpc && serieRpc.operacoes.length);
  ok(serieRpc && serieRpc.resumo && typeof serieRpc.resumo.taxa === 'number', 'e com o resumo calculado');
  mensagem(wR, { ecx: 1, req: 8, metodo: 'naoExiste' }, wR.location.origin, fonte);
  await sleep(120);
  eq(respostas.length, 2, 'método desconhecido também responde');
  eq(respostas[1].ok, false, 'com erro, sem quebrar o app');
  ok(/desconhecido/.test(respostas[1].erro || ''), 'mensagem de erro explicando', respostas[1].erro);
  const antesEstranha = respostas.length;
  mensagem(wR, { ecx: 1, req: 9, metodo: 'serie' }, 'https://origem-estranha.example', fonte);
  await sleep(120);
  eq(respostas.length, antesEstranha, '🔒 mensagem de outra origem é ignorada');
  mensagem(wR, { foo: 1 }, wR.location.origin, fonte);
  await sleep(80);
  eq(respostas.length, antesEstranha, 'mensagem que não é do ECX é ignorada');

  /* ── D. eventos, hooks e desmontagem ao sair da página ── */
  await wR.eval("window.__evts=[]; ['dados','filtro','tema','pagina','tabela'].forEach(e=>EC.host.on(e,d=>window.__evts.push(e)));");
  await wR.eval('save()');
  await sleep(120);
  ok(wR.eval('window.__evts').indexOf('dados') >= 0, 'save() do app emite "dados" para a ferramenta');
  await wR.eval("applyTheme('graphite')");
  await sleep(120);
  ok(wR.eval('window.__evts').indexOf('tema') >= 0, 'trocar o tema emite "tema"');
  eq(wR.eval('EC.host.tema().id'), 'graphite', 'tema() devolve o tema em uso');
  ok(wR.eval('EC.host.tema().cores').hasOwnProperty('acento'), 'com as cores CSS resolvidas');
  await wR.eval('applyFilter()');
  await sleep(120);
  ok(wR.eval('window.__evts').indexOf('filtro') >= 0, 'filtrar emite "filtro"');
  eq(wR.eval('ECX.hooks.indexOf("renderOps") >= 0'), true, 'renderOps foi embrulhado (não reescrito)');
  eq(wR.eval('typeof renderOps'), 'function', 'e continua sendo uma função do app');
  await wR.eval("nav('dashboard',document.querySelector('.nav-item'))");
  await sleep(140);
  eq(wR.eval('ECX.view'), 'tabela', 'sair de Operações volta para a tabela');
  eq(wR.document.getElementById('ecxSlot').hidden, true, 'o slot some');
  ok(!wR.document.querySelector('#ecxHost iframe'), 'e o iframe é removido');

  /* ── E. storage privativo não encosta nas chaves do app ── */
  await wR.eval("EC.host.guardar({ferramenta:'visual-operacoes',chave:'layout',valor:{colunas:3}})");
  eq(wR.eval("localStorage.getItem('ecx:visual-operacoes:layout')"), '{"colunas":3}', 'guardar() escreve no namespace da ferramenta');
  eq(wR.eval("EC.host.ler({ferramenta:'visual-operacoes',chave:'layout'}).colunas"), 3, 'ler() devolve o valor');
  eq(wR.eval("EC.host.ler({ferramenta:'visual-operacoes',chave:'inexistente',padrao:42})"), 42, 'ler() com padrão');
  ok(wR.eval("!!localStorage.getItem('ec7')"), 'a chave principal do app continua lá, intacta');

  /* ── F. kill switch ── */
  const wK = boot({ storage: { ecxOff: '1' } }).win;
  await sleep(400);
  eq(wK.eval('ECX.off'), true, 'localStorage.ecxOff=1 desliga o hospedeiro');
  eq(wK.eval('ECX.tools.length'), 0, 'nada é carregado');
  eq(wK.document.getElementById('ecxTabs').hidden, true, 'as abas não aparecem');
  await runImport(wK, fs.readFileSync(FIXTURE, 'utf8'));
  await sleep(240);
  await wK.eval("nav('operations',document.getElementById('navOps'))");
  await sleep(120);
  eq(wK.document.querySelectorAll('#opsTb tr').length, 51, 'o app segue 100% funcional com o hospedeiro desligado');
  wK.close();
  const wU = boot({ url: 'https://edgecontrol.local/?ecx=0' }).win;
  await sleep(380);
  eq(wU.eval('ECX.off'), true, '?ecx=0 também desliga');
  wU.close();

  /* ── G. manifesto inválido é recusado sem estragar nada ── */
  const wM = boot({
    fetch: fetchStub({
      'ferramentas/registro.json': JSON.stringify({ versao: 1, ferramentas: [{ pasta: 'ruim' }, { pasta: 'sem-modo' }, { pasta: 'api-futura' }] }),
      'ferramentas/ruim/ferramenta.json': '{ isto não é json',
      'ferramentas/sem-modo/ferramenta.json': JSON.stringify({ id: 'sem-modo', modo: 'telepatia' }),
      'ferramentas/api-futura/ferramenta.json': JSON.stringify({ id: 'api-futura', modo: 'iframe', entrada: 'i.html', 'api-host': 99 }),
      'ferramentas/visual-operacoes/ferramenta.json': 404   /* isola o cenário */
    })
  }).win;
  await sleep(420);
  eq(wM.eval('ECX.tools.length'), 0, 'nenhuma ferramenta inválida entra');
  const erros = wM.eval('ECX.errors.map(e=>e.msg+" | "+e.det)');
  ok(erros.some(e => /ruim/.test(e)), 'JSON quebrado é reportado', erros.join(' ;; '));
  ok(erros.some(e => /modo/.test(e)), 'modo inválido é reportado');
  ok(erros.some(e => /API 99/.test(e)), 'api-host acima do app é recusado');
  eq(wM.document.getElementById('ecxTabs').hidden, true, 'as abas não aparecem para ferramenta inválida');
  await runImport(wM, fs.readFileSync(FIXTURE, 'utf8'));
  await sleep(240);
  await wM.eval("nav('operations',document.getElementById('navOps'))");
  await sleep(120);
  eq(wM.document.querySelectorAll('#opsTb tr').length, 51, 'e o app continua funcionando normalmente');
  wM.close();

  /* ── H. modo script: mount/update/unmount ── */
  const SCRIPT_JS = `(function(){
    window.__log=[];
    EC.host.registrar('teste-script',{
      mount(el,ctx){ el.innerHTML='<div class="tx">montado api '+ctx.api+'</div>'; window.__log.push('mount'); },
      update(ctx,motivo){ window.__log.push('update:'+motivo); },
      unmount(){ window.__log.push('unmount'); }
    });
  })();`;
  const wS = boot({
    fetch: fetchStub({
      'ferramentas/registro.json': JSON.stringify({ versao: 1, ferramentas: ['teste-script'] }),
      'ferramentas/teste-script/ferramenta.json': JSON.stringify({
        id: 'teste-script', nome: 'Teste Script', versao: '1.2.3', icone: '🧪',
        modo: 'script', script: 'index.js', estilo: 'estilo.css', montagem: 'operacoes'
      }),
      'ferramentas/teste-script/index.js': SCRIPT_JS,
      'ferramentas/teste-script/estilo.css': '.tx{color:#f00}',
      'ferramentas/visual-operacoes/ferramenta.json': 404   /* isola o cenário */
    })
  }).win;
  await sleep(420);
  eq(wS.eval('ECX.tools.length'), 1, 'ferramenta em modo script registrada');
  eq(wS.eval('ECX.tools[0].modo'), 'script', 'modo script');
  eq(wS.eval('window.__log'), undefined, 'o script NÃO executa na abertura (montagem preguiçosa)');
  await wS.eval("nav('operations',document.getElementById('navOps'))");
  await sleep(120);
  await wS.eval("ecxSetView('teste-script')");
  await sleep(220);
  eq(wS.eval('window.__log').join(','), 'mount', 'mount() rodou UMA vez ao abrir a aba');
  ok(/montado api 1/.test(wS.document.getElementById('ecxHost').textContent), 'o conteúdo montado está no slot');
  ok(!!wS.document.getElementById('ecxCss_teste-script'), 'o CSS da ferramenta foi linkado');
  await wS.eval('save()');
  await sleep(160);
  ok(/update:dados/.test(wS.eval('window.__log').join(',')), 'save() do app chama update() da ferramenta', wS.eval('window.__log').join(','));
  await wS.eval("ecxSetView('tabela')");
  await sleep(140);
  ok(/unmount/.test(wS.eval('window.__log').join(',')), 'voltar para a tabela chama unmount()');
  eq(wS.document.getElementById('ecxHost').childElementCount, 0, 'o slot é esvaziado');
  wS.close();

  /* ── I. contrato de dados: a matemática da série ── */
  console.log('\n── 3. contrato de dados (série × cálculo independente) ──');
  const pack = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const raw = pack.state.operations;
  const w = wA;   /* janela A já tem o backup importado */
  const ini = w.eval('S.settings.initialCapital');
  const ordenadas = [...raw].sort((a, b) => {
    const x = (a.date || '') + ' ' + (a.time || '') + ' ' + (a.createdAt || '');
    const y = (b.date || '') + ' ' + (b.time || '') + ' ' + (b.createdAt || '');
    return x < y ? -1 : x > y ? 1 : 0;
  });
  let saldo = ini;
  const efeitos = ordenadas.map(o => {
    const v = Number(o.value) || 0;
    const r = String(o.result || '').toUpperCase();
    const e = r === 'WIN' ? v : (r === 'LOSS' ? -v : 0);
    saldo += e;
    return e;
  });
  const saldoFinal = saldo;
  const wins = ordenadas.filter(o => String(o.result || '').toUpperCase() === 'WIN').length;
  const losses = ordenadas.filter(o => String(o.result || '').toUpperCase() === 'LOSS').length;
  const brutoWin = ordenadas.filter(o => String(o.result || '').toUpperCase() === 'WIN').reduce((a, o) => a + (Number(o.value) || 0), 0);
  const brutoLoss = ordenadas.filter(o => String(o.result || '').toUpperCase() === 'LOSS').reduce((a, o) => a + (Number(o.value) || 0), 0);
  const dias = [...new Set(ordenadas.map(o => o.date))];
  let pico = ini, dd = 0, cor = ini;
  efeitos.forEach(e => { cor += e; if (cor > pico) pico = cor; if (pico - cor > dd) dd = pico - cor; });
  /* sequência final */
  let ant = '', corrida = 0;
  ordenadas.forEach(o => {
    const r = String(o.result || '').toUpperCase();
    if (r !== 'WIN' && r !== 'LOSS') return;
    if (r === ant) corrida++; else { ant = r; corrida = 1; }
  });

  const s = w.eval('(window.__s = EC.host.serie(), window.__s)');
  eq(s.operacoes.length, ordenadas.length, 'a série tem todas as operações');
  eq(s.resumo.n, ordenadas.length, 'resumo.n');
  eq(s.resumo.wins, wins, 'resumo.wins');
  eq(s.resumo.losses, losses, 'resumo.losses');
  eq(s.capitalInicial, ini, 'capital inicial vem das configurações');
  near(s.resumo.resultado, efeitos.reduce((a, b) => a + b, 0), 1e-6, 'resultado = soma dos efeitos com sinal');
  near(s.resumo.saldoFinal, saldoFinal, 1e-6, 'saldo final bate com o cálculo independente');
  near(s.resumo.taxa, wins / (wins + losses), 1e-9, 'taxa de acerto');
  near(s.resumo.brutoWin, brutoWin, 1e-6, 'brutoWin');
  near(s.resumo.brutoLoss, brutoLoss, 1e-6, 'brutoLoss');
  near(s.resumo.fatorLucro, brutoLoss > 0 ? brutoWin / brutoLoss : 0, 1e-6, 'fator de lucro');
  near(s.resumo.drawdown, dd, 1e-6, 'drawdown máximo');
  eq(s.resumo.sequenciaAtual, corrida, 'sequência atual');
  eq(s.resumo.sequenciaTipo, ant, 'tipo da sequência atual');
  eq(s.resumo.diasDistintos, dias.length, 'dias distintos');
  /* equity */
  eq(s.equity.length, ordenadas.length + 1, 'equity tem o ponto inicial + um por operação');
  near(s.equity[0].saldo, ini, 1e-9, 'equity começa no capital inicial');
  near(s.equity[s.equity.length - 1].saldo, saldoFinal, 1e-6, 'equity termina no saldo final');
  {
    let ref = ini, tudoOk = true;
    s.equity.slice(1).forEach((p, i) => { ref += efeitos[i]; if (Math.abs(p.saldo - ref) > 1e-6) tudoOk = false; });
    ok(tudoOk, 'cada ponto do equity é o saldo acumulado até ali');
  }
  /* operações normalizadas */
  {
    const op = s.operacoes[0];
    eq(op.id, String(ordenadas[0].id), 'id preservado');
    eq(op.data, ordenadas[0].date, 'data preservada');
    eq(op.hora, ordenadas[0].time, 'hora preservada');
    eq(op.ativo, ordenadas[0].asset || '', 'ativo normalizado');
    eq(op.resultado, String(ordenadas[0].result || '').toUpperCase(), 'resultado em caixa alta');
    ok(op.valor >= 0, 'valor é a magnitude (sempre positiva)', String(op.valor));
    eq(op.efeito, efeitos[0], 'efeito já vem com sinal');
    near(op.saldo, ini + efeitos[0], 1e-6, 'saldo acumulado na própria operação');
    ok(Number.isFinite(op.ts) && op.ts > 0, 'ts (epoch ms) calculado de data+hora');
    ok(Array.isArray(op.prints), 'lista de prints presente');
  }
  /* velas diárias */
  eq(s.velas.length, dias.length, 'uma vela por dia');
  near(s.velas[0].o, ini, 1e-9, 'a 1ª vela abre no capital inicial');
  {
    let tudoOk = true, prev = ini;
    s.velas.forEach(v => {
      if (Math.abs(v.o - prev) > 1e-6) tudoOk = false;
      if (v.h < Math.max(v.o, v.c) - 1e-6 || v.l > Math.min(v.o, v.c) + 1e-6) tudoOk = false;
      if (v.h < v.l) tudoOk = false;
      prev = v.c;
    });
    ok(tudoOk, 'velas: abertura encadeada e máx/mín coerentes (h ≥ máx(o,c), l ≤ mín(o,c))');
    near(prev, saldoFinal, 1e-6, 'o último fechamento é o saldo final');
  }
  eq(s.porDia.length, dias.length, 'porDia agrupa por data');
  eq(s.porDia.reduce((a, d) => a + d.n, 0), ordenadas.length, 'porDia cobre todas as operações');
  eq(s.porHora.length, 24, 'porHora tem as 24 faixas');
  ok(s.porHora.reduce((a, h) => a + h.n, 0) <= ordenadas.length, 'porHora não inventa operação');
  eq(s.porAtivo.reduce((a, x) => a + x.n, 0), ordenadas.length, 'porAtivo cobre todas as operações');
  ok(s.porAtivo.every(x => x.taxa >= 0 && x.taxa <= 1), 'taxa por ativo entre 0 e 1');

  /* filtros da tela chegam na série */
  await w.eval("document.getElementById('fRes').value='WIN'");
  await w.eval('applyFilter()');
  await sleep(140);
  const sF = w.eval('(window.__sf = EC.host.serie(), window.__sf)');
  eq(sF.operacoes.length, wins, 'a série respeita o filtro da tela');
  ok(sF.operacoes.every(o => o.resultado === 'WIN'), 'só WIN quando o filtro é WIN');
  eq(sF.filtro.resultado, 'WIN', 'e o filtro aplicado vem declarado na série');
  const sT = w.eval("EC.host.operacoes({filtradas:false})");
  eq(sT.length, ordenadas.length, 'filtradas:false devolve tudo (para o gráfico não mentir)');
  await w.eval('clearFilter()');
  await sleep(120);

  /* diagnóstico */
  eq(w.eval('EC.host.ferramentas().length'), 0, 'ferramentas() lista o que está instalado');
  ok(Array.isArray(w.eval('EC.host.erros()')), 'erros() devolve lista');
  eq(w.eval('EC.host.config().capitalInicial'), ini, 'config() traz o capital inicial');
  ok(w.eval('EC.host.ativos()').length > 0, 'ativos() lista os ativos usados');
  ok(w.eval('EC.host.temas()').length >= 10, 'temas() lista os temas do app');

  wA.close(); wR.close();

  console.log(fails ? `\n💥 ${fails} FALHA(S) no hospedeiro de ferramentas` : '\n🎉 ECX OK — HOSPEDEIRO DE FERRAMENTAS PRONTO');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('\n💥 erro no teste:', e); process.exit(1); });
