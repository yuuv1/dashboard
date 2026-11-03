# dados/ — backups do EdgeControl

Tudo aqui é **dado**, não código. Nada nesta pasta é publicado junto do app.

## `padrao.json` + `padrao-estado.json` — o que o site abre por padrão

Gerados por `npm run build:seed <backup.json>` a partir do backup exportado do app.
É o que faz **o painel publicado abrir já preenchido** em qualquer navegador novo:

| Arquivo | Para quê |
|---|---|
| `padrao-estado.json` (~30 KB) | operações + ajustes, baixado **antes** da primeira pintura |
| `padrao.json` (~3,5 MB) | backup completo; em segundo plano leva os prints para o IndexedDB |

⚠️ **Estes dois arquivos são públicos** (repositório público + GitHub Pages). Quem tiver o
link do site vê as operações e os prints neles, como em qualquer página pública.
Quem já usa o app em um aparelho **não é sobrescrito** (`ecSeeded` no localStorage).
O acesso à nuvem (Supabase) continua fechado por PIN — o que é público é só o retrato
publicado neste arquivo.

## `backups/`

Seis exportações reais do painel (`Configurações → 🔒 Backup de Dados → Exportar`),
no envelope `__ec` do app. Servem para duas coisas:

| Arquivo | Serve para |
|---|---|
| `edgecontrol_2026-08-12.json` | histórico antigo (8 operações) — referência |
| `edgecontrol_2026-09-03.json` | **fixture** de `test-core.js`, `test-dom.js`, `test-email.js`, `test-semanal.js` |
| `edgecontrol_2026-09-16_corrigido.json` | **fixture** (backup gerado por IA e corrigido) de `test-dom.js` |
| `edgecontrol_2026-09-16_com_imagens.json` | **fixture** (backup com prints) de `test-dom.js` |
| `edgecontrol_2026-09-17 (1).json` | **fixture** de `test-import.js`, `test-print-studio.js`, `test-extensions.js` e o **`?demo=1`** do app |
| `edgecontrol_2026-09-17.json` | backup do mesmo dia, **conteúdo diferente** do anterior (confira os dois) |

> `?demo=1` abre o app com dados de exemplo lidos de
> `dados/backups/edgecontrol_2026-09-17 (1).json` — só funciona servindo a pasta do
> repositório por HTTP (o `EdgeControl.bat` ou `ferramentas/preview-serve.js`).

## Por que estão aqui e não na raiz

Ficavam soltos na raiz e poluíam a pasta principal. Agora todo dado do usuário mora
num lugar só — e os testes apontam para cá. **Nada mudou de conteúdo**: os arquivos
são os mesmos (os hashes foram conferidos na mudança).

## Como usar

Para restaurar qualquer um deles no painel: *Configurações → 🔒 Backup de Dados →
Importar* e escolha o `.json`. **A importação substitui os dados do aparelho** — para o
dia a dia, prefira a ☁️ Nuvem fácil (PC ↔ celular) descrita em
[`../docs/NUVEM-GITHUB.md`](../docs/NUVEM-GITHUB.md).
