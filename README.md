# EdgeControl

Painel de operações do mercado (apostas/opções) em **um único arquivo HTML**, que roda
no navegador, funciona offline (PWA) e guarda tudo no próprio aparelho.

- **`edgecontrol-glass-v2.html`** — o app que você usa (v2, com Estúdio de Prints, relatório, backup por e-mail).
- **`edgecontrol-glass.html`** — a v1, mantida **intacta** de propósito (contrato dos testes).

---

## Mapa do repositório

| Onde | O que é |
|---|---|
| `edgecontrol-glass-v2.html` | **o app** (v2). É este arquivo que você abre/instala |
| `edgecontrol-glass.html` | v1 intacta (não mexer) |
| `index.html` · `404.html` · `sw.js` | entrada do site e service worker (PWA/offline) |
| `icones-app/` | ícones do PWA |
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
- Backup por e-mail (manual e semanal): [`docs/EMAIL-BACKUP.md`](docs/EMAIL-BACKUP.md) + [`ferramentas/email-backup/LEIA-ME.md`](ferramentas/email-backup/LEIA-ME.md)

---

## Usar

**Windows (recomendado):** clique duas vezes em `EdgeControl.bat` — ele sobe um
servidor local e abre o app no navegador (dá para instalar como aplicativo).

**Sem instalar nada:** arraste a pasta `_public/` para <https://app.netlify.com/drop>
e use o link gerado no PC e no celular.

**Dados no PC e no celular:** no app, *Configurações → ☁️ Nuvem fácil* — escolha um
PIN, crie a nuvem e entre com o código no outro aparelho.

## Desenvolver e testar

```bash
npm install          # jsdom + fake-indexeddb (só para os testes)
npm test             # 9 suítes: núcleo, DOM, impressão, temas, importação,
                     # estúdio de prints, e-mail, relay e backup semanal
npm run test:email   # só a suíte de e-mail (fetch dublado, nada é enviado)
node ferramentas/preview-serve.js   # servidor local em http://0.0.0.0:8080
```

Os testes leem o app e as fixtures de `dados/backups/`. **Nenhum teste altera o app.**

## Backup e recuperação

| Recurso | O que faz |
|---|---|
| *Configurações → 🔒 Backup de Dados* | exporta/importa o `.json` completo (com prints) |
| ☁️ Nuvem fácil | sincroniza PC ↔ celular sozinho (código + PIN, sem token) |
| 📧 Backup por e-mail | envio manual do período completo, com o `.json` em anexo |
| ⏰ Semanal automático | GitHub Actions manda toda segunda (e-mail e, se quiser, WhatsApp) |

O backup semanal usa o **núcleo puro do relatório que mora dentro do app**
(`RPT-CORE-START/END`), então os números do e-mail são os mesmos do relatório.

## Publicar

- **GitHub Pages:** o workflow `.github/workflows/pages.yml` publica `index.html`,
  `edgecontrol-glass-v2.html`, `edgecontrol-glass.html`, `sw.js` e `404.html` a cada
  push na `main`.
- **Netlify:** arraste `_public/`.
- Ao mudar o app, atualize também `_public/index.html` (é a cópia usada no Netlify).

## Arquivo morto

`_arquivo/` (versões antigas do app, ZIPs, uploads) e `_backup/` (snapshots datados)
existem só para consulta — nada ali é usado em tempo de execução.
