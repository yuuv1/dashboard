# Replay de operações — base de integração v1

**Status:** catalogação preparada; motor gráfico e histórico de mercado ainda não conectados.
**App:** `edgecontrol-glass-v2.html`. A v1, os JSONs existentes e as pastas `_backup/` e `_arquivo/` não foram alterados.

O botão **▶** na tabela de Operações (ou **Preparar / ajustar replay** na ficha) abre a preparação do replay. Ela pode ser usada e salva antes de o novo sistema ficar pronto. Não desenha velas artificiais e não trata a linha de capital/velas de saldo do painel atual como preços de mercado.

## 1. Momento da operação, não momento do cadastro

O formulário da operação aceita `HH:mm`, `HH:mm:ss` e `HH:mm:ss.SSS`, mais o **offset UTC da corretora no dia da entrada**, por exemplo `-03:00`.

- Nova operação: sugestão do relógio/fuso do navegador **ao abrir o formulário**. Confirme a entrada real se estiver registrando depois. **Usar agora** recaptura o relógio; não é uma integração com a corretora.
- Operação antiga: o campo de fuso nasce vazio. Não usamos `createdAt`, nome de arquivo, print, ou fuso atual do navegador para inventar uma execução exata.
- O offset é fixado por operação e data. Se a corretora aplica horário de verão, informe o offset daquele dia; não usamos um fuso IANA para resolver horários ambíguos automaticamente.
- Sem fuso confirmado, salvar a operação/ajustes continua possível, mas a abertura no motor fica bloqueada.
- `HH:mm` é identificado como precisão de **minuto**, com aviso. Completar com `:00` não recupera segundos que não foram registrados.
- Se outra versão do app editar `date/time` e deixar `execution` desatualizado, a base detecta a inconsistência e pede reconfirmação.

Dados adicionados à operação (campos antigos continuam existindo):

```js
{
  id: 'op123', date: '2026-09-30', time: '09:15:32.123',
  asset: 'EUR/USD', direction: 'CALL',
  execution: {
    version: 1,
    at: '2026-09-30T12:15:32.123Z', // UTC canônico; não arredondar para a vela
    utcOffset: '-03:00',
    precision: 'millisecond'        // minute | second | millisecond
  },
  replay: { /* ajustes abaixo */ }
}
```

Esse instante permanece o mesmo em outro computador/fuso. Editar a operação recalcula `execution`. Ajustar o cursor do replay **não altera** `execution`, `date`, `time`, resultado, valor, capital ou prints.

## 2. Ajustes por operação

```js
{
  version: 1,
  symbol: '',              // vazio = asset; símbolo exato do fornecedor, sem mapeamento OTC implícito
  provider: '',            // ID da fonte/corretora; vazio = motor resolve sua fonte padrão
  timeframeSeconds: 60,    // inteiro de 1 a 86400; padrão M1
  beforeBars: 120,         // contexto anterior, 0..5000
  afterBars: 30,           // janela posterior para avançar, 0..1000
  offsetMs: 0,             // ajuste do cursor, -86400000..86400000; original fica intacto
  speed: 1,               // 0.25..16
  hideFuture: true,
  chartState: null,        // snapshot JSON do seu sistema: desenhos, indicadores, layout...
  updatedAt: ''            // preenchido pelo hospedeiro na gravação
}
```

**Padrão** só restaura o rascunho dos controles; salvar mantém os desenhos/layout já guardados. O futuro motor pode limpar um snapshot com `chartState: null`.

O snapshot deve ser um objeto JSON de até **64 KiB UTF-8**. Use `{engine, schema, ...}` para versionar seu formato. Não guarde velas, grandes datasets nem credenciais aqui. O motor deve verificar se o snapshot é compatível com sua fonte/símbolo/timeframe.

A gravação é atômica: se o armazenamento do navegador falhar, a API retorna erro e não mantém uma falsa gravação só em memória. A exportação/importação **já existente**, com envelope `__ec:3`, leva esses campos dentro de `state.operations`; nenhum backup antigo precisa ser reescrito.

## 3. Habilitar somente quando o motor estiver pronto

Quando substituir o painel de referência na pasta `ferramentas/visual-operacoes/`, adicione ao `ferramenta.json`:

```json
{
  "recursos": { "replay": 1 }
}
```

Mantenha `modo`, `entrada/script`, `id`, `api-host: 1` e uma montagem em `operacoes`. O contrato é aditivo à API ECX 1; `recursos.replay` versiona separadamente o replay. Outras versões da capacidade são recusadas.

**Não marcar isso agora no painel de referência.** Ele mostra capital e não implementa replay de preços. Sem motor declarado/ativo, **Abrir no motor** fica desabilitado. Os ajustes podem ser salvos normalmente. `?ecx=0` também desliga a abertura de replay.

## 4. Ponte para o sistema gráfico

No modo iframe, inclua a ponte e, opcionalmente, o adaptador:

```html
<script src="../ponte.js"></script>
<script src="../replay-adapter.js"></script>
```

Métodos de `EC.ponte` (todos devolvem Promise):

| Método | Contrato |
|---|---|
| `replay(id)` | Contexto da operação, mesmo fora dos filtros atuais. Pode retornar `ready:false` com `issues`. |
| `replayAtual()` | Pedido selecionado para este motor, ou `null`. |
| `abrirReplay(id)` | Abre a operação no motor atual; valida instante/símbolo e retorna um pedido. |
| `salvarReplay(id, alteracoes, requestId?)` | Salva apenas ajustes permitidos. Não permite editar campos financeiros/horário. `requestId` protege contra gravação de um pedido encerrado/substituído. |

