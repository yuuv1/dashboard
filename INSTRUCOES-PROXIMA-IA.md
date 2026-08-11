# 📋 INSTRUÇÕES PARA A PRÓXIMA IA — Registro de operações do EdgeControl

> **Leia este arquivo antes de qualquer outra coisa quando o usuário anexar prints ou falar de operações.**

---

## 1. Contexto

O usuário opera binárias/opções e registra cada operação no dashboard **EdgeControl**
(`edgecontrol-glass.html`). Ele tira **prints (screenshots)** das operações e anexa aqui
na conversa. A sua função é **ler esses prints, registrar as operações no backup e gerar
o arquivo JSON que ele importa de volta no dashboard**.

⚠️ **Deficit conhecido da plataforma:** os anexos de imagem da conversa **frequentemente
NÃO chegam ao ambiente da IA** (o sistema avisa que salvou, mas o arquivo não existe).
Além disso, a IA pode não ter capacidade de visão. **Nunca finja que viu o print.**
Siga o fluxo abaixo.

---

## 2. Onde procurar o print anexado

Quando o usuário diz que anexou um print, procure **nesta ordem**:

```bash
ls -lat /home/user/uploads/                 # pasta padrão de anexos (pode não existir)
ls -lat /home/user/dashboard/uploads/       # uploads do repositório (página de recepção salva aqui)
ls -lat /home/user/dashboard/               # pasta raiz (o usuário às vezes "coloca na raiz")
sudo find / -xdev -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.webp" -o -iname "*.jfif" \) -newermt "10 minutes ago" 2>/dev/null | grep -vE "\.git|node_modules|\.local|_arquivo|icones-app|/proc|/sys"
```

---

## 3. FLUXO OBRIGATÓRIO — toda vez que o usuário anexar prints

### PASSO 1 — Verificar se o arquivo chegou
- Se o print **existe** no ambiente → vá ao **PASSO 2**.
- Se o print **NÃO existe** (procurei e não achei):
  1. Avise claramente: *"O print não chegou no meu ambiente — o anexo do chat falhou"*.
  2. Suba a página de recepção de prints (se não estiver rodando):
     ```bash
     python3 backups/receber_prints.py 8790
     ```
     (ela aparece como **preview ao vivo** pro usuário; os uploads caem em `uploads/`)
  3. Peça ao usuário para arrastar o print na página de recepção **ou** mandar as
     operações em **texto** (formato: `hora | tipo | resultado | valor` por linha).
  4. **Não gere o backup vazio** — se o usuário importar um JSON sem operações,
     o dashboard **apaga os dados que ele já tem**.

### PASSO 2 — Ler o print (OCR)
Instale o OCR se não estiver disponível (o ambiente é resetado a cada sessão):

```bash
pip install --break-system-packages rapidocr-onnxruntime opencv-python-headless pillow
```

Leitura (Python):
```python
from rapidocr_onnxruntime import RapidOCR
engine = RapidOCR()
result, _ = engine("caminho/do/print.png")
for box, text, conf in result:
    print(text, round(conf, 2))
```

- Extraia de cada print: **hora, valor (R$), WIN/LOSS, tipo (CALL/PUT)** e, se visível,
  motivo da entrada.
- Se o print não tiver valor/resultado legível, **peça ao usuário** antes de registrar.
- **Se você não conseguir ler a imagem, diga isso honestamente** e peça os dados em texto.

### PASSO 3 — Registrar as operações do dia
Crie/atualize a pasta do dia e o registro:

```
backups/dias/AAAA-MM-DD/
├── print-01.jpg            ← os prints do dia, renomeados em ordem
├── print-02.jpg
└── operacoes.json          ← lista de operações (schema abaixo)
```

**Schema exato de cada operação (o app exige esses campos):**
```json
{
  "date": "2026-08-11",
  "time": "09:15",
  "value": 40.0,
  "result": "WIN",
  "type": "CALL",
  "reason": "Rompimento de resistência no M5 + confluência EMA21",
  "plan": "yes",
  "_prints": ["print-01.jpg"]
}
```
- `value` = valor em R$ (positivo; o sinal é definido por `result`).
- `result`: `WIN` ou `LOSS` · `type`: `CALL` ou `PUT` · `plan`: `yes` ou `no`.
- `_prints` = nome dos prints da pasta do dia vinculados à operação (opcional).
- Os campos `id`, `usd`, `img`, `yt`, `notes`, `shots`, `createdAt` são **preenchidos
  automaticamente pelo gerador**.

### PASSO 4 — Rodar o gerador (gera o arquivo pra importar)
```bash
cd /home/user/dashboard && python3 backups/gerar_backup.py
```

Isso gera/atualiza:
| Arquivo | Onde | O que é |
|---|---|---|
| **`edgecontrol_master.json`** | **pasta raiz** do repositório | **O arquivo que o usuário importa** |
| `backups/edgecontrol_master.json` | backups/ | cópia |
| `backups/snapshots/edgecontrol_<data>.json` | backups/snapshots/ | cópia datada |
| `backups/OPERACOES.md` | backups/ | resumo + extrato do capital |

### PASSO 5 — Conferir a conta do capital
- O valor de hoje informado pelo usuário é **R$ 310,29** → está em `backups/config.json`
  (`"capital_atual_esperado": 310.29`).
- O gerador calcula o capital na **mesma regra do app**: operações na ordem cronológica,
  `capital = capital + WIN − LOSS`, piso em zero. Se a conta **não fechar** em 310,29,
  o gerador avisa e sugere o capital inicial que fecharia a conta.
- Se o usuário souber o capital inicial, coloque em `backups/config.json`
  (`"capital_inicial": <valor>`). Se não souber, o gerador infere a partir da conta.

### PASSO 6 — Avisar o usuário
- Confirme o que foi registrado (quantas operações, saldo do dia).
- Diga que o arquivo **`edgecontrol_master.json` está na pasta raiz** e como importar:
  **dashboard → Configurações → 🔒 Backup de Dados → "⬇ Importar Dados (JSON)"**.
- ⚠️ A importação **substitui** os dados atuais do app — o master é sempre o histórico completo.

---

## 4. Comandos úteis de referência

```bash
# Subir a página de recepção de prints (uploads caem em uploads/ do repositório)
python3 backups/receber_prints.py 8790

# Gerar o backup (master na raiz + cópias + resumo)
python3 backups/gerar_backup.py

# Validar o JSON gerado rapidamente
python3 -c "import json;p=json.load(open('edgecontrol_master.json'));print(len(p['state']['operations']),'ops |',len(p['shots']),'prints | capital',p['state']['settings']['currentCapital'])"
```

## 5. Não faça
- ❌ **Nunca** diga que viu/leu um print que não chegou ou que você não conseguiu ler.
- ❌ **Nunca** gere `edgecontrol_master.json` vazio (sem operações) — isso apagaria os
  dados do usuário na importação.
- ❌ Não invente valores, horários ou resultados — se faltar dado, pergunte.
- ❌ Não edite os prints originais do usuário.

---
*Última atualização: 2026-08-11 · Valor de hoje a conferir: R$ 310,29*
