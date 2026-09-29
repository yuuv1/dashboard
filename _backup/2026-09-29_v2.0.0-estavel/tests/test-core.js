/* ------------------------------------------------------------------
   Testes do núcleo do relatório (funções puras, sem DOM).

   Lê o bloco /*RPT-CORE-START* ... /*RPT-CORE-END* de edgecontrol-glass.html
   e roda contra o backup de exemplo do repositório.

   Rodar:  npm run test:core      (ou: node tests/test-core.js)
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, '..', 'edgecontrol-glass.html');
const FIXTURE = path.join(__dirname, '..', 'edgecontrol_2026-09-03.json');

const src = fs.readFileSync(HTML, 'utf8');
const core = src.split('/*RPT-CORE-START*/')[1].split('/*RPT-CORE-END*/')[0];
const C = new Function(core + `
  return {rpRange,rpMetrics,rpInsights,rpSort,rpApplyFilters,rpIn,rpMoney,rpPct,rpDays,rpAdd,rpToday,rpNet,rpBR,rpPad,
    rpEquity,rpHistogram,rpHeat,rpRolling,rpCalendar,rpDailyStats,rpRMultiples,rpValueBuckets,rpISO,rpWd,
    rpAsset,rpDirection,rpOperationals};
`)();

const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const ini = backup.state.settings.initialCapital;
const ops = C.rpSort(backup.state.operations);

let fails = 0;
const eq = (a, b, msg) => {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-6) { fails++; console.log('❌', msg, '=>', a, 'esperado', b); return; }
  } else if (a !== b) { fails++; console.log('❌', msg, '=>', a, 'esperado', b); return; }
  console.log('✅', msg, typeof a === 'number' ? a : '');
};
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};

/* ── 1. conjunto completo do backup ───────────────────────────────── */
const M = C.rpMetrics(ops, ini);
eq(M.n, 37, 'n de operações');
eq(M.wins, 24, 'wins');
eq(M.losses, 12, 'losses');
eq(M.draws, 1, 'empates');
const gw = ops.filter(o => o.result === 'WIN').reduce((a, o) => a + o.value, 0);
const gl = ops.filter(o => o.result === 'LOSS').reduce((a, o) => a + o.value, 0);
eq(M.grossWin, gw, 'ganhos brutos');
eq(M.grossLoss, gl, 'perdas brutas');
eq(M.net, gw - gl, 'resultado líquido (empate é neutro)');
eq(M.winRate, (24 / 36) * 100, 'win rate = wins/(wins+losses)');
eq(M.pf, gw / gl, 'profit factor');
eq(M.volume, ops.reduce((a, o) => a + o.value, 0), 'giro = soma de todas as entradas');
ok(M.best && M.best.result === 'WIN', 'melhor operação é um WIN');
ok(M.worst && M.worst.result === 'LOSS', 'pior operação é um LOSS');
eq(M.capitalEnd, ini + M.net, 'capital final = inicial + resultado');
eq(M.maxWinStreak, 6, 'maior sequência de wins');
eq(M.maxLossStreak, 2, 'maior sequência de losses');
eq(M.plan.y, 37, 'operações que seguiram o plano');
eq(M.plan.n, 0, 'operações fora do plano');
eq(M.byType.length, 7, 'ativos distintos (6 pares + "sem ativo")');
eq(M.byType[0].asset, '(sem ativo)', 'ativo com melhor resultado vem primeiro (confirmado no backup: 102,62)');
ok(M.byType.every((t, i, a) => i === 0 || a[i - 1].net >= t.net), 'ativos ordenados do melhor para o pior resultado');
eq(M.byOperational.length, 0, 'backup antigo sem operacionais não inventa grupos');
ok(M.bestType === M.byType[0] && M.worstType === M.byType[M.byType.length - 1], 'bestType/worstType apontam para as pontas');
eq(M.days.length, 24, 'dias operados');
eq(M.days[M.days.length - 1].cum, M.capitalEnd, 'acumulado do último dia = capital final');
ok(C.rpAdd('2026-01-31', 1) === '2026-02-01', 'rpAdd cruza o mês (31/01 + 1 = 01/02)');
ok(C.rpDays('2026-07-24', '2026-09-03') === 42, 'rpDays 24/07 → 03/09 = 42');
const ins = C.rpInsights(M, { prev: null });
ok(ins.length >= 8, 'insights gerados: ' + ins.length);
ok(ins.every(i => i.t && i.d && i.ic), 'todo insight tem ícone, título e texto');
ok(!/NaN|undefined/.test(ins.map(i => i.t + i.d).join(' ')), 'nenhum insight com NaN/undefined');

