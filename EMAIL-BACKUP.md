# Backup por e-mail — especificação

Envio **manual** do backup do período completo para o seu e-mail, com o
`.json` restauração (prints dentro) em anexo e um resumo analítico no corpo
da mensagem.

> Montagem em 15 minutos (Brevo + Worker): [`ferramentas/email-backup/LEIA-ME.md`](ferramentas/email-backup/LEIA-ME.md)

## Decisões (o que foi combinado)

| Ponto | Decisão |
|---|---|
| **Quando** | **Manual**, pelo botão *📧 Enviar backup agora*. Nada é enviado sem você tocar; o app lembra quando passa de 7 dias. |
| **Período** | **Período completo**, sempre desde a primeira operação até a última — não depende dos filtros da página do relatório. |
| **Frequência pretendida** | Semanal (fechando a semana anterior). Como o envio é manual, o cartão mostra “⏰ Já faz N dias — bom momento para fechar a semana”. |
| **Conteúdo** | Resumo do período no corpo + **backup `.json` com os prints** em anexo. |
| **Entrega** | Relay próprio (Cloudflare Worker) que guarda a chave da Brevo. **Nenhuma chave de e-mail no HTML.** |

## Arquitetura

```
EdgeControl (navegador)  ──POST /send──▶  Cloudflare Worker  ──▶  Brevo  ──▶  sua caixa de entrada
   monta o e-mail e o .json              guarda BREVO_API_KEY        entrega
   (sem chave nenhuma)
```

- **O relay é opcional.** Ele existe só para o botão “Enviar agora” **dentro do app**
  (que é o único caminho com os prints anexados). O **semanal automático** não usa o
  Worker: roda no GitHub Actions, direto contra a Brevo. Sem Worker, o envio fora de
  hora sai pelo botão “🔗 Enviar pelo GitHub” (abre o job; *Run workflow*).
- **Por que um relay?** A chave da Brevo é credencial de servidor: em código de
  navegador ela é pública e qualquer um passaria a enviar e-mail na sua conta.
  O site do EdgeControl é público, então a chave não pode morar nele.
- **Por que Brevo?** plano grátis de **300 e-mails/dia** sem cartão, anexos até
  **25 MB** por mensagem, envio por API simples (`POST /v3/smtp/email`).
- **Por que Cloudflare Workers?** grátis (100 mil requisições/dia), sem
  `npm install`, o `worker.js` é um arquivo só para colar no painel.
- Alternativas: Deno Deploy/Vercel/Netlify Functions (mesmo código, `env`
  diferente) e a ponte local do `EdgeControl.bat` com SMTP do Gmail — só
  funciona com o PC ligado, por isso não é o caminho padrão.

## Contrato do relay

| Rota | Uso |
|---|---|
| `GET /health` | diagnóstico: `{ok, configured, to[], maxBytes, burst, windowSec, needsKey}`. O app usa antes do “Testar canal”. |
| `POST /send` | corpo `{to, key?, subject, html, text, attachments:[{name,mime,b64}], meta}` → `{ok, id, bytes, attachments}` ou `{ok:false, error}` |

Travas do Worker: `ALLOWED_TO` (allowlist de destino, obrigatória), `APP_KEY`
opcional conferida no cabeçalho `X-EC-Key`, teto `MAX_BYTES` (24 MB por
padrão), janela de `BURST`/`WINDOW_SEC` (12 envios a cada 60 s — um backup
grande chega em várias partes, então o limite é por janela e não um intervalo
fixo), nomes de anexo saneados e erros da Brevo repassados com a mensagem
original (o app nunca “finge” sucesso).

## O que vai no e-mail

**Assunto**: `EdgeControl — backup 24/07/2026 a 03/09/2026 · 37 ops · +R$ 189,89`
(com `— parte k/N` quando o pacote é dividido).

**Corpo** (HTML de tabela simples com estilo em linha, mais uma versão em
texto puro — Gmail limpa CSS e corta mensagens grandes):

- operações, vitórias/derrotas, taxa de acerto;
- resultado do período, retorno sobre o capital, capital inicial → final;
- profit factor, payoff, ganho médio, perda média, melhor/pior operação;
- drawdown máximo, dias operados (positivos/negativos);
- destaques por ativo e por operacional (top 5);
- leitura automática (até 3 destaques do `rpInsights` já existente);
- anexos do e-mail com tamanho e o passo a passo de restauração.

**Anexos**:

| Arquivo | Quando |
|---|---|
| `edgecontrol_backup_AAAA-MM-DD.json` | sempre — envelope `__ec:3` do app, **com os prints** (data URL) e vínculo print → operação |
| `prints_pkdeN.zip` | quando as imagens não couberam no `.json` **ou** quando a opção “anexar também as imagens soltas” está ligada |

O `.zip` (método *store*, escrito por um gerador próprio de ~60 linhas) traz
`prints/<id>.<png|jpg|webp>` + `LEIA-ME.txt`, com CRC-32 e tamanhos corretos —
é um ZIP que abre em qualquer programa.

## Tamanhos (estimativa com o histórico atual)

| | Sem prints | Com prints |
|---|---|---|
| 37 operações (backup de 03/09) | ~24 KB | ~768 KB |

