# Envio do backup por e-mail — montagem (15 minutos, uma vez só)

## Antes de tudo: o que é esse tal de “relay (Worker)”, e você precisa dele?

Imagine um **porteiro** na internet. O EdgeControl precisa mandar e-mail, mas não pode
guardar a senha do seu e-mail — o site é aberto, e qualquer pessoa que abrisse poderia
ler a senha e passar a mandar e-mail no seu nome. Então existe um **programinha
pequeno, hospedado de graça na Cloudflare**, que faz só três coisas:

1. guarda essa senha (a “chave” da Brevo) longe do site;
2. recebe o pedido do app — “manda este backup para o meu e-mail”;
3. repassa o pedido para a Brevo, que entrega a mensagem.

A **“URL do Worker”** é apenas o **endereço desse porteiro**, algo como
`https://ec-email.seu-usuario.workers.dev`. Você cria uma vez, cola no campo do app e
nunca mais mexe nele.

> ### Você só precisa disso para o botão “📧 Enviar agora” **do app**.
> Para o **semanal automático** (o que você combinou), **não precisa de Worker nenhum** —
> ele roda no GitHub Actions: veja a seção *“Semanal automático”* mais abaixo.
> Sem Worker, para mandar um backup fora de hora, use o botão
> **“🔗 Enviar pelo GitHub”** dentro do app (abre o job; você clica em *Run workflow*).

O app **não** guarda chave de e-mail nenhuma. Ele manda o pacote para um
**relay** (um Worker da Cloudflare) que guarda a chave da Brevo e faz o envio.
São três etapas: Brevo → Worker → app.

```
EdgeControl (navegador)  ──POST /send──▶  Cloudflare Worker  ──▶  Brevo  ──▶  seu e-mail
      (sem chave)                          (guarda o secret)
```

---

## 1. Brevo — conta e remetente (grátis, sem cartão)

1. Crie a conta em <https://www.brevo.com> (plano grátis: **300 e-mails/dia**, anexos até **25 MB**).
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: use o seu
   próprio e-mail (ex.: `guilherme@gmail.com`). A Brevo manda um código de
   confirmação — confirme.
   > Usar o seu e-mail como remetente é o caminho mais rápido: sem domínio
   > próprio para verificar, e o destino pode ser o mesmo endereço.
3. **SMTP & API → API Keys → Generate a new API key**. Copie a chave
   `xkeysib-…` (ela aparece uma única vez).

## 2. Worker — o relay

1. Entre em <https://dash.cloudflare.com> → **Workers & Pages → Create →
   Worker** (plano grátis, 100 mil requisições/dia).
2. Dê um nome, por exemplo `ec-email`, e **Deploy**.
3. **Edit code**: apague o conteúdo e cole o `worker.js` desta pasta. Deploy.
4. **Settings → Variables and Secrets** — adicione:

| Nome | Tipo | Valor |
|---|---|---|
| `BREVO_API_KEY` | **Secret** | `xkeysib-…` do passo 1 |
| `ALLOWED_TO` | Text | seu e-mail de destino (é o único destino aceito) |
| `FROM_EMAIL` | Text | o remetente confirmado na Brevo (passo 1) |
| `FROM_NAME` | Text | `EdgeControl` (opcional) |
| `APP_KEY` | Secret | invente uma senha longa (opcional, mas recomendado) |
| `BURST` / `WINDOW_SEC` | Text | opcionais: envios por janela (padrão 12 a cada 60 s) |

5. Anote a URL do Worker: `https://ec-email.SEU-USUARIO.workers.dev`
6. Teste no navegador: abra `SUA-URL/health`. Deve responder
   `{"ok":true,"configured":true,…}`.

## 3. App — configurar e enviar

No EdgeControl (v2): **Configurações → 📧 Backup por e-mail**

- **URL do relay**: a URL do Worker.
- **E-mail de destino**: o mesmo de `ALLOWED_TO`.
- **Chave do app**: a mesma de `APP_KEY` (se você definiu).
- **Repositório no GitHub**: só serve para o botão “🔗 Enviar pelo GitHub” (já vem
  preenchido com `yuuv1/dashboard`).
- **Testar canal** → deve chegar um e-mail de teste em segundos.
- **Enviar backup agora** → chega o período completo (da 1ª operação até hoje)
  com o JSON do backup e o resumo no corpo.

> No celular o app é o mesmo; a configuração fica salva no aparelho
> (`localStorage`). Repita o passo 3 em cada aparelho que for enviar.

---

## O que chega no e-mail

