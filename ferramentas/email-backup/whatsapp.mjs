#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EdgeControl — aviso no WhatsApp (opcional, junto do backup semanal)

   O e-mail continua sendo o canal principal (é ele que leva o .json).
   Aqui vai só o RESUMO da semana em texto, para o celular apitar.

   Provedores suportados (escolha com EC_WA_PROVIDER ou pelas variáveis):

   ┌ callmebot (padrão, grátis, 2 min de configuração)
   │  1. salve o número do bot nos contatos: +34 644 51 95 23
   │  2. mande a mensagem: I allow callmebot to send me messages
   │  3. o bot responde com a sua APIKEY
   │  variáveis: EC_WA_PHONE (+5511999998888) e EC_WA_KEY (apikey)
   │  limites: só texto, só para o seu próprio número; é um serviço
   │  gratuito e comunitário (pode atrasar/limitar; sem compromisso)
   │
   ├ cloudapi (oficial da Meta — exige conta business e template aprovado)
   │  variáveis: EC_WA_TOKEN (token), EC_WA_PHONE_ID, EC_WA_TO
   │  no Brasil, template de utilidade custa ~US$ 0,0068 por mensagem
   │
   ├ ultramsg (não oficial — conecta o seu número por QR code)
   │  variáveis: EC_WA_INSTANCE, EC_WA_TOKEN, EC_WA_TO
   │
   └ zapi (não oficial — conecta o seu número por QR code)
      variáveis: EC_WA_INSTANCE, EC_WA_TOKEN, EC_WA_TO, EC_WA_CLIENT_TOKEN

   Aviso honesto: ultramsg/zapi não são oficiais; o WhatsApp pode bloquear
   números usados com eles. Para "só um resumo semanal", o callmebot resolve
   de graça — e o arquivo do backup chega pelo e-mail de qualquer forma.
══════════════════════════════════════════════════════════════════════ */

const LIMITE = 3500;   /* folga sob o limite de mensagem do WhatsApp */

/* ── texto que vai para o WhatsApp (sem HTML; *negrito* do WhatsApp) ── */
export function textoWhatsApp(m, core, info) {
  const M = m.M, C = core;
  const L = [];
  L.push('📊 *EdgeControl* — semana ' + m.label.replace(/ (\d{2})\/(\d{2})\/(\d{4})/, ' $1/$2'));
  if (!M.n) {
    L.push('Nenhuma operação registrada nesta semana.');
  } else {
    const sinal = M.net >= 0 ? '+' : '−';
    L.push('');
    L.push('Operações: ' + M.n + '  (' + M.wins + 'W / ' + M.losses + 'L' + (M.draws ? ' / ' + M.draws + 'E' : '') + ')');
    if (M.wins + M.losses) L.push('Acerto: ' + C.rpPct(M.winRate));
    L.push('Resultado: *' + sinal + C.rpMoney(Math.abs(M.net)).replace('R$', 'R$') + '*  (' + (M.returnPct >= 0 ? '+' : '−') + C.rpPct(Math.abs(M.returnPct)) + ')');
    L.push('Capital: ' + C.rpMoney(M.capitalStart) + ' → ' + C.rpMoney(M.capitalEnd));
    L.push('Dias: ' + M.tradedDays + '   ·   DD máx: ' + C.rpMoney(M.maxDD));
    const comNome = (t) => t && t.type && t.type !== '(sem ativo)';
    const melhorAtivo = (M.byType || []).filter(comNome).slice().sort((a, b) => b.net - a.net)[0];
    const piorAtivo = (M.byType || []).filter(comNome).slice().sort((a, b) => a.net - b.net)[0];
    if (melhorAtivo && melhorAtivo.net !== 0) L.push('Melhor ativo: ' + melhorAtivo.type + ' ' + C.rpMoney(melhorAtivo.net));
    if (piorAtivo && piorAtivo.net !== 0 && piorAtivo !== melhorAtivo) L.push('Pior ativo: ' + piorAtivo.type + ' ' + C.rpMoney(piorAtivo.net));
    if (M.best && M.worst) L.push('Melhor op: ' + C.rpMoney(M.best.value) + '   ·   Pior op: ' + C.rpMoney(M.worst.value));
    else if (M.best) L.push('Melhor op: ' + C.rpMoney(M.best.value));
  }
  L.push('');
  L.push(info && info.anexo ? '📎 Backup completo (.' + String(info.anexo.nome).split('.').pop() + ') no seu e-mail:' : '📎 Backup no seu e-mail.');
  if (info && info.anexo) L.push('   ' + info.anexo.nome);
  const txt = L.join('\n');
  return txt.length > LIMITE ? txt.slice(0, LIMITE - 1) + '…' : txt;
}

