/* ------------------------------------------------------------------
   Testes do PRINT STUDIO v2 (edgecontrol-glass-v2.html).

   Três camadas:
     1. núcleo puro  — /*STUDIO-CORE-START* … /*STUDIO-CORE-END*:
        geometria, validação de camadas, recorte composto e zoom.
     2. estrutura    — a v1 continua intacta (visor simples) e a v2 traz
        o estúdio completo, com as integrações (backup, PDF, galeria).
     3. integração   — o app inteiro em jsdom: abre o estúdio, desenha,
        desfaz, recorta, salva no IndexedDB, exporta e reimporta as
        camadas — sem nunca alterar o arquivo original do print.

   Rodar:  npm run test:studio   (ou: node tests/test-print-studio.js)
   Requer: npm install  (jsdom, fake-indexeddb)
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = path.join(__dirname, '..', 'edgecontrol-glass-v2.html');
const V1 = path.join(__dirname, '..', 'edgecontrol-glass.html');
const FIXTURE = path.join(__dirname, '..', 'edgecontrol_2026-09-17 (1).json');

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
   1. NÚCLEO PURO (sem DOM)
══════════════════════════════════════════════════════════════════ */
console.log('\n── 1. núcleo puro do estúdio ──');
const core = srcV2.split('/*STUDIO-CORE-START*/')[1].split('/*STUDIO-CORE-END*/')[0];
const C = new Function(core + `
  return {STU_SHAPES,STU_DRAW,STU_COLORS,STU_THICK,STU_MIN,STU_MAX,stuNum,stuClamp,stuColor,
    stuDistSeg,stuNormBox,stuPtsBox,stuBoundsPx,stuValidate,stuClone,stuValidCrop,stuCropIsFull,stuComposeCrop,
    stuFitScale,stuZoom,stuPanForZoom,stuPanToCenter,stuClampPan,stuNextCounter,stuThick,stuFontSize,
    stuCounterR,stuSimplify,stuHit,stuHandles,stuHitHandle,stuLabel,stuStats,STU_NAMES};
`)();

/* ── validação: backup malformado não derruba o desenho ── */
eq(C.stuValidate(null).length, 0, 'stuValidate(null) → lista vazia');
eq(C.stuValidate('não é lista').length, 0, 'stuValidate(string) → lista vazia');
eq(C.stuValidate([null, 7, {}, { t: 'inexistente' }]).length, 0, 'descarta lixo e tipo desconhecido');
eq(C.stuValidate([{ t: 'text', s: '   ' }]).length, 0, 'descarta texto vazio');
eq(C.stuValidate([{ t: 'pencil', pts: [] }]).length, 0, 'descarta desenho sem pontos');
eq(C.stuValidate([{ t: 'rect', x1: .2, y1: .2, x2: .2, y2: .2 }]).length, 0, 'descarta forma sem área');
{
  const [s] = C.stuValidate([{ t: 'arrow', x1: .1, y1: .2, x2: .8, y2: .9, c: '#ZZZ', w: 'grosso', o: 9 }]);
  ok(s, 'forma válida sobrevive');
  eq(s.c, '#ff3b30', 'cor inválida cai no vermelho padrão');
  eq(s.w, 3, 'espessura não-numérica cai no padrão');
  eq(s.o, 1, 'opacidade acima de 1 é limitada');
  eq(C.stuValidate([{ t: 'arrow', x1: .1, y1: .2, x2: .8, y2: .9, w: 99999 }])[0].w, 600, 'espessura absurda é limitada');
}
{
  const [s] = C.stuValidate([{ t: 'pencil', pts: [[.1, .1], ['x', 3], [.5, .5], [.9, .9]] }]);
  eq(s.pts.length, 3, 'pontos não-numéricos são descartados no desenho livre');
  near(s.x1, .1, 1e-9, 'caixa do desenho livre vem dos pontos (x1)');
  near(s.x2, .9, 1e-9, 'caixa do desenho livre vem dos pontos (x2)');
}
{
  const [s] = C.stuValidate([{ t: 'counter', n: 2.4, r: 1e6, x1: .5, y1: .5 }]);
  eq(s.n, 2, 'número do marcador é inteiro');
  eq(s.r, 600, 'raio do marcador é limitado');
}

/* ── camadas são normalizadas: independem da resolução ── */
{
  const m = C.stuValidate([{ t: 'rect', x1: .25, y1: .25, x2: .75, y2: .75, w: 6 }])[0];
  const a = C.stuBoundsPx(m, 1600, 900), b = C.stuBoundsPx(m, 800, 450);
  near((a.x + a.w / 2) / 1600, (b.x + b.w / 2) / 800, 1e-9, 'mesmo centro relativo em 1600px e 800px');
  near((a.y + a.h / 2) / 900, (b.y + b.h / 2) / 450, 1e-9, 'mesmo centro vertical relativo');
  const p1 = C.stuValidate([{ t: 'pencil', pts: [[.1, .1], [.5, .3], [.9, .8]] }])[0];
  const b1 = C.stuPtsBox(p1.pts);
  near(b1.x, .1, 1e-9, 'caixa normalizada do desenho livre (x)');
  near(b1.y + b1.h, .8, 1e-9, 'caixa normalizada do desenho livre (fundo)');
  near(p1.x1, .1, 1e-9, 'a camada guarda a caixa normalizada dos pontos');
  near(p1.y2, .8, 1e-9, 'a camada guarda a caixa normalizada (y2)');
}
/* ── geometria básica ── */
{
  const b = C.stuNormBox({ x1: .8, y1: .9, x2: .2, y2: .3 });
  near(b.x, .2, 1e-9, 'stuNormBox inverte para x mínimo'); eq(b.w > 0, true, 'largura sempre positiva');
}
near(C.stuDistSeg(0, 1, 0, 0, 2, 0), 1, 1e-9, 'distância ponto→segmento');
near(C.stuDistSeg(5, 5, 0, 0, 2, 0), Math.hypot(3, 5), 1e-9, 'distância fora do segmento usa a ponta');
{
  const c = C.stuValidate([{ t: 'counter', x1: .5, y1: .5, r: 20 }])[0];
  const b = C.stuBoundsPx(c, 1000, 1000);
  eq(b.w, 40, 'caixa do marcador = 2× raio');
  near(b.x, 480, 1e-9, 'caixa do marcador é centrada no ponto');
}
{
  const t = C.stuValidate([{ t: 'text', x1: .1, y1: .1, s: 'alvo', fs: 30 }])[0];
  const b = C.stuBoundsPx(t, 1000, 1000);
  ok(b.w > 0 && b.h > 0, 'texto sem medição real ainda tem caixa (estimativa)', `${b.w.toFixed(0)}×${b.h.toFixed(0)}`);
}

