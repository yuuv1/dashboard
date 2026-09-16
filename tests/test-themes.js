/* ------------------------------------------------------------------
   Auditoria dos temas do sistema (CSS + JS, sem navegador).

   Verifica o que já quebrou uma vez:
   - todo tema do JS existe no CSS (e vice-versa);
   - cada tema define o conjunto completo de tokens (nada "vaza" do :root claro);
   - contraste de leitura: tinta sobre modal/campo (que é --surf com alfa);
   - temas escuros têm superfície escura (o bug dos modais acinzentados);
   - fundo decorativo (esferas/glows) definido para cada tema;
   - metais existem; a grade separa claros/escuros.

   Rodar:  node tests/test-themes.js
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'edgecontrol-glass.html'), 'utf8');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};

/* ── cores ─────────────────────────────────────────────────────── */
const hex = c => {
  if (!c) return null;
  const s = c.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(s)) return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
  if (/^[0-9a-f]{3}$/i.test(s)) return s.split('').map(c2 => parseInt(c2 + c2, 16));
  return null;
};
const lum = c => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrasto = (a, b) => {
  const la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};
const sobre = (fg, alfa, bg) => fg.map((v, i) => Math.round(v * alfa + bg[i] * (1 - alfa)));

/* ── extração do CSS ───────────────────────────────────────────── */
const tokensDe = bloco => new Set([...bloco.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const valor = (bloco, tok) => {
  const m = bloco.match(new RegExp(tok + '\\s*:\\s*([^;]+)'));
  return m ? m[1].trim() : null;
};
const rootCSS = src.match(/:root\{([^}]*)\}/)[1];
const temasCSS = {};
for (const m of src.matchAll(/\[data-theme="([a-z]+)"\]\{([^}]*)\}/g)) {
  temasCSS[m[1]] = (temasCSS[m[1]] || '') + ';' + m[2];
}

/* ── extração do JS ────────────────────────────────────────────── */
const blocoTHEMES = src.match(/const THEMES=\[(.*?)\n\];/s)[1];
const temasJS = [...blocoTHEMES.matchAll(/\{id:'([a-z]+)'([^}]*)\}/g)].map(m => {
  const extra = m[2];
  const sw = (extra.match(/sw:\[([^\]]*)\]/) || ['', ''])[1].split(',').filter(Boolean).length;
  return {
    id: m[1],
    dark: /dark:true/.test(extra),
    vivid: /vivid:true/.test(extra),
    metal: (extra.match(/metal:'([a-z]+)'/) || ['', ''])[1],
    sw
  };
});
const metais = [...src.match(/const PRESETS\s*=\s*\[([\s\S]*?)\n\];/)[1].matchAll(/id:'([a-z]+)'/g)].map(m => m[1]);

console.log('── inventário ──');
console.log('   temas no JS :', temasJS.length, temasJS.map(t => t.id).join(', '));
console.log('   blocos no CSS:', Object.keys(temasCSS).length);
console.log();

/* ── 1. paridade JS ↔ CSS ──────────────────────────────────────── */
const semCSS = temasJS.filter(t => t.id !== 'default' && !temasCSS[t.id]).map(t => t.id);
ok(semCSS.length === 0, 'todo tema do app tem bloco no CSS', semCSS.join(', '));
const semJS = Object.keys(temasCSS).filter(id => !temasJS.some(t => t.id === id));
ok(semJS.length === 0, 'todo bloco de CSS corresponde a um tema do app', semJS.join(', '));
ok(temasJS.filter(t => t.dark).length >= 3, 'há pelo menos 3 temas escuros');
ok(temasJS.some(t => t.id === 'graphite') && temasJS.some(t => t.id === 'gunmetal') && temasJS.some(t => t.id === 'basalt'),
   'temas chumbo (graphite/gunmetal/basalt) registrados');

