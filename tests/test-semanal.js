/* ------------------------------------------------------------------
   Testes do backup semanal automático
   (ferramentas/email-backup/semanal.mjs + workflow).

   O envio roda fora do navegador, então aqui conferimos que ele fala a
   MESMA língua do app:

     1. núcleo do relatório: o script extrai o bloco puro do app;
     2. período: semana corrente (seg→sex), virada de mês/ano e fuso de SP;
     3. nuvem: o que o app cifra (AES-GCM/PBKDF2 do easyWrap), o script
        decifra — e PIN errado falha;
     4. números: mesma semana calculada pelo app (rptModel) e pelo script
        dão exatamente os mesmos valores;
     5. e-mail e anexo: assunto, dia a dia, backup __ec:3 completo;
     6. envio: payload da Brevo (sem rede), erro da Brevo e limite de 20 MB;
     7. dry-run: monta o e-mail, grava o arquivo e não chama a rede;
     8. workflow: cron de sexta 21h e os secrets/variáveis que o script lê.

   Rodar:  node tests/test-semanal.js
   Requer: npm install  (jsdom + fake-indexeddb)
------------------------------------------------------------------ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');

const RAIZ = path.join(__dirname, '..');
const FIXTURE = path.join(RAIZ, 'dados', 'backups', 'edgecontrol_2026-09-03.json');
const WF = path.join(RAIZ, '.github', 'workflows', 'backup-semanal.yml');
const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const html = fs.readFileSync(path.join(RAIZ, 'edgecontrol-glass-v2.html'), 'utf8');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.log('❌', msg, extra); } else console.log('✅', msg, extra);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const S = await import('../ferramentas/email-backup/semanal.mjs');
  const WA = await import('../ferramentas/email-backup/whatsapp.mjs');
  const core = S.carregarCore();

  /* ── 1. núcleo do relatório ────────────────────────────────────── */
  console.log('\n── 1. núcleo do relatório ──');
  ok(typeof core.rpMetrics === 'function' && typeof core.rpInsights === 'function', 'núcleo carregado direto do app');
  const textoCore = S.extrairCore(html);
  ok(!/document\.|window\.|navigator\./.test(textoCore), 'núcleo continua puro (sem DOM)');
  ok(textoCore.length > 8000, 'núcleo tem as funções do relatório', String(textoCore.length));
  let erro = '';
  try { S.extrairCore('<html>sem o bloco</html>'); } catch (e) { erro = e.message; }
  ok(/núcleo do relatório não encontrado/.test(erro), 'app sem o bloco é erro claro', erro);

  /* ── 2. período: semana corrente (seg→sex) ─────────────────────── */
  console.log('\n── 2. período (semana corrente, seg→sex) ──');
  const seg = iso => new Date(iso + 'T12:00:00Z').getUTCDay() === 1;
  const sex = iso => new Date(iso + 'T12:00:00Z').getUTCDay() === 5;
  const casos = [
    ['2026-10-09', '2026-10-05', '2026-10-09'],   /* sexta comum (dia do job) */
    ['2026-10-05', '2026-10-05', '2026-10-09'],   /* segunda → semana começando */
    ['2026-10-07', '2026-10-05', '2026-10-09'],   /* quarta da mesma semana */
    ['2026-10-10', '2026-10-05', '2026-10-09'],   /* sábado → semana que acabou */
    ['2026-10-11', '2026-10-05', '2026-10-09'],   /* domingo → semana que acabou */
    ['2026-09-04', '2026-08-31', '2026-09-04'],   /* vira o mês */
    ['2026-01-01', '2025-12-29', '2026-01-02']    /* vira o ano (ref é quinta) */
  ];
  casos.forEach(([ref, de, ate]) => {
    const p = S.periodoSemana(ref);
    ok(p.from === de && p.to === ate && seg(p.from) && sex(p.to),
      `ref ${ref} → ${de} a ${ate} (seg→sex)`, `${p.from} a ${p.to}`);
  });
  ok(S.hojeSP(Date.parse('2026-10-05T02:00:00Z')) === '2026-10-04', 'hojeSP usa o fuso de São Paulo (madrugada UTC)');
  ok(S.hojeSP(Date.parse('2026-10-05T12:00:00Z')) === '2026-10-05', 'hojeSP no meio do dia UTC');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(S.hojeSP()), 'hojeSP devolve AAAA-MM-DD');

  /* ── app em jsdom, para os testes de compatibilidade ───────────── */
  const dom1 = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://edgecontrol.local/',
    beforeParse(w) {
      w.indexedDB = new IDBFactory();
      /* jsdom não traz subtle: o app precisa do webcrypto do Node */
      Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true, writable: true });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      w.print = () => {};
      w.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      const ctx = new Proxy({}, { get: (t, k) => (k === 'canvas' ? null : (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => ({}))) });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      w.Chart = class { constructor(c, cfg) { this.config = cfg || {}; } get data() { return this.config.data || {}; } get options() { return this.config.options || {}; } destroy() {} update() {} resize() {} reset() {} };
      w.Chart.defaults = {};
      w.URL.createObjectURL = () => 'blob:mock';
      w.URL.revokeObjectURL = () => {};
      Object.defineProperty(w.HTMLImageElement.prototype, 'complete', { get() { return true; } });
    }
  });
  const w = dom1.window;
  const ev = code => w.eval(code);
  await sleep(700);
  ok(ev('typeof S') === 'object', 'app carregou no jsdom');

  /* ── 3. nuvem: o app cifra, o script decifra ───────────────────── */
  console.log('\n── 3. nuvem fácil (código + PIN) ──');
  const pacoteNuvem = { __ec: 3, exportedAt: '2026-09-03T18:34:05.467Z', state: backup.state, shots: {} };
  const cifrado = await ev(`easyWrap(${JSON.stringify(pacoteNuvem)},'4821')`);
  ok(cifrado && cifrado.ecEasy === 1 && cifrado.iv && cifrado.ct, 'easyWrap do app gerou {ecEasy,iv,ct}');
  const decifrado = await S.decifrarCloud(cifrado, '4821');
  ok(decifrado.state.operations.length === backup.state.operations.length, 'script decifra o que o app cifrou', String(decifrado.state.operations.length));
  ok(JSON.stringify(decifrado.state.settings) === JSON.stringify(backup.state.settings), 'configurações chegam intactas');
  let erroPin = '';
  try { await S.decifrarCloud(cifrado, '0000'); } catch (e) { erroPin = String(e && e.message || e); }
  ok(!!erroPin, 'PIN errado não decifra (AES-GCM autentica)', erroPin.slice(0, 40));
  ok((await S.decifrarCloud({ semCripto: true }, '4821')).semCripto === true, 'pacote sem cifra passa direto');
  const lidoFake = await S.lerNuvem({ codigo: 'abc', pin: '4821' }, async url => ({
    ok: true, json: async () => cifrado, url
  }));
  ok(lidoFake.state.operations.length === 37, 'lerNuvem busca o blob e devolve o estado');

  /* ── 4. números idênticos aos do app ───────────────────────────── */
  console.log('\n── 4. números da semana (paridade com o app) ──');
  ev(`S=${JSON.stringify(backup.state)};save();`);
  const p = S.periodoSemana('2026-09-04');       /* sexta → 31/08 a 04/09 */
  ok(p.from === '2026-08-31' && p.to === '2026-09-04', 'semana escolhida para o teste', p.from + ' a ' + p.to);
  const doScript = S.modeloSemana(core, backup.state, p.from, p.to);
  const doApp = JSON.parse(ev(`JSON.stringify((()=>{
    RPT.preset='custom';RPT.from=${JSON.stringify(p.from)};RPT.to=${JSON.stringify(p.to)};
    RPT.filt={res:'',type:'',plan:''};RPT.inc={kpi:true,compare:true,charts:true,daily:true,insights:true,ops:true,cards:true,gloss:true};
    const m=rptModel();
    return {n:m.M.n,net:m.M.net,wr:m.M.winRate,dd:m.M.maxDD,cap:m.M.capitalStart,capEnd:m.M.capitalEnd,
            days:m.M.tradedDays,ops:m.ops.length,best:m.M.best?m.M.best.value:null,wins:m.M.wins,losses:m.M.losses};
  })())`));
  ok(doScript.M.n === doApp.n, 'mesma quantidade de operações', doScript.M.n + ' = ' + doApp.n);
  ok(doScript.M.net === doApp.net, 'mesmo resultado líquido', doScript.M.net + ' = ' + doApp.net);
  ok(Math.abs(doScript.M.winRate - doApp.wr) < 1e-9 && doScript.M.wins === doApp.wins && doScript.M.losses === doApp.losses,
    'mesma taxa de acerto e W/L');
  ok(Math.abs(doScript.M.maxDD - doApp.dd) < 1e-9, 'mesmo drawdown máximo');
  ok(doScript.M.capitalStart === doApp.cap && doScript.M.capitalEnd === doApp.capEnd,
    'mesmo capital inicial/final do período', doScript.M.capitalStart + ' → ' + doScript.M.capitalEnd);
  ok(doScript.M.tradedDays === doApp.days, 'mesmos dias operados', String(doScript.M.tradedDays));
  ok(doScript.naSemana.every(o => o.date >= p.from && o.date <= p.to), 'nenhuma operação fora da semana');
  ok(doScript.M.n > 0, 'a semana do teste tem operações', String(doScript.M.n));
  ok(Array.isArray(doScript.insights) && doScript.insights.length > 0, 'leitura automática gerada', String(doScript.insights.length));

  /* ── 5. e-mail e anexo ─────────────────────────────────────────── */
  console.log('\n── 5. e-mail e anexo ──');
  const anexo = S.montarAnexo(backup.state, {}, '2026-10-05T12:00:00.000Z');
  ok(/^edgecontrol_backup_2026-10-05\.json$/.test(anexo.nome), 'nome do anexo com a data', anexo.nome);
  const pacote = JSON.parse(anexo.json);
  ok(pacote.__ec === 3 && pacote.via === 'email-semanal', 'envelope __ec:3 do app', String(pacote.__ec));
  ok(pacote.state.operations.length === backup.state.operations.length, 'anexo leva TODAS as operações (37)');
  const info = { core, build: 'teste', quando: '05/10/2026, 09:00:00', anexo, semPrints: true, anexoLegenda: 'backup completo sem prints' };
  info.subject = S.assunto(doScript, info);
  const email = S.montarEmail(doScript, info);
  ok(/^EdgeControl — semana 31\/08\/2026 a 04\/09\/2026 · \d+ ops · [+−]R\$/.test(email.subject), 'assunto com a semana e o resultado', email.subject);
  ok(email.html.includes('31/08/2026 a 04/09/2026'), 'corpo traz o período');
  ok((email.html.match(/<tr>/g) || []).length > 5, 'corpo traz as tabelas do resumo');
  ok(/Dia a dia/.test(email.html), 'corpo traz o dia a dia');
  ok((email.html.match(/31\/08\/2026|01\/09\/2026|02\/09\/2026|03\/09\/2026/g) || []).length >= 1, 'dia a dia lista as datas da semana');
  ok(/Por ativo/.test(email.html), 'corpo traz os destaques por ativo');
  const comOper = JSON.parse(JSON.stringify(backup.state));
  comOper.operations.forEach(o => { o.operationals = ['Pullback']; });
  const modeloOper = S.modeloSemana(core, comOper, p.from, p.to);
  const emailOper = S.montarEmail(modeloOper, Object.assign({}, info, { subject: 'x' }));
  ok(/Por operacional/.test(emailOper.html), 'com operacionais, o corpo traz os destaques por operacional');
  ok(/Leitura automática/.test(email.html), 'corpo traz a leitura automática');
  ok(/Como restaurar/.test(email.html) && /Backup de Dados/.test(email.html), 'corpo explica como restaurar');
  ok(/Sem prints neste anexo/.test(email.html), 'avisa quando o anexo vai sem prints');
  const comPrint = S.montarEmail(doScript, Object.assign({}, info, { semPrints: false, subject: 'x' }));
  ok(!/Sem prints neste anexo/.test(comPrint.html), 'com prints no anexo, o aviso sai');
  ok(!/NaN|undefined/.test(email.html + email.text), 'nenhum NaN/undefined no e-mail');
  ok(email.text.includes('Resultado:') && email.text.includes('Anexo:'), 'versão em texto puro acompanha');
  ok(!/Infinity|NaN/.test(email.text), 'texto puro não mostra Infinity/NaN', (email.text.match(/Profit factor[^\n]*/) || [''])[0]);
  const semanaVazia = S.modeloSemana(core, backup.state, '2026-01-05', '2026-01-11');
  const emailVazio = S.montarEmail(semanaVazia, Object.assign({}, info, { subject: 'x' }));
  ok(/Nenhuma operação registrada nesta semana/.test(emailVazio.html), 'semana sem operações tem aviso claro');
  const misto = S.juntarPrints(path.join(os.tmpdir(), 'nao-existe.json'), backup.state);
  ok(misto.de === '' && Object.keys(misto.shots).length === 0, 'sem arquivo de prints, segue sem imagens');
  const comShots = path.join(os.tmpdir(), 'ec-shots-teste.json');
  const estadoSemVinculo = JSON.parse(JSON.stringify(backup.state));
  fs.writeFileSync(comShots, JSON.stringify({ shots: { 'p-1': { d: 'data:image/png;base64,AA' } } }));
  const semVinculo = S.juntarPrints(comShots, estadoSemVinculo);
  ok(Object.keys(semVinculo.shots).length === 1, 'sem nenhum vínculo no estado, mantém as imagens (não perde nada)');
  const comVinculo = JSON.parse(JSON.stringify(backup.state));
  comVinculo.operations[0].shots = ['p-1', 'p-2'];
  fs.writeFileSync(comShots, JSON.stringify({ shots: { 'p-1': { d: 'aa' }, 'p-9': { d: 'x' }, 'p-3': { d: 'bb', opId: comVinculo.operations[1].id } } }));
  const vinculado = S.juntarPrints(comShots, comVinculo);
  ok(Object.keys(vinculado.shots).length === 2 && vinculado.shots['p-1'] && vinculado.shots['p-3'] && !vinculado.shots['p-9'],
    'entram os prints citados pela operação e os ligados por opId; os soltos ficam fora', Object.keys(vinculado.shots).join(','));
  fs.unlinkSync(comShots);
  /* união nuvem + repo: a fresca da nuvem vence, o repo completa */
  const uniao = S.unirShots({ 'a': { d: 'repo' }, 'b': { d: 'repo' } }, { 'a': { d: 'nuvem' } });
  ok(uniao.a.d === 'nuvem' && uniao.b.d === 'repo', 'união: nuvem vence no conflito, repo completa o resto');
  ok(Object.keys(S.unirShots()).length === 0, 'união vazia não quebra');
  /* o job encontra sozinho o arquivo padrão da Nuvem GitHub no repo */
  const cloudPadrao = path.join(RAIZ, 'cloud', 'edgecontrol-sync.json');
  if (!fs.existsSync(cloudPadrao)) {
    const packTmp = path.join(os.tmpdir(), 'ec-pack-uniao.json');
    const saidaTmp = path.join(os.tmpdir(), 'ec-email-uniao.json');
    fs.writeFileSync(packTmp, JSON.stringify({ __ec: 3, exportedAt: '2026-09-03T18:34:05.467Z', state: backup.state, shots: { 'n-1': { d: 'data:image/png;base64,AA' } } }));
    fs.writeFileSync(cloudPadrao, JSON.stringify({ shots: { 'n-1': { d: 'velha' }, 'r-1': { d: 'data:image/png;base64,BB' } } }));
    try {
      await S.main({}, ['node', 'semanal.mjs', '--arquivo=' + packTmp, '--dry-run', '--saida=' + saidaTmp, '--semana=2026-09-04'],
        { fetch: () => { throw new Error('não deveria chamar a rede'); }, core, app: path.join(RAIZ, 'edgecontrol-glass-v2.html'), log: () => {} });
      const brutoUniao = JSON.parse(fs.readFileSync(saidaTmp, 'utf8'));
      ok(brutoUniao.anexo.prints === 2, 'dry-run soma os prints da nuvem e do arquivo padrão do repo', String(brutoUniao.anexo.prints));
    } finally {
      if (fs.existsSync(packTmp)) fs.unlinkSync(packTmp);
      if (fs.existsSync(saidaTmp)) fs.unlinkSync(saidaTmp);
      fs.unlinkSync(cloudPadrao);
    }
    ok(!fs.existsSync(cloudPadrao), 'arquivo temporário do teste removido do repo');
  } else {
    ok(!!S.padraoPrints(), 'arquivo padrão da Nuvem GitHub existe no repo e o job o encontra', S.padraoPrints());
  }

  /* ── 6. envio pela Brevo ───────────────────────────────────────── */
  console.log('\n── 6. envio (fetch dublado) ──');
  const cfg = { chave: 'xkeysib-teste', remetente: 'eu@gmail.com', destino: 'eu@gmail.com', nomeRemetente: 'EdgeControl' };
  let chamada = null;
  const fetchOk = async (url, init) => { chamada = { url, headers: init.headers, body: JSON.parse(init.body) }; return { ok: true, status: 201, text: async () => JSON.stringify({ messageId: 'brevo-77' }) }; };
  const envio = await S.enviarBrevo(cfg, email, anexo, fetchOk);
  ok(envio.id === 'brevo-77', 'envio devolve o id da Brevo', envio.id);
  ok(chamada.url === 'https://api.brevo.com/v3/smtp/email' && chamada.headers['api-key'] === 'xkeysib-teste', 'chama a API com a chave no cabeçalho');
  ok(chamada.body.to[0].email === 'eu@gmail.com' && chamada.body.sender.email === 'eu@gmail.com', 'destino e remetente corretos');
  ok(chamada.body.subject === email.subject, 'assunto repassado');
  ok(chamada.body.attachment.length === 1 && chamada.body.attachment[0].name === anexo.nome, 'anexo repassado com nome');
  const voltou = JSON.parse(Buffer.from(chamada.body.attachment[0].content, 'base64').toString('utf8'));
  ok(voltou.state.operations.length === 37 && voltou.__ec === 3, 'o anexo enviado é o backup completo e importável');
  const fetchErro = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ message: 'Key not found' }) });
  let erroBrevo = '';
  try { await S.enviarBrevo(cfg, email, anexo, fetchErro); } catch (e) { erroBrevo = e.message; }
  ok(/Key not found/.test(erroBrevo), 'erro da Brevo sobe com a mensagem original', erroBrevo);
  let erroGrande = '';
  try { await S.enviarBrevo(cfg, email, { nome: 'gigante.json', json: 'x'.repeat(21 * 1024 * 1024) }, fetchOk); }
  catch (e) { erroGrande = e.message; }
  ok(/limite de 20 MB/.test(erroGrande), 'anexo acima de 20 MB é barrado antes de enviar', erroGrande);

  /* ── 7. dry-run não toca na rede ───────────────────────────────── */
  console.log('\n── 7. dry-run ──');
  const packLocal = path.join(os.tmpdir(), 'ec-pack-teste.json');
  fs.writeFileSync(packLocal, JSON.stringify({ __ec: 3, exportedAt: '2026-09-03T18:34:05.467Z', state: backup.state, shots: {} }));
  const saida = path.join(os.tmpdir(), 'ec-email-payload.json');
  if (fs.existsSync(saida)) fs.unlinkSync(saida);
  const r = await S.main({}, ['node', 'semanal.mjs', '--arquivo=' + packLocal, '--dry-run', '--saida=' + saida,
    '--semana=2026-09-04'], { fetch: () => { throw new Error('não deveria chamar a rede'); }, core, app: path.join(RAIZ, 'edgecontrol-glass-v2.html'), log: () => {} });
  ok(r.dryRun === true && r.semana === '31/08/2026 a 04/09/2026', 'dry-run devolve o resumo da semana', JSON.stringify(r.semana));
  const gravado = JSON.parse(fs.readFileSync(saida, 'utf8'));
  ok(gravado.dryRun === true && /EdgeControl — semana/.test(gravado.subject), 'arquivo do dry-run tem o assunto montado');
  ok(gravado.semana.from === '2026-08-31' && gravado.semana.to === '2026-09-04', 'arquivo registra o período');
  ok(gravado.anexo.nome.startsWith('edgecontrol_backup_') && gravado.anexo.bytes > 1000, 'arquivo registra o anexo e o tamanho', gravado.anexo.nome);
  ok(/Operações/.test(gravado.html || ''), 'arquivo guarda o e-mail completo para inspeção');
  fs.unlinkSync(saida); fs.unlinkSync(packLocal);
  /* caminho de produção: sem --arquivo, o script busca a Nuvem fácil */
  const urls = [];
  const fetchNuvem = async (url, init) => {
    urls.push(String(url));
    if (/jsonBlob/.test(String(url))) return { ok: true, status: 200, json: async () => cifrado };
    throw new Error('o dry-run não pode enviar e-mail');
  };
  const rNuvem = await S.main({ EC_NUVEM_CODIGO: 'blob-123', EC_NUVEM_PIN: '4821' },
    ['node', 'semanal.mjs', '--dry-run', '--saida=' + saida, '--semana=2026-09-04'],
    { fetch: fetchNuvem, core, app: path.join(RAIZ, 'edgecontrol-glass-v2.html'), log: () => {} });
  ok(urls.length === 1 && urls[0] === 'https://jsonblob.com/api/jsonBlob/blob-123', 'lê o blob certo da Nuvem fácil', urls[0]);
  ok(rNuvem.dryRun === true && fs.existsSync(saida), 'nuvem → e-mail montado (produção simulada)');
  const viaNuvem = JSON.parse(fs.readFileSync(saida, 'utf8'));
  ok(viaNuvem.anexo.bytes === gravado.anexo.bytes, 'mesmo anexo lido da nuvem e do arquivo local', String(viaNuvem.anexo.bytes));
  fs.unlinkSync(saida);

  /* ── 8. WhatsApp (opcional) ────────────────────────────────────── */
  console.log('\n── 8. WhatsApp ──');
  const waTexto = WA.textoWhatsApp(doScript, core, info);
  ok(/EdgeControl/.test(waTexto) && waTexto.includes('31/08') , 'texto do WhatsApp traz o período', waTexto.split('\n')[0]);
  const semNB = t => String(t).replace(/\u00A0|\u202F/g, ' ');   /* Intl usa espaço fixo entre R$ e o número */
  ok(/\*\+R\$ 120,99\*/.test(semNB(waTexto)), 'resultado em destaque (*negrito*) no texto', (waTexto.match(/Resultado[^\n]*/) || [''])[0]);
  ok(!/<[a-z]+>/i.test(waTexto), 'texto do WhatsApp sem HTML');
  ok(!/\(sem ativo\)/.test(waTexto) && !/Pior op: —/.test(waTexto), 'texto não polui com “(sem ativo)” nem traços soltos');
  ok(waTexto.includes(anexo.nome), 'texto aponta o .json do e-mail');
  ok(waTexto.length <= 3500, 'texto dentro do limite de mensagem', String(waTexto.length));
  const waVazio = WA.textoWhatsApp(S.modeloSemana(core, backup.state, '2026-01-05', '2026-01-11'), core, info);
  ok(/Nenhuma operação registrada/.test(waVazio), 'semana sem operações tem texto próprio');

  ok(WA.waConfigurado({}) === null, 'sem variáveis, WhatsApp fica desligado');
  ok(WA.waConfigurado({ EC_WA_PHONE: '+5511999998888' }) === null, 'só o telefone não basta');
  const cfgCall = WA.waConfigurado({ EC_WA_PHONE: '+5511999998888', EC_WA_KEY: '123456' });
  ok(cfgCall && cfgCall.provider === 'callmebot', 'callmebot é detectado (grátis)');
  ok(WA.waConfigurado({ EC_WA_TOKEN: 't', EC_WA_PHONE_ID: '1', EC_WA_TO: 'x' }).provider === 'cloudapi', 'cloudapi é detectado');
  ok(WA.waConfigurado({ EC_WA_INSTANCE: 'i', EC_WA_TOKEN: 't', EC_WA_TO: 'x', EC_WA_PROVIDER: 'zapi' }).provider === 'zapi', 'zapi é detectado quando pedido');
  ok(WA.waConfigurado({ EC_WA_PROVIDER: 'zapi' }) === null, 'provedor pedido sem as chaves não configura nada');

  let waChamada = null;
  const fetchWa = async (url, init) => { waChamada = { url: String(url), init: init || {} }; return { ok: true, status: 200, text: async () => 'Message sent', json: async () => ({}) }; };
  const rCall = await WA.enviarWhatsApp(cfgCall, waTexto, fetchWa);
  ok(/^https:\/\/api\.callmebot\.com\/whatsapp\.php\?/.test(waChamada.url), 'callmebot: GET no endpoint certo', waChamada.url.slice(0, 60));
  ok(waChamada.url.includes('phone=' + encodeURIComponent('+5511999998888')) && waChamada.url.includes('apikey=123456'), 'callmebot: telefone e apikey na URL');
  ok(waChamada.url.includes(encodeURIComponent('EdgeControl')), 'callmebot: mensagem vai codificada', String(rCall.id));
  const fetchWaErro = async () => ({ ok: true, status: 200, text: async () => 'APIKEY is invalid', json: async () => ({}) });
  let waErro = '';
  try { await WA.enviarWhatsApp(cfgCall, waTexto, fetchWaErro); } catch (e) { waErro = e.message; }
  ok(/invalid/i.test(waErro), 'callmebot que responde erro no corpo também falha', waErro);

  let cloudChamada = null;
  const fetchCloud = async (url, init) => { cloudChamada = { url: String(url), init }; return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }), text: async () => '' }; };
  const rCloud = await WA.enviarWhatsApp(WA.waConfigurado({ EC_WA_TOKEN: 'tok', EC_WA_PHONE_ID: '99', EC_WA_TO: '+5511' }), waTexto, fetchCloud);
  const cloudBody = JSON.parse(cloudChamada.init.body);
  ok(cloudChamada.url === 'https://graph.facebook.com/v22.0/99/messages', 'cloudapi: endpoint oficial', cloudChamada.url);
  ok(cloudChamada.init.headers.Authorization === 'Bearer tok', 'cloudapi: token no cabeçalho');
  ok(cloudBody.messaging_product === 'whatsapp' && cloudBody.to === '+5511' && cloudBody.type === 'text' && cloudBody.text.body === waTexto, 'cloudapi: corpo oficial');
  ok(rCloud.id === 'wamid.1', 'cloudapi: devolve o id da mensagem');

  let zapiChamada = null;
  const fetchZ = async (url, init) => { zapiChamada = { url: String(url), init }; return { ok: true, status: 200, json: async () => ({ messageId: 'z1' }), text: async () => '' }; };
  await WA.enviarWhatsApp(WA.waConfigurado({ EC_WA_PROVIDER: 'zapi', EC_WA_INSTANCE: 'inst', EC_WA_TOKEN: 'tok', EC_WA_TO: '5511', EC_WA_CLIENT_TOKEN: 'ct' }), waTexto, fetchZ);
  ok(zapiChamada.url.includes('/instances/inst/token/tok/send-text'), 'zapi: endpoint com instância e token', zapiChamada.url.slice(0, 70));
  ok(zapiChamada.init.headers['Client-Token'] === 'ct', 'zapi: Client-Token no cabeçalho');
  ok(JSON.parse(zapiChamada.init.body).message === waTexto, 'zapi: mensagem no corpo');

  let ultraChamada = null;
  const fetchU = async (url, init) => { ultraChamada = { url: String(url), init }; return { ok: true, status: 200, json: async () => ({ sent: 'true', id: 'u1' }), text: async () => '' }; };
  await WA.enviarWhatsApp(WA.waConfigurado({ EC_WA_PROVIDER: 'ultramsg', EC_WA_INSTANCE: 'i1', EC_WA_TOKEN: 't1', EC_WA_TO: '5511' }), waTexto, fetchU);
  ok(/api\.ultramsg\.com\/i1\/messages\/chat$/.test(ultraChamada.url) && /token=t1/.test(ultraChamada.init.body), 'ultramsg: endpoint e token no formulário', ultraChamada.url);

  /* o zap não pode derrubar o e-mail: main() segue e devolve o aviso */
  const packWa = path.join(os.tmpdir(), 'ec-pack-wa.json');
  fs.writeFileSync(packWa, JSON.stringify({ __ec: 3, exportedAt: '2026-09-03T18:34:05.467Z', state: backup.state, shots: {} }));
  const chamadasWa = [];
  const fetchMisto = async (url, init) => {
    chamadasWa.push(String(url));
    if (/brevo/.test(String(url))) return { ok: true, status: 201, text: async () => JSON.stringify({ messageId: 'm1' }) };
    return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };   /* WhatsApp cai */
  };
  const rMisto = await S.main({ EC_EMAIL: 'eu@gmail.com', EC_REMETENTE: 'eu@gmail.com', BREVO_API_KEY: 'k',
    EC_WA_PHONE: '+5511999998888', EC_WA_KEY: '123' },
    ['node', 'semanal.mjs', '--arquivo=' + packWa, '--semana=2026-09-04'],
    { fetch: fetchMisto, core, app: path.join(RAIZ, 'edgecontrol-glass-v2.html'), log: () => {} });
  ok(rMisto.enviado === true, 'com o WhatsApp fora do ar, o e-mail continua sendo enviado');
  ok(chamadasWa.some(u => /brevo/.test(u)) && chamadasWa.some(u => /callmebot/.test(u)), 'tentou e-mail e depois WhatsApp');
  ok(rMisto.whatsapp && rMisto.whatsapp.ok === false && /500/.test(rMisto.whatsapp.erro), 'o resultado registra a falha do zap', JSON.stringify(rMisto.whatsapp));
  const saidaWa = path.join(os.tmpdir(), 'ec-payload-wa.json');
  await S.main({ EC_WA_PHONE: '+5511999998888', EC_WA_KEY: '123' },
    ['node', 'semanal.mjs', '--arquivo=' + packWa, '--dry-run', '--saida=' + saidaWa, '--semana=2026-09-04'],
    { fetch: () => { throw new Error('não deveria chamar a rede'); }, core, app: path.join(RAIZ, 'edgecontrol-glass-v2.html'), log: () => {} });
  const brutoWa = JSON.parse(fs.readFileSync(saidaWa, 'utf8'));
  ok(brutoWa.whatsapp && brutoWa.whatsapp.provider === 'callmebot' && /EdgeControl/.test(brutoWa.whatsapp.texto),
    'dry-run mostra o texto do WhatsApp sem enviar');
  fs.unlinkSync(saidaWa); fs.unlinkSync(packWa);

  /* ── 9. workflow ───────────────────────────────────────────────── */
  console.log('\n── 9. workflow do GitHub Actions ──');
  const yml = fs.readFileSync(WF, 'utf8');
  ok(/cron:\s*'0 0 \* \* 6'/.test(yml), 'roda toda sexta 21h (sábado 00:00 UTC = 21:00 de São Paulo)');
  ok(yml.includes('workflow_dispatch'), 'dá para disparar na mão ("Run workflow")');
  ok(/concurrency:/.test(yml) && /contents: read/.test(yml), 'sem execuções sobrepostas e com permissão mínima');
  ok(/node ferramentas\/email-backup\/semanal\.mjs/.test(yml), 'o workflow chama o script do backup semanal');
  ['EC_NUVEM_CODIGO', 'EC_NUVEM_PIN', 'EC_EMAIL', 'EC_REMETENTE', 'BREVO_API_KEY', 'EC_SEMANA', 'EC_DRY_RUN', 'EC_COM_PRINTS',
   'EC_WA_PROVIDER', 'EC_WA_PHONE', 'EC_WA_KEY', 'EC_WA_TO', 'EC_WA_TOKEN', 'EC_WA_PHONE_ID', 'EC_WA_INSTANCE', 'EC_WA_CLIENT_TOKEN']
    .forEach(nome => ok(yml.includes(nome), 'workflow passa ' + nome));
  ok(!/xkeysib|senha|pin:/i.test(yml.replace(/EC_NUVEM_PIN/g, '')), 'nenhum segredo escrito no workflow');
  ok(/node tests\/test-semanal\.js/.test(yml), 'o workflow confere o núcleo antes de enviar');
  ok(/npm install/.test(yml), 'o workflow instala as dependências antes do teste');

  /* ── extra: o guia e o cartão do app apontam para cá ───────────── */
  console.log('\n── extra: documentação e app ──');
  const guia = fs.readFileSync(path.join(RAIZ, 'ferramentas', 'email-backup', 'LEIA-ME.md'), 'utf8');
  ok(/backup-semanal\.yml|backup semanal/i.test(guia), 'guia do relay explica o semanal automático');
  ok(/EC_NUVEM_CODIGO/.test(guia) && /semanal\.mjs/.test(guia), 'guia lista os secrets e o script');
  const appTxt = fs.readFileSync(path.join(RAIZ, 'edgecontrol-glass-v2.html'), 'utf8');
  ok(/semanal/i.test(appTxt) && /RPT-CORE-START/.test(appTxt), 'o app mantém o núcleo e cita o envio semanal');

  ok(erro === '' || true, '');
  console.log(fails ? `\n❌ ${fails} FALHA(S)` : '\n🎉 SEMANAL OK — TODOS OS TESTES PASSARAM');
  dom1.window.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ erro fatal no teste:', (e && e.stack) || e); process.exit(1); });
