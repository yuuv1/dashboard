const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const dir = path.join(__dirname, '..', 'supabase', 'setup');
const files = fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
assert.equal(files.length, 13, 'setup contains the 13 ordered SQL steps');

for (const [i, file] of files.entries()) {
  assert.equal(file.slice(0, 2), String(i + 1).padStart(2, '0'), `step ${i + 1} is numbered in order`);
  const sql = fs.readFileSync(path.join(dir, file), 'utf8').trim();
  assert.ok(sql.length > 0, `${file} is not empty`);
  assert.equal((sql.match(/;/g) || []).length, 1, `${file} contains one SQL statement`);
  assert.doesNotMatch(sql, /^do\b/i, `${file} does not use unsupported DO syntax`);
}

const all = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
for (const name of ['ec_user_state', 'ec_operations', 'ec_shots', 'edgecontrol-prints']) {
  assert.ok(all.includes(name), `setup includes ${name}`);
}
for (const policy of ['ec_user_state_own', 'ec_operations_own', 'ec_shots_own', 'ec_prints_own']) {
  assert.ok(all.includes(policy), `setup includes RLS policy ${policy}`);
}
assert.match(all, /public\s*=\s*false/i, 'prints bucket is private');
console.log('✅ Supabase setup: 13 passos, uma instrução por query, RLS e bucket privado');
