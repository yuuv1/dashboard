/* ------------------------------------------------------------------
   Teste de integração do app inteiro em jsdom: navegação, relatório,
   tabelas (com os invólucros .rtbl-wrap), temas, impressão e estado.

   Rodar:  npm run test:dom       (ou: node tests/test-dom.js)
   Requer: npm install  (jsdom)
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = path.join(__dirname, '..', 'edgecontrol-glass.html');
const FIXTURE = path.join(__dirname, '..', 'edgecontrol_2026-09-03.json');
const html = fs.readFileSync(HTML, 'utf8');
const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://edgecontrol.local/',
    beforeParse(w) {
      w.__printed = 0;
      w.print = () => { w.__printed++; };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      // canvas: o app desenha gráficos; em jsdom basta um contexto falso
      const ctx = new Proxy({}, {
        get: (t, k) => {
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
          if (k === 'canvas') return null;
          return () => ({});
        }
      });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      // Chart.js não é carregado (CDN bloqueada): dublê mínimo
      w.Chart = class { constructor(){ this.destroy = () => {}; } destroy(){} };
      w.Chart.defaults = {};
      w.URL.createObjectURL = () => 'blob:mock';
      w.URL.revokeObjectURL = () => {};
      // imagens "carregam" na hora (jsdom não busca rede)
      Object.defineProperty(w.HTMLImageElement.prototype, 'complete', { get(){ return true; } });
      Object.defineProperty(w.HTMLImageElement.prototype, 'naturalWidth', { get(){ return 12; } });
    }
  });

  const d = dom.window.document;
  const w = dom.window;
  const ev = code => w.eval(code);
  const txt = () => d.getElementById('rdoc').textContent.replace(/\s+/g, ' ');
  const errors = [];
  w.addEventListener('error', e => errors.push(String(e.message || e)));
  const origError = w.console.error;
  w.console.error = (...a) => { errors.push(a.join(' ')); origError.apply(w.console, a); };

  /* espera o render "assentar": nada em andamento e nenhum novo render pendente
     (o rptRender tem fila, então um único incremento de RPTVER não basta) */
  const fresh = async fn => {
    fn();
    await sleep(80);
    let last = -1, estavel = 0;
    for (let i = 0; i < 100; i++) {
      await sleep(120);
      const v = ev('RPTVER'), busy = ev('RPTBUSY');
      if (v === last && !busy) { if (++estavel >= 2) return; } else estavel = 0;
      last = v;
    }
    throw new Error('render não concluiu');
  };

  await sleep(600);
  ok(ev('typeof S') === 'object', 'app inicializou (estado S existe)');
  ok(!!d.getElementById('page-report'), 'página Relatório existe no DOM');

  /* injeta o backup de exemplo */
  ev(`S.operations=${JSON.stringify(backup.state.operations)};S.settings=Object.assign(S.settings,${JSON.stringify(backup.state.settings)});`);
  ok(ev('S.operations.length') === 37, 'backup de exemplo carregado (37 operações)');

  /* ── página do relatório: controles ─────────────────────────────── */
  w.nav('report', d.getElementById('navReport'));
  ok(d.getElementById('page-report').classList.contains('active'), 'navegação abre a página Relatório');
  ok(d.querySelectorAll('#rpChips .rchip').length >= 7, 'chips de período montados', String(d.querySelectorAll('#rpChips .rchip').length));
  ok(d.querySelectorAll('#rpThemeRow .rsw-b').length === 4, '4 temas de relatório');
  ok(d.querySelectorAll('#rpOpts input').length === 8, '8 seções para marcar');
  // o padrão é "Este mês": o backup termina em 03/09/2026, então setembro tem 5 operações
  ok(ev('RPT.preset') === 'mes', 'período padrão é "Este mês"');
  ok(/5 operação/.test(d.getElementById('rpInfo').textContent), 'prévia do mês corrente (5 operações)',
     d.getElementById('rpInfo').textContent.trim().slice(0, 52));
  ok(!/null|NaN/.test(d.getElementById('rpInfo').textContent), 'prévia sem null/NaN');
  // clicar no chip "Tudo" (como o usuário faz) traz o período completo
  d.querySelector('#rpChips .rchip[data-p="tudo"]').click();
  await sleep(120);
  ok(/37 operação/.test(d.getElementById('rpInfo').textContent), 'chip "Tudo" cobre as 37 operações',
     d.getElementById('rpInfo').textContent.trim().slice(0, 52));
  ok(/24\/07\/2026/.test(d.getElementById('rpInfo').textContent), 'chip "Tudo" começa na 1ª operação registrada');
  // e os campos de data acompanham o preset
  ok(d.getElementById('rpFrom').value === '2026-07-24', 'campo "De" sincronizado com o preset',
     d.getElementById('rpFrom').value);

  /* ── abre o relatório ───────────────────────────────────────────── */
  const p1 = w.rptOpen();
  for (let i = 0; i < 40 && ev('RPTVER') < 1; i++) await sleep(150);
  await p1;
  ok(d.getElementById('rview').classList.contains('show'), 'overlay do relatório aberto');
  ok(d.body.classList.contains('rpt-open'), 'body travado com .rpt-open (FAB/PWA não flutuam por cima)');
  ok(d.getElementById('rdoc').dataset.ready === '1', 'documento montado');

  const secs = d.querySelectorAll('#rdoc .rsec');
  ok(secs.length === 8, '8 seções montadas', String(secs.length));

  /* ── tabelas: invólucro rolável + classes de coluna (correção de recorte) ── */
  const wraps = () => d.querySelectorAll('#rdoc .rtbl-wrap');
  ok([...wraps()].every(x => x.querySelector('table.rtbl')), 'todo invólucro de tabela contém uma tabela');
  ok(!!d.querySelector('#rdoc table.rtbl-ops') && !!d.querySelector('#rdoc table.rtbl-daily'),
     'tabelas de operações e dia a dia com classe de colunas');
  // período "Tudo": não existe período anterior, então a comparação sai sem tabela
  ok(wraps().length === 2, 'período sem anterior: 2 tabelas com invólucro', String(wraps().length));
  ok(/não há o que comparar/.test(txt()), 'comparação avisa quando não há período anterior');
  ok(d.querySelectorAll('#rdoc .rtbl-ops tbody tr').length === 37, 'tabela de operações com 37 linhas');
  ok(d.querySelectorAll('#rdoc .rtbl-daily tbody tr').length === 24, 'tabela dia a dia com 24 linhas');
  ok(/R\$ 189,89/.test(txt()), 'resultado do período aparece (R$ 189,89)');
  ok(/492,57/.test(txt()), 'capital final aparece (492,57)');
  ok(/1,65/.test(txt()), 'profit factor aparece (1,65)');
  ok(!/NaN|undefined/.test(txt()), 'nenhum NaN/undefined no documento');

  // mês passado: agora existe período anterior -> 3 tabelas, incluindo a comparação
  d.querySelector('#rpChips .rchip[data-p="mespassado"]').click();
  await sleep(120);
  for (let i = 0; i < 40 && ev('RPTBUSY'); i++) await sleep(120);
  ok(!!d.querySelector('#rdoc table.rtbl-cmp'), 'comparação com classe de colunas quando há período anterior');
  ok(wraps().length === 3, 'mês passado: 3 tabelas com invólucro rolável', String(wraps().length));
  ok(/Variação/.test(txt()), 'comparação traz a coluna de variação');
  ok(d.querySelectorAll('#rdoc .rtbl-ops tbody tr').length === 24, 'mês passado: 24 operações na tabela');
  const diasAgo = d.querySelectorAll('#rdoc .rtbl-daily tbody tr').length;
  ok(diasAgo > 0 && diasAgo < 24, 'mês passado: só os dias operados na tabela dia a dia', String(diasAgo));
  await fresh(() => w.rptSetPreset('tudo'));
  ok(d.querySelectorAll('#rdoc .rtbl-daily tbody tr').length === 24, 'período completo: 24 dias na tabela dia a dia');

  /* ── temas ──────────────────────────────────────────────────────── */
  await fresh(() => w.rptSetTheme('escuro'));
  ok(d.getElementById('rview').dataset.rtheme === 'escuro', 'tema escuro aplicado');
  ok(d.querySelector('#rbarThemes .rth .rth-n'), 'nomes dos temas na barra (escondidos só no celular)');
  await fresh(() => w.rptSetTheme('papel'));
  ok(d.getElementById('rview').dataset.rtheme === 'papel', 'tema papel aplicado');
  ok(ev('RPT.theme') === 'papel' && ev('S.report.theme') === 'papel', 'tema salvo no estado');

  /* ── filtros e seções ───────────────────────────────────────────── */
  d.getElementById('rfRes').value = 'WIN';
  await fresh(() => w.rptCfgChange());
  ok(ev('RPT.filt.res') === 'WIN', 'filtro WIN registrado');
  ok(/24 operação/.test(d.getElementById('rbarSub').textContent), 'contador reflete o filtro', d.getElementById('rbarSub').textContent);
  d.getElementById('rfRes').value = '';
  await fresh(() => w.rptCfgChange());

  const gloss = [...d.querySelectorAll('#rpOpts input')].find(c => c.dataset.k === 'gloss');
  gloss.checked = false;
  await fresh(() => w.rptCfgChange());
  ok(d.querySelectorAll('#rdoc .rsec').length === 7, 'seção desmarcada sai do documento');
  ok(!/Como ler este relatório/.test(txt()), 'glossário removido');
  gloss.checked = true;

  d.getElementById('rpCardMode').value = 'all';
  await fresh(() => w.rptCfgChange());
  ok(d.querySelectorAll('#rdoc .rop').length === 37, '37 fichas de operação', String(d.querySelectorAll('#rdoc .rop').length));
  ok([...d.querySelectorAll('#rdoc .rop')].every(c => c.querySelector('.rop-h') && c.querySelector('.rop-d')),
     'toda ficha tem cabeçalho com data e resultado');
  d.getElementById('rpCardMode').value = 'withShots';
  await fresh(() => w.rptCfgChange());
  ok(/Nenhuma operação do período tem print anexado/.test(txt()), 'aviso quando não há prints');

  /* ── presets de período ─────────────────────────────────────────── */
  await fresh(() => w.rptSetPreset('mespassado'));
  ok(d.getElementById('rdoc').dataset.ready === '1' && /01\/08\/2026/.test(txt()), 'preset mês passado renderiza');
  await fresh(() => w.rptSetPreset('tudo'));

  /* ── avatar sem foto: data URI local ───────────────────────────── */
  const prof = ev("(function(){var a=S.profile.avatarData,b=S.profile.avatar;S.profile.avatarData='';S.profile.avatar='';return [a,b];})()");
  await fresh(() => w.rptRender());
  const av = d.querySelector('#rdoc .rcov-av');
  ok(!!av && /^data:image\/svg\+xml/.test(av.getAttribute('src') || ''), 'sem foto: avatar local em data URI');
  ev('S.profile.avatarData=' + JSON.stringify(prof[0] || '') + ';S.profile.avatar=' + JSON.stringify(prof[1] || '') + ';');
  await fresh(() => w.rptRender());

  /* ── impressão e fechamento ─────────────────────────────────────── */
  await w.rPrint();
  await sleep(900);
  ok(w.__printed === 1, 'window.print() chamado', String(w.__printed));
  w.closeReportView();
  ok(!d.getElementById('rview').classList.contains('show'), 'overlay fechado');
  ok(!d.body.classList.contains('rpt-open'), 'body destravado ao fechar');
  w.rptOpen();
  ok(ev('RPT.theme') === 'papel', 'tema do relatório persistido entre aberturas');
  const key = (k, o) => d.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})));
  key('Escape');
  ok(!d.getElementById('rview').classList.contains('show'), 'Escape fecha o relatório');
  key('p', { ctrlKey: true });
  ok(d.getElementById('rview').classList.contains('show'), 'Ctrl+P abre o relatório');
  for (let i = 0; i < 40 && w.__printed < 2; i++) await sleep(150);
  ok(w.__printed === 2, 'Ctrl+P dispara a impressão do relatório', String(w.__printed));
  w.closeReportView();

  /* ── sem operações ──────────────────────────────────────────────── */
  ev('S.operations=[];');
  await fresh(() => w.rptRender());
  ok(d.getElementById('rdoc').dataset.ready === '1', 'relatório sem operações renderiza');
  ok(!/NaN|undefined/.test(txt()), 'sem operações: nada de NaN/undefined');
  ok(d.querySelectorAll('#rdoc .rsec').length >= 1, 'sem operações: mantém seções');

  /* ── persistência ───────────────────────────────────────────────── */
  const saved = JSON.parse(w.localStorage.getItem('ec7'));
  ok(!!(saved && saved.report), 'preferências do relatório no localStorage');
  ok(errors.length === 0, 'nenhum erro de JS', errors.slice(0, 3).join(' | '));

  console.log(fails ? `\n❌ ${fails} FALHA(S)` : '\n🎉 INTEGRAÇÃO OK — TODOS OS TESTES PASSARAM');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('💥 exceção no teste:', e); process.exit(1); });
