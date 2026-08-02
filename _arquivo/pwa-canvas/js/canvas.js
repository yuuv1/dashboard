/* ═══════════════════════════════════════════════
   EdgeControl — Canvas (quadro visual estilo Obsidian)
   ───────────────────────────────────────────────
   • Nós: nota, print (imagem), operação, setup, grupo
   • Arestas: curvas Bézier com seta e rótulo
   • Pan/zoom infinito, multi-seleção, undo/redo
   • Imagens em IndexedDB (Blob), nunca em base64
═══════════════════════════════════════════════ */

import { boards, blobs, blobURL, revokeURL } from './db.js';

export const NODE_TYPES = {
  note:  { icon: '📝', label: 'Nota',      w: 220, h: 130 },
  image: { icon: '🖼', label: 'Print',     w: 300, h: 200 },
  op:    { icon: '📊', label: 'Operação',  w: 240, h: 140 },
  setup: { icon: '🎯', label: 'Setup',     w: 240, h: 150 },
  group: { icon: '🗂', label: 'Grupo',     w: 420, h: 300 },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Canvas {
  constructor(root, opts = {}) {
    this.root = root;
    this.onDirty = opts.onDirty || (() => {});
    this.getOps  = opts.getOps  || (() => []);
    this.fmt     = opts.fmt     || (v => v);

    this.board = { id: uid(), name: 'Novo Quadro', nodes: [], edges: [], view: { x: 0, y: 0, z: 1 } };
    this.sel = new Set();
    this.history = []; this.future = [];
    this.linking = null;     // { from, x, y }
    this.drag = null;
    this.marquee = null;
    this._urls = new Set();

    this._build();
    this._bind();
  }

  /* ─────────── DOM ─────────── */
  _build() {
    this.root.innerHTML = `
      <div class="cv-toolbar">
        <div class="cv-tb-group">
          <select class="fi cv-board-sel" id="cvBoardSel" title="Quadro atual"></select>
          <button class="btn-s xs" id="cvNewBoard" title="Novo quadro">＋</button>
          <button class="btn-s xs" id="cvRenBoard" title="Renomear">✏️</button>
          <button class="btn-s xs" id="cvDelBoard" title="Excluir quadro">🗑️</button>
        </div>
        <div class="cv-tb-sep"></div>
        <div class="cv-tb-group">
          <button class="btn-s xs" data-add="note"  title="Nota (N)"><i>📝</i><b>Nota</b></button>
          <button class="btn-s xs" data-add="image" title="Print — ou cole com Ctrl+V"><i>🖼</i><b>Print</b></button>
          <button class="btn-s xs" data-add="op"    title="Vincular operação"><i>📊</i><b>Operação</b></button>
          <button class="btn-s xs" data-add="setup" title="Setup"><i>🎯</i><b>Setup</b></button>
          <button class="btn-s xs" data-add="group" title="Grupo"><i>🗂</i><b>Grupo</b></button>
        </div>
        <div class="cv-tb-sep"></div>
        <div class="cv-tb-group">
          <button class="btn-s xs" id="cvUndo" title="Desfazer (Ctrl+Z)">↶</button>
          <button class="btn-s xs" id="cvRedo" title="Refazer (Ctrl+Y)">↷</button>
          <button class="btn-s xs" id="cvFit"  title="Enquadrar tudo (F)">⛶</button>
          <button class="btn-s xs" id="cvZoomOut">−</button>
          <span class="cv-zoom" id="cvZoom">100%</span>
          <button class="btn-s xs" id="cvZoomIn">＋</button>
        </div>
        <div style="flex:1"></div>
        <span class="cv-hint">Arraste prints • <kbd>Ctrl+V</kbd> cola imagem • arraste a bolinha p/ ligar</span>
      </div>
      <div class="cv-viewport" id="cvVp">
        <div class="cv-world" id="cvWorld">
          <svg class="cv-edges" id="cvSvg">
            <defs>
              <marker id="cvArrow" viewBox="0 0 10 10" refX="9" refY="5"
                      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
              </marker>
            </defs>
            <g id="cvEdgeG"></g>
            <path id="cvGhost" class="cv-ghost" d=""/>
          </svg>
          <div class="cv-nodes" id="cvNodes"></div>
        </div>
        <div class="cv-marquee" id="cvMarquee"></div>
        <div class="cv-empty" id="cvEmpty">
          <div style="font-size:34px;margin-bottom:8px;">🗺️</div>
          <div style="font-weight:700;margin-bottom:4px;">Quadro vazio</div>
          <div style="font-size:11px;color:var(--lgray);max-width:280px;line-height:1.6;">
            Arraste um print pra cá, cole com <kbd>Ctrl+V</kbd>,
            ou use a barra acima para criar notas e vincular operações.
          </div>
        </div>
      </div>`;

    this.vp     = this.root.querySelector('#cvVp');
    this.world  = this.root.querySelector('#cvWorld');
    this.svg    = this.root.querySelector('#cvSvg');
    this.edgeG  = this.root.querySelector('#cvEdgeG');
    this.ghost  = this.root.querySelector('#cvGhost');
    this.nodesEl= this.root.querySelector('#cvNodes');
    this.marqEl = this.root.querySelector('#cvMarquee');
    this.emptyEl= this.root.querySelector('#cvEmpty');
  }

  /* ─────────── Coordenadas ─────────── */
  toWorld(cx, cy) {
    const r = this.vp.getBoundingClientRect();
    const { x, y, z } = this.board.view;
    return { x: (cx - r.left - x) / z, y: (cy - r.top - y) / z };
  }
  applyView() {
    const { x, y, z } = this.board.view;
    this.world.style.transform = `translate(${x}px,${y}px) scale(${z})`;
    const el = this.root.querySelector('#cvZoom');
    if (el) el.textContent = Math.round(z * 100) + '%';
  }

  /* ─────────── Eventos ─────────── */
  _bind() {
    const r = this.root;

    // toolbar
    r.querySelectorAll('[data-add]').forEach(b =>
      b.addEventListener('click', () => this.addNodeCentered(b.dataset.add)));
    r.querySelector('#cvUndo').onclick = () => this.undo();
    r.querySelector('#cvRedo').onclick = () => this.redo();
    r.querySelector('#cvFit').onclick  = () => this.fit();
    r.querySelector('#cvZoomIn').onclick  = () => this.zoomBy(1.2);
    r.querySelector('#cvZoomOut').onclick = () => this.zoomBy(1 / 1.2);

    // zoom com scroll
    this.vp.addEventListener('wheel', e => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.zoomAt(e.clientX, e.clientY, f);
    }, { passive: false });

    // pan / marquee / clique vazio
    this.vp.addEventListener('pointerdown', e => {
      if (e.target.closest('.cv-node') || e.target.closest('.cv-toolbar')) return;
      const mid = e.button === 1, space = this._space, left = e.button === 0;

      if (mid || space) {                       // PAN
        this.vp.setPointerCapture(e.pointerId);
        const start = { ...this.board.view }, sx = e.clientX, sy = e.clientY;
        this._pan = { start, sx, sy };
        this.vp.style.cursor = 'grabbing';
      } else if (left) {                        // MARQUEE
        this.vp.setPointerCapture(e.pointerId);
        const r0 = this.vp.getBoundingClientRect();
        this.marquee = { x0: e.clientX - r0.left, y0: e.clientY - r0.top, x1: 0, y1: 0 };
        if (!e.shiftKey) this.clearSel();
      }
    });

    this.vp.addEventListener('pointermove', e => {
      if (this._pan) {
        this.board.view.x = this._pan.start.x + (e.clientX - this._pan.sx);
        this.board.view.y = this._pan.start.y + (e.clientY - this._pan.sy);
        this.applyView();
      } else if (this.marquee) {
        const r0 = this.vp.getBoundingClientRect();
        this.marquee.x1 = e.clientX - r0.left;
        this.marquee.y1 = e.clientY - r0.top;
        const { x0, y0, x1, y1 } = this.marquee;
        Object.assign(this.marqEl.style, {
          display: 'block',
          left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px',
          width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px'
        });
      } else if (this.linking) {
        const p = this.toWorld(e.clientX, e.clientY);
        this.linking.x = p.x; this.linking.y = p.y;
        this.drawGhost();
      }
    });

    const endPointer = e => {
      if (this._pan) { this._pan = null; this.vp.style.cursor = ''; this.save(); }
      if (this.marquee) {
        const { x0, y0, x1, y1 } = this.marquee;
        if (Math.abs(x1 - x0) > 4 && Math.abs(y1 - y0) > 4) this.selectInRect(x0, y0, x1, y1);
        this.marquee = null; this.marqEl.style.display = 'none';
      }
      if (this.linking) { this.linking = null; this.ghost.setAttribute('d', ''); }
    };
    this.vp.addEventListener('pointerup', endPointer);
    this.vp.addEventListener('pointercancel', endPointer);

    // teclado
    window.addEventListener('keydown', e => {
      if (!this.isVisible()) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
      if (e.code === 'Space' && !typing) { this._space = true; this.vp.style.cursor = 'grab'; e.preventDefault(); }
      if (typing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
      else if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); this.board.nodes.forEach(n => this.sel.add(n.id)); this.render(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.sel.size) { e.preventDefault(); this.delSelected(); } }
      else if (e.key.toLowerCase() === 'n') this.addNodeCentered('note');
      else if (e.key.toLowerCase() === 'f') this.fit();
      else if (e.key === 'Escape') { this.clearSel(); this.linking = null; this.ghost.setAttribute('d',''); }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space') { this._space = false; this.vp.style.cursor = ''; }
    });

    // colar imagem
    window.addEventListener('paste', async e => {
      if (!this.isVisible()) return;
      const items = [...(e.clipboardData?.items || [])];
      const img = items.find(i => i.type.startsWith('image/'));
      if (img) {
        e.preventDefault();
        const file = img.getAsFile();
        const c = this.centerWorld();
        await this.addImageNode(file, c.x - 150, c.y - 100);
      } else {
        const txt = e.clipboardData?.getData('text');
        if (txt && txt.trim()) {
          const c = this.centerWorld();
          this.addNode('note', c.x - 110, c.y - 65, { text: txt.trim().slice(0, 2000) });
        }
      }
    });

    // arrastar arquivos
    ['dragenter', 'dragover'].forEach(ev =>
      this.vp.addEventListener(ev, e => { e.preventDefault(); this.vp.classList.add('cv-dragover'); }));
    ['dragleave', 'drop'].forEach(ev =>
      this.vp.addEventListener(ev, e => { e.preventDefault(); if (ev === 'dragleave' && e.target !== this.vp) return; this.vp.classList.remove('cv-dragover'); }));
    this.vp.addEventListener('drop', async e => {
      e.preventDefault();
      const p = this.toWorld(e.clientX, e.clientY);
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
      let dx = 0;
      for (const f of files) { await this.addImageNode(f, p.x + dx, p.y); dx += 30; }
      if (!files.length) {
        const txt = e.dataTransfer?.getData('text');
        if (txt) this.addNode('note', p.x, p.y, { text: txt.slice(0, 2000) });
      }
    });
  }

  isVisible() { return this.root.offsetParent !== null; }
  centerWorld() {
    const r = this.vp.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  /* ─────────── Zoom ─────────── */
  zoomAt(cx, cy, f) {
    const v = this.board.view;
    const nz = clamp(v.z * f, 0.15, 4);
    const r = this.vp.getBoundingClientRect();
    const mx = cx - r.left, my = cy - r.top;
    v.x = mx - (mx - v.x) * (nz / v.z);
    v.y = my - (my - v.y) * (nz / v.z);
    v.z = nz;
    this.applyView(); this.saveDebounced();
  }
  zoomBy(f) { const r = this.vp.getBoundingClientRect(); this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); }

  fit() {
    const ns = this.board.nodes;
    if (!ns.length) { this.board.view = { x: 0, y: 0, z: 1 }; this.applyView(); return; }
    const pad = 60;
    const minX = Math.min(...ns.map(n => n.x)), minY = Math.min(...ns.map(n => n.y));
    const maxX = Math.max(...ns.map(n => n.x + n.w)), maxY = Math.max(...ns.map(n => n.y + n.h));
    const r = this.vp.getBoundingClientRect();
    const z = clamp(Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY)), 0.15, 1.6);
    this.board.view = {
      z,
      x: r.width / 2 - ((minX + maxX) / 2) * z,
      y: r.height / 2 - ((minY + maxY) / 2) * z
    };
    this.applyView(); this.save();
  }

  /* ─────────── Nós ─────────── */
  addNodeCentered(type) {
    const c = this.centerWorld();
    const t = NODE_TYPES[type];
    if (type === 'image') { this.pickImage(); return; }
    if (type === 'op')    { this.pickOperation(c.x - t.w / 2, c.y - t.h / 2); return; }
    this.addNode(type, c.x - t.w / 2, c.y - t.h / 2);
  }

  addNode(type, x, y, data = {}) {
    const t = NODE_TYPES[type] || NODE_TYPES.note;
    const n = {
      id: uid(), type,
      x: Math.round(x), y: Math.round(y),
      w: data.w || t.w, h: data.h || t.h,
      text: data.text ?? (type === 'note' ? '' : ''),
      title: data.title ?? '',
      color: data.color || 'default',
      ...data
    };
    this.pushHistory();
    this.board.nodes.push(n);
    this.render(); this.save();
    if (type === 'note' || type === 'setup' || type === 'group') {
      setTimeout(() => {
        const el = this.nodesEl.querySelector(`[data-id="${n.id}"] .cv-editable`);
        if (el) { el.focus(); }
      }, 40);
    }
    return n;
  }

  pickImage() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.onchange = async () => {
      const c = this.centerWorld();
      let dx = 0;
      for (const f of inp.files) { await this.addImageNode(f, c.x - 150 + dx, c.y - 100); dx += 30; }
    };
    inp.click();
  }

  async addImageNode(file, x, y) {
    if (!file || !file.type.startsWith('image/')) return;
    const id = 'img-' + uid();
    await blobs.put(id, file);
    // descobre proporção para não distorcer
    const dim = await new Promise(res => {
      const u = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u); };
      im.onerror = () => { res({ w: 300, h: 200 }); URL.revokeObjectURL(u); };
      im.src = u;
    });
    const maxW = 380;
    const w = Math.min(maxW, dim.w);
    const h = Math.round(w * (dim.h / dim.w));
    return this.addNode('image', x, y, { blobId: id, w, h, title: file.name.slice(0, 40) });
  }

  pickOperation(x, y) {
    const ops = this.getOps();
    if (!ops.length) { this.toast?.('Nenhuma operação registrada ainda.', 'e'); return; }
    const list = [...ops].reverse().slice(0, 60);
    const html = list.map(o => `
      <div class="cv-pick" data-op="${o.id}">
        <span class="badge ${o.result === 'WIN' ? 'bwin' : 'bloss'}">${o.result === 'WIN' ? '✅' : '❌'} ${o.result}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;">${o.type} — ${o.date} ${o.time || ''}</div>
          <div style="font-size:10px;color:var(--lgray);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(o.reason || '—')}</div>
        </div>
        <strong style="font-family:'Space Grotesk';">${this.fmt(o.value)}</strong>
      </div>`).join('');
    this.openPicker('Vincular operação', html, el => {
      const op = ops.find(o => o.id === el.dataset.op);
      if (op) this.addNode('op', x, y, { opId: op.id });
    });
  }

  openPicker(title, html, cb) {
    let m = document.getElementById('cvPicker');
    if (!m) {
      m = document.createElement('div');
      m.className = 'mol'; m.id = 'cvPicker';
      m.innerHTML = `<div class="mod" style="max-width:460px;">
        <div class="mhd"><div class="mtit" id="cvPkTit"></div><div class="mcls" data-x>✕</div></div>
        <div class="mbd" id="cvPkBody" style="max-height:60vh;overflow-y:auto;"></div></div>`;
      document.body.appendChild(m);
      m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-x')) m.classList.remove('show'); });
    }
    m.querySelector('#cvPkTit').textContent = title;
    const body = m.querySelector('#cvPkBody');
    body.innerHTML = html;
    body.querySelectorAll('.cv-pick').forEach(el =>
      el.addEventListener('click', () => { cb(el); m.classList.remove('show'); }));
    m.classList.add('show');
  }

  /* ─────────── Seleção ─────────── */
  clearSel() { this.sel.clear(); this.renderSel(); }
  toggleSel(id, add) {
    if (!add) { this.sel.clear(); this.sel.add(id); }
    else this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id);
    this.renderSel();
  }
  selectInRect(x0, y0, x1, y1) {
    const a = this.toWorld(x0 + this.vp.getBoundingClientRect().left, y0 + this.vp.getBoundingClientRect().top);
    const b = this.toWorld(x1 + this.vp.getBoundingClientRect().left, y1 + this.vp.getBoundingClientRect().top);
    const L = Math.min(a.x, b.x), R = Math.max(a.x, b.x), T = Math.min(a.y, b.y), B = Math.max(a.y, b.y);
    this.board.nodes.forEach(n => {
      if (n.x < R && n.x + n.w > L && n.y < B && n.y + n.h > T) this.sel.add(n.id);
    });
    this.renderSel();
  }
  renderSel() {
    this.nodesEl.querySelectorAll('.cv-node').forEach(el =>
      el.classList.toggle('sel', this.sel.has(el.dataset.id)));
  }
  delSelected() {
    if (!this.sel.size) return;
    this.pushHistory();
    const ids = new Set(this.sel);
    this.board.nodes = this.board.nodes.filter(n => !ids.has(n.id));
    this.board.edges = this.board.edges.filter(e => !ids.has(e.from) && !ids.has(e.to));
    this.sel.clear();
    this.render(); this.save();
  }

  /* ─────────── Histórico ─────────── */
  snapshot() { return JSON.stringify({ nodes: this.board.nodes, edges: this.board.edges }); }
  pushHistory() {
    this.history.push(this.snapshot());
    if (this.history.length > 60) this.history.shift();
    this.future.length = 0;
  }
  undo() {
    if (!this.history.length) return;
    this.future.push(this.snapshot());
    const s = JSON.parse(this.history.pop());
    this.board.nodes = s.nodes; this.board.edges = s.edges;
    this.sel.clear(); this.render(); this.save();
  }
  redo() {
    if (!this.future.length) return;
    this.history.push(this.snapshot());
    const s = JSON.parse(this.future.pop());
    this.board.nodes = s.nodes; this.board.edges = s.edges;
    this.sel.clear(); this.render(); this.save();
  }

  /* ─────────── Render (serializado para evitar corrida) ─────────── */
  render() {
    this._q = (this._q || Promise.resolve()).then(() => this._render()).catch(e => console.warn(e));
    return this._q;
  }
  async _render() {
    this.emptyEl.style.display = this.board.nodes.length ? 'none' : 'flex';
    // nós
    const frag = document.createDocumentFragment();
    for (const n of this.board.nodes) frag.appendChild(await this.renderNode(n));
    this.nodesEl.replaceChildren(frag);
    this.renderSel();
    this.drawEdges();
    this.applyView();
  }

  async renderNode(n) {
    const el = document.createElement('div');
    el.className = `cv-node cv-${n.type}`;
    el.dataset.id = n.id;
    Object.assign(el.style, { left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px' });
    if (n.color && n.color !== 'default') el.classList.add('c-' + n.color);

    let inner = '';
    if (n.type === 'note') {
      inner = `<div class="cv-editable" contenteditable="plaintext-only" data-f="text"
                    placeholder="Escreva…">${this.esc(n.text)}</div>`;
    } else if (n.type === 'image') {
      const u = n.blobId ? await blobURL(n.blobId) : null;
      inner = u
        ? `<img src="${u}" draggable="false" alt="${this.esc(n.title || '')}">`
        : `<div class="cv-broken">🖼 imagem não encontrada</div>`;
      if (n.title) inner += `<div class="cv-cap">${this.esc(n.title)}</div>`;
    } else if (n.type === 'op') {
      const op = this.getOps().find(o => o.id === n.opId);
      inner = op ? `
        <div class="cv-op-hd">
          <span class="badge ${op.result === 'WIN' ? 'bwin' : 'bloss'}">${op.result === 'WIN' ? '✅' : '❌'} ${op.result}</span>
          <span class="badge ${op.type === 'CALL' ? 'bcall' : 'bput'}">${op.type}</span>
        </div>
        <div class="cv-op-val ${op.result === 'WIN' ? 'g' : 'r'}">${op.result === 'WIN' ? '+' : '−'}${this.fmt(op.result === 'WIN' ? op.value * 0.8 : op.value)}</div>
        <div class="cv-op-meta">${op.date} ${op.time || ''} ${op.plan === 'no' ? '· <span style="color:var(--red)">fora do plano</span>' : ''}</div>
        <div class="cv-op-reason">${this.esc((op.reason || '').slice(0, 90))}</div>`
        : `<div class="cv-broken">operação removida</div>`;
    } else if (n.type === 'setup') {
      const st = this.setupStats(n.id);
      inner = `
        <div class="cv-setup-t"><span class="cv-editable inline" contenteditable="plaintext-only" data-f="title"
             placeholder="Nome do setup">${this.esc(n.title)}</span></div>
        <div class="cv-editable small" contenteditable="plaintext-only" data-f="text" placeholder="Regras de entrada…">${this.esc(n.text)}</div>
        <div class="cv-setup-st">
          <span>${st.total} ops</span><span class="${st.wr >= 50 ? 'g' : 'r'}">${st.wr.toFixed(0)}% WR</span>
          <span class="${st.pf >= 1 ? 'g' : 'r'}">PF ${st.pf === Infinity ? '∞' : st.pf.toFixed(2)}</span>
        </div>`;
    } else if (n.type === 'group') {
      inner = `<div class="cv-grp-t"><span class="cv-editable inline" contenteditable="plaintext-only" data-f="title"
                    placeholder="Nome do grupo">${this.esc(n.title)}</span></div>`;
    }

    el.innerHTML = `
      <div class="cv-bar" data-drag>
        <span class="cv-ic">${NODE_TYPES[n.type]?.icon || '•'}</span>
        <span class="cv-ttl">${this.esc(n.title || NODE_TYPES[n.type]?.label || '')}</span>
        <span class="cv-x" data-del title="Excluir">✕</span>
      </div>
      <div class="cv-body">${inner}</div>
      <div class="cv-port" data-port title="Arraste para ligar"></div>
      <div class="cv-rz" data-rz title="Redimensionar"></div>`;

    this.bindNode(el, n);
    return el;
  }

  bindNode(el, n) {
    // arrastar
    const bar = el.querySelector('[data-drag]');
    bar.addEventListener('pointerdown', e => {
      if (e.target.hasAttribute('data-del')) return;
      e.stopPropagation();
      bar.setPointerCapture(e.pointerId);
      if (!this.sel.has(n.id)) this.toggleSel(n.id, e.shiftKey);
      this.pushHistory();
      const z = this.board.view.z;
      const start = new Map();
      this.board.nodes.filter(x => this.sel.has(x.id)).forEach(x => start.set(x.id, { x: x.x, y: x.y }));
      const sx = e.clientX, sy = e.clientY;
      const move = ev => {
        const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
        start.forEach((p, id) => {
          const node = this.board.nodes.find(k => k.id === id);
          node.x = Math.round(p.x + dx); node.y = Math.round(p.y + dy);
          const d = this.nodesEl.querySelector(`[data-id="${id}"]`);
          if (d) { d.style.left = node.x + 'px'; d.style.top = node.y + 'px'; }
        });
        this.drawEdges();
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        this.save();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });

    // clique seleciona
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('.cv-editable')) return;
      if (!this.sel.has(n.id)) this.toggleSel(n.id, e.shiftKey);
    });

    // excluir
    el.querySelector('[data-del]').addEventListener('click', e => {
      e.stopPropagation();
      this.pushHistory();
      if (n.blobId) blobs.del(n.blobId).catch(() => {});
      this.board.nodes = this.board.nodes.filter(x => x.id !== n.id);
      this.board.edges = this.board.edges.filter(x => x.from !== n.id && x.to !== n.id);
      this.sel.delete(n.id);
      this.render(); this.save();
    });

    // edição de texto
    el.querySelectorAll('.cv-editable').forEach(ed => {
      ed.addEventListener('blur', () => {
        const f = ed.dataset.f;
        const v = ed.innerText.trim();
        if (n[f] !== v) { n[f] = v; this.save(); if (f === 'title') this.render(); }
      });
      ed.addEventListener('pointerdown', e => e.stopPropagation());
    });

    // porta de conexão
    const port = el.querySelector('[data-port]');
    port.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      this.linking = { from: n.id, x: n.x + n.w / 2, y: n.y + n.h / 2 };
      const move = ev => { const p = this.toWorld(ev.clientX, ev.clientY); this.linking.x = p.x; this.linking.y = p.y; this.drawGhost(); };
      const up = ev => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const tgt = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.cv-node');
        if (tgt && tgt.dataset.id !== n.id) this.addEdge(n.id, tgt.dataset.id);
        this.linking = null; this.ghost.setAttribute('d', '');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    // redimensionar
    const rz = el.querySelector('[data-rz]');
    rz.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      rz.setPointerCapture(e.pointerId);
      this.pushHistory();
      const z = this.board.view.z, sx = e.clientX, sy = e.clientY, w0 = n.w, h0 = n.h;
      const ratio = n.type === 'image' ? h0 / w0 : null;
      const move = ev => {
        let w = Math.max(120, w0 + (ev.clientX - sx) / z);
        let h = Math.max(70, h0 + (ev.clientY - sy) / z);
        if (ratio && !ev.shiftKey) h = Math.round(w * ratio);
        n.w = Math.round(w); n.h = Math.round(h);
        el.style.width = n.w + 'px'; el.style.height = n.h + 'px';
        this.drawEdges();
      };
      const up = () => { rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); this.save(); };
      rz.addEventListener('pointermove', move);
      rz.addEventListener('pointerup', up);
    });
  }

  /* ─────────── Arestas ─────────── */
  addEdge(from, to) {
    if (this.board.edges.some(e => e.from === from && e.to === to)) return;
    this.pushHistory();
    this.board.edges.push({ id: uid(), from, to, label: '' });
    this.drawEdges(); this.save();
    // se um dos lados for setup, atualiza a estatística exibida
    const touchesSetup = this.board.nodes.some(n =>
      (n.id === from || n.id === to) && n.type === 'setup');
    if (touchesSetup) this.render();
  }

  /* Recalcula só os cards de setup, sem redesenhar o quadro todo */
  refreshSetups() {
    this.board.nodes.filter(n => n.type === 'setup').forEach(n => {
      const el = this.nodesEl.querySelector(`[data-id="${n.id}"] .cv-setup-st`);
      if (!el) return;
      const st = this.setupStats(n.id);
      el.innerHTML = `<span>${st.total} ops</span>` +
        `<span class="${st.wr >= 50 ? 'g' : 'r'}">${st.wr.toFixed(0)}% WR</span>` +
        `<span class="${st.pf >= 1 ? 'g' : 'r'}">PF ${st.pf === Infinity ? '∞' : st.pf.toFixed(2)}</span>`;
    });
  }
  /* Ponto de saída na borda do nó, escolhendo o lado mais natural */
  anchor(n, tx, ty) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const dx = tx - cx, dy = ty - cy;
    // lado horizontal se o deslocamento X domina
    if (Math.abs(dx) * n.h > Math.abs(dy) * n.w) {
      return dx > 0 ? { x: n.x + n.w, y: cy, side: 'r' } : { x: n.x, y: cy, side: 'l' };
    }
    return dy > 0 ? { x: cx, y: n.y + n.h, side: 'b' } : { x: cx, y: n.y, side: 't' };
  }
  edgePath(a, b) {
    const A = this.anchor(a, b.x + b.w / 2, b.y + b.h / 2);
    const B = this.anchor(b, a.x + a.w / 2, a.y + a.h / 2);
    const d = Math.max(40, Math.hypot(B.x - A.x, B.y - A.y) * 0.36);
    const c1 = { x: A.x + (A.side === 'r' ? d : A.side === 'l' ? -d : 0),
                 y: A.y + (A.side === 'b' ? d : A.side === 't' ? -d : 0) };
    const c2 = { x: B.x + (B.side === 'r' ? d : B.side === 'l' ? -d : 0),
                 y: B.y + (B.side === 'b' ? d : B.side === 't' ? -d : 0) };
    return `M ${A.x} ${A.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${B.x} ${B.y}`;
  }
  drawEdges() {
    const byId = Object.fromEntries(this.board.nodes.map(n => [n.id, n]));
    const parts = [];
    this.board.edges.forEach(e => {
      const a = byId[e.from], b = byId[e.to];
      if (!a || !b) return;
      const d = this.edgePath(a, b);
      parts.push(`<path class="cv-edge" d="${d}" data-e="${e.id}" marker-end="url(#cvArrow)"/>`);
      if (e.label) {
        const A = this.anchor(a, b.x + b.w / 2, b.y + b.h / 2);
        const B = this.anchor(b, a.x + a.w / 2, a.y + a.h / 2);
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        parts.push(`<text class="cv-elabel" x="${mx}" y="${my - 6}" text-anchor="middle">${this.esc(e.label)}</text>`);
      }
    });
    this.edgeG.innerHTML = parts.join('');
    // clique na aresta -> rotular / excluir
    this.edgeG.querySelectorAll('.cv-edge').forEach(p => {
      p.addEventListener('click', ev => {
        ev.stopPropagation();
        const e = this.board.edges.find(x => x.id === p.dataset.e);
        if (!e) return;
        const v = prompt('Rótulo da seta (vazio = remover a seta):', e.label || '');
        if (v === null) return;
        this.pushHistory();
        if (v.trim() === '' && e.label === '') this.board.edges = this.board.edges.filter(x => x.id !== e.id);
        else e.label = v.trim();
        this.drawEdges(); this.save();
      });
    });
    this.sizeSvg();
  }
  drawGhost() {
    if (!this.linking) return;
    const a = this.board.nodes.find(n => n.id === this.linking.from);
    if (!a) return;
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    this.ghost.setAttribute('d', `M ${ax} ${ay} L ${this.linking.x} ${this.linking.y}`);
  }
  sizeSvg() {
    const ns = this.board.nodes;
    const maxX = ns.length ? Math.max(...ns.map(n => n.x + n.w)) + 400 : 2000;
    const maxY = ns.length ? Math.max(...ns.map(n => n.y + n.h)) + 400 : 2000;
    const minX = ns.length ? Math.min(0, ...ns.map(n => n.x) ) - 400 : -400;
    const minY = ns.length ? Math.min(0, ...ns.map(n => n.y) ) - 400 : -400;
    this.svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    Object.assign(this.svg.style, {
      left: minX + 'px', top: minY + 'px',
      width: (maxX - minX) + 'px', height: (maxY - minY) + 'px'
    });
  }

  /* ─────────── Estatística de setup ─────────── */
  setupStats(setupId) {
    const opIds = this.board.edges
      .filter(e => e.from === setupId || e.to === setupId)
      .map(e => (e.from === setupId ? e.to : e.from));
    const nodes = this.board.nodes.filter(n => opIds.includes(n.id) && n.type === 'op');
    const ops = this.getOps();
    const linked = nodes.map(n => ops.find(o => o.id === n.opId)).filter(Boolean);
    const w = linked.filter(o => o.result === 'WIN').length;
    const l = linked.filter(o => o.result === 'LOSS').length;
    const g = linked.filter(o => o.result === 'WIN').reduce((a, o) => a + o.value * 0.8, 0);
    const p = linked.filter(o => o.result === 'LOSS').reduce((a, o) => a + o.value, 0);
    return { total: linked.length, wins: w, losses: l, wr: linked.length ? (w / linked.length) * 100 : 0, pf: p > 0 ? g / p : (g > 0 ? Infinity : 0) };
  }

  /* ─────────── Persistência ─────────── */
  save() { this.onDirty(); return boards.put(this.board); }
  saveDebounced() {
    clearTimeout(this._sv);
    this._sv = setTimeout(() => this.save(), 400);
  }
  async loadBoard(id) {
    const b = await boards.get(id);
    if (!b) return false;
    this.board = { view: { x: 0, y: 0, z: 1 }, nodes: [], edges: [], ...b };
    this.sel.clear(); this.history.length = 0; this.future.length = 0;
    await this.render();
    return true;
  }
  newBoard(name = 'Novo Quadro') {
    this.board = { id: uid(), name, nodes: [], edges: [], view: { x: 0, y: 0, z: 1 }, createdAt: Date.now() };
    this.sel.clear(); this.history.length = 0; this.future.length = 0;
    this.render(); this.save();
    return this.board;
  }

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
}
