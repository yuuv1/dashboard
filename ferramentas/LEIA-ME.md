# 🧩 `ferramentas/` — como o EdgeControl recebe ferramentas externas

Esta pasta é o **encaixe** para sistemas externos (o primeiro deles: a visualização
complexa das operações, estilo TradingView, em `visual-operacoes/`).

O app hospeda a ferramenta pelo módulo **ECX** (EdgeControl eXtensions), que vive
dentro de `edgecontrol-glass-v2.html`. A regra do projeto é uma só:

> **A ferramenta nunca obriga o app a mudar.** Sem esta pasta — ou com ela vazia,
> com manifesto inválido, com erro em runtime — o EdgeControl se comporta
> exatamente como antes: as abas nem aparecem.

---

## 1. Estrutura

```
ferramentas/
├── LEIA-ME.md                 ← este contrato
├── registro.json              ← quais pastas o app deve procurar
├── ferramenta.schema.json     ← esquema do manifesto (documentação/validação)
├── ponte.js                   ← biblioteca cliente (EC.ponte) — funciona nos 2 modos
├── visual-operacoes/          ← PASTA RESERVADA para o sistema de visualização
│   ├── ferramenta.json        ← manifesto (modo iframe, entrada index.html)
│   ├── index.html             ← painel de referência (substituir pelo sistema real)
│   ├── estilo.css             ← estilos do painel de referência
│   └── LEIA-ME.md             ← como trocar pelo sistema real
└── _modelo/                   ← esqueleto copiável (modo script, não é carregado)
    ├── ferramenta.json
    ├── index.js
    ├── estilo.css
    └── LEIA-ME.md
```

O app lê, nesta ordem: `registro.json` → `ferramenta.json` de cada pasta listada →
(só quando o usuário clica na aba) o `index.html` ou o `index.js` da ferramenta.
Se o `registro.json` não existir, ele tenta apenas as pastas padrão
(`visual-operacoes`).

## 2. Manifesto `ferramenta.json`

| Campo | Obrigatório | O que é |
|---|---|---|
| `id` | ✔ | identificador único (`^[A-Za-z0-9][A-Za-z0-9_-]{1,40}$`). Vira prefixo do storage: `ecx:<id>:<chave>` |
| `modo` | ✔ | `"iframe"` (recomendado) ou `"script"` |
| `entrada` | no modo iframe | página HTML da ferramenta (ex.: `index.html`) |
| `script` | no modo script | JS que chama `EC.host.registrar(id,{mount,update,unmount})` |
| `estilo` | opcional (script) | CSS carregado junto |
| `nome`, `rotulo`, `descricao`, `versao`, `icone` | opcionais | textos da aba e do modal 🧩 (`rotulo` e `icone` aparecem na aba) |
| `montagem` | opcional | onde aparece: `"operacoes"`, `"analytics"`, `"ambos"` — ou lista `["operacoes","analytics"]`. Padrão: `["operacoes"]` |
| `tela-cheia` | opcional | oferece o botão ⛶ (padrão `true`) |
| `ativa` | opcional | `false` = registrada mas escondida (reativa pelo modal 🧩) |
| `api-host` | opcional | versão da API que a ferramenta exige; se for maior que a do app, ela é **recusada** |
| `permissao` | opcional | lista documental do que usa (`ops`, `prints`, `tema`, `ui`, `storage`) |

Manifesto inválido ⇒ a ferramenta é ignorada e o motivo fica em **🧩 → ⚙** (e no
console como `[ECX] …`). O app segue normal.

> **Sem `ferramenta.json`?** Se a pasta estiver listada no `registro.json` (ou for a
> pasta reservada) e tiver um `index.html`, o hospedeiro carrega assim mesmo, no
> padrão: **iframe + `index.html`, em Operações e Analytics**, com o nome da pasta
> como rótulo. Fica um aviso em 🧩 → ⚙ dizendo que o manifesto não existe. Ou seja:
> dá para simplesmente **jogar a pasta do sistema aqui dentro** e ver funcionando —
> depois você cria o `ferramenta.json` para dar nome, versão, ícone e escolher onde
> aparece.

