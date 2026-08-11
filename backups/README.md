# 📦 Backup EdgeControl — como funciona

Este repositório guarda **todos os backups das suas operações** do dashboard (EdgeControl),
organizados **por dia**, e gera o arquivo `.json` que você importa de volta no app.

---

## 🗂️ Estrutura

```
backups/
├── README.md                        ← este arquivo
├── config.json                      ← capital inicial e valor de hoje (conferência da conta)
├── edgecontrol_master.json          ← BACKUP COMPLETO (importável no app) — atualizado a cada leva
├── OPERACOES.md                     ← resumo legível + extrato do capital (tabelas por dia)
├── snapshots/                       ← cópias datadas do master a cada atualização
│   └── edgecontrol_2026-08-11.json
├── dias/                            ← fonte da verdade: um pasta por dia
│   └── 2026-08-11/
│       ├── print-01.jpg             ← prints do dia (na ordem)
│       ├── print-02.jpg
│       └── operacoes.json           ← registro das operações daquele dia
└── gerar_backup.py                  ← script que monta o master a partir de dias/
```

---

## 🔄 Como funciona o fluxo

### Você (todo dia que operar)
1. Faz as operações e tira o print de cada uma.
2. Manda **só os prints daquele dia** aqui na conversa.
   - Se o print tiver o valor e o resultado visíveis, só a imagem basta.
   - Se não der pra ler no print, escreve junto: valor (R$) e WIN/LOSS.

### Eu (a cada leva de prints)
1. Leio os prints, extraio os dados e **registro as operações** em `dias/AAAA-MM-DD/`.
2. Salvo os prints na pasta do dia (renomeados `print-01`, `print-02`, ...).
3. Rodo o gerador → atualizo:
   - `edgecontrol_master.json` (backup completo)
   - `snapshots/edgecontrol_<data>.json` (cópia datada)
   - `OPERACOES.md` (resumo)
4. Te aviso o que foi registrado e o saldo do dia.

> Assim você nunca precisa me mandar o histórico inteiro de novo —
> cada dia que você manda, eu só **acrescento** ao backup.

---

## ⬇️ Como importar o backup no dashboard

1. Abra o dashboard (EdgeControl).
2. Vá em **Configurações** → **🔒 Backup de Dados**.
3. Clique em **"⬇ Importar Dados (JSON)"** e escolha `backups/edgecontrol_master.json`.
4. Confirme — o app substitui os dados atuais pelos do arquivo.

⚠️ **Atenção:** a importação **substitui** os dados atuais do navegador.
Sempre importe o `edgecontrol_master.json` mais recente (ou use o export do app antes).

---

## ⬆️ Se você quiser me passar o backup do app (em vez de prints)

No dashboard: **Configurações** → **🔒 Backup de Dados** → **"⬆ Exportar Dados (JSON)"**.
Manda o arquivo aqui que eu incorporo ele no sistema de dias.

---

## 💰 A conta do capital (de onde saiu até hoje)

O gerador reproduz **exatamente a regra do app** (a mesma usada no `saveOp` e nos
gráficos de capital): as operações são aplicadas **na ordem cronológica** e a cada uma

```
capital depois = capital antes + WIN − LOSS     (nunca fica negativo)
```

### `backups/config.json`

| Campo | O que é |
|---|---|
| `capital_inicial` | De onde você saiu (ex.: `1000.00`). Se `null`, usa o padrão do app (R$ 1.000,00). |
| `capital_atual_esperado` | O valor que você está **hoje** (ex.: `310.29`). O gerador confere se a conta fecha e avisa se não bater. |

O `OPERACOES.md` traz o **extrato completo**: linha por linha, cada operação com
"capital antes → capital depois", do início até o valor de hoje. Se o valor informado
não bater com a conta, o gerador mostra a diferença e sugere qual teria que ser o
capital inicial para fechar certo.

---

## 🧮 Resumo (como o script monta o JSON)

`capital atual = capital inicial + Σ(WIN) − Σ(LOSS)` na ordem cronológica,
com piso em zero — igual ao app. Os campos `initialCapital` e `currentCapital`
do JSON são preenchidos com esse resultado.

---

## 🛠️ Rodar o gerador manualmente

```bash
python3 backups/gerar_backup.py
```
