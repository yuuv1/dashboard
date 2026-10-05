# 🗄️ Backup — EdgeControl após restore do v2.0.0 estável

**Data:** 02/10/2026
**Branch de sessão:** `arena/01a0fd1a-dashboard`
**Fonte restaurada:** `_backup/2026-09-29_v2.0.0-estavel` (commit `15b9b99` / tag `v2.0.0-estavel`)

A integração da ferramenta externa no dashboard foi desfeita. Os arquivos do app
voltaram ao estado estável de 29/09/2026. Este snapshot documenta esse ponto
para os próximos planos.

## O que tem aqui

| Arquivo | O que é |
|---|---|
| `edgecontrol-glass-v2.html` | app v2 restaurado (sem ponte da ferramenta externa) |
| `edgecontrol-glass.html` | app v1 original |
| `PRINT-STUDIO-v2.md` | guia do Estúdio de Prints |
| `package.json` | scripts de teste |
| `COMO-INSTALAR.txt` | instalação |
| `tests/*.js` | suítes de teste |
| `SHA256SUMS.txt` | hashes |

## Como restaurar

```bash
cp _backup/2026-10-02_pos-restore/edgecontrol-glass-v2.html .
cp _backup/2026-10-02_pos-restore/package.json .
cp _backup/2026-10-02_pos-restore/PRINT-STUDIO-v2.md .
cp _backup/2026-10-02_pos-restore/tests/*.js tests/
```
