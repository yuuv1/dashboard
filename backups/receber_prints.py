#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor de recepção dos prints/backups do EdgeControl.

Abre uma página no navegador do usuário onde ele pode:
  1) enviar os prints do dia (imagens) — salvos em <repo>/uploads/
  2) colar texto (lista de operações ou JSON exportado do app)

Uso:
  python3 backups/receber_prints.py [porta]
"""

import datetime
import json
import os
import re
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(REPO, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

PAGE = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recepção de prints — EdgeControl</title>
<style>
:root{--bg:#0c1020;--card:#141a2e;--line:#232c4a;--acc:#6ea8ff;--ok:#37d67a;--tx:#dfe6f5;--dim:#8b96b8}
*{box-sizing:border-box;font-family:Segoe UI,Roboto,sans-serif}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 70% -10%,#1a2450 0%,var(--bg) 55%);color:var(--tx);display:flex;justify-content:center;padding:32px 16px}
.wrap{width:min(680px,100%)}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--dim);font-size:13px;margin-bottom:22px}
.card{background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px}
.card h2{font-size:14px;margin:0 0 12px;color:var(--acc);letter-spacing:.4px;text-transform:uppercase;font-size:12px}
#drop{border:2px dashed var(--line);border-radius:14px;padding:34px 16px;text-align:center;cursor:pointer;transition:.2s}
#drop.over{border-color:var(--acc);background:rgba(110,168,255,.08)}
#drop .ic{font-size:34px}
#drop .t{font-weight:600;margin-top:6px}
#drop .s{color:var(--dim);font-size:12px;margin-top:4px}
button{background:linear-gradient(135deg,#4f8ef7,#2f6bdc);border:none;color:#fff;font-weight:700;font-size:14px;padding:11px 18px;border-radius:11px;cursor:pointer;margin-top:12px}
button:hover{filter:brightness(1.1)}
button:disabled{opacity:.5;cursor:default}
textarea{width:100%;min-height:130px;background:#0a0e1c;border:1px solid var(--line);border-radius:12px;color:var(--tx);padding:12px;font-size:13px;font-family:ui-monospace,Consolas,monospace;resize:vertical}
#status{font-size:13px;margin-top:12px;min-height:18px}
#status.ok{color:var(--ok)}#status.err{color:#ff7b7b}
#lista{margin-top:14px;font-size:12px;color:var(--dim)}
#lista b{color:var(--tx)}
.arquivo{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed var(--line);font-size:12px}
.arquivo .n{color:var(--tx);word-break:break-all}
.pulo{height:0}
</style></head><body><div class="wrap">
<h1>📸 Recepção de prints — EdgeControl</h1>
<div class="sub">Suba os prints das operações de hoje (pode mandar vários de uma vez) ou cole o texto/JSON.</div>

<div class="card"><h2>1 · Enviar prints do dia</h2>
<div id="drop" onclick="document.getElementById('f').click()">
  <div class="ic">🖼️</div>
  <div class="t">Clique ou arraste as imagens aqui</div>
  <div class="s">pode selecionar vários prints de uma vez · PNG, JPG, WEBP</div>
</div>
<input type="file" id="f" multiple accept="image/*,.json" style="display:none">
<button id="btn" onclick="enviar()">⬆ Enviar prints</button>
<div id="status"></div>
</div>

<div class="card"><h2>2 · Ou cole o texto / JSON</h2>
<textarea id="txt" placeholder="Ex.: 09:15 | R$ 40 | WIN | CALL | Rompimento de resistência no M5&#10;10:02 | R$ 25 | LOSS | PUT | Entrada antecipada&#10;&#10;(ou cole aqui o JSON exportado do dashboard: Configurações → Backup de Dados → Exportar)"></textarea>
<button onclick="enviarTexto()">📨 Enviar texto</button>
</div>

<div class="card" id="listaCard" style="display:none"><h2>Recebidos agora</h2><div id="lista"></div></div>
</div>
<script>
const drop=document.getElementById('drop'),inp=document.getElementById('f'),st=document.getElementById('status');
let files=[];
['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>{files=files.concat([...e.dataTransfer.files]);atual();});
inp.addEventListener('change',()=>{files=files.concat([...inp.files]);inp.value='';atual();});
function atual(){st.textContent=files.length?('📎 '+files.length+' arquivo(s) selecionado(s): '+files.map(f=>f.name).join(', ')):'';st.className=files.length?'ok':'';}
async function enviar(){
  if(!files.length){st.textContent='Nenhum arquivo selecionado.';st.className='err';return;}
  const fd=new FormData();files.forEach(f=>fd.append('arquivos',f));
  st.textContent='Enviando…';st.className='';document.getElementById('btn').disabled=true;
  try{
    const r=await fetch('/upload',{method:'POST',body:fd});
    const j=await r.json();
    st.textContent='✅ '+j.msg;st.className='ok';files=[];
    listar(j.arquivos);
  }catch(e){st.textContent='Erro: '+e;st.className='err';}
  document.getElementById('btn').disabled=false;
}
async function enviarTexto(){
  const t=document.getElementById('txt').value.trim();
  if(!t){st.textContent='Texto vazio.';st.className='err';return;}
  st.textContent='Enviando…';st.className='';
  try{
    const r=await fetch('/texto',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'t='+encodeURIComponent(t)});
    const j=await r.json();
    st.textContent='✅ '+j.msg;st.className='ok';
    document.getElementById('txt').value='';
    listar(j.arquivos);
  }catch(e){st.textContent='Erro: '+e;st.className='err';}
}
async function listar(novos){
  const c=document.getElementById('listaCard');c.style.display='block';
  const l=document.getElementById('lista');
  const html=(novos||[]).map(a=>'<div class="arquivo"><span class="n">📄 '+a+'</span></div>').join('');
  l.innerHTML += html;
}
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self._send(404, {"msg": "não encontrado"})

    def do_POST(self):
        try:
            if self.path == "/upload":
                self._upload()
            elif self.path == "/texto":
                self._texto()
            else:
                self._send(404, {"msg": "rota desconhecida"})
        except Exception as e:
            try:
                self._send(500, {"msg": "erro: %s" % e})
            except Exception:
                pass

    def _upload(self):
        ctype = self.headers.get("Content-Type", "")
        m = re.search(r"boundary=(?:\"([^\"]+)\"|([^;]+))", ctype)
        if not m:
            self._send(400, {"msg": "multipart esperado"})
            return
        boundary = (m.group(1) or m.group(2)).encode("utf-8")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        gravados = []
        agora = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        # separa as partes do multipart manualmente
        partes = body.split(b"--" + boundary)
        for parte in partes:
            if b"Content-Disposition" not in parte:
                continue
            cabecalho, _, conteudo = parte.partition(b"\r\n\r\n")
            mf = re.search(rb'filename="([^"]*)"', cabecalho)
            if not mf:
                continue
            nome = os.path.basename(mf.group(1).decode("utf-8", "replace")).replace(" ", "_")
            conteudo = conteudo.rstrip(b"\r\n")
            if not conteudo:
                continue
            final = f"{agora}_{uuid.uuid4().hex[:6]}_{nome}"
            with open(os.path.join(UPLOAD_DIR, final), "wb") as f:
                f.write(conteudo)
            gravados.append(final)
        if gravados:
            self._send(200, {"msg": f"{len(gravados)} arquivo(s) recebido(s)! Pode avisar o agente.", "arquivos": gravados})
        else:
            self._send(400, {"msg": "nenhum arquivo veio no upload", "arquivos": []})

    def _texto(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8", "replace")
        import urllib.parse
        t = urllib.parse.parse_qs(raw).get("t", [""])[0]
        if not t.strip():
            self._send(400, {"msg": "texto vazio", "arquivos": []})
            return
        agora = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        nome = f"{agora}_colado.txt"
        with open(os.path.join(UPLOAD_DIR, nome), "w", encoding="utf-8") as f:
            f.write(t)
        self._send(200, {"msg": "texto recebido!", "arquivos": [nome]})


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    print(f"Recepção de prints em http://0.0.0.0:{porta}  (salvando em {UPLOAD_DIR})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", porta), Handler).serve_forever()
