# EdgeControl

Painel de operações do mercado (apostas/opções) em **um único arquivo HTML**, que roda
no navegador, funciona offline (PWA) e guarda tudo no próprio aparelho.

- **`edgecontrol-glass-v2.html`** — o app que você usa (v2, com Estúdio de Prints, relatório, backup por e-mail).
- **`edgecontrol-glass.html`** — a v1, mantida **intacta** de propósito (contrato dos testes).

### 🔗 Online agora

**<https://yuuv1.github.io/dashboard/>** — site publicado pelo GitHub Pages, com PWA
instalável e sincronização Supabase ligada. No celular: abra o link e escolha
*“Adicionar à tela inicial”*.

| Peça | Estado |
|---|---|
| App | `edgecontrol-glass-v2.html` publicado no Pages a cada push |
| PWA | `manifest.webmanifest` + `sw.js` (pré-cache do app, gráficos e módulos Supabase) → abre offline |
| Nuvem | Supabase `muktpljlzzavcvhqdxco` (us-east-1): pareamento por **código + PIN**, RLS por conta e Storage privado |
| Abrir | o site **abre já com os dados** (operações, ajustes e prints) — `dados/padrao*.json` (público) |
| Sincronizar | automático: qualquer navegador entra como *aparelho do site* e envia/recebe operações, ajustes e prints sozinho |
| Trocar de conta/PIN | *Configurações → ☁️ Nuvem*: código `EC-7K4M-9Q2X` (já preenchido) + **PIN de 6 números** |

---

## Mapa do repositório

| Onde | O que é |
|---|---|
| `edgecontrol-glass-v2.html` | **o app** (v2). É este arquivo que você abre/instala |
| `edgecontrol-glass.html` | v1 intacta (não mexer) |
| `index.html` · `404.html` · `sw.js` | entrada do site e service worker (PWA/offline) |
| `manifest.webmanifest` | manifest do PWA (instalação na tela inicial) |
| `icones-app/` | ícones do PWA (192/512, maskable e ícone do iOS) |
| `vendor/` | Chart.js e Supabase JS locais, usados pelo app sem depender de CDN |
| `supabase/` | configuração pública, sincronização e guia do setup/auth privado |
| `EdgeControl.bat` | **instalador/servidor local no Windows** (duplo clique) |
| `_public/` | pacote pronto para arrastar no [Netlify Drop](https://app.netlify.com/drop) |
| `dados/backups/` | **seus backups `.json`** e as fixtures dos testes (veja `dados/LEIA-ME.md`) |
| `tests/` | suítes automatizadas (`npm test`) — não fazem parte do app publicado |
| `ferramentas/` | utilitários: contrato da ponte ECX, servidor de preview, relay de e-mail (`email-backup/`) |
| `docs/` | guias: instalação no Windows, nuvem, Estúdio de Prints, backup por e-mail |
| `_arquivo/` · `_backup/` | **arquivo morto**: versões antigas, uploads soltos e snapshots do app |
| `.github/workflows/` | publicação no GitHub Pages e o **backup semanal automático** |

### Onde ficam os guias
- Instalar no Windows: [`docs/COMO-INSTALAR.txt`](docs/COMO-INSTALAR.txt)
- Nuvem (PC ↔ celular): [`docs/NUVEM-GITHUB.md`](docs/NUVEM-GITHUB.md)
- Estúdio de Prints: [`docs/PRINT-STUDIO-v2.md`](docs/PRINT-STUDIO-v2.md)
- Supabase (login e sincronização privada): [`supabase/README.md`](supabase/README.md)
- Backup por e-mail (manual e semanal): [`docs/EMAIL-BACKUP.md`](docs/EMAIL-BACKUP.md) + [`ferramentas/email-backup/LEIA-ME.md`](ferramentas/email-backup/LEIA-ME.md)

---

## Usar

**Windows (recomendado):** clique duas vezes em `EdgeControl.bat` — ele sobe um
servidor local e abre o app no navegador (dá para instalar como aplicativo).

**Sem instalar nada:** arraste a pasta `_public/` para <https://app.netlify.com/drop>
e use o link gerado no PC e no celular.

**Dados no PC e no celular:** no app, *Configurações → ☁️ Nuvem* — digite o **código da
conta** (já vem preenchido) e o **PIN** uma vez em cada aparelho. Depois disso o app abre
já sincronizado, sem e-mail e sem link.

## Desenvolver e testar

```bash
npm install          # jsdom + fake-indexeddb (só para os testes)
npm test             # 15 suítes: app/DOM, impressão, importação, PWA
                     # (manifest + service worker), sincronização Supabase
                     # e desempenho móvel
npm run build:public # refaz _public/ (pacote do Netlify) a partir do app
npm run build:seed   # regera dados/padrao*.json a partir de um backup exportado
npm run test:email   # só a suíte de e-mail (fetch dublado, nada é enviado)
node ferramentas/preview-serve.js   # servidor local em http://0.0.0.0:8080
```

Os testes leem o app e as fixtures de `dados/backups/`. **Nenhum teste altera o app.**

## Backup e recuperação

| Recurso | O que faz |
|---|---|
| *Configurações → 🔒 Backup de Dados* | exporta/importa o `.json` completo (com prints); “➕ Somar” junta o backup da semana sem apagar (trabalho → casa) |
| ☁️ Nuvem fácil | sincroniza PC ↔ celular pelo fluxo legado (código + PIN) |
| ☁️ Supabase | sincroniza operações e prints entre aparelhos com login por e-mail e Storage privado |
| 📧 Backup por e-mail | envio manual do período completo, com o `.json` em anexo |
| ⏰ Semanal automático | GitHub Actions manda toda sexta 21h (e-mail com prints e, se quiser, WhatsApp) |

O backup semanal usa o **núcleo puro do relatório que mora dentro do app**
(`RPT-CORE-START/END`), então os números do e-mail são os mesmos do relatório.

## Publicar

- **GitHub Pages (oficial):** `.github/workflows/pages.yml` publica `index.html`,
  `edgecontrol-glass-v2.html`, `edgecontrol-glass.html`, `sw.js`, `manifest.webmanifest`,
  `404.html`, os ícones em `icones-app/`, os assets locais em `vendor/` e o runtime em
  `supabase/` a cada push na `main`. O passo *Conferir publicação* falha o deploy se
  faltar algum arquivo do PWA ou do Supabase.
- **Netlify:** arraste `_public/` (gerado por `npm run build:public`, já com PWA e Supabase).
- Ao mudar o app, rode `npm run build:public` — o teste `test:pwa` compara `_public/index.html`
  com o app e falha se você esquecer.

## PWA (offline de verdade)

- `manifest.webmanifest` é um **arquivo real** (manifest em Blob não permite instalar):
  `start_url` abre a v2, `scope` cobre a pasta publicada, ícones PNG 192/512 + maskable.
- `index.html`, `404.html` e a v2 declaram `manifest`, `theme-color`, `apple-touch-icon`
  e os metas do iOS.
- `sw.js` faz **pré-cache** da casca (HTML, manifest, `vendor/`, `supabase/`, ícones) na
  instalação e limpa caches antigos no `activate`; a navegação cai no app salvo quando
  não há rede. O app registra o worker com `updateViaCache:'none'` e recarrega uma vez
  quando uma versão nova assume.
- Fora da rede, o app abre e continua salvando no aparelho; ao voltar a conexão, a
  sincronização Supabase é retomada automaticamente.

## Arquivo morto

`_arquivo/` (versões antigas do app, ZIPs, uploads) e `_backup/` (snapshots datados)
existem só para consulta — nada ali é usado em tempo de execução.