/* ── 2. período parcial (agosto/2026) ─────────────────────────────── */
const ago = ops.filter(o => o.date >= '2026-08-01' && o.date <= '2026-08-31');
const capAgo = ini + ops.filter(o => o.date < '2026-08-01').reduce((a, o) => a + C.rpNet(o), 0);
const MA = C.rpMetrics(C.rpSort(ago), capAgo);
eq(MA.n, ago.length, 'agosto: nº de operações');
eq(MA.capitalStart, capAgo, 'agosto: capital no início do período');
eq(MA.capitalEnd, capAgo + MA.net, 'agosto: capital no fim do período');
ok(MA.net > 0, 'agosto: resultado positivo', MA.net.toFixed(2));

/* ── 3. casos-limite ──────────────────────────────────────────────── */
const empty = C.rpMetrics([], 1000);
eq(empty.n, 0, 'sem operações: n = 0');
eq(empty.winRate, 0, 'sem operações: win rate 0');
eq(empty.pf, 0, 'sem operações: profit factor 0');
eq(empty.capitalEnd, 1000, 'sem operações: capital não muda');
ok(C.rpInsights(empty, {}).length === 0, 'sem operações: nenhum insight');

const noLoss = C.rpMetrics(C.rpSort([
  { date: '2026-09-01', time: '09:00', value: 10, result: 'WIN', type: 'CALL', plan: 'yes' },
  { date: '2026-09-01', time: '10:00', value: 20, result: 'WIN', type: 'CALL', plan: 'yes' }
]), 100);
ok(noLoss.pf === Infinity, 'sem perdas: profit factor infinito');
eq(noLoss.capitalEnd, 130, 'sem perdas: capital final 130');
eq(noLoss.days.length, 1, 'operações do mesmo dia agrupadas em 1 dia');
eq(noLoss.days[0].w, 2, 'dia com 2 wins');

const drawOnly = C.rpMetrics(C.rpSort([{ date: '2026-09-01', time: '09:00', value: 50, result: 'DRAW', type: 'X', plan: 'yes' }]), 100);
eq(drawOnly.net, 0, 'só empate: resultado 0');
eq(drawOnly.capitalEnd, 100, 'só empate: capital não muda');
eq(drawOnly.winRate, 0, 'só empate: win rate 0');
ok(C.rpInsights(drawOnly, {}).length >= 1, 'só empate: ainda gera resumo');

const contextOps = C.rpSort([
  { date: '2026-09-01', time: '09:00', value: 25, result: 'WIN', asset: 'XAU/USD', direction: 'CALL', operationals: ['Rompimento', 'Pullback'], plan: '' },
  { date: '2026-09-01', time: '10:00', value: 10, result: 'LOSS', asset: 'XAU/USD', direction: '', operationals: ['Rompimento'], plan: '' },
  { date: '2026-09-02', time: '', value: 8, result: 'WIN', type: 'EUR/JPY', operationals: [], plan: '' }
]);
const contextM = C.rpMetrics(contextOps, 100);
eq(contextM.byType.length, 2, 'métricas agrupam pelo ativo novo e pelo type legado');
eq(contextM.byOperational.length, 2, 'métricas criam grupos para os 2 operacionais');
eq(contextM.byOperational.find(x => x.operational === 'Rompimento').n, 2, 'operacional repetido contabiliza as 2 operações');
eq(contextM.plan.u, 3, 'plano vazio fica não informado (não vira "sim")');
eq(C.rpAsset(contextOps[2]), 'EUR/JPY', 'leitor de ativo aceita type legado com par');
eq(C.rpDirection(contextOps[0]), 'CALL', 'direção nova é lida separadamente');
eq(C.rpOperationals(contextOps[0]).length, 2, 'array de operacionais preserva múltipla seleção');
ok(!/NaN|undefined/.test(JSON.stringify(contextM)), 'métricas com campos opcionais vazios não geram NaN/undefined');

