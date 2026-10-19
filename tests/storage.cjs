const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const saveKey = 'quiet-hills/save/v1';

function harness(shared = new Map()) {
  const flags = { readDenied: false, writeDenied: false, backupDenied: false, primaryDenied: false, readers: 0 };
  const events = {};
  const clock = { time: 1800000000000 };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.time])); }
    static now() { return clock.time; }
  }
  const localStorage = {
    get length() { return shared.size; },
    key(index) { return [...shared.keys()][index] ?? null; },
    getItem(key) { if (flags.readDenied) throw Error('Read denied'); return shared.get(key) ?? null; },
    setItem(key, value) {
      if (flags.writeDenied || (flags.backupDenied && key.endsWith('/backup')) || (flags.primaryDenied && key === saveKey)) {
        throw Error('Quota exceeded');
      }
      shared.set(key, String(value));
    },
    removeItem(key) { shared.delete(key); }
  };
  const context = {
    console: { warn() {} }, Date: ClockDate, TextEncoder, TextDecoder, Uint8Array, btoa, atob, Promise,
    setTimeout, clearTimeout,
    FileReader: class {
      constructor() { flags.readers++; }
      readAsText(file) { this.result = file.text; this.onload(); }
    },
    window: {
      HC: {}, localStorage, sessionStorage: { removeItem() {} },
      addEventListener(name, fn) { (events[name] ||= []).push(fn); }
    }
  };
  vm.createContext(context);
  for (const file of ['data', 'storage', 'quests', 'base']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), context, { filename: file + '.js' });
  }
  return { HC: context.window.HC, flags, shared, clock,
    fire(name, event) { for (const fn of events[name] || []) fn(event); } };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('current JSON/code saves keep vehicles, construction, quests and extension fields', () => {
  const { HC } = harness();
  const state = HC.defaultState();
  HC.Quests.ensure(state);
  state.coins = 54321;
  state.ore = 17;
  state.owned.truck = true;
  state.vehicle = 'truck';
  state.up.truck = { engine: 3, tires: 4, susp: 2, fuel: 1 };
  state.stats.best.hills = 360;
  state.stats.history = [{ track: 'hills', distance: 360, coins: 30 }];
  state.achievements = { firstRide: { at: 1000 } };
  state.settings.diff = 'easy';
  state.settings.diffPicked = true;
  state.settings.theme = 'dark';
  state.settings.themePicked = true;
  state.base.plots[0] = { type: 'mine', level: 1, build: { to: 2, span: 300, end: Date.now() + 1000 } };
  const imported = HC.importCode(HC.exportCode(state));
  assert.equal(imported.coins, state.coins);
  assert.equal(imported.vehicle, 'truck');
  assert.deepEqual(plain(imported.up.truck), plain(state.up.truck));
  assert.deepEqual(plain(imported.stats.history), state.stats.history);
  assert.deepEqual(plain(imported.achievements), state.achievements);
  assert.deepEqual(plain(imported.quests), plain(state.quests));
  assert.equal(imported.base.plots[0].build.to, 2);
  assert.equal(imported.settings.diff, 'easy');
  assert.equal(imported.settings.theme, 'dark');
});

test('new starting coins do not force hard difficulty; legacy played saves retain hard economy', () => {
  const { HC } = harness();
  HC.ECON.startCoins = 200;
  const fresh = HC.importCode(JSON.stringify(HC.defaultState()));
  assert.equal(fresh.settings.diff, 'normal');
  assert.equal(fresh.settings.diffPicked, false);
  const legacy = HC.defaultState();
  delete legacy.settings.diff;
  delete legacy.settings.diffPicked;
  legacy.stats.runs = 1;
  const imported = HC.importCode(JSON.stringify(legacy));
  assert.equal(imported.settings.diff, 'hard');
  assert.equal(imported.settings.diffPicked, true);
});

