const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'edgecontrol-glass-v2.html'), 'utf8');
const inlineWorker = appHtml.match(/const SW_SRC=`([\s\S]*?)`;\n\n\/\* Baixa o sw\.js/);
assert.ok(inlineWorker, 'PWA app must contain its downloadable service worker source');
assert.equal(inlineWorker[1].trim(), source.trim(), 'downloaded service worker stays in sync with sw.js');
const ORIGIN = 'https://edgecontrol.example';

function makeWorker({ fetchImpl, seeded = {}, putFails = false } = {}) {
  const handlers = {};
  const store = new Map(Object.entries(seeded));
  const writes = [];
  const cache = {
    async put(req, response) {
      writes.push(req.url || req);
      if (putFails) throw new Error('storage full');
      store.set(req.url || req, response);
    },
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      return store.get(key) || null;
    }
  };
  const context = {
    self: {
      location: { origin: ORIGIN, href: ORIGIN + '/sw.js' },
      clients: { claim: async () => {} },
      skipWaiting: () => {},
      addEventListener: (type, fn) => { handlers[type] = fn; }
    },
    caches: { open: async () => cache },
    fetch: fetchImpl || (async () => new Response('network', { status: 200 })),
    URL,
    Response,
    console
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  return { handlers, store, writes };
}

const request = (url, method = 'GET', mode = 'cors') => ({ url, method, mode });

async function dispatch(worker, req) {
  let responsePromise;
  worker.handlers.fetch({ request: req, respondWith: p => { responsePromise = Promise.resolve(p); } });
  assert.ok(responsePromise, 'GET request should be intercepted');
  return responsePromise;
}

(async () => {
  {
    const w = makeWorker();
    const response = await dispatch(w, request(ORIGIN + '/app.html'));
    assert.equal(await response.text(), 'network');
    assert.deepEqual(w.writes, [ORIGIN + '/app.html'], 'successful same-origin response is cached');
  }
  {
    const cached = new Response('cached app');
    const w = makeWorker({
      seeded: { [ORIGIN + '/app.html']: cached },
      fetchImpl: async () => { throw new Error('offline'); }
    });
    const response = await dispatch(w, request(ORIGIN + '/app.html'));
    assert.equal(await response.text(), 'cached app', 'offline uses an exact cached resource');
  }
  {
    const w = makeWorker({
      seeded: { './': new Response('app shell') },
      fetchImpl: async () => { throw new Error('offline'); }
    });
    const response = await dispatch(w, request(ORIGIN + '/deep-link', 'GET', 'navigate'));
    assert.equal(await response.text(), 'app shell', 'navigation may fall back to the app shell');
  }
  {
    const w = makeWorker({
      seeded: { './': new Response('<html>must not be returned as JS</html>') },
      fetchImpl: async () => { throw new Error('offline'); }
    });
    const response = await dispatch(w, request(ORIGIN + '/missing.js'));
    assert.equal(response.status, 503, 'missing assets do not receive the HTML app shell');
    assert.equal(await response.text(), 'Offline');
  }
  {
    const w = makeWorker({ fetchImpl: async () => { throw new Error('offline'); } });
    await assert.rejects(
      dispatch(w, request('https://cdn.example/font.woff2')),
      /offline/,
      'cross-origin failures stay network failures'
    );
    assert.equal(w.writes.length, 0);
  }
  {
    const w = makeWorker({ putFails: true });
    const response = await dispatch(w, request(ORIGIN + '/app.html'));
    assert.equal(await response.text(), 'network', 'cache write failure does not break online response');
  }
  {
    const w = makeWorker();
    let intercepted = false;
    w.handlers.fetch({ request: request(ORIGIN + '/submit', 'POST'), respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, 'non-GET requests bypass the cache strategy');
  }
  console.log('✅ Service worker: cacheamento, fallback offline e requests externos');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
