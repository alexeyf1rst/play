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

  function now() { return Date.now(); }

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
        calmMode: false,
        shake: true,
        showHints: true
      }
    };
  };

  /* --- Починка/дополнение сейва после обновлений игры ------ */
  function migrate(s) {
    var d = HC.defaultState();
    if (!s || typeof s !== 'object') return d;

    function num(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }

    s.v = 1;
    s.coins = Math.max(0, num(s.coins, 0));
    s.ore = Math.max(0, num(s.ore, 0));
    s.owned = s.owned || { jeep: true };
    s.owned.jeep = true;
    s.tracks = s.tracks || { hills: true };
    s.tracks.hills = true;
    if (!HC.VEHICLES[s.vehicle] || !s.owned[s.vehicle]) s.vehicle = 'jeep';
    if (!HC.TRACKS[s.track]) s.track = 'hills';
    // рекорды нужны только по существующим трассам
    var cleanBest = {};
    for (var tb in (s.stats && s.stats.best) || {}) {
      if (HC.TRACKS[tb] && typeof s.stats.best[tb] === 'number' && isFinite(s.stats.best[tb])) {
        cleanBest[tb] = s.stats.best[tb];
      }
    }
    if (s.stats) s.stats.best = cleanBest;

    // прокачка — своя на каждую машину; тюнинга больше нет
    s.up = s.up || {};
    delete s.tune;
    for (var v in HC.VEHICLES) {
      var keep = defaultUpgrades();
      for (var u in keep) {
        keep[u] = Math.max(0, Math.min(HC.UPGRADES[u].max, num((s.up[v] || {})[u], 0)));
      }
      s.up[v] = keep;      // отменённые линии прокачки из старого сейва отпадают
    }

    // задания: списки пересобираются сами при смене дня/недели/месяца
    if (!s.quests || typeof s.quests !== 'object') s.quests = {};

    // база
    s.base = s.base || d.base;
    var plots = Array.isArray(s.base.plots) ? s.base.plots : [];
    var fixed = [];
    for (var i = 0; i < HC.PLOTS.spots.length; i++) {
      var p = plots[i];
      if (p && HC.BUILDINGS[p.type]) {
        var bd = HC.BUILDINGS[p.type];
        var lv = Math.max(0, Math.min(bd.max, Math.floor(num(p.level, 1))));
        var keep = { type: p.type, level: lv };
        var b = p.build;
        if (b && typeof b === 'object') {
          var to = Math.max(1, Math.min(bd.max, Math.floor(num(b.to, lv + 1))));
          var span = Math.max(1, num(b.span, HC.buildTimeOf(bd, to)));
          var end = num(b.end, now());
          // если часы перевели вперёд и обратно, стройка не должна зависнуть
          if (end > now() + span * 1000 + 60000) end = now() + span * 1000;
          if (to > lv) keep.build = { to: to, end: end, span: span };
        }
        // нулевой уровень без стройки — это просто пустой участок
        fixed.push(keep.level < 1 && !keep.build ? null : keep);
      } else fixed.push(null);
    }
    s.base.plots = fixed;
    s.base.unlocked = Math.max(HC.PLOTS.free, Math.min(HC.PLOTS.spots.length, num(s.base.unlocked, HC.PLOTS.free)));
    s.base.pending = s.base.pending || { coins: 0, ore: 0 };
    s.base.pending.coins = Math.max(0, num(s.base.pending.coins, 0));
    s.base.pending.ore = Math.max(0, num(s.base.pending.ore, 0));
    s.base.lastTick = num(s.base.lastTick, now());

    // статистика
    s.stats = s.stats || d.stats;
    s.stats.best = s.stats.best || {};
    s.stats.runs = num(s.stats.runs, 0);
    s.stats.totalDistance = num(s.stats.totalDistance, 0);
    s.stats.totalCoins = num(s.stats.totalCoins, 0);
    s.stats.playTime = num(s.stats.playTime, 0);
    s.stats.collected = num(s.stats.collected, 0);

    // настройки
    s.settings = s.settings || {};
    for (var key in d.settings) {
      if (typeof s.settings[key] !== typeof d.settings[key]) s.settings[key] = d.settings[key];
    }
    // Пока игрок сам не выбрал тему, он видит новую по умолчанию —
    // цветную. Выбрал руками — больше не трогаем.
    if (!s.settings.themePicked) s.settings.theme = 'color';
    s.created = num(s.created, now());
    return s;
  }

  /* --- Чтение/запись localStorage ------------------------- */
  HC.load = function () {
    var raw = null;
    try {
      raw = window.localStorage.getItem(HC.SAVE_KEY);
    } catch (e) {
      memoryOnly = true;
      console.warn('[Тихие холмы] localStorage недоступен, играем без автосохранения:', e && e.message);
    }
    if (!raw) return migrate(HC.defaultState());
    try {
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('[Тихие холмы] сейв повреждён, начинаем заново:', e && e.message);
      return migrate(HC.defaultState());
    }
  };

  HC.save = function (state, force) {
    // после стирания любые попытки записи игнорируются: иначе обработчик
    // выгрузки страницы успел бы вернуть старый сейв обратно
    if (!state || wiped) return false;
    var t = now();
    if (!force && t - lastWrite < 3000) return false;
    lastWrite = t;
    state.saved = t;
    if (memoryOnly) return false;
    try {
      window.localStorage.setItem(HC.SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      memoryOnly = true;
      console.warn('[Тихие холмы] не смог записать сейв:', e && e.message);
      return false;
    }
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
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  HC.exportCode = function (state) {
    return 'QH1:' + b64encode(JSON.stringify(state));
  };

  HC.importCode = function (code) {
    code = String(code || '').trim();
    if (code.indexOf('QH1:') === 0) code = code.slice(4);
    var json;
    try {
      json = code.charAt(0) === '{' ? code : b64decode(code);
      return migrate(JSON.parse(json));
    } catch (e) {
      throw new Error('Не похоже на сейв «Тихих холмов»');
    }
  };

  HC.exportFile = function (state) {
    var stamp = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var name = 'quiet-hills-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) +
               '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + '.json';
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
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
