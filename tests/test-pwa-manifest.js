/* Contrato do PWA publicado: manifest real, ícones no repositório, service
   worker com pré-cache e entrada apontando para tudo isso. Nada aqui abre o app. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));

const manifestPath = 'manifest.webmanifest';
assert.ok(exists(manifestPath), 'o app publicado precisa de um manifest.webmanifest de verdade (blob não serve para instalar)');
const manifest = JSON.parse(read(manifestPath));

assert.equal(manifest.name, 'EdgeControl — Gestão de Capital', 'nome do app no manifest');
assert.equal(manifest.short_name, 'EdgeControl', 'nome curto do manifest');
assert.equal(manifest.display, 'standalone', 'manifest abre em janela própria');
assert.equal(manifest.lang, 'pt-BR');
assert.ok(manifest.start_url && manifest.start_url.startsWith('./'), 'start_url relativa: funciona em Pages, Netlify e servidor local');
assert.ok(manifest.start_url.endsWith('edgecontrol-glass-v2.html'), 'start_url abre o app v2');
assert.equal(manifest.scope, './', 'escopo cobre toda a pasta publicada');

assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4, 'manifest lista os ícones');
const sizes = new Set(manifest.icons.filter(i => i.purpose !== 'maskable').map(i => i.sizes));
assert.ok(sizes.has('192x192'), 'ícone 192x192 para a tela inicial');
assert.ok(sizes.has('512x512'), 'ícone 512x512 para a splash/loja');
assert.ok(manifest.icons.some(i => i.purpose === 'maskable'), 'há ícone maskable para Android');
for (const icon of manifest.icons) {
  assert.equal(icon.type, 'image/png', `${icon.src} é PNG (iOS/Android ignoram webp no manifest)`);
  const file = path.join(root, icon.src.replace(/^\.\//, ''));
  assert.ok(fs.existsSync(file), `ícone do manifest existe no repositório: ${icon.src}`);
  assert.ok(fs.statSync(file).size > 512, `ícone não está vazio: ${icon.src}`);
}

for (const page of ['index.html', 'edgecontrol-glass-v2.html']) {
  const html = read(page);
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/, `${page} declara o manifest estático`);
  assert.match(html, /<meta name="theme-color"/, `${page} declara theme-color`);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/icones-app\/icon-180\.png">/, `${page} tem ícone do iOS`);
  assert.ok(!/rel="manifest" href="blob:/.test(html), `${page} não troca o manifest por blob`);
}

const sw = read('sw.js');
assert.match(sw, /const CACHE='edgecontrol-v4'/, 'versão do cache do service worker');
assert.match(sw, /self\.addEventListener\('install'/, 'service worker faz pré-cache na instalação');
const core = sw.match(/const CORE=\[([\s\S]*?)\];/);
assert.ok(core, 'service worker declara a lista CORE');
const precached = [...core[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
for (const asset of ['./index.html', './edgecontrol-glass-v2.html', './manifest.webmanifest', './supabase/app-sync.js', './vendor/supabase.min.js']) {
  assert.ok(precached.includes(asset), `pré-cache inclui ${asset}`);
}
for (const asset of precached) {
  if (asset === './') continue;
  assert.ok(fs.existsSync(path.join(root, asset.replace(/^\.\//, ''))), `pré-cache só aponta para arquivos existentes: ${asset}`);
}
assert.match(sw, /edgecontrol-glass-v2\.html/, 'fallback de navegação offline aponta para o app');

const pages = read('.github/workflows/pages.yml');
for (const asset of ['manifest.webmanifest', 'icones-app/*.png', 'supabase/runtime-config.js', 'supabase/app-sync.js', 'sw.js']) {
  assert.ok(pages.includes(asset), `o deploy do Pages publica ${asset}`);
}

/* Pacote do Netlify Drop precisa sair igual ao app (npm run build:public). */
assert.equal(read('_public/index.html'), read('edgecontrol-glass-v2.html'), '_public/index.html é a cópia do app');
assert.equal(read('_public/sw.js'), sw, '_public/sw.js é o mesmo service worker');
assert.equal(read('_public/manifest.webmanifest'), read(manifestPath), '_public leva o manifest');
for (const asset of ['vendor/supabase.min.js', 'supabase/runtime-config.js', 'supabase/app-sync.js', 'icones-app/icon-512.png', '404.html']) {
  assert.ok(exists(path.join('_public', asset)), `_public leva ${asset}`);
}

const runtime = read('supabase/runtime-config.js');
assert.match(runtime, /https:\/\/[a-z0-9]+\.supabase\.co/, 'runtime-config aponta para o projeto Supabase');
assert.match(runtime, /sb_publishable_/, 'chave pública (publishable) no runtime-config');
assert.ok(!/service_role|sb_secret_/.test(runtime), 'nenhuma chave secreta no arquivo publicado');

console.log('✅ PWA: manifest, ícones, pré-cache offline e pacote publicado');
