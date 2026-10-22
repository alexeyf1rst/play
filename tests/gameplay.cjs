/* Run with node tests/gameplay.cjs. No browser or packages required. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodes = new Proxy({}, { get(t, key) {
  return t[key] || (t[key] = { hidden: true, textContent: '', focus() {}, blur() {} });
} });
let saved = null;
const context = vm.createContext({
  window: { localStorage: { getItem() { return saved; }, setItem(key, value) { saved = value; } } },
  document: { getElementById(id) { return nodes[id]; } },
  console, Math: Object.create(Math), Date, setTimeout, clearTimeout,
});
for (const file of ['data', 'storage', 'quests', 'decor', 'terrain', 'vehicle', 'base', 'ride']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file + '.js'), 'utf8'), context);
}
const H = context.window.HC;
H.Audio = new Proxy({}, { get() { return () => {}; } });
H.setDiff('normal');
let result, finished;
function start(track = 'hills', state = H.defaultState()) {
  result = null; finished = 0;
  const game = { state, clearInput() {}, onRideFinished(r) { result = r; finished++; } };
  H.Game = game;
  H.Ride.start(game, track);
  return H.Ride;
}
function test(name, fn) { fn(); console.log('✓ ' + name); }

test('New games start with music disabled, and an explicit sound preference survives loading', () => {
  const state = H.defaultState();
  assert.equal(state.settings.music, false);
  state.settings.music = true;
  H.save(state, true);
  assert.equal(H.load().settings.music, true);
  saved = null;
});

test('Fuel stops draining when parked, but drains while driving', () => {
  const r = start();
  for (let i = 0; i < 120; i++) r.car.update(1 / 60, { throttle: 0 });
  const fuel = r.car.fuel;
  for (let i = 0; i < 300; i++) r.car.update(1 / 60, { throttle: 0 });
  assert.equal(r.car.fuel, fuel);
  r.car.update(1 / 60, { throttle: 1 });
  assert.ok(r.car.fuel < fuel);
});

test('Every track has one reachable fuel can at each announced marker', () => {
  for (const track of Object.keys(H.TRACKS)) {
    const T = new H.Terrain(H.TRACKS[track], 12345, track);
    const cans = T.itemsIn(0, 2100 * H.PPM).filter(it => it.type === 'fuel');
    assert.equal(new Set(cans.map(it => it.id)).size, cans.length);
    assert.deepEqual(Array.from(cans, it => it.x / H.PPM), [120, 360, 600, 840, 1080, 1320, 1560, 1800, 2040]);
    for (const it of cans) {
      assert.equal(T.nextFuelX(it.x - 1), it.x);
      assert.ok(Math.abs(T.height(it.x) - it.y - 34) < 1e-8);
      T.take(it);
    }
    assert.equal(T.itemsIn(0, 2100 * H.PPM).filter(it => it.type === 'fuel').length, 0);
  }
});

test('Recovery freezes the run and preserves rewards, distance and fuel exactly once', () => {
  const r = start();
  r.coins = 123; r.ore = 2; r.car.fuel = 31; r.car.distance = 480;
  const startX = r.car.startX;
  const it = r.terrain.itemsIn(0, 200 * H.PPM).find(it => it.type === 'coin');
  r.terrain.take(it);
  r.car.crashed = true;
  r.offerRecovery();
  const time = r.time;
  r.update(1 / 60, { throttle: 1 });
  assert.equal(r.time, time);
  assert.equal(nodes['ride-rescue'].hidden, false);
  r.recover();
  assert.equal(r.phase, 'run');
  assert.equal(r.car.crashed, false);
  assert.equal(r.car.fuel, 31);
  assert.equal(r.car.distance, 480);
  assert.equal(r.car.startX, startX);
  assert.equal(r.coins, 123);
  assert.equal(r.ore, 2);
  assert.ok(r.terrain.taken[it.id]);
  assert.equal(nodes['ride-rescue'].hidden, true);
  r.car.crashed = true;
  r.update(1 / 60, { throttle: 0 });
  assert.equal(r.phase, 'ending');
  const pos = r.car.pos.x;
  r.recover();
  assert.equal(r.car.pos.x, pos);
});

test('Recovery settles safely on a curved track instead of immediately crashing again', () => {
  const r = start();
  r.terrain = new H.Terrain(H.TRACKS.hills, 12345, 'hills');
  r.car = new H.Vehicle('jeep', {}, r.terrain, H.TRACKS.hills.gravity);
  r.safeX = r.car.pos.x;
  for (let i = 0; i < 60 * 90 && r.phase === 'run'; i++) r.update(1 / 60, { throttle: 1 });
  assert.equal(r.phase, 'rescue');
  const fuel = r.car.fuel, distance = r.car.distance;
  r.recover();
  assert.equal(r.car.fuel, fuel);
  assert.equal(r.car.distance, distance);
  for (let i = 0; i < 60 * 10; i++) r.update(1 / 60, { throttle: 0 });
  assert.equal(r.phase, 'run');
  assert.equal(r.car.crashed, false);
});

test('Giving up from recovery pays once and closes the overlay', () => {
  const r = start();
  r.car.distance = 305; r.coins = 100;
  r.offerRecovery(); r.giveUp();
  const coins = H.Game.state.coins;
  assert.equal(r.phase, 'done');
  assert.equal(nodes['ride-rescue'].hidden, true);
  assert.ok(coins >= 500);
  r.finish();
  assert.equal(H.Game.state.coins, coins);
  assert.equal(finished, 1);
});

test('New medals pay once, including all crossed thresholds; old saves remain valid', () => {
  const state = H.defaultState();
  let r = start('hills', state);
  r.car.distance = 1250; r.finish();
  assert.equal(result.medalBonus, 2400); // (50 + 100 + 150) × normal gain 8
  assert.equal(state.stats.best.hills, 1250);
  assert.equal(H.trackOpen(state, 'sand'), true);
  r = start('hills', state); r.car.distance = 1250; r.finish();
  assert.equal(result.medalBonus, 0);
  const restored = H.load();
  assert.equal(restored.stats.best.hills, 1250);
  assert.equal(restored.stats.runs, 2);
  assert.equal(restored.coins, state.coins);
});

test('Goals move through medals and continue after gold', () => {
  const r = start();
  assert.equal(r.goal.distance, 300);
  r.car.distance = 300; assert.equal(r.nextGoal().distance, 700);
  r.car.distance = 700; assert.equal(r.nextGoal().distance, 1200);
  r.car.distance = 1200; assert.equal(r.nextGoal().distance, 1300);
});

test('First upgrades are perceptible while every upgrade still caps at ×2', () => {
  for (const key of Object.keys(H.UPGRADES)) {
    assert.equal(H.upgradeEffect[key](0), 1);
    assert.ok(H.upgradeEffect[key](1) > 1.25);
    assert.equal(H.upgradeEffect[key](H.UPGRADES[key].max), 2);
  }
});

test('Boost increases acceleration without permanently changing vehicle stats', () => {
  function drive(boost) {
    const r = start();
    r.terrain = new H.Terrain(H.TRACKS.hills, 54321, 'hills');
    r.car = new H.Vehicle('jeep', {}, r.terrain, H.TRACKS.hills.gravity);
    const power = r.car.power, topSpeed = r.car.topSpeed;
    for (let i = 0; i < 60; i++) r.update(1 / 60, { throttle: 1, boost });
    assert.equal(r.car.power, power);
    assert.equal(r.car.topSpeed, topSpeed);
    assert.ok(r.boost >= 0 && r.boost <= 1);
    return r.car.vel.x;
  }
  const normal = drive(false), boosted = drive(true);
  assert.ok(boosted > normal * 1.1, `${boosted} vs ${normal}`);
});

test('Boost is unavailable in the air, while braking, with no fuel or during a pause', () => {
  const r = start();
  r.car.onGround = true; r.car.speed = 0;
  r.updateBoost(1, true, 1);
  assert.ok(Math.abs(r.boost - 0.58) < 1e-8);
  r.car.onGround = false;
  const charge = r.boost;
  r.updateBoost(1, true, 1); assert.equal(r.boost, charge);
  r.car.onGround = true;
  r.updateBoost(1, true, -1); assert.equal(r.boost, charge);
  r.car.fuel = 0;
  r.updateBoost(1, true, 1); assert.equal(r.boost, charge);
  r.paused = true;
  r.update(1 / 60, { throttle: 1, boost: true }); assert.equal(r.boost, charge);
  r.paused = false; r.phase = 'ending';
  r.updateBoost(1, true, 1); assert.equal(r.boost, charge);
});

test('An empty boost must be released before it can fire again', () => {
  const r = start(); r.car.onGround = true; r.car.speed = 100; r.boost = 0.1;
  r.updateBoost(1, true, 1);
  assert.equal(r.boost, 0); assert.equal(r.boostLocked, true);
  r.updateBoost(1, true, 1);
  assert.equal(r.boosting, false); assert.ok(r.boost > 0);
  r.updateBoost(1, false, 1); r.updateBoost(1 / 60, true, 1);
  assert.equal(r.boosting, true);
});

test('Only substantial aligned landings reward coins and charge; crashes break the series', () => {
  const r = start();
  r.boost = 0.3; r.car.ang = 0; r.car.angVel = 0;
  r.landing(0.2); assert.equal(r.cleanLandings, 0);
  r.landing(0.6);
  assert.equal(r.cleanLandings, 1); assert.ok(Math.abs(r.boost - 0.48) < 1e-8);
  const first = r.coins;
  r.landing(0.6); assert.equal(r.coins - first, first * 2);
  r.car.crashed = true; const earned = r.coins;
  r.landing(0.6); assert.equal(r.landingStreak, 0); assert.equal(r.coins, earned);
});

test('Route missions count picked items, pay once, and do not pay in demo or after a crash', () => {
  const r = start();
  assert.equal(r.mission.key, 'coinPickups');
  r.coins = 5000; r.checkMission(); assert.equal(r.mission.done, false);
  r.coinPickups = 15; r.checkMission();
  assert.equal(r.mission.done, true); assert.equal(r.ore, 1);
  const earned = r.coins; r.checkMission(); assert.equal(r.coins, earned);
  const state = H.defaultState(); state.stats.runs = 1;
  const cans = start('hills', state); cans.cans = 2; cans.demo = true;
  cans.checkMission(); assert.equal(cans.ore, 0);
  cans.demo = false; cans.car.crashed = true;
  cans.checkMission(); assert.equal(cans.ore, 0);
  cans.car.crashed = false; cans.checkMission(); assert.equal(cans.ore, 2);
});

test('Stock vehicles remain finite on all five tracks', () => {
  for (const track of Object.keys(H.TRACKS)) {
    for (const vehicle of Object.keys(H.VEHICLES)) {
      const state = H.defaultState(); state.vehicle = vehicle; state.up[vehicle] = {};
      const r = start(track, state);
      for (let i = 0; i < 600 && r.active; i++) {
        if (r.phase === 'rescue') r.recover();
        r.update(1 / 60, { throttle: 1, boost: true });
        assert.ok(Number.isFinite(r.car.pos.x + r.car.pos.y + r.car.ang));
        assert.ok(r.car.fuel >= 0 && r.car.fuel <= r.car.maxFuel);
      }
    }
  }
});

test('The bright edition grants a starter village once, without overwriting built villages', () => {
  const state=H.defaultState();
  assert.equal(H.Economy.welcomeVillage(state),true);
  assert.equal(state.base.plots[0].type,'mine');
  assert.equal(state.base.plots[2].type,'garden');
  state.base.plots[0]=null;
  assert.equal(H.Economy.welcomeVillage(state),false);
  assert.equal(state.base.plots[0],null);
  const old=H.defaultState();old.base.plots[0]={type:'drill',level:4};
  assert.equal(H.Economy.welcomeVillage(old),false);
  assert.equal(old.base.plots[0].type,'drill');assert.equal(old.base.plots[0].level,4);
});

test('The new building hit area includes the roof of the taller sprite', () => {
  const state=H.defaultState();state.base.plots[0]={type:'mine',level:1};
  H.Art={};H.Base.cam={x:0,y:0};H.Base.zoom=1;H.Base.W=1000;H.Base.H=800;
  const spot=H.Base.places()[0],screen=H.Base.toScreen(spot.x,spot.y-194);
  assert.equal(H.Base.hitTest(screen.x,screen.y,state),0);
  delete H.Art;
});
