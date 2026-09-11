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
      HC.drawClouds(g, W, H, P, this.pan * this.scale, this.padY + 300 * this.scale, this.t);

      g.save();
      g.translate(this.padX, this.padY);
      g.scale(this.scale, this.scale);
      g.translate(-this.pan, 0);

      this.drawValley(g, P);

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
      g.restore();
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
      g.fillStyle = P.ground;
      g.beginPath();
      g.moveTo(x0, VH + 900);
      if (rounded) g.lineTo(x0 + 26, fn(x0 + 26) + 10);
      for (x = x0; x <= x1; x += 14) g.lineTo(x, fn(x));
      if (rounded) g.lineTo(x1 - 26, fn(x1 - 26) + 10);
      g.lineTo(x1, VH + 900);
      g.closePath();
      g.fill();

      // штриховка сразу под кромкой
      g.save();
      g.clip();
      g.strokeStyle = P.hatch;
      g.globalAlpha = 0.45;
      g.lineWidth = 1;
      g.beginPath();
      for (x = x0; x < x1; x += 22) {
        g.moveTo(x, fn(x) + 3);
        g.lineTo(x - 14, fn(x) + 40);
      }
      g.stroke();
      g.restore();
      g.globalAlpha = 1;

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
      var box = { x0: -74, x1: 74, y0: -92, y1: 12 };
      var s = Math.min(W / (box.x1 - box.x0), H / (box.y1 - box.y0));
      g.translate(W / 2, H - 2);
      g.scale(s, s);
      g.translate(-(box.x0 + box.x1) / 2, -box.y1);

      g.strokeStyle = P.ink;
      g.fillStyle = P.bodyFill;
      g.lineWidth = 2.4;
      g.lineJoin = 'round';
      var fn = this.shapes[type];
      if (fn) fn.call(this, g, P, 1, 0.75);

      this._thumbs[key] = c.toDataURL('image/png');
      return this._thumbs[key];
    },

    /* --- Постройки ---------------------------------------- */
    drawBuilding: function (g, type, level, s, P) {
      g.save();
      g.translate(s.x, s.y);
      g.strokeStyle = P.ink;
      g.fillStyle = P.bodyFill;
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
      mine: function (g, P, level, t) {
        // отвал породы
        g.fillStyle = P.far1;
        g.beginPath(); g.moveTo(-58, 0); g.lineTo(-30, -40); g.lineTo(4, 0); g.closePath();
        g.fill(); g.stroke();
        // вход
        g.fillStyle = P.ink;
        g.beginPath();
        g.moveTo(-44, 0); g.lineTo(-44, -20); g.quadraticCurveTo(-30, -34, -16, -20); g.lineTo(-16, 0);
        g.closePath(); g.fill();
        // рельсы
        g.strokeStyle = P.ink; g.lineWidth = 2;
        g.beginPath(); g.moveTo(-20, -4); g.lineTo(40, -4); g.moveTo(-20, 0); g.lineTo(40, 0); g.stroke();
        for (var i = 0; i < 7; i++) {
          g.beginPath(); g.moveTo(-16 + i * 9, -6); g.lineTo(-16 + i * 9, 2); g.stroke();
        }
        // вагонетка ездит туда-сюда
        var k = (Math.sin(t * 0.35) * 0.5 + 0.5);
        var cx = -10 + k * 44;
        g.save(); g.translate(cx, -12);
        g.fillStyle = P.bodyFill; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(-11, -9); g.lineTo(11, -9); g.lineTo(8, 6); g.lineTo(-8, 6); g.closePath();
        g.fill(); g.stroke();
        g.beginPath(); g.arc(-5, 8, 3.4, 0, 6.3); g.fill(); g.stroke();
        g.beginPath(); g.arc(5, 8, 3.4, 0, 6.3); g.fill(); g.stroke();
        g.restore();
        // копёр с колесом
        g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(-30, -40); g.lineTo(-30, -66); g.stroke();
        g.save(); g.translate(-30, -70); g.rotate(t * 0.5);
        g.fillStyle = P.rim;
        g.beginPath(); g.arc(0, 0, 12, 0, 6.3); g.fill(); g.stroke();
        g.lineWidth = 1.8;
        for (var s2 = 0; s2 < 4; s2++) {
          var a = s2 / 4 * Math.PI * 2;
          g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); g.stroke();
        }
        g.restore();
      },

      drill: function (g, P, level, t) {
        g.fillStyle = P.bodyFill;
        // вышка
        g.beginPath();
        g.moveTo(-30, 0); g.lineTo(-12, -76); g.lineTo(12, -76); g.lineTo(30, 0);
        g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 1.8;
        for (var i = 1; i < 4; i++) {
          var y = -i * 19;
          var w = 30 - i * 4.7;
          g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
          g.beginPath(); g.moveTo(-w, y); g.lineTo(w - 6, y + 19); g.stroke();
        }
        // бур крутится
        g.lineWidth = 2.4;
        g.save(); g.translate(0, -8); g.rotate(t * 1.6);
        g.fillStyle = P.rim;
        g.beginPath(); g.moveTo(-7, -10); g.lineTo(7, -10); g.lineTo(0, 12); g.closePath();
        g.fill(); g.stroke();
        g.restore();
        // площадка
        g.fillStyle = P.far1;
        g.beginPath(); g.rect(-40, 0, 80, 7); g.fill(); g.stroke();
      },

      storage: function (g, P, level, t) {
        g.fillStyle = P.bodyFill;
        // силос
        g.beginPath();
        g.moveTo(-34, 0); g.lineTo(-34, -54);
        g.quadraticCurveTo(-34, -76, 0, -76);
        g.quadraticCurveTo(34, -76, 34, -54);
        g.lineTo(34, 0); g.closePath();
        g.fill(); g.stroke();
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(-34, -34); g.lineTo(34, -34); g.moveTo(-34, -16); g.lineTo(34, -16); g.stroke();
        // дверца
        g.lineWidth = 2.2;
        g.fillStyle = P.ink;
        g.beginPath(); g.rect(-10, -18, 20, 18); g.fill();
        // пристройка
        g.fillStyle = P.bodyFill;
        g.beginPath();
        g.moveTo(34, 0); g.lineTo(34, -26); g.lineTo(60, -34); g.lineTo(60, 0);
        g.closePath(); g.fill(); g.stroke();
      },

      windmill: function (g, P, level, t) {
        g.fillStyle = P.bodyFill;
        g.beginPath();
        g.moveTo(-20, 0); g.lineTo(-9, -70); g.lineTo(9, -70); g.lineTo(20, 0);
        g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(-15, -30); g.lineTo(15, -30); g.stroke();
        g.save();
        g.translate(0, -74);
        g.rotate(t * 0.32);        // медленно, чтобы не мельтешило
        g.lineWidth = 2.4;
        g.fillStyle = P.bodyFill;
        for (var b = 0; b < 4; b++) {
          g.save(); g.rotate(b / 4 * Math.PI * 2);
          g.beginPath();
          g.moveTo(0, 0); g.lineTo(-5, -40); g.lineTo(5, -40); g.closePath();
          g.fill(); g.stroke();
          g.restore();
        }
        g.fillStyle = P.ink;
        g.beginPath(); g.arc(0, 0, 4.5, 0, 6.3); g.fill();
        g.restore();
      },

      workshop: function (g, P, level, t) {
        g.fillStyle = P.bodyFill;
        g.beginPath(); g.rect(-46, -44, 92, 44); g.fill(); g.stroke();
        g.beginPath();
        g.moveTo(-54, -44); g.lineTo(0, -74); g.lineTo(54, -44); g.closePath();
        g.fill(); g.stroke();
        // дверь и окно
        g.fillStyle = P.ink;
        g.beginPath(); g.rect(-30, -28, 22, 28); g.fill();
        g.fillStyle = P.rim;
        g.beginPath(); g.rect(6, -32, 26, 20); g.fill(); g.stroke();
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(19, -32); g.lineTo(19, -12); g.moveTo(6, -22); g.lineTo(32, -22); g.stroke();
        // труба и дымок
        g.lineWidth = 2.4;
        g.fillStyle = P.bodyFill;
        g.beginPath(); g.rect(24, -78, 14, 26); g.fill(); g.stroke();
        g.globalAlpha = 0.3;
        g.fillStyle = P.ink;
        for (var i = 0; i < 3; i++) {
          var p = (t * 0.25 + i / 3) % 1;
          g.beginPath();
          g.arc(31 + Math.sin(p * 5) * 7, -82 - p * 46, 4 + p * 8, 0, 6.3);
          g.fill();
        }
        g.globalAlpha = 1;
      },

      garden: function (g, P, level, t) {
        var self = this;
        function tree(x, sc, phase) {
          g.save();
          g.translate(x, 0); g.scale(sc, sc);
          g.rotate(Math.sin(t * 0.4 + phase) * 0.02);
          g.strokeStyle = P.ink; g.lineWidth = 3 / sc;
          g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -30); g.stroke();
          g.lineWidth = 2.4 / sc;
          g.fillStyle = P.bodyFill;
          g.beginPath(); g.arc(0, -46, 20, 0, 6.3); g.fill(); g.stroke();
          g.beginPath(); g.arc(-13, -36, 13, 0, 6.3); g.fill(); g.stroke();
          g.beginPath(); g.arc(14, -37, 12, 0, 6.3); g.fill(); g.stroke();
          g.restore();
        }
        tree(-26, 1.05, 0);
        tree(24, 0.85, 1.7);
        g.strokeStyle = P.ink; g.lineWidth = 2.2; g.fillStyle = P.far1;
        g.beginPath(); g.arc(0, -8, 11, Math.PI, 0); g.fill(); g.stroke();
      }
    }
  };

  HC.Base = Base;
  HC.BASE_VIEW = { VW: VW, VH: VH };
})(window.HC);
