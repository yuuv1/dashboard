#!/usr/bin/env node
/* Gera os arquivos que fazem o site abrir já preenchido:
   - dados/padrao-estado.json → só o estado (operações, ajustes, tema), leve,
     baixado antes da primeira pintura;
   - dados/padrao.json        → backup completo (estado + prints), baixado em
     segundo plano para o IndexedDB.
   Uso: node ferramentas/build-seed.js [caminho-do-backup]
   Sem argumento, usa dados/backups/edgecontrol_2026-09-17 (1).json. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = process.argv[2] || path.join(root, 'dados', 'backups', 'edgecontrol_2026-09-17 (1).json');
const raw = JSON.parse(fs.readFileSync(source, 'utf8'));
const pack = raw && raw.state && typeof raw.state === 'object' ? raw : { state: raw, shots: {} };
if (!pack.state || !Array.isArray(pack.state.operations)) {
  console.error('arquivo não parece um backup do EdgeControl:', source);
  process.exit(1);
}

const fullPath = path.join(root, 'dados', 'padrao.json');
const statePath = path.join(root, 'dados', 'padrao-estado.json');

fs.writeFileSync(fullPath, JSON.stringify({ __ec: pack.__ec || 3, exportedAt: pack.exportedAt || new Date().toISOString(), state: pack.state, shots: pack.shots || {} }));
fs.writeFileSync(statePath, JSON.stringify({ __ec: pack.__ec || 3, exportedAt: pack.exportedAt || new Date().toISOString(), state: pack.state, prints: Object.keys(pack.shots || {}).length }));

const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log(`padrão gerado de ${path.basename(source)}`);
console.log(`  operações: ${pack.state.operations.length}`);
console.log(`  prints:    ${Object.keys(pack.shots || {}).length}`);
console.log(`  ${path.relative(root, statePath)}: ${mb(fs.statSync(statePath).size)}`);
console.log(`  ${path.relative(root, fullPath)}: ${mb(fs.statSync(fullPath).size)}`);
