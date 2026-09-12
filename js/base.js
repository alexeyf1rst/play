/* ============================================================
   База: шахты, буры, склады.
   Считает добычу, рисует долину и ловит нажатия по участкам.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  var VW = 1280, VH = 720;   // виртуальное поле базы
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

  /* ========== Сцена базы ================================== */
  /* Линии земли: нижняя терраса (ближе к зрителю) и верхняя. */
  /* Три плана долины. Дальний выше на экране и мельче — так появляется
     глубина, которой не было у двух плоских полок. */
  var ROWS = [
    { base: 600, wob: 12, seed: 21, scale: 1.00, x0: -320, x1: VW + 320, round: false, fade: 0.00 },
    { base: 452, wob: 10, seed: 44, scale: 0.80, x0: 24,   x1: VW - 24,  round: true,  fade: 0.16 },
    { base: 322, wob: 8,  seed: 63, scale: 0.60, x0: 96,   x1: VW - 96,  round: true,  fade: 0.34 }
  ];

  function rowY(row, x) {
    var R = ROWS[row] || ROWS[0];
    return R.base + HC.noise(x * 0.0040 + 3 + row * 2.5, R.seed) * R.wob;
  }
  function lowerY(x) { return rowY(0, x); }

  /* Ступень постройки: чем выше уровень, тем больше на участке всего.
     Одна цифра на бейдже — это не награда, видно должно быть глазом. */
  function tier(level) { return level >= 8 ? 2 : (level >= 4 ? 1 : 0); }

  var Base = {
    pan: 0, scale: 1, padX: 0, padY: 0, t: 0,
    dragging: false, dragMoved: 0, lastX: 0,
    spots: null,

    /* Раскладываем участки по земле один раз. */
    places: function () {
      if (!this.spots) {
        this.spots = HC.PLOTS.spots.map(function (s, i) {
          var row = Math.min(2, s.row || 0);
          return { x: s.x, y: rowY(row, s.x), row: row, scale: ROWS[row].scale, i: i };
        });
      }
      return this.spots;
    },

    layout: function (W, H) {
      // Подгоняем не всё поле 1280x720, а полосу, где реально что-то есть
      // (от дальних гряд до переднего плана) — иначе полэкрана уходит в небо.
      var BAND_TOP = 60, BAND_H = 660;
      this.scale = clamp(Math.min(H / BAND_H, W / 620), 0.30, 2.6);
      var vw = W / this.scale;

      // Стартуем чуть левее центра: первые участки стоят слева, и на
      // узком экране игрок сразу видит их, а не одни ворота справа.
      if (this.panInit === undefined) {
        this.pan = clamp((VW - vw) / 2 - 70, 0, Math.max(0, VW - vw));
        this.panInit = 1;
      }
      if (vw >= VW) this.pan = (VW - vw) / 2;
      else this.pan = clamp(this.pan, 0, VW - vw);

      // Панели сверху и снизу занимают часть кадра. Центруем долину между
      // ними, а не по всему экрану: на телефоне иначе половина — пустое небо.
      if (this.insW !== W || this.insH !== H || !this.insOK) {
        this.insW = W; this.insH = H; this.insOK = 1;
        this.insT = 64; this.insB = 96;
        var barEl = document.getElementById('base-bar');
        var topEl = document.getElementById('top');
        // Панель может быть спрятана (например, в момент перехода) — тогда
        // высота 0, и мерить нечего: оставляем запас и пробуем в следующий раз.
        var bh = barEl ? barEl.getBoundingClientRect().height : 0;
        var th = topEl ? topEl.getBoundingClientRect().height : 0;
        if (bh > 10) this.insB = Math.min(H * 0.42, bh + 18); else this.insOK = 0;
        if (th > 10) this.insT = Math.min(H * 0.3, th + 14); else this.insOK = 0;
      }
      var avail = Math.max(200, H - this.insT - this.insB);

      this.padX = 0;
      this.padY = this.insT + (avail - BAND_H * this.scale) * 0.5 - BAND_TOP * this.scale;
    },

    toVirtual: function (sx, sy) {
      return { x: sx / this.scale + this.pan, y: (sy - this.padY) / this.scale };
    },

    /* Куда ткнули: вернёт индекс участка или -1 */
    hitTest: function (sx, sy, state) {
      var v = this.toVirtual(sx, sy);
      var spots = this.places();
      var best = -1, bestD = 1e9;
      for (var i = 0; i < state.base.unlocked && i < spots.length; i++) {
        var s = spots[i];
        var sc = s.scale || 1;
        var d = Math.hypot(v.x - s.x, v.y - (s.y - 45 * sc));
        if (d < 80 * sc && d < bestD) { bestD = d; best = i; }
      }
      return best;
    },

    update: function (dt) { this.t += dt; },

    draw: function (g, W, H, P, state) {
      this.layout(W, H);
      var grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, P.sky0); grad.addColorStop(1, P.sky1);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      HC.drawSun(g, W, H, P, this.pan, state.settings.theme === 'dark');
      HC.drawClouds(g, W, H, P, this.pan * this.scale, this.padY + 300 * this.scale, this.t);
      HC.drawBirds(g, W, H, P, this.t, this.pan);

      g.save();
      g.translate(this.padX, this.padY);
      g.scale(this.scale, this.scale);
      g.translate(-this.pan, 0);

      this.drawBackdrop(g, P);

      // От дальнего плана к ближнему. Между планами — дымка: дальнее
      // выцветает к небу, и долина читается вглубь, а не одной полкой.
      var spots = this.places();
      for (var row = ROWS.length - 1; row >= 0; row--) {
        this.terrace(g, P, row);
        if (row === 2) this.drawPipes(g, P);
        if (row === 1) this.drawRails(g, P);
        if (row === 0) this.drawPath(g, P, state);
        this.drawDecorRow(g, P, row);
        this.drawLinks(g, P, state, row);
        this.drawPlotsRow(g, P, state, row, spots);
        if (row === 1) this.drawTrolley(g, P);
        if (row < 2) this.drawFolk(g, P, row);
        if (row === 1) this.drawRopeway(g, P);
        if (row === 0) { this.drawFence(g, P); this.drawSign(g, P); }
        if (row > 0) this.haze(g, P, row);
      }
      this.drawRamps(g, P);
      this.drawParked(g, P, state);
      this.drawForeground(g, P);
      g.restore();

      HC.drawVignette(g, W, H, P);
    },

    drawBackdrop: function (g, P) {
      var x;
      // дальние гряды за долиной
      g.fillStyle = P.far0;
      g.beginPath(); g.moveTo(-300, VH);
      for (x = -300; x <= VW + 300; x += 20) {
        g.lineTo(x, 176 + HC.noise(x * 0.0022, 31) * 46 + HC.noise(x * 0.007, 12) * 15);
      }
      g.lineTo(VW + 300, VH); g.closePath(); g.fill();

      g.fillStyle = P.far1;
      g.beginPath(); g.moveTo(-300, VH);
      for (x = -300; x <= VW + 300; x += 20) {
        g.lineTo(x, 236 + HC.noise(x * 0.0031 + 9, 77) * 38 + HC.noise(x * 0.009, 5) * 12);
      }
      g.lineTo(VW + 300, VH); g.closePath(); g.fill();

    },

    /* Дымка поверх дальнего плана: он выцветает к небу */
    haze: function (g, P, row) {
      var line = rowY(row - 1, VW / 2) + 10;
      g.save();
      g.globalAlpha = 0.20 + (row - 1) * 0.10;
      g.fillStyle = P.sky1;
      g.fillRect(-400, -300, VW + 800, line + 300);
      g.restore();
      g.globalAlpha = 1;
    },

    /* Постройки одного плана */
    drawPlotsRow: function (g, P, state, row, spots) {
      for (var i = 0; i < spots.length; i++) {
        if (spots[i].row !== row) continue;
        if (i >= state.base.unlocked) {
          if (i === state.base.unlocked) this.drawLocked(g, spots[i], P);
          continue;
        }
        var plot = state.base.plots[i];
        if (plot) this.drawBuilding(g, plot.type, plot.level, spots[i], P);
        else this.drawEmpty(g, spots[i], P);
      }
    },

    /* Один уступ: площадка, освещённая кромка и стенка с камнем.
       Стенка и даёт ощущение толщины — без неё это была плоская полка. */
    terrace: function (g, P, row) {
      var R = ROWS[row], x;
      function fn(v) { return rowY(row, v); }

      g.save();
      // короткий градиент: план заметно темнеет к своему низу, и полки
      // перестают выглядеть одинаково плоскими
      var tg = g.createLinearGradient(0, R.base - 10, 0, R.base + 200);
      tg.addColorStop(0, P.ground);
      tg.addColorStop(1, P.groundDeep || P.ground);
      g.fillStyle = tg;
      g.beginPath();
      g.moveTo(R.x0, VH + 900);
      if (R.round) g.lineTo(R.x0 + 30, fn(R.x0 + 30) + 16);
      for (x = R.x0; x <= R.x1; x += 14) g.lineTo(x, fn(x));
      if (R.round) g.lineTo(R.x1 - 30, fn(R.x1 - 30) + 16);
      g.lineTo(R.x1, VH + 900);
      g.closePath();
      g.fill();

      g.save();
      g.clip();

      // освещённая кромка
      g.strokeStyle = P.groundTop || P.ground;
      g.globalAlpha = 0.95;
      g.lineWidth = 9;
      g.lineJoin = 'round';
      g.beginPath();
      for (x = R.x0; x <= R.x1; x += 14) { if (x === R.x0) g.moveTo(x, fn(x)); else g.lineTo(x, fn(x)); }
      g.stroke();
      g.globalAlpha = 1;

      // стенка уступа
      var wallH = 58;
      var wg = g.createLinearGradient(0, R.base + 9, 0, R.base + 9 + wallH);
      wg.addColorStop(0, P.groundDeep || P.ground);
      wg.addColorStop(0.55, P.groundDeep || P.ground);
      wg.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.8;
      g.fillStyle = wg;
      g.beginPath();
      for (x = R.x0; x <= R.x1; x += 14) { if (x === R.x0) g.moveTo(x, fn(x) + 10); else g.lineTo(x, fn(x) + 10); }
      for (x = R.x1; x >= R.x0; x -= 14) g.lineTo(x, fn(x) + 10 + wallH);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;

      // камень в стенке
      g.strokeStyle = P.hatch;
      g.globalAlpha = 0.28;
      g.lineWidth = 1;
      g.beginPath();
      for (x = R.x0; x < R.x1; x += 30) {
        var y0 = fn(x) + 16;
        g.moveTo(x, y0); g.lineTo(x - 11, y0 + 28);
        g.moveTo(x - 16, y0 + 9); g.lineTo(x + 12, y0 + 5);
      }
      g.stroke();
      g.globalAlpha = 1;
      g.restore();

      // кромка чернилами; дальние планы бледнее
      g.strokeStyle = P.ink;
      g.globalAlpha = 1 - R.fade * 1.5;
      g.lineWidth = 2.4 * (0.7 + R.scale * 0.3);
      g.lineJoin = 'round';
      g.beginPath();
      for (x = R.x0; x <= R.x1; x += 14) { if (x === R.x0) g.moveTo(x, fn(x)); else g.lineTo(x, fn(x)); }
      g.stroke();
      g.globalAlpha = 1;
      g.restore();
    },

    /* Лестницы на стенках уступов: в виде сбоку пандус читается плитой,
       а ступени сразу говорят «сюда можно подняться». */
    drawRamps: function (g, P) {
      function stairs(x, row, steps) {
        var y = rowY(row, x);
        g.save();
        g.strokeStyle = P.ink;
        g.globalAlpha = 0.45;
        g.lineWidth = 2;
        g.lineJoin = 'round';
        g.beginPath();
        var sw = 9, sh = 7;
        g.moveTo(x, y + 6);
        for (var i = 0; i < steps; i++) {
          g.lineTo(x + (i + 1) * sw, y + 6 + i * sh);
          g.lineTo(x + (i + 1) * sw, y + 6 + (i + 1) * sh);
        }
        g.stroke();
        // перила
        g.globalAlpha = 0.3;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + steps * sw, y + 6 + steps * sh - 14);
        g.stroke();
        g.restore();
        g.globalAlpha = 1;
      }
      stairs(1196, 1, 7);
      stairs(64, 2, 7);
    },

    /* Трубопровод на опорах вдоль дальнего плана */
    drawPipes: function (g, P) {
      g.save();
      g.strokeStyle = P.ink;
      g.globalAlpha = 0.4;
      g.lineWidth = 4.5;
      g.beginPath();
      for (var x = 120; x <= VW - 120; x += 16) {
        if (x === 120) g.moveTo(x, rowY(2, x) - 24); else g.lineTo(x, rowY(2, x) - 24);
      }
      g.stroke();
      g.lineWidth = 2;
      for (var sx = 150; sx < VW - 120; sx += 130) {
        g.beginPath();
        g.moveTo(sx, rowY(2, sx) - 22); g.lineTo(sx, rowY(2, sx));
        g.moveTo(sx - 7, rowY(2, sx)); g.lineTo(sx + 7, rowY(2, sx));
        g.stroke();
      }
      g.restore();
      g.globalAlpha = 1;
    },

    /* Обстановка одного плана */
    drawDecorRow: function (g, P, row) {
      var items = [
        { x: 90,   row: 0, t: 'crates', s: 1 },   { x: 390, row: 0, t: 'lamp', s: 1 },
        { x: 600,  row: 0, t: 'lamp', s: 1 },     { x: 680, row: 1, t: 'lamp', s: 1 },
        { x: 210,  row: 0, t: 'grass', s: 1.1 },  { x: 770, row: 0, t: 'bush', s: 1 },
        { x: 1150, row: 0, t: 'grass', s: 1 },
        { x: 120,  row: 1, t: 'tower', s: 1 },    { x: 490, row: 1, t: 'crates', s: 0.95 },
        { x: 870,  row: 1, t: 'flagpole', s: 1 }, { x: 1120, row: 1, t: 'grass', s: 1.1 },
        { x: 1230, row: 1, t: 'tree', s: 1 },
        { x: 150,  row: 2, t: 'pine', s: 1.05 },  { x: 425, row: 2, t: 'rock', s: 0.85 },
        { x: 615,  row: 2, t: 'bush', s: 0.95 },  { x: 810, row: 2, t: 'grass', s: 1 },
        { x: 1060, row: 2, t: 'tree', s: 1 }
      ];
      var R = ROWS[row];
      items.forEach(function (d) {
        if ((d.row || 0) !== row) return;
        g.save();
        g.globalAlpha = 1 - R.fade;
        g.translate(d.x, rowY(row, d.x));
        g.scale(R.scale, R.scale);
        HC.Decor.shadow(g, P, 14 * d.s, 0.2);
        HC.Decor.draw(g, d.t, P, d.s, d.x % 2 === 0);
        g.restore();
        g.globalAlpha = 1;
      });
    },

    /* Ограда по переднему краю базы */
    drawFence: function (g, P) {
      g.save();
      g.strokeStyle = P.ink;
      g.globalAlpha = 0.55;
      g.lineWidth = 2;
      g.lineCap = 'round';
      for (var fx = 8; fx < 1272; fx += 26) {
        if (fx > 1104 && fx < 1244) continue;
        var fy = lowerY(fx) + 40;
        g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - 20); g.stroke();
      }
      g.lineWidth = 1.7;
      [26, 34].forEach(function (off) {
        g.beginPath();
        for (var fx2 = 8; fx2 < 1272; fx2 += 13) {
          if (fx2 > 1104 && fx2 < 1244) { g.moveTo(fx2, lowerY(fx2) + off); continue; }
          g.lineTo(fx2, lowerY(fx2) + off);
        }
        g.stroke();
      });
      g.restore();
      g.globalAlpha = 1;
    },

    /* Узкоколейка вдоль среднего плана */
    drawRails: function (g, P) {
      g.save();
      g.strokeStyle = P.ink;
      g.globalAlpha = 0.4;
      g.lineWidth = 1.6;
      for (var rx = 60; rx < 1220; rx += 14) {
        g.beginPath(); g.moveTo(rx, rowY(1, rx) + 12); g.lineTo(rx, rowY(1, rx) + 18); g.stroke();
      }
      g.lineWidth = 1.8;
      [13, 17].forEach(function (off) {
        g.beginPath();
        for (var rx2 = 60; rx2 <= 1220; rx2 += 14) g.lineTo(rx2, rowY(1, rx2) + off);
        g.stroke();
      });
      g.restore();
      g.globalAlpha = 1;
    },

    /* Ворота с вывеской на въезде */
    drawSign: function (g, P) {
      var x = 1160, y = lowerY(x);
      g.save();
      g.translate(x, y);
      // столбы ворот
      g.strokeStyle = P.ink; g.lineWidth = 4;
      g.beginPath(); g.moveTo(-52, 6); g.lineTo(-52, -74); g.moveTo(52, 6); g.lineTo(52, -74); g.stroke();
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(-56, -74); g.quadraticCurveTo(0, -92, 56, -74); g.stroke();
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(-52, -60); g.lineTo(-38, -74); g.moveTo(52, -60); g.lineTo(38, -74); g.stroke();
      g.translate(0, -18);
      g.strokeStyle = P.ink; g.lineWidth = 3;
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

    /* Тропинка вдоль нижнего яруса */
    drawPath: function (g, P, state) {
      g.save();
      g.strokeStyle = P.groundTop || P.ground;
      g.globalAlpha = 0.9;
      g.lineWidth = 15;
      g.lineCap = 'round';
      g.beginPath();
      for (var x = 40; x <= 1240; x += 16) g.lineTo(x, lowerY(x) + 17);
      g.stroke();
      g.strokeStyle = P.hatch;
      g.globalAlpha = 0.25;
      g.lineWidth = 1;
      g.setLineDash([5, 12]);
      g.beginPath();
      for (var x2 = 40; x2 <= 1240; x2 += 16) g.lineTo(x2, lowerY(x2) + 17);
      g.stroke();
      g.setLineDash([]);
      g.restore();
      g.globalAlpha = 1;
    },

    /* Твоя машина стоит у въезда — видно, на чём поедешь */
    drawParked: function (g, P, state) {
      var def = HC.VEHICLES[state.vehicle];
      if (!def) return;
      var x = 1040, y = lowerY(x) + 4;
      g.save();
      g.translate(x, y);
      g.scale(0.82, 0.82);
      g.globalAlpha = 0.55;
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.save(); g.scale(1, 0.15);
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

    /* Вагонетка катится по узкоколейке туда и обратно. Единственное,
       что на базе само куда-то едет — и долина сразу живая. */
    drawTrolley: function (g, P) {
      var span = 1120, R = ROWS[1];
      var x = 60 + ((this.t * 24) % (span * 2));
      var back = x > 60 + span;
      if (back) x = 120 + span * 2 - x;
      var y = rowY(1, x) + 15;
      g.save();
      g.globalAlpha = 1 - R.fade;
      g.translate(x, y);
      g.scale(back ? -R.scale : R.scale, R.scale);
      g.strokeStyle = P.ink;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      // руда горкой
      g.fillStyle = P.hatch;
      g.beginPath();
      g.moveTo(-11, -20); g.quadraticCurveTo(-4, -29, 2, -23);
      g.quadraticCurveTo(7, -29, 11, -20);
      g.closePath(); g.fill();
      // кузов
      var bg = g.createLinearGradient(0, -21, 0, -5);
      bg.addColorStop(0, P.bodyHi || P.bodyFill);
      bg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(-15, -21); g.lineTo(15, -21); g.lineTo(12, -5); g.lineTo(-12, -5);
      g.closePath(); g.fill(); g.stroke();
      g.globalAlpha = (1 - R.fade) * 0.5;
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-8, -20); g.lineTo(-7, -6); g.moveTo(8, -20); g.lineTo(7, -6); g.stroke();
      g.globalAlpha = 1 - R.fade;
      // колёса
      g.lineWidth = 1.8;
      g.fillStyle = P.bodyShade || P.bodyFill;
      [-8, 8].forEach(function (wx) {
        g.beginPath(); g.arc(wx, -2, 3.6, 0, 6.3); g.fill(); g.stroke();
      });
      g.restore();
      g.globalAlpha = 1;
    },

    /* Связи между постройками: улица, труба от бура к складу, рельсы от
       шахты к складу и линия от ветряка. Долина должна читаться как одно
       хозяйство, а не как расставленные по полке домики. */
    drawLinks: function (g, P, state, row) {
      var spots = this.places(), R = ROWS[row], i;
      var here = [];
      for (i = 0; i < spots.length && i < state.base.unlocked; i++) {
        var pl = state.base.plots[i];
        if (pl && spots[i].row === row) {
          here.push({ x: spots[i].x, y: spots[i].y, type: pl.type, level: pl.level });
        }
      }
      if (here.length < 1) return;
      here.sort(function (a, b) { return a.x - b.x; });
      var sc = R.scale;

      function nearest(from, type) {
        var best = null, bd = 1e9;
        here.forEach(function (o) {
          if (o.type !== type) return;
          var d = Math.abs(o.x - from.x);
          if (d < bd) { bd = d; best = o; }
        });
        return best;
      }
      function lineY(x) { return rowY(row, x) + (row === 0 ? 17 : 13); }

      g.save();
      g.globalAlpha = 1 - R.fade;

      // улица вдоль плана: на ближнем ярусе тропа уже есть, здесь — для верхних
      if (row > 0 && here.length > 1) {
        var x0 = here[0].x - 60 * sc, x1 = here[here.length - 1].x + 60 * sc;
        g.strokeStyle = P.groundTop || P.ground;
        g.lineWidth = 11 * sc;
        g.lineCap = 'round';
        g.beginPath();
        for (var sx = x0; sx <= x1; sx += 14) g.lineTo(sx, lineY(sx));
        g.stroke();
        g.strokeStyle = P.hatch;
        g.globalAlpha = (1 - R.fade) * 0.22;
        g.lineWidth = 1;
        g.setLineDash([4, 10]);
        g.beginPath();
        for (var sx2 = x0; sx2 <= x1; sx2 += 14) g.lineTo(sx2, lineY(sx2));
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1 - R.fade;
      }

      // отросток от каждой постройки к этой улице
      g.strokeStyle = P.groundTop || P.ground;
      g.lineWidth = 7 * sc;
      g.lineCap = 'round';
      here.forEach(function (o) {
        g.beginPath();
        g.moveTo(o.x, o.y - 2);
        g.lineTo(o.x + 6 * sc, lineY(o.x));
        g.stroke();
      });

      // труба от бура к ближайшему складу
      g.strokeStyle = P.ink;
      here.forEach(function (o) {
        if (o.type !== 'drill') return;
        var to = nearest(o, 'storage');
        if (!to || Math.abs(to.x - o.x) > 460) return;
        var dir = to.x > o.x ? 1 : -1;
        var ax = o.x + dir * 46 * sc, bx = to.x - dir * 40 * sc;
        var h = 30 * sc;
        g.globalAlpha = (1 - R.fade) * 0.5;
        g.lineWidth = 3.4 * sc;
        g.beginPath();
        g.moveTo(ax, rowY(row, ax) - 14 * sc);
        g.lineTo(ax, rowY(row, ax) - h);
        for (var px = ax; dir > 0 ? px <= bx : px >= bx; px += dir * 16) g.lineTo(px, rowY(row, px) - h);
        g.lineTo(bx, rowY(row, bx) - h);
        g.lineTo(bx, rowY(row, bx) - 16 * sc);
        g.stroke();
        // опоры
        g.lineWidth = 1.6 * sc;
        for (var qx = ax + dir * 34; dir > 0 ? qx < bx : qx > bx; qx += dir * 68) {
          g.beginPath();
          g.moveTo(qx, rowY(row, qx) - h);
          g.lineTo(qx, rowY(row, qx) - 4);
          g.stroke();
        }
      });

      // рельсы от шахты к ближайшему складу (на среднем ярусе узкоколейка уже своя)
      if (row !== 1) {
        here.forEach(function (o) {
          if (o.type !== 'mine') return;
          var to = nearest(o, 'storage');
          if (!to || Math.abs(to.x - o.x) > 460) return;
          var a = Math.min(o.x, to.x) + 46 * sc, b2 = Math.max(o.x, to.x) - 40 * sc;
          if (b2 - a < 30) return;
          g.strokeStyle = P.ink;
          g.globalAlpha = (1 - R.fade) * 0.38;
          g.lineWidth = 1.5 * sc;
          for (var tx = a; tx < b2; tx += 13 * sc) {
            g.beginPath();
            g.moveTo(tx, rowY(row, tx) + 6 * sc);
            g.lineTo(tx, rowY(row, tx) + 12 * sc);
            g.stroke();
          }
          g.lineWidth = 1.7 * sc;
          [7, 11].forEach(function (off) {
            g.beginPath();
            for (var rx = a; rx <= b2; rx += 13 * sc) g.lineTo(rx, rowY(row, rx) + off * sc);
            g.stroke();
          });
        });
      }

      // линия от ветряка: он ускоряет всё вокруг — пусть это будет видно
      var mill = null;
      here.forEach(function (o) { if (o.type === 'windmill' && !mill) mill = o; });
      if (mill && here.length > 1) {
        // столбы ставим в промежутках между постройками, а не на них
        var poles = [];
        for (i = 0; i < here.length - 1; i++) {
          var mx = (here[i].x + here[i + 1].x) / 2;
          poles.push({ x: mx, y: rowY(row, mx) });
        }
        var edge = here[0].x - 74 * sc;
        poles.push({ x: edge, y: rowY(row, edge) });
        poles.push({ x: mill.x, y: rowY(row, mill.x), hub: true });
        poles.sort(function (a, b) { return a.x - b.x; });
        g.strokeStyle = P.ink;
        g.globalAlpha = (1 - R.fade) * 0.45;
        g.lineWidth = 2 * sc;
        poles.forEach(function (pp) {
          if (pp.hub) return;
          g.beginPath();
          g.moveTo(pp.x, pp.y);
          g.lineTo(pp.x, pp.y - 52 * sc);
          g.moveTo(pp.x - 7 * sc, pp.y - 46 * sc);
          g.lineTo(pp.x + 7 * sc, pp.y - 46 * sc);
          g.stroke();
        });
        g.lineWidth = 1.4 * sc;
        for (i = 0; i < poles.length - 1; i++) {
          var A = poles[i], B = poles[i + 1];
          var ay = A.y - (A.hub ? 74 : 48) * sc, by = B.y - (B.hub ? 74 : 48) * sc;
          g.beginPath();
          g.moveTo(A.x, ay);
          g.quadraticCurveTo((A.x + B.x) / 2, (ay + by) / 2 + 16 * sc, B.x, by);
          g.stroke();
        }
      }

      g.restore();
      g.globalAlpha = 1;
    },

    /* Жители: пара фигурок ходит по тропам. Человек рядом с силосом
       задаёт масштаб — долина сразу читается большой, а не игрушечной. */
    drawFolk: function (g, P, row) {
      var self = this, R = ROWS[row];
      var list = row === 0
        ? [{ x0: 120, x1: 640, sp: 25, ph: 0.0 }, { x0: 700, x1: 1150, sp: 19, ph: 0.37 }]
        : [{ x0: 260, x1: 900, sp: 17, ph: 0.6 }];
      list.forEach(function (w) {
        var span = w.x1 - w.x0;
        var u = (self.t * w.sp + w.ph * span * 2) % (span * 2);
        var back = u > span;
        var x = w.x0 + (back ? span * 2 - u : u);
        var y = rowY(row, x) + (row === 0 ? 17 : 13);
        var st = Math.sin(self.t * 7.4 + w.ph * 9);
        g.save();
        g.globalAlpha = 1 - R.fade;
        g.translate(x, y);
        g.scale((back ? -1 : 1) * R.scale, R.scale);
        g.strokeStyle = P.ink;
        g.lineWidth = 2.2;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(0, -12); g.lineTo(st * 4, 0);
        g.moveTo(0, -12); g.lineTo(-st * 4, 0);
        g.moveTo(0, -12); g.lineTo(0, -24);
        g.moveTo(0, -21); g.lineTo(-st * 3.5, -14);
        g.moveTo(0, -21); g.lineTo(st * 3.5, -14);
        g.stroke();
        g.fillStyle = P.bodyHi || P.bodyFill;
        g.lineWidth = 2;
        g.beginPath(); g.arc(0, -27.5, 3.8, 0, 6.3); g.fill(); g.stroke();
        g.restore();
        g.globalAlpha = 1;
      });
    },

    /* Канатка над долиной: две опоры, провисающий трос и вагонетки.
       Она занимает пустое небо и связывает планы между собой. */
    drawRopeway: function (g, P) {
      var R = ROWS[1], i;
      var x0 = 210, x1 = 1070;
      var y0 = rowY(1, x0), y1 = rowY(1, x1);
      var top0 = y0 - 205, top1 = y1 - 205, sag = 30;
      function wy(u) { return top0 + (top1 - top0) * u + sag * 4 * u * (1 - u); }
      function wx(u) { return x0 + (x1 - x0) * u; }

      g.save();
      g.globalAlpha = 1 - R.fade;
      g.strokeStyle = P.ink;
      g.lineJoin = 'round';
      g.lineCap = 'round';

      // опоры: ажурная мачта с раскосами
      [[x0, y0], [x1, y1]].forEach(function (t) {
        var tx = t[0], ty = t[1], h = 205, w = 19;
        g.lineWidth = 2.6;
        g.beginPath();
        g.moveTo(tx - w, ty); g.lineTo(tx - 6, ty - h);
        g.moveTo(tx + w, ty); g.lineTo(tx + 6, ty - h);
        g.stroke();
        g.lineWidth = 1.4;
        g.globalAlpha = (1 - R.fade) * 0.6;
        g.beginPath();
        for (var k = 0; k < 7; k++) {
          var ya = ty - h * k / 7, yb = ty - h * (k + 1) / 7;
          var wa = w - (w - 6) * k / 7, wb = w - (w - 6) * (k + 1) / 7;
          g.moveTo(tx - wa, ya); g.lineTo(tx + wb, yb);
          g.moveTo(tx + wa, ya); g.lineTo(tx - wb, yb);
          g.moveTo(tx - wb, yb); g.lineTo(tx + wb, yb);
        }
        g.stroke();
        g.globalAlpha = 1 - R.fade;
        // головка с роликом
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(tx - 13, ty - h); g.lineTo(tx + 13, ty - h);
        g.stroke();
        g.fillStyle = P.bodyHi || P.bodyFill;
        g.beginPath(); g.arc(tx, ty - h - 5, 5, 0, 6.3); g.fill(); g.stroke();
      });

      // трос
      g.lineWidth = 2;
      g.globalAlpha = (1 - R.fade) * 0.8;
      g.beginPath();
      for (i = 0; i <= 40; i++) {
        var u = i / 40;
        if (i === 0) g.moveTo(wx(u), wy(u)); else g.lineTo(wx(u), wy(u));
      }
      g.stroke();
      // обратная ветвь
      g.globalAlpha = (1 - R.fade) * 0.35;
      g.lineWidth = 1.4;
      g.beginPath();
      for (i = 0; i <= 40; i++) {
        var u2 = i / 40;
        if (i === 0) g.moveTo(wx(u2), wy(u2) + 13); else g.lineTo(wx(u2), wy(u2) + 13);
      }
      g.stroke();
      g.globalAlpha = 1 - R.fade;

      // вагонетки навстречу друг другу
      var ph = (this.t * 0.035) % 1;
      [ph, (ph + 0.5) % 1].forEach(function (u, n) {
        var cx = wx(u), cy = wy(u) + (n ? 13 : 0);
        var tilt = Math.sin(u * 3.14159) * 0.02 * (n ? -1 : 1);
        g.save();
        g.translate(cx, cy);
        g.rotate(tilt);
        g.lineWidth = 1.8;
        // подвес с роликом
        g.beginPath(); g.arc(0, 0, 3.4, 0, 6.3); g.stroke();
        g.beginPath(); g.moveTo(0, 3); g.lineTo(0, 14); g.stroke();
        // кузов
        var cg = g.createLinearGradient(0, 14, 0, 38);
        cg.addColorStop(0, P.bodyHi || P.bodyFill);
        cg.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = cg;
        g.beginPath();
        g.moveTo(-12, 14); g.lineTo(12, 14); g.lineTo(10, 36); g.lineTo(-10, 36);
        g.closePath(); g.fill(); g.stroke();
        g.globalAlpha = (1 - R.fade) * 0.45;
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(-6, 15); g.lineTo(-5, 35); g.moveTo(6, 15); g.lineTo(5, 35);
        g.moveTo(-11, 24); g.lineTo(11, 24);
        g.stroke();
        g.globalAlpha = 1 - R.fade;
        g.lineWidth = 1.8;
        // руда горкой
        g.globalAlpha = (1 - R.fade) * 0.75;
        g.fillStyle = P.hatch;
        g.beginPath();
        g.moveTo(-9, 14); g.quadraticCurveTo(-3, 7, 1, 12); g.quadraticCurveTo(5, 7, 9, 14);
        g.closePath(); g.fill();
        g.restore();
        g.globalAlpha = 1 - R.fade;
      });

      g.restore();
      g.globalAlpha = 1;
    },

    /* Передний план: пруд у ограды и тёмная кромка с камышом и травой.
       Силуэт снизу читается ближе всего — им сцена и закрывается спереди. */
    drawForeground: function (g, P) {
      var self = this, x, i;
      function crest(v) { return 702 + HC.noise(v * 0.0034, 91) * 12; }

      // пруд в ложбине под оградой
      g.save();
      g.translate(486, 670);
      var wg = g.createLinearGradient(0, -24, 0, 24);
      wg.addColorStop(0, P.groundTop || P.ground);
      wg.addColorStop(1, P.groundDeep || P.ground);
      g.fillStyle = wg;
      g.beginPath(); g.ellipse(0, 0, 140, 22, 0, 0, 6.3); g.fill();
      g.strokeStyle = P.ink; g.lineWidth = 2; g.globalAlpha = 0.34;
      g.beginPath(); g.ellipse(0, 0, 140, 22, 0, 0, 6.3); g.stroke();
      // блики на воде
      g.globalAlpha = 0.2; g.lineWidth = 1.6; g.lineCap = 'round';
      var wob = Math.sin(this.t * 0.7) * 5;
      [[-88, -10, 50], [14, -2, 70], [-48, 6, 84], [40, 12, 48]].forEach(function (b) {
        g.beginPath();
        g.moveTo(b[0] + wob * 0.4, b[1]);
        g.lineTo(b[0] + b[2] + wob * 0.4, b[1]);
        g.stroke();
      });
      g.restore();
      g.globalAlpha = 1;

      // камыш по берегу
      g.save();
      g.strokeStyle = P.fore; g.fillStyle = P.fore;
      g.lineWidth = 2.2; g.lineCap = 'round';
      g.globalAlpha = 0.75;
      [-156, -140, -126, 128, 142, 158, 172].forEach(function (rx, k) {
        var bx = 486 + rx, by = 670 + (k % 2 ? 5 : 10);
        var lean = (rx < 0 ? -1 : 1) * (3 + (k % 3)) + Math.sin(self.t * 0.6 + k) * 1.6;
        g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + lean * 0.5, by - 22, bx + lean, by - 38); g.stroke();
        g.beginPath(); g.ellipse(bx + lean, by - 42, 2.4, 5, lean * 0.02, 0, 6.3); g.fill();
      });
      g.restore();
      g.globalAlpha = 1;

      // тёмная кромка переднего плана
      g.save();
      var fg = g.createLinearGradient(0, 690, 0, 850);
      fg.addColorStop(0, P.fore);
      fg.addColorStop(1, P.groundDeep || P.fore);
      g.fillStyle = fg;
      g.globalAlpha = 0.82;
      g.beginPath();
      g.moveTo(-400, VH + 900);
      for (x = -400; x <= VW + 400; x += 14) g.lineTo(x, crest(x));
      g.lineTo(VW + 400, VH + 900);
      g.closePath(); g.fill();
      g.restore();
      g.globalAlpha = 1;

      // трава силуэтом на кромке
      g.save();
      g.strokeStyle = P.fore;
      g.globalAlpha = 0.82;
      g.lineCap = 'round';
      g.lineWidth = 2.6;
      for (i = 0; i < 44; i++) {
        var gx = -380 + i * 46 + HC.noise(i * 1.7, 5) * 22;
        var gy = crest(gx) + 3;
        var n = 3 + ((i * 7) % 3);
        g.beginPath();
        for (var k2 = 0; k2 < n; k2++) {
          var off = (k2 - (n - 1) / 2) * 5;
          var lean = off * 2.4 + Math.sin(this.t * 0.45 + i) * 2.2;
          g.moveTo(gx + off, gy);
          g.quadraticCurveTo(gx + lean * 0.6, gy - 15, gx + lean, gy - 27);
        }
        g.stroke();
      }
      // второй ряд травы ниже и крупнее: на высоком экране он закрывает
      // низ кадра, и долина не упирается в пустую землю
      g.lineWidth = 4;
      for (i = 0; i < 26; i++) {
        var bx2 = -360 + i * 78 + HC.noise(i * 2.3, 9) * 26;
        var by2 = crest(bx2) + 104;
        var n2 = 3 + ((i * 5) % 3);
        var hh = 46 + HC.noise(i * 3.1 + 0.5, 17) * 30;
        g.beginPath();
        for (var k3 = 0; k3 < n2; k3++) {
          var off2 = (k3 - (n2 - 1) / 2) * 9;
          var lean2 = off2 * 2.6 + Math.sin(this.t * 0.4 + i * 1.3) * 4;
          g.moveTo(bx2 + off2, by2);
          g.quadraticCurveTo(bx2 + lean2 * 0.6, by2 - hh * 0.56, bx2 + lean2, by2 - hh);
        }
        g.stroke();
      }
      g.lineWidth = 2.6;

      // пара валунов на кромке
      g.fillStyle = P.fore;
      [[160, 1.15], [760, 0.9], [1090, 1.3]].forEach(function (b) {
        var bx = b[0], by = crest(bx) + 6, s2 = b[1];
        g.beginPath();
        g.moveTo(bx - 26 * s2, by);
        g.quadraticCurveTo(bx - 20 * s2, by - 20 * s2, bx - 2 * s2, by - 21 * s2);
        g.quadraticCurveTo(bx + 22 * s2, by - 18 * s2, bx + 27 * s2, by);
        g.closePath(); g.fill();
      });
      g.restore();
      g.globalAlpha = 1;
    },

    drawEmpty: function (g, s, P) {
      g.save();
      g.translate(s.x, s.y);
      g.scale(s.scale || 1, s.scale || 1);
      g.strokeStyle = P.ink;
      g.globalAlpha = 0.35;
      g.lineWidth = 2;
      g.setLineDash([8, 7]);
      g.beginPath();
      g.roundRect ? g.roundRect(-52, -86, 104, 86, 8) : g.rect(-52, -86, 104, 86);
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-13, -43); g.lineTo(13, -43); g.moveTo(0, -56); g.lineTo(0, -30);
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
    },

    drawLocked: function (g, s, P) {
      g.save();
      g.translate(s.x, s.y);
      g.scale(s.scale || 1, s.scale || 1);
      g.globalAlpha = 0.16;
      g.strokeStyle = P.ink;
      g.lineWidth = 2;
      g.setLineDash([4, 9]);
      g.beginPath();
      g.roundRect ? g.roundRect(-52, -86, 104, 86, 8) : g.rect(-52, -86, 104, 86);
      g.stroke();
      g.setLineDash([]);
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
      var fade = 1 - (ROWS[s.row || 0].fade || 0);
      var grow = 1 + 0.04 * tier(level);    // прокачанная постройка и крупнее
      // Соседние участки не должны выглядеть обоями: через один постройка
      // смотрит в другую сторону, и время у каждой своё — колёса и вагонетки
      // не ходят строем.
      var flip = ((s.i || 0) % 2) ? -1 : 1;
      var tt = this.t + (s.i || 0) * 0.83;

      // тень на земле
      g.save();
      g.globalAlpha = 0.5 * fade;
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.translate(s.x + 10 * sc, s.y + 1);
      g.scale(sc, 0.16 * sc);
      g.beginPath();
      g.arc(0, 0, 46, 0, Math.PI * 2);
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
  HC.BASE_VIEW = { VW: VW, VH: VH };
})(window.HC);
