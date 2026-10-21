const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'setup.sql'), 'utf8');
assert.match(sql, /^\s*--[^\n]*\n[\s\S]*?do \$ec_setup\$\s+begin/i);
assert.match(sql.trim(), /end;\s*\$ec_setup\$;$/i);

// The dashboard/API that reported "Only singular query allowed" must see one
// top-level SQL statement. Semicolons inside the dollar-quoted DO body are OK.
const bodyStart = sql.indexOf('$ec_setup$') + '$ec_setup$'.length;
const bodyEnd = sql.lastIndexOf('$ec_setup$');
assert.ok(bodyStart > 0 && bodyEnd > bodyStart, 'DO body is properly dollar quoted');
const outside = sql.slice(0, bodyStart - '$ec_setup$'.length) + sql.slice(bodyEnd + '$ec_setup$'.length);
assert.equal((outside.match(/;/g) || []).length, 1, 'setup is submitted as one top-level statement');

for (const name of ['ec_user_state', 'ec_operations', 'ec_shots', 'edgecontrol-prints']) {
  assert.ok(sql.includes(name), `setup includes ${name}`);
}
for (const policy of ['ec_user_state_select_own', 'ec_operations_select_own', 'ec_shots_select_own', 'ec_prints_read_own']) {
  assert.ok(sql.includes(policy), `setup includes RLS policy ${policy}`);
}
assert.match(sql, /public\s*=\s*false/i, 'prints bucket is private');
console.log('✅ Supabase setup: uma query, tabelas e políticas privadas');
