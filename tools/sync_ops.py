#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EdgeControl — sincronizador de operações (arquivo-mestre)
==========================================================

Fluxo: o usuário manda prints da corretora → as operações são extraídas
para um JSON simples → este script mescla no arquivo-mestre
``edgecontrol_dados.json`` (na raiz do repositório), que é o arquivo
importado no app pelo botão ⬇ (Importar JSON).

Uso:
    python3 tools/sync_ops.py operacoes/lote_001_2026-08-05.json
    python3 tools/sync_ops.py lote.json --capital-inicial 302.68 --dolar 5.42

Cada print vira um arquivo novo em ``operacoes/lote_NNN_AAAA-MM-DD.json``
contendo SOMENTE as operações daquele print — e o mestre acumula tudo.

Opções:
  --capital-inicial X   corrige o capital inicial (ex.: após ajuste,
                        saque ou depósito). O capital atual é sempre
                        recalculado: inicial + Σ wins − Σ losses.
  --dolar X             corrige a cotação usada na conversão p/ USD
                        (recalcula o campo "usd" de todas as ops).

O que ele garante:
  • anti-duplicata  — mesma data+hora+par+resultado nunca entra 2x
  • ordem cronológica das operações
  • capital atual recalculado: capital_inicial + Σ wins − Σ losses
  • formato 100% compatível com o importData() do edgecontrol-glass.html

Formato do JSON de entrada (uma lista de operações vistas no print):
[
  {
    "date": "2026-08-05",     # AAAA-MM-DD
    "time": "09:35",          # HH:MM
    "pair": "EUR/JPY",        # par de moedas
    "direction": "PUT",       # CALL ou PUT (seta ▲ verde / ▼ vermelha)
    "entry": 18.06,           # valor da entrada (R$) — vai p/ campo Notas
    "result": 15.53,          # lucro (WIN) | valor perdido (LOSS) | 0 (EMPATE)
    "pct": 85.99,             # payout % (informativo; -100 em caso de LOSS)
    "status": "WIN"           # WIN | LOSS | EMPATE
  }
]

Observações:
  • EMPATE: o app só aceita WIN/LOSS → gravado como WIN de R$ 0,00 com
    nota explicando que a entrada foi devolvida.
  • O app não possui campo "par"; ele vai no campo "Motivo da Entrada".
