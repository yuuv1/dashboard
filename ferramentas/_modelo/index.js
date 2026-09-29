/* ══════════════════════════════════════════════════════════════════
   MODELO de ferramenta ECX — modo "script" (sem iframe)

   Copie esta pasta para ferramentas/<sua-pasta>/, troque o ID abaixo e o
   "id" do ferramenta.json (têm que ser iguais), liste a pasta no
   ferramentas/registro.json e marque "ativa": true.

   Regras de ouro deste modo (o seu código divide a página com o app):
     · nenhum global genérico — tudo dentro de uma IIFE, como aqui;
     · CSS sempre prefixado (aqui: .mx-*) para não colidir com .card,
       .btn-*, .ops-*, .ps-*, .shot-*, .mol/.mod do app;
     · mount() nunca assume que o app terminou de carregar dados;
     · unmount() desfaz tudo o que mount() ligou (listeners, timers).
══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var ID = 'modelo-script';                     /* == "id" do ferramenta.json */
  var host = window.EC && window.EC.host;
  if (!host || typeof host.registrar !== 'function') {
    console.warn('[' + ID + '] hospedeiro ECX não disponível — abortando a montagem.');
    return;
  }

  var el = null, ctx = null, timer = null;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function brl(v) {
    try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0); }
    catch (e) { return 'R$ ' + (v || 0); }
  }

  function esqueleto() {
    return '' +
      '<div class="mx">' +
      '  <div class="mx-topo">' +
      '    <b>🧪 Modelo de ferramenta</b>' +
      '    <span class="mx-tag" id="mxModo">—</span>' +
      '    <span class="mx-tag" id="mxTema">—</span>' +
      '    <button class="mx-bt" id="mxToast">🔔 toast do app</button>' +
      '    <button class="mx-bt" id="mxNav">📋 ir para Operações</button>' +
      '    <button class="mx-bt" id="mxFs">⛶ tela cheia</button>' +
      '  </div>' +
      '  <div class="mx-kpis" id="mxKpis"><span class="mx-vazio">carregando…</span></div>' +
      '  <div class="mx-tela"><canvas id="mxCanvas"></canvas></div>' +
      '  <div class="mx-log" id="mxLog">pronto para receber eventos</div>' +
      '</div>';
  }

  function log(msg) {
    var box = el && el.querySelector('#mxLog');
    if (!box) return;
    box.textContent = new Date().toTimeString().slice(0, 8) + '  ' + msg + '\n' + box.textContent;
  }

  function kpis(r) {
    var box = el.querySelector('#mxKpis');
    box.innerHTML = [
      ['operações', r.n || 0], ['acerto', ((r.taxa || 0) * 100).toFixed(1) + '%'],
      ['resultado', brl(r.resultado)], ['saldo', brl(r.saldoFinal)],
      ['drawdown', brl(r.drawdown)], ['ativos', r.ativosDistintos || 0]
    ].map(function (k) {
      return '<div class="mx-kpi"><span>' + k[0] + '</span><b>' + esc(k[1]) + '</b></div>';
    }).join('');
  }

  function faísca(pontos) {
    var cv = el.querySelector('#mxCanvas');
    if (!cv || !pontos || pontos.length < 2) return;
    var box = cv.parentNode;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(80, box.clientWidth | 0), h = Math.max(60, box.clientHeight | 0);
    cv.width = w * dpr; cv.height = h * dpr;
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var vals = pontos.map(function (p) { return p.saldo; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max === min) { max += 1; min -= 1; }
    var X = function (i) { return 6 + (w - 12) * (i / (pontos.length - 1)); };
    var Y = function (v) { return 6 + (h - 12) * (1 - (v - min) / (max - min)); };
    g.beginPath(); g.moveTo(X(0), Y(vals[0]));
    for (var i = 1; i < vals.length; i++) g.lineTo(X(i), Y(vals[i]));
    g.strokeStyle = '#4f46e5'; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
  }

  async function carregar(motivo) {
    try {
      var s = await host.serie();
      kpis(s.resumo || {});
      faísca(s.equity || []);
      log('dados carregados' + (motivo ? ' (' + motivo + ')' : '') + ': ' + (s.operacoes || []).length + ' ops');
    } catch (e) {
      log('erro: ' + ((e && e.message) || e));
    }
  }

  function aoRedimensionar() { if (el) carregar('resize'); }

  host.registrar(ID, {
    mount: function (node, c) {
      el = node; ctx = c || {};
      el.innerHTML = esqueleto();
      el.querySelector('#mxModo').textContent = 'script · API ' + host.api;
      el.querySelector('#mxTema').textContent = 'tema ' + ((ctx.tema && ctx.tema.id) || '?');
      el.querySelector('#mxToast').onclick = function () { host.toast({ msg: '🧪 oi do modelo', tipo: 's' }); };
      el.querySelector('#mxNav').onclick = function () { host.irPara({ pagina: 'operations' }); };
      el.querySelector('#mxFs').onclick = function () { host.telaCheia({ on: true }); };
      host.on('dados', function (d) { carregar((d && d.motivo) || 'dados'); });
      host.on('filtro', function () { carregar('filtro'); });
      host.on('tema', function (t) {
        el.querySelector('#mxTema').textContent = 'tema ' + ((t && t.id) || '?');
        log('tema trocado');
      });
      window.addEventListener('resize', aoRedimensionar);
      carregar('montagem');
      timer = setInterval(function () { /* exemplo de pulso: some no unmount */ }, 60000);
    },
    update: function (c, motivo) { ctx = c || ctx; carregar(motivo || 'update'); },
    unmount: function () {
      window.removeEventListener('resize', aoRedimensionar);
      if (timer) { clearInterval(timer); timer = null; }
      el = null;
    }
  });
})();
