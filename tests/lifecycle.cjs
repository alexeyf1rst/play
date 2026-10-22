'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

// Minimal DOM at the browser boundary. The tests dispatch the listeners actually
// registered by main.js; they do not call a second implementation of keyFlag.
function eventTarget(extra = {}) {
  const handlers = new Map();
  return Object.assign({
    addEventListener(type, handler) {
      const list = handlers.get(type) || [];
      list.push(handler);
      handlers.set(type, list);
    },
    removeEventListener(type, handler) {
      handlers.set(type, (handlers.get(type) || []).filter(item => item !== handler));
    },
    dispatch(type, options = {}) {
      const event = Object.assign({
        type,
        target: this,
        key: '',
        repeat: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }
      }, options);
      for (const handler of [...(handlers.get(type) || [])]) handler(event);
      return event;
    }
  }, extra);
}

function makeElement(tagName = 'DIV') {
  const classes = new Set();
  return eventTarget({
    tagName,
    hidden: false,
    style: {},
    clientWidth: 1280,
    clientHeight: 720,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, value) {
        if (value === undefined) value = !classes.has(name);
        if (value) classes.add(name); else classes.delete(name);
        return value;
      }
    },
    setAttribute() {},
    setPointerCapture() {},
    getBoundingClientRect() { return { left: 20, top: 30 }; }
  });
}

function createGame() {
  let now = 1_800_000_000_000;
  const origin = now;
  const nodes = new Map();
  const observations = {
    physics: [], draws: 0, baseUpdates: 0, plots: [], hits: 0,
    saves: 0, offline: [], suspended: 0, resumed: 0
  };
  const canvasContext = { setTransform() {} };
  function node(id) {
    if (!nodes.has(id)) {
      const element = makeElement();
      element.parentNode = makeElement();
      if (id === 'scene') element.getContext = () => canvasContext;
      nodes.set(id, element);
    }
    return nodes.get(id);
  }
  const document = eventTarget({
    hidden: false,
    body: makeElement('BODY'),
    getElementById: node,
    querySelector() { return null; }
  });
  const window = eventTarget({ devicePixelRatio: 1 });
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({
    window, document, Date: ClockDate, TextEncoder,
    performance: { now: () => now - origin },
    requestAnimationFrame() {},
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 1; },
    console
  });
  function load(relative) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, relative), 'utf8'), context, { filename: relative });
  }
  load('js/data.js');
  load('js/storage.js');
  load('js/base.js');
  const HC = window.HC;
  const state = HC.defaultState();
  state.base.plots[0] = { type: 'mine', level: 1 };
  HC.load = () => state;
  HC.save = () => { observations.saves++; return true; };
  HC.storageStatus = () => ({});
  HC.Quests = { ensure: () => [] };
  HC.Audio = {
    applySettings() {}, unlock() {}, click() {}, engineStop() {},
    engineStart() {}, build() {},
    suspend() { observations.suspended++; },
    resume() { observations.resumed++; }
  };
  let modalOpen = false;
  HC.UI = {
    init() {}, refreshTop() {}, refreshPending() {}, refreshQuestBadge() {},
    refreshStorageStatus() {}, refresh() {}, toast() {},
    isOpen: () => modalOpen,
    open() { modalOpen = true; },
    close() {
      modalOpen = false;
      const callback = this.onClose;
      this.onClose = null;
      if (callback) callback();
    },
    openPlot(index) { observations.plots.push(index); }
  };
  HC.Ride = {
    active: false, paused: false, phase: 'active', coins: 0,
    car: { distance: 0, fuel: 100, maxFuel: 100 },
    start() { this.active = true; this.paused = false; },
    stop() { this.active = false; },
    update(dt, input) { observations.physics.push({ dt, throttle: input.throttle }); },
    draw() { observations.draws++; }
  };
  Object.assign(HC.Base, {
    update() { observations.baseUpdates++; },
    draw() { observations.draws++; },
    panBy() {}, setZoom() {}, zoomBy() {}, showAll() {}, pingPad() {}, pop() {},
    hitTest() { observations.hits++; return 2; }
  });
  const applyOffline = HC.Economy.applyOffline;
  HC.Economy.applyOffline = function (...args) {
    const result = applyOffline.apply(this, args);
    observations.offline.push(result);
    return result;
  };
  load('js/main.js');
  const game = HC.Game;
  game.init();
  game.scene = 'ride';
  HC.Ride.active = true;
  HC.Ride.paused = false;
  return {
    HC, game, window, document, node, observations, state,
    advance(ms) { now += ms; },
    frame() { game.frame(now - origin); },
    setModalOpen(value) { modalOpen = value; },
    key(type, key, options = {}) {
      return window.dispatch(type, { target: document.body, key, ...options });
    }
  };
}

