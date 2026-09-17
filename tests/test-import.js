/* ------------------------------------------------------------------
   Teste de importação de backup com imagens (prints).

   Reproduz o bug relatado: importar um backup que POSSUI imagens e
   receber as operações SEM as imagens. A causa era dupla:
     1. dataURLtoBlob() usava fetch() em URLs "data:", o que falha em
        vários navegadores (Safari/iOS antigos, alguns modos do Edge);
     2. o laço de importação engolia os erros em silêncio — as imagens
        simplesmente não entravam, sem nenhum aviso.

   Aqui o app roda SEM fetch nenhum no ambiente (jsdom não implementa),
   então qualquer dependência de fetch() no caminho de importação
   faz o teste falhar.

   Rodar:  node tests/test-import.js   (ou: npm run test:import)
   Requer: npm install  (jsdom, fake-indexeddb)
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const HTML = path.join(__dirname, '..', 'edgecontrol-glass.html');
const FIXTURE = path.join(__dirname, '..', 'edgecontrol_2026-09-17 (1).json');
const html = fs.readFileSync(HTML, 'utf8');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* GIF 1x1 transparente em base64, para montar backups de teste */
const GIF_B64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const GIF_URL = 'data:image/gif;base64,' + GIF_B64;

function boot(savedLS, idbToShare, url) {
  /* idbToShare: passar o IndexedDB de outra janela simula "recarregar o app
     no mesmo navegador" (mesma origem => mesmo banco) */
  const idb = idbToShare || new IDBFactory();
  const win = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: url || 'https://edgecontrol.local/',
    beforeParse(w) {
      w.confirm = () => true;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.indexedDB = idb;                  // mesma instância => sobrevive ao "reload"
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
      w.Chart = class { constructor(c, cfg){ this.config = cfg || {}; } destroy(){} update(){} resize(){} reset(){} };
      w.Chart.defaults = {};
      // SEM fetch: jsdom não tem, e o app não pode depender dele aqui
      // SEM File.text() real: o app precisa cair no FileReader
      if (w.File) w.File.prototype.text = undefined;
      w.TextEncoder = TextEncoder;        // todo navegador real tem; jsdom não
      /* Blob do Node: o Blob do jsdom NÃO sobrevive ao structured clone do
         fake-indexeddb (volta um objeto vazio) — com o do Node os bytes
         realmente fazem o roundtrip, como num navegador de verdade. */
      w.Blob = Blob;
      /* o FileReader do jsdom não aceita Blob do Node: shim só para
         readAsDataURL (o caminho que o app usa para exibir em file://) */
      {
        const orig = w.FileReader.prototype.readAsDataURL;
        w.FileReader.prototype.readAsDataURL = function (blob) {
          try { return orig.call(this, blob); }
          catch (e) {
            blob.arrayBuffer().then(buf => {
              Object.defineProperty(this, 'result', {
                value: 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + Buffer.from(buf).toString('base64'),
                configurable: true
              });
              if (typeof this.onload === 'function') this.onload({ target: this });
              try { this.dispatchEvent(new w.Event('load')); } catch (_) {}
            }, () => { if (typeof this.onerror === 'function') this.onerror({ target: this }); });
          }
        };
      }
      if (savedLS) w.localStorage.setItem('ec7', savedLS);
    }
  }).window;
  return { win, idb };
}

async function runImport(w, backupObj) {
  const txt = typeof backupObj === 'string' ? backupObj : JSON.stringify(backupObj);
  const file = new w.File([txt], 'backup.json', { type: 'application/json' });
  return new Promise((res, rej) => {
    w.__ev = { target: { files: [file], value: '' } };
    w.eval('(async()=>{ await importData(window.__ev); })()').then(res, rej);
  });
}

