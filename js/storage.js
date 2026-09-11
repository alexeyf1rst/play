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
        theme: 'paper',
        calmMode: false,
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
    if (!HC.TRACKS[s.track] || !s.tracks[s.track]) s.track = 'hills';

    // прокачка — своя на каждую машину
    s.up = s.up || {};
    for (var v in HC.VEHICLES) {
      s.up[v] = s.up[v] || defaultUpgrades();
      for (var u in HC.UPGRADES) {
        s.up[v][u] = Math.max(0, Math.min(HC.UPGRADES[u].max, num(s.up[v][u], 0)));
      }
    }

    // база
    s.base = s.base || d.base;
    var plots = Array.isArray(s.base.plots) ? s.base.plots : [];
    var fixed = [];
    for (var i = 0; i < HC.PLOTS.spots.length; i++) {
      var p = plots[i];
      if (p && HC.BUILDINGS[p.type]) {
        fixed.push({ type: p.type, level: Math.max(1, Math.min(HC.BUILDINGS[p.type].max, num(p.level, 1))) });
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
    if (!state) return false;
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

  HC.wipe = function () {
    try { window.localStorage.removeItem(HC.SAVE_KEY); } catch (e) { /* ничего страшного */ }
  };

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
