# Envio do backup por e-mail — montagem (15 minutos, uma vez só)

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
