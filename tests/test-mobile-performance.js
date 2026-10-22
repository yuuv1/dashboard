const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'edgecontrol-glass-v2.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(root, '_public', 'index.html'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'supabase', 'app-sync.js'), 'utf8');
const pages = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');

assert.equal(publicHtml, html, '_public/index.html stays synced with edgecontrol-glass-v2.html');

assert.match(html, /@media \(max-width:820px\)[\s\S]*?#sidebar\{position:absolute;[\s\S]*?bottom:/, 'mobile navigation is fixed to the bottom safe area');
assert.match(html, /nav-label-short[^}]*display:none/, 'short mobile navigation labels are hidden on desktop by default');
assert.match(html, /#bg::before,#bg::after,#bg \.sph,#bg \.glow\{display:none!important/, 'mobile turns off expensive animated background layers');
assert.match(html, /\.gl,#hdr,\.ov,\.ov\.acc,[\s\S]*?#psRoot[\s\S]*?backdrop-filter:none!important/, 'mobile disables backdrop-filter on hero cards (.ov) and viewer overlays');
assert.match(html, /\.metal\{filter:none!important;will-change:auto!important;background-size:100% 100%!important;\}[\s\S]*?\.metal::after\{display:none!important;\}/, 'mobile disables expensive drop-shadow and blend layers on metallic amounts');
assert.match(html, /function applyBg\(\)[\s\S]*?isCompactViewport\(\)[\s\S]*?--bg-img','none'/, 'mobile skips decoding large inline background textures');
assert.match(html, /function configureMobileCharts\(\)[\s\S]*?Chart\.defaults\.animation=false[\s\S]*?devicePixelRatio=Math\.min/, 'mobile charts disable animation and cap canvas pixel ratio');
assert.match(html, /function slotStart\(\)[\s\S]*?isCompactViewport\(\)/, 'mobile pauses automatic chart reconstruction');
assert.match(html, /let opsRenderLimit=80[\s\S]*?opsLoadMore/, 'mobile operations table renders in batches');
assert.match(html, /function mobileOpRow\([\s\S]*?op-mobile-card[\s\S]*?opShotsPreviewHTML\(op\)[\s\S]*?Detalhes[\s\S]*?Editar/, 'mobile operations use readable cards with inline photo previews and direct actions');
assert.match(html, /function yieldFirstPaint\([\s\S]*?requestAnimationFrame[\s\S]*?async function init\([\s\S]*?updateDash\(\)[\s\S]*?await yieldFirstPaint\(\)[\s\S]*?ensureShotMaintenance\(\)/, 'startup paints local dashboard before print migration');
assert.match(html, /async function reconcileShots\([\s\S]*?IMGDB\.keys\(\)[\s\S]*?IMGDB\.get\(/, 'print reconciliation reads only unlinked records');
assert.match(html, /async function openGallery\(\)[\s\S]*?ensureShotMaintenance\(\)/, 'opening print gallery waits for background migration to preserve legacy prints');
assert.match(html, /function slotRenderAll\([\s\S]*?IntersectionObserver/, 'off-screen charts are deferred on compact screens');
assert.match(html, /renderRec\(ops,chrono\);chartsRefresh\(\);badge\(\);renderTicker\(chrono\)/, 'dashboard reuses its chronological sort for the ticker');
assert.match(html, /if\(mobile\) return;\s*\/\/ tira o marquee/, 'mobile ticker avoids forced reflow and continuous marquee');
assert.match(sync, /mobile \? 180000 : 60000/, 'mobile sync polling is less frequent');
assert.match(sync, /const stateChanged = stable\(mergedState\) !== stable\(localState\)/, 'unchanged cloud sync does not rerender the dashboard');
assert.match(sync, /const cachedValid = !!\(priorHash && metadataMatches && hasSource\)/, 'unchanged prints reuse cached hashes');
assert.doesNotMatch(html, /<script[^>]+src="\.\/vendor\/chart\.umd\.min\.js"/, 'Chart.js is not a blocking startup script');
assert.match(html, /function ensureChartLibrary\([\s\S]*?script\.src='\.\/vendor\/chart\.umd\.min\.js'[\s\S]*?function scheduleChartLoad\([\s\S]*?requestIdleCallback/, 'Chart.js loads locally only after the first screen is ready');
assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/chart\.js/, 'no external Chart.js dependency remains');
assert.match(pages, /cp vendor\/chart\.umd\.min\.js vendor\/chartjs-LICENSE\.txt/, 'Pages deploy includes local Chart.js and its license');

/* Mobile legibility checks: no tiny 8px-10px text on core mobile rules */
const mobileBlockMatch = html.match(/@media \(max-width:820px\)\{([\s\S]*?)\}\n@media \(max-width:540px\)/);
assert.ok(mobileBlockMatch, 'mobile @media (max-width:820px) block exists');
const mobileCss = mobileBlockMatch[1];
assert.match(mobileCss, /\.nav-item\{[^}]*font-size:11\.5px/, 'mobile bottom nav labels are legible (>=11.5px)');
assert.match(mobileCss, /\.op-mobile-title\{font-size:15px/, 'mobile operation titles are legible');
assert.match(mobileCss, /\.op-mobile-date\{font-size:12\.5px/, 'mobile operation dates are legible');
assert.match(mobileCss, /\.op-mobile-tags>span\{[^}]*font-size:12\.5px/, 'mobile operation tags are legible');
assert.match(mobileCss, /\.op-mobile-reason\{[^}]*font-size:13\.5px/, 'mobile operation reasons are legible');
assert.match(mobileCss, /\.shot-item \.sb\{opacity:1/, 'shot badges are visible on touch devices without hover');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function makePngDataUrl(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3, 40); row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

(async () => {
  const dom = new JSDOM(html, {
    url: 'https://edgecontrol.local/edgecontrol-glass-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.indexedDB = new IDBFactory();
      w.innerWidth = 390;
      w.innerHeight = 844;
      w.matchMedia = q => ({
        matches: /max-width:\s*820px/.test(q) || /max-width:\s*680px/.test(q),
        media: q,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {}
      });
      w.requestIdleCallback = cb => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
      w.alert = () => {};
      w.confirm = () => true;
      w.scrollTo = () => {};
      w.URL.createObjectURL = () => 'blob:mock';
      w.URL.revokeObjectURL = () => {};

      class FakeImg {
        constructor() { this.naturalWidth = 1200; this.naturalHeight = 800; this.width = 1200; this.height = 800; }
        set src(v) {
          this._src = v;
          if (typeof v === 'string' && v.startsWith('data:image/png;base64,')) {
            const b = Buffer.from(v.slice('data:image/png;base64,'.length), 'base64');
            if (b.length > 24) {
              this.naturalWidth = this.width = b.readUInt32BE(16);
              this.naturalHeight = this.height = b.readUInt32BE(20);
            }
          }
          setTimeout(() => { if (this.onload) this.onload(); }, 0);
        }
        get src() { return this._src || ''; }
      }
      w.Image = FakeImg;
      w.HTMLCanvasElement.prototype.getContext = function () {
        return {
          canvas: this, save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage() {},
          beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {},
          rect() {}, fillRect() {}, strokeRect() {}, fill() {}, stroke() {}, setLineDash() {},
          fillText() {}, strokeText() {}, measureText: t => ({ width: String(t || '').length * 8 })
        };
      };
      w.HTMLCanvasElement.prototype.toDataURL = function (type) {
        const cw = Math.max(1, this.width | 0), ch = Math.max(1, this.height | 0);
        return `data:${type || 'image/jpeg'};base64,THUMB_${cw}x${ch}`;
      };
    }
  });

  const w = dom.window;
  await new Promise(r => setTimeout(r, 80));

  /* 1. Compact viewport disables --bg-img texture */
  assert.equal(w.document.documentElement.style.getPropertyValue('--bg-img'), 'none', 'compact viewport keeps --bg-img set to none');

  /* 2. Large un-annotated prints are downscaled in psThumbURL while full export stays intact */
  const bigDataUrl = makePngDataUrl(1200, 800);
  await w.eval(`(async () => {
    await IMGDB.put({ id: 's_mob_1', dataUrl: ${JSON.stringify(bigDataUrl)}, w: 1200, h: 800, size: 95000, name: 'entrada.png', note: 'Rompimento VWAP', opId: 'op_mob_1', at: '2026-10-22T13:10:00Z', marks: [], crop: null });
    await IMGDB.put({ id: 's_mob_2', dataUrl: ${JSON.stringify(bigDataUrl)}, w: 1200, h: 800, size: 91000, name: 'saida.png', note: 'Alvo 2R', opId: 'op_mob_1', at: '2026-10-22T13:25:00Z', marks: [], crop: null });
    S.operations = [{
      id: 'op_mob_1', date: '2026-10-22', time: '10:15', value: 250, usd: 45, result: 'WIN',
      asset: 'WINFUT', direction: 'COMPRA', reason: 'Pullback limpo na média', plan: 'yes', shots: ['s_mob_1', 's_mob_2']
    }];
    updateDash();
    renderOps();
  })()`);
  await new Promise(r => setTimeout(r, 50));

  const thumbUrl = await w.eval(`psThumbURL('s_mob_1')`);
  assert.equal(thumbUrl, 'data:image/jpeg;base64,THUMB_360x240', 'psThumbURL downscales 1200x800 print to 360x240 JPEG thumbnail');
  const fullUrl = await w.eval(`psShotURL('s_mob_1', 1600)`);
  assert.equal(fullUrl, bigDataUrl, 'psShotURL(id, 1600) preserves full resolution image when un-annotated');

  /* 3. Dashboard recent ops no longer appends ellipsis to short reasons and exposes 1-tap print button */
  const recBot = w.document.querySelector('#recOps .ri-bot');
  assert.equal(recBot.textContent, 'Pullback limpo na média', 'short reason is not truncated with ellipsis');
  assert.ok(w.document.querySelector('#recOps .ri-shot'), 'recent ops item shows 1-tap print shortcut');

  /* 4. Mobile operation card shows inline WhatsApp-style photo tiles */
  const tiles = w.document.querySelectorAll('#opsTb .op-mobile-shots .op-shot-tile');
  assert.equal(tiles.length, 2, 'mobile operation card renders 2 inline photo preview tiles');

  /* 5. Opening operation print launches WhatsApp Clean Viewer Mode with swipe & annotate transition */
  w.document.getElementById('psStage').getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844 });
  await w.eval(`openOpShot('op_mob_1', 0)`);
  await new Promise(r => setTimeout(r, 40));

  const psRoot = w.document.getElementById('psRoot');
  assert.ok(psRoot.classList.contains('show'), '#psRoot opens');
  assert.ok(psRoot.classList.contains('ps-wa-mode'), 'opens in WhatsApp clean mode on mobile');
  assert.match(w.document.getElementById('psWaTitle').textContent, /WINFUT · WIN · \+R\$\s*250,00/, 'WhatsApp top bar shows asset, result and amount');
  assert.match(w.document.getElementById('psWaSub').textContent, /1 de 2/, 'WhatsApp top bar shows print counter');
  assert.match(w.document.getElementById('psWaCaption').textContent, /Rompimento VWAP/, 'WhatsApp bottom bar shows print note');

  /* Horizontal swipe left advances to print 2 of 2 */
  const stage = w.document.getElementById('psStage');
  const ptr = (type, x, y) => {
    const ev = new w.Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'touch' });
    stage.dispatchEvent(ev);
  };
  ptr('pointerdown', 280, 400);
  ptr('pointermove', 160, 404);
  ptr('pointerup', 160, 404);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(await w.eval('PS.idx'), 1, 'horizontal swipe left navigates to next print');
  assert.match(w.document.getElementById('psWaSub').textContent, /2 de 2/, 'counter updates to 2 de 2');

  /* Tapping Annotate button switches seamlessly from WhatsApp mode to Studio mode */
  w.document.getElementById('psWaAnnotate').click();
  assert.equal(psRoot.classList.contains('ps-wa-mode'), false, 'tapping Anotar unlocks full Studio toolbar');

  /* Switching back to WhatsApp mode and swiping down closes viewer */
  w.document.getElementById('psWaToggle').click();
  assert.equal(psRoot.classList.contains('ps-wa-mode'), true, 'Modo limpo toggle returns to WhatsApp mode');
  ptr('pointerdown', 195, 220);
  ptr('pointermove', 198, 360);
  ptr('pointerup', 198, 360);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(psRoot.classList.contains('show'), false, 'vertical swipe down dismisses the viewer');

  dom.window.close();
  console.log('✅ Mobile UX/performance: bottom navigation, low-power rendering, legible typography, downscaled thumbnails and WhatsApp viewer');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
