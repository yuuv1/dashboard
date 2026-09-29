# 🧪 `_modelo/` — esqueleto de ferramenta (modo script)

Esta pasta **não é carregada pelo app**: não está no `registro.json` e o manifesto
nasce com `"ativa": false`. Ela existe só para ser copiada.

## Como usar

```bash
cp -r ferramentas/_modelo ferramentas/minha-ferramenta
```

1. Em `ferramentas/minha-ferramenta/ferramenta.json`:
   - `"id": "minha-ferramenta"` (letras, números, `-` e `_`);
   - `"ativa": true`;
   - `"nome"`, `"rotulo"`, `"icone"`, `"descricao"`, `"versao"` do seu jeito.
2. Em `ferramentas/registro.json`, acrescente `{ "pasta": "minha-ferramenta" }`.
3. Edite `index.js` (troque a constante `ID` para o mesmo valor do manifesto) e
   `estilo.css` (mantenha o prefixo das classes).
4. Recarregue o app → aba nova na página **Operações**, ou 🧩 → ⚙ → **Recarregar**.

## Diferença para o modo iframe

| | `script` (este modelo) | `iframe` (pasta `visual-operacoes`) |
|---|---|---|
| Onde roda | na mesma página do app | num quadro isolado, mesma origem |
| Colisão de CSS/JS | possível → prefixe tudo | impossível |
| Acesso à ponte | `EC.host` direto (ou `EC.ponte`) | `EC.ponte` via postMessage |
| Monta como | `EC.host.registrar(id,{mount,update,unmount})` | página própria com `<script src="../ponte.js">` |
| Ideal para | painéis leves, integração fina | sistemas grandes com libs próprias (ex.: charting estilo TradingView) |

## Regras que valem para os dois modos

- Nada de escrever no estado do app (`S`, `localStorage` do app, IndexedDB dos prints):
  leia pelos métodos da ponte e guarde o que for seu em `EC.ponte.guardar(id, chave, valor)`
  (isso cai em `ecx:<id>:<chave>`, sem encostar nas chaves do app).
- Se a ferramenta falhar, o app tem que continuar igual: o hospedeiro isola erros em
  `try/catch` e mostra o aviso em 🧩 → ⚙, mas o seu código também não deve lançar na
  montagem.
- `mount()`/`update()` podem ser assíncronos; `unmount()` precisa limpar listeners,
  timers e observers que você criou.