No modo script, `EC.host` oferece os mesmos métodos com **um objeto de argumentos**: `replay({id})`, `abrirReplay({id, ferramenta})`, `salvarReplay({id, alteracoes, requestId, ferramenta})`, `replayAtual({ferramenta})`. A ponte detecta o modo nativo e adapta as assinaturas.

As listas de `operacoes()`/`serie()` incluem metadados leves em `replay` (instante, símbolo, timeframe e disponibilidade de snapshot), sem duplicar os desenhos/layout de todas as operações. Para o contexto completo, use `replay(id)`.

Pedidos chegam no evento **`replay`** e em **`ctx.replay`** no handshake/montagem. O contexto é recuperável mesmo se o motor carregar depois da seleção. Pode haver entregas duplicadas do mesmo pedido: deduplique por `requestId`. O evento **`replay-cancel`** encerra a seleção ao sair/desmontar, editar/excluir a operação ou importar dados. A seleção não é restaurada automaticamente ao recarregar o app.

Exemplo do payload:

```js
{
  version: 1,
  requestId: 'replay_..._1', toolId: 'visual-operacoes', requestedAt: 'ISO',
  operationId: 'op123', ready: true,
  operation: { id: 'op123', asset: 'EUR/USD', direction: 'CALL', date: '2026-09-30', time: '09:15:32.123' },
  execution: { ready: true, at: '2026-09-30T12:15:32.123Z', timestampMs: 1790770532123, utcOffset: '-03:00', precision: 'millisecond' },
  symbol: 'EUR/USD', provider: '', settings: { /* ajustes acima */ },
  anchorMs: 1790770532123, anchorAt: '2026-09-30T12:15:32.123Z',
  range: { fromMs: 1790763332123, toMs: 1790772332123 },
  marker: { operationId: 'op123', timeMs: 1790770532123, direction: 'CALL' },
  startPaused: true, issues: [], warnings: []
}
```

**Todos os timestamps numéricos são milissegundos Unix**, não segundos. `anchorMs = execution.timestampMs + settings.offsetMs`. O marcador da operação usa o instante original, não o cursor ajustado. `range` é uma janela solicitada, não prova de que o fornecedor tem essas velas. `ready` significa **contexto válido**, não histórico carregado.

## 5. Exemplo para conectar o futuro sistema

As funções `meuMotor.*` abaixo são ilustrativas: devem ser implementadas no seu novo sistema.

```js
const adapter = EC.replay.conectar({
  ferramenta: 'visual-operacoes', // mesmo id do manifesto
  async abrir(pedido, { signal, atual }) {
    // Só aqui o SEU sistema resolve símbolos e busca histórico real.
    // Use APIs relativas à origem ou o backend do sistema, nunca localhost no browser.
    const historico = await meuMotor.buscarHistorico({
      symbol: pedido.symbol, provider: pedido.provider,
      timeframeSeconds: pedido.settings.timeframeSeconds,
      fromMs: pedido.range.fromMs, toMs: pedido.range.toMs,
      signal
    });
    if (!atual()) return; // uma operação mais recente foi selecionada
    if (!historico.length) throw new Error('Histórico indisponível nessa fonte/horário.');
    await meuMotor.iniciarReplay({
      historico, cursorMs: pedido.anchorMs, marker: pedido.marker,
      pausado: pedido.startPaused, ocultarFuturo: pedido.settings.hideFuture,
      velocidade: pedido.settings.speed, layout: pedido.settings.chartState
    });
  },
  cancelar() { meuMotor.parar(); },
  erro(error) { mostrarErroNaTela(error.message); }
});

// Quando o usuário terminar alterações, salve só o snapshot do gráfico:
await adapter.salvar({ chartState: meuMotor.exportarLayout() });
// Ao desmontar o painel:
adapter.destruir();
```

O adaptador deduplica pedidos, fornece `AbortSignal`, evita resultados antigos após troca de operação e salva usando o ID da operação/pedido. O motor deve honrar o cancelamento e verificar `atual()` antes de renderizar. Para ferramentas nativas, passe também `adapter.contexto(ctx)` no `mount/update`; destrua o adaptador no `unmount`.

**Responsabilidades do futuro motor:**
- Fonte real, autenticação (segredos no backend), mapeamento exato e disponibilidade do histórico, inclusive OTC.
- Play/pause/avanço, velocidade, alinhamento de sessões/timeframes, desenhos e indicadores.
- Não revelar OHLC final de uma vela em formação após o cursor: use ticks/intrabar ou mostre apenas velas encerradas. `hideFuture:true` não é aplicado ao preço pelo hospedeiro, pois ele não tem histórico.
- Erros de rede/falta de dados devem aparecer como indisponibilidade, não velas sintetizadas.

As escritas de replay via RPC exigem a origem exata e o `contentWindow` de uma ferramenta montada com a capacidade declarada. O hospedeiro substitui a identidade enviada pelo quadro pela identidade real dele. A ponte também valida origem e pai das respostas. Isso **não transforma extensões same-origin em código não confiável isolado**: continue instalando apenas ferramentas confiáveis.

## 6. Testes

```bash
npm run test:replay
npm test
```

Cobertura: offsets/UTC/segundos/milissegundos, datas inválidas e mudança de fuso do computador; legado sem falsa precisão; ajustes não destrutivos; limites/JSON; quota e exportação/importação; UI sem motor; entrega/handshake em iframe/script; cancelamento durante carregamento; validação RPC; adaptador e proteção contra pedidos atrasados.