- **Assunto**: `EdgeControl — backup completo 24/07/2026 a 03/09/2026 · 37 ops · R$ 189,89`
- **Corpo**: resumo do período (operações, win rate, resultado, retorno,
  drawdown, dias), os destaques por ativo e operacional e as dicas automáticas.
- **Anexo**: `edgecontrol_backup_AAAA-MM-DD.json` — o mesmo arquivo que o botão
  *🔒 Backup de Dados → Exportar* gera (**com os prints dentro**), importável
  em qualquer aparelho.
- Se o JSON passar do limite de um e-mail, o app envia o **JSON sem prints**
  no primeiro e-mail e as imagens em `.zip` numerados (`prints_p1de3.zip`…).
- Se você marcar "anexar também as imagens", vem um `.zip` com os PNGs soltos
  (útil para ver os prints no celular sem importar).

## Limites e cuidados

- **300 e-mails/dia** no plano grátis da Brevo; o envio é manual e cabe folgado.
- **25 MB por e-mail** (Brevo). O Worker também barra acima de `MAX_BYTES`.
- O Worker só aceita os destinos de `ALLOWED_TO`; `APP_KEY` é uma segunda trava.
- Nada de token do GitHub aqui: para sincronizar PC ↔ celular, use a
  **Nuvem fácil** (código + PIN), que continua sendo o caminho dos dados.
- O e-mail **não** substitui a nuvem: é o retrato do período que fica guardado
  na sua caixa de entrada, mesmo que o aparelho quebre.

## Alternativas

- **Deno Deploy / Vercel / Netlify Functions**: o mesmo `worker.js` funciona com
  pequenos ajustes (lá o `env` vem de `Deno.env.get`/`process.env`).
- **Gmail + ponte local** (sem terceiros): dá para trocar a chamada da Brevo por
  SMTP do Gmail usando uma senha de app, rodando junto com o `EdgeControl.bat`.
  Só funciona com o PC ligado — por isso não é o caminho padrão.

---

# Semanal automático (sem abrir o app)

O que já existe neste repositório: **`.github/workflows/backup-semanal.yml`**, que
toda segunda-feira às 09:00 (São Paulo) roda
`ferramentas/email-backup/semanal.mjs`: lê a **Nuvem fácil**, decifra com o
código + PIN, monta os números da semana anterior com o **mesmo núcleo do
relatório que mora no app** e envia o e-mail pela Brevo com o `.json` em anexo.

Não precisa de Worker, nem de PC ligado, nem de app aberto — só de 3 segredos
uma única vez.

## Passo a passo (5 minutos, uma vez só)

1. No GitHub: **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|---|---|
| `EC_NUVEM_CODIGO` | o **código da nuvem** (o mesmo que você cola no celular) |
| `EC_NUVEM_PIN` | o **PIN** da nuvem fácil |
| `EC_EMAIL` | seu e-mail de destino |
| `EC_REMETENTE` | o remetente confirmado na Brevo (passo 1 da montagem acima) |
| `BREVO_API_KEY` | a chave `xkeysib-…` da Brevo |

   (Opcional: em **Variables**, crie `EC_COM_PRINTS` com o caminho de um backup
   `.json` do próprio repositório — ex.: `cloud/edgecontrol-sync.json` — para o
   anexo da semana levar também os prints daquele arquivo.)

2. Confirme que o workflow está na branch principal (`main`). O agendador do
   GitHub só olha para o arquivo da branch padrão.
3. **Rode uma vez na mão** para conferir: aba **Actions → backup-semanal → Run
   workflow**, marque **dry_run** (não envia nada) e, quando o job terminar,
   baixe o artifact **email-payload** para ver exatamente o e-mail montado.
   Sem o dry-run, o botão “Run workflow” envia de verdade.
4. Pronto. Toda segunda-feira o e-mail chega sozinho. Se quiser conferir uma
   semana específica, use o campo **semana** (`AAAA-MM-DD`, qualquer dia dela).

## O que chega toda segunda

- **Assunto**: `EdgeControl — semana 28/09/2026 a 04/10/2026 · 12 ops · +R$ 340,00`
- **Corpo**: resumo da semana (com a comparação com a semana anterior),
  **dia a dia**, destaques por ativo/operacional e a leitura automática.
- **Anexo**: `edgecontrol_backup_AAAA-MM-DD.json` — o backup completo e
  importável (Configurações → Backup de Dados → Importar).

## O que saber antes

- **Sem prints por padrão**: a Nuvem fácil não carrega imagens (é ela que o job
  lê, com código + PIN). Os prints continuam no aparelho e no envio manual
  “📧 Enviar backup agora”. Para o semanal levar prints, use `EC_COM_PRINTS`
  apontando para um backup `.json` que esteja no repositório.
