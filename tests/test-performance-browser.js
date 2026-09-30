/* Optional real Chromium/Chart.js regression. No user backup or image is read.
   npm install --no-save --package-lock=false playwright
   npx playwright install chromium
   npm run test:performance:browser

   PERF_HTML=/path/to/old.html PERF_BASELINE=1 records a comparison without
   enforcing the new UI/performance contracts. PERF_OPS defaults to 5000.
   PERF_CHROMIUM_EXECUTABLE can select a system browser. PERF_SPARTICUZ=1
   optionally uses an externally installed @sparticuz/chromium on Linux. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const baseline = process.env.PERF_BASELINE === '1';
const count = Number(process.env.PERF_OPS || 5000);
assert.ok(Number.isSafeInteger(count) && count >= 30 && count <= 50000, 'PERF_OPS must be 30–50000');
const html = fs.readFileSync(process.env.PERF_HTML || path.join(ROOT, 'edgecontrol-glass-v2.html'), 'utf8');
const operations = Array.from({ length: count }, (_, i) => ({
  id: 'perf-' + i, date: '2026-09-' + String(1 + i % 28).padStart(2, '0'),
  time: String(9 + i % 8).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0'),
  asset: 'EUR/USD', type: 'EUR/USD', direction: 'CALL', result: i % 3 ? 'WIN' : 'LOSS',
  value: i % 3 ? 8 : 10, investment: 10, payout: 80, plan: i % 2 ? 'yes' : 'no',
  shots: [], img: '', reason: 'Synthetic performance fixture', extra: { preserved: i }
}));
const state = { profile: { name: 'Performance Test' }, _img_migrated: true,
  settings: { initialCapital: 10000, currentCapital: 10000 }, operations,
  charts: { auto: false }, cp: 'all' };
const avatar = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#4f46e5"/></svg>';
(async () => {
  const launch = { headless: true };
  if (process.env.PERF_CHROMIUM_EXECUTABLE) launch.executablePath = process.env.PERF_CHROMIUM_EXECUTABLE;
  if (process.env.PERF_SPARTICUZ === '1') {
    const module = require('@sparticuz/chromium'), runtime = module.default || module;
    launch.executablePath = await runtime.executablePath(); launch.args = runtime.args;
  }
  const browser = await chromium.launch(launch);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [], tickWarnings = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/would result generating|Limiting to 1000/.test(message.text())) tickWarnings.push(message.text());
      if (message.type() === 'warning' && /^(gráficos avançados:|slot )/.test(message.text())) errors.push(message.text());
    });
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript',
        body: fs.readFileSync(path.join(ROOT, '_arquivo/pwa-canvas/assets/chart.umd.min.js')) });
      if (url.hostname !== 'edgecontrol.test') return route.fulfill({
        contentType: url.hostname === 'ui-avatars.com' ? 'image/svg+xml' : 'text/css',
        body: url.hostname === 'ui-avatars.com' ? avatar : '' });
      if (url.pathname === '/edgecontrol-glass-v2.html') return route.fulfill({ contentType: 'text/html', body: html });
      const filename = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
      if (filename.startsWith(ROOT + path.sep) && url.pathname.startsWith('/ferramentas/') && fs.existsSync(filename)) {
        const contentType = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.json') ? 'application/json' : 'text/html';
        return route.fulfill({ contentType, body: fs.readFileSync(filename) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript(initial => {
      localStorage.setItem('ec7', JSON.stringify(initial));
      window.__longtasks = [];
      new PerformanceObserver(list => list.getEntries().forEach(e => window.__longtasks.push({ start: e.startTime, ms: e.duration })))
        .observe({ entryTypes: ['longtask'] });
    }, state);
    const bootStart = Date.now();
    await page.goto('https://edgecontrol.test/edgecontrol-glass-v2.html', { waitUntil: 'load' });
    const bootMs = Date.now() - bootStart;
    await page.waitForFunction(() => typeof Chart !== 'undefined' && Object.keys(Chart.instances).length === 3);
    assert.equal(await page.evaluate(() => Chart.version), '4.4.1', 'genuine pinned Chart.js is required');
    await page.waitForTimeout(400);
    const dataBefore = await page.evaluate(() => JSON.stringify(S.operations));
    const interactionStart = await page.evaluate(() => performance.now());
    const timed = async action => { const start = Date.now(); await action(); return Date.now() - start; };
    const slotMs = [];
    for (let i = 0; i < 8; i++) {
      slotMs.push(await timed(() => page.evaluate(() => slotStep())));
      await page.waitForTimeout(60);
    }
    const operationsMs = await timed(() => page.evaluate(() => nav('operations')));
    const rows = await page.locator('#opsTb > tr').count();
    if (!baseline) {
      assert.equal(rows, Math.min(100, count), 'bounded table DOM');
      assert.equal(await page.evaluate(() => Object.keys(Chart.instances).length), 0, 'hidden dashboard charts disposed');
      if (count > 100) {
        await page.locator('#opsPageNext').click();
        assert.equal(await page.locator('#opsTb tr td').first().textContent(), '101');
      } else assert.ok(await page.locator('#opsPageNext').isDisabled());
      await page.locator('#opsPageSize').selectOption('50');
      assert.equal(await page.locator('#opsTb > tr').count(), Math.min(50, count));
      await page.locator('#fRes').selectOption('LOSS'); await page.evaluate(() => applyFilter());
      assert.equal(await page.evaluate(() => ecxOpsFiltradas().length), Math.ceil(count / 3));
      await page.evaluate(() => clearFilter());
    }
    const analyticsMs = await timed(() => page.evaluate(() => nav('analytics')));
    if (!baseline) {
      await page.waitForFunction(() => !!CH.anDD && !!CH.anROLL && !!CH.anBUCK);
      assert.ok(await page.evaluate(() => CH.anDD.data.datasets[0].data.length <= 600));
      assert.ok(await page.evaluate(() => CH.anROLL.data.datasets.every(d => d.data.length <= 600)));
    }
    const returnMs = await timed(() => page.evaluate(() => nav('dashboard')));
    await page.waitForTimeout(100);
    const chartCount = await page.evaluate(() => Object.keys(Chart.instances).length);
    const interactionTasks = await page.evaluate(start => __longtasks.filter(t => t.start >= start), interactionStart);
    if (!baseline) {
      assert.equal(chartCount, 3, 'only visible charts retained');
      assert.equal(await page.evaluate(() => JSON.stringify(S.operations)), dataBefore, 'no operation altered by rendering');
      const indices = await page.evaluate(() => CH.gc_cap.data.datasets[0].data.map(p => p.x));
      assert.ok(indices.length <= 600); assert.equal(indices[0], 0); assert.equal(indices.at(-1), count);
      const lastTitle = await page.evaluate(() => {
        const chart = CH.gc_cap, index = chart.data.datasets[0].data.length - 1;
        chart.tooltip.setActiveElements([{ datasetIndex: 0, index }], { x: 0, y: 0 });
        return chart.tooltip.title[0];
      });
      assert.equal(lastTitle, 'Op ' + count, 'tooltip keeps the original operation index');

      // Switch away before deferred Analytics runs: cancelled work cannot resurrect a chart.
      await page.evaluate(() => { nav('analytics'); nav('dashboard'); });
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => Object.keys(Chart.instances).length), 3);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => Object.values(Chart.instances).every(c => c.width > 0 && c.height > 0)));
      const budget = Number(process.env.PERF_MAX_SLOT_MS || 350);
      assert.ok(Math.max(...slotMs) < budget, 'slot work exceeded ' + budget + ' ms: ' + slotMs.join(', '));
      assert.ok(operationsMs < budget, 'Operations navigation exceeded ' + budget + ' ms');
      assert.equal(tickWarnings.length, 0, 'no explosive integer tick generation');
      assert.ok(!requests.some(url => /cdn\.jsdelivr\.net|ui-avatars\.com/.test(url)), 'charts and default avatars must not require a remote service');
      assert.deepEqual(errors, [], 'no runtime error, including after deferred rendering/navigation/resize');
    }
    if (process.env.PERF_SCREENSHOT) await page.screenshot({ path: process.env.PERF_SCREENSHOT, animations: 'disabled' });
    const result = { baseline, operations: count, chartVersion: '4.4.1', bootMs, slotMs,
      operationsMs, analyticsMs, returnMs, tableRows: rows, retainedCharts: chartCount,
      interactionLongTasks: interactionTasks, tickWarnings: tickWarnings.length, errors };
    console.log(JSON.stringify(result, null, 2));
    console.log(baseline ? 'Baseline recorded.' : '🎉 CHROMIUM OK — real Chart.js, desktop/mobile and lifecycle checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
