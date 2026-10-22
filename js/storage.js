/* ============================================================
   Сохранения.
   Куда ложатся данные:
     1) localStorage браузера — автоматически, каждые 10 секунд;
     2) файл .json — кнопка «Сохранить в файл» (бэкап, перенос);
     3) код-строка — скопировал, вставил на другом устройстве.
   Никаких серверов и аккаунтов: игра целиком твоя и офлайновая.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  var memoryOnly = false;   // true, если localStorage недоступен
  var lastWrite = 0;
  var wiped = false;        // после «Начать заново» писать больше нельзя
  var status = { recovered: false, corrupt: false, conflict: false, backupAvailable: false, lastSavedAt: 0, error: '', backupError: '' };
  var expectedRaw = null;
  var hasLoaded = false;

  HC.SAVE_MAX_BYTES = 1024 * 1024;
  HC.SAVE_BACKUP_KEY = HC.SAVE_KEY + '/backup';
  HC.SAVE_CORRUPT_KEY = HC.SAVE_KEY + '/corrupt';

  function now() { return Date.now(); }
  function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function record(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function num(v, def) { return typeof v === 'number' && isFinite(v) ? v : def; }
  function bounded(v, def, min, max) { return Math.max(min, Math.min(max, num(v, def))); }
  function amount(v, def) { return bounded(v, def || 0, 0, 1e15); }
  function integer(v, def, min, max) { return Math.floor(bounded(v, def, min, max)); }
  function known(map, key) { return typeof key === 'string' && !!map && own(map, key); }
  function tooLarge() { return new Error('Сейв слишком большой: максимум 1 МБ'); }
  function checkSize(raw) {
    if (raw.length > HC.SAVE_MAX_BYTES || new TextEncoder().encode(raw).length > HC.SAVE_MAX_BYTES) throw tooLarge();
  }

  // Оставляем расширения новых версий (историю, достижения), но не переносим
  // специальные ключи прототипа и чрезмерно глубокие структуры из чужого файла.
  function cleanValue(value, depth) {
    if (depth > 16) return null;
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.slice(0, 2000).map(function (v) { return cleanValue(v, depth + 1); });
    if (!record(value)) return null;
    var out = {};
    Object.keys(value).slice(0, 2000).forEach(function (k) {
      if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = cleanValue(value[k], depth + 1);
    });
    return out;
  }

  function resemblesSave(s) {
    if (!record(s)) return false;
    // Даже повреждённые вложенные поля можно починить. Одного произвольного
    // JSON-объекта или номера версии недостаточно, чтобы заменить прогресс.
    return own(s, 'coins') && own(s, 'base') && own(s, 'stats') && own(s, 'vehicle') &&
      (s.v === 1 || (!own(s, 'v') && record(s.base) && Array.isArray(s.base.plots)));
  }

  function defaultUpgrades() {
    var o = {};
    for (var k in HC.UPGRADES) o[k] = 0;
    return o;
  }

  HC.defaultState = function () {
    var plots = [];
    for (var i = 0; i < HC.PLOTS.spots.length; i++) plots.push(null);
    return {
      v: 1,
      created: now(),
      saved: now(),
      coins: HC.ECON.startCoins,
      ore: 0,
      vehicle: 'jeep',
      owned: { jeep: true },
      tracks: { hills: true },
      track: 'hills',
      up: { jeep: defaultUpgrades() },
      quests: {},
      base: {
        plots: plots,
        unlocked: HC.PLOTS.free,
        pending: { coins: 0, ore: 0 },
        lastTick: now()
      },
      stats: {
        runs: 0,
        best: {},
        totalDistance: 0,
        totalCoins: 0,
        playTime: 0,
        collected: 0
      },
      settings: {
        music: true,
        musicVol: 0.55,
        sfx: true,
        sfxVol: 0.5,
        theme: 'color',
        themePicked: false,
        diff: 'normal',
        diffPicked: false,
        calmMode: false,
        shake: true,
        showHints: true
      }
    };
  };

  /* --- Починка/дополнение сейва после обновлений игры ------ */
  function migrate(source) {
    if (!resemblesSave(source)) throw new Error('Не похоже на сейв «Тихих холмов»');
    var s = cleanValue(source, 0), d = HC.defaultState();
    var oldSettings = record(s.settings) ? s.settings : {};
    var hadDifficulty = known(HC.DIFFS, oldSettings.diff);

    s.v = 1;
    s.coins = amount(s.coins);
    s.ore = amount(s.ore);
    s.created = integer(s.created, now(), 0, 8640000000000000);
    s.saved = integer(s.saved, now(), 0, 8640000000000000);

    s.settings = oldSettings;
    Object.keys(d.settings).forEach(function (key) {
      if (typeof s.settings[key] !== typeof d.settings[key]) s.settings[key] = d.settings[key];
    });
    s.settings.musicVol = bounded(s.settings.musicVol, d.settings.musicVol, 0, 1);
    s.settings.sfxVol = bounded(s.settings.sfxVol, d.settings.sfxVol, 0, 1);
    if (!known(HC.THEME_NAMES, s.settings.theme) || !s.settings.themePicked) s.settings.theme = 'color';
    if (!known(HC.DIFFS, s.settings.diff)) s.settings.diff = 'normal';

    var owned = record(s.owned) ? s.owned : {}, tracks = record(s.tracks) ? s.tracks : {};
    s.owned = { jeep: true };
    s.tracks = { hills: true };
    Object.keys(HC.VEHICLES).forEach(function (id) { if (owned[id] === true) s.owned[id] = true; });
    Object.keys(HC.TRACKS).forEach(function (id) { if (tracks[id] === true) s.tracks[id] = true; });
    if (!known(HC.VEHICLES, s.vehicle) || !s.owned[s.vehicle]) s.vehicle = 'jeep';
    if (!known(HC.TRACKS, s.track)) s.track = 'hills';

    var upgrades = record(s.up) ? s.up : {};
    s.up = {};
    delete s.tune;
    Object.keys(HC.VEHICLES).forEach(function (id) {
      var old = record(upgrades[id]) ? upgrades[id] : {}, keep = defaultUpgrades();
      Object.keys(keep).forEach(function (key) {
        keep[key] = integer(old[key], 0, 0, HC.UPGRADES[key].max);
      });
      s.up[id] = keep;
    });

    s.base = record(s.base) ? s.base : d.base;
    var plots = Array.isArray(s.base.plots) ? s.base.plots : [], fixed = [];
    for (var i = 0; i < HC.PLOTS.spots.length; i++) {
      var p = plots[i];
      if (record(p) && known(HC.BUILDINGS, p.type)) {
        var bd = HC.BUILDINGS[p.type];
        var lv = integer(p.level, 1, 0, bd.max);
        var keep = { type: p.type, level: lv }, b = p.build;
        if (record(b)) {
          var to = integer(b.to, lv + 1, 1, bd.max);
          var buildTime = Math.max(5, Math.round((bd.build || 0) * Math.pow(bd.buildMult || 1.5, to - 1) *
            HC.DIFFS[s.settings.diff].build));
          var span = bounded(b.span, buildTime, 1, 31536000);
          var end = bounded(b.end, now(), 0, 8640000000000000);
          // Часы могли перевести вперёд и обратно: стройка не должна зависнуть.
          if (end > now() + span * 1000 + 60000) end = now() + span * 1000;
          if (to > lv) keep.build = { to: to, end: end, span: span };
        }
        fixed.push(keep.level < 1 && !keep.build ? null : keep);
      } else fixed.push(null);
    }
    s.base.plots = fixed;
    s.base.unlocked = integer(s.base.unlocked, HC.PLOTS.free, HC.PLOTS.free, HC.PLOTS.spots.length);
    s.base.pending = record(s.base.pending) ? s.base.pending : {};
    s.base.pending.coins = amount(s.base.pending.coins);
    s.base.pending.ore = amount(s.base.pending.ore);
    s.base.lastTick = bounded(s.base.lastTick, now(), 0, now());
    if (own(s.base, 'autoT')) s.base.autoT = amount(s.base.autoT);

    s.stats = record(s.stats) ? s.stats : d.stats;
    var best = record(s.stats.best) ? s.stats.best : {};
    s.stats.best = {};
    Object.keys(HC.TRACKS).forEach(function (id) {
      if (typeof best[id] === 'number' && isFinite(best[id])) s.stats.best[id] = Math.floor(amount(best[id]));
    });
    ['runs', 'totalDistance', 'totalCoins', 'playTime', 'collected'].forEach(function (key) {
      s.stats[key] = amount(s.stats[key]);
    });
    s.stats.runs = Math.floor(s.stats.runs);

    // Сейвы до появления выбора сложности жили на нынешней «Сложной».
    // Явный выбор и свежий старт с подарочными монетами миграция не меняет.
    var played = s.stats.runs > 0 || s.base.plots.some(Boolean) || s.coins > HC.ECON.startCoins ||
      s.ore > 0 || s.base.unlocked > HC.PLOTS.free;
    if (!s.settings.diffPicked && !hadDifficulty && played) {
      s.settings.diff = 'hard';
      s.settings.diffPicked = true;
    }

    // Вложенные задания приходят и из файла: ни сырые строки маршрутов,
    // ни неизвестные типы, ни null не должны дойти до HTML и обработчиков.
    var quests = record(s.quests) ? s.quests : {};
    s.quests = {};
    Object.keys(HC.QUEST_PERIODS || {}).forEach(function (period) {
      var group = quests[period];
      if (!record(group) || typeof group.key !== 'string' || group.key.length > 32 || !Array.isArray(group.list)) return;
      var list = [];
      group.list.slice(0, HC.QUEST_PERIODS[period].count).forEach(function (q) {
        if (!record(q) || !known(HC.QUEST_KINDS, q.t) || num(q.n, 0) <= 0) return;
        var def = HC.QUEST_KINDS[q.t];
        if (def.track && !known(HC.TRACKS, q.track)) return;
        var one = { t: q.t, n: amount(q.n), p: 0, c: q.c === true, rc: Math.floor(amount(q.rc)), ro: Math.floor(amount(q.ro)) };
        one.p = Math.min(one.n, amount(q.p));
        if (def.track) one.track = q.track;
        list.push(one);
      });
      if (list.length) s.quests[period] = { key: group.key, list: list };
    });
    return s;
  }

  function parse(raw) {
    checkSize(raw);
    return migrate(JSON.parse(raw));
  }
  function activate(state) {
    HC.setDiff(state.settings.diff);
    return state;
  }
  function storageFailed(error) {
    memoryOnly = true;
    status.error = error && error.message ? error.message : 'Запись в браузер недоступна';
  }
  function storageConflict() {
    status.conflict = true;
    memoryOnly = true;
  }

  window.addEventListener('storage', function (event) {
    if (!hasLoaded || wiped || status.conflict || (event.key !== HC.SAVE_KEY && event.key !== null)) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      // Событие может ждать в очереди ещё с прошлой загрузки страницы или
      // предыдущей записи. Сверяем актуальный ключ, а не устаревший newValue.
      if (window.localStorage.getItem(HC.SAVE_KEY) !== expectedRaw) storageConflict();
    } catch (error) { storageFailed(error); }
  });

  /* --- Чтение/запись localStorage ------------------------- */
  HC.load = function () {
    hasLoaded = true;
    var raw = null, backup = null;
    try {
      raw = window.localStorage.getItem(HC.SAVE_KEY);
      expectedRaw = raw;
      backup = window.localStorage.getItem(HC.SAVE_BACKUP_KEY);
      memoryOnly = false;
      status.error = '';
    } catch (error) {
      storageFailed(error);
      console.warn('[Тихие холмы] localStorage недоступен:', status.error);
      return activate(HC.defaultState());
    }
    if (backup) {
      try { parse(backup); status.backupAvailable = true; }
      catch (error) { status.backupAvailable = false; }
    }
    if (raw) {
      try {
        var loaded = parse(raw);
        status.lastSavedAt = loaded.saved;
        return activate(loaded);
      } catch (error) {
        status.corrupt = true;
        // Сохраняем исходный текст отдельно перед следующим автосохранением.
        try { if (raw.length <= HC.SAVE_MAX_BYTES) window.localStorage.setItem(HC.SAVE_CORRUPT_KEY, raw); }
        catch (ignore) { /* резервная копия важнее повреждённого текста */ }
        console.warn('[Тихие холмы] основной сейв повреждён, проверяем копию');
      }
    }
    if (status.backupAvailable) {
      status.recovered = true;
      var restored = parse(backup);
      status.lastSavedAt = restored.saved;
      return activate(restored);
    }
    return activate(HC.defaultState());
  };

  HC.save = function (state, force) {
    // Обработчик выгрузки страницы не должен вернуть стёртый сейв обратно.
    if (!state || wiped || status.conflict) return false;
    var t = now();
    if (!force && t - lastWrite < 3000) return false;
    lastWrite = t;
    var snapshot, serialized;
    try {
      snapshot = migrate(state);
      snapshot.saved = t;
      serialized = JSON.stringify(snapshot);
      checkSize(serialized);
    } catch (error) {
      storageFailed(error);
      return false;
    }
    try {
      var previous = window.localStorage.getItem(HC.SAVE_KEY), validPrevious = false;
      if (previous !== expectedRaw) { storageConflict(); return false; }
      if (previous) {
        try { parse(previous); validPrevious = true; }
        catch (ignore) { /* повреждённый основной файл не заменяет копию */ }
      }
      try {
        // Первый сейв сразу имеет копию; затем она отстаёт на одно сохранение.
        if (validPrevious || !status.backupAvailable) {
          window.localStorage.setItem(HC.SAVE_BACKUP_KEY, validPrevious ? previous : serialized);
          status.backupAvailable = true;
        }
        status.backupError = '';
      } catch (backupError) {
        status.backupError = backupError && backupError.message ? backupError.message : 'Не удалось записать копию';
      }
      window.localStorage.setItem(HC.SAVE_KEY, serialized);
      expectedRaw = serialized;
      hasLoaded = true;
      state.saved = t;
      memoryOnly = false;
      status.error = '';
      status.lastSavedAt = t;
      return true;
    } catch (error) {
      storageFailed(error);
      console.warn('[Тихие холмы] не смог записать сейв:', status.error);
      return false;
    }
  };

  HC.storageStatus = function () {
    var code = status.conflict ? 'conflict' : memoryOnly ? 'memory-only' : status.recovered ? 'recovered' :
      status.corrupt ? 'corrupt' : status.backupError ? 'backup-unavailable' : 'ready';
    var messages = {
      'memory-only': 'Автосохранение недоступно. Сохрани прогресс в файл, прежде чем закрывать игру.',
      conflict: 'Прогресс изменился в другой вкладке. Перезагрузи эту вкладку, чтобы продолжить.',
      recovered: 'Прогресс восстановлен из резервной копии. Последние изменения могли не сохраниться.',
      corrupt: 'Сохранение повреждено, резервной копии нет. Исходный файл сохранён отдельно в браузере, если запись доступна.',
      'backup-unavailable': 'Прогресс сохранён, но резервная копия недоступна. Выгрузи файл на всякий случай.',
      ready: 'Прогресс сохраняется в этом браузере.'
    };
    return { available: !memoryOnly, memoryOnly: memoryOnly, code: code, message: messages[code],
      recovered: status.recovered, corrupt: status.corrupt, conflict: status.conflict, backupAvailable: status.backupAvailable,
      lastSavedAt: status.lastSavedAt };
  };

  /* Полностью убирает игру из памяти браузера и запрещает дальнейшую запись. */
  HC.wipe = function () {
    wiped = true;
    var removed = 0;
    try {
      var kill = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        // сам сейв и всё, что игра когда-либо могла записать под своим именем
        if (k === HC.SAVE_KEY || (k && k.indexOf('quiet-hills/') === 0)) kill.push(k);
      }
      for (var j = 0; j < kill.length; j++) {
        window.localStorage.removeItem(kill[j]);
        removed++;
      }
    } catch (e) { /* нечего чистить */ }
    try { window.sessionStorage.removeItem(HC.SAVE_KEY); } catch (e) { /* ничего */ }
    return removed;
  };

  HC.isWiped = function () { return wiped; };

  HC.isMemoryOnly = function () { return memoryOnly; };

  /* --- Экспорт/импорт ------------------------------------- */
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(b64.replace(/\s+/g, ''));
    if (bin.length > HC.SAVE_MAX_BYTES) throw tooLarge();
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  HC.exportCode = function (state) {
    var raw = JSON.stringify(migrate(state));
    checkSize(raw);
    return 'QH1:' + b64encode(raw);
  };

  HC.importCode = function (code) {
    code = String(code || '').trim();
    if (code.indexOf('QH1:') === 0) code = code.slice(4);
    if (code.length > Math.ceil(HC.SAVE_MAX_BYTES * 4 / 3) + 4) throw tooLarge();
    var json;
    try {
      json = code.charAt(0) === '{' ? code : b64decode(code);
      return parse(json);
    } catch (e) {
      if (e.message === tooLarge().message) throw e;
      throw new Error('Не похоже на сейв «Тихих холмов»');
    }
  };

  HC.exportFile = function (state) {
    var stamp = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var name = 'quiet-hills-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) +
               '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + '.json';
    var raw = JSON.stringify(migrate(state), null, 2);
    checkSize(raw);
    var blob = new Blob([raw], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    return name;
  };

  HC.importFile = function (file) {
    return new Promise(function (resolve, reject) {
      if (!file || typeof file.size !== 'number' || !isFinite(file.size) || file.size < 0) {
        reject(new Error('Не смог прочитать файл')); return;
      }
      if (file.size > HC.SAVE_MAX_BYTES) { reject(tooLarge()); return; }
      var r = new FileReader();
      r.onload = function () {
        try { resolve(HC.importCode(String(r.result))); }
        catch (e) { reject(e); }
      };
      r.onerror = function () { reject(new Error('Не смог прочитать файл')); };
      r.readAsText(file);
    });
  };
})(window.HC);
