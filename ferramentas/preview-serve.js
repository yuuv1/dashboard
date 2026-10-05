#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
   preview-serve.js — servidor estático do EdgeControl (dev / preview)

   node ferramentas/preview-serve.js  → http://0.0.0.0:8080  (abre a v2 em demo)
   PORTA=9000 node ferramentas/preview-serve.js

   Por que existe: o app precisa ser servido por HTTP — com file:// o navegador
   bloqueia o fetch de /ferramentas (e o hospedeiro ECX não acha as ferramentas).
   O EdgeControl.bat faz o mesmo no Windows (Python). Este é o equivalente Node.
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');   /* a raiz do repositório é a pasta de cima */
const PORTA = Number(process.env.PORTA || 8080);
const HOME = '/edgecontrol-glass-v2.html?demo=1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
};

const SRV = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(url.parse(req.url).pathname); }
  catch (e) { res.writeHead(400); return res.end('URL inválida'); }

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(302, { Location: HOME }); return res.end();
  }

  const alvo = path.normalize(path.join(ROOT, pathname));
  if (alvo !== ROOT && !alvo.startsWith(ROOT + path.sep)) {   // sem ../ para fora
    res.writeHead(403); return res.end('fora da pasta do projeto');
  }

  fs.stat(alvo, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 — ' + pathname);
    }
    const ext = path.extname(alvo).toLowerCase();
    const head = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      /* sem cache: o que você editar aparece no próximo reload, e o
         hospedeiro ECX precisa ver as mudanças em /ferramentas na hora */
      'Cache-Control': 'no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    };
    res.writeHead(200, head);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(alvo).pipe(res);
  });
});

SRV.listen(PORTA, '0.0.0.0', () => {
  console.log('EdgeControl servido em http://0.0.0.0:' + PORTA + '  →  ' + HOME);
  console.log('Pasta: ' + ROOT);
});
