const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const dir = path.join(__dirname, '..', 'supabase', 'setup');
const files = fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
assert.equal(files.length, 38, 'setup contains the 38 ordered SQL steps');

for (const [i, file] of files.entries()) {
  assert.equal(file.slice(0, 2), String(i + 1).padStart(2, '0'), `step ${i + 1} is numbered in order`);
  const sql = fs.readFileSync(path.join(dir, file), 'utf8').trim();
  assert.ok(sql.length > 0, `${file} is not empty`);
  /* Funções usam $$ ... $$: os ponto-e-vírgulas de dentro do corpo não contam
     como novas instruções. */
  const outsideBodies = sql.replace(/\$\$[\s\S]*?\$\$/g, '');
  assert.equal((outsideBodies.match(/;/g) || []).length, 1, `${file} contains one SQL statement`);
  assert.doesNotMatch(sql, /^do\b/i, `${file} does not use unsupported DO syntax`);
}

const all = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
for (const name of ['ec_user_state', 'ec_operations', 'ec_shots', 'edgecontrol-prints', 'ec_accounts', 'ec_members', 'ec_pair', 'ec_new_account']) {
  assert.ok(all.includes(name), `setup includes ${name}`);
}
for (const policy of ['ec_user_state_own', 'ec_operations_own', 'ec_shots_own', 'ec_prints_own']) {
  assert.ok(all.includes(policy), `setup includes RLS policy ${policy}`);
}
assert.match(all, /public\s*=\s*false/i, 'prints bucket is private');
assert.match(all, /revoke all on function public\.ec_pair/, 'funções de pareamento não ficam expostas ao anon');
/* ── histórico (rede de segurança) e aparelho do site ── */
const history = files.filter(f => /^3[1-7]-/.test(f)).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
assert.match(history, /create table if not exists public\.ec_history/, 'passo 31 cria o histórico');
assert.match(history, /create or replace function public\.ec_log_history/, 'passo 34 define o registro');
assert.match(history, /enable row level security/, 'histórico tem RLS ligada');
assert.match(history, /revoke all on public\.ec_history from anon, authenticated/, 'aparelhos não leem nem apagam o histórico');
assert.match(history, /create or replace trigger ec_history_ops/, 'toda gravação de operação é registrada');
assert.match(history, /create or replace trigger ec_history_shots/, 'toda gravação de print é registrada');
assert.match(files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n'), /site@edgecontrol\.app/, 'passo 34 cria o usuário do site');
const runtimeConfig = fs.readFileSync(path.join(dir, '..', '..', 'supabase', 'runtime-config.js'), 'utf8');
assert.match(runtimeConfig, /deviceLogin[\s\S]*site@edgecontrol\.app/, 'o app carrega as credenciais do aparelho do site');
console.log('✅ Supabase setup: 38 passos, uma instrução por query, RLS, bucket privado, anon sem acesso, pareamento por código + PIN, histórico e aparelho do site');