## 3. Os dois modos

**`iframe`** — a ferramenta é uma página própria dentro de um quadro `sandbox`
(`allow-scripts allow-same-origin allow-forms allow-popups allow-downloads
allow-pointer-lock`), servida da mesma origem. Fala com o app por `postMessage`
via `ponte.js`. **Colisão de CSS/JS é impossível** — por isso é o modo padrão da
pasta `visual-operacoes` e o recomendado para sistemas grandes com libs próprias.

**`script`** — o JS é injetado na página do app e monta dentro de um `<div>`
(`#ecxHost`). Mais leve e com acesso direto a `EC.host`, mas divide o DOM/CSS com o
app: **prefixe todas as classes** (o app usa `.card`, `.btn-o`, `.btn-s`, `.ops-*`,
`.ps-*`, `.shot-*`, `.sb`, `.mol`, `.mod`, `.fi`, `.badge`…). Veja `_modelo/`.

## 4. A ponte

Nos dois modos a ferramenta usa o mesmo cliente:

```html
<script src="../ponte.js"></script>
<script>
  EC.ponte.pronto(async (ctx) => {
    const serie = await EC.ponte.serie();
    desenhar(serie);
  });
  EC.ponte.on('dados',  async () => desenhar(await EC.ponte.serie()));
  EC.ponte.on('tema',   async () => aplicarTema(await EC.ponte.tema()));
  EC.ponte.on('filtro', async () => desenhar(await EC.ponte.serie()));
</script>
```

`EC.ponte.modo` diz o transporte em uso: `'iframe'`, `'nativo'` (script) ou
`'isolado'` (página aberta fora do app — as chamadas devolvem erro amigável).

### Métodos

Todos devolvem **Promise**. Leitura de dados:

| Chamada | Devolve |
|---|---|
| `serie(opts)` | pacote completo (abaixo) |
| `operacoes({filtradas:false})` | lista normalizada; por padrão respeita os filtros da tela |
| `resumo()`, `velas()`, `porDia()`, `porAtivo()`, `porHora()` | recortes prontos |
| `ativos()`, `filtros()`, `config()` | listas de ativos, filtros atuais e configurações |
| `tema()`, `temas()` | tema atual com cores CSS resolvidas / todos os temas |
| `versao()`, `ferramentas()`, `erros()` | diagnóstico do hospedeiro |
| `prints(idOperacao, maxW?)` | prints da operação com `url` pronta e marcação `analise` |

Ação no app:

| Chamada | Efeito |
|---|---|
| `abrirOperacao(id)` | abre a ficha da operação |
| `abrirPrint(id)` | abre o print no Estúdio de Prints |
| `irPara(pagina)` | `dashboard`, `operations`, `analytics`, `report`, `settings` |
| `toast(msg, tipo)` | notificação do app (`s` sucesso, `w` aviso, `e` erro) |
| `telaCheia(on)` | expandir/recolher o painel da ferramenta |
| `guardar(id, chave, valor)` / `ler(id, chave, padrao)` | storage privativo da ferramenta |

### Eventos

`EC.ponte.on(evt, fn)` / `off(evt, fn)`:

| Evento | Quando |
|---|---|
| `pronto` | aperto de mão: a ferramenta recebeu o contexto (api, build, tema) |
| `dados` | qualquer `save()` do app, importação de backup, nova operação |
| `filtro` | o usuário aplicou/limpou os filtros da página Operações |
| `tema` | o tema do app mudou (cores novas em `EC.ponte.tema()`) |
| `pagina` | o usuário trocou de seção (a ferramenta é desmontada ao sair de Operações) |
| `tabela` | a tabela de operações foi redesenhada (com `linhas`) |
| `redimensionar` | janela redimensionada ou tela cheia ligada/desligada |
| `abrir` / `fechar` | a aba da ferramenta foi aberta/fechada |