/* ── clique (hit test) ── */
{
  const W = 1000, H = 1000;
  const rect = C.stuValidate([{ t: 'rect', x1: .2, y1: .2, x2: .8, y2: .8, w: 4 }])[0];
  eq(C.stuHit(rect, 200, 500, 6, W, H), true, 'clique na borda do retângulo seleciona');
  eq(C.stuHit(rect, 500, 500, 6, W, H), false, 'clique no meio do retângulo vazio não seleciona');
  eq(C.stuHit(rect, 50, 50, 6, W, H), false, 'clique longe não seleciona');
  const cheio = Object.assign({}, rect, { fill: true });
  eq(C.stuHit(cheio, 500, 500, 6, W, H), true, 'retângulo preenchido seleciona pelo miolo');
  const line = C.stuValidate([{ t: 'arrow', x1: .1, y1: .1, x2: .9, y2: .9, w: 4 }])[0];
  eq(C.stuHit(line, 500, 500, 6, W, H), true, 'clique sobre a seta diagonal');
  eq(C.stuHit(line, 500, 300, 6, W, H), false, 'clique fora da seta diagonal');
  const el = C.stuValidate([{ t: 'ellipse', x1: .2, y1: .2, x2: .8, y2: .8, w: 4 }])[0];
  eq(C.stuHit(el, 500, 200, 6, W, H), true, 'clique na borda da elipse');
  eq(C.stuHit(el, 500, 500, 6, W, H), false, 'clique no centro da elipse vazada');
  const pen = C.stuValidate([{ t: 'pencil', w: 4, pts: [[.1, .1], [.5, .5], [.9, .1]] }])[0];
  eq(C.stuHit(pen, 500, 500, 6, W, H), true, 'clique no traço do desenho livre');
  eq(C.stuHit(pen, 500, 800, 6, W, H), false, 'clique fora do desenho livre');
  const cnt = C.stuValidate([{ t: 'counter', x1: .5, y1: .5, r: 20 }])[0];
  eq(C.stuHit(cnt, 510, 500, 6, W, H), true, 'clique no marcador numerado');
  eq(C.stuHit(cnt, 600, 500, 6, W, H), false, 'clique fora do marcador numerado');
}
/* ── alças de edição ── */
{
  const W = 1000, H = 1000;
  const rect = C.stuValidate([{ t: 'rect', x1: .2, y1: .2, x2: .8, y2: .8 }])[0];
  eq(C.stuHandles(rect, W, H).length, 2, 'forma de 2 pontos tem 2 alças');
  eq(C.stuHitHandle(rect, 200, 200, 10, W, H), 'a', 'alça do canto inicial');
  eq(C.stuHitHandle(rect, 800, 800, 10, W, H), 'b', 'alça do canto final');
  eq(C.stuHitHandle(rect, 500, 500, 10, W, H), null, 'sem alça no meio');
  const pen = C.stuValidate([{ t: 'pencil', pts: [[.1, .1], [.5, .5]] }])[0];
  eq(C.stuHandles(pen, W, H).length, 0, 'desenho livre só se move (sem alças)');
  const txt = C.stuValidate([{ t: 'text', x1: .2, y1: .2, s: 'abc', fs: 30 }])[0];
  eq(C.stuHandles(txt, W, H).length, 2, 'texto tem origem + alça de tamanho');
}

/* ── recorte não-destrutivo e composto ── */
{
  eq(C.stuValidCrop(null), null, 'sem recorte → null');
  eq(C.stuValidCrop({ x: 0, y: 0, w: 1, h: 1 }) === null, false, 'recorte de tela inteira é válido');
  eq(C.stuValidCrop({ x: .4, y: .4, w: .01, h: .9 }), null, 'recorte fino demais é descartado');
  eq(C.stuValidCrop({ x: .9, y: 0, w: .5, h: 1 }).w, .1, 'recorte é cortado na borda direita');
  eq(C.stuCropIsFull({ x: 0, y: 0, w: 1, h: 1 }), true, 'tela inteira conta como "sem recorte"');
  const c1 = C.stuComposeCrop(null, { x1: .25, y1: .25, x2: .75, y2: .75 });
  near(c1.x, .25, 1e-9, '1º recorte: x'); near(c1.w, .5, 1e-9, '1º recorte: largura');
  const c2 = C.stuComposeCrop(c1, { x1: .5, y1: .5, x2: 1, y2: 1 });
  near(c2.x, .5, 1e-9, 'recorte sobre recorte volta às coords do original (x)');
  near(c2.w, .25, 1e-9, 'recorte sobre recorte: metade da metade');
  near(c2.y, .5, 1e-9, 'recorte sobre recorte (y)');
  eq(C.stuComposeCrop(c1, { x1: .5, y1: .5, x2: .5, y2: .5 }).x, c1.x, 'seleção vazia mantém o recorte atual');
  near(C.stuComposeCrop(null, { x: .2, y: .3, w: .4, h: .5 }).x, .2, 1e-9, 'stuComposeCrop também aceita caixa pronta (x,y,w,h)');
  near(C.stuComposeCrop(null, { x1: .9, y1: .1, x2: .3, y2: .6 }).w, .6, 1e-9, 'seleção invertida é normalizada antes do recorte');
}