/* ── 4. filtros e períodos ────────────────────────────────────────── */
eq(C.rpApplyFilters(ops, { res: 'WIN' }).length, 24, 'filtro resultado = WIN');
eq(C.rpApplyFilters(ops, { plan: 'no' }).length, 0, 'filtro plano = não (nenhuma)');
eq(C.rpApplyFilters(ops, { type: 'EUR/USD' }).length, 8, 'filtro ativo legado = EUR/USD');
eq(C.rpApplyFilters(contextOps, { type: 'XAU/USD' }).length, 2, 'filtro usa o novo campo asset');
const r = C.rpRange('mespassado');
ok(!!r.from && !!r.to, 'preset "mês passado" devolve datas', r.from + ' → ' + r.to);
ok(C.rpDays(r.from, r.to) >= 28, 'mês passado tem >= 28 dias');

/* ── 5. comparação com o período anterior (os 2 formatos aceitos) ─── */
const prevFlat = C.rpMetrics(C.rpSort(ops.filter(o => o.date < '2026-08-01')), ini);
const cmpFlat = C.rpInsights(M, { prev: prevFlat }).filter(i => /Comparado ao período anterior/.test(i.t));
ok(cmpFlat.length === 1, 'prev como métricas puras gera comparação');
const cmpWrap = C.rpInsights(M, { prev: { label: 'A→B', n: prevFlat.n, M: prevFlat } }).filter(i => /Comparado ao período anterior/.test(i.t));
ok(cmpWrap.length === 1, 'prev no formato do rptModel {label,n,M} gera comparação');
ok(!/NaN|undefined/.test(cmpWrap[0].d), 'texto da comparação sem NaN/undefined');
ok(/A→B/.test(cmpWrap[0].t), 'rótulo do período anterior aparece no título');
ok(C.rpInsights(M, { prev: { label: 'vazio', n: 0, M: C.rpMetrics([], 0) } })
  .filter(i => /Comparado/.test(i.t)).length === 0, 'período anterior sem operações não gera comparação');

/* ── 6. gráficos avançados (cálculos puros) ───────────────────── */
const settings = backup.state.settings;

// curva de capital + drawdown
const eqc = C.rpEquity(ops, ini);
eq(eqc.length, 38, 'equity: 37 ops + ponto inicial');
eq(eqc[eqc.length - 1].cap, M.capitalEnd, 'equity: termina no capital final');
eq(Math.round(Math.max(...eqc.map(p => p.dd)) * 100) / 100, 72.96, 'maior drawdown da curva (72,96)');
ok(eqc.some(p => p.ddPct > 0), 'drawdown percentual calculado');
ok(eqc.every(p => p.dd >= 0), 'drawdown nunca negativo');
ok(eqc.every(p => p.cap <= p.peak), 'capital nunca acima do pico');

// histograma espelhado
const hist = C.rpHistogram(ops, 8);
eq(hist.wins.reduce((a, b) => a + b, 0), 24, 'histograma: todas as 24 vitórias contadas');
eq(hist.losses.reduce((a, b) => a + b, 0), 12, 'histograma: todas as 12 derrotas contadas');
eq(hist.edges.length, 9, 'histograma: 8 faixas = 9 bordas');
ok(hist.winMean > 0 && hist.lossMean > 0, 'histograma: médias de ganho e de perda');
ok(hist.lossMean > hist.winMean, 'histograma: perda média maior que o ganho médio (payoff < 1)');

// mapa de calor dia × hora
const heat = C.rpHeat(ops);
eq(heat.horas.length, 5, 'heatmap: 5 horas distintas (8h–12h)');
eq(heat.horas[0], 8, 'heatmap: começa às 8h');
eq(heat.grade.flat().reduce((a, c) => a + c.n, 0), 37, 'heatmap: as 37 operações alocadas');
eq(heat.grade[2][1].n, 5, 'heatmap: quarta às 9h tem 5 operações');
eq(heat.grade[3][1].n, 6, 'heatmap: quinta às 9h é a célula mais cheia (6)');
ok(heat.grade.flat().filter(c=>c.n>0).length===15, 'heatmap: 15 células com operação (de 35 possíveis)');

// média móvel
const rol = C.rpRolling(ops, 10);
eq(rol.length, 28, 'média móvel de 10 ops em 37 operações = 28 pontos');
ok(rol.every(p => p.wr >= 0 && p.wr <= 100), 'média móvel: win rate entre 0 e 100');
eq(C.rpRolling(ops, 50).length, 0, 'janela maior que o histórico não gera pontos');
eq(C.rpRolling([], 10).length, 0, 'sem operações: média móvel vazia');

