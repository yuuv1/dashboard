/* ══════════════════════════════════════════════════════════════════════
   EdgeControl — relay de e-mail (Cloudflare Worker + Brevo)

   Por que este arquivo existe: a chave da API da Brevo não pode morar no
   HTML do app (o site é público; qualquer um leria a chave e passaria a
   enviar e-mail na sua conta). O app manda o pacote para cá, este Worker
   guarda a chave num secret e repassa para a Brevo.

   Contrato (também usado por tests/test-email.js):
     GET  /health          → {ok, configured, to, maxBytes, minInterval}
     POST /send            → {ok, id, bytes}
       corpo: {
         to:"voce@email.com",        // precisa estar em ALLOWED_TO
         key:"…",                    // opcional: confere APP_KEY
         subject:"…", html:"…", text:"…",
         attachments:[{name,mime,b64}],   // b64 = base64 puro
         meta:{periodo:{from,to},ops:n,shots:n,parte:{i,total}}
       }

   Variáveis de ambiente (Settings → Variables and Secrets do Worker):
     BREVO_API_KEY    (secret, obrigatório)  chave xkeysib-… da Brevo
     ALLOWED_TO       (obrigatório)  e-mails de destino, separados por vírgula
     FROM_EMAIL       (obrigatório)  remetente verificado na Brevo
     FROM_NAME        opcional       padrão "EdgeControl"
     APP_KEY          opcional       se definido, o app precisa mandar o mesmo
     MAX_BYTES        opcional       teto do payload total (padrão 24000000)
     BURST            opcional       envios aceitos por janela (padrão 12)
     WINDOW_SEC       opcional       tamanho da janela, em segundos (padrão 60)
     ALLOW_ORIGIN     opcional       CORS (padrão "*")

   Sem dependências, sem npm install: cole este arquivo no editor do Worker.
══════════════════════════════════════════════════════════════════════ */

const DEFAULTS = {
  MAX_BYTES: 24000000,      /* ~24 MB de payload: a Brevo aceita 25 MB por e-mail */
  BURST: 12,                /* envios aceitos por janela (um backup pode ter várias partes) */
  WINDOW_SEC: 60,
  FROM_NAME: 'EdgeControl',
  MAX_ATTACHMENTS: 12,
  MAX_HTML: 600000,         /* corpo em HTML/ texto: 600 KB é folgado */
  MAX_SUBJECT: 200
};

/* janela deslizante de envios: um backup grande chega em várias partes, então
   o limite é por quantidade numa janela (e não um intervalo fixo entre envios) */
const _hits = [];
function dentroDoLimite(windowSec, burst) {
  const agora = Date.now();
  while (_hits.length && agora - _hits[0] > windowSec * 1000) _hits.shift();
  if (_hits.length >= burst) return false;
  _hits.push(agora);
  return true;
}

function cors(env) {
  return {
    'Access-Control-Allow-Origin': (env && env.ALLOW_ORIGIN) || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-EC-Key',
    'Access-Control-Max-Age': '86400'
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(env))
  });
}