"""

import argparse
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "edgecontrol_dados.json"

DEFAULT_SETTINGS = {
    "initialCapital": 1000.0,
    "currentCapital": 1000.0,
    "usdRate": 5.0,
    "stopLoss": 5.0,
    "target": 2.5,
}


def brl(v: float) -> str:
    """1234.5 -> '1.234,50'"""
    return f"{v:,.2f}".replace(",", ";").replace(".", ",").replace(";", ".")


def pair_code(pair: str) -> str:
    return pair.replace("/", "").replace(" ", "").upper()


def op_key(app_op: dict, pair: str = None) -> tuple:
    """Chave anti-duplicata sobre o formato interno do app."""
    p = pair or app_op.get("reason", "").split(" — ")[0]
    return (
        app_op["date"],
        app_op["time"],
        pair_code(p),
        app_op["result"],
        round(float(app_op["value"]), 2),
    )


def print_op_to_app(o: dict, usd_rate: float) -> dict:
    """Converte o registro vindo do print para o formato interno do app."""
    status = o["status"].upper()
    entry = round(float(o.get("entry", 0)), 2)
    pct = o.get("pct", 0)

    if status == "WIN":
        value = round(float(o["result"]), 2)
        notes = f"Entrada R$ {brl(entry)} · payout {pct}%"
        result = "WIN"
    elif status == "LOSS":
        value = round(float(o["result"]), 2)
        notes = f"Entrada R$ {brl(entry)} perdida (-100%)"
        result = "LOSS"
    else:  # EMPATE — entrada devolvida
        value = 0.0
        notes = f"EMPATE (0%) — entrada R$ {brl(entry)} devolvida"
        result = "WIN"

    hhmm = o["time"].replace(":", "")
    ymd = o["date"].replace("-", "")
    dt = datetime.fromisoformat(f"{o['date']}T{o['time']}:00")
    created = dt.replace(tzinfo=timezone(timedelta(hours=-3))).isoformat()

    op = {
        "id": f"op_{ymd}_{hhmm}_{pair_code(o['pair'])}",
        "date": o["date"],
        "time": o["time"],
        "value": value,
        "usd": round(value / (usd_rate or 1), 2),
        "result": result,
        "type": o["direction"].upper(),
        "reason": f"{o['pair']} — Binária",
        "plan": "yes",
        "img": "",
        "yt": "",
        "notes": notes,
        "shots": [],
        "createdAt": created,
    }
    if status == "EMPATE":
        op["empate"] = True
    return op


def main() -> int:
    ap = argparse.ArgumentParser(description="Sincroniza ops de prints no mestre.")
    ap.add_argument("lote", help="JSON com as operações do print")
    ap.add_argument("--capital-inicial", type=float, default=None)
    ap.add_argument("--dolar", type=float, default=None)
    args = ap.parse_args()

    new_ops = json.loads(Path(args.lote).read_text(encoding="utf-8"))
    if not isinstance(new_ops, list):
        print("ERRO: o arquivo de entrada deve ser uma lista JSON.")
        return 1

    # ── carrega o mestre (ou cria vazio) ─────────────────────────────
    if MASTER.exists():
        pack = json.loads(MASTER.read_text(encoding="utf-8"))
        state = pack["state"]
    else:
        state = {"settings": dict(DEFAULT_SETTINGS), "operations": []}

    # ── ajustes manuais de configuração ─────────────────────────────
    if args.capital_inicial is not None:
        state["settings"]["initialCapital"] = round(args.capital_inicial, 2)
    if args.dolar is not None and args.dolar > 0:
        state["settings"]["usdRate"] = round(args.dolar, 4)
        for o in state["operations"]:
            o["usd"] = round(o["value"] / args.dolar, 2)

    usd_rate = state["settings"].get("usdRate") or 5.0
    existing = {op_key(o) for o in state["operations"]}

    # ── mescla com anti-duplicata ────────────────────────────────────
    added, skipped = 0, 0
    for raw in new_ops:
        app_op = print_op_to_app(raw, usd_rate)
        k = op_key(app_op, pair=raw["pair"])
        if k in existing:
            skipped += 1
            continue
        state["operations"].append(app_op)
        existing.add(k)
        added += 1

    # ── ordena cronologicamente e recalcula o capital ────────────────
    state["operations"].sort(key=lambda o: (o["date"], o["time"]))
    initial = float(state["settings"].get("initialCapital") or 0)
    net = sum(o["value"] if o["result"] == "WIN" else -o["value"]
              for o in state["operations"])
    state["settings"]["currentCapital"] = round(initial + net, 2)

    pack = {
        "__ec": 2,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "state": state,
        "shots": {},
    }
    MASTER.write_text(json.dumps(pack, ensure_ascii=False, indent=2),
                      encoding="utf-8")

    # ── resumo ───────────────────────────────────────────────────────
    wins = sum(1 for o in state["operations"] if o["result"] == "WIN")
    losses = len(state["operations"]) - wins
    print(f"✅ {added} operação(ões) adicionada(s) · {skipped} duplicada(s) ignorada(s)")
    print(f"📊 Mestre agora: {len(state['operations'])} ops ({wins} WIN / {losses} LOSS)")
    print(f"💰 Inicial: R$ {brl(initial)}  ·  Líquido das ops: R$ {brl(round(net, 2))}  ·  "
          f"Capital atual: R$ {brl(state['settings']['currentCapital'])}")
    print(f"📂 Arquivo atualizado: {MASTER}")
    print("⬇  No app, importe este arquivo pelo botão ⬇ (Importar JSON).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