/* ── 2. tokens completos em cada tema ─────────────────────────── */
const LAYOUT = new Set(['--sw', '--hh', '--mg', '--pct', '--bg-img', '--glow-op', '--mshine', '--mspd',
  '--racc', '--racc2', '--rbg', '--rdim', '--rhead', '--rheadink', '--rheadsub', '--rink', '--rline',
  '--rmut', '--rneg', '--rnegbg', '--rpaper', '--rpos', '--rposbg', '--rsoft', '--rwarn']);
const nucleo = [...new Set(Object.values(temasCSS).flatMap(b => [...tokensDe(b)]))].filter(t => !LAYOUT.has(t));
for (const id of Object.keys(temasCSS)) {
  const falta = nucleo.filter(t => !tokensDe(temasCSS[id]).has(t));
  ok(falta.length === 0, `${id}: define todos os ${nucleo.length} tokens de tema`, falta.join(', '));
}

/* ── 3. contraste de leitura ──────────────────────────────────── */
const relatorio = [];
/* o tema padrão mora no :root (sem atributo data-theme); entra só no contraste */
const blocosContraste = { default: rootCSS, ...temasCSS };
for (const id of Object.keys(blocosContraste)) {
  const b = blocosContraste[id];
  const bg = hex(valor(b, '--bg')), ink = hex(valor(b, '--white')), surf = hex(valor(b, '--surf'));
  const acc = hex(valor(b, '--accent')), lgray = hex(valor(b, '--lgray'));
  if (!bg || !ink || !surf || !acc || !lgray) { ok(false, `${id}: cores principais em hex`); continue; }
  const modal = sobre(surf, 0.92, bg);   // .mod / .mhd / .fi usam --surf com alfa
  const campo = sobre(surf, 0.72, bg);
  const dicas = sobre(surf, 0.95, bg);   // fundo do tooltip dos gráficos
  const c = {
    inkBg: contrasto(ink, bg), inkModal: contrasto(ink, modal), inkCampo: contrasto(ink, campo),
    inkDica: contrasto(ink, dicas), lgrayBg: contrasto(lgray, bg), accBg: contrasto(acc, bg),
    escuro: lum(bg) < 0.25, surfLum: lum(surf)
  };
  relatorio.push({ id, ...c });
  ok(c.inkModal >= 4.5, `${id}: texto sobre modal ≥ 4.5:1`, c.inkModal.toFixed(2));
  ok(c.inkBg >= 7, `${id}: texto sobre fundo ≥ 7:1`, c.inkBg.toFixed(2));
  ok(c.lgrayBg >= 4.5, `${id}: texto secundário ≥ 4.5:1`, c.lgrayBg.toFixed(2));
  ok(c.accBg >= 3, `${id}: acento visível sobre o fundo ≥ 3:1`, c.accBg.toFixed(2));
}

/* ── 4. o bug dos modais acinzentados (superfície escura em tema escuro) ── */
const escuros = relatorio.filter(r => r.escuro);
ok(escuros.length >= 3, 'temas escuros identificados', String(escuros.length));
const surfClaro = escuros.filter(r => r.surfLum > 0.25);
ok(surfClaro.length === 0, 'nenhum tema escuro com superfície clara (modais acinzentados)', surfClaro.map(r => r.id).join(', '));
for (const r of escuros) ok(true, `   ${r.id.padEnd(10)} bg escuro · surf ${r.surfLum.toFixed(3)} · ink/modal ${r.inkModal.toFixed(2)}:1`);