test('unrelated JSON, primitive roots and unsupported versions cannot replace progress', () => {
  const { HC } = harness();
  for (const input of ['{}', '{"v":1}', '{"hello":"world"}', '[]', 'null', '1', 'true', '"hello"']) {
    assert.throws(() => HC.importCode(input), /Не похоже/, input);
  }
  const future = HC.defaultState();
  future.v = 100;
  assert.throws(() => HC.importCode(JSON.stringify(future)), /Не похоже/);
});

test('corrupt nested types, invalid enums and non-finite numbers are repaired safely', () => {
  const { HC } = harness();
  for (const invalid of [null, true, 7, 'oops', []]) {
    const state = HC.defaultState();
    for (const key of ['owned', 'tracks', 'up', 'base', 'stats', 'settings', 'quests']) state[key] = invalid;
    state.vehicle = 'constructor';
    state.track = '__proto__';
    const imported = HC.importCode(JSON.stringify(state));
    assert.equal(imported.vehicle, 'jeep');
    assert.equal(imported.track, 'hills');
    assert.equal(imported.base.plots.length, HC.PLOTS.spots.length);
    assert.doesNotThrow(() => { HC.Quests.ensure(imported); HC.Quests.ready(imported); HC.Economy.rates(imported); });
  }
  const state = HC.defaultState();
  state.stats.runs = -10;
  state.stats.best = { hills: -123, constructor: 500 };
  state.up.jeep.engine = 1.8;
  state.settings.musicVol = 1e308;
  state.settings.sfxVol = -2;
  state.settings.diff = 'constructor';
  const imported = HC.importCode(JSON.stringify(state).replace('"coins":0', '"coins":1e309'));
  assert.equal(imported.coins, 0);
  assert.equal(imported.stats.runs, 0);
  assert.equal(imported.stats.best.hills, 0);
  assert.equal(imported.up.jeep.engine, 1);
  assert.equal(imported.settings.musicVol, 1);
  assert.equal(imported.settings.sfxVol, 0);
  assert.equal(imported.settings.diff, 'normal');
});

test('imported malformed quests and raw HTML tracks never reach quest text/rendering', () => {
  const { HC } = harness();
  const state = HC.defaultState();
  HC.Quests.ensure(state);
  state.quests.daily.list = [null, { t: 'constructor', n: 1 },
    { t: 'track_dist', track: '<img src=x onerror=alert(1)>', n: 100, p: 0, rc: 1, ro: 0 }];
  const imported = HC.importCode(JSON.stringify(state));
  HC.Quests.ensure(imported);
  assert.doesNotThrow(() => HC.Quests.ready(imported));
  for (const group of Object.values(imported.quests)) {
    for (const quest of group.list) {
      assert.ok(Object.hasOwn(HC.QUEST_KINDS, quest.t));
      assert.doesNotMatch(HC.Quests.text(quest), /<|onerror/);
    }
  }
});

test('prototype keys are discarded while safe extension fields survive', () => {
  const { HC } = harness();
  const state = JSON.parse(JSON.stringify(HC.defaultState()));
  state.stats.history = [{ track: 'hills', distance: 123 }];
  const raw = JSON.stringify(state).replace('"stats":{', '"stats":{"__proto__":{"polluted":true},"constructor":{"x":1},');
  const imported = HC.importCode(raw);
  assert.equal(Object.hasOwn(imported.stats, '__proto__'), false);
  assert.equal(Object.hasOwn(imported.stats, 'constructor'), false);
  assert.equal({}.polluted, undefined);
  assert.equal(imported.stats.history[0].distance, 123);
});

test('backup retains the previous valid save and recovers a damaged primary', () => {
  const { HC, shared } = harness();
  const state = HC.load();
  state.coins = 100;
  assert.equal(HC.save(state, true), true);
  state.coins = 200;
  assert.equal(HC.save(state, true), true);
  assert.equal(JSON.parse(shared.get(HC.SAVE_KEY)).coins, 200);
  assert.equal(JSON.parse(shared.get(HC.SAVE_BACKUP_KEY)).coins, 100);
  shared.set(HC.SAVE_KEY, '{broken');
  const restoredSession = harness(shared);
  const restored = restoredSession.HC.load();
  assert.equal(restored.coins, 100);
  assert.equal(restoredSession.HC.storageStatus().code, 'recovered');
  assert.equal(shared.get(HC.SAVE_CORRUPT_KEY), '{broken');
  assert.equal(restoredSession.HC.save(restored, true), true);
  assert.equal(JSON.parse(shared.get(HC.SAVE_BACKUP_KEY)).coins, 100);
});

