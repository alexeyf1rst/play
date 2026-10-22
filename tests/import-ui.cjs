const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function harness({ saved = true, confirm = true, conflict = false, conflictOnSave = false } = {}) {
  const observations = { confirms: [], saves: 0, replacements: [], toasts: [], statusRefreshes: 0 };
  const nodes = new Map();
  const status = { memoryOnly: !saved, conflict, message: conflict ? 'Прогресс изменился в другой вкладке' : 'Автосохранение недоступно' };
  const state = { coins: 123, settings: { music: true } };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      addEventListener() {}, setAttribute() {},
      classList: { toggle() {} }
    });
    return nodes.get(id);
  }
  const HC = {
    Audio: {},
    storageStatus() { return status; },
    save(actual, force) {
      assert.equal(actual, state);
      assert.equal(force, true);
      observations.saves++;
      if (conflictOnSave) status.conflict = true;
      return saved;
    }
  };
  const window = { HC, confirm(message) { observations.confirms.push(message); return confirm; } };
  const context = vm.createContext({ window, document: { getElementById: node, addEventListener() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8'), context, { filename: 'ui.js' });
  const game = { state, replaceState(value) { observations.replacements.push(value); } };
  HC.UI.init(game);
  HC.UI.toast = message => observations.toasts.push(message);
  HC.UI.refresh = function () {};
  HC.UI.refreshStorageStatus = function () { observations.statusRefreshes++; };
  return { UI: HC.UI, observations, state };
}

test('successful pre-save uses the ordinary replacement confirmation', () => {
  const { UI, observations } = harness();
  const imported = { coins: 999 };
  assert.equal(UI.applyImportedState(imported), true);
  assert.equal(observations.saves, 1);
  assert.equal(observations.confirms.length, 1);
  assert.doesNotMatch(observations.confirms[0], /Не удалось сохранить текущий прогресс/);
  assert.deepEqual(observations.replacements, [imported]);
});

test('failed pre-save explicitly warns about the missing backup and cancellation retains current state', () => {
  const { UI, observations, state } = harness({ saved: false, confirm: false });
  assert.equal(UI.applyImportedState({ coins: 999 }), false);
  assert.equal(observations.saves, 1);
  assert.equal(observations.confirms.length, 1);
  assert.match(observations.confirms[0], /Не удалось сохранить текущий прогресс/);
  assert.match(observations.confirms[0], /без резервной копии/);
  assert.equal(observations.replacements.length, 0);
  assert.equal(state.coins, 123);
});

test('memory-only import remains available after explicit approval without a backup', () => {
  const { UI, observations } = harness({ saved: false, confirm: true });
  const imported = { coins: 999 };
  assert.equal(UI.applyImportedState(imported), true);
  assert.equal(observations.confirms.length, 1);
  assert.match(observations.confirms[0], /без резервной копии/);
  assert.deepEqual(observations.replacements, [imported]);
});

test('an existing conflict prevents import before any confirmation or save', () => {
  const { UI, observations } = harness({ conflict: true });
  assert.equal(UI.applyImportedState({ coins: 999 }), false);
  assert.equal(observations.saves, 0);
  assert.equal(observations.confirms.length, 0);
  assert.equal(observations.replacements.length, 0);
});

test('a conflict detected by pre-save prevents both confirmation and replacement', () => {
  const { UI, observations } = harness({ saved: false, conflictOnSave: true });
  assert.equal(UI.applyImportedState({ coins: 999 }), false);
  assert.equal(observations.saves, 1);
  assert.equal(observations.confirms.length, 0);
  assert.equal(observations.replacements.length, 0);
});
