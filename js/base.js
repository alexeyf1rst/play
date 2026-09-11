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
      var c = 900, o = 40, d = HC.BUILDINGS.storage;
      this.each(state, 'storage', function (p) {
        c += d.capCoins * Math.pow(d.capMult, p.level - 1);
        o += d.capOre * Math.pow(d.capMult, p.level - 1);
      });
      return { coins: Math.round(c), ore: Math.round(o) };
    },
    offlineHours: function (state) {
      var h = HC.ECON.offlineHoursBase;
      this.each(state, 'garden', function (p) { h += HC.BUILDINGS.garden.offline * p.level; });
      return h;
    },
    /* Копим добычу. dt в секундах. */
    accrue: function (state, seconds) {
      var r = this.rates(state), cap = this.capacity(state);
      var pend = state.base.pending;
      var before = { coins: pend.coins, ore: pend.ore };
      pend.coins = Math.min(cap.coins, pend.coins + r.coins / 60 * seconds);
      pend.ore = Math.min(cap.ore, pend.ore + r.ore / 60 * seconds);
      state.base.lastTick = Date.now();
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
  function lowerY(x) { return 576 + HC.noise(x * 0.0040 + 3, 21) * 12; }
  function upperY(x) { return 412 + HC.noise(x * 0.0035 + 5, 44) * 9; }

  var Base = {
    pan: 0, scale: 1, padX: 0, padY: 0, t: 0,
    dragging: false, dragMoved: 0, lastX: 0,
    spots: null,

    /* Раскладываем участки по земле один раз. */
    places: function () {
      if (!this.spots) {
        this.spots = HC.PLOTS.spots.map(function (s) {
          return { x: s.x, y: s.row ? upperY(s.x) : lowerY(s.x), row: s.row };
        });
      }
      return this.spots;
    },

    layout: function (W, H) {
      this.scale = clamp(Math.min(H / VH, W / 680), 0.25, 2.4);
      var vw = W / this.scale;
      if (vw >= VW) { this.pan = (VW - vw) / 2; this.padX = 0; }
      else this.pan = clamp(this.pan, 0, VW - vw);
      this.padX = 0;
      // прижимаем долину к низу, лишнее место отдаём небу
      this.padY = Math.max(0, (H - VH * this.scale) * 0.80);
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
        var d = Math.hypot(v.x - s.x, v.y - (s.y - 45));
        if (d < 80 && d < bestD) { bestD = d; best = i; }
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

      this.drawValley(g, P);
      this.drawDecor(g, P);
      this.drawPath(g, P, state);

      // участки: сначала дальний ярус, потом ближний — чтобы дома не налезали
      var spots = this.places();
      var order = [];
      for (var i = 0; i < spots.length; i++) order.push(i);
      order.sort(function (a, b2) { return spots[b2].row - spots[a].row; });
      for (var k = 0; k < order.length; k++) {
        var i2 = order[k], s = spots[i2];
        if (i2 >= state.base.unlocked) continue;
        var plot = state.base.plots[i2];
        if (plot) this.drawBuilding(g, plot.type, plot.level, s, P);
        else this.drawEmpty(g, s, P);
      }
      if (state.base.unlocked < spots.length) {
        this.drawLocked(g, spots[state.base.unlocked], P);
      }

      this.drawParked(g, P, state);
      g.restore();

      HC.drawVignette(g, W, H, P);
    },

    drawValley: function (g, P) {
      var x;
      // дальние гряды
      g.fillStyle = P.far0;
      g.beginPath(); g.moveTo(-300, VH);
      for (x = -300; x <= VW + 300; x += 20) {
        g.lineTo(x, 250 + HC.noise(x * 0.0022, 31) * 62 + HC.noise(x * 0.007, 12) * 20);
      }
      g.lineTo(VW + 300, VH); g.closePath(); g.fill();

      g.fillStyle = P.far1;
      g.beginPath(); g.moveTo(-300, VH);
      for (x = -300; x <= VW + 300; x += 20) {
        g.lineTo(x, 330 + HC.noise(x * 0.0031 + 9, 77) * 52 + HC.noise(x * 0.009, 5) * 14);
      }
      g.lineTo(VW + 300, VH); g.closePath(); g.fill();

      // верхняя терраса — плато с обрывами по краям
      this.terrace(g, P, upperY, 40, VW - 40, true);
      // нижняя терраса — во всю ширину
      this.terrace(g, P, lowerY, -300, VW + 300, false);
    },

    /* Один уступ долины: заливка, край и штриховка под ним. */
    terrace: function (g, P, fn, x0, x1, rounded) {
      var x;
      g.save();
      var tg = g.createLinearGradient(0, fn(x0) - 20, 0, VH + 200);
      tg.addColorStop(0, P.ground);
      tg.addColorStop(1, P.groundDeep || P.ground);
      g.fillStyle = tg;
      g.beginPath();
      g.moveTo(x0, VH + 900);
      if (rounded) g.lineTo(x0 + 26, fn(x0 + 26) + 10);
      for (x = x0; x <= x1; x += 14) g.lineTo(x, fn(x));
      if (rounded) g.lineTo(x1 - 26, fn(x1 - 26) + 10);
      g.lineTo(x1, VH + 900);
      g.closePath();
      g.fill();

      g.save();
      g.clip();

      // освещённая полоса под кромкой — уступ получает толщину
      g.strokeStyle = P.groundTop || P.ground;
      g.globalAlpha = 0.95;
      g.lineWidth = 9;
      g.lineJoin = 'round';
      g.beginPath();
      for (x = x0; x <= x1; x += 14) {
        if (x === x0) g.moveTo(x, fn(x)); else g.lineTo(x, fn(x));
      }
      g.stroke();
      g.globalAlpha = 1;

      // штриховка
      g.strokeStyle = P.hatch;
      g.globalAlpha = 0.26;
      g.lineWidth = 1;
      g.beginPath();
      for (x = x0; x < x1; x += 36) {
        g.moveTo(x, fn(x) + 13);
        g.lineTo(x - 13, fn(x) + 47);
      }
      g.stroke();
      g.globalAlpha = 1;
      g.restore();

      // кромка
      g.strokeStyle = P.ink;
      g.lineWidth = 2.4;
      g.lineJoin = 'round';
      g.beginPath();
      for (x = x0; x <= x1; x += 14) {
        if (x === x0) g.moveTo(x, fn(x)); else g.lineTo(x, fn(x));
      }
      g.stroke();
      g.restore();
    },

    /* Деревья и камни по краям долины — чтобы это было место, а не полка */
    drawDecor: function (g, P) {
      var self = this;
      // расставлено по промежуткам между участками, чтобы ничего не налезало
      var items = [
        { x: 230, row: 0, t: 'grass', s: 1.1 }, { x: 420, row: 0, t: 'bush', s: 1 },
        { x: 610, row: 0, t: 'grass', s: 1 },   { x: 800, row: 0, t: 'rock', s: 0.85 },
        { x: 990, row: 0, t: 'grass', s: 1.15 },{ x: 1155, row: 0, t: 'tree', s: 1.05 },
        { x: 70,  row: 1, t: 'pine', s: 1.1 },  { x: 275, row: 1, t: 'rock', s: 0.8 },
        { x: 445, row: 1, t: 'grass', s: 1.1 }, { x: 615, row: 1, t: 'bush', s: 0.95 },
        { x: 785, row: 1, t: 'grass', s: 1 },   { x: 950, row: 1, t: 'rock', s: 0.75 },
        { x: 1140, row: 1, t: 'tree', s: 1 },   { x: 1235, row: 1, t: 'pine', s: 1.15 }
      ];
      items.forEach(function (d) {
        var y = d.row ? upperY(d.x) : lowerY(d.x);
        g.save();
        g.translate(d.x, y);
        HC.Decor.shadow(g, P, 14 * d.s, 0.2);
        HC.Decor.draw(g, d.t, P, d.s, d.x % 2 === 0);
        g.restore();
      });
      self.drawSign(g, P);
    },

    /* Указатель на въезде */
    drawSign: function (g, P) {
      var x = 42, y = lowerY(x);
      g.save();
      g.translate(x, y);
      HC.Decor.shadow(g, P, 14, 0.2);
      g.strokeStyle = P.ink; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -52); g.stroke();
      var sg = g.createLinearGradient(0, -62, 0, -34);
      sg.addColorStop(0, P.bodyHi || P.bodyFill);
      sg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = sg; g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-30, -62); g.lineTo(46, -62); g.lineTo(58, -48); g.lineTo(46, -34); g.lineTo(-30, -34);
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = P.ink;
      g.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('долина', 10, -43);
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
      var x = 1243, y = lowerY(x) + 4;
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

    drawEmpty: function (g, s, P) {
      g.save();
      g.translate(s.x, s.y);
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

    /* --- Постройки ---------------------------------------- */
    drawBuilding: function (g, type, level, s, P) {
      // тень на земле — постройка перестаёт быть наклейкой
      g.save();
      g.globalAlpha = 0.5;
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.translate(s.x + 10, s.y + 1);
      g.scale(1, 0.16);
      g.beginPath();
      g.arc(0, 0, 46, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.globalAlpha = 1;

      g.save();
      g.translate(s.x, s.y);
      g.strokeStyle = P.ink;
      var bg = g.createLinearGradient(0, -90, 0, 10);
      bg.addColorStop(0, P.bodyHi || P.bodyFill);
      bg.addColorStop(0.55, P.bodyFill);
      bg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = bg;
      g.lineWidth = 2.4;
      g.lineJoin = 'round';
      var fn = this.shapes[type];
      if (fn) fn.call(this, g, P, level, this.t);
      g.restore();
      this.drawBadge(g, s.x, s.y + 13, level, P);
    },

    drawBadge: function (g, x, y, level, P) {
      g.save();
      g.translate(x, y);
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
        // бочки
        g.lineWidth = 2.2;
        [[-50, 1], [-63, 0.85]].forEach(function (b) {
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
        // оградка
        g.strokeStyle = P.ink; g.lineWidth = 2; g.lineCap = 'round';
        for (var i = 0; i < 7; i++) {
          var x = -58 + i * 19;
          g.beginPath(); g.moveTo(x, 2); g.lineTo(x, -15); g.stroke();
        }
        g.lineWidth = 1.7;
        g.beginPath(); g.moveTo(-60, -11); g.lineTo(58, -11); g.moveTo(-60, -4); g.lineTo(58, -4); g.stroke();

        tree(-34, 1.0, 0);
        tree(30, 0.82, 1.7);

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