test('a damaged save without backup remains recoverable as raw text', () => {
  const { HC, shared } = harness(new Map([[saveKey, '{broken']]));
  const state = HC.load();
  assert.equal(HC.storageStatus().code, 'corrupt');
  assert.equal(shared.get(HC.SAVE_CORRUPT_KEY), '{broken');
  assert.equal(HC.save(state, true), true);
  assert.equal(shared.get(HC.SAVE_CORRUPT_KEY), '{broken');
});

test('storage denial exposes memory-only mode, permits export and recovers when writable', () => {
  const { HC, flags } = harness();
  flags.readDenied = true;
  const state = HC.load();
  assert.equal(HC.isMemoryOnly(), true);
  assert.equal(HC.storageStatus().code, 'memory-only');
  assert.match(HC.exportCode(state), /^QH1:/);
  assert.equal(HC.save(state, true), false);
  flags.readDenied = false;
  assert.equal(HC.save(state, true), true);
  assert.equal(HC.storageStatus().code, 'ready');
});

test('primary write failure preserves prior data and does not permanently disable retries', () => {
  const { HC, flags, shared } = harness();
  const state = HC.load();
  state.coins = 100;
  HC.save(state, true);
  flags.primaryDenied = true;
  state.coins = 200;
  assert.equal(HC.save(state, true), false);
  assert.equal(JSON.parse(shared.get(HC.SAVE_KEY)).coins, 100);
  assert.equal(HC.storageStatus().memoryOnly, true);
  flags.primaryDenied = false;
  assert.equal(HC.save(state, true), true);
  assert.equal(JSON.parse(shared.get(HC.SAVE_KEY)).coins, 200);
});

test('backup quota failure still writes the primary and reports the missing backup', () => {
  const { HC, flags } = harness();
  const state = HC.load();
  flags.backupDenied = true;
  assert.equal(HC.save(state, true), true);
  assert.equal(HC.storageStatus().code, 'backup-unavailable');
  assert.equal(HC.storageStatus().memoryOnly, false);
  flags.backupDenied = false;
  assert.equal(HC.save(state, true), true);
  assert.equal(HC.storageStatus().code, 'ready');
});

test('an outdated tab cannot overwrite a newer save, even when forced', () => {
  const shared = new Map();
  const a = harness(shared), b = harness(shared);
  const stateA = a.HC.load(), stateB = b.HC.load();
  stateA.coins = 100;
  assert.equal(a.HC.save(stateA, true), true);
  stateB.coins = 999;
  assert.equal(b.HC.save(stateB, true), false);
  assert.equal(b.HC.storageStatus().code, 'conflict');
  assert.equal(b.HC.storageStatus().conflict, true);
  assert.equal(b.HC.storageStatus().memoryOnly, true);
  assert.equal(JSON.parse(shared.get(saveKey)).coins, 100);
  assert.match(b.HC.exportCode(stateB), /^QH1:/);
  assert.equal(b.HC.save(stateB, true), false);
});

test('storage events surface an actual changed primary immediately and ignore unrelated keys', () => {
  const { HC, fire, shared } = harness();
  const state = HC.load();
  fire('storage', { key: HC.SAVE_BACKUP_KEY, newValue: '{}' });
  assert.equal(HC.storageStatus().conflict, false);
  shared.set(HC.SAVE_KEY, '{"newer":true}');
  fire('storage', { key: HC.SAVE_KEY, newValue: '{"newer":true}' });
  assert.equal(HC.storageStatus().code, 'conflict');
  assert.equal(HC.save(state, true), false);
});

