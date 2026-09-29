# 🗄️ Backup — EdgeControl v2.0.0 (estado estável)

**Data:** 29/09/2026
**Commit git:** `15b9b99` — `feat(v2): 💾 salvar a imagem editada como análise separada`
**Tag git:** `v2.0.0-estavel` (aponta para o mesmo commit)
**Branch:** `arena/01a0ed19-dashboard`
**Build da v2:** `EC_BUILD = '2026-09-29.2-analise-v2'`

Este backup foi tirado **antes** de qualquer mudança para receber a ferramenta externa
de visualização das operações (pasta `ferramentas/`). É o último estado em que tudo
estava verde: **971 asserts passando nas 6 suítes de teste** (`npm test`).

## O que tem aqui

| Arquivo | O que é |
|---|---|
| `edgecontrol-glass-v2.html` | app v2 completo (Estúdio de Prints + 💾 Salvar análise) |
| `edgecontrol-glass.html` | app v1 **original, intocada** (mantida como referência) |
| `PRINT-STUDIO-v2.md` | guia de uso do Estúdio de Prints |
| `package.json` | scripts de teste (`npm test` roda as 6 suítes) |
| `COMO-INSTALAR.txt` | instruções de instalação do app |
| `tests/*.js` | as 6 suítes de teste |
| `SHA256SUMS.txt` | hashes para conferir se algum arquivo foi alterado |

## Como restaurar

**Opção 1 — pelo git (recomendada, restaura tudo de uma vez):**

```bash
git checkout v2.0.0-estavel -- edgecontrol-glass-v2.html PRINT-STUDIO-v2.md package.json tests/
```

ou voltar a branch inteira para o ponto estável:

```bash
git reset --hard v2.0.0-estavel     # ⚠️ descarta o que veio depois
```

**Opção 2 — copiando os arquivos deste backup:**

```bash
cp _backup/2026-09-29_v2.0.0-estavel/edgecontrol-glass-v2.html .
cp _backup/2026-09-29_v2.0.0-estavel/package.json .
cp _backup/2026-09-29_v2.0.0-estavel/PRINT-STUDIO-v2.md .
cp _backup/2026-09-29_v2.0.0-estavel/tests/*.js tests/
```

**Conferir se nada mudou desde o backup:**

```bash
cd _backup/2026-09-29_v2.0.0-estavel && sha256sum -c SHA256SUMS.txt
```
(rodando a partir da raiz do repo: `sha256sum -c _backup/2026-09-29_v2.0.0-estavel/SHA256SUMS.txt`
vai apontar para os nomes sem o caminho — use a Opção 1 se quiser comparar o repo inteiro.)

## Regra de ouro deste repositório

1. `edgecontrol-glass.html` (v1) **nunca** é editada.
2. Mudanças grandes entram **aditivas**: código novo em bloco próprio, nunca reescrevendo
   funções existentes sem necessidade.
3. Antes de commitar: `npm test` tem que fechar verde.
4. Ferramenta externa vive em `ferramentas/<pasta>/` — o app só a carrega se ela existir
   e se o manifesto for válido. Sem a pasta, o app é exatamente o mesmo de antes.
