/* ══════════════════════════════════════════════════════════════════
   ponte.js — cliente da ponte ECX (EdgeControl eXtensions)

   A ferramenta usa SEMPRE `EC.ponte`; o transporte é escolhido sozinho:
     · modo iframe → fala com o app por postMessage (só mesma origem);
     · modo script → chama window.EC.host diretamente.

   Uso mínimo:
     <script src="../ponte.js"></script>
     <script>
       EC.ponte.pronto(async function () {
         const serie = await EC.ponte.serie();
         desenhar(serie);
       });
       EC.ponte.on('dados', async () => desenhar(await EC.ponte.serie()));
     </script>

   Nada aqui depende do app: se a página for aberta fora dele,
   EC.ponte.modo === 'isolado' e as chamadas devolvem erro amigável.
══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 1;
  var host = (window.EC && typeof window.EC.host === 'object' && window.EC.host) ? window.EC.host : null;
  var noQuadro = false;
  try { noQuadro = !!(window.parent && window.parent !== window); } catch (e) { noQuadro = false; }

  var direto = !!host;                 /* modo script: mesma janela do app */
  var pendentes = {};
  var seq = 1;
  var assinaturas = {};
  var prontos = [];
  var estadoPronto = false;
  var contexto = null;

  function enviar(obj) {
    var origem;
    try { origem = window.location.origin; } catch (e) { origem = '*'; }
    try { window.parent.postMessage(obj, origem); }
    catch (e) { try { window.parent.postMessage(obj, '*'); } catch (_) { } }
  }

  function disparar(evt, data) {
    var lista = assinaturas[evt];
    if (lista && lista.length) {
      lista.slice().forEach(function (fn) { try { fn(data, evt); } catch (e) { } });
    }
  }

  if (!direto && noQuadro) {
    window.addEventListener('message', function (ev) {
      var m = ev.data;
      if (!m || m.ecx !== 1) return;
      /* resposta de um RPC */
      if (m.res != null && pendentes[m.res]) {
        var p = pendentes[m.res];
        delete pendentes[m.res];
        if (m.ok) p.resolve(m.data);
        else p.reject(new Error(m.erro || 'o hospedeiro recusou a chamada'));
        return;
      }
      /* evento vindo do app */
      if (!m.evt) return;
      if (m.evt === 'pronto') {
        contexto = m.data || null;
        estadoPronto = true;
        prontos.slice().forEach(function (fn) { try { fn(contexto); } catch (e) { } });
        prontos = [];
      }
      disparar(m.evt, m.data);
    });
    /* aperto de mão: avisa o app que a ferramenta está viva e pede o contexto */
    enviar({ ecx: 1, evt: 'pronto' });
  }

  function chamar(metodo, args) {
    if (direto) {
      return new Promise(function (resolve, reject) {
        try {
          var fn = host[metodo];
          if (typeof fn !== 'function') throw new Error('método desconhecido: ' + metodo);
          resolve(fn.call(host, args || {}));
        } catch (e) { reject(e); }
      });
    }
    if (!noQuadro) {
      return Promise.reject(new Error('ponte: esta página está fora do app (modo "' +
        (direto ? 'nativo' : 'isolado') + '"). Abra-a pela aba da ferramenta.'));
    }
    return new Promise(function (resolve, reject) {
      var id = seq++;
      pendentes[id] = { resolve: resolve, reject: reject };
      enviar({ ecx: 1, req: id, metodo: metodo, args: args || {} });
      setTimeout(function () {
        if (pendentes[id]) { delete pendentes[id]; reject(new Error('tempo esgotado esperando "' + metodo + '"')); }
      }, 20000);
    });
  }

  var ponte = {
    api: API,
    modo: direto ? 'nativo' : (noQuadro ? 'iframe' : 'isolado'),

    /* núcleo */
    chamar: chamar,
    on: function (evt, fn) {
      if (typeof fn !== 'function') return ponte;
      (assinaturas[evt] = assinaturas[evt] || []).push(fn);
      if (direto && typeof host.on === 'function') host.on(evt, fn);
      return ponte;
    },
    off: function (evt, fn) {
      if (!assinaturas[evt]) return ponte;
      assinaturas[evt] = fn ? assinaturas[evt].filter(function (f) { return f !== fn; }) : [];
      if (direto && typeof host.off === 'function') host.off(evt, fn);
      return ponte;
    },
    pronto: function (cb) {
      if (typeof cb !== 'function') return ponte;
      if (estadoPronto) { try { cb(contexto); } catch (e) { } } else prontos.push(cb);
      return ponte;
    },
    contexto: function () { return contexto; },

    /* atalhos de dados */
    versao: function () { return chamar('versao'); },
    serie: function (a) { return chamar('serie', a); },
    operacoes: function (a) { return chamar('operacoes', a); },
    resumo: function (a) { return chamar('resumo', a); },
    velas: function (a) { return chamar('velas', a); },
    porDia: function (a) { return chamar('porDia', a); },
    porAtivo: function (a) { return chamar('porAtivo', a); },
    porHora: function (a) { return chamar('porHora', a); },
    ativos: function () { return chamar('ativos'); },
    filtros: function () { return chamar('filtros'); },
    config: function () { return chamar('config'); },
    tema: function () { return chamar('tema'); },
    temas: function () { return chamar('temas'); },

    /* mídia e navegação */
    prints: function (operacao, maxW) { return chamar('prints', { operacao: operacao, maxW: maxW }); },
    abrirPrint: function (id) { return chamar('abrirPrint', { id: id }); },
    abrirOperacao: function (id) { return chamar('abrirOperacao', { id: id }); },
    irPara: function (pagina) { return chamar('irPara', { pagina: pagina }); },
    toast: function (msg, tipo) { return chamar('toast', { msg: String(msg == null ? '' : msg), tipo: tipo || 's' }); },
    telaCheia: function (on) { return chamar('telaCheia', { on: !!on }); },

    /* armazenamento privativo da ferramenta (localStorage "ecx:<id>:<chave>") */
    guardar: function (ferramenta, chave, valor) { return chamar('guardar', { ferramenta: ferramenta, chave: chave, valor: valor }); },
    ler: function (ferramenta, chave, padrao) { return chamar('ler', { ferramenta: ferramenta, chave: chave, padrao: padrao }); },

    /* diagnóstico */
    ferramentas: function () { return chamar('ferramentas'); },
    erros: function () { return chamar('erros'); }
  };

  window.EC = window.EC || {};
  window.EC.ponte = ponte;

  if (direto) {
    /* modo script: o contexto já está aqui, o "pronto" é imediato */
    estadoPronto = true;
    contexto = { api: host.api, build: host.build, modo: 'nativo' };
    setTimeout(function () {
      prontos.slice().forEach(function (fn) { try { fn(contexto); } catch (e) { } });
      prontos = [];
    }, 0);
  }
})();