### Formato dos dados

`serie()` devolve:

```js
{
  api: 1, build: '<build do app>', geradoEm: 'ISO',
  capitalInicial: 1000,
  filtro: { data:'', resultado:'', ativo:'', plano:'' },
  operacoes: [ /* em ordem cronológica, com saldo acumulado */ ],
  equity:    [ { ts, i, n, saldo } ],            // começa no capital inicial
  velas:     [ { t:'AAAA-MM-DD', ts, o, h, l, c, n, wins, losses, resultado } ],
  porDia:    [ { data, ts, n, wins, losses, outros, resultado, abertura, max, min, saldo } ],
  porAtivo:  [ { ativo, n, wins, losses, outros, resultado, taxa, maiorWin, maiorLoss } ],
  porHora:   [ { hora:0..23, n, wins, losses, resultado } ],
  resumo:    { /* abaixo */ }
}
```

Cada operação normalizada:

```js
{ i, n, id, data:'AAAA-MM-DD', hora:'HH:MM', ts: 1753354800000,
  ativo:'GBP/JPY', direcao:'CALL'|'PUT'|'', resultado:'WIN'|'LOSS'|'',
  valor: 20.88,            // magnitude em R$ (sempre positiva)
  usd: 4.18,
  efeito: +20.88,          // já com sinal: WIN +valor, LOSS −valor, outro 0
  saldo: 1020.88,          // saldo acumulado depois desta operação
  plano:'yes'|'no'|'', motivo, notas,
  emocoes:[], operacionais:[], prints:['shot_…'], video:'', imagem:'', criadoEm:'ISO' }
```

`resumo`:

```js
{ n, wins, losses, outros, taxa, resultado, brutoWin, brutoLoss, fatorLucro,
  mediaWin, mediaLoss, maiorWin, maiorLoss, expectativa,
  saldoInicial, saldoFinal, drawdown, drawdownPct,
  sequenciaAtual, sequenciaTipo, melhorSequenciaWin, piorSequenciaLoss,
  ativosDistintos, diasDistintos }
```

`tema()`:

```js
{ id:'graphite', nome:'Graphite', escuro:true, vibrante:false, metal:'chrome',
  amostras:['#17181B','#7C8FA6','#3A414B'],
  cores:{ fundo, superficie, cartao, borda, fio, texto, suave, apagado,
          acento, acento2, ciano, win, loss, alerta } }
```

## 5. Onde a ferramenta aparece

São **dois pontos de montagem**, cada um com a sua barra de abas e o seu slot:

| `montagem` | Página | Abas | Slot | O que é escondido ao abrir |
|---|---|---|---|---|
| `operacoes` | Operações | `#ecxTabs` | `#ecxSlot` → `#ecxHost` | `.ops-tbl` (a tabela) |
| `analytics` | Analytics | `#ecxTabsAn` | `#ecxSlotAn` → `#ecxHostAn` | `.an-body` (os painéis) |

Uma ferramenta pode aparecer nos dois (`"montagem": "ambos"`), mas **fica montada num
só por vez**: abrir em Analytics desmonta a de Operações. Nada é destruído — o
conteúdo original da página só é escondido (`display:none`) e volta ao fechar a aba.
Sair da página desmonta a ferramenta e restaura a visão padrão automaticamente.

O ⚙ abre o modal **🧩 Ferramentas**: lista o que está instalado, versão, modo, onde
monta, pasta, erros de carregamento, e permite **Abrir em Operações**, **Abrir em
Analytics**, **Desativar/Ativar** e **Recarregar** (relê a pasta sem recarregar o app).

