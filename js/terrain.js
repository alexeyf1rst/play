/* ============================================================
   Ландшафт.
   Холмы считаются на лету из числа-семечка: трасса бесконечная,
   но одна и та же при одном и том же seed.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  HC.PPM = 24;            // пикселей мира в одном "метре" на счётчике
  var CHUNK = 130;        // шаг раскладки предметов

  function hash(x, y) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, seed) {
    var i = Math.floor(x), f = x - i;
    var a = hash(i, seed), b = hash(i + 1, seed);
    var u = f * f * (3 - 2 * f);
    return (a + (b - a) * u) * 2 - 1;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function Terrain(track, seed, trackId) {
    this.track = track;
    this.trackId = trackId || 'hills';
    this.seed = seed | 0;
    this.base = 0;
    this.base = this.raw(120);
    this.items = {};       // предметы по чанкам
    this.taken = {};       // что уже подобрано в этом заезде
  }

  /* Чем дальше уехал, тем крупнее холмы и злее кочки.
     Отсюда у заезда появляется естественный конец: рано или поздно
     рельеф станет сложнее, чем твоя машина. */
  Terrain.prototype.hard = function (x) {
    var k = clamp((x - 7000) / 58000, 0, 1);
    return k * k * (3 - 2 * k);
  };

  /* --- Фигуры на трассе -----------------------------------
     Одних холмов мало: без трамплинов машина просто катится.
     Поэтому поверх шума кладутся трамплины, столы, ямы и кочки —
     детерминированно, из того же семечка.
  */
  var FEAT = 1500;         // одна фигура на такой отрезок

  var SHAPES = {
    // трамплин: пологий заход, крутая губа на гребне, обрыв за ней.
    // Губа и подбрасывает — без неё машина просто переваливает холм.
    ramp: function (t) {
      if (t < 0.50) { var u = t / 0.50; return 0.42 * u * u * (3 - 2 * u); }
      if (t < 0.70) { var v = (t - 0.50) / 0.20; return 0.42 + 0.58 * v * v * (3 - 2 * v); }
      var w = (t - 0.70) / 0.30;
      return 1 - w * w * (3 - 2 * w);
    },
    // стол: заход, площадка, съезд
    table: function (t) {
      if (t < 0.34) { var u = t / 0.34; return u * u * (3 - 2 * u); }
      if (t < 0.66) return 1;
      var v = (t - 0.66) / 0.34;
      return 1 - v * v * (3 - 2 * v);
    },
    // яма
    gap: function (t) {
      return -Math.sin(t * Math.PI) * Math.sin(t * Math.PI);
    },
    // череда кочек
    bumps: function (t) {
      return Math.sin(t * Math.PI) * (0.5 + 0.5 * Math.sin(t * Math.PI * 3.5));
    }
  };

  Terrain.prototype.feature = function (k) {
    this.feat = this.feat || {};
    if (this.feat[k] !== undefined) return this.feat[k];
    var f = null;
    if (k * FEAT > 3600) {
      var r = hash(k, this.seed + 301);
      var type = r < 0.40 ? 'ramp' : (r < 0.66 ? 'table' : (r < 0.86 ? 'gap' : 'bumps'));
      var w = 380 + hash(k, this.seed + 303) * 320;
      // высота считается от ширины: так крутизна фигуры всегда в рамках,
      // а не зависит от того, какие числа выпали
      var ratio = { ramp: 0.155, table: 0.18, gap: 0.30, bumps: 0.075 }[type];
      var amp = w * ratio * (0.75 + hash(k, this.seed + 304) * 0.5);
      f = {
        type: type,
        cx: k * FEAT + w / 2 + hash(k, this.seed + 302) * (FEAT - w - 120),
        w: w,
        a: amp
      };
    }
    this.feat[k] = f;
    return f;
  };

  /* Вклад фигур в высоту в точке x.
     Первые полторы сотни метров фигур нет совсем, дальше они входят
     в силу постепенно — иначе новичок улетает с трамплина на 80-м метре. */
  Terrain.prototype.featureH = function (x) {
    var warm = clamp((x - 3600) / 11000, 0, 1);
    if (warm <= 0) return 0;
    warm = warm * warm * (3 - 2 * warm);
    var h = 0;
    var k0 = Math.floor((x - FEAT) / FEAT), k1 = Math.floor((x + FEAT) / FEAT);
    for (var k = k0; k <= k1; k++) {
      var f = this.feature(k);
      if (!f) continue;
      var t = (x - (f.cx - f.w / 2)) / f.w;
      if (t <= 0 || t >= 1) continue;
      h += f.a * SHAPES[f.type](t);
    }
    return h * warm;
  };

  /* Сумма октав шума — "сырая" форма холмов. */
  Terrain.prototype.raw = function (x) {
    var t = this.track, s = this.seed, L = t.len;
    var k = this.hard(x);
    var amp = t.amp * (1 + k * 0.38);
    var rough = t.rough * (1 + k * 0.55);
    var h = vnoise(x / L, s) * amp;
    h += vnoise(x / (L * 0.43) + 17.3, s + 101) * amp * 0.45 * rough;
    h += vnoise(x / (L * 0.19) + 51.7, s + 202) * amp * 0.18 * rough;
    h += vnoise(x / (L * 3.10) + 7.10, s + 303) * amp * 1.10;   // длинная пологая волна
    h += this.featureH(x) * (0.68 + 0.38 * k);                   // трамплины и ямы
    return h;
  };

  /* Высота поверхности в точке x. Меньше y — выше в гору.
     У старта площадка: холмы разгоняются плавно, не со стены. */
  Terrain.prototype.height = function (x) {
    var f = clamp((x - 120) / 1400, 0, 1);
    var ease = f * f * (3 - 2 * f);
    return -(this.base + (this.raw(x) - this.base) * ease);
  };

  Terrain.prototype.slope = function (x) {
    var d = 3;
    return (this.height(x + d) - this.height(x - d)) / (2 * d);
  };

  /* Нормаль к поверхности (смотрит вверх). */
  Terrain.prototype.normal = function (x) {
    var k = this.slope(x);
    var len = Math.sqrt(k * k + 1);
    return { x: k / len, y: -1 / len };
  };

  /* --- Предметы на трассе --------------------------------- */
  Terrain.prototype.chunk = function (k) {
    if (this.items[k]) return this.items[k];
    var list = [];
    var x0 = k * CHUNK;
    if (x0 > 420) {
      var t = this.track;
      var r1 = hash(k, this.seed + 7), r2 = hash(k, this.seed + 8), r3 = hash(k, this.seed + 9);

      if (r1 < 0.055 * t.coinRate) {
        var n = 2 + Math.floor(hash(k, this.seed + 11) * 3);
        var arc = hash(k, this.seed + 12) < 0.4;
        for (var i = 0; i < n; i++) {
          var cx = x0 + 20 + i * 30;
          var lift = arc ? Math.sin((i + 0.5) / n * Math.PI) * 90 : 0;
          list.push({ id: k + ':c' + i, type: 'coin', x: cx, y: this.height(cx) - 40 - lift });
        }
      }
      if (r2 < 0.024) {
        var fx = x0 + 60;
        list.push({ id: k + ':f', type: 'fuel', x: fx, y: this.height(fx) - 34 });
      }
      if (r3 < 0.0018 + t.oreRate * 0.006) {
        var ox = x0 + 90;
        list.push({ id: k + ':o', type: 'ore', x: ox, y: this.height(ox) - 30 });
      }
    }
    this.items[k] = list;
    return list;
  };

  /* Все предметы в диапазоне x (для отрисовки и сбора). */
  Terrain.prototype.itemsIn = function (x0, x1) {
    var out = [];
    var k0 = Math.floor(x0 / CHUNK), k1 = Math.floor(x1 / CHUNK);
    for (var k = k0; k <= k1; k++) {
      var list = this.chunk(k);
      for (var i = 0; i < list.length; i++) {
        if (!this.taken[list[i].id]) out.push(list[i]);
      }
    }
    return out;
  };

  Terrain.prototype.take = function (item) { this.taken[item.id] = 1; };

  /* --- Декорации ------------------------------------------
     Расставлены из семечка: пейзаж у трассы всегда свой,
     но от заезда к заезду не прыгает.
  */
  var DEC = 74;     // шаг раскладки

  Terrain.prototype.decorCell = function (k) {
    this.dec = this.dec || {};
    if (this.dec[k]) return this.dec[k];
    var set = HC.DECOR_SETS[this.trackId] || HC.DECOR_SETS.hills;
    var out = [];
    var r = hash(k, this.seed + 41);
    if (r < 0.72) {
      out.push({
        type: set[Math.floor(hash(k, this.seed + 42) * set.length)],
        x: k * DEC + hash(k, this.seed + 43) * DEC * 0.8,
        s: 0.75 + hash(k, this.seed + 44) * 0.5,
        flip: hash(k, this.seed + 45) < 0.5
      });
      // иногда рядом встаёт второй предмет — получается кучка, а не строй
      if (hash(k, this.seed + 46) < 0.34) {
        out.push({
          type: set[Math.floor(hash(k, this.seed + 47) * set.length)],
          x: k * DEC + 22 + hash(k, this.seed + 48) * DEC * 0.5,
          s: 0.6 + hash(k, this.seed + 49) * 0.4,
          flip: hash(k, this.seed + 50) < 0.5
        });
      }
    }
    this.dec[k] = out;
    return out;
  };

  Terrain.prototype.decorIn = function (x0, x1) {
    var out = [];
    for (var k = Math.floor(x0 / DEC); k <= Math.floor(x1 / DEC); k++) {
      var c = this.decorCell(k);
      for (var i = 0; i < c.length; i++) out.push(c[i]);
    }
    return out;
  };

  /* --- Деревья на дороге (трасса «Лес») -------------------
     Стоят прямо на пути: объехать нельзя, снести можно, но машина
     теряет ход. Сломанные помнятся до конца заезда.
  */
  var TREE = 320;

  Terrain.prototype.treesIn = function (x0, x1) {
    if (!this.track.trees) return [];
    this.brokenTrees = this.brokenTrees || {};
    var out = [];
    for (var k = Math.floor(x0 / TREE); k <= Math.floor(x1 / TREE); k++) {
      if (k * TREE < 900) continue;                 // у старта пусто
      if (hash(k, this.seed + 61) > 0.42) continue;
      var x = k * TREE + hash(k, this.seed + 62) * TREE * 0.7;
      out.push({
        id: k,
        x: x,
        s: 0.95 + hash(k, this.seed + 63) * 0.55,
        kind: hash(k, this.seed + 64) < 0.5 ? 'pine' : 'tree',
        broken: this.brokenTrees[k] || 0
      });
    }
    return out;
  };

  Terrain.prototype.breakTree = function (id) {
    this.brokenTrees = this.brokenTrees || {};
    if (this.brokenTrees[id]) return false;
    this.brokenTrees[id] = 1;
    return true;
  };

  /* Мелочь на дальних холмах — только силуэты, для глубины. */
  Terrain.prototype.farDecorIn = function (x0, x1, seedOff) {
    var out = [];
    var step = 150;
    for (var k = Math.floor(x0 / step); k <= Math.floor(x1 / step); k++) {
      if (hash(k, this.seed + seedOff) < 0.5) {
        out.push({
          x: k * step + hash(k, this.seed + seedOff + 1) * step * 0.7,
          s: 0.4 + hash(k, this.seed + seedOff + 2) * 0.25,
          type: hash(k, this.seed + seedOff + 3) < 0.5 ? 'pine' : 'tree'
        });
      }
    }
    return out;
  };

  /* --- Отрисовка ------------------------------------------ */
  Terrain.prototype.drawSky = function (g, W, H, P) {
    var grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, P.sky0);
    grad.addColorStop(1, P.sky1);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  };

  /* Дальние холмы — просто для глубины, физики у них нет. */
  Terrain.prototype.drawParallax = function (g, cam, W, H, P) {
    var layers = [
      { k: 0.18, amp: 60, freq: 0.0016, y: H * 0.60, col: P.far0, seed: 41 },
      { k: 0.34, amp: 80, freq: 0.0026, y: H * 0.72, col: P.far1, seed: 77 }
    ];
    for (var l = 0; l < layers.length; l++) {
      var L = layers[l];
      var lg = g.createLinearGradient(0, L.y - L.amp, 0, H);
      lg.addColorStop(0, L.col);
      lg.addColorStop(1, l === 0 ? (P.far1 || L.col) : (P.ground || L.col));
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(0, H);
      for (var sx = 0; sx <= W; sx += 12) {
        var wx = (cam.x * L.k + sx);
        var y = L.y + vnoise(wx * L.freq, this.seed + L.seed) * L.amp
                    + vnoise(wx * L.freq * 3.1, this.seed + L.seed + 5) * L.amp * 0.3;
        g.lineTo(sx, y);
      }
      g.lineTo(W, H);
      g.closePath();
      g.fill();
    }
  };

  /* Земля: градиент вглубь, освещённая кромка и штриховка "от руки". */
  Terrain.prototype.drawGround = function (g, cam, W, H, P, quality) {
    var step = 6;
    var pts = [];
    var top = H;
    for (var sx = -step; sx <= W + step; sx += step) {
      var wx = cam.x + (sx - W / 2) / cam.z;
      var sy = (this.height(wx) - cam.y) * cam.z + H / 2;
      if (sy < top) top = sy;
      pts.push({ sx: sx, sy: sy });
    }

    function trace() {
      g.beginPath();
      g.moveTo(pts[0].sx, pts[0].sy);
      for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].sx, pts[i].sy);
    }

    // тело земли — светлее у поверхности, темнее вглубь: появляется толщина
    var grad = g.createLinearGradient(0, top, 0, H + 40);
    grad.addColorStop(0, P.ground);
    grad.addColorStop(1, P.groundDeep || P.ground);
    g.fillStyle = grad;
    trace();
    g.lineTo(W + step, H + 40);
    g.lineTo(-step, H + 40);
    g.closePath();
    g.fill();

    g.save();
    g.clip();

    // освещённая полоса прямо под кромкой
    g.strokeStyle = P.groundTop || P.ground;
    g.globalAlpha = 0.95;
    g.lineWidth = 8;
    g.lineJoin = 'round';
    trace();
    g.stroke();
    g.globalAlpha = 1;

    if (quality !== 'low') {
      g.strokeStyle = P.hatch;
      g.lineWidth = 1;
      g.globalAlpha = 0.45;
      g.beginPath();
      var start = Math.floor(cam.x / 26) * 26;
      for (var wx2 = start - 400; wx2 < cam.x + W / cam.z + 400; wx2 += 26) {
        var sx2 = (wx2 - cam.x) * cam.z + W / 2;
        var sy2 = (this.height(wx2) - cam.y) * cam.z + H / 2;
        g.moveTo(sx2, sy2 + 12);
        g.lineTo(sx2 - 16, sy2 + 54);
      }
      g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();

    // сама кромка
    g.strokeStyle = P.ink;
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    trace();
    g.stroke();
  };

  /* Облака. Рисуются в координатах экрана, поэтому заполняют небо
     при любом соотношении сторон — и на широком мониторе, и на телефоне. */
  function cloud(g, x, y, s) {
    g.beginPath();
    g.arc(x, y, 26 * s, Math.PI, 0);
    g.arc(x + 30 * s, y - 9 * s, 20 * s, Math.PI, 0);
    g.arc(x + 58 * s, y, 22 * s, Math.PI, 0);
    g.lineTo(x - 26 * s, y);
    g.closePath();
    g.fill();
  }

  HC.drawClouds = function (g, W, H, P, offset, horizon, time) {
    g.save();
    g.fillStyle = P.far0;
    g.globalAlpha = 0.5;
    var span = W + 700;
    for (var i = 0; i < 6; i++) {
      var drift = offset * (0.10 + (i % 3) * 0.05) + (time || 0) * (3 + (i % 4) * 2);
      var x = (((i * 421 - drift) % span) + span) % span - 350;
      var y = horizon * (0.10 + 0.62 * ((i * 3) % 5) / 5);
      cloud(g, x, y, 0.75 + ((i * 5) % 7) / 7 * 0.85);
    }
    g.restore();
  };

  /* Солнце днём, луна в тёмной теме. Висит почти неподвижно. */
  HC.drawSun = function (g, W, H, P, offset, dark) {
    var x = W * 0.78 - offset * 0.015;
    var y = H * 0.17;
    g.save();
    g.globalAlpha = 0.5;
    g.fillStyle = P.far0;
    g.beginPath(); g.arc(x, y, 62, 0, 6.3); g.fill();
    g.globalAlpha = 0.85;
    g.fillStyle = P.groundTop || P.far1;
    g.beginPath(); g.arc(x, y, 34, 0, 6.3); g.fill();
    if (dark) {
      g.fillStyle = P.far1;
      g.globalAlpha = 0.7;
      g.beginPath(); g.arc(x - 11, y - 8, 7, 0, 6.3); g.fill();
      g.beginPath(); g.arc(x + 9, y + 6, 5, 0, 6.3); g.fill();
      g.beginPath(); g.arc(x + 3, y - 13, 3.5, 0, 6.3); g.fill();
    }
    g.restore();
    g.globalAlpha = 1;
  };

  /* Пара птиц. Медленно, без суеты. */
  HC.drawBirds = function (g, W, H, P, time, offset) {
    g.save();
    g.strokeStyle = P.ink;
    g.globalAlpha = 0.28;
    g.lineWidth = 1.8;
    g.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      var span = W + 420;
      var x = (((i * 260 + time * (11 + i * 4) - offset * 0.05) % span) + span) % span - 210;
      var y = H * (0.13 + i * 0.05) + Math.sin(time * 0.6 + i) * 7;
      var s = 1 - i * 0.2;
      var flap = Math.sin(time * 2.6 + i * 1.7) * 3;
      g.beginPath();
      g.moveTo(x - 8 * s, y + flap * s);
      g.quadraticCurveTo(x, y - 5 * s, x + 8 * s, y + flap * s);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
  };

  /* Лёгкое затемнение по краям — кадр собирается к центру. */
  HC.drawVignette = function (g, W, H, P) {
    var r = Math.max(W, H) * 0.75;
    var vg = g.createRadialGradient(W / 2, H * 0.45, r * 0.45, W / 2, H * 0.45, r);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, P.vignette || 'rgba(0,0,0,0.10)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  };

  HC.Terrain = Terrain;
  HC.noise = vnoise;
  HC.hash = hash;
})(window.HC);
