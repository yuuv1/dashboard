/* ------------------------------------------------------------------
   Contrato da impressão (CSS). Não depende de navegador: lê o
   bloco @media print do HTML e verifica as regras que garantem que
   nada é cortado nem fica colado na borda da folha.

   Rodar:  node tests/test-print-css.js
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'edgecontrol-glass.html'), 'utf8');

// pega o primeiro @media print{...} equilibrando as chaves
function extrairBloco(texto, inicio) {
  const i = texto.indexOf(inicio);
  if (i < 0) return null;
  let j = texto.indexOf('{', i), nivel = 0, k = j;
  for (; k < texto.length; k++) {
    if (texto[k] === '{') nivel++;
    else if (texto[k] === '}') { nivel--; if (nivel === 0) break; }
  }
  return texto.slice(i, k + 1);
}
const print = extrairBloco(src, '@media print{');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};
// valor de uma propriedade dentro de uma regra do bloco de impressão
const regra = seletor => {
  const m = print.match(new RegExp(seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'));
  return m ? m[1] : null;
};
const prop = (seletor, nome) => {
  const r = regra(seletor);
  if (!r) return null;
  const m = r.match(new RegExp('(?:^|;)\\s*' + nome + '\\s*:\\s*([^;]+)'));
  return m ? m[1].trim() : null;
};
// "0" / "0px" / "0mm" significam encostado na borda
const semRespiro = v => !v || /^0(px|mm|cm|in|pt|em|rem)?$/i.test(v.replace(/!important/g, '').trim());

ok(!!print, 'bloco @media print existe');
ok(/\.rpage\{[^}]*padding-bottom:0!important/.test(print),
   'folha sem padding de rodapé (não empurra página em branco no fim)');
ok(/\.rshots\.one\{display:block!important;\}/.test(print),
   'prints em página inteira fluem em bloco');

/* ── 1. margem da folha ───────────────────────────────────────────── */
const page = print.match(/@page\{([^}]*)\}/);
ok(!!page, 'regra @page presente');
ok(/size\s*:\s*A4/.test(page[1]), 'folha em A4');
ok(/margin\s*:\s*6mm/.test(page[1]), 'margem da @page de 6mm (faixa do cabeçalho do navegador)', (page[1].match(/margin\s*:[^;}]+/) || [''])[0]);

/* ── 2. respiro interno: era exatamente isso que deixava tudo colado na borda ── */
const padBody = prop('.rbody', 'padding');
ok(!semRespiro(padBody), 'corpo do relatório com respiro interno', String(padBody));
ok(!semRespiro(padBody) && !/^0\s+0/.test(String(padBody).replace(/!important/g, '').trim()),
   'respiro do corpo tem componente horizontal', String(padBody));
const padCov = prop('.rcov', 'padding');
ok(!semRespiro(padCov), 'capa com respiro interno', String(padCov));
ok(!/^12mm\s+0\s/.test(String(padCov)), 'capa não fica colada nas laterais', String(padCov));
ok(!/\.rbody\{padding:0!important;\}/.test(print), 'ninguém zerou o padding do corpo (regressão)');

