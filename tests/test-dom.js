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
      w.Chart = class {
        constructor(ctx, cfg){ this.ctx = ctx; this.config = cfg || {}; }
        get data(){ return this.config.data || {}; }
        get options(){ return this.config.options || {}; }
        destroy(){} update(){} resize(){} reset(){}
      };
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

  /* ── cadastro rápido + migração + novos catálogos ─────────────── */
  const initialRpt = ev('JSON.stringify(RPT)');
  const legacyState = {
    settings: { initialCapital: 100, currentCapital: 100, usdRate: 5, stopLoss: 5, target: 2.5 },
    operations: [
      { id: 'legacy-pair', date: '2026-09-01', time: '09:00', value: 10, usd: 2, result: 'WIN', type: 'EUR/USD', reason: '', plan: 'yes' },
      { id: 'legacy-dir', date: '2026-09-01', time: '10:00', value: 5, usd: 1, result: 'LOSS', type: 'PUT', reason: '', plan: '' }
    ]
  };
  w.localStorage.setItem('ec7', JSON.stringify(legacyState));
  ev('load()');
  ok(ev("S.operations.find(o=>o.id==='legacy-pair').asset") === 'EUR/USD', 'load(): type antigo com par migra para asset');
  ok(ev("S.operations.find(o=>o.id==='legacy-pair').direction") === '', 'load(): par antigo não vira direção');
  ok(ev("S.operations.find(o=>o.id==='legacy-dir').direction") === 'PUT', 'load(): CALL/PUT antigo migra para direção');
  ok(ev('S.assets.length') >= 6 && ev("S.assets.includes('GBP/USD')"), 'load(): seis ativos do histórico vêm semeados');
  ok(ev('Array.isArray(S.operationals) && S.operationals.length===0'), 'migração cria lista de operacionais vazia');

  w.localStorage.clear();
  ev(`S=migrateState({settings:{initialCapital:100,currentCapital:100,usdRate:5,stopLoss:5,target:2.5},operations:[],operationals:[]});ensureChartState();refreshAssetUI();`);
  w.openNewOpModal();
  ok(!!d.getElementById('opDate').value && !!d.getElementById('opTime').value, 'nova operação preenche data e hora atuais');
  d.getElementById('opDate').value = ''; // até data/hora podem ficar vazias: só valor + resultado são obrigatórios
  d.getElementById('opTime').value = '';
  d.getElementById('opVal').value = '25';
  d.getElementById('opRes').value = 'WIN';
  w.saveOp();
  ok(ev('S.operations.length') === 1, 'salva WIN só com valor + resultado');
  ok(ev("(()=>{const o=S.operations[0];return o.asset===''&&o.direction===''&&o.reason===''&&o.plan===''&&o.operationals.length===0;})()"),
     'todos os demais campos ficam opcionais e vazios');
  ok(ev('S.settings.currentCapital') === 125, 'WIN mínimo soma o valor ao capital');
  ok(!d.getElementById('newOpModal').classList.contains('show'), 'modal fecha depois do cadastro mínimo');
  w.openDet(ev('S.operations[0].id'));
  const minimalDetail = d.getElementById('detBod').textContent.replace(/\s+/g, ' ');
  ok(/Ativo \/ Par\s*—/.test(minimalDetail) && /Operacionais\s*—/.test(minimalDetail) && /Direção\s*—/.test(minimalDetail),
     'detalhes mostram travessão para campos opcionais vazios');
  w.closeMod('opDetMod');

  w.openNewOpModal();
  d.getElementById('opVal').value = '10';
  d.getElementById('opRes').value = 'LOSS';
  w.saveOp();
  ok(ev('S.operations.length') === 2, 'salva LOSS só com valor + resultado');
  ok(ev('S.settings.currentCapital') === 115, 'LOSS mínimo subtrai o valor do capital');

  /* ativo novo: salva, persiste e reaparece em todas as listas */
  w.openNewOpModal();
  d.getElementById('opVal').value = '12';
  d.getElementById('opRes').value = 'WIN';
  d.getElementById('opAsset').value = 'XAU/USD';
  w.saveOp();
  ok(ev("S.operations[S.operations.length-1].asset") === 'XAU/USD', 'operação guarda o novo ativo');
  ok(ev("S.assets.includes('XAU/USD')"), 'ativo novo entra no catálogo');
  ok(JSON.parse(w.localStorage.getItem('ec7')).assets.includes('XAU/USD'), 'catálogo de ativos persiste no ec7');
  ev('S=makeInitialState();load();refreshAssetUI();');
  ok(ev("S.assets.includes('XAU/USD')"), 'ativo continua no catálogo depois de recarregar o ec7');
  ok(!!d.querySelector('#opAssetList option[value="XAU/USD"]'), 'ativo reaparece para selecionar no formulário');
  ok(!!d.querySelector('#fType option[value="XAU/USD"]'), 'ativo reaparece no filtro de operações');
  w.rptBuildTypes();
  ok(!!d.querySelector('#rfType option[value="XAU/USD"]'), 'ativo reaparece no filtro do relatório');

  /* dois operacionais criados no modal, ambos marcados e restaurados na edição */
  w.openNewOpModal();
  d.getElementById('opOperationalNew').value = 'Rompimento'; w.quickAddOperational();
  d.getElementById('opOperationalNew').value = 'Pullback'; w.quickAddOperational();
  ok(d.querySelectorAll('#opOperationals input:checked').length === 2, 'criação rápida já marca os 2 operacionais');
  d.getElementById('opVal').value = '7';
  d.getElementById('opRes').value = 'LOSS';
  d.getElementById('opAsset').value = 'XAU/USD';
  w.saveOp();
  const operationalOpId = ev('S.operations[S.operations.length-1].id');
  ok(ev('S.operations[S.operations.length-1].operationals.length') === 2, 'operação salva array com 2 operacionais');
  ev('S=makeInitialState();load();refreshAssetUI();');
  w.editOp(operationalOpId);
  ok(d.querySelectorAll('#opOperationals input:checked').length === 2, 'os 2 operacionais voltam marcados na edição');
  w.closeMod('newOpModal');
  d.getElementById('fType').value = 'XAU/USD'; w.applyFilter();
  ok(d.querySelectorAll('#opsTb tr').length === 2, 'filtro da lista encontra operações pelo ativo real');
  w.clearFilter();

  /* seção Configurações: adicionar, renomear e apagar */
  w.loadSetForm();
  ok(d.querySelectorAll('#operationalSettingsList .cfg-list-row').length === 2, 'Configurações lista os operacionais');
  d.getElementById('sOperational_0').value = 'Breakout'; w.renameOperational(0);
  ok(ev("S.operationals.includes('Breakout') && S.operations.some(o=>o.operationals.includes('Breakout'))"),
     'renomear atualiza o catálogo e as operações');
  d.getElementById('sOperationalNew').value = 'Temporário'; w.addOperationalSetting();
  w.confirm = () => true;
  const tempIndex = ev("S.operationals.indexOf('Temporário')");
  w.deleteOperational(tempIndex);
  ok(!ev("S.operationals.includes('Temporário')"), 'apagar remove o operacional da lista');

  /* relatório e gráficos aceitam contexto preenchido e vazio */
  w.nav('analytics', null);
  ok(ev("CH.anCP.data.labels.includes('XAU/USD') && CH.anCP.data.labels.includes('(sem ativo)')"),
     'gráfico de performance agrupa ativos reais e operações sem ativo');
  ok(ev("CH.anO.data.labels.includes('Breakout') && CH.anO.data.labels.includes('Pullback')"),
     'gráfico de performance agrupa por operacional');
  ok(ev('CH.anDir.data.labels.length===0'), 'gráfico de direção vazio não quebra quando direção é opcional');
  ev("RPT.preset='tudo';RPT.cardMode='all';RPT.filt={res:'',type:'',plan:''};");
  await fresh(() => w.rptRender());
  ok(!!d.getElementById('rch_type') && !!d.getElementById('rch_operational'), 'relatório cria gráficos de ativo e operacional');
  ok(ev("RCH.type.data.labels.includes('XAU/USD') && RCH.operational.data.labels.includes('Breakout')"),
     'gráficos do relatório recebem ativos e operacionais');
  ok(d.querySelectorAll('#rdoc .rtbl-ops tbody tr').length === 4, 'relatório inclui operações com campos preenchidos e vazios');
  ok(/Ativo \/ Par/.test(txt()) && /Breakout/.test(txt()) && /—/.test(txt()), 'relatório mostra contexto e travessão nos campos vazios');
  ok(!/NaN|undefined/.test(txt()), 'relatório com ativos/operacionais preenchidos e vazios não quebra');

  const v3Backup = ev("JSON.stringify({__ec:3,state:S,shots:{}})");
  await w.importData({ target: { files: [{ text: async () => v3Backup }], value: 'backup.json' } });
  ok(ev("S.assets.includes('XAU/USD') && S.operationals.includes('Breakout')"),
     'importação v3 restaura junto as listas de ativos e operacionais');

  /* restaura o backup de exemplo para a suíte histórica */
  w.localStorage.clear();
  ev(`S=migrateState(${JSON.stringify(backup.state)});ensureChartState();RPT=JSON.parse(${JSON.stringify(initialRpt)});refreshAssetUI();`);
  ok(ev('S.operations.length') === 37, 'backup de exemplo carregado (37 operações)');
  ok(ev("S.operations.every(o=>Object.prototype.hasOwnProperty.call(o,'asset'))"), 'backup inteiro passou pela migração de ativo');

  /* ── página do relatório: controles ─────────────────────────────── */
  w.nav('report', d.getElementById('navReport'));
  ok(d.getElementById('page-report').classList.contains('active'), 'navegação abre a página Relatório');
  ok(d.querySelectorAll('#rpChips .rchip').length >= 7, 'chips de período montados', String(d.querySelectorAll('#rpChips .rchip').length));
  ok(d.querySelectorAll('#rpThemeRow .rsw-b').length === 5, '5 temas de relatório (inclui Automático)', String(d.querySelectorAll('#rpThemeRow .rsw-b').length));
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

  /* ── gráficos avançados dentro do relatório ── */
  const rids=['rch_dd','rch_seq','rch_scat','rch_buck'];
  ok(rids.every(id=>d.getElementById(id)), 'relatório tem os canvas dos gráficos avançados',
     rids.filter(id=>!d.getElementById(id)).join(','));
  ok(/Maior queda:/.test(d.getElementById('rch_dd_note').textContent), 'relatório: nota do drawdown');
  ok(/média/.test(d.getElementById('rch_seq_note').textContent), 'relatório: nota da sequência de entradas',
     d.getElementById('rch_seq_note').textContent.slice(0,58));
  ok(/Correlação/.test(d.getElementById('rch_scat_note').textContent), 'relatório: nota da dispersão');
  ok(/Melhor faixa:/.test(d.getElementById('rch_buck_note').textContent), 'relatório: nota das faixas de valor');
  ok(d.querySelectorAll('#rch_cal .cal-d').length>=35, 'relatório: calendário de resultados montado',
     String(d.querySelectorAll('#rch_cal .cal-d').length));
  ok(d.querySelectorAll('#rch_cal .cal-d.op').length===24, 'relatório: calendário marca os 24 dias operados',
     String(d.querySelectorAll('#rch_cal .cal-d.op').length));
  ok(ev("Object.keys(RCH).filter(k=>['dd','seq','scat','buck'].indexOf(k)>=0).length===4"),
     'relatório: os 4 gráficos em canvas desenhados',
     ev("Object.keys(RCH).join(',')"));
  ok(ev("(()=>{const c=RCH.dd;return c.data.datasets[0].borderColor===rptPal().neg;})()"),
     'relatório: drawdown na cor de loss do tema do relatório');
  ok(ev("(()=>{const b=RCH.buck.data.datasets[0].backgroundColor;return b.length===4&&b.every(c=>/rgba|#/.test(c));})()"),
     'relatório: faixas coloridas por sinal');

  /* ── BUG CORRIGIDO: a meta do dia não pode fugir quando o capital sobe ──
     Cenário do usuário: capital no início do dia 500, stop 8% → R$ 40,
     meta 12% → R$ 60. Lançar o WIN de 60 leva o capital a 560; a meta e o stop
     têm de continuar ancorados no capital de INÍCIO do dia (500). */
  ev(`S.settings.initialCapital=500;S.settings.currentCapital=500;S.settings.stopLoss=8;
      S.settings.target=12;S.operations=[];`);
  w.updateDash();
  const tHoje = new Date().toISOString().slice(0, 10);
  ok(d.getElementById('dashTgt').textContent.includes('60,00'), 'meta do dia = 12% do capital inicial do dia (R$ 60)',
     d.getElementById('dashTgt').textContent);
  ok(d.getElementById('dashStop').textContent.includes('40,00'), 'stop do dia = 8% do capital inicial do dia (R$ 40)',
     d.getElementById('dashStop').textContent);
  /* lança o WIN de 60 (como o app faz: capital sobe junto) */
  ev("S.operations.push({id:'t1',date:" + JSON.stringify(tHoje) + ",time:'09:00',value:60,result:'WIN',type:'EUR/USD',plan:'yes',usd:12});S.settings.currentCapital=560;");
  w.updateDash();
  ok(d.getElementById('dashTgt').textContent.includes('60,00'),
     'meta continua R$ 60 depois do ganho (não pula para R$ 67,20)', d.getElementById('dashTgt').textContent);
  ok(/Target atingido/i.test(d.getElementById('alertBar').textContent),
     'app reconhece a meta batida', d.getElementById('alertBar').textContent.slice(0, 40));
  ok(d.getElementById('tgtPct').textContent === '100%', 'progresso da meta em 100%', d.getElementById('tgtPct').textContent);
  ok(/500,00/.test(d.getElementById('dayAnchor').textContent), 'rótulo mostra o capital do início do dia',
     d.getElementById('dayAnchor').textContent);
  /* perda do dia não move o stop tampouco */
  ev("S.operations.push({id:'t2',date:" + JSON.stringify(tHoje) + ",time:'10:00',value:20,result:'LOSS',type:'EUR/USD',plan:'yes',usd:4});S.settings.currentCapital=540;");
  w.updateDash();
  ok(d.getElementById('dashStop').textContent.includes('40,00'), 'stop segue R$ 40 com perda no dia',
     d.getElementById('dashStop').textContent);
  ok(d.getElementById('dashTgt').textContent.includes('60,00'), 'meta segue R$ 60 com perda no dia');
  /* sem operação hoje, a âncora é o próprio capital */
  ev('S.operations=[];S.settings.currentCapital=777;');
  w.updateDash();
  ok(d.getElementById('dashTgt').textContent.includes('93,24'), 'sem operação hoje: meta = 12% do capital atual',
     d.getElementById('dashTgt').textContent);

  /* ── gráficos avançados do painel Analytics ── */
  ev(`S.operations=${JSON.stringify(backup.state.operations)};S.settings=Object.assign(S.settings,${JSON.stringify(backup.state.settings)});`);
  w.nav('analytics', null);
  w.updateAn();
  const ids=['anDD','anHIST','anHEAT','anROLL','anSEQ','anSCAT','anBUCK'];
  const faltando=ids.filter(id=>!d.getElementById(id));
  ok(faltando.length===0, 'os 7 canvas dos gráficos avançados existem', faltando.join(','));
  const criados=ids.filter(id=>ev(`!!CH.${id}`));
  ok(criados.length===7, 'gráficos avançados renderizados', criados.join(',')+' ('+criados.length+'/7)');
  ok(d.querySelectorAll('#anCAL .cal-d').length>=35, 'calendário com as células dos dias',
     String(d.querySelectorAll('#anCAL .cal-d').length));
  ok(d.querySelectorAll('#anCAL .cal-d.op').length===24, 'calendário marca os 24 dias operados',
     String(d.querySelectorAll('#anCAL .cal-d.op').length));
  ok(/Maior queda:/.test(d.getElementById('anDDnote').textContent), 'nota do drawdown explica a maior queda',
     d.getElementById('anDDnote').textContent.slice(0,54));
  ok(/Ganho médio/.test(d.getElementById('anHISTnote').textContent), 'nota do histograma compara ganho e perda');
  ok(/média/.test(d.getElementById('anSEQnote').textContent), 'nota da sequência compara dias de 1 e 2 entradas',
     d.getElementById('anSEQnote').textContent.slice(0,60));
  ok(/Correlação: r =/.test(d.getElementById('anSCATnote').textContent), 'nota da dispersão traz a correlação',
     d.getElementById('anSCATnote').textContent.slice(0,60));
  ok(/Melhor faixa:/.test(d.getElementById('anBUCKnote').textContent), 'nota das faixas aponta a melhor');
  /* todos os gráficos usam as cores de win/loss do tema (verde frio / vermelho quente) */
  ok(ev("(()=>{const c=CH.anHIST;return c.data.datasets[0].backgroundColor===PAL.up&&c.data.datasets[1].backgroundColor===PAL.down;})()"),
     'histograma: ganhos na cor de win e perdas na de loss');
  ok(ev("(()=>{const c=CH.anDD;return c.data.datasets[0].borderColor===PAL.down;})()"),
     'drawdown pintado na cor de loss (quente)');
  ok(ev("(()=>{const c=CH.anHIST;return c.data.datasets[0].backgroundColor===PAL.up&&c.data.datasets[1].backgroundColor===PAL.down;})()"),
     'histograma: ganhos na cor de win e perdas na de loss');
  ok(ev("(()=>{return CH.anDD.data.datasets[0].borderColor===PAL.down;})()"),
     'drawdown pintado na cor de loss (quente)');
  ok(ev("(()=>{const bg=CH.anSCAT.data.datasets[0].backgroundColor;return bg.length===24&&bg.every(c=>c.indexOf('rgba')===0);})()"),
     'dispersão: um ponto por dia, colorido por sinal', ev("String(CH.anSCAT.data.datasets[0].backgroundColor.length)"));
  ok(ev("(()=>{const b=CH.anBUCK.data.datasets[0];return b.backgroundColor.length===4&&b.backgroundColor.every(c=>/rgba|#/.test(c));})()"),
     'faixas: 4 barras coloridas por sinal');
  ok(ev("(()=>{const r=CH.anROLL.data.datasets;return r.length===2&&r[0].yAxisID==='y'&&r[1].yAxisID==='y1';})()"),
     'média móvel: win rate e profit factor em eixos separados');
  /* sem operações, o painel não quebra e avisa */
  ev('S.operations=[];');
  w.updateAn();
  ok(true, 'painel Analytics sem operações não lança erro');
  ok(/Sem operações/.test(d.getElementById('anCAL').textContent), 'calendário avisa quando não há operações',
     d.getElementById('anCAL').textContent.slice(0,40));

  /* ── rodízio de gráficos do Dashboard (slots: girar + fixar) ── */
  ev(`S.operations=${JSON.stringify(backup.state.operations)};S.settings=Object.assign(S.settings,${JSON.stringify(backup.state.settings)});`);
  ev("S.cp='all';S.charts.fixed={};S.charts.auto=true;S.charts.autoSec=20;");   // 20s: o timer não dispara no teste
  w.nav('dashboard', null);
  w.updateDash();
  const sids=['main','assert','plan'];
  ok(sids.every(sid=>d.getElementById('slotBody_'+sid)&&d.getElementById('slotDots_'+sid)&&d.getElementById('slotPin_'+sid)),
     'os 3 blocos do Dashboard têm área, bolinhas e 📌');
  ok(ev("slotCur.main")==='cap' && ev("slotCur.assert")==='wr' && ev("slotCur.plan")==='plan',
     'cada bloco começa no gráfico padrão', ev("JSON.stringify(slotCur)"));
  ok(ev("!!CH.gc_cap && !!CH.gc_wr && !!CH.gc_plan"), 'os gráficos dos blocos foram desenhados', ev("Object.keys(CH).join(',')"));
  ok(d.querySelectorAll('#slotDots_main .slot-dot').length===4, 'o bloco principal tem 4 gráficos no rodízio',
     String(d.querySelectorAll('#slotDots_main .slot-dot').length));
  ok(d.querySelectorAll('#slotDots_main .slot-dot.on').length===1, 'a bolinha do gráfico atual fica marcada');
  ok(/Wins 24/.test(d.getElementById('slotLegend_assert').textContent), 'legenda do bloco traz os números (Wins 24)',
     d.getElementById('slotLegend_assert').textContent.trim().slice(0,32));
  ok(ev("S.charts.auto")===true && ev("S.charts.autoSec")>=3 && ev("S.charts.fadeSec")>0,
     'estado do rodízio existe (auto, intervalo e fade)', ev("JSON.stringify(S.charts)"));
  /* o rodízio troca os três blocos */
  ev("slotStep()");
  ok(ev("slotCur.main")==='weekly' && ev("slotCur.assert")==='cp' && ev("slotCur.plan")==='pn',
     'o rodízio gira os três blocos de uma vez', ev("JSON.stringify(slotCur)"));
  ok(ev("!!CH.gc_weekly && !CH.gc_cap"), 'o gráfico que saiu é destruído (sem vazar canvas)');
  ok(/Win\/Loss por Semana/.test(d.getElementById('slotTitle_main').textContent), 'o título do bloco acompanha o gráfico',
     d.getElementById('slotTitle_main').textContent);
  /* 📌 fixa o bloco */
  ev("slotPin('main')");
  ok(ev("S.charts.fixed.main")==='weekly', '📌 fixa o gráfico atual do bloco', ev("JSON.stringify(S.charts.fixed)"));
  ok(d.getElementById('slotPin_main').className.indexOf('on')>=0, 'o 📌 fica aceso quando o bloco está fixo');
  ev("slotStep()");
  ok(ev("slotCur.main")==='weekly' && ev("slotCur.assert")==='wr', 'bloco fixo não gira e os outros continuam girando',
     ev("JSON.stringify(slotCur)"));
  ev("slotPin('main')");
  ok(!ev("S.charts.fixed.main"), 'clicar no 📌 de novo devolve o bloco ao rodízio');
  /* bolinhas escolhem na hora */
  ev("slotJump('main',2)");
  ok(ev("slotCur.main")==='monthly' && ev("!!CH.gc_monthly"), 'clicar numa bolinha escolhe e desenha aquele gráfico',
     ev("slotCur.main"));
  ok(ev("JSON.stringify(S.charts.fixed)").indexOf('monthly')<0, 'escolher na bolinha tira o bloco do fixo');
  /* 7d / Tudo valem para todos os blocos */
  ev("setCP('week')");
  ok(d.getElementById('btnW').className.indexOf('btn-o')===0 && d.getElementById('btnA').className.indexOf('btn-s')===0,
     '7d marca o botão e filtra os blocos', ev("gFilter(S.operations).length")+' op(s) nos últimos 7 dias');
  ev("setCP('all')");
  ok(ev("gFilter(S.operations).length")===37, 'Tudo devolve todas as operações para os blocos');
  /* 🔁 Auto */
  ok(d.getElementById('gAutoBtn').className.indexOf('btn-o')===0, '🔁 Auto aparece ligado');
  ev("gAutoToggle()");
  ok(ev("S.charts.auto")===false && d.getElementById('gAutoBtn').className.indexOf('btn-s')===0, '🔁 Auto pausa o rodízio',
     ev("document.getElementById('gAutoBtn').className"));
  ev("gAutoToggle()");
  ok(ev("S.charts.auto")===true, '🔁 Auto liga o rodízio de novo');
  /* Configurações → 🔁 Ciclo de Gráficos */
  ev("syncCycleUI()");
  ok(d.getElementById('cycleToggle').checked===true, 'Configurações: toggle do ciclo marcado');
  ok(/^\d+ s$/.test(d.getElementById('cycleSecVal').textContent) && /s$/.test(d.getElementById('cycleFadeVal').textContent),
     'Configurações: mostra intervalo e suavidade', d.getElementById('cycleSecVal').textContent+' / '+d.getElementById('cycleFadeVal').textContent);
  const elSec=d.getElementById('cycleSec'); elSec.value='10'; w.cycleSecChange(elSec);
  ok(ev("S.charts.autoSec")===10 && d.getElementById('cycleSecVal').textContent==='10 s', 'mudar o intervalo salva e reflete',
     d.getElementById('cycleSecVal').textContent);
  const elFade=d.getElementById('cycleFade'); elFade.value='1.5'; w.cycleFadeChange(elFade);
  ok(ev("S.charts.fadeSec")===1.5 && d.getElementById('cycleFadeVal').textContent==='1.5 s', 'mudar a suavidade salva e reflete');
  ok(/1\.5/.test(d.documentElement.style.getPropertyValue('--slot-fade')), 'o fade do CSS segue a configuração',
     d.documentElement.style.getPropertyValue('--slot-fade'));
  ev("S.charts.autoSec=6;S.charts.fadeSec=0.8;syncCycleUI();slotStop();");
  /* sem operações, o bloco avisa em vez de quebrar */
  ev("S.operations=[];");
  w.updateDash();
  ok(/Sem operações/.test(d.getElementById('slotBody_main').textContent), 'sem operações o bloco mostra o aviso',
     d.getElementById('slotBody_main').textContent.trim().slice(0,34));

  /* restaura o cenário do backup para os testes seguintes */
  ev(`S.operations=${JSON.stringify(backup.state.operations)};S.settings=Object.assign(S.settings,${JSON.stringify(backup.state.settings)});`);
  w.updateDash();

  /* ── temas do painel: grade agrupada e temas chumbo ── */
  const grupos = [...d.querySelectorAll('#themeGrid .theme-group')].map(x => x.textContent.replace(/\d+$/, '').trim());
  ok(grupos.length === 3, 'grade de temas em 3 seções', grupos.join(' | '));
  ok(grupos.some(g => /Claros/.test(g)) && grupos.some(g => /Escuros discretos/.test(g)) && grupos.some(g => /Escuros vibrantes/.test(g)),
     'seções Claro / Escuro discreto / Escuro vibrante');
  ok(d.querySelectorAll('#themeGrid .theme-btn').length === 15, '15 temas na grade', String(d.querySelectorAll('#themeGrid .theme-btn').length));
  w.pickTheme('graphite');
  ok(ev('S.theme') === 'graphite', 'tema Graphite aplicado');
  ok(d.documentElement.getAttribute('data-theme') === 'graphite', 'atributo data-theme no <html>');
  ok(ev('isDarkTheme("graphite") === true && isDarkTheme("denim") === false'), 'classificação claro/escuro correta');
  ok(!!d.querySelector('#themeGrid .theme-btn.sel'), 'tema atual marcado na grade');
  /* relatório em Automático acompanha o painel */
  w.rptSetTheme('auto');
  await fresh(() => w.rptRender());
  ok(d.getElementById('rview').dataset.rtheme === 'escuro', 'relatório "Automático" + painel escuro → tema escuro',
     d.getElementById('rview').dataset.rtheme);
  w.pickTheme('denim');
  await sleep(120);
  ok(d.getElementById('rview').dataset.rtheme === 'claro', 'trocar o painel para claro muda o relatório automático',
     d.getElementById('rview').dataset.rtheme);
  w.pickTheme('graphite');
  w.rptSetTheme('claro');
  await fresh(() => w.rptRender());
  ok(d.getElementById('rview').dataset.rtheme === 'claro', 'tema fixo do relatório ignora o painel');

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
  ok(ev('RPT.theme') === 'papel', 'tema do relatório persistido entre aberturas', ev('RPT.theme'));
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