function allowedList(env) {
  return String((env && env.ALLOWED_TO) || '')
    .split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

function maskEmail(e) {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at < 1) return s ? s[0] + '…' : '';
  return s[0] + '…' + s.slice(at);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function b64Bytes(b64) {
  /* tamanho aproximado do anexo já decodificado */
  const s = String(b64 || '').replace(/\s+/g, '');
  const pad = (s.match(/=+$/) || [''])[0].length;
  return Math.max(0, Math.floor(s.length * 3 / 4) - pad);
}

async function readJSON(request, maxBytes) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len && len > maxBytes) throw new Error('payload grande demais (' + Math.round(len / 1048576) + ' MB)');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('payload grande demais (' + Math.round(text.length / 1048576) + ' MB)');
  try { return JSON.parse(text); }
  catch (e) { throw new Error('JSON inválido'); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const maxBytes = num(env && env.MAX_BYTES, DEFAULTS.MAX_BYTES);
    const burst = num(env && env.BURST, DEFAULTS.BURST);
    const windowSec = num(env && env.WINDOW_SEC, DEFAULTS.WINDOW_SEC);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

    /* ── diagnóstico: o app usa isto antes de enviar, para avisar cedo ── */
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      const list = allowedList(env);
      return json({
        ok: true,
        configured: !!(env && env.BREVO_API_KEY && list.length && env.FROM_EMAIL),
        to: list.map(maskEmail),
        maxBytes,
        burst,
        windowSec,
        needsKey: !!(env && env.APP_KEY)
      }, 200, env);
    }

    if (request.method !== 'POST' || (url.pathname !== '/send' && url.pathname !== '/')) {
      return json({ ok: false, error: 'use POST /send' }, 404, env);
    }

    try {
      if (!env || !env.BREVO_API_KEY) throw new Error('BREVO_API_KEY não configurada no Worker');
      if (!env.FROM_EMAIL) throw new Error('FROM_EMAIL não configurado no Worker');
      const list = allowedList(env);
      if (!list.length) throw new Error('ALLOWED_TO não configurado no Worker');

      if (env.APP_KEY && String(request.headers.get('X-EC-Key') || '') !== String(env.APP_KEY)) {
        return json({ ok: false, error: 'chave do app incorreta' }, 401, env);
      }

      const body = await readJSON(request, maxBytes);
      const to = String(body.to || list[0]).trim().toLowerCase();
      if (!list.includes(to)) throw new Error('destino não permitido (ajuste ALLOWED_TO)');

      const subject = String(body.subject || 'EdgeControl').slice(0, DEFAULTS.MAX_SUBJECT);
      const html = String(body.html || '').slice(0, DEFAULTS.MAX_HTML);
      const text = String(body.text || '').slice(0, DEFAULTS.MAX_HTML);
      if (!html && !text) throw new Error('e-mail sem corpo');

      const listAtt = Array.isArray(body.attachments) ? body.attachments : [];
      if (listAtt.length > DEFAULTS.MAX_ATTACHMENTS) throw new Error('anexos demais');
      const attachment = [];
      let total = text.length + html.length;
      for (const a of listAtt) {
        const name = String(a && a.name || '').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'anexo.bin';
        const content = String(a && a.b64 || '').replace(/\s+/g, '');
        if (!content) throw new Error('anexo vazio: ' + name);
        if (!/^[A-Za-z0-9+/=]+$/.test(content.slice(0, 64))) throw new Error('anexo sem base64: ' + name);
        const size = b64Bytes(content);
        total += size;
        if (total > maxBytes) throw new Error('anexos passam de ' + Math.round(maxBytes / 1048576) + ' MB (' + name + ')');
        attachment.push({ name, content });
      }

      if (!dentroDoLimite(windowSec, burst)) {
        return json({ ok: false, error: 'muitos envios em ' + windowSec + 's — tente de novo daqui a pouco' }, 429, env);
      }

      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: env.FROM_NAME || DEFAULTS.FROM_NAME, email: env.FROM_EMAIL },
          to: [{ email: to }],
          subject,
          htmlContent: html || undefined,
          textContent: text || undefined,
          attachment: attachment.length ? attachment : undefined
        })
      });

      const raw = await resp.text();
      let data = null;
      try { data = JSON.parse(raw); } catch (e) {}
      if (!resp.ok) {
        const msg = (data && (data.message || data.error)) || ('Brevo HTTP ' + resp.status);
        return json({ ok: false, error: msg }, 502, env);
      }

      return json({ ok: true, id: (data && data.messageId) || '', bytes: total, attachments: attachment.length }, 200, env);
    } catch (e) {
      return json({ ok: false, error: (e && e.message) || String(e) }, 400, env);
    }
  }
};