/* ── qual provedor está configurado ─────────────────────────────────── */
export function waConfigurado(env) {
  const e = env || {};
  const pedido = String(e.EC_WA_PROVIDER || '').trim().toLowerCase();
  const tem = (p) => p === 'callmebot' ? !!(e.EC_WA_PHONE && e.EC_WA_KEY)
    : p === 'cloudapi' ? !!(e.EC_WA_TOKEN && e.EC_WA_PHONE_ID && e.EC_WA_TO)
    : (p === 'ultramsg' || p === 'zapi') ? !!(e.EC_WA_INSTANCE && e.EC_WA_TOKEN && e.EC_WA_TO)
    : false;
  const ordem = pedido ? [pedido] : ['callmebot', 'cloudapi', 'ultramsg', 'zapi'];
  for (const p of ordem) {
    if (tem(p)) return { provider: p, to: e.EC_WA_TO || e.EC_WA_PHONE || '', ...e };
  }
  return null;
}

/* ── envio por provedor ─────────────────────────────────────────────── */
export async function enviarWhatsApp(cfg, texto, fetchImpl) {
  const f = fetchImpl || fetch;
  const p = cfg.provider;
  if (!texto || !String(texto).trim()) throw new Error('mensagem vazia');

  if (p === 'callmebot') {
    const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(cfg.EC_WA_PHONE) +
      '&text=' + encodeURIComponent(texto) + '&apikey=' + encodeURIComponent(cfg.EC_WA_KEY);
    const r = await f(url, { headers: { Accept: 'text/plain' } });
    const body = await r.text().catch(() => '');
    /* o callmebot devolve 200 até em alguns erros: confere o texto */
    if (!r.ok) throw new Error('callmebot HTTP ' + r.status + (body ? ' — ' + body.slice(0, 120) : ''));
    if (/error|invalid|not allowed|denied|limit/i.test(body)) throw new Error('callmebot: ' + body.slice(0, 150));
    return { provider: p, id: body.slice(0, 60) };
  }

  if (p === 'cloudapi') {
    const url = 'https://graph.facebook.com/v22.0/' + encodeURIComponent(cfg.EC_WA_PHONE_ID) + '/messages';
    const r = await f(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.EC_WA_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: cfg.EC_WA_TO, type: 'text', text: { body: texto, preview_url: false } })
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error('WhatsApp Cloud API: ' + ((j && j.error && j.error.message) || ('HTTP ' + r.status)));
    return { provider: p, id: (j && j.messages && j.messages[0] && j.messages[0].id) || '' };
  }

  if (p === 'ultramsg') {
    const url = 'https://api.ultramsg.com/' + encodeURIComponent(cfg.EC_WA_INSTANCE) + '/messages/chat';
    const r = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: cfg.EC_WA_TOKEN, to: cfg.EC_WA_TO, body: texto }).toString()
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || (j && (j.error || j.sent === 'false'))) throw new Error('UltraMsg: ' + ((j && (j.error || j.message)) || ('HTTP ' + r.status)));
    return { provider: p, id: (j && j.id) || '' };
  }

  if (p === 'zapi') {
    const url = 'https://api.z-api.io/instances/' + encodeURIComponent(cfg.EC_WA_INSTANCE) + '/token/' + encodeURIComponent(cfg.EC_WA_TOKEN) + '/send-text';
    const r = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.EC_WA_CLIENT_TOKEN ? { 'Client-Token': cfg.EC_WA_CLIENT_TOKEN } : {}) },
      body: JSON.stringify({ phone: cfg.EC_WA_TO, message: texto })
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || (j && j.error)) throw new Error('Z-API: ' + ((j && j.error) || ('HTTP ' + r.status)));
    return { provider: p, id: (j && (j.messageId || j.zaapId)) || '' };
  }

  throw new Error('provedor de WhatsApp desconhecido: ' + p);
}
