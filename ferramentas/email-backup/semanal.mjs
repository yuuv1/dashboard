#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EdgeControl — backup semanal por e-mail (roda sozinho, sem abrir o app)

   O que faz, toda segunda de manhã:
     1. lê a Nuvem fácil (JSONBlob) e decifra o pacote com o código + PIN
        (mesma AES-GCM/PBKDF2 que o app usa);
     2. monta os números da semana anterior reutilizando o NÚCLEO PURO do
        relatório que mora no próprio app (marcadores RPT-CORE-START … RPT-CORE-END);
     3. escreve o e-mail da semana (resumo + dia a dia + destaques);
     4. anexa o backup completo .json (__ec:3, importável no app) e envia
        pela Brevo.

   Não depende de nada do navegador: sem jsdom, sem npm install, sem
   chave dentro do app. A chave da Brevo fica num secret do repositório.

   Uso:
     node ferramentas/email-backup/semanal.mjs                  # enviar
     node ferramentas/email-backup/semanal.mjs --dry-run        # só montar
     node ferramentas/email-backup/semanal.mjs --semana=2026-09-30

   Variáveis de ambiente:
     EC_NUVEM_CODIGO  código da Nuvem fácil (obrigatório p/ modo nuvem)
     EC_NUVEM_PIN     PIN da Nuvem fácil     (obrigatório p/ modo nuvem)
     EC_EMAIL         destino                (obrigatório p/ enviar)
     EC_REMETENTE     remetente verificado na Brevo (obrigatório)
     EC_REMETENTE_NOME  padrão "EdgeControl"
     BREVO_API_KEY    chave xkeysib-…        (obrigatório p/ enviar)
     EC_SEMANA        semana de referência (AAAA-MM-DD, qualquer dia dela)
     EC_DRY_RUN       "true" para não enviar
     EC_ARQUIVO       usa um pacote local em vez da nuvem (testes/ensaio)
     EC_COM_PRINTS    caminho de um backup .json (no repo) para juntar os
                      prints ao anexo; sem isso o anexo sai sem imagens
     EC_SEMPRE_ENVIAR "false" para pular a semana sem operações
══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(AQUI, '..', '..', 'edgecontrol-glass-v2.html');
const EASY_API = 'https://jsonblob.com/api/jsonBlob';
const BREVO_API = 'https://api.brevo.com/v3/smtp/email';
const TZ = 'America/Sao_Paulo';
const MAX_ANEXO = 20 * 1024 * 1024;   /* margem sob os 25 MB da Brevo */
const DIA = 86400000;

/* ── núcleo puro do relatório, direto do app ───────────────────────── */
export function extrairCore(html) {
  const m = String(html).split('/*RPT-CORE-START*/');
  if (m.length < 2) throw new Error('núcleo do relatório não encontrado no app');
  const core = m[1].split('/*RPT-CORE-END*/')[0];
  if (!/function rpMetrics/.test(core)) throw new Error('núcleo do relatório incompleto');
  return core;
}
export function carregarCore(caminhoApp) {
  const html = fs.readFileSync(caminhoApp || APP, 'utf8');
  const core = extrairCore(html);
  /* o núcleo é puro: avaliar em escopo próprio devolve só as funções */
  const fabrica = new Function(core + `
    return {rpISO,rpToday,rpParse,rpAdd,rpDays,rpBR,rpBRlong,rpWd,rpMoney,rpMoneyS,rpPct,rpNet,rpSort,
      rpAsset,rpOperationals,rpIn,rpApplyFilters,rpMetrics,rpInsights,rpRange};`);
  return fabrica();
}

/* ── datas (independentes do fuso do runner) ───────────────────────── */
export function hojeSP(agora) {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(agora === undefined ? Date.now() : agora));
  return iso.slice(0, 10);
}
function utc(iso) { const [a, m, d] = String(iso).split('-').map(Number); return Date.UTC(a, m - 1, d, 12); }
function deUTC(ms) { return new Date(ms).toISOString().slice(0, 10); }
function soma(iso, dias) { return deUTC(utc(iso) + dias * DIA); }
function diaSemana(iso) { return new Date(utc(iso)).getUTCDay(); }   /* 0=domingo */

