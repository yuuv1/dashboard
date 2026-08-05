# 📋 Como adicionar operações no EdgeControl (sistema do arquivo-mestre)

## A ideia

Existe **um único arquivo oficial** com todas as suas operações, mais uma
pasta de **lotes** que guarda o histórico de cada print enviado:

```
edgecontrol_dados.json          ← arquivo-mestre ACUMULATIVO (importa no app)
operacoes/
  ├─ lote_001_2026-08-05.json   ← 1º print processado (13 ops)
  ├─ lote_002_....json          ← próximo print (só as ops novas dele)
  └─ ...
```

Você nunca digita nada: **manda um print da corretora → eu crio um lote novo
na pasta (só com as ops daquele print) → o mestre acumula tudo → você importa
a versão nova do mestre no app.** Simples assim.

---

## 🔁 Fluxo no dia a dia

**1. Operou?** Tire print do histórico da corretora (pode ser um ou vários).

**2. Mande o print aqui no chat.** Pode repetir operação sem medo — o
sistema ignora duplicadas automaticamente (mesma data + hora + par + valor).

**3. Baixe o `edgecontrol_dados.json` atualizado** (eu sempre apresento o
arquivo no fim de cada atualização).

**4. No app EdgeControl:**
- Toque no botão **⬇** (topo da tela) ou em **⚙️ Configurações → "⬇ Importar Dados (JSON)"**
- Selecione o arquivo baixado e confirme
- Pronto ✅ — operações, capital e estatísticas atualizados

> 💡 Dica: faça um **⬆ Exportar** de vez em quando como backup extra.

---

## ⚠️ Regras de ouro

1. **O arquivo-mestre é a fonte oficial.** A importação **substitui** os dados
   do app. Se você registrar alguma operação **manualmente** pelo formulário
   do app, me avise antes de importar (ou exporte ⬆ e me mande o arquivo)
   para eu incorporar no mestre — senão ela se perde.

2. **Pode mandar print antigo/repetido.** Duplicatas são detectadas por
   data+hora+par+valor e simplesmente ignoradas.

3. **Empates:** o app só aceita WIN/LOSS, então empates entram como
   **WIN de R$ 0,00** com a nota "EMPATE (0%) — entrada devolvida".
   Não mexem no capital.

4. **O app guarda lucro/perda, não a entrada.** O valor da entrada e o
   payout% ficam registrados no campo **Notas** de cada operação.

5. **Par de moedas** vai no campo "Motivo da Entrada" (ex: `EUR/JPY — Binária`),
   pois o print não mostra o motivo técnico. Se quiser, edite depois no app
   (✏️) e complemente com sua análise.

---

## ⚙️ Capital e cotação

- **Capital inicial: R$ 302,68** — deduzido em 05/ago/2026 a partir do capital
  real informado (R$ 310,29) menos o líquido das operações (+R$ 7,61)
- **Capital atual: R$ 310,29** — recalculado a cada sincronização:
  `capital_inicial + Σ wins − Σ losses`
- Dólar: **R$ 5,00** (só p/ conversão de exibição em USD)
- Fez saque/depósito ou quer corrigir valores? É só me falar — ou ajuste
  direto em **⚙️ Configurações** no app.

---

## 🛠️ Bastidores (para referência)

- `tools/sync_ops.py` — script que mescla um lote no mestre:
  ```
  python3 tools/sync_ops.py operacoes/lote_002_2026-08-12.json
  python3 tools/sync_ops.py lote.json --capital-inicial 302.68 --dolar 5.42
  ```
- `operacoes/lote_NNN_AAAA-MM-DD.json` — um arquivo por print enviado,
  contendo somente as operações daquele print (histórico preservado)
- Formato do mestre: backup v2 do próprio app (`{__ec:2, state, shots}`),
  100% compatível com a tela de importação.
