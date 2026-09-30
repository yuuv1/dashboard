# Desempenho do EdgeControl v2

Build: `2026-09-30.2-ecx-replay-performance-v2`.

## Correções

- Eixos de contagem usam marcações inteiras automáticas e limitadas, em vez de `stepSize: 1`. Esse passo forçado gerava centenas/milhares de marcações e bloqueava a thread principal.
- Chart.js **4.4.1 incorporado no HTML**, com as licenças incluídas. Não depende de uma CDN sem versão. Continua sendo possível distribuir o app em um único HTML.
- Animação de gráficos desativada; resolução padrão limitada. Não usamos `resizeDelay` positivo: na versão testada, updates atrasados podiam executar depois de `destroy()`.
- Gráficos do Dashboard são reutilizados quando dados/período/tema não mudam. Ordenação e filtragem não são refeitas por cada slot.
- Dashboard e Analytics liberam seus gráficos ao sair da página. Analytics monta os gráficos avançados em etapas e cancela trabalho pendente quando a página é substituída.
- Rodízio automático é **opcional e desligado em instalações sem preferência anterior**. Preferências explícitas existentes são preservadas. O timer para em abas ocultas e modais; não desenha por trás do relatório/Estúdio de Prints.
- **Modo leve ativado por padrão**, em Configurações → Desempenho: sem blur de fundo, glows e movimento decorativo contínuo. As paletas continuam disponíveis; desativar o modo restaura os efeitos. Movimento reduzido do sistema prevalece.
- Operações paginadas: **100 linhas por padrão**, opções 50/100/200. Filtros, métricas, exportação e séries ECX continuam usando o histórico inteiro, não a página visível.
- Curvas densas de capital/drawdown/médias móveis desenham no máximo **600 pontos por série**, preservando primeiro/último, posição original e extremos por intervalo. Apenas a representação visual é reduzida: registros, cálculos financeiros, métricas e APIs não são amostrados. Tooltips mostram os índices/datas originais dos pontos desenhados.
- Avatar padrão é SVG local. Fallbacks de imagens têm uma única tentativa, evitando loops de requests quando uma imagem falha.
- Reconciliação/estatísticas de mídia usam cursor com metadados, sem reter todos os Blobs/base64 no resultado. A tela principal aparece sem aguardar a reconciliação; relatório e detalhe aguardam a mesma promessa para não perder vínculos. Abertura **não apaga prints**. IndexedDB continua na versão 1, compartilhável com a v1.

## Verificação

```bash
npm install
npm test
# somente regressões de desempenho (jsdom + fake IndexedDB)
npm run test:performance
```

O teste de desempenho cobre 6 mil operações, exportação integral, filtros, paginação, liberação/cache de gráficos, cancelamento de Analytics, timers, mídia, avatar e preferências. O núcleo de amostragem também é testado com 50 mil pontos. As suítes de replay, ECX, importação, prints, PDF e temas continuam na execução completa.

### Chromium com Chart.js real (opcional)

Não está no `npm test` e não adiciona dependências de navegador ao app distribuído:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:performance:browser
# ou Chromium já instalado
PERF_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:performance:browser
```

O fixture é inteiramente sintético: o teste não lê backups nem prints pessoais. Verifica desktop e viewport móvel, cliques nos controles, filtros integrais, limites de desenho, cancelamento de tarefas, gráficos ocultos, ausência de erros e de CDN/serviço remoto de avatar. Fontes e outros requests externos são simulados; isso **não** valida instalação PWA, rede de produção ou funcionamento offline completo.

Para comparar uma cópia antiga:

```bash
PERF_BASELINE=1 PERF_HTML=/caminho/antes.html npm run test:performance:browser
```

O modo baseline registra medidas sem exigir controles/otimizações inexistentes no HTML antigo. A biblioteca remota antiga é substituída no teste pelo mesmo Chart.js 4.4.1, isolando mudanças de versão/rede.

### Exemplo de medição no mesmo ambiente

Chromium headless, Chart.js 4.4.1, 5.000 operações sintéticas, desktop 1440 × 900. Tempos via Playwright; variam com a máquina, caches e carga. Antes = cópia do v2 anterior às correções de desempenho; depois = build acima, com o mesmo fixture.

| Medida | Antes | Depois |
|---|---:|---:|
| Pior troca de slot entre 8 ações | 10.593 ms | 32 ms |
| Navegar para Operações | 881 ms | 24 ms |
| Resposta inicial ao abrir Analytics | 743 ms | 128 ms |
| Gráficos retidos ao retornar ao Dashboard | 16 | 3 |
| Linhas da tabela no DOM | 5.000 | 100 |
| Avisos de geração excessiva de ticks | 24 | 0 |

Um ensaio anterior, com outro histórico sanitizado de 5 mil operações, também reproduziu troca de slot de **4.355 ms**, com long task de **4.027 ms**. A correção foi validada com ambos os fixtures e também com 51 operações.

Não é uma promessa de eliminar toda long task em qualquer hardware: inicialização, cálculo completo do histórico, geração de relatório e etapas do Analytics ainda têm custo. A montagem avançada do Analytics termina depois da resposta inicial medida na tabela. Na execução acima, o evento `load` passou de 329 para 579 ms com o runtime incorporado/animação desligada; não tratamos esse número como melhoria de startup. O objetivo medido é remover pausas de vários segundos durante o uso e limitar trabalho/DOM/renderização recorrentes.

## Dados preservados

- Backups JSON, `_backup/`, `_arquivo/` e `edgecontrol-glass.html` não foram modificados; 60 arquivos protegidos tiveram SHA-256 conferido.
- Implementações de exportação/importação e envelope `__ec: 3` continuam iguais. A preferência `performance.light` é metadado aditivo do estado, assim como a preparação de replay previamente solicitada.
- A preparação de replay está descrita em [REPLAY-OPERACOES.md](REPLAY-OPERACOES.md). Nenhum motor ou histórico de mercado foi implementado neste trabalho.
