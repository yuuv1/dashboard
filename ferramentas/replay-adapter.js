/* EdgeControl Replay v1 — adaptador opcional para o futuro motor gráfico.
   Incluir DEPOIS de ponte.js. Não busca dados e não fabrica velas.
   Contrato e exemplo completo: /REPLAY-OPERACOES.md.

   const adapter = EC.replay.conectar({
     ferramenta: 'visual-operacoes',
     abrir: async (pedido, {signal, atual}) => meuMotor.abrirReplay(pedido, {signal}),
     cancelar: () => meuMotor.parar(),
     erro: e => mostrarErro(e.message)
   });
   await adapter.salvar({chartState: meuMotor.exportarLayout()});
   adapter.destruir(); // ao desmontar a ferramenta
*/
(function () {
  'use strict';
  window.EC = window.EC || {};
  window.EC.replay = {
    version: 1,
    conectar: function (options) {
      var o = options || {}, P = o.ponte || window.EC.ponte;
      if (!P || typeof P.replayAtual !== 'function' || typeof P.salvarReplay !== 'function') {
        throw new Error('Ponte de replay indisponível. Inclua ponte.js antes do adaptador.');
      }
      if (typeof o.ferramenta !== 'string' || !o.ferramenta.trim()) throw new Error('Informe o id da ferramenta que anuncia replay.');
      if (typeof o.abrir !== 'function') throw new Error('Informe a função abrir(pedido, contexto) do seu motor.');
      var current = null, controller = null, generation = 0, destroyed = false;
      var seen = null;
      function copy(value) { return value == null ? null : JSON.parse(JSON.stringify(value)); }
      function fail(error) {
        if (destroyed) return;
        if (typeof o.erro === 'function') o.erro(error instanceof Error ? error : new Error(String(error)));
        else console.warn('[EC replay]', error);
      }
      function cancel(reason) {
        generation++;
        if (controller) controller.abort();
        controller = null;
        current = null;
        if (typeof o.cancelar === 'function') {
          try { o.cancelar(reason); } catch (e) { fail(e); }
        }
      }
      function receive(request) {
        if (destroyed || !request || request.version !== 1 || !request.ready || !request.requestId) return;
        if (o.ferramenta && request.toolId !== o.ferramenta) return;
        /* O mesmo pedido chega no handshake e no evento: abrir só uma vez. */
        if (seen === request.requestId) return;
        seen = request.requestId;
        cancel('replaced');
        current = copy(request);
        controller = new AbortController();
        var own = generation, signal = controller.signal;
        Promise.resolve().then(function () {
          if (destroyed || own !== generation) return;
          return o.abrir(copy(request), {
            signal: signal,
            atual: function () { return !destroyed && own === generation && !signal.aborted; }
          });
        }).catch(function (error) {
          if (!destroyed && own === generation && !signal.aborted) fail(error);
        });
      }
      function onCancel(data) {
        if (destroyed || (data && data.toolId && data.toolId !== o.ferramenta)) return;
        if (current && data && data.requestId && current.requestId !== data.requestId) return;
        if (!current && data && data.requestId) seen = data.requestId;
        cancel((data && data.reason) || 'closed');
      }
      function onReady(ctx) { if (!destroyed && ctx && ctx.replay) receive(ctx.replay); }
      P.on('replay', receive);
      P.on('replay-cancel', onCancel);
      if (typeof P.pronto === 'function') P.pronto(onReady);
      /* Recupera pedidos que antecederam o listener/montagem. */
      var queryGeneration = generation;
      Promise.resolve(P.replayAtual()).then(function (request) {
        if (generation === queryGeneration) receive(request);
      }).catch(fail);
      return {
        pedido: function () { return copy(current); },
        contexto: function (ctx) { onReady(ctx); },
        salvar: function (patch) {
          if (destroyed || !current) return Promise.reject(new Error('Não há um replay ativo para salvar.'));
          var request = copy(current), own = generation;
          return P.salvarReplay(request.operationId, patch, request.requestId).then(function (context) {
            if (!destroyed && own === generation && current) {
              current.settings = copy(context.settings);
            }
            return context;
          });
        },
        destruir: function () {
          if (destroyed) return;
          destroyed = true;
          P.off('replay', receive);
          P.off('replay-cancel', onCancel);
          cancel('destroyed');
        }
      };
    }
  };
})();
