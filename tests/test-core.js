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
  return {rpRange,rpMetrics,rpInsights,rpSort,rpApplyFilters,rpIn,rpMoney,rpPct,rpDays,rpAdd,rpToday,rpNet,rpBR,rpPad};
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
eq(M.byType.length, 7, 'tipos distintos (6 pares + "sem tipo")');
eq(M.byType[0].type, '(sem tipo)', 'tipo com melhor resultado vem primeiro (confirmado no backup: 102,62)');
ok(M.byType.every((t, i, a) => i === 0 || a[i - 1].net >= t.net), 'tipos ordenados do melhor para o pior resultado');
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

/* ── 4. filtros e períodos ────────────────────────────────────────── */
eq(C.rpApplyFilters(ops, { res: 'WIN' }).length, 24, 'filtro resultado = WIN');
eq(C.rpApplyFilters(ops, { plan: 'no' }).length, 0, 'filtro plano = não (nenhuma)');
eq(C.rpApplyFilters(ops, { type: 'EUR/USD' }).length, 8, 'filtro tipo = EUR/USD');
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

console.log(fails ? `\n❌ ${fails} FALHA(S)` : '\n🎉 NÚCLEO OK — TODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