Limites internos do app: JSON de até **15,5 MB** por e-mail; cada `.zip` até
**15 MB** antes do base64; orçamento de **22 MB** de anexos (base64) por
mensagem. Passando disso o app divide o pacote: primeiro e-mail com os dados
(sem prints), depois as imagens em partes numeradas, sempre com o JSON inteiro
no primeiro — **a parte nunca corta o `.json` no meio**.

## Segurança e privacidade

- A chave da Brevo só existe como *secret* no Worker; o app guarda apenas a URL
  do relay, o destino e (opcional) a chave do app, em `localStorage`.
- O Worker recusa qualquer destino fora de `ALLOWED_TO` — não é um relay aberto.
- `/health` mostra os destinos mascarados (`g…@gmail.com`).
- O backup por e-mail é um **retrato** na caixa de entrada; a sincronização
  PC ↔ celular continua sendo a **Nuvem fácil** (código + PIN).
- Quem tiver acesso à sua caixa de e-mail vê o backup completo (que inclui os
  prints): a conta de e-mail passa a ser parte da sua segurança, como o PIN.

## Testes automatizados

- `tests/test-email.js` (jsdom, `fetch` dublado — nenhum e-mail sai):
  período completo da 1ª à última operação, configuração salva, pacote `__ec:3`
  com todas as operações e prints, ZIP conferido por um leitor real
  (assinatura, CRC-32, tamanhos, nomes), divisão em partes, POST `/send`
  (assunto, corpo, anexos, metadados), falha do relay, `/health` + teste de
  canal e o lembrete de 7 dias.
- `tests/test-email-worker.js`: contrato do relay, allowlist de destino,
  `APP_KEY`, teto de tamanho, anexo inválido, CORS, repasse de erro da Brevo e
  ausência de `BREVO_API_KEY`.

## O que ficou de fora (dito com todas as letras)

- **Envio automático agendado** (mesmo com o app fechado): exige um agendador
  externo (GitHub Actions lendo a Nuvem fácil) e um montador de relatório em
  Node. Fica para uma fase 2, se você quiser.
- **PDF “de verdade” no anexo**: hoje o PDF continua saindo pela impressão do
  relatório. Um PDF gerado sem navegador exigiria Chromium no servidor.
- **Períodos diferentes do “completo”**: o envio é sempre do começo ao fim. Se
  quiser “só a semana” ou “só o mês passado”, é uma evolução pequena no
  `emailModel()` (os presets do relatório já existem).

---

## Semanal automático (fase 2 — implementada)

O pedido depois do envio manual foi: “se tiver como deixar semanal automático,
sem eu precisar fazer coisas externas”. A resposta implementada:

```
GitHub Actions (toda segunda, 09:00 de São Paulo)
   └─ lê a Nuvem fácil (JSONBlob) ──▶ decifra com código + PIN (AES-GCM/PBKDF2)
      └─ núcleo puro do relatório do app (RPT-CORE) ──▶ números da semana anterior
         └─ Brevo ──▶ e-mail com resumo + .json completo em anexo
```

| Peça | Onde |
|---|---|
| Job semanal | `.github/workflows/backup-semanal.yml` |
| Programa (Node puro, sem dependências) | `ferramentas/email-backup/semanal.mjs` |
| Segredos (uma vez) | `EC_NUVEM_CODIGO`, `EC_NUVEM_PIN`, `EC_EMAIL`, `EC_REMETENTE`, `BREVO_API_KEY` |
| Testes | `tests/test-semanal.js` |

**Como o “sem fazer nada” funciona:** a Nuvem fácil já publica o estado a cada
salvamento, sozinha, sem token — é a única peça que precisa estar viva para o
job ler. O agendador é do próprio GitHub (o repositório já existe), o envio é
pela Brevo, e a chave fica em *secret*. Depois da configuração inicial de 5
minutos, não há nenhuma tarefa recorrente: não precisa abrir o app, ligar o PC
nem clicar em nada.

**Por que não usar o Worker para o cron:** funcionaria (Cloudflare tem *cron
triggers*), mas exigiria levar a matemática do relatório para dentro do Worker —
duplicando o que o app já faz. Rodando dentro do GitHub Actions, o job importa o
**núcleo puro do próprio app** (`RPT-CORE-START/END`), então os números da
semana são, por construção, os mesmos que o relatório mostra. `tests/test-semanal.js`
compara os dois lado a lado (e o workflow roda esse teste antes de enviar).

**Limites honestos:**

- **Prints**: a Nuvem fácil não carrega imagens, então o anexo semanal sai sem
  prints por padrão. Alternativa pronta: a variável `EC_COM_PRINTS` aponta para
  um backup `.json` que esteja no repositório (ex.: o arquivo da Nuvem GitHub
  com “Incluir prints” ligado) e as imagens entram no anexo.
- **Cron do GitHub é “melhor esforço”** (atrasos de 5–30 min são comuns) e só
  roda a partir da branch padrão — logo, este job só começa a valer depois que
  o PR for mergeado no `main`.
- **Semana anterior = segunda a domingo** (fuso `America/Sao_Paulo`).
- **Repositório privado**: 2.000 minutos/mês grátis; o job gasta ~1 min/semana.