function assertNeutral(env) {
  assert.equal(env.game.keys.gas, false, 'keyboard gas must be released');
  assert.equal(env.game.keys.brake, false, 'keyboard brake must be released');
  assert.equal(env.game.touch.gas, false, 'touch gas must be released');
  assert.equal(env.game.touch.brake, false, 'touch brake must be released');
  assert.equal(env.game.readInput().throttle, 0, 'no stale throttle may reach physics');
}

test('editing text, choosing options and native button activation do not steer or pause the game', () => {
  const env = createGame();
  const targets = [
    makeElement('INPUT'), makeElement('TEXTAREA'), makeElement('SELECT'),
    Object.assign(makeElement(), { isContentEditable: true })
  ];
  for (const target of targets) {
    for (const key of ['ArrowRight', 'ArrowLeft', ' ', 'd', 'a', 'в', 'ф', 'p', 'Escape']) {
      const event = env.key('keydown', key, { target });
      assert.equal(event.defaultPrevented, false, target.tagName + ': preserve native ' + key);
      assertNeutral(env);
      assert.equal(env.HC.Ride.paused, false, 'editing a shortcut must not pause the game');
    }
  }
  for (const tagName of ['BUTTON', 'A']) {
    const event = env.key('keydown', ' ', { target: makeElement(tagName) });
    assert.equal(event.defaultPrevented, false);
    assertNeutral(env);
  }
  for (const guard of [
    { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { isComposing: true }, { defaultPrevented: true }
  ]) {
    env.key('keydown', 'ArrowRight', guard);
    assertNeutral(env);
  }
  const actualDrive = env.key('keydown', 'ArrowRight');
  assert.equal(actualDrive.defaultPrevented, true, 'the same key still drives outside editing controls');
  assert.equal(env.game.readInput().throttle, 1);
});

test('keyup releases stale gas and brake even after a modal or an editor acquired focus', () => {
  const env = createGame();
  for (const [key, flag] of [
    ['ArrowRight', 'gas'], ['d', 'gas'], ['D', 'gas'], ['в', 'gas'], ['В', 'gas'], [' ', 'gas'],
    ['ArrowLeft', 'brake'], ['a', 'brake'], ['A', 'brake'], ['ф', 'brake'], ['Ф', 'brake']
  ]) {
    env.setModalOpen(false);
    env.key('keydown', key);
    assert.equal(env.game.keys[flag], true, key + ': establish the held control first');
    env.setModalOpen(true);
    env.key('keyup', key, {
      target: makeElement('TEXTAREA'), ctrlKey: true, isComposing: true, defaultPrevented: true
    });
    assert.equal(env.game.keys[flag], false, key + ': release cannot be swallowed by an editing guard');
    env.setModalOpen(false);
    assert.equal(env.game.readInput().throttle, 0);
  }
});

test('pause and blur clear keyboard, pedals and computed throttle before resuming', () => {
  const env = createGame();
  function holdControls() {
    env.key('keydown', 'ArrowRight');
    env.node('pedal-gas').dispatch('pointerdown', { pointerId: 1 });
    env.node('pedal-brake').dispatch('pointerdown', { pointerId: 2 });
    env.game.input.throttle = 1;
  }
  holdControls();
  env.node('btn-pause').dispatch('click');
  assert.equal(env.HC.Ride.paused, true);
  assertNeutral(env);
  env.node('pedal-gas').dispatch('pointerdown', { pointerId: 3 });
  assertNeutral(env);
  env.HC.UI.close();
  assert.equal(env.HC.Ride.paused, false);
  assertNeutral(env);

  holdControls();
  env.window.dispatch('blur');
  assert.equal(env.HC.Ride.paused, true);
  assertNeutral(env);
  env.window.dispatch('focus');
  assert.equal(env.HC.Ride.paused, true, 'returning focus requires an explicit resume');
  env.HC.UI.close();
  assertNeutral(env);
});

test('cancelled or lost pedal pointers release the control', () => {
  const env = createGame();
  const pedal = env.node('pedal-gas');
  for (const release of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave', 'touchend']) {
    pedal.dispatch('pointerdown', { pointerId: 1 });
    assert.equal(env.game.readInput().throttle, 1);
    pedal.dispatch(release, { pointerId: 1 });
    assert.equal(env.game.readInput().throttle, 0, release + ': pedal must not stay held');
  }
});

test('hidden frames cannot run physics or earn online time; returning accrues offline once and stays paused', () => {
  const env = createGame();
  const rate = env.HC.Economy.rates(env.state).coins / 60;
  env.key('keydown', 'ArrowRight');
  env.game.readInput();
  env.advance(5000);
  env.document.hidden = true;
  env.document.dispatch('visibilitychange');
  assert.equal(env.HC.Ride.paused, true);
  assertNeutral(env);
  assert.ok(Math.abs(env.state.base.pending.coins - rate * 5) < 1e-8, 'settle the foreground before hiding');

  const onlineTime = env.state.stats.playTime;
  const pendingBefore = env.state.base.pending.coins;
  for (let i = 0; i < 6; i++) {
    env.advance(10000);
    env.frame();
  }
  assert.equal(env.observations.physics.length, 0, 'the main loop must not invoke the physics boundary while hidden');
  assert.equal(env.observations.draws, 0);
  assert.equal(env.state.stats.playTime, onlineTime);
  assert.equal(env.state.base.pending.coins, pendingBefore, 'hidden RAFs must not accrue online income');

  env.document.hidden = false;
  env.document.dispatch('visibilitychange');
  assert.equal(env.observations.offline.length, 2, 'initial launch plus one return from background');
  assert.equal(env.observations.offline[1].seconds, 60);
  assert.ok(Math.abs(env.state.base.pending.coins - rate * 65) < 1e-8, 'credit only the actual foreground plus offline interval');
  assert.equal(env.HC.Ride.paused, true, 'visibility return must not silently resume a moving car');
  assertNeutral(env);
  assert.equal(env.observations.suspended, 1);
  assert.equal(env.observations.resumed, 1);

  const afterReturn = env.state.base.pending.coins;
  env.document.dispatch('visibilitychange');
  assert.equal(env.state.base.pending.coins, afterReturn, 'a duplicate visible event cannot credit the same absence twice');
  env.advance(16);
  env.frame();
  assert.equal(env.state.base.pending.coins, afterReturn, 'the next RAF cannot replay the offline interval');
  assert.equal(env.HC.Ride.paused, true);
});

test('cancelling a base pointer cannot open a plot, including a subsequent pointerup', () => {
  const env = createGame();
  env.game.scene = 'base';
  const canvas = env.node('scene');
  const pointer = { pointerId: 7, clientX: 240, clientY: 180 };
  canvas.dispatch('pointerdown', pointer);
  assert.equal(env.HC.Base.dragging, true);
  canvas.dispatch('pointercancel', pointer);
  assert.equal(env.HC.Base.dragging, false);
  canvas.dispatch('pointerup', pointer);
  assert.equal(env.observations.hits, 0);
  assert.deepEqual(env.observations.plots, []);

  canvas.dispatch('pointerdown', { ...pointer, pointerId: 8 });
  canvas.dispatch('pointerup', { ...pointer, pointerId: 8 });
  assert.deepEqual(env.observations.plots, [2], 'a completed tap must still work');
  canvas.dispatch('pointerdown', { ...pointer, pointerId: 9 });
  canvas.dispatch('pointermove', { ...pointer, pointerId: 9, clientX: 280 });
  canvas.dispatch('pointerup', { ...pointer, pointerId: 9, clientX: 280 });
  assert.deepEqual(env.observations.plots, [2], 'panning must not be mistaken for a tap');
});