// calendário
const cal = C.rpCalendar(ops, '2026-07-24', '2026-09-03');
eq(cal.semanas[0].dias[0].date, '2026-07-20', 'calendário: primeira semana começa na segunda-feira');
ok(cal.semanas.every(s => s.dias.length === 7), 'calendário: todas as semanas com 7 dias');
const somaCal = cal.semanas.flatMap(s => s.dias).filter(d => d.net !== null).reduce((a, d) => a + d.net, 0);
eq(Math.round(somaCal * 100) / 100, Math.round(M.net * 100) / 100, 'calendário: soma dos dias = resultado do período');
eq(C.rpCalendar([]).semanas.length, 0, 'calendário sem operações');

// dia a dia com âncora (a MESMA regra da meta corrigida no painel)
const dias = C.rpDailyStats(ops, ini, settings.stopLoss, settings.target);
eq(dias.length, 24, 'dia a dia: 24 dias');
eq(dias[0].anchor, ini, 'dia a dia: âncora do 1º dia = capital inicial');
eq(Math.round(dias[0].meta * 100) / 100, Math.round(ini * settings.target / 100 * 100) / 100, 'dia a dia: meta = 12% da âncora do dia');
eq(Math.round(dias[0].stop * 100) / 100, Math.round(ini * settings.stopLoss / 100 * 100) / 100, 'dia a dia: stop = 8% da âncora do dia');
eq(dias[0].metaBatida, false, '1º dia (29,38) não bateu a meta de 36,32');
eq(dias.filter(d => d.metaBatida).length, 4, '4 dias bateram a meta no histórico');
eq(dias.filter(d => d.stopBatido).length, 0, 'nenhum dia bateu o stop no histórico');
eq(dias.filter(d => d.n === 1).length, 11, '11 dias com uma única entrada');
eq(dias.filter(d => d.segundaUsouLucro).length, 12, '12 dias tiveram 2ª entrada depois de ganhar a 1ª');
eq(dias.filter(d => d.n > 1).length, 13, '13 dias tiveram mais de uma entrada');
eq(dias.filter(d => d.primeiraGanhou).length, 16, '16 dias começaram com vitória');
const um = dias.filter(d => d.n === 1), dois = dias.filter(d => d.n > 1);
ok(dois.reduce((a, d) => a + d.net, 0) / dois.length > um.reduce((a, d) => a + d.net, 0) / um.length,
  'dias com 2 entradas rendem mais, na média, que dias de 1 entrada');
let acc = ini, fechaOk = true;
dias.forEach(d => { if (Math.abs(d.anchor - acc) > 0.01) fechaOk = false; acc += d.net; });
ok(fechaOk, 'dia a dia: âncora de cada dia = capital acumulado até o dia anterior (meta nunca foge)');
eq(Math.round(acc * 100) / 100, Math.round(M.capitalEnd * 100) / 100, 'dia a dia: somando os nets chega ao capital final');

// R múltiplo (cada operação em unidades do stop do dia)
const rs = C.rpRMultiples(ops, ini, settings.stopLoss).filter(x => x.risco > 0);
eq(rs.length, 37, 'R múltiplo: todas as operações com risco definido');
const rMedio = rs.reduce((a, x) => a + x.r, 0) / rs.length;
eq(Math.round(rMedio * 100) / 100, 0.19, 'R médio por operação (0,19)');
ok(rs.filter(x => x.op.result === 'WIN').every(x => x.r > 0), 'R múltiplo: vitórias com R positivo');
ok(rs.filter(x => x.op.result === 'LOSS').every(x => x.r < 0), 'R múltiplo: derrotas com R negativo');
ok(rs.every(x => Math.abs(x.r) <= 1.6), 'R múltiplo: nenhuma operação estourou o stop do dia');

// faixas de valor de entrada
const bk = C.rpValueBuckets(ops, 4);
eq(bk.length, 4, 'faixas: 4 degraus de valor');
eq(bk.reduce((a, b) => a + b.n, 0), 37, 'faixas: as 37 operações distribuídas');
ok(bk.every(b => b.wr >= 0 && b.wr <= 100), 'faixas: win rate coerente');
ok(bk[bk.length - 1].ate >= Math.max(...ops.map(o => o.value)), 'faixas: última faixa cobre a maior entrada');
eq(C.rpValueBuckets([]).length, 0, 'faixas: sem operações, nada de divisão por zero');

console.log(fails ? `\n❌ ${fails} FALHA(S)` : '\n🎉 NÚCLEO OK — TODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