test('an event queued before initial load cannot mark the new document as conflicted', () => {
  const { HC, fire, shared } = harness();
  const state = HC.defaultState();
  state.coins = 250;
  const current = JSON.stringify(state);
  shared.set(HC.SAVE_KEY, current);
  fire('storage', { key: HC.SAVE_KEY, newValue: '{"older":true}' });
  assert.equal(HC.storageStatus().conflict, false);
  const loaded = HC.load();
  assert.equal(loaded.coins, 250);
  assert.equal(HC.save(loaded, true), true);
});

test('a delayed older storage event after reload does not conflict with the loaded current value', () => {
  const { HC, fire, shared } = harness();
  const state = HC.defaultState();
  state.coins = 250;
  const current = JSON.stringify(state);
  shared.set(HC.SAVE_KEY, current);
  const loaded = HC.load();
  fire('storage', { key: HC.SAVE_KEY, newValue: '{"older":true}' });
  assert.equal(HC.storageStatus().conflict, false);
  assert.equal(HC.save(loaded, true), true);
});

test('delayed events and synthetic own-write events do not conflict with a known successful save', () => {
  const { HC, fire, shared, clock } = harness();
  const state = HC.load();
  state.coins = 100;
  HC.save(state, true);
  const earlier = shared.get(HC.SAVE_KEY);
  clock.time += 1000;
  state.coins = 200;
  HC.save(state, true);
  const current = shared.get(HC.SAVE_KEY);
  fire('storage', { key: HC.SAVE_KEY, newValue: earlier });
  assert.equal(HC.storageStatus().conflict, false);
  fire('storage', { key: HC.SAVE_KEY, newValue: current });
  assert.equal(HC.storageStatus().conflict, false);
  // clear() notifications may also be stale; inspect current storage.
  fire('storage', { key: null, newValue: null });
  assert.equal(HC.storageStatus().conflict, false);
});

test('a sessionStorage event with the same key does not report a localStorage conflict', () => {
  const { HC, fire, shared } = harness();
  HC.load();
  shared.set(HC.SAVE_KEY, 'changed');
  fire('storage', { key: HC.SAVE_KEY, newValue: 'changed', storageArea: {} });
  assert.equal(HC.storageStatus().conflict, false);
});

test('a real clear from another document still conflicts with a previously loaded save', () => {
  const { HC, fire, shared } = harness();
  const state = HC.load();
  HC.save(state, true);
  shared.clear();
  fire('storage', { key: null, newValue: null });
  assert.equal(HC.storageStatus().code, 'conflict');
  assert.equal(HC.save(state, true), false);
});

test('checking backup and prior saves never changes the active difficulty', () => {
  const { HC } = harness();
  const state = HC.load();
  HC.save(state, true);
  state.settings.diff = 'easy';
  HC.setDiff('easy');
  HC.save(state, true);
  assert.equal(HC.D, HC.DIFFS.easy);
});

test('oversized save codes/files are rejected before reading a file', async () => {
  const { HC, flags } = harness();
  assert.throws(() => HC.importCode('x'.repeat(Math.ceil(HC.SAVE_MAX_BYTES * 4 / 3) + 10)), /максимум 1 МБ/);
  await assert.rejects(HC.importFile({ size: HC.SAVE_MAX_BYTES + 1 }), /максимум 1 МБ/);
  assert.equal(flags.readers, 0);
  await assert.rejects(HC.importFile({ size: 2, text: '{}' }), /Не похоже/);
  const raw = JSON.stringify(HC.defaultState());
  assert.equal((await HC.importFile({ size: raw.length, text: raw })).vehicle, 'jeep');
});

test('wipe removes save, backup and recovery text, then blocks unload writes', () => {
  const { HC, shared } = harness();
  const state = HC.load();
  HC.save(state, true);
  shared.set(HC.SAVE_CORRUPT_KEY, '{broken');
  shared.set('other-app/value', 'keep');
  assert.equal(HC.wipe(), 3);
  assert.equal(HC.save(state, true), false);
  assert.equal(shared.get('other-app/value'), 'keep');
  assert.equal(shared.has(HC.SAVE_KEY), false);
});
