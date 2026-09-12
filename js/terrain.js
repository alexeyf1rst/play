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

  var TREE = 360;         // шаг раскладки деревьев-препятствий

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
    this.soft = !!track.soft;      // трасса, в которой можно провалиться
    this.hole = {};                // продавленные в песке воронки
    this.logs = {};                // поваленные стволы по чанкам
    this.hasLogs = false;
    this.mix = track.feats || FEAT_MIX;
    this.base = 0;
    this.base = this.raw(120);
    this.items = {};       // предметы по чанкам
    this.taken = {};       // что уже подобрано в этом заезде
  }

  /* Каждые 1000 метров трасса становится злее — и так на всех трассах.
     Ступенька размазана по последней десятой километра: если менять
     амплитуду рывком, ровно на рубеже вырастет стена.
     Отсюда у заезда появляется естественный конец: рано или поздно
     рельеф станет сложнее, чем твоя машина. */
  Terrain.prototype.stage = function (x) {
    var s = x / HC.PPM / 1000;
    if (s <= 0) return 0;
    var i = Math.floor(s), f = s - i;
    var t = f < 0.85 ? 0 : (f - 0.85) / 0.15;
    return i + t * t * (3 - 2 * t);
  };

  /* Насыщающаяся сложность: первый километр меняет много, десятый — чуть. */
  Terrain.prototype.hard = function (x) {
    return 1 - Math.pow(0.78, this.stage(x));
  };

  /* --- Фигуры на трассе -----------------------------------
     Одних холмов мало: без трамплинов машина просто катится.
     Поэтому поверх шума кладутся трамплины, столы, ямы и кочки —
     детерминированно, из того же семечка.
  */
  var FEAT = 1500;         // одна фигура на такой отрезок
  var FEAT_MIX = { ramp: 0.40, table: 0.26, gap: 0.20, bumps: 0.14 };

  /* Выбор фигуры по набору трассы: на хайвэе, например, ям не бывает. */
  function pickShape(r, mix) {
    var sum = 0, k;
    for (k in mix) sum += mix[k];
    var acc = 0;
    for (k in mix) {
      acc += mix[k] / sum;
      if (r <= acc) return k;
    }
    return 'ramp';
  }

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
      var type = pickShape(r, this.mix);
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
    var amp = t.amp * (1 + k * 0.62);
    var rough = t.rough * (1 + k * 1.00);
    var h = vnoise(x / L, s) * amp;
    h += vnoise(x / (L * 0.43) + 17.3, s + 101) * amp * 0.45 * rough;
    h += vnoise(x / (L * 0.19) + 51.7, s + 202) * amp * 0.18 * rough;
    h += vnoise(x / (L * 3.10) + 7.10, s + 303) * amp * 1.10;   // длинная пологая волна
    h += this.featureH(x) * (0.62 + 0.75 * k);                   // трамплины и ямы
    h += this.duneH(x);                                          // дюны песочницы
    return h;
  };

  /* Дюна: длинный наветренный склон и крутой сыпучий подветренный.
     Ехать вправо — значит долго ползти вверх и разом сыпаться вниз. */
  var DUNE = 520;

  Terrain.prototype.duneH = function (x) {
    var t = this.track;
    if (!t.dunes) return 0;
    var u = x / DUNE, i = Math.floor(u), f = u - i;
    var amp = (36 + hash(i, this.seed + 131) * 72) * t.dunes * (1 + this.hard(x) * 0.5);
    var v = f < 0.78 ? f / 0.78 : (1 - f) / 0.22;
    v = v * v * (3 - 2 * v);
    return amp * v;
  };

  /* --- Жидкий песок --------------------------------------
     В рыхлых пятнах колесо продавливает воронку: стоишь — тонешь,
     едешь — выгребаешь. Воронки медленно затягивает обратно.
     Считать их приходится в height(), поэтому всё держится
     в ячейках и стоит три обращения к объекту.
  */
  var SOFT = 46;           // ширина ячейки воронки
  var SOFT_MAX = 30;       // насколько глубоко можно провалиться

  /* Насколько песок рыхлый в этой точке: 0 — плотный, 1 — совсем жидкий. */
  Terrain.prototype.softness = function (x) {
    var t = this.track;
    if (!t.soft) return 0;
    // первую сотню метров песок плотный: провалиться на старте — обидно
    var warm = clamp((x - 2400) / 2400, 0, 1);
    if (warm <= 0) return 0;
    var n = vnoise(x / 640, this.seed + 141) + vnoise(x / 220, this.seed + 142) * 0.45;
    return clamp((n + 0.28) / 0.85, 0, 1) * t.soft * warm * warm * (3 - 2 * warm);
  };

  /* Колесо продавило песок. */
  Terrain.prototype.dig = function (x, amount) {
    var k = Math.round(x / SOFT);
    this.hole[k] = Math.min(SOFT_MAX, (this.hole[k] || 0) + amount);
  };

  /* Глубина воронки в точке. */
  Terrain.prototype.holeAt = function (x) {
    var k = x / SOFT, i = Math.floor(k), f = k - i;
    var a = this.hole[i] || 0, b = this.hole[i + 1] || 0;
    if (!a && !b) return 0;
    var u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  };

  /* Песок сам осыпается обратно. */
  Terrain.prototype.settle = function (dt) {
    var h = this.hole;
    for (var k in h) {
      h[k] -= 7 * dt;
      if (h[k] <= 0.02) delete h[k];
    }
  };

  /* --- Поваленные стволы ---------------------------------
     Сбитое дерево ложится поперёк дороги и становится настоящим бугром:
     он входит в высоту поверхности, а значит в него упираются колёса,
     днище и подвеска — без отдельной «логики столкновений».
  */
  var LOG_W = 74;          // полуширина бугра от бревна
  var LOG_H = 30;          // насколько бревно торчит над землёй

  Terrain.prototype.dropLog = function (x, s) {
    var k = Math.floor(x / TREE);
    (this.logs[k] = this.logs[k] || []).push({
      x: x, w: LOG_W * (0.8 + s * 0.3), h: LOG_H * (0.75 + s * 0.35), s: s
    });
    this.hasLogs = true;
  };

  /* Вклад брёвен в высоту: гладкий бугор (1-t^2)^2, через него надо
     переползать, но он не стена. */
  Terrain.prototype.logAt = function (x) {
    var k = Math.floor(x / TREE), h = 0;
    for (var j = k - 1; j <= k + 1; j++) {
      var list = this.logs[j];
      if (!list) continue;
      for (var i = 0; i < list.length; i++) {
        var L = list[i];
        var t = (x - L.x) / L.w;
        if (t <= -1 || t >= 1) continue;
        var c = 1 - t * t;
        h += L.h * c * c;
      }
    }
    return h;
  };

  Terrain.prototype.logsIn = function (x0, x1) {
    var out = [];
    for (var k = Math.floor(x0 / TREE) - 1; k <= Math.floor(x1 / TREE) + 1; k++) {
      var list = this.logs[k];
      if (list) for (var i = 0; i < list.length; i++) out.push(list[i]);
    }
    return out;
  };

  /* Высота поверхности в точке x. Меньше y — выше в гору.
     У старта площадка: холмы разгоняются плавно, не со стены. */
  Terrain.prototype.height = function (x) {
    var f = clamp((x - 120) / 1400, 0, 1);
    var ease = f * f * (3 - 2 * f);
    var y = -(this.base + (this.raw(x) - this.base) * ease);
    if (this.soft) y += this.holeAt(x);      // провалились в песок
    if (this.hasLogs) y -= this.logAt(x);    // лежащий ствол
    return y;
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
      if (r2 < 0.011) {
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
     Стоят прямо на пути. Сбить можно — но ствол ложится поперёк
     дороги и остаётся преградой до конца заезда.
  */

  Terrain.prototype.treesIn = function (x0, x1) {
    if (!this.track.trees) return [];
    this.brokenTrees = this.brokenTrees || {};
    var out = [];
    for (var k = Math.floor(x0 / TREE); k <= Math.floor(x1 / TREE); k++) {
      if (k * TREE < 900) continue;                 // у старта пусто
      if (hash(k, this.seed + 61) > 0.32) continue;
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
    var set = this.track.far || ['pine', 'tree'];
    for (var k = Math.floor(x0 / step); k <= Math.floor(x1 / step); k++) {
      if (hash(k, this.seed + seedOff) < 0.5) {
        out.push({
          x: k * step + hash(k, this.seed + seedOff + 1) * step * 0.7,
          s: 0.4 + hash(k, this.seed + seedOff + 2) * 0.25,
          type: set[Math.floor(hash(k, this.seed + seedOff + 3) * set.length)]
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

    // хайвэй: вместо земляной кромки — полотно с разметкой
    if (this.track.road) this.drawRoad(g, pts, cam, W, P);

    if (quality !== 'low' && !this.track.road) {
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

  /* Асфальт. В профиль дорога видна почти с торца, поэтому полотно —
     это широкая тёмная полоса по кромке: светлая линия обочины сверху,
     прерывистая разметка ниже. Пунктир привязан к миру, а не к экрану,
     иначе разметка ползла бы вместе с камерой. */
  Terrain.prototype.drawRoad = function (g, pts, cam, W, P) {
    function trace(off) {
      g.beginPath();
      g.moveTo(pts[0].sx, pts[0].sy + off);
      for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].sx, pts[i].sy + off);
    }
    var z = cam.z;
    g.save();
    g.lineJoin = 'round';
    g.lineCap = 'butt';

    g.strokeStyle = P.road || P.groundDeep || P.ground;
    g.lineWidth = 30 * z;
    trace(15 * z);
    g.stroke();

    g.strokeStyle = P.roadLine || P.bodyFill;
    g.globalAlpha = 0.85;
    g.lineWidth = Math.max(1.5, 3 * z);
    trace(2 * z);
    g.stroke();

    // разметка по середине полотна
    var period = 46 * z;
    var x0 = cam.x + (pts[0].sx - W / 2) / z;     // мир в начале ломаной
    g.setLineDash([26 * z, 20 * z]);
    g.lineDashOffset = -((x0 * z) % period);
    g.globalAlpha = 0.62;
    g.lineWidth = Math.max(1.2, 2.6 * z);
    trace(15 * z);
    g.stroke();
    g.setLineDash([]);
    g.restore();
    g.globalAlpha = 1;
  };

  /* Отбойник вдоль полотна: стойки и двойная лента, повторяющая профиль.
     Рисуется в мировых координатах, до машины — то есть позади неё. */
  Terrain.prototype.drawRail = function (g, x0, x1, P) {
    if (!this.track.rail) return;
    var step = 62, x;
    g.save();
    g.strokeStyle = P.ink;
    g.lineCap = 'round';

    g.globalAlpha = 0.45;
    g.lineWidth = 3;
    g.beginPath();
    for (x = Math.floor(x0 / step) * step; x < x1; x += step) {
      var y = this.height(x);
      g.moveTo(x, y + 2);
      g.lineTo(x, y - 38);
    }
    g.stroke();

    g.globalAlpha = 0.7;
    g.lineWidth = 4.5;
    var first = true;
    g.beginPath();
    for (x = Math.floor(x0 / 18) * 18; x < x1; x += 18) {
      var yy = this.height(x) - 34;
      if (first) { g.moveTo(x, yy); first = false; } else g.lineTo(x, yy);
    }
    g.stroke();
    g.restore();
    g.globalAlpha = 1;
  };

  /* Лежащий ствол. Препятствие уже сидит в высоте поверхности, поэтому
     здесь только сам ствол: он лежит в бугре, нижняя половина в земле. */
  Terrain.prototype.drawLog = function (g, L, P) {
    // земля без самого бревна — иначе ствол повис бы над своим же бугром
    var ground = this.height(L.x) + this.logAt(L.x);
    var len = L.w * 1.5;
    var hgt = L.h + 10;
    var top = ground - L.h - 1;

    g.save();
    g.translate(L.x, 0);
    g.globalAlpha = 0.2;
    g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
    g.beginPath();
    g.ellipse(6, ground + 2, len * 0.55, 6, 0, 0, 6.3);
    g.fill();
    g.globalAlpha = 1;

    var lg = g.createLinearGradient(0, top, 0, top + hgt);
    lg.addColorStop(0, P.bodyHi || P.bodyFill);
    lg.addColorStop(1, P.bodyShade || P.bodyFill);
    g.fillStyle = lg;
    g.strokeStyle = P.ink;
    g.lineWidth = 2.4;
    g.lineJoin = 'round';
    g.beginPath();
    if (g.roundRect) g.roundRect(-len / 2, top, len, hgt, hgt / 2);
    else g.rect(-len / 2, top, len, hgt);
    g.fill();
    g.stroke();

    // срез с годовыми кольцами и пара сучьев
    g.lineWidth = 1.5;
    g.globalAlpha = 0.7;
    g.beginPath();
    g.ellipse(len / 2 - hgt / 2.6, top + hgt * 0.42, hgt * 0.16, hgt * 0.3, 0, 0, 6.3);
    g.stroke();
    g.beginPath();
    g.moveTo(-len * 0.22, top + 3); g.lineTo(-len * 0.3, top - 16);
    g.moveTo(len * 0.06, top + 2); g.lineTo(len * 0.16, top - 13);
    g.stroke();
    g.restore();
    g.globalAlpha = 1;
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
