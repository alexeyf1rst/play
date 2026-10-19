'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function eventTarget(extra = {}) {
  const handlers = new Map();
  return Object.assign({
    addEventListener(type, handler) {
      const list = handlers.get(type) || [];
      list.push(handler);
      handlers.set(type, list);
    },
    dispatch(type, options = {}) {
      const pending = [];
      let response;
      const event = Object.assign({
        type,
        waitUntil(value) { pending.push(Promise.resolve(value)); },
        respondWith(value) {
          assert.equal(response, undefined, 'a fetch may be handled only once');
          response = Promise.resolve(value);
        },
        preventDefault() { this.defaultPrevented = true; }
      }, options);
      for (const handler of [...(handlers.get(type) || [])]) handler(event);
      return {
        event,
        handled: response !== undefined,
        response,
        settled: Promise.all(pending)
      };
    }
  }, extra);
}

function response(body, { ok = true, type = 'basic' } = {}) {
  return {
    ok, type,
    async text() { return body; },
    clone() { return response(body, { ok, type }); }
  };
}

function createWorker(scope = 'https://quiet.test/quiet-hills/') {
  const stores = new Map();
  const observed = { requested: [], network: [], put: [], deleted: [], skips: 0, claims: 0 };
  let online = false;
  let networkResponse = response('network asset');
  const keyOf = request => typeof request === 'string' ? request : request.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const files = stores.get(name);
      return {
        async addAll(requests) {
          for (const request of requests) {
            observed.requested.push(request);
            files.set(keyOf(request), response('cached ' + keyOf(request)));
          }
        },
        async match(request) { return files.get(keyOf(request)); },
        async put(request, value) {
          observed.put.push(keyOf(request));
          files.set(keyOf(request), value);
        }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { observed.deleted.push(name); return stores.delete(name); }
  };
  const self = eventTarget({
    registration: { scope },
    location: { origin: new URL(scope).origin },
    clients: { async claim() { observed.claims++; } },
    skipWaiting() { observed.skips++; }
  });
  const context = vm.createContext({
    self, caches, Request, URL, console,
    async fetch(request) {
      observed.network.push(keyOf(request));
      if (!online) throw new Error('network unavailable');
      return networkResponse;
    }
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), context, { filename: 'sw.js' });
  return {
    self, stores, observed, scope,
    setOnline(value, nextResponse) { online = value; if (nextResponse) networkResponse = nextResponse; },
    fetch(url, method = 'GET') {
      return self.dispatch('fetch', { request: new Request(new URL(url, scope), { method }) });
    }
  };
}