/* ── zoom e panorâmica ── */
near(C.stuFitScale(1600, 900, 1200, 700, 40), Math.min(1160 / 1600, 660 / 900), 1e-9, 'ajuste à tela usa o lado que limita');
eq(C.stuFitScale(1600, 900, 10, 10, 40), C.STU_MIN, 'palco menor que a folga → zoom mínimo');
eq(C.stuZoom(1, 1e6), C.STU_MAX, 'zoom tem teto'); eq(C.stuZoom(1, 1e-6), C.STU_MIN, 'zoom tem piso');
{
  /* o ponto sob o cursor não pode sair do lugar ao dar zoom */
  const cw = 1600, ch = 900, s0 = .5, s1 = 1.25, px = 400, py = 300, tx = 37, ty = -22;
  const antes = tx + s0 * (px - cw / 2), depois0 = ty + s0 * (py - ch / 2);
  const [tx1, ty1] = C.stuPanForZoom(tx, ty, cw, ch, px, py, s0, s1);
  near(tx1 + s1 * (px - cw / 2), antes, 1e-9, 'zoom no cursor: x da tela não muda');
  near(ty1 + s1 * (py - ch / 2), depois0, 1e-9, 'zoom no cursor: y da tela não muda');
  const [tx2, ty2] = C.stuPanToCenter(cw, ch, px, py, s1);
  near(tx2 + s1 * (px - cw / 2), 0, 1e-9, 'panToCenter leva o ponto ao centro do palco');
  near(ty2 + s1 * (py - ch / 2), 0, 1e-9, 'panToCenter (y)');
}
{
  /* limite = metade da imagem ou 62% do palco, o que for maior: a imagem
     pode até sair bastante, mas nunca some inteira da tela */
  eq(C.stuClampPan(1e6, 100, 1, 800), 496, 'panorâmica limitada: a imagem não some da tela');
  eq(C.stuClampPan(-1e6, 100, 1, 800), -496, 'panorâmica limitada (negativo)');
  eq(C.stuClampPan(1e6, 4000, 1, 800), 2000, 'imagem grande: limite é metade dela');
  eq(C.stuClampPan(30, 100, 1, 800), 30, 'panorâmica dentro do limite não muda');
}
/* ── espessuras/ fontes proporcionais + simplificação ── */
ok(C.stuThick(C.STU_THICK[0], 900) < C.stuThick(C.STU_THICK[4], 900), 'espessuras em ordem crescente');
eq(C.stuThick(C.STU_THICK[1], 1800), C.stuThick(C.STU_THICK[1], 900) * 2, 'espessura dobra com a altura do print');
ok(C.stuFontSize(900) >= 10 && C.stuFontSize(900) <= 200, 'fonte padrão dentro da faixa do controle');
eq(C.stuNextCounter([]), 1, 'primeiro marcador = 1');
eq(C.stuNextCounter([{ t: 'counter', n: 3 }, { t: 'rect' }, { t: 'counter', n: 7 }]), 8, 'marcador seguinte = maior + 1');
{
  const linha = [];
  for (let i = 0; i <= 100; i++) linha.push([i / 100, .5]);
  eq(C.stuSimplify(linha, .01).length, 2, 'linha reta vira 2 pontos (registro leve)');
  const zig = [[0, 0], [.1, .9], [.2, 0], [.3, .9], [.4, 0]];
  eq(C.stuSimplify(zig, .01).length, 5, 'zigue-zague mantém todos os pontos');
  eq(C.stuSimplify(zig, 0).length, 5, 'eps 0 não simplifica');
}
/* ── rótulos usados na lista de anotações ── */
eq(C.stuLabel({ t: 'arrow' }), 'Seta', 'rótulo da seta');
eq(C.stuLabel({ t: 'counter', n: 3 }), 'Marcador 3', 'rótulo do marcador');
ok(C.stuLabel({ t: 'text', s: 'entrada no rompimento' }).indexOf('entrada') > 0, 'rótulo do texto traz o conteúdo');
ok(C.stuLabel({ t: 'text', s: 'x'.repeat(80) }).length < 60, 'rótulo longo é truncado');
{
  const st = C.stuStats([{ t: 'rect' }, { t: 'rect' }, { t: 'text', s: 'abc' }]);
  eq(st.n, 3, 'stuStats conta camadas'); eq(st.by.rect, 2, 'stats agrupa por tipo'); eq(st.text, 3, 'stats soma caracteres de texto');
}

/* ══════════════════════════════════════════════════════════════════
   2. ESTRUTURA DOS ARQUIVOS (v1 intacta, v2 completa)
══════════════════════════════════════════════════════════════════ */
console.log('\n── 2. v1 intacta / v2 completa ──');
ok(srcV1.indexOf('id="shotViewer"') > 0, 'v1 continua com o visor simples (#shotViewer)');
ok(srcV1.indexOf('psRoot') < 0 && srcV1.indexOf('STUDIO-CORE-START') < 0, 'v1 NÃO recebeu nada do estúdio');
ok(srcV1.indexOf("EC_BUILD='2026-09-18.3-ticker'") > 0, 'v1 mantém o build antigo');
// o build da v2 muda a cada entrega: em vez de congelar um número, conferimos
// que ele existe, segue o padrão AAAA-MM-DD.n-slug e não é o build da v1
const buildV1 = (srcV1.match(/EC_BUILD='([^']+)'/) || [])[1] || '';
const buildV2 = (srcV2.match(/EC_BUILD='([^']+)'/) || [])[1] || '';
ok(!!buildV2 && buildV2 !== buildV1, 'v2 tem build próprio (diferente da v1)', buildV2 || 'ausente');
ok(/^\d{4}-\d{2}-\d{2}\.\d+(-[A-Za-z0-9._-]+)?$/.test(buildV2), 'build da v2 no padrão AAAA-MM-DD.n-slug', buildV2);
ok(srcV2.indexOf('id="psRoot"') > 0, 'v2 tem o palco do estúdio (#psRoot)');
ok(srcV2.indexOf('id="shotViewer"') < 0, 'v2 não tem mais o visor antigo');
['psStage', 'psTools', 'psFilm', 'psSide', 'psCv', 'psCropBar', 'psTextEdit', 'psHelpPanel'].forEach(id =>
  ok(srcV2.indexOf(`id="${id}"`) > 0, `v2 tem #${id}`));
['rect', 'ellipse', 'arrow', 'line', 'pencil', 'hl', 'text', 'blur', 'counter', 'crop', 'eraser', 'hand', 'select']
  .forEach(t => ok(srcV2.indexOf(`t:'${t}'`) > 0, `ferramenta "${t}" presente`));
ok(srcV2.indexOf('async function openShotViewer(ctx,idx)') > 0, 'API openShotViewer() preservada (mesmos chamados da v1)');
['closeShotViewer', 'svPrev', 'svNext', 'svDownload', 'svDelete'].forEach(f =>
  ok(srcV2.indexOf('function ' + f) > 0 || srcV2.indexOf('async function ' + f) > 0, `API ${f}() preservada`));
