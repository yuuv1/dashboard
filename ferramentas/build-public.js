#!/usr/bin/env node
/* Monta o pacote `_public/` publicado no Netlify Drop (e conferido pelos testes).
   O app é um HTML único; este script copia o app e os módulos locais para que
   Supabase, gráficos e PWA funcionem sem CDN. Rode: npm run build:public */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, '_public');

const files = [
  ['edgecontrol-glass-v2.html', 'index.html'],
  ['404.html', '404.html'],
  ['sw.js', 'sw.js'],
  ['manifest.webmanifest', 'manifest.webmanifest'],
  ['vendor/chart.umd.min.js', 'vendor/chart.umd.min.js'],
  ['vendor/chartjs-LICENSE.txt', 'vendor/chartjs-LICENSE.txt'],
  ['vendor/supabase.min.js', 'vendor/supabase.min.js'],
  ['vendor/supabase-LICENSE.txt', 'vendor/supabase-LICENSE.txt'],
  ['supabase/runtime-config.js', 'supabase/runtime-config.js'],
  ['supabase/app-sync.js', 'supabase/app-sync.js'],
  ['dados/padrao.json', 'dados/padrao.json'],
  ['dados/padrao-estado.json', 'dados/padrao-estado.json']
];
for (const name of ['favicon.png', 'icon-180.png', 'icon-192.png', 'icon-256.png', 'icon-384.png', 'icon-512.png', 'maskable-192.png', 'maskable-512.png']) {
  files.push([`icones-app/${name}`, `icones-app/${name}`]);
}

for (const [from, to] of files) {
  const src = path.join(root, from);
  const dst = path.join(out, to);
  if (!fs.existsSync(src)) {
    console.error(`faltando no repositório: ${from}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
console.log(`_public pronto: ${files.length} arquivos (app + PWA + Supabase).`);
