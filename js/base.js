/* ============================================================
   База: шахты, буры, склады.
   Считает добычу, рисует долину и ловит нажатия по участкам.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ========== Экономика =================================== */
  HC.Economy = {
    each: function (state, type, fn) {
      var p = state.base.plots;
      for (var i = 0; i < p.length; i++) if (p[i] && p[i].type === type) fn(p[i], i);
    },
    buildingRate: function (type, level) {
      var d = HC.BUILDINGS[type];
      if (!d.rate) return 0;
      return d.rate * Math.pow(d.rateMult, level - 1);
    },
    windmillBonus: function (state) {
      var b = 0;
      this.each(state, 'windmill', function (p) { b += HC.BUILDINGS.windmill.bonus * p.level; });
      return b;
    },
    workshopRide: function (state) {
      var b = 0;
      this.each(state, 'workshop', function (p) { b += HC.BUILDINGS.workshop.ridebonus * p.level; });
      return b;
    },
    workshopDiscount: function (state) {
      var b = 0;
      this.each(state, 'workshop', function (p) { b += HC.BUILDINGS.workshop.discount * p.level; });
      return Math.min(0.6, b);
    },
    rates: function (state) {
      var self = this, coins = 0, ore = 0;
      this.each(state, 'mine', function (p) { coins += self.buildingRate('mine', p.level); });
      this.each(state, 'drill', function (p) { ore += self.buildingRate('drill', p.level); });
      var m = 1 + this.windmillBonus(state);
      return { coins: coins * m, ore: ore * m };
    },
    capacity: function (state) {
      var c = 4000, o = 40, d = HC.BUILDINGS.storage;
      this.each(state, 'storage', function (p) {
        c += d.capCoins * Math.pow(d.capMult, p.level - 1);
        o += d.capOre * Math.pow(d.capMult, p.level - 1);
      });
      return { coins: Math.round(c), ore: Math.round(o) };
    },
    /* Плавильня: ест свежую руду из накопителя и кладёт монеты.
       Без буров копить нечего — она просто стоит. */
    smelter: function (state) {
      var coins = 0, ore = 0, d = HC.BUILDINGS.smelter;
      this.each(state, 'smelter', function (p) {
        coins += d.melt * Math.pow(d.meltMult, p.level - 1);
        ore += d.eats * p.level;
      });
      // ветряк ускоряет и плавильню — он ускоряет всё вокруг
      return { coins: coins * (1 + this.windmillBonus(state)), ore: ore };
    },

    /* Гараж: бак больше, расход меньше */
    garageFuel: function (state) {
      var b = 0;
      this.each(state, 'garage', function (p) { b += HC.BUILDINGS.garage.fuel * p.level; });
      return 1 + b;
    },
    garageBurn: function (state) {
      var b = 0;
      this.each(state, 'garage', function (p) { b += HC.BUILDINGS.garage.burn * p.level; });
      return Math.max(0.45, 1 - b);
    },

    /* Радиовышка: за задания платят больше */
    questBonus: function (state) {
      var b = 0;
      this.each(state, 'radio', function (p) { b += HC.BUILDINGS.radio.questBonus * p.level; });
      return 1 + b;
    },

    /* Депо: как часто оно само свозит добычу на склад, сек. 0 — нет депо */
    autoEvery: function (state) {
      var best = 0;
      this.each(state, 'depot', function (p) {
        var sec = HC.BUILDINGS.depot.auto * 60 / p.level;
        if (!best || sec < best) best = sec;
      });
      return best;
    },

    offlineHours: function (state) {
      var h = HC.ECON.offlineHoursBase;
      this.each(state, 'garden', function (p) { h += HC.BUILDINGS.garden.offline * p.level; });
      return h;
    },
    /* Копим добычу. dt в секундах. */
    accrue: function (state, seconds, online) {
      var r = this.rates(state), cap = this.capacity(state);
      var pend = state.base.pending;
      var before = { coins: pend.coins, ore: pend.ore };
      pend.coins = Math.min(cap.coins, pend.coins + r.coins / 60 * seconds);
      pend.ore = Math.min(cap.ore, pend.ore + r.ore / 60 * seconds);

      // плавильня забирает свежую руду и добавляет монет — ровно столько,
      // сколько руды нашлось
      var sm = this.smelter(state);
      var want = sm.ore / 60 * seconds;
      if (want > 0 && pend.ore > 0) {
        var got = Math.min(pend.ore, want);
        pend.ore -= got;
        pend.coins = Math.min(cap.coins, pend.coins + sm.coins / 60 * seconds * (got / want));
      }

      state.base.lastTick = Date.now();

      // депо само свозит накопленное на склад, пока игра открыта
      if (online) {
        var every = this.autoEvery(state);
        if (every) {
          state.base.autoT = (state.base.autoT || 0) + seconds;
          if (state.base.autoT >= every) { state.base.autoT = 0; this.collect(state); }
        }
      }
      return { coins: pend.coins - before.coins, ore: pend.ore - before.ore };
    },
    /* Что накопилось, пока игра была закрыта */
    applyOffline: function (state) {
      var elapsed = (Date.now() - (state.base.lastTick || Date.now())) / 1000;
      var maxSec = this.offlineHours(state) * 3600;
      var used = clamp(elapsed, 0, maxSec);
      var got = this.accrue(state, used);
      return { coins: got.coins, ore: got.ore, seconds: elapsed, capped: elapsed > maxSec };
    },
    collect: function (state) {
      var p = state.base.pending;
      var got = { coins: Math.floor(p.coins), ore: Math.floor(p.ore) };
      state.coins += got.coins;
      state.ore += got.ore;
      state.stats.collected += got.coins;
      p.coins -= got.coins;
      p.ore -= got.ore;
      return got;
    },
    plotCost: function (state) {
      var extra = state.base.unlocked - HC.PLOTS.free;
      return Math.round(HC.PLOTS.cost * Math.pow(HC.PLOTS.mult, extra));
    }
  };

  /* ========== Сцена базы: изометрическая долина ==============
     Раньше база была видом строго в профиль — ярусы-полки, на которых
     стоят домики. Теперь земля уходит вглубь ромбами: плитка 128×64,
     участок — 2×2 плитки, между участками дороги в одну плитку. Камера
     ездит в любую сторону и зумится, ближние постройки закрывают дальние. */

  var TW = 128, TH = 64;            // плитка
  var COLS = 19, ROWSN = 13;        // поле в плитках
  var STEP = 3;                     // участок 2×2 + дорога 1
  var EDGE = 60;                    // толщина плиты земли
  var PLATE_W = (COLS + ROWSN) * TW / 2;
  var PLATE_H = (COLS + ROWSN) * TH / 2;

  /* Плитка → мир */
  function iso(gx, gy) {
    return { x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 };
  }
  /* Мир → плитка */
  function unIso(x, y) {
    return {
      gx: (x / (TW / 2) + y / (TH / 2)) / 2,
      gy: (y / (TH / 2) - x / (TW / 2)) / 2
    };
  }
  function isRoad(gx, gy) { return gx % STEP === 0 || gy % STEP === 0; }

  /* Дымка вглубь: дальние объекты выцветают к небу */
  function depthFade(gx, gy) {
    return (1 - (gx + gy) / (COLS + ROWSN)) * 0.32;
  }

  /* Ступень постройки: чем выше уровень, тем больше на участке всего.
     Одна цифра на бейдже — это не награда, видно должно быть глазом. */
  function tier(level) { return level >= 8 ? 2 : (level >= 4 ? 1 : 0); }

  /* Обстановка на дорогах и по кромке */
  var DECOR = [
    { gx: 0,  gy: 4,  t: 'pine',  s: 1.05 }, { gx: 0,  gy: 10, t: 'tree',  s: 1 },
    { gx: 4,  gy: 0,  t: 'tree',  s: 0.95 }, { gx: 10, gy: 0,  t: 'pine',  s: 1 },
    { gx: 16, gy: 0,  t: 'rock',  s: 0.9 },  { gx: 18, gy: 4,  t: 'tree',  s: 1 },
    { gx: 18, gy: 10, t: 'pine',  s: 0.95 }, { gx: 7,  gy: 12, t: 'tree',  s: 1 },
    { gx: 13, gy: 12, t: 'bush',  s: 1 },    { gx: 1,  gy: 12, t: 'rock',  s: 0.85 },
    { gx: 3,  gy: 3,  t: 'lamp',  s: 1 },    { gx: 9,  gy: 3,  t: 'lamp',  s: 1 },
    { gx: 15, gy: 3,  t: 'lamp',  s: 1 },    { gx: 3,  gy: 9,  t: 'lamp',  s: 1 },
    { gx: 9,  gy: 9,  t: 'lamp',  s: 1 },    { gx: 15, gy: 9,  t: 'lamp',  s: 1 },
    { gx: 6,  gy: 6,  t: 'grass', s: 1.1 },  { gx: 12, gy: 6,  t: 'grass', s: 1.1 },
    { gx: 0,  gy: 0,  t: 'tower', s: 1 },    { gx: 17, gy: 12, t: 'flagpole', s: 1 },
    { gx: 6,  gy: 0,  t: 'crates', s: 0.9 }, { gx: 0,  gy: 7,  t: 'crates', s: 0.9 },
    { gx: 13, gy: 0, t: 'grass', s: 1 },     { gx: 18, gy: 7, t: 'bush', s: 0.9 }
  ];

  /* Жители: ходят по дорогам туда и обратно */
  var FOLK = [
    { ax: 'x', line: 3,  a: 0.6, b: 17.4, sp: 0.62, ph: 0.00 },
    { ax: 'y', line: 9,  a: 0.6, b: 12.4, sp: 0.48, ph: 0.37 },
    { ax: 'x', line: 9,  a: 1.0, b: 17.0, sp: 0.54, ph: 0.71 }
  ];

  var Base = {
    cam: { x: 0, y: 0 }, zoom: 1, t: 0,
    W: 1, H: 1,
    dragging: false, dragMoved: 0,
    spots: null, camInit: false,

    /* Участки: место на сетке считаем один раз */
    places: function () {
      if (!this.spots) {
        this.spots = HC.PLOTS.spots.map(function (s, i) {
          var c = iso(s.gx + 1, s.gy + 1);
          return {
            gx: s.gx, gy: s.gy, i: i,
            x: c.x, y: c.y + TH * 0.5,     // стоим у передней кромки площадки
            dep: s.gx + s.gy,
            fade: depthFade(s.gx + 1, s.gy + 1),
            scale: 1
          };
        });
      }
      return this.spots;
    },

    /* --- камера ------------------------------------------- */
    fitZoom: function (W, H) {
      return clamp(Math.min((W - 30) / (PLATE_W + 90), (H - 150) / (PLATE_H + 320)), 0.13, 1.6);
    },
    defaultZoom: function (W, H) {
      return clamp(Math.max(W / 1000, this.fitZoom(W, H)), 0.44, 1.15);
    },
    layout: function (W, H) {
      this.W = W; this.H = H;
      if (!this.camInit) {
        this.camInit = true;
        this.zoom = this.defaultZoom(W, H);
        // смотрим туда, где стоят первые открытые участки, а не в пустой угол
        var sp = this.places(), n = Math.max(1, Math.min(HC.PLOTS.free || 4, sp.length));
        var ax = 0, ay = 0;
        for (var k = 0; k < n; k++) { ax += sp[k].x; ay += sp[k].y; }
        this.cam.x = ax / n; this.cam.y = ay / n - 95;
      }
      this.clampCam();
    },
    clampCam: function () {
      var vw = this.W / this.zoom, vh = this.H / this.zoom;
      var x0 = -ROWSN * TW / 2 - 90, x1 = COLS * TW / 2 + 90;
      var y0 = -200, y1 = PLATE_H + EDGE + 150;
      if (vw >= x1 - x0) this.cam.x = (x0 + x1) / 2;
      else this.cam.x = clamp(this.cam.x, x0 + vw / 2, x1 - vw / 2);
      if (vh >= y1 - y0) this.cam.y = (y0 + y1) / 2;
      else this.cam.y = clamp(this.cam.y, y0 + vh / 2, y1 - vh / 2);
    },
    panBy: function (dx, dy) {
      this.cam.x -= dx / this.zoom;
      this.cam.y -= dy / this.zoom;
      this.clampCam();
    },
    setZoom: function (z, sx, sy) {
      var nz = clamp(z, Math.min(0.24, this.fitZoom(this.W, this.H)), 1.9);
      if (sx === undefined) { sx = this.W / 2; sy = this.H / 2; }
      var before = this.toWorld(sx, sy);
      this.zoom = nz;
      var after = this.toWorld(sx, sy);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
      this.clampCam();
    },
    zoomBy: function (k, sx, sy) { this.setZoom(this.zoom * k, sx, sy); },
    showAll: function () {
      this.zoom = this.fitZoom(this.W, this.H);
      this.cam.x = (COLS - ROWSN) * TW / 4;
      this.cam.y = PLATE_H / 2;
      this.clampCam();
    },

    /* Мир → экран (обратное к toWorld) */
    toScreen: function (x, y) {
      return {
        x: (x - this.cam.x) * this.zoom + this.W / 2,
        y: (y - this.cam.y) * this.zoom + this.H / 2
      };
    },

    toWorld: function (sx, sy) {
      return {
        x: (sx - this.W / 2) / this.zoom + this.cam.x,
        y: (sy - this.H / 2) / this.zoom + this.cam.y
      };
    },

    /* Куда ткнули: индекс участка или -1. Идём от ближних к дальним —
       что нарисовано поверх, то и нажимается. */
    hitTest: function (sx, sy, state) {
      var w = this.toWorld(sx, sy);
      var spots = this.places();
      var order = [];
      for (var i = 0; i < spots.length && i <= state.base.unlocked; i++) order.push(i);
      order.sort(function (a, b) { return spots[b].dep - spots[a].dep; });
      for (var k = 0; k < order.length; k++) {
        var idx = order[k], s = spots[idx];
        var plot = state.base.plots[idx];
        if (plot) {
          var hh = 50 + 120 * (1 + 0.1 * tier(plot.level));
          if (w.x > s.x - 88 && w.x < s.x + 94 && w.y > s.y - hh && w.y < s.y + 18) return idx;
        }
        var t0 = unIso(w.x, w.y - TH * 0.5);
        if (t0.gx >= s.gx && t0.gx < s.gx + 2 && t0.gy >= s.gy && t0.gy < s.gy + 2) return idx;
      }
      return -1;
    },

    update: function (dt) { this.t += dt; },

    /* --- отрисовка ---------------------------------------- */
    draw: function (g, W, H, P, state) {
      this.layout(W, H);

      var grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, P.sky0); grad.addColorStop(1, P.sky1);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      HC.drawSun(g, W, H, P, this.cam.x * 0.1, state.settings.theme === 'dark');
      HC.drawClouds(g, W, H, P, this.cam.x * 0.18, H * 0.2, this.t);
      HC.drawBirds(g, W, H, P, this.t, this.cam.x * 0.2);
      this.drawHills(g, W, H, P);

      g.save();
      g.translate(W / 2, H / 2);
      g.scale(this.zoom, this.zoom);
      g.translate(-this.cam.x, -this.cam.y);

      this.drawPlate(g, P);
      this.drawTiles(g, P);
      this.drawLinks(g, P, state);
      this.drawPads(g, P, state);
      this.drawRim(g, P);

      var items = this.collect(state);
      items.sort(function (a, b) { return a.dep - b.dep || a.x - b.x; });
      for (var i = 0; i < items.length; i++) items[i].draw.call(this, g, P, items[i], state);

      this.drawRopeway(g, P);
      g.restore();

      HC.drawVignette(g, W, H, P);
    },

    /* Дальние гряды за долиной: экранные координаты с параллаксом */
    drawHills: function (g, W, H, P) {
      var off = this.cam.x * 0.12, base = H * 0.44 - this.cam.y * 0.06 * this.zoom, x;
      g.save();
      g.fillStyle = P.far0;
      g.beginPath(); g.moveTo(-200, H);
      for (x = -200; x <= W + 200; x += 24) {
        g.lineTo(x, base - 46 + HC.noise((x + off) * 0.0022, 31) * 44 + HC.noise((x + off) * 0.007, 12) * 13);
      }
      g.lineTo(W + 200, H); g.closePath(); g.fill();
      g.fillStyle = P.far1;
      g.beginPath(); g.moveTo(-200, H);
      for (x = -200; x <= W + 200; x += 24) {
        g.lineTo(x, base + 22 + HC.noise((x + off * 1.4) * 0.0031 + 9, 77) * 32 + HC.noise((x + off) * 0.009, 5) * 10);
      }
      g.lineTo(W + 200, H); g.closePath(); g.fill();
      g.restore();
    },

    /* Плита земли: верх, толщина и камень в срезе. Толщина и даёт
       ощущение, что долина — кусок земли, а не картинка на полке. */
    drawPlate: function (g, P) {
      var n = iso(0, 0), e = iso(COLS, 0), s = iso(COLS, ROWSN), w = iso(0, ROWSN);

      // тень под плитой: она висит над землёй, а не лежит на ней
      g.save();
      g.globalAlpha = 0.2;
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.beginPath();
      g.moveTo(n.x + 30, n.y + EDGE + 26); g.lineTo(e.x + 30, e.y + EDGE + 26);
      g.lineTo(s.x + 30, s.y + EDGE + 26); g.lineTo(w.x + 30, w.y + EDGE + 26);
      g.closePath(); g.fill();
      g.restore();
      g.globalAlpha = 1;

      // срез плиты: сплошной тон, камень и тёмная нижняя кромка
      g.save();
      var wg = g.createLinearGradient(0, s.y - 40, 0, s.y + EDGE + 20);
      wg.addColorStop(0, P.groundDeep || P.ground);
      wg.addColorStop(0.75, P.groundDeep || P.ground);
      wg.addColorStop(1, P.hatch);
      g.fillStyle = wg;
      g.beginPath();
      g.moveTo(e.x, e.y); g.lineTo(s.x, s.y); g.lineTo(w.x, w.y);
      g.lineTo(w.x, w.y + EDGE); g.lineTo(s.x, s.y + EDGE); g.lineTo(e.x, e.y + EDGE);
      g.closePath(); g.fill();
      g.save(); g.clip();
      g.strokeStyle = P.hatch; g.globalAlpha = 0.4; g.lineWidth = 1.5;
      g.beginPath();
      for (var hx = w.x; hx < e.x; hx += 22) {
        g.moveTo(hx, s.y - 30); g.lineTo(hx - 10, s.y + EDGE);
        g.moveTo(hx - 14, s.y - 4); g.lineTo(hx + 12, s.y - 10);
      }
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
      // нижняя кромка чернилами — она и читается как толщина
      g.strokeStyle = P.ink;
      g.globalAlpha = 0.5;
      g.lineWidth = 2.2;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(e.x, e.y + EDGE); g.lineTo(s.x, s.y + EDGE); g.lineTo(w.x, w.y + EDGE);
      g.moveTo(e.x, e.y); g.lineTo(e.x, e.y + EDGE);
      g.moveTo(w.x, w.y); g.lineTo(w.x, w.y + EDGE);
      g.moveTo(s.x, s.y); g.lineTo(s.x, s.y + EDGE);
      g.stroke();
      g.globalAlpha = 1;
      g.restore();

      var tg = g.createLinearGradient(0, n.y, 0, s.y);
      tg.addColorStop(0, P.groundDeep || P.ground);
      tg.addColorStop(0.4, P.ground);
      tg.addColorStop(1, P.groundTop || P.ground);
      g.fillStyle = tg;
      g.beginPath();
      g.moveTo(n.x, n.y); g.lineTo(e.x, e.y); g.lineTo(s.x, s.y); g.lineTo(w.x, w.y);
      g.closePath(); g.fill();

      g.strokeStyle = P.ink;
      g.lineWidth = 2.6; g.lineJoin = 'round';
      g.globalAlpha = 0.7;
      g.beginPath();
      g.moveTo(n.x, n.y); g.lineTo(e.x, e.y); g.lineTo(s.x, s.y); g.lineTo(w.x, w.y);
      g.closePath(); g.stroke();
      g.globalAlpha = 1;
    },

    /* Дороги и сетка плиток */
    drawTiles: function (g, P) {
      var gx, gy, a, b, c, d;
      g.save();
      g.fillStyle = P.groundTop || P.ground;
      g.globalAlpha = 0.5;
      g.beginPath();
      for (gx = 0; gx < COLS; gx++) {
        for (gy = 0; gy < ROWSN; gy++) {
          if (!isRoad(gx, gy)) continue;
          a = iso(gx, gy); b = iso(gx + 1, gy); c = iso(gx + 1, gy + 1); d = iso(gx, gy + 1);
          g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y);
          g.closePath();
        }
      }
      g.fill();
      g.restore();
      g.globalAlpha = 1;

      g.save();
      g.strokeStyle = P.hatch;
      g.globalAlpha = 0.14;
      g.lineWidth = 1;
      g.beginPath();
      for (gx = 0; gx <= COLS; gx++) {
        a = iso(gx, 0); b = iso(gx, ROWSN);
        g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
      }
      for (gy = 0; gy <= ROWSN; gy++) {
        a = iso(0, gy); b = iso(COLS, gy);
        g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
      }
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
    },

    /* Площадки участков: приподнятые пятачки с бортиком */
    drawPads: function (g, P, state) {
      var spots = this.places(), self = this;
      spots.forEach(function (s, i) {
        var open = i < state.base.unlocked;
        var next = i === state.base.unlocked;
        if (!open && !next) return;
        var a = iso(s.gx, s.gy), b = iso(s.gx + 2, s.gy), c = iso(s.gx + 2, s.gy + 2), d = iso(s.gx, s.gy + 2);
        var lift = open ? 13 : 4;
        g.save();
        g.globalAlpha = 1 - s.fade * 0.6;
        g.fillStyle = P.sideFace || P.groundDeep || P.ground;
        g.beginPath();
        g.moveTo(b.x, b.y - lift); g.lineTo(c.x, c.y - lift); g.lineTo(d.x, d.y - lift);
        g.lineTo(d.x, d.y); g.lineTo(c.x, c.y); g.lineTo(b.x, b.y);
        g.closePath(); g.fill();
        g.strokeStyle = P.ink;
        g.globalAlpha = (1 - s.fade) * 0.3;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y);
        g.stroke();
        g.globalAlpha = 1 - s.fade * 0.6;
        g.fillStyle = open ? P.ground : (P.groundTop || P.ground);
        g.beginPath();
        g.moveTo(a.x, a.y - lift); g.lineTo(b.x, b.y - lift); g.lineTo(c.x, c.y - lift); g.lineTo(d.x, d.y - lift);
        g.closePath(); g.fill();
        g.strokeStyle = P.ink;
        g.globalAlpha = (1 - s.fade) * (open ? 0.45 : 0.3);
        g.lineWidth = 1.8;
        if (!open) g.setLineDash([7, 6]);
        g.beginPath();
        g.moveTo(a.x, a.y - lift); g.lineTo(b.x, b.y - lift); g.lineTo(c.x, c.y - lift); g.lineTo(d.x, d.y - lift);
        g.closePath(); g.stroke();
        g.setLineDash([]);
        g.restore();
        g.globalAlpha = 1;
        if (open && !state.base.plots[i]) self.drawEmpty(g, s, P);
        if (next) self.drawLocked(g, s, P);
      });
    },

    /* Ограда по кромке плиты, с проездом у ворот */
    drawRim: function (g, P) {
      g.save();
      g.strokeStyle = P.ink;
      g.globalAlpha = 0.38;
      g.lineWidth = 1.8;
      g.lineCap = 'round';
      function run(x0, y0, x1, y1, skip) {
        var n = 28, i, f;
        for (i = 0; i <= n; i++) {
          f = i / n;
          if (skip && f > skip[0] && f < skip[1]) continue;
          var px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
          g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - 15); g.stroke();
        }
        g.beginPath();
        var started = false;
        for (i = 0; i <= n; i++) {
          f = i / n;
          var qx = x0 + (x1 - x0) * f, qy = y0 + (y1 - y0) * f - 11;
          if (skip && f > skip[0] && f < skip[1]) { started = false; continue; }
          if (!started) { g.moveTo(qx, qy); started = true; } else g.lineTo(qx, qy);
        }
        g.stroke();
      }
      var n0 = iso(0, 0), e0 = iso(COLS, 0), s0 = iso(COLS, ROWSN), w0 = iso(0, ROWSN);
      run(n0.x, n0.y, e0.x, e0.y);
      run(n0.x, n0.y, w0.x, w0.y);
      run(e0.x, e0.y, s0.x, s0.y, [0.41, 0.59]);
      run(w0.x, w0.y, s0.x, s0.y);
      g.restore();
      g.globalAlpha = 1;
    },

    /* Связи: труба от бура к складу, рельсы от шахты к складу и линия
       от ветряка. Рисуем по земле, до построек. */
    drawLinks: function (g, P, state) {
      var spots = this.places(), here = [], i;
      for (i = 0; i < spots.length && i < state.base.unlocked; i++) {
        var pl = state.base.plots[i];
        if (pl) here.push({ x: spots[i].x, y: spots[i].y, gx: spots[i].gx, gy: spots[i].gy,
                            type: pl.type, level: pl.level, fade: spots[i].fade });
      }
      if (here.length < 2) return;

      function nearest(from, type) {
        var best = null, bd = 1e9;
        here.forEach(function (o) {
          if (o.type !== type || o === from) return;
          var d = Math.hypot(o.x - from.x, o.y - from.y);
          if (d < bd) { bd = d; best = o; }
        });
        return best ? { o: best, d: bd } : null;
      }

      // Маршрут по дорогам: из центра участка выходим на дорожную
      // клетку, идём вдоль неё и заходим к соседу. Так связи лежат по
      // улицам, а не режут долину наискось.
      function route(a2, b2) {
        var pts = [
          { gx: a2.gx + 1, gy: a2.gy + 1 },
          { gx: a2.gx, gy: a2.gy + 1 },
          { gx: a2.gx, gy: b2.gy + 1 },
          { gx: b2.gx + 1, gy: b2.gy + 1 }
        ];
        return pts.map(function (q) { return iso(q.gx, q.gy); });
      }
      function polyline(pts, lift) {
        g.beginPath();
        pts.forEach(function (q, k) {
          if (k === 0) g.moveTo(q.x, q.y - lift); else g.lineTo(q.x, q.y - lift);
        });
        g.stroke();
      }

      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';

      // труба от бура к складу: на опорах над землёй
      here.forEach(function (o) {
        if (o.type !== 'drill') return;
        var to = nearest(o, 'storage');
        if (!to || to.d > 700) return;
        var pts = route(o, to.o);
        g.strokeStyle = P.ink;
        g.globalAlpha = 0.4;
        g.lineWidth = 4;
        polyline(pts, 20);
        g.lineWidth = 1.6;
        for (var k = 0; k < pts.length - 1; k++) {
          var A = pts[k], B = pts[k + 1];
          var n = Math.max(1, Math.round(Math.hypot(B.x - A.x, B.y - A.y) / 64));
          for (var j = 0; j <= n; j++) {
            var f = j / n;
            var px = A.x + (B.x - A.x) * f, py = A.y + (B.y - A.y) * f;
            g.beginPath(); g.moveTo(px, py - 20); g.lineTo(px, py); g.stroke();
          }
        }
      });

      // рельсы от шахты к складу
      here.forEach(function (o) {
        if (o.type !== 'mine') return;
        var to = nearest(o, 'storage');
        if (!to || to.d > 700) return;
        var pts = route(o, to.o);
        g.strokeStyle = P.ink;
        g.globalAlpha = 0.28;
        g.lineWidth = 1.6;
        polyline(pts, 3);
        polyline(pts, 8);
        for (var k2 = 0; k2 < pts.length - 1; k2++) {
          var A2 = pts[k2], B2 = pts[k2 + 1];
          var len = Math.hypot(B2.x - A2.x, B2.y - A2.y);
          var m = Math.max(1, Math.round(len / 15));
          for (var j2 = 0; j2 <= m; j2++) {
            var f2 = j2 / m;
            var qx = A2.x + (B2.x - A2.x) * f2, qy = A2.y + (B2.y - A2.y) * f2;
            g.beginPath(); g.moveTo(qx, qy - 2); g.lineTo(qx, qy - 9); g.stroke();
          }
        }
      });

      // линия от ветряка: только к соседним участкам, иначе получается паутина
      here.forEach(function (mill) {
        if (mill.type !== 'windmill') return;
        here.forEach(function (o) {
          if (o === mill) return;
          if (Math.abs(o.gx - mill.gx) > 3 || Math.abs(o.gy - mill.gy) > 3) return;
          g.strokeStyle = P.ink;
          g.globalAlpha = 0.26;
          g.lineWidth = 1.3;
          var ay = mill.y - 104, by = o.y - 58;
          g.beginPath();
          g.moveTo(mill.x, ay);
          g.quadraticCurveTo((mill.x + o.x) / 2, (ay + by) / 2 + 18, o.x, by);
          g.stroke();
          g.globalAlpha = 0.32;
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(o.x, o.y - 8); g.lineTo(o.x, by - 4); g.stroke();
        });
      });

      g.restore();
      g.globalAlpha = 1;
    },
    /* Всё, что стоит на земле — одним списком, чтобы отсортировать по
       глубине: ближнее закрывает дальнее, как и должно быть в изометрии. */
    collect: function (state) {
      var out = [], spots = this.places(), self = this;

      spots.forEach(function (s, i) {
        if (i >= state.base.unlocked) return;
        var plot = state.base.plots[i];
        if (!plot) return;
        out.push({
          dep: s.dep + 1.4, x: s.x, s: s, plot: plot,
          draw: function (g, P, it) { this.drawBuilding(g, it.plot.type, it.plot.level, it.s, P); }
        });
      });

      DECOR.forEach(function (d) {
        var c = iso(d.gx + 0.5, d.gy + 0.5);
        out.push({
          dep: d.gx + d.gy + 1, x: c.x, y: c.y, d: d,
          draw: function (g, P, it) {
            g.save();
            g.globalAlpha = 1 - depthFade(it.d.gx, it.d.gy);
            g.translate(it.x, it.y);
            HC.Decor.shadow(g, P, 13 * it.d.s, 0.18);
            HC.Decor.draw(g, it.d.t, P, it.d.s, (it.d.gx + it.d.gy) % 2 === 0);
            g.restore();
            g.globalAlpha = 1;
          }
        });
      });

      // жители
      FOLK.forEach(function (f, n) {
        var span = f.b - f.a;
        var u = (self.t * f.sp + f.ph * span * 2) % (span * 2);
        var back = u > span;
        var v = f.a + (back ? span * 2 - u : u);
        var gx = f.ax === 'x' ? v : f.line + 0.5;
        var gy = f.ax === 'x' ? f.line + 0.5 : v;
        var c = iso(gx, gy);
        out.push({
          dep: gx + gy + 1, x: c.x, y: c.y, back: back, n: n,
          draw: function (g, P, it) { this.drawFolk(g, P, it); }
        });
      });

      // вагонетка катается по дороге
      var span2 = 16.8;
      var u2 = (this.t * 0.5) % (span2 * 2);
      var cback = u2 > span2;
      var cv = 0.6 + (cback ? span2 * 2 - u2 : u2);
      var cc = iso(cv, 6.5);
      out.push({
        dep: cv + 7.5, x: cc.x, y: cc.y, back: cback,
        draw: function (g, P, it) { this.drawCart(g, P, it); }
      });

      // ворота с вывеской и машина у въезда
      var gate = iso(COLS, ROWSN / 2);
      out.push({
        dep: COLS + ROWSN / 2 + 0.4, x: gate.x, y: gate.y,
        draw: function (g, P, it) { this.drawSign(g, P, it); }
      });
      var park = iso(COLS - 0.9, ROWSN / 2 + 1.7);
      out.push({
        dep: COLS + ROWSN / 2 + 0.9, x: park.x, y: park.y,
        draw: function (g, P, it, st) { this.drawParked(g, P, st, it); }
      });

      // опоры канатки
      [[12.5, 0.5], [0.5, 12.5]].forEach(function (pp) {
        var c = iso(pp[0], pp[1]);
        out.push({
          dep: pp[0] + pp[1] + 0.6, x: c.x, y: c.y,
          draw: function (g, P, it) { this.drawPylon(g, P, it); }
        });
      });

      return out;
    },

    /* Житель: маленькая фигурка. Рядом с ней видно настоящий размер силоса. */
    drawFolk: function (g, P, it) {
      var st = Math.sin(this.t * 7.4 + it.n * 2.1);
      g.save();
      g.globalAlpha = 1 - depthFade(unIso(it.x, it.y).gx, unIso(it.x, it.y).gy);
      g.translate(it.x, it.y);
      g.scale(it.back ? -1 : 1, 1);
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.globalAlpha *= 1;
      g.save(); g.scale(1, 0.5);
      g.beginPath(); g.arc(0, 0, 7, 0, 6.3); g.fill();
      g.restore();
      g.strokeStyle = P.ink;
      g.lineWidth = 2.2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(0, -13); g.lineTo(st * 4, 0);
      g.moveTo(0, -13); g.lineTo(-st * 4, 0);
      g.moveTo(0, -13); g.lineTo(0, -26);
      g.moveTo(0, -22); g.lineTo(-st * 3.5, -15);
      g.moveTo(0, -22); g.lineTo(st * 3.5, -15);
      g.stroke();
      g.fillStyle = P.bodyHi || P.bodyFill;
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, -30, 4, 0, 6.3); g.fill(); g.stroke();
      g.restore();
      g.globalAlpha = 1;
    },

    /* Вагонетка на дороге: единственное, что само куда-то едет */
    drawCart: function (g, P, it) {
      g.save();
      g.translate(it.x, it.y);
      g.scale(it.back ? -1 : 1, 1);
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.save(); g.scale(1, 0.5);
      g.beginPath(); g.arc(0, 0, 17, 0, 6.3); g.fill();
      g.restore();
      g.strokeStyle = P.ink;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.fillStyle = P.hatch;
      g.beginPath();
      g.moveTo(-11, -20); g.quadraticCurveTo(-4, -29, 2, -23);
      g.quadraticCurveTo(7, -29, 11, -20);
      g.closePath(); g.fill();
      var bg = g.createLinearGradient(0, -21, 0, -5);
      bg.addColorStop(0, P.bodyHi || P.bodyFill);
      bg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(-15, -21); g.lineTo(15, -21); g.lineTo(12, -5); g.lineTo(-12, -5);
      g.closePath(); g.fill(); g.stroke();
      g.globalAlpha = 0.5;
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-8, -20); g.lineTo(-7, -6); g.moveTo(8, -20); g.lineTo(7, -6); g.stroke();
      g.globalAlpha = 1;
      g.lineWidth = 1.8;
      g.fillStyle = P.bodyShade || P.bodyFill;
      [-8, 8].forEach(function (wx) {
        g.beginPath(); g.arc(wx, -3, 3.6, 0, 6.3); g.fill(); g.stroke();
      });
      g.restore();
    },

    /* Опора канатки */
    drawPylon: function (g, P, it) {
      var h = 210, w = 19;
      g.save();
      g.globalAlpha = 1 - depthFade(unIso(it.x, it.y).gx, unIso(it.x, it.y).gy) * 0.6;
      g.translate(it.x, it.y);
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.save(); g.scale(1, 0.5);
      g.beginPath(); g.arc(6, 0, 26, 0, 6.3); g.fill();
      g.restore();
      g.strokeStyle = P.ink;
      g.lineJoin = 'round';
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(-w, 0); g.lineTo(-6, -h);
      g.moveTo(w, 0); g.lineTo(6, -h);
      g.stroke();
      g.lineWidth = 1.4;
      g.globalAlpha *= 0.6;
      g.beginPath();
      for (var k = 0; k < 7; k++) {
        var ya = -h * k / 7, yb = -h * (k + 1) / 7;
        var wa = w - (w - 6) * k / 7, wb = w - (w - 6) * (k + 1) / 7;
        g.moveTo(-wa, ya); g.lineTo(wb, yb);
        g.moveTo(wa, ya); g.lineTo(-wb, yb);
        g.moveTo(-wb, yb); g.lineTo(wb, yb);
      }
      g.stroke();
      g.globalAlpha = 1 - depthFade(unIso(it.x, it.y).gx, unIso(it.x, it.y).gy) * 0.6;
      g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(-13, -h); g.lineTo(13, -h); g.stroke();
      g.fillStyle = P.bodyHi || P.bodyFill;
      g.beginPath(); g.arc(0, -h - 5, 5, 0, 6.3); g.fill(); g.stroke();
      g.restore();
      g.globalAlpha = 1;
    },

    /* Трос канатки с бадьями — поверх всего, он же над долиной */
    drawRopeway: function (g, P) {
      var a = iso(12.5, 0.5), b = iso(0.5, 12.5);
      var ay = a.y - 215, by = b.y - 215, sag = 34;
      function pt(u) {
        return {
          x: a.x + (b.x - a.x) * u,
          y: ay + (by - ay) * u + sag * 4 * u * (1 - u)
        };
      }
      g.save();
      g.strokeStyle = P.ink;
      g.lineJoin = 'round';
      g.globalAlpha = 0.65;
      g.lineWidth = 2;
      g.beginPath();
      for (var i = 0; i <= 32; i++) {
        var q = pt(i / 32);
        if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y);
      }
      g.stroke();
      g.globalAlpha = 0.3;
      g.lineWidth = 1.4;
      g.beginPath();
      for (var k = 0; k <= 32; k++) {
        var q2 = pt(k / 32);
        if (k === 0) g.moveTo(q2.x, q2.y + 13); else g.lineTo(q2.x, q2.y + 13);
      }
      g.stroke();
      g.globalAlpha = 1;

      var ph = (this.t * 0.035) % 1;
      [ph, (ph + 0.5) % 1].forEach(function (u, n) {
        var c = pt(u);
        g.save();
        g.translate(c.x, c.y + (n ? 13 : 0));
        g.lineWidth = 1.8;
        g.beginPath(); g.arc(0, 0, 3.4, 0, 6.3); g.stroke();
        g.beginPath(); g.moveTo(0, 3); g.lineTo(0, 14); g.stroke();
        var cg = g.createLinearGradient(0, 14, 0, 38);
        cg.addColorStop(0, P.bodyHi || P.bodyFill);
        cg.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = cg;
        g.beginPath();
        g.moveTo(-12, 14); g.lineTo(12, 14); g.lineTo(10, 36); g.lineTo(-10, 36);
        g.closePath(); g.fill(); g.stroke();
        g.globalAlpha = 0.45;
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(-6, 15); g.lineTo(-5, 35); g.moveTo(6, 15); g.lineTo(5, 35);
        g.moveTo(-11, 24); g.lineTo(11, 24);
        g.stroke();
        g.globalAlpha = 0.75;
        g.fillStyle = P.hatch;
        g.beginPath();
        g.moveTo(-9, 14); g.quadraticCurveTo(-3, 7, 1, 12); g.quadraticCurveTo(5, 7, 9, 14);
        g.closePath(); g.fill();
        g.restore();
        g.globalAlpha = 1;
      });
      g.restore();
    },

    /* Ворота с вывеской на въезде */
    drawSign: function (g, P, it) {
      g.save();
      g.translate(it.x, it.y);
      g.strokeStyle = P.ink; g.lineWidth = 4;
      g.beginPath(); g.moveTo(-52, 6); g.lineTo(-52, -74); g.moveTo(52, 6); g.lineTo(52, -74); g.stroke();
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(-56, -74); g.quadraticCurveTo(0, -92, 56, -74); g.stroke();
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(-52, -60); g.lineTo(-38, -74); g.moveTo(52, -60); g.lineTo(38, -74); g.stroke();
      g.translate(0, -18);
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -34); g.stroke();
      var sg = g.createLinearGradient(0, -62, 0, -34);
      sg.addColorStop(0, P.bodyHi || P.bodyFill);
      sg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = sg; g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-44, -50); g.lineTo(44, -50); g.lineTo(44, -30); g.lineTo(-44, -30);
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = P.ink;
      g.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('ДОЛИНА', 0, -39);
      g.textBaseline = 'alphabetic';
      g.restore();
    },

    /* Твоя машина стоит у въезда — видно, на чём поедешь */
    drawParked: function (g, P, state, it) {
      var def = HC.VEHICLES[state.vehicle];
      if (!def) return;
      g.save();
      g.translate(it.x, it.y);
      g.scale(0.82, 0.82);
      g.globalAlpha = 0.5;
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.save(); g.scale(1, 0.3);
      g.beginPath(); g.arc(6, 0, 58, 0, 6.3); g.fill();
      g.restore();
      g.globalAlpha = 1;
      var rest = def.susp.rest;
      var fake = {
        def: def, ang: 0, pos: { x: 0, y: -rest - def.wheel.r - def.axles[0].y },
        wheels: def.axles.map(function (a) {
          return { pos: { x: a.x, y: -(def.wheel.r) + (a.r ? def.wheel.r - a.r : 0) }, r: a.r || def.wheel.r, spinAngle: 0.3 };
        })
      };
      HC.Vehicle.prototype.draw.call(fake, g, P);
      g.restore();
    },

    /* Пустой участок: крестик по центру площадки */
    drawEmpty: function (g, s, P) {
      g.save();
      g.translate(s.x, s.y - 26);
      g.strokeStyle = P.ink;
      g.globalAlpha = (1 - s.fade) * 0.4;
      g.lineWidth = 4.2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-19, 0); g.lineTo(19, 0); g.moveTo(0, -19); g.lineTo(0, 19);
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
    },

    /* Следующий участок: висит замок — понятно, что его можно выкупить */
    drawLocked: function (g, s, P) {
      g.save();
      g.translate(s.x, s.y - 30);
      g.strokeStyle = P.ink;
      g.fillStyle = P.bodyFill;
      g.globalAlpha = (1 - s.fade) * 0.45;
      g.lineWidth = 2.4;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(-7, -9); g.lineTo(-7, -14);
      g.quadraticCurveTo(0, -22, 7, -14); g.lineTo(7, -9);
      g.stroke();
      g.beginPath();
      g.roundRect ? g.roundRect(-11, -9, 22, 16, 3) : g.rect(-11, -9, 22, 16);
      g.fill(); g.stroke();
      g.restore();
      g.globalAlpha = 1;
    },

    /* Картинка постройки для списков в интерфейсе.
       Рисуется тем же кодом, что и на базе, поэтому в магазине
       видно ровно то, что появится в долине. */
    thumb: function (type, P, W, H) {
      this._thumbs = this._thumbs || {};
      var key = type + '|' + W + '|' + P.ink;
      if (this._thumbs[key]) return this._thumbs[key];

      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var c = document.createElement('canvas');
      c.width = W * dpr; c.height = H * dpr;
      var g = c.getContext('2d');
      g.scale(dpr, dpr);

      // общая рамка и общая линия земли — постройки в списке стоят рядом,
      // как стояли бы в долине, и видно, кто выше
      var box = { x0: -80, x1: 80, y0: -106, y1: 12 };
      var s = Math.min(W / (box.x1 - box.x0), H / (box.y1 - box.y0));
      g.translate(W / 2, H - 2);
      g.scale(s, s);
      g.translate(-(box.x0 + box.x1) / 2, -box.y1);

      g.strokeStyle = P.ink;
      var tgr = g.createLinearGradient(0, -90, 0, 10);
      tgr.addColorStop(0, P.bodyHi || P.bodyFill);
      tgr.addColorStop(0.55, P.bodyFill);
      tgr.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = tgr;
      g.lineWidth = 2.4;
      g.lineJoin = 'round';
      var fn = this.shapes[type];
      if (fn) fn.call(this, g, P, 1, 0.75);

      this._thumbs[key] = c.toDataURL('image/png');
      return this._thumbs[key];
    },

    /* Палитра в один тон: ею рисуется боковая грань постройки. */
    flatTone: function (tone) {
      this._flat = this._flat || {};
      if (!this._flat[tone]) {
        this._flat[tone] = {
          ink: tone, bodyFill: tone, bodyHi: tone, bodyShade: tone,
          rim: tone, rimShade: tone, far0: tone, far1: tone,
          ground: tone, groundDeep: tone, groundTop: tone, sky0: tone,
          hatch: tone, shadow: 'rgba(0,0,0,0)'
        };
      }
      return this._flat[tone];
    },

    /* --- Постройки ---------------------------------------- */
    drawBuilding: function (g, type, level, s, P) {
      var fn = this.shapes[type];
      if (!fn) return;
      var sc = s.scale || 1;
      var fade = 1 - (s.fade || 0);
      var grow = 1.18 * (1 + 0.04 * tier(level));   // прокачанная постройка и крупнее
      // Соседние участки не должны выглядеть обоями: через один постройка
      // смотрит в другую сторону, и время у каждой своё — колёса и вагонетки
      // не ходят строем.
      var flip = ((s.i || 0) % 2) ? -1 : 1;
      var tt = this.t + (s.i || 0) * 0.83;

      // тень на земле
      g.save();
      g.globalAlpha = 0.5 * fade;
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.translate(s.x + 16, s.y - 10);
      g.scale(1, 0.5);
      g.beginPath();
      g.arc(0, 0, 52, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.globalAlpha = 1;

      // боковая грань: тот же силуэт, сдвинутый и залитый одним тоном.
      // Отсюда и берётся объём — постройка перестаёт быть наклейкой.
      var tone = P.sideFace || P.groundDeep || P.ground;
      g.save();
      g.globalAlpha = 0.95 * fade;
      g.translate(s.x + 11 * sc, s.y - 6 * sc);
      g.scale(flip * sc * grow, sc * grow);
      g.strokeStyle = tone;
      g.fillStyle = tone;
      g.lineWidth = 2.4;
      g.lineJoin = 'round';
      fn.call(this, g, this.flatTone(tone), level, tt);
      g.restore();
      g.globalAlpha = 1;

      // сама постройка
      g.save();
      g.globalAlpha = fade;
      g.translate(s.x, s.y);
      g.scale(flip * sc * grow, sc * grow);
      g.strokeStyle = P.ink;
      var bg = g.createLinearGradient(0, -90, 0, 10);
      bg.addColorStop(0, P.bodyHi || P.bodyFill);
      bg.addColorStop(0.55, P.bodyFill);
      bg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = bg;
      g.lineWidth = 2.4;
      g.lineJoin = 'round';
      fn.call(this, g, P, level, tt);
      g.restore();
      g.globalAlpha = 1;

      this.drawBadge(g, s.x, s.y + 13 * sc, level, P, sc);
    },

    drawBadge: function (g, x, y, level, P, sc) {
      sc = sc || 1;
      g.save();
      g.translate(x, y);
      g.scale(sc, sc);
      g.fillStyle = P.ink;
      g.globalAlpha = 0.85;
      g.globalAlpha = 0.7;
      g.beginPath();
      g.roundRect ? g.roundRect(-14, -9, 28, 18, 9) : g.rect(-14, -9, 28, 18);
      g.fill();
      g.fillStyle = P.sky0;
      g.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(level), 0, 1);
      g.restore();
      g.globalAlpha = 1;
      g.textBaseline = 'alphabetic';
    },

    shapes: {
      /* Шахта: копёр с колесом, укреплённый вход, рельсы и вагонетка */
      mine: function (g, P, level, t) {
        var ink = P.ink;
        // отвал породы
        g.fillStyle = P.far1;
        g.beginPath();
        g.moveTo(-62, 0); g.quadraticCurveTo(-46, -34, -30, -42);
        g.quadraticCurveTo(-14, -30, -2, 0);
        g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 1.3; g.globalAlpha = 0.5;
        g.beginPath(); g.moveTo(-48, -12); g.lineTo(-38, -22); g.moveTo(-24, -18); g.lineTo(-14, -8); g.stroke();
        g.globalAlpha = 1; g.lineWidth = 2.4;

        // копёр
        g.strokeStyle = ink; g.lineWidth = 2.8;
        g.beginPath(); g.moveTo(-42, -40); g.lineTo(-30, -82); g.lineTo(-18, -40); g.stroke();
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(-37, -58); g.lineTo(-23, -58); g.moveTo(-40, -48); g.lineTo(-20, -48); g.stroke();
        g.beginPath(); g.moveTo(-37, -58); g.lineTo(-20, -48); g.moveTo(-23, -58); g.lineTo(-40, -48); g.stroke();
        // колесо копра
        g.save(); g.translate(-30, -86); g.rotate(t * 0.55);
        var wg = g.createLinearGradient(-13, -13, 13, 13);
        wg.addColorStop(0, P.bodyHi || P.rim); wg.addColorStop(1, P.rimShade || P.rim);
        g.fillStyle = wg; g.lineWidth = 2.4;
        g.beginPath(); g.arc(0, 0, 13, 0, 6.3); g.fill(); g.stroke();
        g.lineWidth = 1.6;
        for (var s2 = 0; s2 < 6; s2++) {
          var a = s2 / 6 * Math.PI * 2;
          g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); g.stroke();
        }
        g.beginPath(); g.arc(0, 0, 3.2, 0, 6.3); g.stroke();
        g.restore();
        // трос
        g.lineWidth = 1.6; g.globalAlpha = 0.7;
        g.beginPath(); g.moveTo(-30, -86); g.lineTo(-30, -34); g.stroke();
        g.globalAlpha = 1;

        // вход, укреплённый брусом
        g.lineWidth = 2.4;
        g.fillStyle = ink;
        g.beginPath();
        g.moveTo(-44, 0); g.lineTo(-44, -22); g.quadraticCurveTo(-30, -36, -16, -22); g.lineTo(-16, 0);
        g.closePath(); g.fill();
        g.strokeStyle = ink; g.lineWidth = 3.4;
        g.beginPath();
        g.moveTo(-48, 0); g.lineTo(-48, -24); g.quadraticCurveTo(-30, -40, -12, -24); g.lineTo(-12, 0);
        g.stroke();

        // рельсы со шпалами
        g.lineWidth = 1.6;
        for (var i = 0; i < 9; i++) {
          g.beginPath(); g.moveTo(-12 + i * 8, -7); g.lineTo(-12 + i * 8, 1); g.stroke();
        }
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(-14, -6); g.lineTo(62, -6); g.moveTo(-14, 0); g.lineTo(62, 0); g.stroke();

        // вагонетка с рудой
        var k = Math.sin(t * 0.32) * 0.5 + 0.5;
        var cx = 2 + k * 46;
        g.save(); g.translate(cx, -14);
        var cg = g.createLinearGradient(0, -12, 0, 8);
        cg.addColorStop(0, P.bodyHi || P.bodyFill); cg.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = cg; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(-13, -11); g.lineTo(13, -11); g.lineTo(10, 7); g.lineTo(-10, 7); g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = P.ink;
        g.beginPath();
        g.moveTo(-11, -11); g.lineTo(-5, -16); g.lineTo(1, -12); g.lineTo(7, -17); g.lineTo(11, -11);
        g.closePath(); g.fill();
        g.fillStyle = P.rim; g.lineWidth = 2;
        g.beginPath(); g.arc(-6, 9, 3.6, 0, 6.3); g.fill(); g.stroke();
        g.beginPath(); g.arc(6, 9, 3.6, 0, 6.3); g.fill(); g.stroke();
        g.restore();

        var T = tier(level);
        if (T >= 1) {
          // бункер на ногах в конце рельсов: вагонетке есть куда ссыпать
          g.strokeStyle = P.ink; g.lineWidth = 2;
          g.beginPath();
          g.moveTo(54, -20); g.lineTo(54, 0); g.moveTo(78, -20); g.lineTo(78, 0);
          g.moveTo(54, -8); g.lineTo(78, -8);
          g.stroke();
          g.fillStyle = P.far1;
          g.beginPath();
          g.moveTo(52, 0); g.quadraticCurveTo(66, -14, 80, 0);
          g.closePath(); g.fill(); g.stroke();
          var hg2 = g.createLinearGradient(0, -48, 0, -20);
          hg2.addColorStop(0, P.bodyHi || P.bodyFill);
          hg2.addColorStop(1, P.bodyShade || P.bodyFill);
          g.fillStyle = hg2; g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(50, -48); g.lineTo(82, -48); g.lineTo(72, -22); g.lineTo(60, -22);
          g.closePath(); g.fill(); g.stroke();
          g.lineWidth = 1.4; g.globalAlpha = 0.5;
          g.beginPath(); g.moveTo(52, -40); g.lineTo(80, -40); g.stroke();
          g.globalAlpha = 1; g.lineWidth = 2.2;
          if (T < 2) {
            // фонарь над входом
            g.lineWidth = 2;
            g.beginPath(); g.moveTo(-66, -2); g.lineTo(-66, -54); g.lineTo(-56, -54); g.stroke();
            g.fillStyle = P.bodyHi || P.bodyFill;
            g.beginPath();
            g.moveTo(-61, -52); g.lineTo(-51, -52); g.lineTo(-54, -44); g.lineTo(-58, -44);
            g.closePath(); g.fill(); g.stroke();
          }
        }
        if (T >= 2) {
          // второй копёр: шахта разрослась во вторую штольню
          g.save();
          g.translate(-70, 0); g.scale(0.72, 0.72);
          g.strokeStyle = P.ink; g.lineWidth = 3.6;
          g.beginPath(); g.moveTo(-16, -6); g.lineTo(0, -76); g.lineTo(16, -6); g.stroke();
          g.lineWidth = 2.6;
          g.beginPath(); g.moveTo(-11, -48); g.lineTo(11, -48); g.moveTo(-13, -30); g.lineTo(13, -30); g.stroke();
          g.beginPath(); g.moveTo(-11, -48); g.lineTo(13, -30); g.moveTo(11, -48); g.lineTo(-13, -30); g.stroke();
          g.save(); g.translate(0, -80); g.rotate(-t * 0.44);
          g.fillStyle = P.bodyHi || P.rim; g.lineWidth = 3;
          g.beginPath(); g.arc(0, 0, 11, 0, 6.3); g.fill(); g.stroke();
          g.lineWidth = 2;
          for (var q = 0; q < 6; q++) {
            var aq = q / 6 * Math.PI * 2;
            g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(aq) * 11, Math.sin(aq) * 11); g.stroke();
          }
          g.restore();
          g.fillStyle = P.ink;
          g.beginPath();
          g.moveTo(-13, 0); g.lineTo(-13, -18); g.quadraticCurveTo(0, -30, 13, -18); g.lineTo(13, 0);
          g.closePath(); g.fill();
          g.restore();
        }
      },

      /* Бур: вышка с раскосами, кронблок и будка */
      drill: function (g, P, level, t) {
        // площадка
        g.fillStyle = P.far1; g.strokeStyle = P.ink; g.lineWidth = 2.2;
        g.beginPath(); g.rect(-46, -6, 92, 8); g.fill(); g.stroke();

        var dg = g.createLinearGradient(-30, -86, 30, 0);
        dg.addColorStop(0, P.bodyHi || P.bodyFill);
        dg.addColorStop(1, P.bodyShade || P.bodyFill);

        // ноги вышки
        g.strokeStyle = P.ink; g.lineWidth = 2.8;
        g.beginPath(); g.moveTo(-28, -6); g.lineTo(-10, -84); g.moveTo(28, -6); g.lineTo(10, -84); g.stroke();
        // раскосы
        g.lineWidth = 1.7;
        for (var i = 0; i < 5; i++) {
          var f0 = i / 5, f1 = (i + 1) / 5;
          var lx0 = -28 + 18 * f0, rx0 = 28 - 18 * f0, y0 = -6 - 78 * f0;
          var lx1 = -28 + 18 * f1, rx1 = 28 - 18 * f1, y1 = -6 - 78 * f1;
          g.beginPath(); g.moveTo(lx0, y0); g.lineTo(rx0, y0); g.stroke();
          g.beginPath(); g.moveTo(lx0, y0); g.lineTo(rx1, y1); g.moveTo(rx0, y0); g.lineTo(lx1, y1); g.stroke();
        }
        // кронблок
        g.lineWidth = 2.4; g.fillStyle = dg;
        g.beginPath(); g.rect(-12, -92, 24, 9); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(-8, -92); g.lineTo(0, -99); g.lineTo(8, -92); g.stroke();

        // бурильная труба и долото
        g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(0, -83); g.lineTo(0, -22); g.stroke();
        g.save(); g.translate(0, -14); g.rotate(t * 1.9);
        g.fillStyle = P.rim; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(-8, -9); g.lineTo(8, -9); g.lineTo(0, 10); g.closePath();
        g.fill(); g.stroke();
        g.restore();

        // будка с трубой
        g.fillStyle = dg; g.lineWidth = 2.2;
        g.beginPath(); g.rect(32, -30, 30, 24); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(30, -30); g.lineTo(47, -40); g.lineTo(64, -30); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = P.ink;
        g.beginPath(); g.rect(42, -20, 11, 14); g.fill();

        var T = tier(level);
        if (T >= 1) {
          // бак под добытое и труба к нему
          g.strokeStyle = P.ink; g.fillStyle = dg; g.lineWidth = 2.2;
          g.beginPath(); g.rect(-80, -38, 30, 32); g.fill(); g.stroke();
          g.beginPath();
          g.moveTo(-80, -38); g.quadraticCurveTo(-65, -48, -50, -38);
          g.closePath(); g.fill(); g.stroke();
          g.lineWidth = 1.5; g.globalAlpha = 0.55;
          g.beginPath(); g.moveTo(-80, -26); g.lineTo(-50, -26); g.moveTo(-80, -15); g.lineTo(-50, -15); g.stroke();
          g.globalAlpha = 1; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(-50, -20); g.lineTo(-36, -20); g.lineTo(-36, -6); g.stroke();
        }
        if (T >= 2) {
          // факельная труба с дымком и вторая мачта пониже
          g.lineWidth = 2.4; g.fillStyle = dg;
          g.beginPath(); g.rect(70, -70, 13, 64); g.fill(); g.stroke();
          g.beginPath(); g.rect(67, -76, 19, 7); g.fill(); g.stroke();
          g.save(); g.globalAlpha = 0.2; g.fillStyle = P.ink;
          for (var d2 = 0; d2 < 3; d2++) {
            var pd = (t * 0.18 + d2 / 3) % 1;
            g.beginPath(); g.arc(77 + Math.sin(pd * 5) * 7, -80 - pd * 34, 3 + pd * 7, 0, 6.3); g.fill();
          }
          g.restore(); g.globalAlpha = 1;
          // труборяд по площадке и вентиль у бака
          g.strokeStyle = P.ink; g.lineWidth = 2.4; g.lineCap = 'round';
          g.beginPath();
          g.moveTo(-42, -10); g.lineTo(-8, -10); g.moveTo(-42, -15); g.lineTo(-8, -15);
          g.stroke();
          g.lineCap = 'butt'; g.lineWidth = 1.8;
          g.beginPath(); g.arc(-52, -12, 4.5, 0, 6.3); g.stroke();
          g.beginPath(); g.moveTo(-57, -12); g.lineTo(-47, -12); g.moveTo(-52, -17); g.lineTo(-52, -7); g.stroke();
        }
      },

      /* Склад: силос с конической крышей, лестница, бочки */
      storage: function (g, P, level, t) {
        var sg = g.createLinearGradient(-34, 0, 34, 0);
        sg.addColorStop(0, P.bodyHi || P.bodyFill);
        sg.addColorStop(0.55, P.bodyFill);
        sg.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = sg; g.strokeStyle = P.ink; g.lineWidth = 2.4;

        // корпус
        g.beginPath(); g.rect(-32, -60, 64, 60); g.fill(); g.stroke();
        // обручи
        g.lineWidth = 1.5; g.globalAlpha = 0.7;
        g.beginPath();
        g.moveTo(-32, -46); g.lineTo(32, -46);
        g.moveTo(-32, -30); g.lineTo(32, -30);
        g.moveTo(-32, -14); g.lineTo(32, -14);
        g.stroke();
        g.globalAlpha = 1; g.lineWidth = 2.4;
        // крыша
        g.beginPath();
        g.moveTo(-38, -60); g.lineTo(0, -84); g.lineTo(38, -60);
        g.closePath(); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(0, -84); g.lineTo(0, -90); g.stroke();
        // дверь
        g.fillStyle = P.ink;
        g.beginPath(); g.moveTo(-11, 0); g.lineTo(-11, -18); g.quadraticCurveTo(0, -26, 11, -18); g.lineTo(11, 0);
        g.closePath(); g.fill();
        // лестница сбоку
        g.strokeStyle = P.ink; g.lineWidth = 1.8;
        g.beginPath(); g.moveTo(24, 0); g.lineTo(24, -58); g.moveTo(30, 0); g.lineTo(30, -58); g.stroke();
        for (var i = 0; i < 7; i++) {
          g.beginPath(); g.moveTo(24, -6 - i * 8); g.lineTo(30, -6 - i * 8); g.stroke();
        }
        var T = tier(level);
        if (T >= 1) {
          // навес с ящиками: складу мало одного силоса
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          g.fillStyle = P.bodyFill;
          g.beginPath();
          g.moveTo(34, -40); g.lineTo(74, -30); g.lineTo(74, -25); g.lineTo(34, -35);
          g.closePath(); g.fill(); g.stroke();
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(70, -28); g.lineTo(70, 0); g.moveTo(38, -36); g.lineTo(38, 0); g.stroke();
          g.save(); g.translate(56, 0); g.scale(0.8, 0.8);
          HC.Decor.draw(g, 'crates', P, 1, true);
          g.restore();
        }
        if (T >= 2) {
          // второй силос и транспортёр к нему
          g.save();
          g.translate(-58, 0); g.scale(0.5, 0.5);
          g.strokeStyle = P.ink; g.lineWidth = 4.4;
          g.fillStyle = P.bodyFill;
          g.beginPath(); g.rect(-32, -60, 64, 60); g.fill(); g.stroke();
          g.beginPath();
          g.moveTo(-38, -60); g.lineTo(0, -84); g.lineTo(38, -60);
          g.closePath(); g.fill(); g.stroke();
          g.lineWidth = 3; g.globalAlpha = 0.6;
          g.beginPath(); g.moveTo(-32, -40); g.lineTo(32, -40); g.moveTo(-32, -20); g.lineTo(32, -20); g.stroke();
          g.globalAlpha = 1;
          g.fillStyle = P.ink;
          g.beginPath(); g.rect(-10, -20, 20, 20); g.fill();
          g.restore();
          // транспортёр рамой: лента, стойки и мешки на ней
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(-46, -30); g.lineTo(-20, -54); g.stroke();
          g.beginPath(); g.moveTo(-42, -24); g.lineTo(-16, -48); g.stroke();
          g.lineWidth = 1.5;
          for (var cr = 0; cr < 3; cr++) {
            var cu = cr / 2;
            g.beginPath();
            g.moveTo(-46 + cu * 26, -30 - cu * 24);
            g.lineTo(-42 + cu * 26, -24 - cu * 24);
            g.stroke();
          }
          g.fillStyle = P.ink;
          for (var cq = 0; cq < 3; cq++) {
            var cf = ((t * 0.22 + cq / 3) % 1);
            g.beginPath();
            g.arc(-44 + cf * 26, -27 - cf * 24, 2.6, 0, 6.3);
            g.fill();
          }
        }

        // бочки
        g.lineWidth = 2.2;
        (T >= 2 ? [[46, 0.8]] : [[-50, 1], [-63, 0.85]]).forEach(function (b) {
          g.save(); g.translate(b[0], 0); g.scale(b[1], b[1]);
          var bg = g.createLinearGradient(-9, 0, 9, 0);
          bg.addColorStop(0, P.bodyHi || P.bodyFill); bg.addColorStop(1, P.bodyShade || P.bodyFill);
          g.fillStyle = bg;
          g.beginPath(); g.rect(-9, -22, 18, 22); g.fill(); g.stroke();
          g.lineWidth = 1.3;
          g.beginPath(); g.moveTo(-9, -16); g.lineTo(9, -16); g.moveTo(-9, -7); g.lineTo(9, -7); g.stroke();
          g.lineWidth = 2.2;
          g.restore();
        });
      },

      /* Ветряк: настоящая мельница с колпаком, балконом и решётчатыми крыльями */
      windmill: function (g, P, level, t) {
        var mg = g.createLinearGradient(-26, 0, 26, 0);
        mg.addColorStop(0, P.bodyHi || P.bodyFill);
        mg.addColorStop(0.5, P.bodyFill);
        mg.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = mg; g.strokeStyle = P.ink; g.lineWidth = 2.4;

        // башня
        g.beginPath();
        g.moveTo(-24, 0); g.lineTo(-12, -68); g.lineTo(12, -68); g.lineTo(24, 0);
        g.closePath(); g.fill(); g.stroke();
        // кладка
        g.lineWidth = 1.3; g.globalAlpha = 0.45;
        g.beginPath();
        g.moveTo(-20, -22); g.lineTo(20, -22);
        g.moveTo(-16, -44); g.lineTo(16, -44);
        g.stroke();
        g.globalAlpha = 1; g.lineWidth = 2.4;
        // балкон
        g.beginPath(); g.rect(-22, -38, 44, 5); g.fill(); g.stroke();
        g.lineWidth = 1.5;
        for (var i = 0; i < 6; i++) {
          g.beginPath(); g.moveTo(-20 + i * 8, -38); g.lineTo(-20 + i * 8, -45); g.stroke();
        }
        g.beginPath(); g.moveTo(-21, -45); g.lineTo(21, -45); g.stroke();
        // дверь и окно
        g.lineWidth = 2.2;
        g.fillStyle = P.ink;
        g.beginPath(); g.moveTo(-8, 0); g.lineTo(-8, -14); g.quadraticCurveTo(0, -21, 8, -14); g.lineTo(8, 0);
        g.closePath(); g.fill();
        g.fillStyle = P.rim;
        g.beginPath(); g.arc(0, -54, 5, 0, 6.3); g.fill(); g.stroke();
        // колпак
        g.fillStyle = mg;
        g.beginPath();
        g.moveTo(-16, -68); g.quadraticCurveTo(0, -88, 16, -68);
        g.closePath(); g.fill(); g.stroke();

        // крылья — решётка, а не глухие треугольники
        g.save();
        g.translate(0, -72);
        g.rotate(t * 0.26);
        g.lineWidth = 2.2;
        for (var b = 0; b < 4; b++) {
          g.save(); g.rotate(b / 4 * Math.PI * 2);
          g.beginPath(); g.moveTo(0, -4); g.lineTo(0, -46); g.stroke();
          g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(-7, -10); g.lineTo(-7, -44); g.moveTo(5, -10); g.lineTo(5, -44); g.stroke();
          for (var r2 = 0; r2 < 5; r2++) {
            var yy = -12 - r2 * 8;
            g.beginPath(); g.moveTo(-7, yy); g.lineTo(5, yy); g.stroke();
          }
          g.lineWidth = 2.2;
          g.restore();
        }
        g.fillStyle = P.ink;
        g.beginPath(); g.arc(0, 0, 4.5, 0, 6.3); g.fill();
        g.restore();

        var T = tier(level);
        if (T >= 1) {
          // амбар с мешками: мельница обросла хозяйством
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          g.fillStyle = P.bodyFill;
          g.beginPath(); g.rect(-72, -30, 42, 30); g.fill(); g.stroke();
          g.beginPath();
          g.moveTo(-77, -30); g.lineTo(-51, -46); g.lineTo(-25, -30);
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = P.ink;
          g.beginPath(); g.rect(-59, -18, 16, 18); g.fill();
          g.strokeStyle = P.ink; g.lineWidth = 2;
          g.fillStyle = P.bodyFill;
          [[-30, 1], [-20, 0.8]].forEach(function (b2) {
            g.save(); g.translate(b2[0], 0); g.scale(b2[1], b2[1]);
            g.beginPath();
            g.moveTo(-8, 0); g.quadraticCurveTo(-9, -14, 0, -16);
            g.quadraticCurveTo(9, -14, 8, 0);
            g.closePath(); g.fill(); g.stroke();
            g.restore();
          });
        }
        if (T >= 2) {
          // вторая мельница поменьше
          g.save();
          g.translate(60, 0); g.scale(0.5, 0.5);
          var m2 = g.createLinearGradient(-26, 0, 26, 0);
          m2.addColorStop(0, P.bodyHi || P.bodyFill);
          m2.addColorStop(1, P.bodyShade || P.bodyFill);
          g.fillStyle = m2; g.strokeStyle = P.ink; g.lineWidth = 4;
          g.beginPath();
          g.moveTo(-24, 0); g.lineTo(-12, -68); g.lineTo(12, -68); g.lineTo(24, 0);
          g.closePath(); g.fill(); g.stroke();
          g.beginPath();
          g.moveTo(-16, -68); g.quadraticCurveTo(0, -88, 16, -68);
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = P.ink;
          g.beginPath(); g.rect(-8, -16, 16, 16); g.fill();
          g.save();
          g.translate(0, -72); g.rotate(-t * 0.31 + 1.1);
          g.strokeStyle = P.ink; g.lineWidth = 4;
          for (var b3 = 0; b3 < 4; b3++) {
            g.save(); g.rotate(b3 / 4 * Math.PI * 2);
            g.beginPath(); g.moveTo(0, -4); g.lineTo(0, -42); g.stroke();
            g.lineWidth = 2.8;
            g.beginPath(); g.moveTo(-7, -10); g.lineTo(-7, -40); g.moveTo(5, -10); g.lineTo(5, -40); g.stroke();
            for (var r4 = 0; r4 < 4; r4++) {
              var ry = -13 - r4 * 9;
              g.beginPath(); g.moveTo(-7, ry); g.lineTo(5, ry); g.stroke();
            }
            g.lineWidth = 4;
            g.restore();
          }
          g.restore();
          g.restore();
        }
      },

      /* Мастерская: дом с крыльцом, вывеской, верстаком и дымком */
      workshop: function (g, P, level, t) {
        var hg = g.createLinearGradient(0, -46, 0, 0);
        hg.addColorStop(0, P.bodyHi || P.bodyFill);
        hg.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = hg; g.strokeStyle = P.ink; g.lineWidth = 2.4;

        // труба и дымок
        g.beginPath(); g.rect(22, -80, 13, 28); g.fill(); g.stroke();
        g.beginPath(); g.rect(20, -84, 17, 6); g.fill(); g.stroke();
        g.save();
        g.globalAlpha = 0.22; g.fillStyle = P.ink;
        for (var i = 0; i < 4; i++) {
          var p = (t * 0.22 + i / 4) % 1;
          g.beginPath();
          g.arc(28 + Math.sin(p * 5.2) * 9, -88 - p * 44, 4 + p * 9, 0, 6.3);
          g.fill();
        }
        g.restore();
        g.globalAlpha = 1;

        // корпус
        g.fillStyle = hg;
        g.beginPath(); g.rect(-48, -44, 96, 44); g.fill(); g.stroke();
        // крыша с карнизом
        g.beginPath();
        g.moveTo(-58, -44); g.lineTo(0, -76); g.lineTo(58, -44);
        g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 1.4; g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(-44, -52); g.lineTo(44, -52); g.moveTo(-30, -60); g.lineTo(30, -60);
        g.stroke();
        g.globalAlpha = 1; g.lineWidth = 2.2;

        // дверь с козырьком
        g.fillStyle = P.ink;
        g.beginPath(); g.rect(-34, -28, 22, 28); g.fill();
        g.strokeStyle = P.ink;
        g.beginPath(); g.moveTo(-40, -30); g.lineTo(-6, -30); g.stroke();
        // окно с переплётом
        g.fillStyle = P.rim;
        g.beginPath(); g.rect(4, -34, 30, 22); g.fill(); g.stroke();
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(19, -34); g.lineTo(19, -12); g.moveTo(4, -23); g.lineTo(34, -23); g.stroke();

        // вывеска
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(48, -38); g.lineTo(62, -38); g.stroke();
        var sg2 = g.createLinearGradient(0, -38, 0, -20);
        sg2.addColorStop(0, P.bodyHi || P.bodyFill); sg2.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = sg2;
        g.beginPath(); g.rect(52, -34, 18, 14); g.fill(); g.stroke();
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(57, -30); g.lineTo(65, -24); g.moveTo(65, -30); g.lineTo(57, -24); g.stroke();

        // верстак
        g.lineWidth = 2.2; g.fillStyle = P.bodyFill;
        g.beginPath(); g.rect(-74, -16, 22, 4); g.fill(); g.stroke();
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(-70, -12); g.lineTo(-70, 0); g.moveTo(-56, -12); g.lineTo(-56, 0); g.stroke();
        g.beginPath(); g.arc(-63, -22, 5, 0, 6.3); g.stroke();

        var T = tier(level);
        if (T >= 1) {
          // навес над верстаком и подвесная лампа
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          g.fillStyle = P.bodyFill;
          g.beginPath();
          g.moveTo(-86, -44); g.lineTo(-44, -52); g.lineTo(-44, -46); g.lineTo(-86, -38);
          g.closePath(); g.fill(); g.stroke();
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(-83, -40); g.lineTo(-83, 0); g.moveTo(-47, -48); g.lineTo(-47, 0); g.stroke();
          g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(-65, -45); g.lineTo(-65, -33); g.stroke();
          g.fillStyle = P.bodyHi || P.bodyFill;
          g.beginPath();
          g.moveTo(-71, -33); g.lineTo(-59, -33); g.lineTo(-63, -26); g.lineTo(-67, -26);
          g.closePath(); g.fill(); g.stroke();
          // стопка покрышек под навесом
          g.lineWidth = 1.8; g.strokeStyle = P.ink;
          for (var r3 = 0; r3 < 3; r3++) {
            g.beginPath(); g.ellipse(-80, -5 - r3 * 7, 9, 3.8, 0, 0, 6.3); g.stroke();
          }
        }
        if (T >= 2) {
          // мансарда и вторая труба — дом подрос
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          var dg2 = g.createLinearGradient(0, -76, 0, -52);
          dg2.addColorStop(0, P.bodyHi || P.bodyFill);
          dg2.addColorStop(1, P.bodyShade || P.bodyFill);
          g.fillStyle = dg2;
          g.beginPath();
          g.moveTo(-26, -58); g.lineTo(-26, -74); g.lineTo(-8, -84); g.lineTo(10, -74); g.lineTo(10, -58);
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = P.rim;
          g.beginPath(); g.rect(-19, -72, 20, 13); g.fill(); g.stroke();
          g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(-9, -72); g.lineTo(-9, -59); g.stroke();
          // флюгер
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(-8, -84); g.lineTo(-8, -96); g.stroke();
          g.fillStyle = P.ink;
          g.beginPath();
          g.moveTo(-8, -96); g.lineTo(6, -92); g.lineTo(-8, -88);
          g.closePath(); g.fill();
        }
      },

      /* Плавильня: печь с трубой, ковш на рельсе и отвал шлака */
      smelter: function (g, P, level, t) {
        var T = tier(level);
        var fg = g.createLinearGradient(-30, -70, 30, 0);
        fg.addColorStop(0, P.bodyHi || P.bodyFill);
        fg.addColorStop(1, P.bodyShade || P.bodyFill);
        g.strokeStyle = P.ink; g.lineWidth = 2.4; g.lineJoin = 'round';

        // труба и дым
        g.fillStyle = fg;
        g.beginPath();
        g.moveTo(22, -52); g.lineTo(26, -96); g.lineTo(40, -96); g.lineTo(44, -52);
        g.closePath(); g.fill(); g.stroke();
        g.beginPath(); g.rect(23, -102, 20, 7); g.fill(); g.stroke();
        g.save(); g.globalAlpha = 0.22; g.fillStyle = P.ink;
        for (var i = 0; i < 4; i++) {
          var pf = (t * 0.2 + i / 4) % 1;
          g.beginPath();
          g.arc(33 + Math.sin(pf * 5.4) * 10, -106 - pf * 46, 4 + pf * 10, 0, 6.3);
          g.fill();
        }
        g.restore(); g.globalAlpha = 1;

        // корпус печи — усечённый конус
        g.fillStyle = fg;
        g.beginPath();
        g.moveTo(-44, 0); g.lineTo(-34, -58); g.lineTo(14, -58); g.lineTo(24, 0);
        g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 1.4; g.globalAlpha = 0.45;
        g.beginPath();
        g.moveTo(-40, -22); g.lineTo(20, -22); g.moveTo(-37, -40); g.lineTo(17, -40);
        g.stroke();
        g.globalAlpha = 1; g.lineWidth = 2.4;
        // колпак
        g.beginPath();
        g.moveTo(-38, -58); g.quadraticCurveTo(-10, -74, 18, -58);
        g.closePath(); g.fill(); g.stroke();
        // лётка: светится
        g.fillStyle = P.ink;
        g.beginPath(); g.rect(-26, -20, 22, 20); g.fill();
        g.fillStyle = P.bodyHi || P.bodyFill;
        g.globalAlpha = 0.55 + Math.sin(t * 2.4) * 0.2;
        g.beginPath(); g.rect(-22, -14, 14, 14); g.fill();
        g.globalAlpha = 1;
        // отвал шлака
        g.fillStyle = P.far1; g.strokeStyle = P.ink; g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-72, 0); g.quadraticCurveTo(-58, -24, -44, 0);
        g.closePath(); g.fill(); g.stroke();

        if (T >= 1) {
          // ковш на рельсе: катает расплав от лётки
          g.lineWidth = 1.8; g.strokeStyle = P.ink;
          g.beginPath(); g.moveTo(-4, -4); g.lineTo(64, -4); g.moveTo(-4, 0); g.lineTo(64, 0); g.stroke();
          var lx = 12 + (Math.sin(t * 0.5) * 0.5 + 0.5) * 44;
          g.save(); g.translate(lx, -6);
          g.fillStyle = P.bodyFill; g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(-10, -16); g.lineTo(10, -16); g.lineTo(7, -4); g.lineTo(-7, -4);
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = P.ink; g.globalAlpha = 0.8;
          g.beginPath(); g.rect(-8, -16, 16, 3); g.fill();
          g.globalAlpha = 1;
          g.lineWidth = 1.6;
          g.beginPath(); g.arc(-5, -2, 2.6, 0, 6.3); g.stroke();
          g.beginPath(); g.arc(5, -2, 2.6, 0, 6.3); g.stroke();
          g.restore();
          // вторая труба пониже
          g.fillStyle = fg; g.lineWidth = 2.2;
          g.beginPath(); g.rect(50, -74, 13, 70); g.fill(); g.stroke();
          g.beginPath(); g.rect(47, -80, 19, 7); g.fill(); g.stroke();
        }
        if (T >= 2) {
          // эстакада с бункером над печью
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          g.fillStyle = P.bodyFill;
          g.beginPath();
          g.moveTo(-78, -60); g.lineTo(-50, -74); g.lineTo(-36, -74); g.lineTo(-36, -66); g.lineTo(-74, -52);
          g.closePath(); g.fill(); g.stroke();
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(-74, -54); g.lineTo(-74, -4); g.stroke();
          g.fillStyle = P.bodyShade || P.bodyFill; g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(-40, -84); g.lineTo(-16, -84); g.lineTo(-22, -68); g.lineTo(-34, -68);
          g.closePath(); g.fill(); g.stroke();
        }
      },

      /* Гараж: арочный ангар с воротами и колонкой */
      garage: function (g, P, level, t) {
        var T = tier(level);
        var gg = g.createLinearGradient(0, -58, 0, 0);
        gg.addColorStop(0, P.bodyHi || P.bodyFill);
        gg.addColorStop(1, P.bodyShade || P.bodyFill);
        g.strokeStyle = P.ink; g.lineWidth = 2.4; g.lineJoin = 'round';

        // ангар
        g.fillStyle = gg;
        g.beginPath();
        g.moveTo(-52, 0); g.lineTo(-52, -34);
        g.quadraticCurveTo(-52, -62, -8, -62);
        g.quadraticCurveTo(36, -62, 36, -34); g.lineTo(36, 0);
        g.closePath(); g.fill(); g.stroke();
        // рёбра ангара
        g.lineWidth = 1.4; g.globalAlpha = 0.4;
        [-30, -8, 14].forEach(function (rx) {
          g.beginPath();
          g.moveTo(rx, 0); g.lineTo(rx, -40);
          g.stroke();
        });
        g.globalAlpha = 1; g.lineWidth = 2.4;
        // ворота
        g.fillStyle = P.ink;
        g.beginPath();
        g.moveTo(-38, 0); g.lineTo(-38, -30);
        g.quadraticCurveTo(-38, -48, -8, -48);
        g.quadraticCurveTo(22, -48, 22, -30); g.lineTo(22, 0);
        g.closePath(); g.fill();
        // створки
        g.strokeStyle = P.bodyHi || P.bodyFill; g.lineWidth = 1.6; g.globalAlpha = 0.5;
        for (var q = -32; q < 20; q += 9) {
          g.beginPath(); g.moveTo(q, -2); g.lineTo(q, -40); g.stroke();
        }
        g.globalAlpha = 1;
        // канистры
        g.strokeStyle = P.ink; g.lineWidth = 2; g.fillStyle = P.bodyFill;
        [[-66, 1], [-78, 0.82]].forEach(function (b) {
          g.save(); g.translate(b[0], 0); g.scale(b[1], b[1]);
          g.beginPath(); g.rect(-7, -17, 14, 17); g.fill(); g.stroke();
          g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(-7, -11); g.lineTo(7, -11); g.stroke();
          g.restore();
        });

        if (T >= 1) {
          // колонка со шлангом
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          g.fillStyle = P.bodyFill;
          g.beginPath(); g.rect(48, -40, 20, 40); g.fill(); g.stroke();
          g.beginPath(); g.rect(46, -46, 24, 7); g.fill(); g.stroke();
          g.fillStyle = P.ink;
          g.beginPath(); g.rect(52, -34, 12, 9); g.fill();
          g.lineWidth = 1.8; g.strokeStyle = P.ink;
          g.beginPath();
          g.moveTo(68, -30); g.quadraticCurveTo(80, -24, 76, -8);
          g.stroke();
          // подъёмник у ворот
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(-46, 0); g.lineTo(-46, -20); g.moveTo(-52, -20); g.lineTo(-40, -20); g.stroke();
        }
        if (T >= 2) {
          // второй бокс и вывеска
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          g.fillStyle = gg;
          g.beginPath();
          g.moveTo(36, 0); g.lineTo(36, -30);
          g.quadraticCurveTo(36, -50, 62, -50);
          g.lineTo(86, -50); g.lineTo(86, 0);
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = P.ink;
          g.beginPath();
          g.moveTo(46, 0); g.lineTo(46, -26);
          g.quadraticCurveTo(46, -40, 64, -40); g.lineTo(78, -40); g.lineTo(78, 0);
          g.closePath(); g.fill();
          g.strokeStyle = P.ink; g.lineWidth = 2;
          g.beginPath(); g.moveTo(-8, -62); g.lineTo(-8, -76); g.stroke();
          g.fillStyle = P.bodyHi || P.bodyFill;
          g.beginPath(); g.rect(-32, -90, 48, 16); g.fill(); g.stroke();
          g.lineWidth = 1.8;
          g.beginPath();
          g.moveTo(-24, -78); g.lineTo(-14, -86);
          g.moveTo(-14, -86); g.lineTo(-10, -83);
          g.stroke();
          g.beginPath(); g.arc(-26, -77, 2.6, 0, 6.3); g.stroke();
          g.lineWidth = 1.5; g.globalAlpha = 0.5;
          g.beginPath(); g.moveTo(-4, -78); g.lineTo(10, -78); g.moveTo(-4, -84); g.lineTo(10, -84); g.stroke();
          g.globalAlpha = 1;
        }
      },

      /* Радиовышка: решётчатая мачта с тарелкой и будкой */
      radio: function (g, P, level, t) {
        var T = tier(level);
        var h = T >= 2 ? 124 : 100;
        g.strokeStyle = P.ink; g.lineJoin = 'round';

        // мачта
        g.lineWidth = 2.8;
        g.beginPath();
        g.moveTo(-20, 0); g.lineTo(-5, -h); g.moveTo(20, 0); g.lineTo(5, -h);
        g.stroke();
        g.lineWidth = 1.5;
        for (var i = 0; i < 7; i++) {
          var f0 = i / 7, f1 = (i + 1) / 7;
          var la = -20 + 15 * f0, ra = 20 - 15 * f0;
          var lb = -20 + 15 * f1, rb = 20 - 15 * f1;
          var ya = -h * f0, yb = -h * f1;
          g.beginPath();
          g.moveTo(la, ya); g.lineTo(ra, ya);
          g.moveTo(la, ya); g.lineTo(rb, yb);
          g.moveTo(ra, ya); g.lineTo(lb, yb);
          g.stroke();
        }
        // растяжки
        g.lineWidth = 1.2; g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(-52, 0); g.lineTo(-6, -h * 0.72);
        g.moveTo(52, 0); g.lineTo(6, -h * 0.72);
        g.stroke();
        g.globalAlpha = 1;
        // огонёк на верхушке
        g.lineWidth = 2.2;
        g.fillStyle = P.ink;
        g.globalAlpha = 0.35 + (Math.sin(t * 2.2) * 0.5 + 0.5) * 0.65;
        g.beginPath(); g.arc(0, -h - 6, 4, 0, 6.3); g.fill();
        g.globalAlpha = 1;
        g.beginPath(); g.moveTo(0, -h); g.lineTo(0, -h - 3); g.stroke();
        // тарелка
        g.save();
        g.translate(14, -h * 0.6);
        g.rotate(-0.5 + Math.sin(t * 0.22) * 0.12);
        g.fillStyle = P.bodyHi || P.bodyFill;
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(0, -14); g.quadraticCurveTo(20, 0, 0, 14);
        g.quadraticCurveTo(8, 0, 0, -14);
        g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(4, 0); g.lineTo(-12, 0); g.stroke();
        g.restore();
        // будка
        var bg3 = g.createLinearGradient(0, -34, 0, 0);
        bg3.addColorStop(0, P.bodyHi || P.bodyFill);
        bg3.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = bg3; g.lineWidth = 2.4;
        g.beginPath(); g.rect(-70, -32, 42, 32); g.fill(); g.stroke();
        g.beginPath();
        g.moveTo(-74, -32); g.lineTo(-49, -46); g.lineTo(-24, -32);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = P.ink;
        g.beginPath(); g.rect(-57, -20, 16, 20); g.fill();

        if (T >= 1) {
          // вторая тарелка пониже и волны
          g.save();
          g.translate(-16, -h * 0.38);
          g.rotate(0.4);
          g.fillStyle = P.bodyHi || P.bodyFill; g.lineWidth = 2;
          g.beginPath();
          g.moveTo(0, -10); g.quadraticCurveTo(14, 0, 0, 10);
          g.quadraticCurveTo(6, 0, 0, -10);
          g.closePath(); g.fill(); g.stroke();
          g.restore();
          g.strokeStyle = P.ink; g.lineWidth = 1.6;
          for (var w = 0; w < 3; w++) {
            var ph = (t * 0.5 + w / 3) % 1;
            g.globalAlpha = (1 - ph) * 0.5;
            g.beginPath();
            g.arc(0, -h - 6, 10 + ph * 26, -2.5, -0.6);
            g.stroke();
          }
          g.globalAlpha = 1;
        }
        if (T >= 2) {
          // генератор у подножия
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          g.fillStyle = P.bodyFill;
          g.beginPath(); g.rect(34, -26, 40, 26); g.fill(); g.stroke();
          g.lineWidth = 1.5; g.globalAlpha = 0.5;
          g.beginPath();
          g.moveTo(38, -20); g.lineTo(70, -20); g.moveTo(38, -12); g.lineTo(70, -12);
          g.stroke();
          g.globalAlpha = 1; g.lineWidth = 2;
          g.beginPath(); g.rect(44, -34, 12, 8); g.fill(); g.stroke();
        }
      },

      /* Депо: длинный сарай с воротами, рельсы и вагонетка */
      depot: function (g, P, level, t) {
        var T = tier(level);
        var dg3 = g.createLinearGradient(0, -52, 0, 0);
        dg3.addColorStop(0, P.bodyHi || P.bodyFill);
        dg3.addColorStop(1, P.bodyShade || P.bodyFill);
        g.strokeStyle = P.ink; g.lineWidth = 2.4; g.lineJoin = 'round';

        // корпус
        g.fillStyle = dg3;
        g.beginPath(); g.rect(-56, -46, 96, 46); g.fill(); g.stroke();
        // крыша-двускатка вдоль
        g.beginPath();
        g.moveTo(-62, -46); g.lineTo(-40, -64); g.lineTo(24, -64); g.lineTo(46, -46);
        g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 1.4; g.globalAlpha = 0.45;
        g.beginPath(); g.moveTo(-52, -54); g.lineTo(36, -54); g.stroke();
        g.globalAlpha = 1; g.lineWidth = 2.4;
        // ворота-арки
        g.fillStyle = P.ink;
        [-34, 4].forEach(function (gx) {
          g.beginPath();
          g.moveTo(gx, 0); g.lineTo(gx, -24);
          g.quadraticCurveTo(gx + 14, -38, gx + 28, -24); g.lineTo(gx + 28, 0);
          g.closePath(); g.fill();
        });
        // рельсы из ворот
        g.strokeStyle = P.ink; g.lineWidth = 1.6;
        for (var tx = -50; tx < 78; tx += 12) {
          g.beginPath(); g.moveTo(tx, -5); g.lineTo(tx, 1); g.stroke();
        }
        g.lineWidth = 1.9;
        [-4, 0].forEach(function (off) {
          g.beginPath(); g.moveTo(-52, off); g.lineTo(78, off); g.stroke();
        });
        // вагонетка выкатывается
        var k = (Math.sin(t * 0.42) * 0.5 + 0.5);
        var cx = 26 + k * 44;
        g.save(); g.translate(cx, -6);
        var cg3 = g.createLinearGradient(0, -18, 0, 2);
        cg3.addColorStop(0, P.bodyHi || P.bodyFill);
        cg3.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = cg3; g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(-14, -18); g.lineTo(14, -18); g.lineTo(11, -4); g.lineTo(-11, -4);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = P.hatch;
        g.beginPath();
        g.moveTo(-11, -18); g.quadraticCurveTo(-4, -26, 2, -21);
        g.quadraticCurveTo(7, -26, 11, -18);
        g.closePath(); g.fill();
        g.fillStyle = P.rim; g.lineWidth = 1.8;
        g.beginPath(); g.arc(-6, -2, 3.4, 0, 6.3); g.fill(); g.stroke();
        g.beginPath(); g.arc(6, -2, 3.4, 0, 6.3); g.fill(); g.stroke();
        g.restore();

        if (T >= 1) {
          // семафор и штабель шпал
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(60, -2); g.lineTo(60, -52); g.stroke();
          g.fillStyle = P.bodyFill;
          g.beginPath(); g.rect(53, -66, 15, 16); g.fill(); g.stroke();
          g.fillStyle = P.ink;
          g.globalAlpha = 0.35 + (Math.sin(t * 1.6) * 0.5 + 0.5) * 0.6;
          g.beginPath(); g.arc(60.5, -58, 4, 0, 6.3); g.fill();
          g.globalAlpha = 1;
          g.strokeStyle = P.ink; g.lineWidth = 1.7;
          for (var q2 = 0; q2 < 4; q2++) {
            g.beginPath(); g.rect(-84, -6 - q2 * 6, 22, 6); g.stroke();
          }
        }
        if (T >= 2) {
          // портальный кран над левым крылом
          g.strokeStyle = P.ink; g.lineWidth = 2.4;
          g.beginPath();
          g.moveTo(-78, -2); g.lineTo(-78, -86); g.lineTo(-8, -86); g.lineTo(-8, -2);
          g.stroke();
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(-78, -74); g.lineTo(-64, -86);
          g.moveTo(-8, -74); g.lineTo(-22, -86);
          g.moveTo(-78, -80); g.lineTo(-8, -80);
          g.stroke();
          var hx = -43 + Math.sin(t * 0.3) * 28;
          g.lineWidth = 1.8;
          g.beginPath(); g.moveTo(hx, -86); g.lineTo(hx, -62); g.stroke();
          g.fillStyle = P.bodyFill; g.lineWidth = 2;
          g.beginPath();
          g.moveTo(hx - 9, -62); g.lineTo(hx + 9, -62); g.lineTo(hx + 6, -50); g.lineTo(hx - 6, -50);
          g.closePath(); g.fill(); g.stroke();
        }
      },

      /* Сад: деревья, скамейка, кустики и оградка */
      garden: function (g, P, level, t) {
        function tree(x, sc, phase) {
          g.save();
          g.translate(x, 0); g.scale(sc, sc);
          g.rotate(Math.sin(t * 0.35 + phase) * 0.018);
          HC.Decor.draw(g, 'tree', P, 1, phase > 1);
          g.restore();
        }
        // оградка; с уровнем сад занимает больше места
        var T = tier(level);
        var fx0 = T >= 1 ? -80 : -58, fx1 = T >= 1 ? 80 : 58;
        g.strokeStyle = P.ink; g.lineWidth = 2; g.lineCap = 'round';
        for (var x = fx0; x <= fx1 + 1; x += 19) {
          g.beginPath(); g.moveTo(x, 2); g.lineTo(x, -15); g.stroke();
        }
        g.lineWidth = 1.7;
        g.beginPath();
        g.moveTo(fx0 - 2, -11); g.lineTo(fx1 + 2, -11);
        g.moveTo(fx0 - 2, -4); g.lineTo(fx1 + 2, -4);
        g.stroke();

        tree(-34, 1.0, 0);
        if (T < 2) tree(30, 0.82, 1.7);
        if (T >= 1) {
          tree(-64, 0.72, 3.1);
          if (T >= 2) tree(-12, 0.66, 4.4); else tree(62, 0.66, 4.4);
          // грядки
          g.strokeStyle = P.ink; g.lineWidth = 1.5; g.globalAlpha = 0.5;
          for (var b4 = 0; b4 < 3; b4++) {
            var by4 = -2 - b4 * 4;
            g.beginPath();
            g.moveTo(-22 + b4 * 2, by4); g.lineTo(24 - b4 * 2, by4);
            g.stroke();
          }
          g.globalAlpha = 1; g.lineWidth = 2.2;
        }
        if (T >= 2) {
          // беседка: в сад захотелось приходить
          g.strokeStyle = P.ink; g.lineWidth = 2.2;
          // задняя стенка, иначе сквозь беседку виден забор
          g.fillStyle = P.bodyShade || P.bodyFill;
          g.globalAlpha = 0.75;
          g.beginPath(); g.rect(32, -44, 40, 42); g.fill();
          g.globalAlpha = 1;
          g.fillStyle = P.bodyFill;
          g.beginPath();
          g.moveTo(26, -44); g.lineTo(52, -62); g.lineTo(78, -44);
          g.closePath(); g.fill(); g.stroke();
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(32, -44); g.lineTo(32, -2); g.moveTo(72, -44); g.lineTo(72, -2);
          g.moveTo(32, -22); g.lineTo(72, -22);
          g.stroke();
          // пол-настил
          g.fillStyle = P.bodyHi || P.bodyFill;
          g.beginPath(); g.rect(28, -6, 48, 6); g.fill(); g.stroke();
          g.lineWidth = 1.5; g.globalAlpha = 0.5;
          g.beginPath(); g.moveTo(30, -38); g.lineTo(74, -38); g.stroke();
          g.globalAlpha = 1; g.lineWidth = 2.2;
          // дорожка к беседке
          g.strokeStyle = P.hatch; g.globalAlpha = 0.45; g.lineWidth = 5;
          g.setLineDash([5, 6]);
          g.beginPath(); g.moveTo(4, 1); g.lineTo(46, -2); g.stroke();
          g.setLineDash([]);
          g.globalAlpha = 1; g.strokeStyle = P.ink; g.lineWidth = 2.2;
        }

        // скамейка
        g.lineWidth = 2.2; g.strokeStyle = P.ink;
        var bg2 = g.createLinearGradient(0, -20, 0, -8);
        bg2.addColorStop(0, P.bodyHi || P.bodyFill); bg2.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = bg2;
        g.beginPath(); g.rect(-12, -14, 30, 5); g.fill(); g.stroke();
        g.lineWidth = 1.8;
        g.beginPath(); g.moveTo(-8, -9); g.lineTo(-8, 0); g.moveTo(14, -9); g.lineTo(14, 0); g.stroke();
        g.beginPath(); g.moveTo(-10, -14); g.lineTo(-10, -24); g.moveTo(16, -14); g.lineTo(16, -24); g.stroke();
        g.beginPath(); g.moveTo(-11, -21); g.lineTo(17, -21); g.stroke();

        // кустики
        g.save(); g.translate(-62, 0); g.scale(0.8, 0.8);
        HC.Decor.draw(g, 'bush', P, 1, false);
        g.restore();
      }
    }
  };

  HC.Base = Base;
  HC.BASE_VIEW = { tile: TW, cols: COLS, rows: ROWSN, plate: { w: PLATE_W, h: PLATE_H } };
})(window.HC);
