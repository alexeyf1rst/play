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

  function Terrain(track, seed) {
    this.track = track;
    this.seed = seed | 0;
    this.base = 0;
    this.base = this.raw(120);
    this.items = {};       // предметы по чанкам
    this.taken = {};       // что уже подобрано в этом заезде
  }

  /* Сумма октав шума — "сырая" форма холмов. */
  Terrain.prototype.raw = function (x) {
    var t = this.track, s = this.seed, L = t.len;
    var h = vnoise(x / L, s) * t.amp;
    h += vnoise(x / (L * 0.43) + 17.3, s + 101) * t.amp * 0.45 * t.rough;
    h += vnoise(x / (L * 0.19) + 51.7, s + 202) * t.amp * 0.18 * t.rough;
    h += vnoise(x / (L * 3.10) + 7.10, s + 303) * t.amp * 1.10;   // длинная пологая волна
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

      if (r1 < 0.06 * t.coinRate) {
        var n = 2 + Math.floor(hash(k, this.seed + 11) * 3);
        var arc = hash(k, this.seed + 12) < 0.4;
        for (var i = 0; i < n; i++) {
          var cx = x0 + 20 + i * 30;
          var lift = arc ? Math.sin((i + 0.5) / n * Math.PI) * 90 : 0;
          list.push({ id: k + ':c' + i, type: 'coin', x: cx, y: this.height(cx) - 40 - lift });
        }
      }
      if (r2 < 0.005) {
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
      g.fillStyle = L.col;
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

  /* Земля: сплошная заливка + штриховка "от руки". */
  Terrain.prototype.drawGround = function (g, cam, W, H, P, quality) {
    var step = 6;
    var pts = [];
    for (var sx = -step; sx <= W + step; sx += step) {
      var wx = cam.x + (sx - W / 2) / cam.z;
      pts.push({ sx: sx, sy: (this.height(wx) - cam.y) * cam.z + H / 2 });
    }

    g.fillStyle = P.ground;
    g.beginPath();
    g.moveTo(pts[0].sx, pts[0].sy);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].sx, pts[i].sy);
    g.lineTo(W + step, H + 40);
    g.lineTo(-step, H + 40);
    g.closePath();
    g.fill();

    // штриховка под поверхностью
    if (quality !== 'low') {
      g.save();
      g.clip();
      g.strokeStyle = P.hatch;
      g.lineWidth = 1;
      g.globalAlpha = 0.5;
      g.beginPath();
      var start = Math.floor(cam.x / 26) * 26;
      for (var wx2 = start - 400; wx2 < cam.x + W / cam.z + 400; wx2 += 26) {
        var sx2 = (wx2 - cam.x) * cam.z + W / 2;
        var sy2 = (this.height(wx2) - cam.y) * cam.z + H / 2;
        g.moveTo(sx2, sy2 + 4);
        g.lineTo(sx2 - 16, sy2 + 46);
      }
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
    }

    // линия поверхности
    g.strokeStyle = P.ink;
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0].sx, pts[0].sy);
    for (var j = 1; j < pts.length; j++) g.lineTo(pts[j].sx, pts[j].sy);
    g.stroke();
  };

  HC.Terrain = Terrain;
  HC.noise = vnoise;
  HC.hash = hash;
})(window.HC);
