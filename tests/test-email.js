/* ------------------------------------------------------------------
   Testes do envio de backup por e-mail (edgecontrol-glass-v2.html).

   O app inteiro roda em jsdom, com fetch dublado: nenhum e-mail sai de
   verdade. O que é conferido:

     1. período completo (1ª operação → última) e métricas do período;
     2. configuração (URL do relay, destino, chave, opções);
     3. o pacote: JSON __ec:3 com TODAS as operações e os prints dentro;
     4. o .zip opcional: assinatura, CRC-32, tamanhos e nomes de verdade
        (um leitor de ZIP mínimo lê o que o app escreveu);
     5. divisão em várias partes quando o pacote passa do limite;
     6. POST /send com assunto/corpo/anexos e gravação do último envio;
     7. caminhos de erro (relay 502) e o teste de canal (/health + /send);
     8. o lembrete de 7 dias sem envio.

   Rodar:  npm run test:email    (ou: node tests/test-email.js)
   Requer: npm install  (jsdom + fake-indexeddb)
------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');

const HTML = path.join(__dirname, '..', 'edgecontrol-glass-v2.html');
const FIXTURE = path.join(__dirname, '..', 'dados', 'backups', 'edgecontrol_2026-09-03.json');
const html = fs.readFileSync(HTML, 'utf8');
const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* PNG 1×1 — conteúdo válido e pequeno para os prints de teste */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/* ── leitor de ZIP mínimo: central directory → confere CRC e tamanho ── */
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65535; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD não encontrado');
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < total; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('cabeçalho central inválido');
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = Buffer.from(u8.subarray(p + 46, p + 46 + nameLen)).toString('utf8');
    if (dv.getUint32(off, true) !== 0x04034b50) throw new Error('cabeçalho local inválido em ' + name);
    const lNameLen = dv.getUint16(off + 26, true);
    const lExtraLen = dv.getUint16(off + 28, true);
    const data = u8.subarray(off + 30 + lNameLen + lExtraLen, off + 30 + lNameLen + lExtraLen + size);
    entries.push({ name, crc, size, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { total, cdSize, cdOff, entries };
}
/* CRC-32 idêntico ao do app, para conferir o que foi gravado */
let TAB = null;
function crc32(u8) {
  if (!TAB) {
    TAB = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); TAB[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = TAB[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const b64ToU8 = b64 => {
  const bin = Buffer.from(String(b64), 'base64');
  return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
};

(async () => {
  /* fetch dublado: guarda as chamadas e responde conforme o roteiro */
  const calls = [];
  let roteiro = () => ({ ok: true, id: 'msg-1' });
  const fakeFetch = async (url, init) => {
    const req = { url: String(url), method: (init && init.method) || 'GET',
      headers: (init && init.headers) || {}, body: init && init.body ? JSON.parse(init.body) : null };
    calls.push(req);
    if (/\/health$/.test(req.url)) {
      const r = roteiro('health');
      return { ok: true, status: 200, json: async () => Object.assign({ ok: true, configured: true, to: ['g***@gmail.com'], maxBytes: 24000000, minInterval: 20 }, r.health || {}) };
    }
    const r = roteiro('send');
    const status = r.status || (r.ok === false ? 502 : 200);
    const payload = r.ok === false ? { ok: false, error: r.error || 'Brevo HTTP 401' } : { ok: true, id: r.id || 'msg-1', bytes: 1, attachments: 1 };
    return { ok: status < 400, status, text: async () => JSON.stringify(payload), json: async () => payload };
  };

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://edgecontrol.local/',
    beforeParse(w) {
      w.indexedDB = new IDBFactory();
      w.print = () => {};
      w.fetch = fakeFetch;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      const ctx = new Proxy({}, {
        get: (t, k) => {
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
          if (k === 'canvas') return null;
          return () => ({});
        }
      });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      w.Chart = class { constructor(c, cfg) { this.config = cfg || {}; } get data() { return this.config.data || {}; } get options() { return this.config.options || {}; } destroy() {} update() {} resize() {} reset() {} };
      w.Chart.defaults = {};
      w.TextEncoder = TextEncoder;   /* jsdom não traz; o navegador traz */
      w.TextDecoder = TextDecoder;
      w.URL.createObjectURL = () => 'blob:mock';
      w.URL.revokeObjectURL = () => {};
      Object.defineProperty(w.HTMLImageElement.prototype, 'complete', { get() { return true; } });
      Object.defineProperty(w.HTMLImageElement.prototype, 'naturalWidth', { get() { return 12; } });
    }
  });

  const d = dom.window.document;
  const w = dom.window;
  const ev = code => w.eval(code);
  const status = () => (d.getElementById('emailStatus').textContent || '').replace(/\s+/g, ' ');
  const errors = [];
  w.addEventListener('error', e => errors.push(String(e.message || e)));
  const origErr = w.console.error;
  w.console.error = (...a) => { errors.push(a.join(' ')); origErr.apply(w.console, a); };

  await sleep(700);
  ok(ev('typeof S') === 'object', 'app inicializou');

  /* dados do fixture + 3 prints (um deles vinculado a uma operação) */
  w.localStorage.setItem('ec7', JSON.stringify(backup.state));
  await ev('load()');
  await ev(`(async()=>{
    const bin=atob(${JSON.stringify(PNG_B64)});
    const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
    for(const [id,at] of [['p-alfa','2026-08-01T10:00:00Z'],['p-beta','2026-08-02T10:00:00Z'],['p-gama','2026-09-01T10:00:00Z']]){
      /* dataUrl é o caminho normal dos backups importados (e o que o jsdom lê sem FileReader) */
      await IMGDB.put({id,blob:new Blob([u],{type:'image/png'}),dataUrl:'data:image/png;base64,'+btoa(bin),
        w:1,h:1,size:u.length,name:id+'.png',note:'',opId:null,at,marks:[],crop:null,kind:'print'});
    }
    S.operations[0].shots=['p-alfa'];
    save();
  })()`);

  /* ── 1. período completo e métricas ─────────────────────────────── */
  console.log('\n── 1. período completo ──');
  const rng = ev('emailRange()');
  ok(rng.from === '2026-07-24' && rng.to === '2026-09-03', 'período vai da 1ª à última operação', JSON.stringify(rng));
  ok(rng.to === (backup.state.operations.map(o => o.date).sort().pop()), 'última data confere com o backup do fixture');
  const modelo = ev('JSON.stringify((()=>{const m=emailModel();return {n:m.M.n,label:m.label,shots:m.shotsCount,cap:m.M.capitalStart};})())');
  const M = JSON.parse(modelo);
  ok(M.n === backup.state.operations.length, 'todas as operações entram (' + M.n + ')');
  ok(M.label === '24/07/2026 a 03/09/2026', 'rótulo do período em pt-BR', M.label);
  ok(M.shots === 1, 'prints vinculados às operações do período', String(M.shots));
  ok(M.cap === backup.state.settings.initialCapital, 'capital inicial do período = capital inicial do app', String(M.cap));

  /* ── 2. configuração ───────────────────────────────────────────── */
  console.log('\n── 2. configuração ──');
  ev(`emailFillForm();document.getElementById('emailWorker').value='https://ec-email.exemplo.workers.dev';
      document.getElementById('emailTo').value='destino@exemplo.com';
      document.getElementById('emailKey').value='segredo-123';
      document.getElementById('emailZip').checked=false;emailSaveForm();`);
  ok(ev("emailCfg().worker") === 'https://ec-email.exemplo.workers.dev' && ev("emailCfg().to") === 'destino@exemplo.com',
    'relay e destino salvos no aparelho');
  ok(ev("emailCfg().key") === 'segredo-123', 'chave do app (opcional) salva');
  ok(/Pronto para o primeiro envio|Configuração salva/.test(status()), 'status do cartão orienta o primeiro envio', status().slice(0, 60));

  /* ── 3. o pacote (sem .zip): JSON completo com prints ───────────── */
  console.log('\n── 3. pacote ──');
  const b = await ev('emailBuildParts()');
  ok(b.parts.length === 1, 'sem .zip e dentro do limite: um e-mail', String(b.parts.length));
  const anexos = b.parts[0].attachments.map(a => ({ name: a.name, bytes: a.bytes, kind: a.kind }));
  ok(anexos.length === 1 && /^edgecontrol_backup_\d{4}-\d{2}-\d{2}\.json$/.test(anexos[0].name), 'anexo único é o backup .json', anexos[0].name);
  ok(b.semPrints === false, 'caminho normal mantém os prints no JSON');
  const pack = JSON.parse(Buffer.from(b.parts[0].attachments[0].b64, 'base64').toString('utf8'));
  ok(pack.__ec === 3 && pack.via === 'email', 'envelope __ec:3 do app', String(pack.__ec));
  ok(pack.state.operations.length === backup.state.operations.length, 'o backup leva TODAS as operações', String(pack.state.operations.length));
  ok(Object.keys(pack.shots).length === 3, 'os prints vão dentro do JSON', String(Object.keys(pack.shots).length));
  ok(String(pack.shots['p-alfa'].d).startsWith('data:image/png;base64,'), 'print em data URL no pacote');
  ok(pack.shots['p-alfa'].opId === backup.state.operations[0].id, 'vínculo print → operação preservado');
  ok(JSON.stringify(pack.state.settings) === ev('JSON.stringify(S.settings)'), 'configurações do app intactas no backup');
  ok(pack.state.settings.initialCapital === backup.state.settings.initialCapital &&
     pack.state.settings.stopLoss === backup.state.settings.stopLoss, 'capital inicial e stop do fixture preservados');

  /* ── 4. o .zip opcional é um ZIP de verdade ────────────────────── */
  console.log('\n── 4. .zip das imagens ──');
  ev("emailSet({zip:true})");
  const bz = await ev('emailBuildParts()');
  const zips = bz.parts[0].attachments.filter(a => a.kind === 'zip');
  ok(zips.length === 1, 'com a opção ligada, o .zip acompanha o .json', String(zips.length));
  const zip = readZip(b64ToU8(zips[0].b64));
  const nomes = zip.entries.map(e => e.name).sort();
  ok(zip.total === 4, 'zip traz LEIA-ME + 3 prints', String(zip.total));
  ok(nomes.filter(n => /^prints\/.*\.png$/.test(n)).length === 3, 'prints nomeados na pasta prints/', nomes.join(' '));
  ok(zip.entries.every(e => e.crc === crc32(e.data)), 'CRC-32 de cada arquivo confere');
  ok(zip.entries.every(e => e.size === e.data.length && e.size > 0), 'tamanhos declarados conferem');
  ok(zip.cdOff + zip.cdSize <= b64ToU8(zips[0].b64).length, 'diretório central dentro do arquivo');
  const leia = zip.entries.find(e => e.name === 'LEIA-ME.txt');
  ok(/importe-o pelo app/.test(Buffer.from(leia.data).toString('utf8')), 'LEIA-ME do zip explica como restaurar');
  ev("emailSet({zip:false})");

  /* ── 5. divisão em partes quando passa do limite ───────────────── */
  console.log('\n── 5. divisão em partes ──');
  ev(`EMAIL_MAX_JSON=${b.jsonBytes - 1};EMAIL_ZIP_RAW=120;EMAIL_BUDGET_B64=500;`);
  const bs = await ev('emailBuildParts()');
  ok(bs.semPrints === true, 'acima do limite o .json sai sem prints');
  ok(bs.zipParts >= 2, 'imagens divididas em vários .zip', String(bs.zipParts));
  ok(bs.parts.length === 1 + bs.zipParts, 'um e-mail para os dados + um por parte de imagens', bs.parts.length + ' / ' + bs.zipParts);
  ok(bs.parts[0].attachments.length === 1 && bs.parts[0].attachments[0].kind === 'json',
    'o e-mail dos dados vai sozinho (o JSON nunca é cortado no meio)');
  const p1 = JSON.parse(Buffer.from(bs.parts[0].attachments[0].b64, 'base64').toString('utf8'));
  ok(Object.keys(p1.shots).length === 0 && p1.state.operations.length === backup.state.operations.length,
    'parte 1: dados completos, sem prints');
  const nomesZip = bs.parts.slice(1).flatMap(p => p.attachments.map(a => a.name));
  ok(nomesZip.length === bs.zipParts && nomesZip.every((n, i) => n === 'prints_p' + (i + 1) + 'de' + bs.zipParts + '.zip'),
    'partes numeradas p1deN…pNdeN', nomesZip.join(' '));
  const todasEntradas = bs.parts.slice(1).flatMap(p => readZip(b64ToU8(p.attachments[0].b64)).entries.map(e => e.name))
    .filter(n => /^prints\//.test(n));
  ok(todasEntradas.length === 3 && new Set(todasEntradas).size === 3, 'as partes somadas cobrem todos os prints, sem repetir');
  ok(bs.parts.every(p => p.b64 <= 500 || p.attachments.length === 1), 'nenhum e-mail passa do orçamento (o anexo maior fica sozinho)');
  ev('EMAIL_MAX_JSON=15.5*1024*1024;EMAIL_ZIP_RAW=15*1024*1024;EMAIL_BUDGET_B64=22000000;');

  /* ── 6. envio de verdade (fetch dublado) ───────────────────────── */
  console.log('\n── 6. envio ──');
  calls.length = 0;
  await ev('emailSend({manual:true})');
  const post = calls.filter(c => /\/send$/.test(c.url))[0];
  ok(!!post, 'POST para /send do relay', post && post.url);
  ok(post && post.headers['X-EC-Key'] === 'segredo-123', 'chave do app enviada no cabeçalho');
  ok(post && post.body.to === 'destino@exemplo.com', 'destino do corpo é o configurado');
  ok(post && /^EdgeControl — backup 24\/07\/2026 a 03\/09\/2026 · 37 ops/.test(post.body.subject), 'assunto com período e nº de operações', post && post.body.subject);
  ok(post && /24\/07\/2026 a 03\/09\/2026/.test(post.body.html), 'corpo em HTML traz o período');
  ok(post && /Operações/.test(post.body.html) && /Profit factor/.test(post.body.html), 'corpo traz o resumo do período');
  ok(post && /Como restaurar/.test(post.body.html), 'corpo explica como restaurar o backup');
  ok(post && post.body.meta.periodo.from === '2026-07-24' && post.body.meta.parte.total === 1, 'metadados do envio coerentes');
  ok(post && post.body.attachments[0].name.includes('edgecontrol_backup_'), 'anexo do envio é o backup');
  ok(post && typeof post.body.text === 'string' && post.body.text.length > 100, 'versão em texto simples incluída');
  ok(!!ev('emailCfg().lastAt'), 'último envio gravado no aparelho');
  ok(/Enviado para destino@exemplo\.com/.test(status()), 'status confirma o envio', status().slice(0, 70));

  /* ── 7. erros e teste de canal ─────────────────────────────────── */
  console.log('\n── 7. erros e teste de canal ──');
  roteiro = () => ({ ok: false, error: 'Brevo HTTP 401' });
  const antes = ev('emailCfg().lastAt');
  await ev('emailSend({manual:true})');
  ok(/Falha: Brevo HTTP 401/.test(status()), 'falha do relay aparece no status', status().slice(0, 70));
  ok(ev('emailCfg().lastAt') === antes, 'envio que falhou não sobrescreve o último envio bom');
  ok(d.getElementById('emailTo').value === 'destino@exemplo.com', 'configuração sobrevive ao erro');

  roteiro = type => (type === 'health' ? { health: { configured: true, needsKey: true } } : { ok: true, id: 'teste-1' });
  calls.length = 0;
  await ev('emailTest()');
  const health = calls.filter(c => /\/health$/.test(c.url))[0];
  const teste = calls.filter(c => /\/send$/.test(c.url))[0];
  ok(!!health && health.method === 'GET', 'teste pergunta /health ao relay');
  ok(!!teste && /teste do canal de e-mail/.test(teste.body.subject), 'e-mail de teste enviado');
  ok(!!teste && teste.body.attachments.length === 0, 'teste vai sem anexo (leve)');
  ok(/Teste enviado/.test(status()), 'status confirma o teste', status().slice(0, 70));

  roteiro = () => ({ ok: true, id: 'msg-2' });
  ev("emailSet({worker:'',to:''})");
  calls.length = 0;
  const avisos = [];
  ev('window.__avisos=[];window.__toastReal=toast;toast=function(m,t){window.__avisos.push(String(m));};');
  await ev('emailSend({manual:true})');
  ev('toast=window.__toastReal;');
  const avisosTexto = ev('JSON.stringify(window.__avisos)');
  ok(calls.length === 0, 'sem relay/destino não chama a rede');
  ok(/worker|github|destino/i.test(avisosTexto), 'o app avisa qual configuração falta', avisosTexto.slice(0, 110));

  /* ── 8. lembrete de 7 dias ─────────────────────────────────────── */
  console.log('\n── 8. lembrete de semana ──');
  const dezDias = new Date(Date.now() - 10 * 86400000).toISOString();
  ev(`emailSet({worker:'https://x.workers.dev',to:'a@b.com',zip:false,aviso:true,lastAt:${JSON.stringify(dezDias)},lastOps:37,lastShots:3,lastParts:1,lastBytes:100000});emailFillForm();`);
  ok(/Já faz 10 dias/.test(status()), 'avisa quando passa de 7 dias', status().slice(0, 90));
  ev('emailSet({aviso:false});emailFillForm();');
  ok(!/Já faz 10 dias/.test(status()), 'aviso desligado não aparece');
  ev('emailFillForm();');
  ok(/Último envio:/.test(status()), 'status mostra o último envio');

  /* ── 9. quem não tem Worker: caminho pelo GitHub ───────────────── */
  console.log('\n── 9. sem Worker ──');
  ok(ev("emailCfg().repo") === 'yuuv1/dashboard', 'repositório vem preenchido por padrão', ev('emailCfg().repo'));
  ev("emailFillForm()");
  ok(d.getElementById('emailRepo').value === 'yuuv1/dashboard', 'formulário mostra o repositório');
  ev("document.getElementById('emailRepo').value='yuuv1/outro-repo';emailSaveForm();");
  ok(ev("emailCfg().repo") === 'yuuv1/outro-repo', 'trocar o repositório é salvo');
  ev("emailSet({repo:'yuuv1/dashboard'});");
  const abertos = [];
  w.open = (u) => { abertos.push(String(u)); return null; };
  ev('emailAbrirGitHub()');
  ok(abertos.length === 1 && abertos[0] === 'https://github.com/yuuv1/dashboard/actions/workflows/backup-semanal.yml',
    'o botão abre o job semanal no GitHub', abertos[0]);
  ok(/Run workflow|GitHub/i.test(status()), 'o status explica o que fazer no GitHub', status().slice(0, 90));
  ev("emailSet({worker:'https://ec-email.exemplo.workers.dev'});emailSaveForm();");
  ev("emailSet({worker:''});emailFillForm();");
  ok(/Sem Worker configurado/.test(status()), 'sem Worker o status mostra o caminho alternativo', status().slice(0, 90));
  ok(/Enviar pelo GitHub/.test(status()), 'o status cita o botão do GitHub');
  const cartao = fs.readFileSync(HTML, 'utf8');
  ok(/Semanal automático — nada para configurar aqui/.test(cartao), 'o cartão deixa claro que o semanal não precisa de configuração');
  ok(/URL do Worker \(opcional — só para o botão “Enviar agora”\)/.test(cartao), 'o campo do Worker se declara opcional');
  ok(/Não sabe o que é isso\?/.test(cartao) && /Cloudflare/.test(cartao), 'o cartão explica o Worker em linguagem simples');
  ok(/emailAbrirGitHub\(\)/.test(cartao) && /🔗 Enviar pelo GitHub/.test(cartao), 'o botão do GitHub existe no cartão');
  ok(/Repositório no GitHub/.test(cartao), 'o cartão pede o repositório para esse botão');

  ok(errors.length === 0, 'nenhum erro de JS durante os testes', errors.slice(0, 2).join(' | '));

  console.log(fails ? `\n❌ ${fails} FALHA(S)` : '\n🎉 E-MAIL OK — TODOS OS TESTES PASSARAM');
  dom.window.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ erro fatal no teste:', e && e.stack || e); process.exit(1); });