/* ── 3. largo demais = cortado: nada de largura fixa em px no papel ── */
ok(/\.rpage\{[^}]*width:auto!important/.test(print), 'folha com largura automática');
ok(/\.rtbl\{[^}]*table-layout:fixed!important/.test(print), 'tabelas com largura de coluna fixa');
ok(/\.rtbl th,\.rtbl td\{[^}]*white-space:normal!important/.test(print), 'texto das tabelas quebra linha (não é cortado)');
ok(/\.rtbl th,\.rtbl td\{[^}]*overflow-wrap:anywhere/.test(print), 'palavras longas quebram dentro da célula');
ok(/\.rtbl-wrap\{overflow:visible!important/.test(print), 'invólucro das tabelas liberado no papel');
ok(/\.rtbl \.num,\.rtbl \.rmut,\.rbdg\{white-space:nowrap!important;?\}/.test(print), 'números ficam inteiros na linha');

/* ── 4. grade -> flex (o Chrome sobrepõe itens de grade entre páginas) ── */
['.rkpis', '.rgrid2', '.rshots'].forEach(sel => {
  ok(new RegExp(sel.replace('.', '\\.') + '\\{display:flex!important').test(print), sel + ' vira flex no papel');
});
ok(/\.rops\{display:block!important;\}/.test(print),
   'fichas em fluxo de bloco (item de flex não fragmenta entre páginas)');
ok(/\.rgrid2>\*\{width:calc\(50% - 4px\)!important/.test(print), 'gráficos em 2 colunas com largura calculada');
ok(/\.rshots>\*\{width:calc\(50% - 2\.5px\)!important/.test(print), 'prints em 2 colunas com largura calculada');
ok(/\.rop\{width:100%!important/.test(print), 'fichas ocupam uma linha para dar área aos prints');
ok(/\.rkpi\{width:calc\(25% - 4\.6px\)!important/.test(print), 'KPIs em 4 colunas com largura calculada');

/* ── 5. nada se sobrepõe / nada é cortado entre páginas ───────────── */
ok(/\.rcard,\.rkpi,\.rins-i,\.rnote,\.rshot,\.rgloss dt,\.rgloss dd,\.rfoot\{break-inside:avoid/.test(print),
   'cards, prints e notas não quebram no meio');
ok(!/\.rop\{break-inside:avoid/.test(print) && !/,[^\n]*\.rop,|\.rop,[^\n]*break-inside:avoid/.test(print),
   'ficha de operação PODE atravessar páginas (mais alta que a folha não é cortada nem deixa meia página em branco)');
ok(/\.rop-noimg\{break-inside:avoid;page-break-inside:avoid;\}/.test(print),
   'ficha só-texto continua compacta (não quebra)');
ok(/\.rop-h\{break-after:avoid;page-break-after:avoid;\}/.test(print),
   'cabeçalho da ficha nunca fica órfão no fim da página');
ok(/\.rop-meta,\.rop-prints-label\{break-after:avoid/.test(print),
   'metadados/rótulo de prints acompanham o conteúdo seguinte');
ok(/\.rcard-tbl\{break-inside:auto!important;page-break-inside:auto!important;\}/.test(print),
   'cartão com tabela atravessa páginas (thead repete, linhas inteiras)');
ok(/\.rsec-h\{break-inside:avoid;page-break-inside:avoid;break-after:avoid/.test(print), 'título de seção não fica órfão');
ok(/\.rtbl thead\{display:table-header-group;\}/.test(print), 'cabeçalho da tabela repete por página');
ok(/\.rtbl tfoot\{display:table-row-group;\}/.test(print), 'linha de total aparece uma vez só');
ok(/\.rch,\.rch\.sm,\.rdonut\{height:auto!important/.test(print), 'gráficos com altura automática no papel');
ok(/\.rshot img\{max-height:78mm!important;width:100%!important/.test(print),
   'print mini cabe 2 fichas por página (78mm)');
ok(/\.rshots\.one img\{max-height:100mm!important;\}/.test(print),
   'print ampliado: ficha inteira cabe numa folha (100mm)');

/* ── 6. cores e app fora de cena ─────────────────────────────────── */
ok(/#rview,#rview \*\{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;\}/.test(print),
   'cores do tema saem no PDF mesmo sem "gráficos de fundo"');
ok(/#bg,#app,#fab,\.mol,#shotViewer,\.pwa-bar,#ecT\{display:none!important;\}/.test(print), 'app/html de fora sai da folha');
ok(/#rview:not\(\.show\)\{display:none!important;\}/.test(print), 'relatório fechado não imprime folha velha');

/* ── 7. o app não flutua por cima do relatório aberto ───────────── */
ok(/body\.rpt-open #fab,body\.rpt-open \.pwa-bar,body\.rpt-open #installBar\{display:none!important;\}/.test(src),
   'FAB/barra de instalação escondidos com o relatório aberto');

console.log(fails ? `\n❌ ${fails} FALHA(S)` : '\n🎉 IMPRESSÃO OK — CONTRATO DO PDF RESPEITADO');
process.exit(fails ? 1 : 0);