test('install precaches existing files and every runtime dependency needed by index.html', async () => {
  const env = createWorker();
  await env.self.dispatch('install').settled;
  assert.ok(env.observed.requested.length > 0, 'install must prepare a usable offline shell');
  const shell = new Set(env.observed.requested.map(request => request.url));
  for (const request of env.observed.requested) {
    const url = new URL(request.url);
    assert.equal(url.origin, new URL(env.scope).origin);
    assert.ok(url.href.startsWith(env.scope), 'cache entry must stay inside its registration scope');
    const relative = decodeURIComponent(url.pathname.slice(new URL(env.scope).pathname.length)) || 'index.html';
    const absolute = path.resolve(ROOT, relative);
    assert.ok(absolute.startsWith(ROOT + path.sep), 'cache entry must stay inside the project');
    assert.ok(fs.existsSync(absolute) && fs.statSync(absolute).isFile(), relative + ' must exist before install can succeed');
    assert.equal(request.cache, 'reload', 'a new shell must not silently reuse the previous HTTP version');
  }

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) || []) {
    const match = tag.match(/\b(?:src|href)=["']([^"']+)["']/i);
    if (!match || /^(?:data:|https?:|#)/.test(match[1])) continue;
    if (/^<link/i.test(tag) && !/\brel=["'](?:stylesheet|manifest|apple-touch-icon)["']/i.test(tag)) continue;
    assert.ok(shell.has(new URL(match[1], env.scope).href), 'offline shell must include runtime dependency ' + match[1]);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons || []) {
    assert.ok(shell.has(new URL(icon.src, env.scope).href), 'install icon must work offline: ' + icon.src);
  }
  assert.equal(env.observed.skips, 0, 'install must leave updates waiting for explicit user consent');
});

test('offline GET shell requests hit the versioned cache at root and at a scoped deployment', async () => {
  for (const scope of ['https://quiet.test/', 'https://quiet.test/quiet-hills/']) {
    const env = createWorker(scope);
    await env.self.dispatch('install').settled;
    for (const target of ['./', './index.html', './index.html?source=share', './js/main.js', './css/style.css']) {
      const result = env.fetch(target);
      assert.equal(result.handled, true, target + ' should have an offline response');
      const body = await (await result.response).text();
      const expected = new URL(target, scope);
      expected.search = '';
      expected.hash = '';
      assert.equal(body, 'cached ' + expected.href);
    }
    assert.deepEqual(env.observed.network, [], 'cached shell launches with no network dependency');
  }
});

test('worker leaves cross-origin, non-GET and unrelated requests to the browser', async () => {
  const env = createWorker();
  await env.self.dispatch('install').settled;
  for (const [url, method] of [
    ['https://third.test/js/main.js', 'GET'],
    ['./index.html', 'POST'],
    ['./js/main.js', 'HEAD'],
    ['./api/progress', 'GET'],
    ['./private.json', 'GET'],
    ['./js/unrelated.js', 'GET'],
    ['https://quiet.test/shots/outside-scope.png', 'GET']
  ]) {
    const result = env.fetch(url, method);
    assert.equal(result.handled, false, method + ' ' + url + ' must not be intercepted');
  }
  assert.deepEqual(env.observed.network, []);
  assert.deepEqual(env.observed.put, []);
});

test('only successful same-origin informational images are cached on demand', async () => {
  const env = createWorker();
  await env.self.dispatch('install').settled;
  env.setOnline(true, response('picture'));
  const first = env.fetch('./shots/hills.png');
  assert.equal(await (await first.response).text(), 'picture');
  assert.equal(env.observed.put.length, 1);
  env.setOnline(false);
  assert.equal(await (await env.fetch('./shots/hills.png').response).text(), 'picture');
  assert.equal(env.observed.network.length, 1, 'second image load must be fulfilled from cache');

  env.setOnline(true, response('not found', { ok: false }));
  await env.fetch('./shots/missing.png').response;
  env.setOnline(true, response('opaque', { type: 'opaque' }));
  await env.fetch('./shots/opaque.png').response;
  assert.equal(env.observed.put.length, 1, 'errors and opaque responses must not poison the offline copy');
});

test('worker activates an update only for the explicit message and cleans only its own previous shell', async () => {
  const env = createWorker();
  env.stores.set('quiet-hills-shell-old', new Map());
  env.stores.set('another-app-cache', new Map());
  await env.self.dispatch('install').settled;
  env.self.dispatch('message', { data: null });
  env.self.dispatch('message', { data: { type: 'UPDATE_FOUND' } });
  assert.equal(env.observed.skips, 0);
  env.self.dispatch('message', { data: { type: 'ACTIVATE_UPDATE' } });
  assert.equal(env.observed.skips, 1);
  await env.self.dispatch('activate').settled;
  assert.deepEqual(env.observed.deleted, ['quiet-hills-shell-old']);
  assert.ok(env.stores.has('another-app-cache'));
  assert.equal(env.observed.claims, 1);
});

async function createPWA() {
  const observed = { events: [], posts: [], toasts: [], saves: 0, reloads: 0 };
  const nodes = {
    status: eventTarget({ textContent: '' }),
    update: eventTarget({ hidden: true, disabled: false }),
    install: eventTarget({ hidden: true })
  };
  const waiting = eventTarget({
    postMessage(message) {
      observed.events.push('activate');
      observed.posts.push(JSON.parse(JSON.stringify(message)));
    }
  });
  const registration = eventTarget({ active: {}, waiting, installing: null });
  const worker = eventTarget({
    register: async () => registration,
    ready: Promise.resolve(registration)
  });
  const window = eventTarget({
    HC: {
      Game: { scene: 'base', state: { coins: 123 } },
      save() { observed.events.push('save'); observed.saves++; return true; },
      UI: { toast(message) { observed.toasts.push(message); } }
    }
  });
  const document = {
    querySelectorAll(selector) {
      return {
        '[data-pwa-status]': [nodes.status],
        '[data-pwa-update]': [nodes.update],
        '[data-pwa-install]': [nodes.install]
      }[selector] || [];
    }
  };
  const location = {
    protocol: 'https:',
    reload() { observed.events.push('reload'); observed.reloads++; }
  };
  const context = vm.createContext({
    window, document, navigator: { serviceWorker: worker, onLine: true }, location, console
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/pwa.js'), 'utf8'), context, { filename: 'js/pwa.js' });
  window.dispatch('load');
  await Promise.resolve();
  await Promise.resolve();
  const HC = window.HC;
  HC.PWA.bindSettings({
    querySelector(selector) {
      return selector === '[data-pwa-update]' ? nodes.update :
        selector === '[data-pwa-install]' ? nodes.install : null;
    }
  });
  return { observed, nodes, registration, worker, window, HC };
}

test('finding or controlling a new worker never reloads the game before the player requests it', async () => {
  const env = await createPWA();
  assert.equal(env.nodes.update.hidden, false, 'a waiting version is offered to the player');
  const installing = eventTarget({ state: 'installed' });
  env.registration.installing = installing;
  env.registration.dispatch('updatefound');
  installing.dispatch('statechange');
  env.worker.dispatch('controllerchange');
  assert.deepEqual(env.observed.posts, []);
  assert.equal(env.observed.saves, 0);
  assert.equal(env.observed.reloads, 0);

  env.nodes.update.dispatch('click');
  assert.deepEqual(env.observed.events, ['save', 'activate'], 'durable save must precede worker activation');
  assert.deepEqual(env.observed.posts, [{ type: 'ACTIVATE_UPDATE' }]);
  assert.equal(env.observed.reloads, 0, 'wait for activation before reloading');
  assert.equal(env.nodes.update.disabled, true);
  env.nodes.update.dispatch('click');
  assert.equal(env.observed.posts.length, 1, 'double clicking must not request another update');
  env.worker.dispatch('controllerchange');
  assert.deepEqual(env.observed.events, ['save', 'activate', 'reload']);
});

test('update cannot interrupt a ride or discard progress after a failed save', async () => {
  const env = await createPWA();
  env.HC.Game.scene = 'ride';
  env.nodes.update.dispatch('click');
  assert.equal(env.observed.saves, 0);
  assert.deepEqual(env.observed.posts, []);
  assert.ok(env.observed.toasts.length > 0, 'explain why the player should finish the ride');

  env.HC.Game.scene = 'base';
  env.HC.save = () => { env.observed.saves++; return false; };
  env.nodes.update.dispatch('click');
  env.worker.dispatch('controllerchange');
  assert.equal(env.observed.saves, 1);
  assert.deepEqual(env.observed.posts, []);
  assert.equal(env.observed.reloads, 0);
  assert.equal(env.nodes.update.disabled, false, 'a failed save must leave recovery possible');
});