- **Cron é “melhor esforço”**: o GitHub pode atrasar 5–30 minutos em horários
  de pico; o e-mail chega no mesmo dia.
- **Semana anterior seg→dom**: na segunda 05/10 o job envia 28/09 a 04/10.
- **Custo**: repositório privado tem 2.000 minutos/mês grátis; este job usa
  cerca de 1 minuto por semana (~5 no mês).
- O workflow também roda `node tests/test-semanal.js` antes de enviar: se o
  núcleo do relatório do app mudar de forma incompatível, o job falha em vez de
  mandar número errado.

---

# Aviso no WhatsApp (opcional, 2 minutos)

O e-mail continua sendo o canal principal — é ele que leva o `.json`. O WhatsApp
recebe só o **resumo da semana** (umas 8 linhas), para o celular apitar.

## Jeito grátis e sem burocracia: CallMeBot

1. Salve nos contatos do seu celular o número do bot: **+34 644 51 95 23**.
2. Mande para esse contato, pelo WhatsApp, exatamente:
   `I allow callmebot to send me messages`
3. Em até 2 minutos o bot responde com a sua **APIKEY** (ex.: `123456`).
4. Cadastre no GitHub (Settings → Secrets and variables → Actions):

| Nome | Onde | Valor |
|---|---|---|
| `EC_WA_PROVIDER` | **Variables** | `callmebot` |
| `EC_WA_PHONE` | **Secret** | seu número com DDI, ex.: `+5562999998888` |
| `EC_WA_KEY` | **Secret** | a APIKEY que o bot mandou |

Pronto: toda segunda o resumo chega também no WhatsApp. Para conferir antes,
rode o workflow com **dry_run** — o texto do zap aparece no artifact.

> **Sendo sincero sobre o CallMeBot:** é um serviço gratuito e comunitário (não é
> oficial do WhatsApp). Ele só manda texto, só para o seu próprio número, e pode
> atrasar ou ficar fora do ar em algum dia. Como o backup chega pelo e-mail de
> qualquer forma, o risco é perder o “teco” no celular — nada além disso.

## Se você quer o carimbo oficial da Meta (Cloud API)

Funciona, mas dá mais trabalho: conta **Meta Business**, número verificado,
**template de utilidade aprovado** (mensagem iniciada pela empresa precisa de
template) e a partir de out/2026 as conversas de serviço também passam a ser
cobradas. No Brasil, o template de utilidade custa cerca de **US$ 0,007 por
mensagem** (~R$ 0,04) — barato, mas com burocracia. Variáveis:

| Nome | Valor |
|---|---|
| `EC_WA_PROVIDER` (Variable) | `cloudapi` |
| `EC_WA_PHONE_ID` (Secret) | id do número no app da Meta |
| `EC_WA_TOKEN` (Secret) | token permanente do sistema |
| `EC_WA_TO` (Secret) | seu número, ex.: `+5562999998888` |

## Se você quer anexo no WhatsApp (não recomendado)

Z-API e UltraMsg conectam **o seu próprio número** por QR code e conseguem enviar
o arquivo. Mas: são APIs **não oficiais** (o WhatsApp pode bloquear o número
conectado), têm mensalidade, e transformam o seu WhatsApp pessoal em “robô”.
Além disso, o `.json` em anexo de zap móvel é bem menos prático de guardar do que
um anexo de e-mail. Se ainda assim quiser, o script já aceita:

| Provedor | `EC_WA_PROVIDER` | Outras variáveis |
|---|---|---|
| UltraMsg | `ultramsg` | `EC_WA_INSTANCE`, `EC_WA_TOKEN`, `EC_WA_TO` |
| Z-API | `zapi` | `EC_WA_INSTANCE`, `EC_WA_TOKEN`, `EC_WA_TO`, `EC_WA_CLIENT_TOKEN` |

## Como fica o texto

```
📊 *EdgeControl* — semana 31/08/2026 a 06/09
Operações: 5  (5W / 0L)
Acerto: 100,0%
Resultado: *+R$ 120,99*  (+32,6%)
Capital: R$ 371,58 → R$ 492,57
Dias: 3   ·   DD máx: R$ 0,00
Melhor ativo: EUR/USD R$ 120,99

📎 Backup completo (.json) no seu e-mail:
   edgecontrol_backup_2026-10-05.json
```

Se o WhatsApp falhar, o job **não** marca erro: o log avisa
(`⚠️ WhatsApp não saiu: … (o e-mail já foi enviado)`) e o e-mail segue valendo.
