const fs = require('fs');
let html = fs.readFileSync('uploads/dashboard.html', 'utf8');

// 1. Adicionar opção no select
html = html.replace(
  '<option value="LOSS">❌ LOSS</option>',
  '<option value="LOSS">❌ LOSS</option><option value="BREAK EVEN">⚖️ BREAK EVEN</option>'
);

// 2. Atualizar lógica de capital (não mexe em BREAK EVEN)
html = html.replace(
  `if(result==='WIN')S.settings.currentCapital=Math.max(0,S.settings.currentCapital+value*.8);else S.settings.currentCapital=Math.max(0,S.settings.currentCapital-value);toast('Operação registrada!','s');`,
  `if(result==='WIN')S.settings.currentCapital=Math.max(0,S.settings.currentCapital+value*.8);
  else if(result==='LOSS')S.settings.currentCapital=Math.max(0,S.settings.currentCapital-value);
  // BREAK EVEN: não altera o capital
  toast('Operação registrada!','s');`
);

// 3. Badge de resultado
html = html.replace(
  `const rc=op.result==='WIN'?'bwin':'bloss',`,
  `const rc=op.result==='WIN'?'bwin':op.result==='LOSS'?'bloss':'bcall',`
);

// 4. Texto do resultado no modal
html = html.replace(
  `\${op.result==='WIN'?'✅':'❌'} \${op.result}`,
  `\${op.result==='WIN'?'✅':op.result==='LOSS'?'❌':'⚖️'} \${op.result}`
);

// 5. Badge na tabela
html = html.replace(
  `const rb=op.result==='WIN'?`<span class="badge bwin">✅ WIN</span>`:`<span class="badge bloss">❌ LOSS</span>`;`,
  `const rb=op.result==='WIN'?`<span class="badge bwin">✅ WIN</span>`:op.result==='LOSS'?`<span class="badge bloss">❌ LOSS</span>`:`<span class="badge bcall">⚖️ BREAK EVEN</span>`;`
);

// 6. Atualizar contadores (não contar BREAK EVEN como win/loss)
html = html.replace(
  `const tot=ops.length,wins=ops.filter(o=>o.result==='WIN').length,loss=ops.filter(o=>o.result==='LOSS').length,wr=tot>0?wins/tot*100:0;`,
  `const tot=ops.length,wins=ops.filter(o=>o.result==='WIN').length,loss=ops.filter(o=>o.result==='LOSS').length,breakeven=ops.filter(o=>o.result==='BREAK EVEN').length,wr=tot>0?wins/tot*100:0;`
);

fs.writeFileSync('uploads/dashboard.html', html);
console.log('✅ BREAK EVEN adicionado com sucesso!');