/* ── 4b. legibilidade do card hero (fundo --navy escuro em todos os temas) ── */
const rgbaDe = v => {
  const m = (v || '').trim().match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const p = m[1].split(',').map(x => x.trim());
  return { cor: p.slice(0, 3).map(Number), a: p.length > 3 ? Number(p[3]) : 1 };
};
for (const id of Object.keys(temasCSS)) {
  const b = temasCSS[id];
  const parada = (valor(b, '--navy') || '').match(/#[0-9a-f]{6}/gi) || [];
  const mid = hex(parada[Math.floor(parada.length / 2)]) || hex(valor(b, '--bg'));
  const selo = (bgTok, fgTok) => {
    const r = rgbaDe(valor(b, bgTok)), fg = hex(valor(b, fgTok));
    if (!r || !fg) return null;
    return contrasto(fg, sobre(r.cor, r.a, mid));
  };
  const pos = selo('--pos-bg', '--pos-fg'), neg = selo('--neg-bg', '--neg-fg');
  const texto = tok => {
    const v = valor(b, tok);
    if (!v) return null;
    if (v.startsWith('#')) return contrasto(hex(v), mid);
    const r = rgbaDe(v);
    return r ? contrasto(sobre(r.cor, r.a, mid), mid) : null;
  };
  ok(pos === null || pos >= 4.5, `${id}: selo positivo legível no card hero ≥ 4.5:1`, pos === null ? 'n/a' : pos.toFixed(2));
  ok(neg === null || neg >= 4.5, `${id}: selo negativo legível no card hero ≥ 4.5:1`, neg === null ? 'n/a' : neg.toFixed(2));
  const lbl = texto('--hero-lbl'), sub = texto('--hero-sub');
  ok(lbl === null || lbl >= 4.5, `${id}: rótulo do hero legível ≥ 4.5:1`, lbl === null ? 'n/a' : lbl.toFixed(2));
  ok(sub === null || sub >= 3, `${id}: texto secundário do hero ≥ 3:1`, sub === null ? 'n/a' : sub.toFixed(2));
}

/* ── 4c. dicas (--dim) legíveis em todos os temas ─────────────── */
for (const id of Object.keys(blocosContraste)) {
  const b = blocosContraste[id];
  const c = contrasto(hex(valor(b, '--dim')), hex(valor(b, '--bg')));
  ok(c >= 3, `${id}: dicas (--dim) ≥ 3:1 sobre o fundo`, c.toFixed(2));
}

/* ── 5. fundo decorativo por tema (esferas e glows) ───────────── */
const semDecor = [];
for (const id of Object.keys(temasCSS)) {
  const faltam = ['.sp1', '.sp2', '.sp3', '.sp4', '.g1', '.g2', '.g3']
    .filter(sel => !src.includes(`[data-theme="${id}"] ${sel}{`));
  if (faltam.length) semDecor.push(`${id}(${faltam.length})`);
}
ok(semDecor.length === 0, 'todo tema tem esferas e glows próprios', semDecor.join(', '));
for (const id of Object.keys(temasCSS)) {
  const bloco = temasCSS[id];
  ok(!!valor(bloco, '--sph-op') && !!valor(bloco, '--sheen-op'), `   ${id}: opacidades do fundo definidas`);
}

/* ── 6. metais e amostras de cor ─────────────────────────────── */
const metalRuim = temasJS.filter(t => !metais.includes(t.metal)).map(t => `${t.id}→${t.metal}`);
ok(metalRuim.length === 0, 'todo tema aponta para um metal existente', metalRuim.join(', '));
const swRuim = temasJS.filter(t => t.sw !== 3).map(t => `${t.id}(${t.sw})`);
ok(swRuim.length === 0, 'todo tema tem 3 cores de amostra', swRuim.join(', '));
const semDark = temasJS.filter(t => typeof t.dark !== 'boolean').map(t => t.id);
ok(semDark.length === 0, 'todo tema está classificado como claro/escuro', semDark.join(', '));

/* ── 7. organização da grade ─────────────────────────────────── */
ok(/\.theme-group\{/.test(src), 'CSS das seções da grade de temas');
ok(/Claros/.test(src) && /Escuros discretos/.test(src) && /Escuros vibrantes/.test(src),
   'grade agrupada (Claros / Escuros discretos / Escuros vibrantes)');
ok(/function isDarkTheme\(/.test(src), 'helper isDarkTheme disponível');
ok(/id==='auto'|\{id:'auto'/.test(src), 'relatório tem opção "Automático" (segue o painel)');
ok(/function rptResolvedTheme\(/.test(src) && /rptApplyTheme\(\)/.test(src), 'relatório resolve o tema efetivo');

console.log();
console.log(fails ? `❌ ${fails} FALHA(S)` : '🎉 TEMAS OK — AUDITORIA COMPLETA PASSOU');
process.exit(fails ? 1 : 0);