ok(srcV2.indexOf('psShotURL(id,1600)') > 0, 'PDF do relatório usa a imagem anotada');
ok(srcV2.indexOf('marks:Array.isArray(r.marks)?r.marks:[]') > 0, 'backup exporta as camadas');
ok(srcV2.indexOf('marks:stuValidate(o.marks)') > 0, 'backup restaura as camadas');
ok(srcV2.indexOf('psHasLayers(r)') > 0, 'zip dos prints achata os anotados');
ok(srcV2.indexOf('function shotCardHTML(') > 0, 'cartão único de print (formulário/detalhe/galeria)');
ok(srcV2.indexOf('psThumbURL(') > 0, 'miniaturas mostram as anotações');
ok(srcV2.indexOf('openLastShotStudio') > 0, 'atalho do estúdio nas Configurações');
/* 💾 salvar a imagem editada como análise separada */
ok(srcV2.indexOf('async function psSaveAnalysis()') > 0, 'existe a ação psSaveAnalysis()');
ok(srcV2.indexOf("id=\"psDup\" title=\"Salva a imagem editada") > 0, 'botão 💾 Salvar análise na barra do estúdio');
ok(srcV2.indexOf("E.Dup.addEventListener('click',()=>psSaveAnalysis())") > 0, 'o botão dispara a ação');
ok(srcV2.indexOf("e.shiftKey&&L==='s'") > 0, 'atalho Ctrl+Shift+S para salvar a análise');
ok(srcV2.indexOf("kind:'analise',parentId:PS.rec.id") > 0, 'a análise nasce como registro separado ligado ao original');
ok(srcV2.indexOf("name:psFileBase()+'_analise.jpg'") > 0, 'nome do arquivo da análise');
ok(srcV2.indexOf("if(PS.rec.kind==='analise'){") > 0, 're-salvar atualiza a própria análise (não empilha cópias)');
ok(srcV2.indexOf("kind:opts.kind||''") > 0, 'storeShot() guarda a categoria do print');
ok(srcV2.indexOf("<option value=\"analise\">💾 Análises salvas</option>") > 0, 'filtro de análises na galeria');
ok(srcV2.indexOf("if(f==='analise') all=all.filter(r=>r.kind==='analise')") > 0, 'filtro aplicado na listagem');
ok(srcV2.indexOf('sb an" title="imagem editada salva separada') > 0, 'selo ANÁLISE no cartão de print');
ok(srcV2.indexOf("marksAt:r.marksAt||'',parentId:r.parentId||null,kind:r.kind||''") > 0, 'backup exporta a categoria');
ok(srcV2.indexOf("marksAt:o.marksAt||'',parentId:o.parentId||null,kind:o.kind||''") > 0, 'backup restaura a categoria');
ok(srcV2.indexOf('function psSyncSaveBtn()') > 0, 'rótulo do botão acompanha o contexto (salvar/atualizar)');
{
  const dup = {};
  const appJs = srcV2.split('<script>').pop().split('</script>')[0];
  new vm.Script(appJs, { filename: 'edgecontrol-v2.js' });   /* lança se não compilar */
  ok(true, 'o script da v2 compila sem erro de sintaxe');
  appJs.replace(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm, (_, n) => { dup[n] = (dup[n] || 0) + 1; return _; });
  const dups = Object.keys(dup).filter(k => dup[k] > 1);
  eq(dups.length, 0, 'nenhuma função duplicada (nada da v1 foi sobrescrito)', dups.join(','));
}

/* ══════════════════════════════════════════════════════════════════
   3. INTEGRAÇÃO EM JSDOM
══════════════════════════════════════════════════════════════════ */
let JSDOM, IDBFactory, IDBKeyRange;
try {
  ({ JSDOM } = require('jsdom'));
  ({ IDBFactory, IDBKeyRange } = require('fake-indexeddb'));
} catch (e) {
  console.log('\n⚠️  jsdom/fake-indexeddb não instalados — pulando a integração (npm install).');
  console.log(fails ? `\n💥 ${fails} FALHA(S)` : '\n🎉 ESTÚDIO OK (núcleo + estrutura)');
  process.exit(fails ? 1 : 0);
}

const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function boot(idbToShare) {
  const calls = [];
  const idb = idbToShare || new IDBFactory();
  const win = new JSDOM(srcV2, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://edgecontrol.local/',
    virtualConsole: new (require('jsdom').VirtualConsole)(),   /* silencia "not implemented" */
    beforeParse(w) {
      w.confirm = () => true;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.indexedDB = idb;
      w.IDBKeyRange = IDBKeyRange;
      w.TextEncoder = TextEncoder;
      w.Blob = Blob;
      let captured = null;
      w.URL.createObjectURL = b => { captured = b; return 'blob:mock-' + Math.random(); };
      w.URL.revokeObjectURL = () => {};
      w.__capturedBlob = () => captured;
      /* canvas 2D de mentirinha que REGISTRA as chamadas de desenho */
      const ctx2d = () => {
        const st = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '', lineCap: '', lineJoin: '', miterLimit: 10, globalCompositeOperation: 'source-over', imageSmoothingEnabled: true, imageSmoothingQuality: 'low' };
        const api = {};
        ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'clearRect',
          'fillRect', 'strokeRect', 'rect', 'arc', 'ellipse', 'quadraticCurveTo', 'setTransform', 'setLineDash',
          'fillText', 'strokeText', 'translate', 'scale'].forEach(k => {
          api[k] = function () { calls.push([k, ...Array.from(arguments)]); };
        });
        api.drawImage = function (img) { calls.push(['drawImage', (img && (img.naturalWidth || img.width)) || 0]); };
        api.measureText = t => ({ width: String(t == null ? '' : t).length * 10 });
        return new Proxy(st, {
          get: (t, k) => (k in api ? api[k] : t[k]),
          set: (t, k, v) => { t[k] = v; return true; },
          has: () => true
        });
      };
      w.__calls = calls;
      w.HTMLCanvasElement.prototype.getContext = ctx2d;
      w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,QUJD'; };
      w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(['fake'], { type: 'image/png' })); };
      /* Image que "carrega" na hora, com tamanho natural conhecido */
      w.Image = class {
        constructor() { this.naturalWidth = 1600; this.naturalHeight = 900; this.width = 1600; this.height = 900; this.complete = true; }
        set src(v) { this._src = v; setTimeout(() => { if (typeof this.onload === 'function') this.onload(); }, 0); }
        get src() { return this._src; }
        addEventListener(t, f) { if (t === 'load') setTimeout(f, 0); }
      };
      w.Chart = class { constructor(c, cfg) { this.config = cfg || {}; } destroy() {} update() {} resize() {} reset() {} };
      w.Chart.defaults = {};
      if (w.File) w.File.prototype.text = undefined;
      {
        const orig = w.FileReader.prototype.readAsDataURL;
        w.FileReader.prototype.readAsDataURL = function (blob) {
          try { return orig.call(this, blob); }
          catch (e) {
            blob.arrayBuffer().then(buf => {
              Object.defineProperty(this, 'result', { value: 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + Buffer.from(buf).toString('base64'), configurable: true });
              if (typeof this.onload === 'function') this.onload({ target: this });
              try { this.dispatchEvent(new w.Event('load')); } catch (_) {}
            }, () => { if (typeof this.onerror === 'function') this.onerror({ target: this }); });
          }
        };
      }
    }
  }).window;
  /* palco com tamanho real (jsdom devolve tudo zerado) */
  const patch = () => {
    const st = win.document.getElementById('psStage');
    if (st) st.getBoundingClientRect = () => ({ width: 1200, height: 700, left: 0, top: 0, right: 1200, bottom: 700, x: 0, y: 0 });
  };
  patch();
  return { win, idb, calls, patch };
}
async function runImport(w, backup) {
  const txt = typeof backup === 'string' ? backup : JSON.stringify(backup);
  const file = new w.File([txt], 'backup.json', { type: 'application/json' });
  w.__ev = { target: { files: [file], value: '' } };
  await w.eval('(async()=>{ await importData(window.__ev); })()');
}
function pointer(w, type, x, y, extra) {
  const ev = new w.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }, extra || {}));
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  return ev;
}
async function openStudio(w, ctx, idx) {
  w.eval(`(async()=>{ await openShotViewer('${ctx}',${idx || 0}); })()`);
  await sleep(220);
  w.document.getElementById('psStage').getBoundingClientRect =
    () => ({ width: 1200, height: 700, left: 0, top: 0, right: 1200, bottom: 700, x: 0, y: 0 });
  w.eval('psFit()');
  await sleep(20);
}