(async () => {
  /* ── 1. dataURLtoBlob sem fetch ── */
  {
    const { win } = boot();
    await sleep(250);
    const blob = await win.eval(`dataURLtoBlob(${JSON.stringify(GIF_URL)})`);
    ok(blob && blob.size > 0, 'dataURLtoBlob funciona sem fetch()', blob ? `size=${blob.size} type=${blob.type}` : '');
    const blob2 = await win.eval(`dataURLtoBlob('data:text/plain,Ol%C3%A1%20mundo')`);
    ok(blob2 && blob2.size === 10, 'dataURLtoBlob aceita data: URL sem base64', blob2 ? `size=${blob2.size}` : '');
    let errorou = false;
    try { await win.eval(`dataURLtoBlob('https://exemplo.com/img.png')`); } catch (e) { errorou = true; }
    ok(errorou, 'dataURLtoBlob rejeita URL que não é data:');
  }

  /* ── 2. importação do backup REAL (com 12 imagens) ── */
  {
    const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const nImgs = Object.keys(backup.shots || {}).length;
    ok(nImgs === 12, 'fixture tem 12 prints', `encontrados: ${nImgs}`);

    const boot1 = boot();
    const win = boot1.win;
    await sleep(250);
    await runImport(win, fs.readFileSync(FIXTURE, 'utf8'));
    await sleep(150);

    const keys = await win.eval('IMGDB.keys()');
    ok(Array.isArray(keys) && keys.length === 12, 'os 12 prints entraram no IndexedDB', `chaves: ${keys.length}`);
    ok(keys.every(k => String(k).startsWith('shot_')), 'ids dos prints preservados');

    const total = await win.eval('IMGDB.all().then(a=>a.reduce((t,r)=>t+(r.size||0),0))');
    const esperado = Object.values(backup.shots).reduce((t, s) => {
      const m = /^data:[^;,]*;base64,(.*)$/s.exec(s.d);
      return t + Math.floor(m[1].length * 3 / 4);
    }, 0);
    ok(Math.abs(total - esperado) < 300, 'bytes das imagens íntegros', `total=${total} esperado≈${esperado}`);

    const nOps = win.eval('S.operations.length');
    const comShots = win.eval('S.operations.filter(o=>(o.shots||[]).length).length');
    ok(nOps === backup.state.operations.length, 'operações importadas', `${nOps}/${backup.state.operations.length}`);
    ok(comShots === 6, '6 operações vinculadas aos prints', `${comShots}`);
    const ls = win.localStorage.getItem('ec7');
    ok(ls && ls.includes('shot_mu5f7usxlhlpb'), 'estado salvo referencia os prints (localStorage)');

    // detalhe da operação renderiza as miniaturas
    const firstId = win.eval('S.operations.find(o=>(o.shots||[]).length).id');
    win.eval(`openDet('${firstId}')`);
    await sleep(200);
    const detImgs = win.document.querySelectorAll('#detShots img').length;
    ok(detImgs === 2, 'miniaturas no detalhe da operação', `${detImgs} imgs`);

    // galeria mostra todas
    win.eval('openGallery()');
    await sleep(200);
    const galImgs = win.document.querySelectorAll('#galGrid img').length;
    ok(galImgs === 12, 'galeria exibe os 12 prints', `${galImgs} imgs`);

    /* ── 3. "recarrega" o app: prints precisam sobreviver ao gcShots ── */
    const saved = win.localStorage.getItem('ec7');
    const boot2 = boot(saved, boot1.idb);            // mesma origem: mesmo IndexedDB
    await sleep(400); // init() roda gcShots()
    const keys2 = await boot2.win.eval('IMGDB.keys()');
    ok(Array.isArray(keys2) && keys2.length === 12, 'após recarregar, os prints continuam lá', `chaves: ${keys2.length}`);
    const comShots2 = boot2.win.eval('S.operations.filter(o=>(o.shots||[]).length).length');
    ok(comShots2 === 6, 'vínculo op↔print persiste após recarregar', `${comShots2}`);
  }

  /* ── 4. backup v1 antigo (estado na raiz, imagem embutida em op.img) ── */
  {
    const v1 = {
      profile: { name: 'Trader', avatar: '', avatarData: '', logo: '' },
      settings: { initialCapital: 100, currentCapital: 100, usdRate: 5, stopLoss: 8, target: 12 },
      operations: [{
        id: '111', date: '2026-01-10', time: '10:00', value: 50, usd: 10, result: 'WIN',
        type: 'CALL', reason: 'teste', plan: 'yes', img: GIF_URL, yt: '', notes: '',
        shots: [], createdAt: '2026-01-10T10:00:00.000Z'
      }]
    };
    const { win } = boot();
    await sleep(250);
    await runImport(win, v1);
    await sleep(150);
    const keys = await win.eval('IMGDB.keys()');
    ok(keys.length === 1 && keys[0] === 'shot_imp_111', 'imagem embutida v1 (op.img) virou print', `chaves: ${JSON.stringify(keys)}`);
    const op = win.eval('S.operations[0]');
    ok(op.img === '' && (op.shots || []).length === 1, 'operação v1 vinculada ao print e sem img inline');
  }

  /* ── 5. variação de formato: shots como lista e dentro do estado ── */
  {
    const pack = {
      __ec: 3, exportedAt: '2026-09-17T00:00:00.000Z',
      state: {
        profile: {}, settings: { initialCapital: 1, currentCapital: 1, usdRate: 5, stopLoss: 8, target: 12 },
        operations: [{ id: '222', date: '2026-01-11', time: '09:00', value: 10, usd: 2, result: 'WIN', type: 'PUT', reason: 'x', plan: 'yes', img: '', yt: '', notes: '', shots: ['sA'], createdAt: '' }],
        shots: [{ id: 'sA', d: GIF_URL, note: 'nota', name: 'a.gif', at: '' }]  // lista, dentro do state
      }
    };
    const { win } = boot();
    await sleep(250);
    await runImport(win, pack);
    await sleep(150);
    const keys = await win.eval('IMGDB.keys()');
    ok(keys.length === 1 && keys[0] === 'sA', 'aceita shots em lista dentro do state', `chaves: ${JSON.stringify(keys)}`);
  }

  /* ── 6. referências sem imagens: app AVISA em vez de mostrar nada ──
         (era o sintoma "diz que tem prints anexados mas não mostra nada") */
  {
    const pack = {
      __ec: 3, exportedAt: '2026-09-17T00:00:00.000Z',
      state: {
        profile: {}, settings: { initialCapital: 1, currentCapital: 1, usdRate: 5, stopLoss: 8, target: 12 },
        operations: [{ id: '333', date: '2026-01-12', time: '08:00', value: 10, usd: 2, result: 'WIN', type: 'PUT', reason: 'x', plan: 'yes', img: '', yt: '', notes: '', shots: ['shot_lixo_1', 'shot_lixo_2'], createdAt: '' }]
        /* SEM mapa de shots: imagens não vêm no backup */
      }
    };
    const { win } = boot();
    await sleep(250);
    const ausente = await win.eval("IMGDB.get('shot_lixo_1')");
    ok(ausente === undefined || ausente === null, 'IMGDB.get de chave inexistente resolve undefined (não o request)', `veio: ${typeof ausente}`);
    await runImport(win, pack);
    await sleep(150);
    win.eval("openDet('333')");
    await sleep(200);
    const detHtml = (win.document.getElementById('detShots') || {}).innerHTML || '';
    ok(detHtml.includes('não estão no armazenamento'), 'detalhe da operação avisa prints ausentes', detHtml.slice(0, 90));
    ok(!detHtml.includes('src="null"'), 'sem miniaturas quebradas (src="null")');
    win.eval('openGallery()');
    await sleep(200);
    const emTxt = (win.document.getElementById('galEmpty') || {}).innerHTML || '';
    ok(emTxt.includes('ausentes do armazenamento'), 'galeria diferencia "sem prints" de "prints ausentes"', emTxt.slice(0, 80));
  }

  /* ── 7. app aberto com DOIS CLIQUES (file://): exibe via data: URL ──
         blob: URL com origem "null" não carrega em <img> nesse contexto */
  {
    const pack = {
      __ec: 3, exportedAt: '2026-09-17T00:00:00.000Z',
      state: {
        profile: {}, settings: { initialCapital: 1, currentCapital: 1, usdRate: 5, stopLoss: 8, target: 12 },
        operations: [{ id: '444', date: '2026-01-13', time: '07:00', value: 10, usd: 2, result: 'WIN', type: 'PUT', reason: 'x', plan: 'yes', img: '', yt: '', notes: '', shots: ['sF'], createdAt: '' }]
      },
      shots: { sF: { d: GIF_URL, note: '', name: 'f.gif', at: '' } }
    };
    const { win } = boot(null, null, 'file:///C:/EdgeControl/edgecontrol-glass.html');
    await sleep(300);
    await runImport(win, pack);
    await sleep(150);
    const u = await win.eval("imgURL('sF')");
    ok(typeof u === 'string' && u.startsWith('data:'), 'file://: imgURL devolve data: URL (não blob:)', String(u).slice(0, 40));
    win.eval("openDet('444')");
    await sleep(250);
    const img = win.document.querySelector('#detShots img');
    ok(img && String(img.getAttribute('src')).startsWith('data:'), 'file://: miniatura do detalhe renderiza com data: URL', img ? String(img.getAttribute('src')).slice(0, 40) : 'sem <img>');
    win.eval('openGallery()');
    await sleep(250);
    const gal = ((win.document.getElementById('galGrid') || {}).innerHTML || '');
    ok(gal.includes('src="data:'), 'file://: galeria também com data: URLs', gal.slice(0, 60));
  }

  console.log(fails ? `\n${fails} teste(s) FALHARAM` : '\nTodos os testes de importação passaram ✅');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO no teste:', e); process.exit(1); });
