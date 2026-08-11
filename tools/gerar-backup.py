#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gerador de backup do EdgeControl a partir de um histórico de corretora.

Saída: JSON no formato "pack v2" aceito por importData() em edgecontrol-glass.html
       -> { __ec:2, exportedAt, state:{...}, shots:{} }

Como o app não tem campo de "ativo/par", o par e o payout são preservados
dentro de `reason` (visível na tabela) e de `notes` (detalhe completo).

REGRA DE OURO do campo `value`:
  o app faz  currentCapital += value  (WIN)  /  -= value  (LOSS).
  Portanto value = RESULTADO LÍQUIDO, não a stake.
    WIN  -> lucro recebido            (ex.: +R$18,37)
    LOSS -> stake perdida             (ex.: -R$21,35 -> value 21,35)
    EMPATE/refund -> LOSS com value 0 (capital não muda)

Uso:  python3 tools/gerar-backup.py
"""
import json
from datetime import datetime

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
ANO = 2026
USD_RATE = 5.00          # cotação usada para o campo `usd` (derivado)
CAPITAL_INICIAL = 1000.00
SAIDA = "edgecontrol_2026-08-11.json"

MES = {"jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
       "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12}

# ─────────────────────────────────────────────────────────────
# DADOS LIDOS DO PRINT DO HISTÓRICO (ordem cronológica crescente)
# (dia, mês, hora, par, direção, stake, resultado_líquido, payout_%)
#   direção: CALL (▲) | PUT (▼)
#   resultado_líquido: positivo = WIN | negativo = LOSS | 0 = empate/refund
# ─────────────────────────────────────────────────────────────
BRUTO = [
    (24, "jul", "10:00", "GBP/JPY", "CALL", 24.00,  20.88,  87.00),
    (24, "jul", "12:14", "EUR/JPY", "PUT",  10.00,   8.50,  85.00),
    (27, "jul", "10:26", "EUR/GBP", "CALL", 26.56,   0.00,   0.00),   # empate / reembolso
    (27, "jul", "10:42", "EUR/GBP", "CALL", 26.56, -26.56, -100.00),
    (28, "jul", "08:10", "EUR/USD", "CALL", 24.40, -24.40, -100.00),
    (29, "jul", "09:58", "EUR/JPY", "PUT",  22.00,  19.14,  87.00),
    (29, "jul", "10:21", "EUR/GBP", "CALL", 19.14, -19.14, -100.00),  # direção ilegível no print
    (31, "jul", "08:35", "USD/JPY", "PUT",  22.00, -22.00, -100.00),
    (3,  "ago", "09:38", "GBP/USD", "CALL", 22.00,  19.36,  88.00),
    (3,  "ago", "09:48", "EUR/USD", "CALL", 19.36, -19.36, -100.00),
    (4,  "ago", "09:21", "EUR/USD", "CALL", 20.00,  17.60,  88.00),
    (5,  "ago", "08:24", "GBP/JPY", "CALL", 21.00,  18.06,  86.00),
    (5,  "ago", "09:35", "EUR/JPY", "PUT",  18.06,  15.53,  85.99),
    (6,  "ago", "08:11", "EUR/USD", "CALL", 24.82,  21.35,  86.02),
    (6,  "ago", "09:03", "USD/JPY", "CALL", 21.35, -21.35, -100.00),
    (11, "ago", "08:48", "EUR/USD", "CALL", 24.00,  21.12,  88.00),
    (11, "ago", "08:55", "EUR/JPY", "PUT",  21.12,  18.37,  86.98),
]

# operações cuja direção não estava legível no print
REVISAR = {("29/07", "10:21")}


def brl(v):
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def build():
    ops = []
    capital = CAPITAL_INICIAL

    for dia, mes, hora, par, direcao, stake, liq, payout in BRUTO:
        date = f"{ANO}-{MES[mes]:02d}-{dia:02d}"
        hh, mm = hora.split(":")
        oid = str(int(datetime(ANO, MES[mes], dia, int(hh), int(mm)).timestamp() * 1000))

        empate = abs(liq) < 0.005
        result = "WIN" if liq > 0 else "LOSS"          # empate entra como LOSS de valor 0
        value = round(abs(liq), 2)                      # <- resultado líquido

        capital += value if result == "WIN" else -value

        tag = f"{par} · {direcao}"
        if empate:
            motivo = f"{tag} — empate (reembolso da stake)"
        elif result == "WIN":
            motivo = f"{tag} — payout {payout:.2f}%"
        else:
            motivo = f"{tag} — perda total da stake"

        notas = [
            f"Importado do histórico da corretora (opção binária).",
            f"Par: {par} | Direção: {direcao} | Entrada: {brl(stake)}",
        ]
        if empate:
            notas.append("Resultado: EMPATE (R$ 0,00 / 0%). Lançado como LOSS de valor zero "
                         "para não alterar o capital — o app só tem WIN/LOSS.")
        else:
            notas.append(f"Resultado: {'+' if liq > 0 else '-'}{brl(abs(liq))} ({payout:+.2f}%)")
        if (f"{dia:02d}/{MES[mes]:02d}", hora) in REVISAR:
            notas.append("⚠️ Direção não estava legível no print — confirmar CALL/PUT.")

        ops.append({
            "id": oid,
            "date": date,
            "time": hora,
            "value": value,
            "usd": round(value / USD_RATE, 2),
            "result": result,
            "type": direcao,
            "reason": motivo,
            "plan": "yes",          # não há esse dado no print; assumido "seguiu o plano"
            "img": "",
            "yt": "",
            "notes": "\n".join(notas),
            "shots": [],
            "createdAt": datetime(ANO, MES[mes], dia, int(hh), int(mm)).isoformat() + "Z",
        })

    state = {
        "profile": {"name": "Trader", "avatar": "", "avatarData": "", "logo": ""},
        "settings": {
            "initialCapital": CAPITAL_INICIAL,
            "currentCapital": round(capital, 2),
            "usdRate": USD_RATE,
            "stopLoss": 5,
            "target": 2.5,
        },
        "metal": {"on": True, "preset": "platinum", "speed": 4.5,
                  "colors": ["#e8e8e8", "#b8b8b8", "#ffffff", "#9a9a9a", "#d4d4d4"]},
        "theme": "default",
        "bg": {"on": True, "opacity": 26},
        "operations": ops,
        "cp": "all",
    }

    pack = {"__ec": 2, "exportedAt": datetime.now().isoformat() + "Z",
            "state": state, "shots": {}}

    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, indent=2)

    # resumo
    w = [o for o in ops if o["result"] == "WIN"]
    l = [o for o in ops if o["result"] == "LOSS" and o["value"] > 0]
    g, p = sum(o["value"] for o in w), sum(o["value"] for o in l)
    print(f"✓ {SAIDA}")
    print(f"  {len(ops)} operações | {len(w)}W / {len(l)}L (+1 empate)")
    print(f"  Ganhos {brl(g)} | Perdas {brl(p)} | Líquido {brl(g - p)}")
    print(f"  Capital {brl(CAPITAL_INICIAL)} -> {brl(capital)}")
    print(f"  Assertividade {len(w) / (len(w) + len(l)) * 100:.1f}%  "
          f"| Profit factor {g / p:.2f}")


if __name__ == "__main__":
    build()
