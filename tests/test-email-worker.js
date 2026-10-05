/* ------------------------------------------------------------------
   Testes do relay de e-mail (ferramentas/email-backup/worker.js).

   O Worker é um módulo ES sem dependências: aqui ele é importado como
   data URL e chamado com Request/Response de verdade, com o fetch
   global dublado — nenhuma chamada sai para a Brevo.

   Conferimos o contrato usado pelo app e as travas de segurança:
   /health, /send, allowlist de destino, chave do app, limite de
   tamanho, anexo inválido e repasse do erro da Brevo.

   Rodar:  node tests/test-email-worker.js
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};

const WORKER = path.join(__dirname, '..', 'ferramentas', 'email-backup', 'worker.js');

(async () => {
  const src = fs.readFileSync(WORKER, 'utf8');
  ok(/export default/.test(src), 'worker é um módulo ES com export default');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const worker = mod.default;
  ok(typeof worker.fetch === 'function', 'worker expõe fetch(request, env)');

  /* fetch global dublado: é a chamada que o Worker faria para a Brevo */
  const brevo = [];
  let brevoResp = { ok: true, status: 201, body: { messageId: 'brevo-123' } };
  const fetchReal = global.fetch;
  global.fetch = async (url, init) => {
    brevo.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const r = brevoResp;
    return new Response(JSON.stringify(r.body), { status: r.status });
  };

  const env = {
    BREVO_API_KEY: 'xkeysib-teste',
    ALLOWED_TO: 'eu@gmail.com, outro@gmail.com',
    FROM_EMAIL: 'eu@gmail.com',
    FROM_NAME: 'EdgeControl',
    MAX_BYTES: 1000000,
    BURST: 12,
    WINDOW_SEC: 60
  };
  const post = (body, headers) => worker.fetch(new Request('https://ec.workers.dev/send', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  }), env);
  const bodyOf = async r => { const t = await r.text(); try { return JSON.parse(t); } catch (e) { return t; } };

  /* ── /health ───────────────────────────────────────────────────── */
  console.log('\n── /health ──');
  const h = await worker.fetch(new Request('https://ec.workers.dev/health'), env);
  const hj = await bodyOf(h);
  ok(h.status === 200 && hj.ok === true, 'health responde 200 com ok:true');
  ok(hj.configured === true, 'health diz que o relay está configurado');
  ok(hj.maxBytes === 1000000 && hj.burst === 12 && hj.windowSec === 60, 'health publica limites', JSON.stringify({ b: hj.maxBytes, burst: hj.burst, janela: hj.windowSec }));
  ok(Array.isArray(hj.to) && hj.to.length === 2 && !/eu@gmail\.com/.test(JSON.stringify(hj.to)), 'destinos aparecem mascarados', JSON.stringify(hj.to));
  const hSemChave = await bodyOf(await worker.fetch(new Request('https://ec.workers.dev/health'), { BREVO_API_KEY: '', ALLOWED_TO: 'a@b.com', FROM_EMAIL: 'a@b.com' }));
  ok(hSemChave.configured === false, 'health avisa quando falta configuração');

  /* ── envio completo (JSON + zip, como o app manda) ─────────────── */
  console.log('\n── envio ──');
  const json = Buffer.from(JSON.stringify({ __ec: 3, state: { operations: [1, 2, 3] } })).toString('base64');
  const zip = Buffer.from(Buffer.from('PK\u0003\u0004fake')).toString('base64');
  const r1 = await post({
    to: 'eu@gmail.com',
    subject: 'EdgeControl — backup 24/07/2026 a 03/09/2026 · 37 ops',
    html: '<b>resumo</b>', text: 'resumo',
    attachments: [{ name: 'edgecontrol_backup.json', mime: 'application/json', b64: json },
      { name: 'prints_p1de1.zip', mime: 'application/zip', b64: zip }],
    meta: { periodo: { from: '2026-07-24', to: '2026-09-03' }, ops: 37, shots: 3, parte: { i: 1, total: 1 } }
  });
  const r1j = await bodyOf(r1);
  ok(r1.status === 200 && r1j.ok === true && r1j.id === 'brevo-123', 'envio devolve ok com o id da Brevo', JSON.stringify(r1j));
  ok(r1j.attachments === 2, 'relay conta os anexos recebidos');
  ok(brevo.length === 1 && brevo[0].url === 'https://api.brevo.com/v3/smtp/email', 'chama a API da Brevo', brevo[0] && brevo[0].url);
  const envio = brevo[0].body;
  ok(brevo[0].headers['api-key'] === 'xkeysib-teste', 'chave da Brevo vai no cabeçalho api-key');
  ok(envio.sender.email === 'eu@gmail.com' && envio.sender.name === 'EdgeControl', 'remetente configurado no relay');
  ok(envio.to[0].email === 'eu@gmail.com', 'destinatário repassado');
  ok(envio.attachment.length === 2 && envio.attachment[0].name === 'edgecontrol_backup.json', 'anexos repassados com nome');
  ok(envio.htmlContent === '<b>resumo</b>' && envio.textContent === 'resumo', 'corpo HTML e texto chegam juntos');
  ok(!/X-EC-Key/.test(JSON.stringify(brevo[0].headers)), 'chave do app não vaza para a Brevo');

  /* ── travas ────────────────────────────────────────────────────── */
  console.log('\n── travas ──');
  const r2 = await post({ to: 'qualquer@gmail.com', subject: 'x', text: 'x' });
  ok(r2.status === 400 && /não permitido/.test((await bodyOf(r2)).error), 'destino fora da lista é recusado');
  const r2b = await post({ subject: 'x', text: 'x' });
  ok(r2b.status === 200, 'sem "to" o relay usa o primeiro destino permitido');
  const r3 = await worker.fetch(new Request('https://ec.workers.dev/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: 'x', text: 'x' })
  }), Object.assign({}, env, { APP_KEY: 'segredo' }));
  ok(r3.status === 401, 'APP_KEY definido exige a chave do app');
  const r3b = await worker.fetch(new Request('https://ec.workers.dev/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EC-Key': 'segredo' }, body: JSON.stringify({ subject: 'x', text: 'x' })
  }), Object.assign({}, env, { APP_KEY: 'segredo' }));
  ok(r3b.status === 200, 'com a chave certa o envio passa');
  const r4 = await post({ subject: 'x', text: 'x', attachments: [{ name: 'grande.bin', b64: Buffer.alloc(1200000).toString('base64') }] });
  const r4j = await bodyOf(r4);
  ok(r4.status === 400 && /MB/.test(r4j.error), 'anexo acima de MAX_BYTES é barrado', r4j.error);
  const r5 = await post({ subject: 'x', text: 'x', attachments: [{ name: 'vazio.bin', b64: '' }] });
  ok(r5.status === 400 && /anexo vazio/.test((await bodyOf(r5)).error), 'anexo vazio é barrado');
  const r6 = await post({ subject: '', text: '' });
  ok(r6.status === 400 && /corpo/.test((await bodyOf(r6)).error), 'e-mail sem corpo é barrado');
  const r7 = await worker.fetch(new Request('https://ec.workers.dev/outra', { method: 'POST', body: '{}' }), env);
  ok(r7.status === 404, 'rota desconhecida responde 404');
  const r8 = await worker.fetch(new Request('https://ec.workers.dev/send', { method: 'OPTIONS' }), env);
  ok(r8.status === 204 && r8.headers.get('access-control-allow-origin') === '*', 'preflight CORS liberado para o app');

  /* ── erros da Brevo são repassados, sem inventar sucesso ───────── */
  console.log('\n── erro da Brevo ──');
  brevoResp = { ok: false, status: 401, body: { message: 'Key not found' } };
  const r9 = await post({ to: 'eu@gmail.com', subject: 'x', text: 'x' });
  const r9j = await bodyOf(r9);
  ok(r9.status === 502 && r9j.ok === false && /Key not found/.test(r9j.error), 'erro da Brevo vira ok:false com a mensagem', JSON.stringify(r9j));

  brevoResp = { ok: true, status: 201, body: { messageId: 'brevo-999' } };
  const r10 = await bodyOf(await worker.fetch(new Request('https://ec.workers.dev/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"subject":"x","text":"y"}'
  }), { ALLOWED_TO: 'eu@gmail.com', FROM_EMAIL: 'eu@gmail.com' }));
  ok(r10.ok === false && /BREVO_API_KEY/.test(r10.error), 'sem chave configurada, o relay avisa em vez de fingir envio');

  global.fetch = fetchReal;
  console.log(fails ? `\n❌ ${fails} FALHA(S)` : '\n🎉 RELAY OK — TODOS OS TESTES PASSARAM');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ erro fatal no teste:', (e && e.stack) || e); process.exit(1); });
