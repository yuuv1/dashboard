# Instruções para o agente — EdgeControl

Contexto e regras permanentes deste repositório. Leia antes de qualquer tarefa.

## O projeto

`edgecontrol-glass.html` é o app inteiro num único arquivo (~928 KB): HTML + CSS + JS,
sem build, sem dependências, sem servidor. Abre direto no navegador / roda como PWA
(`sw.js` + `icones-app/`). Estado em `localStorage['ec7']`, prints em IndexedDB.

Não fragmente esse arquivo em módulos, não adicione bundler, não introduza framework.
Edições são cirúrgicas, dentro do arquivo.

---

## Tarefa recorrente: "criei um print do histórico, gera o backup"

Quando o usuário mandar **uma imagem do histórico de operações da corretora** (opções
binárias — IQ Option / Exnova / similar) e pedir backup, arquivo pro dashboard, importar
as operações, etc. — **execute o fluxo abaixo inteiro, sem perguntar nada.** Já foi
decidido; não repita as perguntas.

### O que fazer

1. **Ler a imagem** e transcrever cada linha: hora, par, direção (▲ = CALL, ▼ = PUT),
   valor da entrada, resultado líquido e o payout entre parênteses. A data fica no
   canto esquerdo (formato `11 Ago`) e vale para a linha em que aparece.
2. **Editar `tools/gerar-backup.py`**: substituir a lista `BRUTO` pelos dados novos,
   em **ordem cronológica crescente** (o print vem do mais recente pro mais antigo —
   inverta). Ajustar `ANO`, `SAIDA` e, se o usuário informar, `CAPITAL_INICIAL`/`USD_RATE`.
3. **Rodar** `python3 tools/gerar-backup.py`.
4. **Validar** o JSON gerado (schema, ids únicos, ordem, `result`/`type`/`plan` válidos).
5. **Salvar na raiz** do repositório como `edgecontrol_AAAA-MM-DD.json`
   (data da operação mais recente do print).
6. **Commitar e abrir PR** na branch da sessão.
7. **Responder** com o resumo: nº de ops, W/L, assertividade, líquido, capital final,
   destaques por par, e a frase de como importar (Configurações → Backup → Importar).

### Decisões já tomadas — não perguntar de novo

| Assunto | Decisão |
|---|---|
| Formato | pack **v2**: `{__ec:2, exportedAt, state:{...}, shots:{}}` |
| Campo `value` | **resultado líquido**, nunca a stake — o app faz `capital ± value` |
| WIN | `value` = lucro recebido (ex.: `18.37`) |
| LOSS | `value` = stake perdida (ex.: `21.35`) |
| Empate / reembolso (`R$0 (0%)`) | `result:"LOSS"` com `value: 0` — não move o capital |
| Par de moedas | não existe campo próprio → vai em `reason` (`"EUR/JPY · PUT — payout 87%"`) e detalhado em `notes` |
| `plan` | `"yes"` (o print não traz esse dado) |
| `usd` | `value / usdRate` |
| `id` | timestamp em ms da data+hora da operação (determinístico, evita colisão) |
| `currentCapital` | `initialCapital` + soma dos líquidos, calculado pelo script |
| Ordem em `operations` | cronológica **crescente** — o app usa `.reverse()` pra exibir e lê o último item pra calcular a streak |
| Prints/imagens | `shots: []`, `img: ""` — a imagem do histórico não é anexada |
| Linha ilegível | importar mesmo assim e marcar em `notes` com `⚠️` + avisar o usuário na resposta |

### Regras de ouro (erros que já quase aconteceram)

- **`value` é líquido, não stake.** Usar a stake infla ganhos e perdas e destrói o
  capital final e o profit factor.
- **LOSS guarda valor positivo.** O sinal vem do campo `result`; `value` é sempre `>= 0`.
- **Não inverter a ordem.** O print é decrescente, o arquivo é crescente.
- **Ano:** o print só mostra `11 Ago`. Use o ano corrente, salvo indicação contrária.

### Como o usuário importa

Dashboard → **Configurações** → seção de backup → **Importar** → escolher o `.json` da
raiz → confirmar. Substitui os dados atuais (o app avisa antes).

---

## Ao mexer no app

- Preserve o padrão de nomes curtos já usado (`S`, `CH`, `fmtBRL`, `btn-o`, `btn-s`, `fi`).
- Toda string de interface em **português do Brasil**; dinheiro via `fmtBRL()`.
- Cores por variável CSS (`var(--accent)`, `var(--green)`, `var(--red)`) — os temas
  dependem disso; não fixe hex em componente novo.
- Mudou o schema de `S`? Trate a migração dentro de `load()`, como já é feito com
  `rainbow → metal`.
- Não commite `uploads/`, `_arquivo/` nem os `.zip` — são material de apoio.

## Git

Trabalhe sempre na branch da sessão (`arena/...`), commite nela e abra o PR a partir
dela. Nunca troque de branch.
