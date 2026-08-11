#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gerador do backup mestre do EdgeControl.

Lê a pasta backups/dias/ (fonte da verdade) e gera:
  - backups/edgecontrol_master.json   (backup completo, importável no app — formato v2)
  - backups/snapshots/edgecontrol_<data>.json  (cópia datada)
  - backups/OPERACOES.md              (resumo legível + extrato do capital)

Configuração opcional em backups/config.json:
  {
    "capital_inicial": 1000.0,        // null/ausente = usa o padrão (R$ 1.000,00)
    "capital_atual_esperado": 310.29  // valor de hoje — o gerador confere se a conta fecha
  }

Uso:
  python3 backups/gerar_backup.py
"""

import base64
import json
import mimetypes
import os
import re
import sys
import time
from datetime import datetime, date

BASE = os.path.dirname(os.path.abspath(__file__))
DIAS = os.path.join(BASE, "dias")
SNAPS = os.path.join(BASE, "snapshots")
MASTER = os.path.join(BASE, "edgecontrol_master.json")
RESUMO = os.path.join(BASE, "OPERACOES.md")
CONFIG = os.path.join(BASE, "config.json")

# ── Configuração padrão (igual aos defaults do app) ──────────────────────────
CAPITAL_INICIAL = 1000.0
USD_RATE = 5.0
STOP_LOSS = 5.0
TARGET = 2.5
PROFILE = {"name": "Trader", "avatar": "", "avatarData": "", "logo": ""}
METAL = {
    "on": True,
    "preset": "platinum",
    "speed": 4.5,
    "colors": ["#8e9bb5", "#ffffff", "#c3ccdd", "#6f7d99", "#eef2f8", "#9aa7bf", "#ffffff"],
}
THEME = "default"
BG = {"on": True, "opacity": 26}

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".jfif", ".bmp", ".avif"}
MAX_IMG_BYTES = 3 * 1024 * 1024  # igual ao limite do export do app

DIAS_SEMANA = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


def log(msg):
    print(msg, flush=True)


def data_url(path):
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as f:
        b = f.read()
    return "data:%s;base64,%s" % (mime, base64.b64encode(b).decode("ascii")), b


def fmt_brl(v):
    s = f"{v:,.2f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def novo_id(usados):
    """Gera id no mesmo formato do app (Date.now) garantindo unicidade."""
    base_t = int(time.time() * 1000)
    cand = str(base_t)
    seq = 0
    while cand in usados:
        seq += 1
        cand = str(base_t + seq)
    usados.add(cand)
    return cand


def data_iso(d, t):
    """data+time locais -> ISO 8601 (America/Sao_Paulo = UTC-3)."""
    dt = datetime.strptime(f"{d} {t}", "%Y-%m-%d %H:%M")
    return dt.strftime("%Y-%m-%dT%H:%M:00-03:00")


def carregar_config():
    cfg = {"capital_inicial": None, "capital_atual_esperado": None}
    if os.path.exists(CONFIG):
        try:
            with open(CONFIG, encoding="utf-8") as f:
                dados = json.load(f)
            for k in cfg:
                if k in dados and dados[k] is not None:
                    cfg[k] = float(dados[k])
        except Exception as e:
            log(f"  ⚠️ config.json inválido ({e}) — usando padrões")
    return cfg


def ler_dias():
    """Varre dias/*/ e devolve (operacoes, shots)."""
    operacoes = []
    shots = {}
    usados = set()
    if os.path.isdir(DIAS):
        for nome in sorted(os.listdir(DIAS)):
            pasta = os.path.join(DIAS, nome)
            if not os.path.isdir(pasta) or not re.match(r"^\d{4}-\d{2}-\d{2}$", nome):
                continue
            ops_dia = []
            arq_ops = os.path.join(pasta, "operacoes.json")
            if os.path.exists(arq_ops):
                try:
                    with open(arq_ops, encoding="utf-8") as f:
                        ops_dia = json.load(f)
                    if not isinstance(ops_dia, list):
                        ops_dia = []
                except Exception as e:
                    log(f"  ⚠️ operacoes.json de {nome} inválido ({e}) — ignorado")
                    ops_dia = []

            # arquivos de imagem da pasta (ordem alfabética = ordem dos prints)
            imgs = sorted(
                f for f in os.listdir(pasta)
                if os.path.splitext(f)[1].lower() in IMG_EXTS
            )

            for op in ops_dia:
                if not isinstance(op, dict) or not op.get("date"):
                    continue
                if not op.get("id"):
                    op["id"] = novo_id(usados)
                else:
                    usados.add(op["id"])
                op.setdefault("time", "00:00")
                op.setdefault("value", 0.0)
                op.setdefault("usd", round(float(op["value"]) / USD_RATE, 2))
                op.setdefault("result", "WIN")
                op.setdefault("type", "CALL")
                op.setdefault("reason", "")
                op.setdefault("plan", "yes")
                op.setdefault("img", "")
                op.setdefault("yt", "")
                op.setdefault("notes", "")
                op.setdefault("shots", [])
                op.setdefault("createdAt", data_iso(op["date"], op["time"]))

                # vincula prints citados em _prints
                refs = op.get("_prints") or []
                for ref in refs:
                    if ref not in imgs:
                        log(f"  ⚠️ {nome}: print '{ref}' não encontrado na pasta")
                        continue
                    sid = f"shot_{nome.replace('-', '')}_{len(op['shots']) + 1:03d}"
                    if sid not in shots:
                        caminho = os.path.join(pasta, ref)
                        if os.path.getsize(caminho) > MAX_IMG_BYTES:
                            log(f"  ⚠️ {nome}: {ref} > 3MB, pulado (limite do app)")
                            continue
                        d, _ = data_url(caminho)
                        shots[sid] = {
                            "d": d,
                            "note": "",
                            "name": ref,
                            "at": data_iso(op["date"], op["time"]),
                        }
                    if sid not in op["shots"]:
                        op["shots"].append(sid)
                op.pop("_prints", None)
                operacoes.append(op)

    return operacoes, shots


def calcular_extrato(ops, capital_inicial):
    """Aplica a MESMA regra do app (saveOp / gráficos):
    a cada operação na ordem cronológica: WIN soma, LOSS subtrai,
    nunca deixando o capital ficar negativo (Math.max(0, ...)).

    Retorna (capital_final, passos) onde cada passo tem antes/depois.
    """
    cap = float(capital_inicial)
    passos = []
    ordenadas = sorted(ops, key=lambda o: (o["date"], o["time"], o["id"]))
    for i, op in enumerate(ordenadas, 1):
        antes = round(cap, 2)
        v = float(op.get("value") or 0)
        if op.get("result") == "WIN":
            cap += v
        else:
            cap -= v
        cap = max(0.0, cap)
        passos.append({**op, "n": i, "antes": antes, "depois": round(cap, 2)})
    return round(cap, 2), passos


def montar_state(ops, shots, capital_inicial, capital_final):
    state = {
        "profile": dict(PROFILE),
        "settings": {
            "initialCapital": capital_inicial,
            "currentCapital": capital_final,
            "usdRate": USD_RATE,
            "stopLoss": STOP_LOSS,
            "target": TARGET,
        },
        "metal": dict(METAL),
        "theme": THEME,
        "bg": dict(BG),
        "operations": sorted(ops, key=lambda o: (o["date"], o["time"], o["id"])),
        "cp": "all",
    }
    return {"__ec": 2, "exportedAt": datetime.now().isoformat(), "state": state, "shots": shots}


def escrever_json(caminho, pack):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, indent=2)


def resumo_md(ops, shots, passos, capital_inicial, capital_final, esperado):
    linhas = []
    linhas.append("# Operações — EdgeControl\n")
    linhas.append(f"Última atualização: **{date.today().isoformat()}**  \n")
    linhas.append(f"Fonte: `backups/dias/` · Backup completo: `edgecontrol_master.json`\n")

    total = len(ops)
    wins = [o for o in ops if o.get("result") == "WIN"]
    losses = [o for o in ops if o.get("result") == "LOSS"]
    soma = sum(float(o.get("value") or 0) for o in wins) - sum(float(o.get("value") or 0) for o in losses)
    taxa = (len(wins) / total * 100) if total else 0

    linhas.append("## 📊 Resumo geral\n")
    linhas.append("| Operações | ✅ Wins | ❌ Losses | Saldo (R$) | Win rate |")
    linhas.append("|---|---:|---:|---:|---:|---:|")
    linhas.append(f"| {total} | {len(wins)} | {len(losses)} | {fmt_brl(soma)} | {taxa:.0f}% |\n")

    # ── Extrato do capital: de onde saiu até hoje ──
    linhas.append("## 💰 Extrato do capital (de onde saiu até hoje)\n")
    linhas.append(f"**Capital inicial:** R$ {fmt_brl(capital_inicial)}\n")
    if passos:
        linhas.append("| # | Data | Hora | Tipo | Resultado | Valor (R$) | Capital antes | Capital depois |")
        linhas.append("|---|---|---|---|---|---|---|---|")
        for p in passos:
            r = "✅ WIN" if p.get("result") == "WIN" else "❌ LOSS"
            t = "📈 CALL" if p.get("type") == "CALL" else "📉 PUT"
            sinal = "+" if p.get("result") == "WIN" else "−"
            linhas.append(
                f"| {p['n']} | {p['date']} | {p.get('time','')} | {t} | {r} "
                f"| {sinal}{fmt_brl(float(p.get('value') or 0))} "
                f"| {fmt_brl(p['antes'])} | {fmt_brl(p['depois'])} |"
            )
        linhas.append("")
        linhas.append(f"**Capital final calculado:** R$ {fmt_brl(capital_final)}")
        if esperado is not None:
            if abs(capital_final - esperado) < 0.005:
                linhas.append(f"**Conferência com o valor de hoje ({fmt_brl(esperado)}): ✅ bate!**")
            else:
                dif = esperado - capital_final
                linhas.append(
                    f"**Conferência com o valor de hoje ({fmt_brl(esperado)}): ❌ NÃO bate** "
                    f"— diferença de {fmt_brl(dif)}.\n"
                )
                # capital inicial que faria a conta fechar (válido se nenhum passo zerou o capital)
                if all(p["antes"] > 0 and p["depois"] > 0 for p in passos):
                    inferido = esperado - soma
                    linhas.append(
                        f"> 💡 Para fechar em {fmt_brl(esperado)}, o capital inicial teria que ser "
                        f"**R$ {fmt_brl(inferido)}** (confira se esse era o valor de partida).\n"
                    )
    else:
        linhas.append("_Nenhuma operação registrada ainda — a conta fecha assim que as operações entrarem._\n")

    # ── Por dia ──
    por_dia = {}
    for o in ops:
        por_dia.setdefault(o["date"], []).append(o)

    for d in sorted(por_dia, reverse=True):
        dia_ops = sorted(por_dia[d], key=lambda o: (o["time"], o["id"]))
        try:
            dow = DIAS_SEMANA[datetime.strptime(d, "%Y-%m-%d").weekday()]
        except ValueError:
            dow = ""
        soma_dia = sum(float(o.get("value") or 0) * (1 if o.get("result") == "WIN" else -1) for o in dia_ops)
        n_w = sum(1 for o in dia_ops if o.get("result") == "WIN")
        n_l = sum(1 for o in dia_ops if o.get("result") == "LOSS")
        linhas.append(f"\n## 📅 {d} ({dow}) — {len(dia_ops)} ops · {fmt_brl(soma_dia)} · {n_w}W/{n_l}L\n")
        linhas.append("| Hora | Tipo | Resultado | Valor (R$) | Plano | Motivo | Prints |")
        linhas.append("|---|---|---|---|---|---|---|")
        for o in dia_ops:
            r = "✅ WIN" if o.get("result") == "WIN" else "❌ LOSS"
            t = "📈 CALL" if o.get("type") == "CALL" else "📉 PUT"
            sinal = "+" if o.get("result") == "WIN" else "−"
            plano = "Sim" if o.get("plan") == "yes" else "Não"
            motivo = (o.get("reason") or "").replace("|", "\\|").replace("\n", " ")
            n_prints = len(o.get("shots") or [])
            linhas.append(f"| {o.get('time','')} | {t} | {r} | {sinal}{fmt_brl(float(o.get('value') or 0))} | {plano} | {motivo} | {n_prints} |")

    if not ops:
        linhas.append("\n_Nenhuma operação registrada ainda._\n")

    with open(RESUMO, "w", encoding="utf-8") as f:
        f.write("\n".join(linhas) + "\n")


def main():
    log("📦 Gerando backup do EdgeControl...")
    cfg = carregar_config()
    capital_inicial = cfg["capital_inicial"] if cfg["capital_inicial"] is not None else CAPITAL_INICIAL
    esperado = cfg["capital_atual_esperado"]

    ops, shots = ler_dias()
    capital_final, passos = calcular_extrato(ops, capital_inicial)
    pack = montar_state(ops, shots, capital_inicial, capital_final)
    escrever_json(MASTER, pack)
    snap = os.path.join(SNAPS, f"edgecontrol_{date.today().isoformat()}.json")
    escrever_json(snap, pack)
    resumo_md(ops, shots, passos, capital_inicial, capital_final, esperado)

    soma = sum(float(o.get("value") or 0) * (1 if o.get("result") == "WIN" else -1) for o in ops)
    log(f"  ✅ {len(ops)} operações · {len(shots)} prints · saldo {fmt_brl(soma)}")
    log(f"  💰 Capital: {fmt_brl(capital_inicial)} {'→ … →' if passos else '→'} {fmt_brl(capital_final)}")
    if esperado is not None:
        if abs(capital_final - esperado) < 0.005:
            log(f"  ✅ Conferência: fecha em {fmt_brl(esperado)} como informado")
        else:
            log(f"  ⚠️ Conferência: calculado {fmt_brl(capital_final)} ≠ informado {fmt_brl(esperado)} "
                f"(diferença {fmt_brl(esperado - capital_final)})")
    log(f"  📄 {MASTER}")
    log(f"  📄 {snap}")
    log(f"  📄 {RESUMO}")


if __name__ == "__main__":
    sys.exit(main())
