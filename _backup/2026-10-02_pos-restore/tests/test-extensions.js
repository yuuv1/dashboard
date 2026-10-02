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
const buildEcx = (srcV2.match(/EC_BUILD='([^']+)'/) || [])[1] || '';
ok(/^2026-09-29\.[3-9]-ecx-/.test(buildEcx), 'v2 tem o build do hospedeiro (' + (buildEcx || 'nenhum') + ')');

['id="ecxTabs"', 'id="ecxSlot"', 'id="ecxHost"', 'id="ecxTabsAn"', 'id="ecxSlotAn"', 'id="ecxHostAn"',
  'id="ecxMod"', 'id="ecxLista"', 'id="ecxStatus"'].forEach(id =>
  ok(srcV2.indexOf(id) > 0, `v2 tem ${id}`));
ok(srcV2.indexOf('id="ecxTabsAn"') > srcV2.indexOf('id="page-analytics"'),
  'as abas do Analytics ficam dentro da página Analytics');
ok(srcV2.indexOf('id="ecxSlotAn"') < srcV2.indexOf('<div class="an-body">'),
  'o slot do Analytics fica antes dos painéis');
ok(srcV2.indexOf("analytics:{pagina:'analytics'") > 0, 'Analytics é um ponto de montagem declarado');
ok(srcV2.indexOf("oculta:'#page-analytics .an-body'") > 0, 'abrir a ferramenta esconde os painéis do Analytics');
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
  ok(Array.isArray(m.montagem) && m.montagem.indexOf('operacoes') >= 0 && m.montagem.indexOf('analytics') >= 0,
    'a pasta reservada monta em Operações e Analytics', JSON.stringify(m.montagem));
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
    /* lê na hora: o "ok" tem que refletir a existência do arquivo, senão o
       hospedeiro acha index.html onde não existe (o fallback sem manifesto) */
    try { const t = fs.readFileSync(abs, 'utf8'); return { ok: true, status: 200, text: async () => t }; }
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
  eq(wR.eval('ECX.views.operacoes'), 'tabela', 'a visão inicial continua sendo a tabela');
  eq(wR.document.getElementById('ecxSlot').hidden, true, 'e nada foi montado ainda (montagem preguiçosa)');

  await runImport(wR, fs.readFileSync(FIXTURE, 'utf8'));
  await sleep(280);
  await wR.eval("nav('operations',document.getElementById('navOps'))");
  await sleep(120);
  eq(wR.document.querySelectorAll('#opsTb tr').length, 51, 'tabela ok antes de abrir a ferramenta');

  /* abre a aba → iframe */
  await wR.eval("ecxSetView('visual-operacoes')");
  await sleep(160);
  eq(wR.eval('ECX.views.operacoes'), 'visual-operacoes', 'a visão trocou');
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
  eq(wR.eval('ECX.views.operacoes'), 'tabela', 'sair de Operações volta para a tabela');
  eq(wR.document.getElementById('ecxSlot').hidden, true, 'o slot some');
  ok(!wR.document.querySelector('#ecxHost iframe'), 'e o iframe é removido');

  /* ── D2. segundo ponto de montagem: Analytics ── */
  await wR.eval("nav('analytics')");
  await sleep(160);
  eq(wR.document.getElementById('ecxTabsAn').hidden, false, 'as abas aparecem no Analytics também');
  ok(/Análise gráfica/.test(wR.document.getElementById('ecxTabsAn').textContent), 'com a mesma ferramenta');
  ok(/Painéis/.test(wR.document.getElementById('ecxTabsAn').textContent), 'e a aba padrão do Analytics é "📊 Painéis"');
  eq(wR.document.getElementById('ecxSlotAn').hidden, true, 'nada montado antes do clique (preguiçoso)');
  await wR.eval("ecxSetView('visual-operacoes','analytics')");
  await sleep(180);
  eq(wR.eval('ECX.views.analytics'), 'visual-operacoes', 'a visão do Analytics trocou');
  eq(wR.document.getElementById('ecxSlotAn').hidden, false, 'o slot do Analytics aparece');
  eq(wR.document.querySelector('#page-analytics .an-body').style.display, 'none', 'os painéis são escondidos (não destruídos)');
  ok(!!wR.document.querySelector('#ecxHostAn iframe.ecx-frame'), 'o iframe montou no Analytics');
  eq(wR.eval('ECX.tools[0].montadoEm'), 'analytics', 'a ferramenta sabe onde está montada');
  /* uma ferramenta só, um lugar por vez */
  await wR.eval("nav('operations',document.getElementById('navOps'))");
  await sleep(160);
  eq(wR.eval('ECX.views.analytics'), 'tabela', 'sair do Analytics restaura a visão padrão de lá');
  eq(wR.document.getElementById('ecxSlotAn').hidden, true, 'o slot do Analytics some');
  ok(!wR.document.querySelector('#ecxHostAn iframe'), 'e o iframe de lá é removido');
  await wR.eval("ecxSetView('visual-operacoes','operacoes')");
  await sleep(180);
  eq(wR.eval('ECX.tools[0].montadoEm'), 'operacoes', 'abrir em Operações monta em Operações');
  ok(!!wR.document.querySelector('#ecxHost iframe'), 'com o iframe no lugar certo');
  await wR.eval("ecxSetView('visual-operacoes','analytics')");
  await sleep(180);
  ok(!wR.document.querySelector('#ecxHost iframe'), 'montar no Analytics desmonta o de Operações');
  ok(!!wR.document.querySelector('#ecxHostAn iframe'), 'ficando uma instância só');
  /* tela cheia usa o slot da página atual */
  await wR.eval("ecxTelaCheia(true,'analytics')");
  ok(wR.document.getElementById('ecxSlotAn').classList.contains('ecx-fs'), '⛶ expande o slot da página em uso');
  await wR.eval("ecxTelaCheia(false,'analytics')");
  ok(!wR.document.getElementById('ecxSlotAn').classList.contains('ecx-fs'), 'e recolhe');
  await wR.eval("ecxSetView('tabela','analytics')");
  await sleep(140);
  eq(wR.document.querySelector('#page-analytics .an-body').style.display, '', 'fechar a aba devolve os painéis do Analytics');
  /* o modal oferece abrir em cada ponto de montagem */
  await wR.eval('ecxMod(true)');
  await sleep(80);
  const modalTxt = wR.document.getElementById('ecxLista').textContent;
  ok(/Abrir em Operações/.test(modalTxt) && /Abrir em Analytics/.test(modalTxt), 'o modal lista os dois pontos de montagem');
  ok(/Operações \+ Analytics/.test(modalTxt), 'e mostra onde a ferramenta aparece');
  await wR.eval('ecxMod(false)');

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
      'ferramentas/visual-operacoes/ferramenta.json': 404,
      'ferramentas/visual-operacoes/index.html': 404,   /* isola o cenário */
      'ferramentas/visual-operacoes/index.html': 404
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
      'ferramentas/visual-operacoes/ferramenta.json': 404,
      'ferramentas/visual-operacoes/index.html': 404,   /* isola o cenário */
      'ferramentas/visual-operacoes/index.html': 404
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

  /* ── H2. jogar a pasta dentro sem ferramenta.json ── */
  const wN = boot({
    fetch: fetchStub({
      'ferramentas/registro.json': JSON.stringify({ versao: 1, ferramentas: ['sistema-colado'] }),
      'ferramentas/sistema-colado/index.html': '<!doctype html><title>sistema inteiro</title><p>oi</p>',
      'ferramentas/visual-operacoes/ferramenta.json': 404,
      'ferramentas/visual-operacoes/index.html': 404
    })
  }).win;
  await sleep(420);
  eq(wN.eval('ECX.tools.length'), 1, 'pasta só com index.html é carregada no padrão');
  eq(wN.eval('ECX.tools[0].id'), 'sistema-colado', 'o id vem do nome da pasta');
  eq(wN.eval('ECX.tools[0].modo'), 'iframe', 'no modo iframe (isolamento total)');
  eq(wN.eval('ECX.tools[0].entrada'), 'ferramentas/sistema-colado/index.html', 'apontando para o index.html da pasta');
  eq(wN.eval('ECX.tools[0].semManifesto'), true, 'marcada como "sem manifesto"');
  eq(wN.eval('ECX.tools[0].montagem.join("+")'), 'operacoes+analytics', 'disponível nas duas páginas');
  ok(wN.eval('ECX.errors.some(e=>/sem ferramenta.json/.test(e.msg))'), 'com aviso explicando o padrão aplicado');
  eq(wN.document.getElementById('ecxTabs').hidden, false, 'a aba aparece em Operações');
  eq(wN.document.getElementById('ecxTabsAn').hidden, false, 'e no Analytics');
  await wN.eval('ecxMod(true)'); await sleep(80);
  ok(/sem ferramenta.json/.test(wN.document.getElementById('ecxLista').textContent), 'o modal sinaliza a falta do manifesto');
  wN.close();

  /* ── H3. montagem restrita a uma página ── */
  const wO = boot({
    fetch: fetchStub({
      'ferramentas/registro.json': JSON.stringify({ versao: 1, ferramentas: ['so-analytics'] }),
      'ferramentas/so-analytics/ferramenta.json': JSON.stringify({ id: 'so-analytics', modo: 'iframe', entrada: 'i.html', montagem: 'analytics' }),
      'ferramentas/visual-operacoes/ferramenta.json': 404,
      'ferramentas/visual-operacoes/index.html': 404
    })
  }).win;
  await sleep(420);
  eq(wO.eval('ECX.tools[0].montagem.join("+")'), 'analytics', 'montagem em string única vira lista');
  eq(wO.document.getElementById('ecxTabsAn').hidden, false, 'a aba aparece só no Analytics');
  eq(wO.document.getElementById('ecxTabs').hidden, true, 'e não em Operações');
  wO.close();

  /* ── H4. montagem desconhecida é recusada ── */
  const wP = boot({
    fetch: fetchStub({
      'ferramentas/registro.json': JSON.stringify({ versao: 1, ferramentas: ['lugar-errado'] }),
      'ferramentas/lugar-errado/ferramenta.json': JSON.stringify({ id: 'lugar-errado', modo: 'iframe', entrada: 'i.html', montagem: ['relatorio'] }),
      'ferramentas/visual-operacoes/ferramenta.json': 404,
      'ferramentas/visual-operacoes/index.html': 404
    })
  }).win;
  await sleep(400);
  eq(wP.eval('ECX.tools.length'), 0, 'ponto de montagem inexistente recusa a ferramenta');
  ok(wP.eval('ECX.errors.some(e=>/montagem desconhecida/.test(e.det))'), 'com o motivo e as opções válidas');
  wP.close();

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

  /* ── J. painel de referência: a ferramenta do outro lado da ponte ── */
  console.log('\n── 4. painel de referência (ferramentas/visual-operacoes) ──');
  {
    const pHtml = fs.readFileSync(path.join(FERR, 'visual-operacoes', 'index.html'), 'utf8');
    const pJs = fs.readFileSync(path.join(FERR, 'ponte.js'), 'utf8');
    const ini2 = 1000;
    const ops2 = [
      ['WIN', 25, '2026-07-01', '10:00', 'EUR/USD', '1', ['shot_a']],
      ['LOSS', 20, '2026-07-01', '11:30', 'GBP/JPY', '2', []],
      ['WIN', 30, '2026-07-02', '09:15', 'EUR/USD', '3', []],
      ['WIN', 12, '2026-07-03', '14:00', 'AUD/USD', '4', ['shot_b']],
      ['LOSS', 8, '2026-07-03', '16:45', 'EUR/USD', '5', []]
    ].map(function (o, i) {
      return { resultado: o[0], valor: o[1], efeito: o[0] === 'WIN' ? o[1] : -o[1], data: o[2], hora: o[3],
        ts: Date.parse(o[2] + 'T' + o[3] + ':00'), ativo: o[4], id: o[5], prints: o[6], i: i, n: i + 1,
        saldo: 0, usd: o[1] / 5, plano: 'yes', motivo: '', notas: '', emocoes: [], operacionais: [],
        direcao: '', video: '', imagem: '', criadoEm: '' };
    });
    let saldo2 = ini2;
    ops2.forEach(function (o) { saldo2 += o.efeito; o.saldo = saldo2; });
    const TEMA2 = { id: 'graphite', nome: 'Graphite', escuro: true, vibrante: false, metal: 'chrome', amostras: [],
      cores: { fundo: '#17181B', superficie: '#55554E', cartao: '#1c1d21', borda: '#333', texto: '#eee',
        suave: '#aaa', apagado: '#777', acento: '#7C8FA6', acento2: '#8fa2b8', ciano: '#22d3ee',
        win: '#0ea47a', loss: '#e11d48', alerta: '#d97706' } };
    const SERIE2 = { api: 1, build: 'teste', geradoEm: new Date().toISOString(), capitalInicial: ini2,
      filtro: { data: '', resultado: '', ativo: '', plano: '' }, operacoes: ops2,
      equity: [{ ts: ops2[0].ts, i: 0, n: 0, saldo: ini2 }].concat(ops2.map(function (o) { return { ts: o.ts, i: o.i, n: o.n, saldo: o.saldo }; })),
      velas: [
        { t: '2026-07-01', ts: ops2[0].ts, o: 1000, h: 1025, l: 1000, c: 1005, n: 2, wins: 1, losses: 1, resultado: 5 },
        { t: '2026-07-02', ts: ops2[2].ts, o: 1005, h: 1035, l: 1035, c: 1035, n: 1, wins: 1, losses: 0, resultado: 30 },
        { t: '2026-07-03', ts: ops2[3].ts, o: 1035, h: 1047, l: 1027, c: 1039, n: 2, wins: 1, losses: 1, resultado: 4 }],
      porDia: [], porAtivo: [], porHora: [],
      resumo: { n: 5, wins: 3, losses: 2, outros: 0, taxa: 0.6, resultado: 39, brutoWin: 67, brutoLoss: 28,
        fatorLucro: 2.39, mediaWin: 22.33, mediaLoss: 14, maiorWin: 30, maiorLoss: 20, expectativa: 7.8,
        saldoInicial: ini2, saldoFinal: saldo2, drawdown: 20, drawdownPct: 0.0195, sequenciaAtual: 1,
        sequenciaTipo: 'LOSS', melhorSequenciaWin: 2, piorSequenciaLoss: 1, ativosDistintos: 3, diasDistintos: 3 } };

    const chamadas = [], errosP = [];
    const vcP = new VirtualConsole();
    vcP.on('jsdomError', function (e) { errosP.push('jsdomError: ' + (e.message || e)); });
    vcP.on('error', function () { errosP.push('console.error: ' + Array.prototype.join.call(arguments, ' ')); });
    const wp = new JSDOM(pHtml, {
      runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vcP,
      url: 'https://edgecontrol.local/ferramentas/visual-operacoes/index.html',
      beforeParse(w) {
        const ctx = function () {
          const st = { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', lineJoin: '' };
          const api = {};
          ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect', 'arc', 'setLineDash',
            'fillText', 'save', 'restore', 'closePath', 'setTransform'].forEach(function (k) {
              api[k] = function () { chamadas.push(k); };
            });
          api.createLinearGradient = function () { chamadas.push('gradient'); return { addColorStop: function () { } }; };
          api.measureText = function (t) { return { width: String(t == null ? '' : t).length * 7 }; };
          return new Proxy(st, { get: function (t, k) { return (k in api) ? api[k] : t[k]; }, set: function (t, k, v) { t[k] = v; return true; }, has: function () { return true; } });
        };
        w.HTMLCanvasElement.prototype.getContext = ctx;
        function enviar(obj) {
          w.dispatchEvent(new w.MessageEvent('message', { data: obj, origin: 'https://edgecontrol.local' }));
        }
        /* "pai" de mentira: responde o RPC como o hospedeiro responde */
        Object.defineProperty(w, 'parent', {
          configurable: true,
          value: {
            postMessage: function (msg) {
              if (!msg || msg.ecx !== 1) return;
              if (msg.evt === 'pronto') { enviar({ ecx: 1, evt: 'pronto', data: { api: 1, build: 'teste', tema: TEMA2 } }); return; }
              if (msg.req == null) return;
              const m = msg.metodo, a = msg.args || {};
              if (m === 'serie') return enviar({ ecx: 1, res: msg.req, ok: true, data: SERIE2 });
              if (m === 'tema') return enviar({ ecx: 1, res: msg.req, ok: true, data: TEMA2 });
              if (['toast', 'telaCheia', 'abrirOperacao', 'abrirPrint'].indexOf(m) >= 0) {
                chamadas.push(m + ':' + (a.msg || a.on || a.id || ''));
                return enviar({ ecx: 1, res: msg.req, ok: true, data: true });
              }
              enviar({ ecx: 1, res: msg.req, ok: false, erro: 'método desconhecido: ' + m });
            }
          }
        });
        w.__enviar = enviar;
      }
    }).window;
    /* jsdom não carrega <script src>: injeta a ponte e roda o script do painel */
    const s1 = wp.document.createElement('script'); s1.textContent = pJs; wp.document.body.appendChild(s1);
    const s2 = wp.document.createElement('script');
    s2.textContent = pHtml.split('<script>').pop().split('</script>')[0];
    wp.document.body.appendChild(s2);
    await sleep(420);
    const dp = wp.document;
    eq(wp.eval('EC.ponte.modo'), 'iframe', 'do lado da ferramenta, a ponte se reconhece em modo iframe');
    eq(dp.querySelectorAll('#vxKpis .vx-kpi').length, 8, 'os 8 KPIs renderizaram');
    const txt = dp.getElementById('vxKpis').textContent;
    ok(/60,0%/.test(txt), 'taxa de acerto em pt-BR', (txt.match(/[\d.,]+%/) || [])[0]);
    ok(/1\.039/.test(txt), 'o saldo final formatado aparece nos KPIs', (txt.match(/R\$[^A-Za-z]{0,14}/g) || []).slice(0, 3).join(' | '));
    ok(/R\$/.test(txt), 'valores em BRL');
    ok(/3/.test(txt) && /2/.test(txt), 'wins e losses nos KPIs');
    eq(dp.querySelectorAll('#vxLista .vx-op').length, 5, 'as operações aparecem na lista lateral');
    eq(dp.querySelectorAll('#vxLista .vx-op [data-print]').length, 2, 'com 📸 só onde existe print');
    ok(chamadas.indexOf('gradient') >= 0 && chamadas.indexOf('stroke') >= 0, 'o canvas desenhou a linha de capital');
    ok(/conectado/.test(dp.getElementById('vxLog').textContent), 'o aperto de mão foi registrado no log');
    eq(dp.getElementById('vxAviso').innerHTML, '', 'nenhum aviso de erro na tela');
    eq(errosP.length, 0, 'nenhum erro de console no painel', errosP.join(' | '));
    eq(wp.eval("document.documentElement.style.getPropertyValue('--fundo')"), '#17181B', 'o painel seguiu o tema do app');
    dp.getElementById('btVelas').click();
    await sleep(140);
    ok(chamadas.filter(function (c) { return c === 'fillRect'; }).length >= 3, 'as velas diárias desenharam corpos');
    ok(dp.getElementById('btVelas').classList.contains('on'), 'e o toggle de visão acompanhou');
    dp.getElementById('btToast').click();
    dp.getElementById('btFs').click();
    await sleep(140);
    ok(chamadas.some(function (c) { return /^toast:/.test(c); }), 'o botão de toast fala com o app');
    ok(chamadas.some(function (c) { return /^telaCheia:true/.test(c); }), 'o ⛶ pede tela cheia ao hospedeiro');
    dp.querySelector('#vxLista .vx-op [data-print]').click();
    await sleep(80);
    dp.querySelector('#vxLista .vx-op').click();
    await sleep(140);
    ok(chamadas.some(function (c) { return c === 'abrirPrint:shot_b'; }), 'clique no 📸 abre o print no estúdio');
    ok(chamadas.some(function (c) { return /^abrirOperacao:/.test(c); }), 'clique na linha abre a operação no app');
    const logAntes = dp.getElementById('vxLog').textContent.length;
    wp.__enviar({ ecx: 1, evt: 'dados', data: { api: 1, motivo: 'save' } });
    await sleep(220);
    ok(dp.getElementById('vxLog').textContent.length > logAntes, 'o evento "dados" chegou na ferramenta');
    ok(/dados \(save\)/.test(dp.getElementById('vxLog').textContent), 'com o motivo no log');
    wp.close();

    /* aberta fora do app: avisa, não quebra */
    const wIso = new JSDOM(pHtml, { runScripts: 'dangerously', url: 'https://x.local/i.html', virtualConsole: new VirtualConsole() }).window;
    await sleep(160);
    ok(/fora do EdgeControl|ponte/.test(wIso.document.getElementById('vxAviso').textContent),
      'fora do app o painel avisa em vez de quebrar');
    wIso.close();
  }

  wA.close(); wR.close();

  console.log(fails ? `\n💥 ${fails} FALHA(S) no hospedeiro de ferramentas` : '\n🎉 ECX OK — HOSPEDEIRO DE FERRAMENTAS PRONTO');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('\n💥 erro no teste:', e); process.exit(1); });
