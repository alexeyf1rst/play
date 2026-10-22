const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function harness() {
  const clock = { time: 1800000000000, performance: 0 };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.time])); }
    static now() { return clock.time; }
  }
  const saved = new Map();
  const document = { hidden: false, addEventListener() {} };
  const context = {
    Date: ClockDate, TextEncoder, TextDecoder, btoa, atob, Uint8Array,
    console: { warn() {} },
    document,
    performance: { now() { return clock.performance; } },
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    window: { HC: {}, addEventListener() {}, localStorage: {
      getItem(key) { return saved.get(key) ?? null; }, setItem(key, value) { saved.set(key, value); }
    } }
  };
  vm.createContext(context);
  for (const file of ['data', 'storage', 'quests', 'base', 'main']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), context, { filename: file + '.js' });
  }
  const HC = context.window.HC;
  HC.Audio = { suspend() {}, resume() {} };
  HC.UI = { refreshTop() {}, refreshPending() {} };
  HC.Ride = { active: false, paused: false };
  const game = HC.Game;
  game.state = HC.load();
  game.scene = 'base';
  game.keys = { gas: false, brake: false };
  game.touch = { gas: false, brake: false };
  game.input = { throttle: 0 };
  game.accum = 0;
  game.last = 0;
  game.onBuilt = function (list) { this.finished = list; };
  return { HC, clock, document, game };
}

function nearly(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} !== ${expected}`); }

test('offline mines earn for elapsed real time, without double counting repeated resumes', () => {
  const { HC, game, clock } = harness();
  const state = game.state;
  state.base.plots[0] = { type: 'mine', level: 1 };
  const rate = HC.Economy.rates(state).coins;
  clock.time += 60 * 1000;
  const result = HC.Economy.applyOffline(state);
  nearly(result.coins, rate);
  nearly(state.base.pending.coins, rate);
  assert.equal(HC.Economy.applyOffline(state).coins, 0);
});

test('a newly built mine earns only after completion within the offline interval', () => {
  const { HC, game, clock } = harness();
  const state = game.state;
  state.base.lastTick = clock.time - 60 * 1000;
  state.base.plots[0] = { type: 'mine', level: 0,
    build: { to: 1, span: 60, end: clock.time - 30 * 1000 } };
  const result = HC.Economy.applyOffline(state);
  nearly(result.coins, HC.Economy.buildingRate('mine', 1) / 2);
  assert.equal(result.done.length, 1);
  assert.equal(state.base.plots[0].level, 1);
});

test('upgrades earn at the previous rate until construction finishes', () => {
  const { HC, game, clock } = harness();
  const state = game.state;
  state.base.lastTick = clock.time - 60 * 1000;
  state.base.plots[0] = { type: 'mine', level: 1,
    build: { to: 2, span: 60, end: clock.time - 30 * 1000 } };
  const result = HC.Economy.applyOffline(state);
  const expected = (HC.Economy.buildingRate('mine', 1) + HC.Economy.buildingRate('mine', 2)) / 2;
  nearly(result.coins, expected);
});

test('construction completed before the capped offline window earns throughout that window', () => {
  const { HC, game, clock } = harness();
  const state = game.state;
  const maxHours = HC.Economy.offlineHours(state);
  state.base.lastTick = clock.time - (maxHours + 2) * 3600 * 1000;
  state.base.plots[0] = { type: 'mine', level: 0,
    build: { to: 1, span: 135, end: clock.time - (maxHours + 1) * 3600 * 1000 } };
  const expected = Math.min(HC.Economy.capacity(state).coins,
    HC.Economy.buildingRate('mine', 1) * maxHours * 60);
  const result = HC.Economy.applyOffline(state);
  assert.equal(result.capped, true);
  nearly(result.coins, expected);
  assert.ok(result.coins > 0);
  assert.equal(result.done.length, 1);
});

test('moving the clock backwards does not subtract income or leave lastTick in the future', () => {
  const { HC, game, clock } = harness();
  const state = game.state;
  state.base.plots[0] = { type: 'mine', level: 1 };
  state.base.pending.coins = 30;
  state.base.lastTick = clock.time + 60000;
  const result = HC.Economy.applyOffline(state);
  assert.equal(result.coins, 0);
  assert.equal(state.base.pending.coins, 30);
  assert.equal(state.base.lastTick, clock.time);
});

test('returning to a suspended tab credits the gap once and clears held controls', () => {
  const { HC, game, clock, document } = harness();
  const state = game.state;
  state.base.plots[0] = { type: 'mine', level: 1 };
  const rate = HC.Economy.rates(state).coins;
  game.keys.gas = true;
  game.touch.brake = true;
  game.input.throttle = 1;
  document.hidden = true;
  game.handleVisibility();
  assert.equal(game.keys.gas, false);
  assert.equal(game.touch.brake, false);
  assert.equal(game.input.throttle, 0);
  clock.time += 10 * 60 * 1000;
  clock.performance += 10 * 60 * 1000;
  document.hidden = false;
  game.handleVisibility();
  nearly(state.base.pending.coins, rate * 10);
  assert.equal(state.base.lastTick, clock.time);
  assert.equal(game.last, clock.performance);
  game.handleVisibility();
  nearly(state.base.pending.coins, rate * 10);
});

test('slow frame delivery does not reduce real-time base production', () => {
  const { HC, game, clock } = harness();
  const state = game.state;
  state.base.plots[0] = { type: 'mine', level: 1 };
  const rate = HC.Economy.rates(state).coins;
  game.g = { setTransform() {} };
  HC.Base.update = function () {};
  HC.Base.draw = function () {};
  for (let i = 0; i < 20; i++) {
    clock.time += 1000;
    clock.performance += 1000;
    game.frame(clock.performance);
  }
  nearly(state.base.pending.coins, rate * 20 / 60);
});