> Caminhos dentro da ferramenta são relativos à pasta dela (`./assets/app.js`,
> `../ponte.js`). Se o seu sistema usa caminhos **absolutos** (`/assets/…`), avise:
> nesse caso a pasta precisa ser servida na raiz, ou os caminhos viram relativos.

## 6. Segurança e limites

- **Kill switch**: `?ecx=0` na URL ou `localStorage.ecxOff='1'` desligam o
  hospedeiro inteiro (as abas somem). É o caminho de emergência se uma ferramenta
  se comportar mal — não precisa editar código.
- **Mesma origem sempre**: o `postMessage` do app só aceita mensagens com
  `event.origin === location.origin`, e responde só para o `contentWindow` do quadro
  que ele mesmo criou.
- **Nada de acesso ao estado interno**: a ferramenta recebe cópias calculadas
  (série, resumo, tema). Ela não recebe `S`, nem o IndexedDB, nem funções de escrita
  do app — só ações explícitas (`abrirOperacao`, `abrirPrint`, `irPara`, `toast`,
  `telaCheia`).
- **Storage separado**: `guardar/ler` escrevem em `ecx:<id>:<chave>`, longe das
  chaves do app (`ec7`, `ec-*`).
- **Montagem preguiçosa**: o código da ferramenta só executa quando o usuário abre a
  aba. Na abertura do app, o ECX só faz dois `fetch` de JSON.
- **HTTP, não `file://`**: o app precisa ser servido por HTTP (é o que o
  `EdgeControl.bat` faz — Python ou servidor embutido na porta 8080). Aberto direto
  do disco, o navegador bloqueia o `fetch` de arquivos locais e nenhuma ferramenta
  carrega (o app continua funcionando).
- **Offline/PWA**: o service worker é network-first e guarda toda resposta no Cache
  Storage, então a ferramenta também passa a funcionar offline depois da primeira
  visita. Por isso o ECX pede `cache:'no-cache'` (nunca `no-store`).
- **Impressão/PDF**: as abas e o painel têm `display:none` em `@media print` — o
  relatório em PDF não muda.

## 7. Como testar

```bash
npm run test:ecx        # só o hospedeiro de ferramentas
npm test                # as 7 suítes (inclui a do estúdio e as antigas)
```

A suíte `tests/test-extensions.js` cobre: app íntegro sem a pasta, manifesto
inválido recusado, kill switch, montagem em iframe e em script, RPC por
postMessage (inclusive origem estranha sendo ignorada), a matemática da série
(saldo acumulado, velas, resumo, drawdown, sequências) e a garantia de que a
tabela de operações continua igual.

No navegador: `ECX` no console mostra `{tools, errors, view, hooks, …}`;
`EC.host.versao()` e `EC.host.erros()` dão o diagnóstico rápido.

## 8. Solução de problemas

| Sintoma | Causa provável |
|---|---|
| A aba não aparece | pasta fora do `registro.json`; manifesto inválido (veja ⚙); `ativa:false`; `?ecx=0`/`ecxOff` ligado; app aberto em `file://` |
| Aba aparece mas o painel fica em branco | caminho errado de `entrada`/`script`; erro dentro do seu código (abra o console do quadro); CSP do servidor |
| "manifesto recusado" | `id` fora do padrão, `modo` inválido, falta `entrada`/`script`, `api-host` maior que a do app |
| Dados chegam vazios | não há operações cadastradas; ou os filtros da página estão aplicados (use `serie()` e confira `filtro`) |
| Eventos não chegam | no modo iframe, confira se `../ponte.js` foi incluído **antes** do seu script |

## 9. Regras deste repositório

1. `edgecontrol-glass.html` (v1) **nunca** é editada.
2. Integrações entram **aditivas**: bloco novo, sem reescrever o que funciona.
3. `npm test` verde antes de commitar.
4. Backup do último estado estável em `_backup/2026-09-29_v2.0.0-estavel/`
   (tag git `v2.0.0-estavel`).