/* semana anterior (segunda a domingo) antes da semana de `ref` */
export function periodoSemana(refISO) {
  const ref = refISO || hojeSP();
  const dow = (diaSemana(ref) + 6) % 7;                 /* 0 = segunda */
  const segunda = soma(ref, -dow);
  return { from: soma(segunda, -7), to: soma(segunda, -1), segundaAtual: segunda, ref };
}

/* ── pacote da nuvem: {ecEasy:1, iv, ct} → objeto ──────────────────── */
async function chaveDoPin(pin) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(String(pin || '')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('edgecontrol-easy-v1'), iterations: 60000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
const deB64 = s => new Uint8Array(Buffer.from(String(s), 'base64'));
export async function decifrarCloud(body, pin) {
  if (!body || body.ecEasy !== 1) return body;
  const key = await chaveDoPin(pin);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(body.iv) }, key, deB64(body.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
export async function lerNuvem(cfg, fetchImpl) {
  const f = fetchImpl || fetch;
  const r = await f(EASY_API + '/' + encodeURIComponent(cfg.codigo), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('nuvem respondeu HTTP ' + r.status);
  const body = await r.json();
  const pack = await decifrarCloud(body, cfg.pin);
  if (!pack || !pack.state || !Array.isArray(pack.state.operations)) throw new Error('pacote da nuvem inválido');
  return pack;
}

/* ── números da semana (mesma matemática do relatório do app) ──────── */
export function modeloSemana(core, state, from, to) {
  const ops = core.rpSort(state.operations || []);
  const capitalInicial = (state.settings && state.settings.initialCapital) || 0;
  let capStart = capitalInicial;
  ops.forEach(o => { if (o.date && o.date < from) capStart += core.rpNet(o); });
  const naSemana = ops.filter(o => core.rpIn(o, from, to));
  const M = core.rpMetrics(naSemana, capStart);
  const Mprev = core.rpMetrics(ops.filter(o => core.rpIn(o, soma(from, -7), soma(to, -7))), capStart);
  const insights = core.rpInsights(M, { prev: Mprev });
  return { from, to, ops, naSemana, M, Mprev, insights, capitalInicial,
    label: core.rpBR(from) + ' a ' + core.rpBR(to), arquivo: core.rpBR(from).replace(/\//g, '-') + '_a_' + core.rpBR(to).replace(/\//g, '-') };
}

/* ── anexo: backup completo (opcionalmente com os prints do repo) ──── */
export function montarAnexo(state, shots, exportedAt) {
  const pacote = { __ec: 3, exportedAt, state, shots: shots || {}, via: 'email-semanal' };
  const json = JSON.stringify(pacote);
  return { json, pacote, nome: 'edgecontrol_backup_' + exportedAt.slice(0, 10) + '.json' };
}
export function juntarPrints(caminho, state) {
  if (!caminho || !fs.existsSync(caminho)) return { shots: {}, de: '' };
  const raw = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  const shots = (raw && raw.shots) || {};
  const ops = state.operations || [];
  const idsDasOps = new Set(ops.map(o => String(o.id)));
  const citados = new Set();
  ops.forEach(o => (o.shots || []).forEach(id => citados.add(String(id))));
  /* Regra: entra o print citado por alguma operação (operation.shots), o print
     cujo registro aponta para uma operação existente (shot.opId) e, quando o
     estado não cita nenhum print (vínculos perdidos), tudo — para não perder
     imagem em silêncio. */
  const filtrados = {};
  Object.keys(shots).forEach(id => {
    const s = shots[id] || {};
    const porOp = citados.has(String(id));
    const porRegistro = !!(s.opId && idsDasOps.has(String(s.opId)));
    if (!citados.size || porOp || porRegistro) filtrados[id] = s;
  });
  return { shots: filtrados, de: caminho, citados: citados.size };
}

/* ── e-mail ────────────────────────────────────────────────────────── */
const esc = t => String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function linha(l, v, cor, core) {
  return '<tr><td style="padding:6px 10px;border-bottom:1px solid #ececf3;color:#5a6076;font:13px Arial,sans-serif;">' + esc(l) + '</td>' +
    '<td style="padding:6px 10px;border-bottom:1px solid #ececf3;text-align:right;font:bold 13px Arial,sans-serif;color:' + (cor || '#17203d') + ';">' + esc(v) + '</td></tr>';
}
export function assunto(m, info) {
  const sinal = m.M.net >= 0 ? '+' : '−';
  return 'EdgeControl — semana ' + m.label + ' · ' + m.M.n + ' ops · ' + sinal + info.core.rpMoney(Math.abs(m.M.net));
}
export function montarEmail(m, info) {
  const C = info.core, M = m.M, P = m.Mprev;
  const delta = (a, b, fmt, invertido) => {
    if (!b) return '';
    const dif = a - b, bom = invertido ? dif < 0 : dif > 0;
    return ' <span style="color:' + (bom ? '#0b8f6a' : '#d81b4a') + ';font-weight:normal;">(' + (dif >= 0 ? '+' : '−') + fmt(Math.abs(dif)) + ' vs. semana anterior)</span>';
  };
  const dias = (M.days || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const linhasDia = dias.map(d => '<tr><td style="padding:5px 10px;border-bottom:1px solid #f2f2f7;color:#5a6076;font:12px Arial,sans-serif;">' +
      esc(C.rpBR(d.date)) + ' · ' + esc(['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'][C.rpWd(d.date)] || '') + '</td>' +
      '<td style="padding:5px 10px;border-bottom:1px solid #f2f2f7;font:12px Arial,sans-serif;color:#5a6076;">' + d.n + ' op' +
      (d.w || d.l ? ' (' + (d.w || 0) + 'W/' + (d.l || 0) + 'L)' : '') + '</td>' +
      '<td style="padding:5px 10px;border-bottom:1px solid #f2f2f7;text-align:right;font:bold 12px Arial,sans-serif;color:' + (d.net >= 0 ? '#0b8f6a' : '#d81b4a') + ';">' + esc(C.rpMoney(d.net)) + '</td></tr>').join('');
  const topo = (titulo, rows, chave, rotulo) => {
    if (!rows || !rows.length) return '';
    const top = rows.slice().sort((a, b) => b.net - a.net).slice(0, 5);
    return '<h3 style="font:bold 14px Arial,sans-serif;color:#17203d;margin:18px 0 6px;">' + esc(titulo) + '</h3>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">' +
      top.map(r => '<tr><td style="padding:5px 10px;border-bottom:1px solid #f2f2f7;color:#17203d;font:13px Arial,sans-serif;">' + esc(r[chave] || '—') + '</td>' +
        '<td style="padding:5px 10px;border-bottom:1px solid #f2f2f7;color:#5a6076;font:12px Arial,sans-serif;">' + r.n + ' op · ' + (r.w || 0) + 'W/' + (r.l || 0) + 'L</td>' +
        '<td style="padding:5px 10px;border-bottom:1px solid #f2f2f7;text-align:right;font:bold 12px Arial,sans-serif;color:' + (r.net >= 0 ? '#0b8f6a' : '#d81b4a') + ';">' + esc(C.rpMoney(r.net)) + '</td></tr>').join('') +
      '</table>';
  };
  const html = [
    '<div style="max-width:660px;margin:0 auto;background:#fff;padding:22px 20px;font:14px Arial,sans-serif;color:#17203d;">',
    '<div style="font:bold 20px Arial,sans-serif;">EdgeControl</div>',
    '<div style="color:#5a6076;margin:4px 0 16px;">Backup automático da semana · <strong>' + esc(m.label) + '</strong>' +
      '<br><span style="font-size:12px;">enviado sozinho, sem o app aberto</span></div>',
    M.n
      ? '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #ececf3;">' +
        linha('Operações', String(M.n) + delta(M.n, P.n, v => String(v)), null, C.id) +
        linha('Vitórias / derrotas', M.wins + ' / ' + M.losses, null, C.id) +
        linha('Taxa de acerto', (M.wins + M.losses ? C.rpPct(M.winRate) : '—'), null, C.id) +
        linha('Resultado da semana', C.rpMoney(M.net), M.net >= 0 ? '#0b8f6a' : '#d81b4a', C.id) +
        linha('Retorno sobre o capital', C.rpPct(M.returnPct) + delta(M.returnPct, P.returnPct, v => C.rpPct(v)), M.returnPct >= 0 ? '#0b8f6a' : '#d81b4a', C.id) +
        linha('Capital no início → fim', C.rpMoney(M.capitalStart) + ' → ' + C.rpMoney(M.capitalEnd), null, C.id) +
        linha('Profit factor / payoff', (M.pf ? (M.pf === Infinity ? '∞' : M.pf.toFixed(2).replace('.', ',')) : '—') + ' / ' + (M.payoff ? M.payoff.toFixed(2).replace('.', ',') : '—'), null, C.id) +
        linha('Ganho médio / perda média', C.rpMoney(M.avgWin) + ' / ' + C.rpMoney(M.avgLoss), null, C.id) +
        linha('Melhor / pior operação', (M.best ? C.rpMoney(M.best.value) : '—') + ' / ' + (M.worst ? C.rpMoney(M.worst.value) : '—'), null, C.id) +
        linha('Drawdown máximo', C.rpMoney(M.maxDD) + ' (' + C.rpPct(M.maxDDpct) + ')', '#d81b4a', C.id) +
        linha('Dias operados', String(M.tradedDays) + ((M.positiveDays || M.negativeDays) ? ' (' + M.positiveDays + ' positivos · ' + M.negativeDays + ' negativos)' : ''), null, C.id) +
        '</table>'
      : '<div style="border:1px solid #ececf3;padding:12px;color:#5a6076;">Nenhuma operação registrada nesta semana.</div>',
    linhasDia ? '<h3 style="font:bold 14px Arial,sans-serif;margin:18px 0 6px;">Dia a dia</h3>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #ececf3;">' + linhasDia + '</table>' : '',
    topo('Por ativo', M.byType, 'type'),
    topo('Por operacional', M.byOperational, 'operational'),
    (m.insights && m.insights.length)
      ? '<h3 style="font:bold 14px Arial,sans-serif;margin:18px 0 6px;">Leitura automática</h3>' +
        m.insights.slice(0, 3).map(x => '<div style="border-left:3px solid #4f46e5;padding:2px 0 2px 10px;margin:8px 0;">' +
          '<div style="font:bold 13px Arial,sans-serif;">' + esc(x.ic + ' ' + x.t) + '</div>' +
          '<div style="color:#5a6076;font:12px Arial,sans-serif;line-height:1.5;">' + esc(x.d) + '</div></div>').join('')
      : '',
    '<h3 style="font:bold 14px Arial,sans-serif;margin:18px 0 6px;">Anexo</h3>',
    '<ul style="margin:0;padding-left:18px;color:#5a6076;font:13px Arial,sans-serif;line-height:1.7;">' +
      '<li><strong style="color:#17203d;">' + esc(info.anexo.nome) + '</strong> — ' + info.anexoLegenda + '</li></ul>',
    '<h3 style="font:bold 14px Arial,sans-serif;margin:18px 0 6px;">Como restaurar</h3>',
    '<p style="color:#5a6076;font:12px Arial,sans-serif;line-height:1.6;margin:0;">No EdgeControl: <strong>Configurações → 🔒 Backup de Dados → Importar</strong> e escolha o .json deste e-mail. Ele substitui os dados do aparelho — para sincronizar PC e celular no dia a dia, siga usando a <strong>Nuvem fácil</strong>.</p>',
    '<hr style="border:none;border-top:1px solid #ececf3;margin:18px 0 10px;">',
    '<div style="color:#9aa0b4;font:11px Arial,sans-serif;line-height:1.6;">Gerado automaticamente pelo EdgeControl em ' + esc(info.quando) + '.' +
      ' Números do núcleo do relatório do app (build ' + esc(info.build) + ').' +
      (info.semPrints ? ' Sem prints neste anexo: a nuvem fácil não carrega imagens — os prints continuam no aparelho e no envio manual “📧 Enviar backup agora”.' : '') +
      '</div>',
    '</div>'
  ].join('');
  const texto = [
    'EdgeControl — backup da semana', 'Período: ' + m.label, '',
    ...(M.n ? [
      'Operações: ' + M.n + '  (' + M.wins + 'W / ' + M.losses + 'L)',
      'Taxa de acerto: ' + (M.wins + M.losses ? C.rpPct(M.winRate) : '—'),
      'Resultado: ' + C.rpMoney(M.net) + '   Retorno: ' + C.rpPct(M.returnPct),
      'Capital: ' + C.rpMoney(M.capitalStart) + ' → ' + C.rpMoney(M.capitalEnd),
      'Profit factor: ' + (M.pf ? M.pf.toFixed(2) : '—') + '   Drawdown máx.: ' + C.rpMoney(M.maxDD) + ' (' + C.rpPct(M.maxDDpct) + ')',
      'Dias operados: ' + M.tradedDays
    ] : ['Nenhuma operação registrada nesta semana.']),
    '', 'Anexo: ' + info.anexo.nome + ' — ' + info.anexoLegenda,
    'Restaurar: Configurações → Backup de Dados → Importar.',
    'Gerado automaticamente em ' + info.quando + '.'
  ].join('\n');
  return { subject: info.subject, html, text: texto };
}

/* ── envio pela Brevo ──────────────────────────────────────────────── */
export async function enviarBrevo(cfg, email, anexo, fetchImpl) {
  const f = fetchImpl || fetch;
  if (anexo.json.length > MAX_ANEXO) throw new Error('anexo de ' + (anexo.json.length / 1048576).toFixed(1) + ' MB passa do limite de 20 MB');
  const r = await f(BREVO_API, {
    method: 'POST',
    headers: { 'api-key': cfg.chave, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: cfg.nomeRemetente || 'EdgeControl', email: cfg.remetente },
      to: [{ email: cfg.destino }],
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      attachment: [{ name: anexo.nome, content: Buffer.from(anexo.json, 'utf8').toString('base64') }]
    })
  });
  const raw = await r.text();
  let j = null; try { j = JSON.parse(raw); } catch (e) {}
  if (!r.ok) throw new Error('Brevo: ' + ((j && j.message) || ('HTTP ' + r.status)));
  return { id: (j && j.messageId) || '', bytes: anexo.json.length };
}

/* ── programa ──────────────────────────────────────────────────────── */
function args(argv) {
  const out = {};
  argv.slice(2).forEach(a => {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  });
  return out;
}
function configDe(env, a) {
  const b = v => v === true || v === 'true' || v === '1';
  return {
    codigo: a.codigo || env.EC_NUVEM_CODIGO || '',
    pin: a.pin || env.EC_NUVEM_PIN || '',
    destino: env.EC_EMAIL || '',
    remetente: env.EC_REMETENTE || '',
    nomeRemetente: env.EC_REMETENTE_NOME || 'EdgeControl',
    chave: env.BREVO_API_KEY || '',
    semana: a.semana || env.EC_SEMANA || '',
    dryRun: b(a['dry-run']) || b(env.EC_DRY_RUN),
    arquivo: a.arquivo || env.EC_ARQUIVO || '',
    comPrints: a['com-prints'] || env.EC_COM_PRINTS || '',
    saida: a.saida || 'email-payload.json',
    sempreEnviar: (env.EC_SEMPRE_ENVIAR || 'true') !== 'false',
    core: null
  };
}

export async function main(env = process.env, argv = process.argv, deps = {}) {
  const a = args(argv);
  const cfg = configDe(env, a);
  const log = deps.log || console.log;
  const core = deps.core || carregarCore(deps.app);
  cfg.core = core;
  const build = deps.build || (/EC_BUILD='([^']+)'/.exec(fs.readFileSync(deps.app || APP, 'utf8')) || [])[1] || '';

  /* 1. de onde vêm os dados */
  let pack;
  if (cfg.arquivo) {
    pack = JSON.parse(fs.readFileSync(cfg.arquivo, 'utf8'));
    if (pack.ecEasy === 1) pack = await decifrarCloud(pack, cfg.pin);
    log('· pacote local: ' + cfg.arquivo);
  } else {
    if (!cfg.codigo || !cfg.pin) throw new Error('faltam EC_NUVEM_CODIGO e EC_NUVEM_PIN');
    pack = await lerNuvem(cfg, deps.fetch);
    log('· nuvem fácil lida (exportada em ' + (pack.exportedAt || '?') + ')');
  }
  const state = pack.state;
  const shotsDoRepo = juntarPrints(cfg.comPrints, state);
  const shots = Object.keys(shotsDoRepo.shots).length ? shotsDoRepo.shots : (pack.shots || {});

  /* 2. semana anterior + números */
  const periodo = periodoSemana(cfg.semana);
  const m = modeloSemana(core, state, periodo.from, periodo.to);
  log('· semana ' + m.label + ': ' + m.M.n + ' operação(ões), resultado ' + core.rpMoney(m.M.net));

  /* 3. e-mail + anexo */
  const exportedAt = new Date().toISOString();
  const anexo = montarAnexo(state, shots, exportedAt);
  const temPrints = Object.keys(shots).length > 0;
  const info = {
    core, build, quando: new Date().toLocaleString('pt-BR', { timeZone: TZ }),
    anexo, semPrints: !temPrints,
    anexoLegenda: (temPrints ? Object.keys(shots).length + ' print(s) incluído(s)' : 'backup completo sem prints') +
      (shotsDoRepo.de ? ' (imagens do arquivo do repositório)' : '') +
      ' · ' + (anexo.json.length / 1024).toFixed(1).replace('.', ',') + ' KB · importável no app'
  };
  info.subject = assunto(m, info);
  const email = montarEmail(m, info);

  /* 4. enviar (ou só montar) */
  if (!m.M.n && !cfg.sempreEnviar) { log('· semana sem operações — envio pulado (EC_SEMPRE_ENVIAR=false)'); return { pulado: true, semana: m.label }; }
  if (cfg.dryRun) {
    const bruto = {
      dryRun: true, quando: exportedAt, semana: { from: m.from, to: m.to, label: m.label },
      subject: email.subject, to: cfg.destino || '(destino não configurado)',
      anexo: { nome: anexo.nome, bytes: anexo.json.length, prints: Object.keys(shots).length },
      html: email.html, text: email.text
    };
    fs.writeFileSync(cfg.saida, JSON.stringify(bruto, null, 2));
    log('· dry-run: e-mail montado em ' + cfg.saida + ' (nada enviado)');
    log('  assunto: ' + email.subject);
    log('  anexo:   ' + anexo.nome + ' (' + (anexo.json.length / 1024).toFixed(1) + ' KB, ' + Object.keys(shots).length + ' print(s))');
    return { dryRun: true, arquivo: cfg.saida, semana: m.label, assume: email.subject, anexo: anexo.nome };
  }
  if (!cfg.destino || !cfg.remetente || !cfg.chave) throw new Error('faltam EC_EMAIL, EC_REMETENTE ou BREVO_API_KEY');
  const envio = await enviarBrevo(cfg, email, anexo, deps.fetch);
  log('✅ enviado para ' + cfg.destino + ' (' + (anexo.json.length / 1024).toFixed(1) + ' KB)' + (envio.id ? ' · id ' + envio.id : ''));
  return { enviado: true, semana: m.label, id: envio.id, bytes: anexo.json.length };
}

const executadoDireto = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executadoDireto) {
  main().catch(e => { console.error('❌ ' + ((e && e.message) || e)); process.exit(1); });
}
