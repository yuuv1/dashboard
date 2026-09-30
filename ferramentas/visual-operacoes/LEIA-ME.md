# 📈 Pasta reservada: `visual-operacoes`

Esta é a pasta onde entra o **sistema de visualização complexa das operações**
(estilo TradingView) dentro da catalogação de operações do EdgeControl.

Ela já está configurada para aparecer em **dois lugares**: na página **Operações**
(aba ao lado da tabela) e na página **Analytics** (aba ao lado dos painéis). Dá para
mudar isso no campo `"montagem"` do `ferramenta.json`.

O que está aqui hoje é um **painel de referência funcional**: ele já recebe os dados
do app, desenha a linha de capital e as velas diárias, reage aos eventos e abre
operações/prints. Serve de prova de que o caminho todo funciona e de exemplo para
o sistema real.

## Como colocar o seu sistema aqui

**Caminho curto (recomendado) — manter o modo iframe:**

1. Copie os arquivos do seu sistema para esta pasta (ex.: `index.html`, `estilo.css`,
   `app.js`, libs, fontes, imagens…).
2. Garanta que a página de entrada seja `index.html` (ou ajuste `"entrada"` no
   `ferramenta.json`).
3. Dentro do seu HTML, inclua a ponte e use-a:

```html
<script src="../ponte.js"></script>
<script>
  EC.ponte.pronto(async () => {
    const serie = await EC.ponte.serie();   // operações + equity + velas + resumo
    meuGrafico.render(serie);
  });
  EC.ponte.on('dados',  async () => meuGrafico.render(await EC.ponte.serie()));
  EC.ponte.on('tema',   async () => meuGrafico.tema(await EC.ponte.tema()));
  EC.ponte.on('filtro', async () => meuGrafico.render(await EC.ponte.serie()));
</script>
```

4. Atualize `"versao"` no `ferramenta.json` e recarregue o app
   (ou use 🧩 → ⚙ na aba → **Recarregar**).

> Se a sua pasta tiver muitos arquivos (libs, assets, fontes), pode jogar tudo aqui
> dentro: o iframe usa a pasta como base, então os caminhos relativos continuam
> valendo. Só caminhos **absolutos** (`/assets/…`) precisam virar relativos.

> Nenhum arquivo do app precisa ser editado. Se o seu sistema quebrar, o app continua
> igual — a ferramenta é carregada de forma isolada e preguiçosa.

**Caminho alternativo — modo script (sem iframe):**

Troque no `ferramenta.json`:

```json
"modo": "script",
"script": "index.js",
"estilo": "estilo.css"
```

E no seu `index.js` registre a montagem (veja `ferramentas/_modelo/`):

```js
EC.host.registrar('visual-operacoes', {
  mount(el, ctx) { el.innerHTML = '<div id="meuGrafico"></div>'; iniciar(el, ctx); },
  update(ctx, motivo) { redesenhar(ctx, motivo); },
  unmount() { destruir(); }
});
```

Nesse modo o seu CSS entra na página do app — **prefixe todas as classes** para não
colidir (o app usa `.ops-*`, `.card`, `.btn-*`, `.ps-*`, `.shot-*`, `.sb`, `.mol/.mod`…).
Se houver qualquer dúvida, fique no iframe: colisão zero.

## O que a ferramenta recebe

Tudo pela ponte (`EC.ponte`), sem tocar no estado do app:

| Chamada | Devolve |
|---|---|
| `serie()` | pacote completo: `operacoes[]`, `equity[]`, `velas[]`, `porDia[]`, `porAtivo[]`, `porHora[]`, `resumo{}`, `filtro{}`, `capitalInicial` |
| `operacoes({filtradas:false})` | só a lista normalizada (por padrão respeita os filtros da tela) |
| `resumo()` / `velas()` / `porDia()` / `porAtivo()` / `porHora()` | recortes prontos |
| `ativos()` / `filtros()` / `config()` / `perfil` | listas e configurações (capital, cotação USD, stop, alvo…) |
| `tema()` / `temas()` | tema atual com as cores CSS resolvidas (claro/escuro incluso) |
| `prints(idOperacao)` | prints daquela operação já com `url` (inclui marcação de `analise`) |
| `abrirPrint(id)` / `abrirOperacao(id)` / `irPara(pagina)` | navegação no app |
| `toast(msg, tipo)` / `telaCheia(on)` | UI do app |
| `guardar(id, chave, valor)` / `ler(id, chave, padrao)` | storage privativo da ferramenta (`ecx:<id>:<chave>`) |

Eventos disponíveis: `pronto`, `dados`, `filtro`, `tema`, `pagina`, `tabela`,
`redimensionar`, `abrir`, `fechar`.

Detalhes completos, formato dos objetos e regras de segurança: `ferramentas/LEIA-ME.md`.

## Arquivos desta pasta

| Arquivo | Papel |
|---|---|
| `ferramenta.json` | manifesto (id, modo iframe, entrada, ícone, versão e **onde aparece**: Operações + Analytics) |
| `index.html` | painel de referência — **substituir pelo sistema real** |
| `estilo.css` | estilos do painel — **substituir junto** |
| `LEIA-ME.md` | este arquivo (pode manter ou apagar) |

## Futuro replay de operações

A catalogação já está preparada para enviar o instante UTC da entrada, ativo,
fonte, timeframe e ajustes ao novo sistema. Este painel de referência **não**
implementa replay de preços e por isso ainda **não** anuncia `recursos.replay`.

Ao substituir o painel pelo seu motor, siga o contrato em
[REPLAY-OPERACOES.md](../../REPLAY-OPERACOES.md). A ponte e o adaptador opcionais
ficam um nível acima desta pasta: `../ponte.js` e `../replay-adapter.js`.