(async () => {
  console.log('\n── 3. integração (jsdom) ──');
  const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const nImgs = Object.keys(backup.shots || {}).length;
  ok(nImgs > 0, 'fixture com prints', `${nImgs} imagens`);

  const b1 = boot();
  const w = b1.win;
  await sleep(320);
  await runImport(w, fs.readFileSync(FIXTURE, 'utf8'));
  await sleep(250);

  const keys = await w.eval('IMGDB.keys()');
  eq(keys.length, nImgs, 'prints importados no IndexedDB');
  const recs = await w.eval('IMGDB.all()');
  ok(recs.every(r => Array.isArray(r.marks) && r.marks.length === 0), 'todo print nasce sem camadas');
  ok(recs.every(r => r.crop === null || r.crop === undefined), 'todo print nasce sem recorte');
  eq(w.eval('typeof openShotViewer'), 'function', 'openShotViewer disponível');

  /* abre pela galeria: um cartão por print, todos separados */
  await w.eval('(async()=>{ await openGallery(); })()');
  await sleep(200);
  await openStudio(w, 'gal', 0);
  const root = w.document.getElementById('psRoot');
  ok(root.classList.contains('show'), 'estúdio abre com .show');
  const thumbs = w.document.querySelectorAll('#psFilm .ps-thumb[data-id]');
  eq(thumbs.length, w.eval('galCache.length'), 'um cartão separado por print na tira');
  eq(w.document.querySelectorAll('#psTools .ps-tool').length, 13, '13 ferramentas no trilho');
  eq(w.document.getElementById('psCount').textContent.trim(), `1 / ${thumbs.length}`, 'contador de prints');
  ok(+w.document.getElementById('psZoomVal').textContent.replace('%', '') > 0, 'zoom calculado ao abrir');
  ok(b1.calls.some(c => c[0] === 'drawImage'), 'a imagem foi desenhada no canvas do palco');

  /* ── desenhar uma seta arrastando no palco (como o usuário faz) ── */
  const stage = w.document.getElementById('psStage');
  w.eval("psSetTool('arrow')");
  stage.dispatchEvent(pointer(w, 'pointerdown', 300, 200));
  w.dispatchEvent(pointer(w, 'pointermove', 480, 320));
  w.dispatchEvent(pointer(w, 'pointermove', 760, 520));
  w.dispatchEvent(pointer(w, 'pointerup', 760, 520));
  await sleep(60);
  let marks = w.eval('PS.marks');
  eq(marks.length, 1, 'arrastar com a seta cria 1 camada');
  eq(marks[0].t, 'arrow', 'camada do tipo seta');
  ok(marks[0].x1 >= 0 && marks[0].x1 <= 1 && marks[0].y2 >= 0 && marks[0].y2 <= 1, 'coordenadas normalizadas (0..1)');
  ok(marks[0].x2 > marks[0].x1 && marks[0].y2 > marks[0].y1, 'a seta vai do começo ao fim do arrasto');
  ok(marks[0].w > 0 && marks[0].c.charAt(0) === '#', 'estilo (espessura/cor) gravado na camada');
  ok(b1.calls.some(c => c[0] === 'fill'), 'ponta da seta desenhada');

  /* ── retângulo + texto + marcador + desfoque ── */
  w.eval("psSetTool('rect')");
  stage.dispatchEvent(pointer(w, 'pointerdown', 200, 150));
  w.dispatchEvent(pointer(w, 'pointermove', 600, 400));
  w.dispatchEvent(pointer(w, 'pointerup', 600, 400));
  w.eval("psSetTool('counter'); PS.marks.length;");
  stage.dispatchEvent(pointer(w, 'pointerdown', 640, 220));
  w.dispatchEvent(pointer(w, 'pointerup', 640, 220));
  stage.dispatchEvent(pointer(w, 'pointerdown', 700, 260));
  w.dispatchEvent(pointer(w, 'pointerup', 700, 260));
  w.eval("psSetTool('blur')");
  stage.dispatchEvent(pointer(w, 'pointerdown', 820, 480));
  w.dispatchEvent(pointer(w, 'pointermove', 980, 560));
  w.dispatchEvent(pointer(w, 'pointerup', 980, 560));
  w.eval("psSetTool('text');");
  stage.dispatchEvent(pointer(w, 'pointerdown', 350, 600));
  w.dispatchEvent(pointer(w, 'pointerup', 350, 600));
  await sleep(30);
  const ta = w.document.getElementById('psTextEdit');
  ok(ta.classList.contains('show'), 'ferramenta de texto abre o editor inline');
  ta.value = 'entrada no rompimento';
  w.eval('psCommitText()');
  await sleep(40);
  marks = w.eval('PS.marks');
  eq(marks.length, 6, 'seta + retângulo + 2 marcadores + desfoque + texto', marks.map(m => m.t).join(','));
  const counters = marks.filter(m => m.t === 'counter');
  eq(counters.map(c => c.n).join(','), '1,2', 'marcadores numerados em sequência');
  eq(marks.filter(m => m.t === 'text')[0].s, 'entrada no rompimento', 'texto guardado na camada');
  ok(b1.calls.some(c => c[0] === 'fillText'), 'texto desenhado no canvas');

  /* ── seleção, mover e apagar ── */
  w.eval("psSetTool('select')");
  const alvoId = w.eval('PS.marks[0].id'), alvoX = w.eval('PS.marks[0].x1');
  const pt = w.eval(`(function(){const n=psNat(),s=PS.marks[0];
    const c=PS.crop,ox=(s.x1+s.x2)/2*n.iw,oy=(s.y1+s.y2)/2*n.ih;
    const cx=ox-(c?c.x*n.iw:0),cy=oy-(c?c.y*n.ih:0);
    const v=psView();
    return {x:v.left+v.w/2+PS.tx-n.w*PS.scale/2+cx*PS.scale, y:v.top+v.h/2+PS.ty-n.h*PS.scale/2+cy*PS.scale};})()`);
  stage.dispatchEvent(pointer(w, 'pointerdown', pt.x, pt.y));
  w.dispatchEvent(pointer(w, 'pointermove', pt.x + 20, pt.y + 12));
  w.dispatchEvent(pointer(w, 'pointerup', pt.x + 20, pt.y + 12));
  await sleep(40);
  eq(w.eval('PS.sel'), alvoId, 'clicar no meio da seta seleciona a camada');
  ok(Math.abs(w.eval('PS.marks[0].x1') - alvoX) > 1e-6, 'arrastar move a anotação selecionada');

  /* ── desfazer / refazer ── */
  const antes = w.eval('PS.marks.length');
  w.eval('psUndo()'); await sleep(20);
  eq(w.eval('PS.marks.length'), antes, 'desfazer volta o movimento (mesma contagem)');
  w.eval('psUndo()'); await sleep(20);
  eq(w.eval('PS.marks.length'), antes - 1, 'desfazer remove a última camada criada');
  w.eval('psRedo()'); await sleep(20);
  eq(w.eval('PS.marks.length'), antes, 'refazer traz a camada de volta');
  w.eval('psUndo();psUndo();'); await sleep(30);
  ok(w.eval('PS.undo.length') >= 0, 'histórico funciona sem estourar');
  w.eval('while(PS.redo.length) psRedo();'); await sleep(60);
  eq(w.eval('PS.marks.length'), antes, 'refazer tudo restaura as camadas');

  /* ── o arquivo original continua intacto ── */
  const idAtual = w.eval('PS.id');
  const antesData = await w.eval(`IMGDB.get(${JSON.stringify(idAtual)}).then(r=>r.dataUrl||'')`);
  await w.eval('psPersist(true)');
  await sleep(80);
  const recAnotado = await w.eval(`IMGDB.get(${JSON.stringify(idAtual)})`);
  eq(recAnotado.marks.length, antes, 'camadas gravadas no registro do print');
  eq(recAnotado.dataUrl, antesData, '🔒 o arquivo original do print NÃO foi alterado');
  ok(new Date(recAnotado.marksAt).getTime() > 0, 'data da anotação registrada');
  eq(w.eval(`psHasLayers(PS.rec)`), true, 'psHasLayers detecta camadas');

  /* ── recorte não-destrutivo ── */
  w.eval("psSetTool('crop')");
  stage.dispatchEvent(pointer(w, 'pointerdown', 300, 180));
  w.dispatchEvent(pointer(w, 'pointermove', 900, 520));
  w.dispatchEvent(pointer(w, 'pointerup', 900, 520));
  await sleep(40);
  ok(w.document.getElementById('psCropBar').classList.contains('show'), 'barra de recorte aparece ao selecionar');
  ok(/\d+ × \d+ px/.test(w.document.getElementById('psCropDim').textContent), 'dimensão do recorte em px', w.document.getElementById('psCropDim').textContent);
  w.eval('psApplyCrop()');
  await w.eval('psPersist(true)');
  await sleep(80);
  const crop = w.eval('PS.crop');
  ok(crop && crop.w > .1 && crop.w < 1, 'recorte aplicado (parcial)', JSON.stringify(crop));
  const recCrop = await w.eval(`IMGDB.get(${JSON.stringify(idAtual)})`);
  ok(!!recCrop.crop, 'recorte persistido no registro');
  eq(recCrop.dataUrl, antesData, '🔒 recortar também não altera o arquivo original');
  const semRecorteAntes = recCrop.marks.length;
  w.eval('psResetCrop()'); await w.eval('psPersist(true)'); await sleep(60);
  eq(w.eval('PS.crop'), null, 'recorte é reversível (quadro inteiro)');
  eq(w.eval('PS.marks.length'), semRecorteAntes, 'as camadas sobrevivem ao vai-e-volta do recorte');

  /* ── esconder as anotações (comparar com o original) ── */
  w.eval('PS.showMarks=true; document.getElementById("psEye").click();');
  await sleep(20);
  eq(w.eval('PS.showMarks'), false, '👁 esconde as camadas');
  w.eval('document.getElementById("psEye").click();');
  await sleep(20);
  eq(w.eval('PS.showMarks'), true, '👁 mostra de novo');

  /* ── zoom ── */
  w.eval('psFit()');
  const zFit = w.eval('PS.scale');
  w.eval('psZoomCenter(2)'); await sleep(20);
  near(w.eval('PS.scale'), zFit * 2, 1e-6, 'zoom em passos (botão +)');
  w.eval('psActual()'); await sleep(20);
  eq(w.eval('PS.scale'), 1, '1:1 volta ao tamanho real');
  eq(w.document.getElementById('psZoomVal').textContent, '100%', 'rótulo de zoom acompanha');
  {
    const ev = new w.MouseEvent('wheel', { bubbles: true, cancelable: true, clientX: 600, clientY: 350 });
    Object.defineProperty(ev, 'deltaY', { value: -600 });
    Object.defineProperty(ev, 'deltaMode', { value: 0 });
    stage.dispatchEvent(ev);
  }
  await sleep(30);
  near(w.eval('PS.scale'), 2.4, 1e-6, 'roda do mouse dá zoom no ponto do cursor');
  {
    const ev = new w.MouseEvent('wheel', { bubbles: true, cancelable: true, clientX: 600, clientY: 350 });
    Object.defineProperty(ev, 'deltaY', { value: 1200 });
    Object.defineProperty(ev, 'deltaMode', { value: 0 });
    stage.dispatchEvent(ev);
  }
  await sleep(30);
  ok(w.eval('PS.scale') < 2.4, 'roda para o outro lado diminui o zoom', String(w.eval('PS.scale')));
  w.eval('psFit()');

  /* ── navegação entre prints separados ── */
  const idx0 = w.eval('PS.idx'), id0 = w.eval('PS.id');
  await w.eval('psNext()'); await sleep(160);
  eq(w.eval('PS.idx'), idx0 + 1, '→ avança para o próximo print');
  ok(w.eval('PS.id') !== id0, 'cada print abre isolado (id trocou)');
  eq(w.eval('PS.marks.length'), 0, 'o print seguinte abre sem herdar as camadas do anterior');
  await w.eval('psPrev()'); await sleep(160);
  eq(w.eval('PS.id'), id0, '← volta ao print anterior');
  eq(w.eval('PS.marks.length'), antes, 'e as camadas dele continuam salvas');

  /* ── miniatura composta + selo na galeria ── */
  await w.eval('closeShotViewer()');
  await sleep(220);
  ok(!w.document.getElementById('psRoot').classList.contains('show'), 'Esc/fechar esconde o estúdio');
  await w.eval('renderGallery()');
  await sleep(300);
  const cards = w.document.querySelectorAll('#galGrid .shot-item');
  eq(cards.length, nImgs, 'galeria continua listando todos os prints');
  const marcado = [...cards].filter(c => c.classList.contains('marked'));
  ok(marcado.length >= 1, 'print anotado ganha destaque na galeria', `${marcado.length} cartão(ões)`);
  ok(/✎/.test(marcado[0].textContent), 'selo ✎ com o nº de anotações na miniatura');
  ok(/Editar anotações/.test(marcado[0].textContent), 'miniatura anuncia a edição');
  ok(w.document.querySelectorAll('#galGrid .shot-item .sopen').length === nImgs, 'todos os cartões abrem o estúdio');

  /* ── filtro "com desenho/recorte" ── */
  w.document.getElementById('galFilter').value = 'marked';
  await w.eval('renderGallery()'); await sleep(220);
  eq(w.document.querySelectorAll('#galGrid .shot-item').length, 1, 'filtro mostra só o print anotado');
  w.document.getElementById('galFilter').value = '';
  await w.eval('renderGallery()'); await sleep(200);

  /* ── backup: as camadas viajam no JSON ── */
  await w.eval('(async()=>{ await exportData(); })()');
  await sleep(250);
  const cap = w.__capturedBlob();
  ok(!!cap, 'exportData gerou o arquivo');
  const pack = JSON.parse(await cap.text());
  const shotPack = pack.shots[idAtual];
  ok(!!shotPack, 'o print anotado está no backup');
  eq(shotPack.marks.length, antes, 'backup carrega as camadas');
  ok(shotPack.d.startsWith('data:image/'), 'backup carrega a imagem original (não a achatada)');

  /* ── outro navegador: importar o backup devolve as anotações ── */
  const b2 = boot();
  const w2 = b2.win;
  await sleep(320);
  await runImport(w2, JSON.stringify(pack));
  await sleep(250);
  const rec2 = await w2.eval(`IMGDB.get(${JSON.stringify(idAtual)})`);
  ok(!!rec2, 'print restaurado na segunda janela');
  eq(rec2.marks.length, antes, '🔁 anotações restauradas do backup');
  eq(rec2.marks[0].t, marks[0].t, 'tipo da 1ª camada preservado');
  eq(w2.eval(`psHasLayers(${JSON.stringify(rec2)})`), true, 'print volta marcado como anotado');
  await w2.eval('openGallery()'); await sleep(200);
  await openStudio(w2, 'gal', w2.eval('galCache').indexOf(idAtual));
  await sleep(200);
  eq(w2.eval('PS.marks.length'), antes, 'estúdio reabre com as camadas do backup');
  ok(b2.calls.some(c => c[0] === 'stroke' || c[0] === 'fill'), 'camadas do backup são redesenhadas no palco');

  /* ── 💾 Salvar análise: registro separado, categorizado, original intacto ── */
  const totalAntes = (await w2.eval('IMGDB.keys()')).length;
  eq(/Salvar análise/.test(w2.document.getElementById('psDup').textContent), true,
    'o botão do estúdio é o 💾 Salvar análise');
  await w2.eval('(async()=>{ await psSaveAnalysis(); })()');
  await sleep(400);
  const keys2 = await w2.eval('IMGDB.keys()');
  eq(keys2.length, totalAntes + 1, '💾 salvar cria UM registro separado');
  const novoId = keys2.find(k => k !== idAtual && !pack.shots[k]);
  const novo = await w2.eval(`IMGDB.get(${JSON.stringify(novoId)})`);
  eq(novo.kind, 'analise', 'o registro novo é categorizado como ANÁLISE');
  eq(novo.parentId, idAtual, 'a análise aponta para o print de origem');
  eq(novo.marks.length, 0, 'a análise já nasce achatada (sem camadas)');
  eq(novo.crop, null, 'e sem recorte pendente');
  ok(/_analise\.jpg$/.test(novo.name), 'o nome deixa claro que é a análise', novo.name);
  ok(!!novo.blob, 'a análise guarda a imagem editada');
  ok(!!novo.savedAt, 'com data de salvamento');
  const originalDepois = await w2.eval(`IMGDB.get(${JSON.stringify(idAtual)})`);
  eq(originalDepois.marks.length, antes, '🔒 o original continua com as camadas intactas');
  eq(originalDepois.dataUrl, rec2.dataUrl, '🔒 os bytes do original continuam os mesmos');
  ok(originalDepois.kind !== 'analise', '🔒 o original NÃO virou análise');
  ok(w2.eval('galCache').indexOf(novoId) >= 0, 'a análise aparece na galeria');
  const thumbAn = [...w2.document.querySelectorAll('#psFilm .ps-thumb[data-id]')].find(t => t.dataset.id === novoId);
  ok(!!thumbAn, 'e entra na tira como um cartão separado');
  ok(thumbAn.classList.contains('analise'), 'cartão da tira com a classe .analise');
  ok(/ANÁLISE/.test(thumbAn.textContent), 'selo ANÁLISE na tira de prints');
  eq(/Atualizar análise/.test(w2.document.getElementById('psDup').textContent), true,
    'aberta a análise, o 💾 vira "Atualizar análise"');
  eq(/ANÁLISE/.test(w2.document.getElementById('psMeta').textContent), true,
    'o painel de informações anuncia a categoria');

  /* ── galeria: cartão com selo + filtro exclusivo de análises ── */
  await w2.eval('closeShotViewer()'); await sleep(220);
  await w2.eval('renderGallery()'); await sleep(300);
  const cardsW2 = [...w2.document.querySelectorAll('#galGrid .shot-item')];
  const cardAn = cardsW2.find(c => c.classList.contains('analise'));
  ok(!!cardAn, 'a análise vira um cartão separado na galeria');
  ok(/ANÁLISE/.test(cardAn.textContent), 'com o selo ANÁLISE visível');
  ok(/Editar análise/.test(cardAn.textContent), 'e o convite "Editar análise"');
  ok(cardsW2.some(c => c.classList.contains('marked') && !c.classList.contains('analise')),
    'o original anotado continua listado à parte');
  w2.document.getElementById('galFilter').value = 'analise';
  await w2.eval('renderGallery()'); await sleep(250);
  eq(w2.document.querySelectorAll('#galGrid .shot-item').length, 1,
    'o filtro "💾 Análises salvas" isola só as análises');
  w2.document.getElementById('galFilter').value = '';
  await w2.eval('renderGallery()'); await sleep(200);

  /* ── a categoria viaja no backup ── */
  await w2.eval('(async()=>{ await exportData(); })()'); await sleep(250);
  const cap2 = w2.__capturedBlob();
  ok(!!cap2, 'backup da segunda janela gerado');
  const pack2 = JSON.parse(await cap2.text());
  eq(pack2.shots[novoId].kind, 'analise', 'o backup carrega kind=analise');

  /* ── reeditar a análise e salvar de novo: atualiza o MESMO registro ── */
  await openStudio(w2, 'gal', w2.eval('galCache').indexOf(novoId));
  await sleep(200);
  eq(w2.eval('PS.id'), novoId, 'reabre exatamente a análise salva');
  w2.eval("psSetTool('arrow')");
  const stAn = w2.document.getElementById('psStage');
  stAn.dispatchEvent(pointer(w2, 'pointerdown', 300, 200));
  w2.dispatchEvent(pointer(w2, 'pointermove', 520, 340));
  w2.dispatchEvent(pointer(w2, 'pointerup', 520, 340));
  await sleep(120);
  eq(w2.eval('PS.marks.length'), 1, 'dá para desenhar de novo por cima da análise');
  await w2.eval('(async()=>{ await psSaveAnalysis(); })()');
  await sleep(400);
  eq((await w2.eval('IMGDB.keys()')).length, keys2.length, '🔁 salvar de novo NÃO empilha outra cópia');
  const anUpd = await w2.eval(`IMGDB.get(${JSON.stringify(novoId)})`);
  eq(anUpd.kind, 'analise', 'continua sendo a mesma análise');
  eq(anUpd.marks.length, 0, 'as camadas viraram pixels do arquivo dela');
  ok(!anUpd.dataUrl, 'o arquivo antigo foi trocado pelo editado');
  ok(!!anUpd.blob, 'blob da análise regravado');
  eq(w2.eval('PS.marks.length'), 0, 'o estúdio recarrega limpo depois de atualizar');
  eq(w2.eval('PS.id'), novoId, 'e continua na mesma análise (sem trocar de print)');

  /* ── PDF do relatório usa a imagem anotada ── */
  const urlAnotada = await w2.eval(`psShotURL(${JSON.stringify(idAtual)},1600)`);
  ok(typeof urlAnotada === 'string' && urlAnotada.length > 10, 'psShotURL devolve imagem para o PDF', urlAnotada.slice(0, 24));
  const urlLimpa = await w2.eval(`psShotURL(${JSON.stringify(keys2.find(k => !pack.shots[k]))},1600)`);
  ok(typeof urlLimpa === 'string' && urlLimpa.length > 10, 'psShotURL também resolve print sem camadas');

  /* ── excluir print de dentro do estúdio ── */
  const antesDel = w2.eval('PS.list.length');
  await w2.eval('psSetTool("select")');
  await w2.eval('(async()=>{ await psDelete(); })()');
  await sleep(300);
  eq(w2.eval('PS.list.length'), antesDel - 1, 'excluir remove o print da tira');
  const keysFim = await w2.eval('IMGDB.keys()');
  ok(keysFim.indexOf(novoId) < 0 || keysFim.length === totalAntes, 'excluir apaga o registro do IndexedDB');

  /* ── app inteiro continua funcionando (nada da v1 quebrou) ── */
  const b3 = boot();
  const w3 = b3.win;
  await sleep(320);
  await runImport(w3, fs.readFileSync(FIXTURE, 'utf8'));
  await sleep(250);
  w3.eval("nav('operations',document.getElementById('navOps'))");
  await sleep(120);
  ok(w3.document.querySelectorAll('#opsTb tr').length > 3, 'lista de operações renderiza',
     `${w3.document.querySelectorAll('#opsTb tr').length} linhas`);
  const pReport = w3.rptOpen();
  for (let i = 0; i < 40 && w3.eval('RPTVER') < 1; i++) await sleep(150);
  await pReport;
  ok(w3.document.getElementById('rview').classList.contains('show'), 'relatório/PDF continua abrindo');
  /* período todo, só as fichas com print — mesmo ajuste usado no test-dom */
  w3.eval(`RPT.preset='tudo';RPT.cardMode='withShots';RPT.shotSize='mini';
    RPT.inc={kpi:false,compare:false,charts:false,daily:false,insights:false,ops:false,cards:true,gloss:false};`);
  const v0 = w3.eval('RPTVER');
  const pCards = w3.rptRender();
  for (let i = 0; i < 40 && w3.eval('RPTVER') <= v0; i++) await sleep(150);
  await pCards;
  await sleep(200);
  const rshots = w3.document.querySelectorAll('#rdoc .rshot img');
  eq(rshots.length, 12, 'PDF continua anexando os 12 prints do backup');
  ok([...rshots].every(i => /^data:|^blob:/.test(i.getAttribute('src') || '')),
     'as imagens do PDF têm src resolvido (originais ou anotadas)');

  console.log(fails ? `\n💥 ${fails} FALHA(S) no Estúdio de Prints v2` : '\n🎉 ESTÚDIO DE PRINTS v2 OK — TUDO PASSOU');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('\n💥 erro no teste:', e); process.exit(1); });
