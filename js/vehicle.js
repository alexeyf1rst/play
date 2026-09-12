/* ============================================================
   Машина.
   Кузов — твёрдое тело, колёса — отдельные точки на пружинах.
   Тяга крутит колесо, колесо отталкивается от земли,
   а отдача от двигателя пытается поставить машину на дыбы.
   Отсюда весь фирменный характер Hill Climb.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  var REF_G = 1400;    // гравитация, под которую считаем пружины
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function Vehicle(id, up, terrain, gravity, tune) {
    var def = HC.VEHICLES[id];
    var E = HC.upgradeEffect;
    up = up || {};
    tune = tune || HC.defaultTune(id);
    var T = HC.TUNING;
    function knob(k) {
      var val = typeof tune[k] === 'number' ? tune[k] : T[k].def;
      return Math.max(T[k].min, Math.min(T[k].max, val));
    }
    var gear = knob('gear'), stiff = knob('stiff'), travel = knob('travel');
    var press = knob('press'), bal = knob('balance'), airk = knob('air');
    this.tune = tune;

    this.id = id;
    this.def = def;
    this.terrain = terrain;
    this.gravity = gravity;

    var lu = { engine: up.engine | 0, tires: up.tires | 0, susp: up.susp | 0, fuel: up.fuel | 0, magnet: up.magnet | 0 };
    // короткая передача даёт тягу, длинная — скорость
    this.power = def.power * E.engine(lu.engine) / Math.sqrt(gear);
    this.topSpeed = def.topSpeed * (1 + lu.engine * 0.018) * Math.pow(gear, 0.6);
    // покрытие трассы: песок вязкий и скользкий, асфальт наоборот
    var surf = (terrain && terrain.track) || {};
    this.surfGrip = surf.grip || 1;
    this.surfRoll = surf.roll || 1;
    this.lift = def.lift || 0;          // луноход слегка парит

    // низкое давление — цепче, но хуже катится
    this.grip = def.wheel.grip * E.tires(lu.tires) * (1.30 - 0.30 * press) * this.surfGrip;
    this.rollFree = 0.5 * (1.70 - 0.70 * press) * this.surfRoll;
    // отзывчивость в воздухе: общая настройка × характер машины × ползунок тюнинга
    var airBase = def.airCtrl || 1;
    this.airK = HC.WORLD.airControl * airBase * airk;
    this.airMax = Math.max(3.6, Math.min(11.5, 5.6 * airBase * Math.sqrt(airk)));
    // гараж на базе: бак больше, расход меньше
    var st0 = (HC.Game && HC.Game.state && HC.Economy) ? HC.Game.state : null;
    this.maxFuel = def.fuel * E.fuel(lu.fuel) * (st0 ? HC.Economy.garageFuel(st0) : 1);
    this.burnK = st0 ? HC.Economy.garageBurn(st0) : 1;
    this.magnet = E.magnet(lu.magnet);

    // масса и момент инерции кузова
    var bb = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
    def.body.forEach(function (p) {
      bb.x0 = Math.min(bb.x0, p[0]); bb.x1 = Math.max(bb.x1, p[0]);
      bb.y0 = Math.min(bb.y0, p[1]); bb.y1 = Math.max(bb.y1, p[1]);
    });
    var bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
    this.mass = def.mass;
    this.I = def.mass * (bw * bw + bh * bh) / 12;

    // подвеска: считаем жёсткость из массы и желаемой просадки
    var total = def.mass + def.wheel.mass * def.axles.length;
    var suspMul = (1 + lu.susp * 0.02) * stiff;
    this.suspRest = def.susp.rest * (0.85 + 0.15 * travel);
    this.suspMin = def.susp.min;
    this.suspMax = def.susp.max * (1 + lu.susp * 0.03) * travel;
    this.suspK = (total * REF_G / def.axles.length) / def.susp.sag * suspMul;
    this.suspC = 2 * Math.sqrt(this.suspK * (total / def.axles.length)) * def.susp.damp *
                 (1 + lu.susp * 0.05) * Math.sqrt(stiff);

    // колёса. Радиус и масса берутся с оси, если она их задаёт —
    // так у трактора заднее колесо больше переднего.
    this.wheels = def.axles.map(function (a) {
      var r = a.r || def.wheel.r;
      var m = a.mass || def.wheel.mass;
      return {
        lx: a.x + bal * 9, ly: a.y, r: r,       // развесовка сдвигает колёса относительно центра масс
        mass: m,
        I: 0.5 * m * r * r,
        pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
        spin: 0, spinAngle: 0,
        contact: false, load: 0, drive: true
      };
    });

    // какие колёса ведущие
    var mode = tune.drive || def.drive || 'all';
    if (!HC.DRIVE[mode]) mode = 'all';
    this.driveMode = mode;
    var xs = this.wheels.map(function (w) { return w.lx; });
    var rear = Math.min.apply(null, xs), front = Math.max.apply(null, xs);
    this.wheels.forEach(function (w) {
      w.drive = mode === 'all' ? true
              : mode === 'rear' ? w.lx < rear + 1
              : w.lx > front - 1;
    });
    this.driven = this.wheels.filter(function (w) { return w.drive; });
    if (!this.driven.length) { this.wheels[0].drive = true; this.driven = [this.wheels[0]]; }

    // точки кузова, которыми он цепляет землю
    this.hull = [];
    for (var i = 0; i < def.body.length; i++) {
      var a = def.body[i], b = def.body[(i + 1) % def.body.length];
      this.hull.push([a[0], a[1]]);
      this.hull.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }

    this.reset(80);
  }

  Vehicle.prototype.reset = function (x) {
    var gy = this.terrain.height(x);
    this.pos = { x: x, y: gy - this.def.wheel.r - this.suspRest - this.def.axles[0].y };
    this.vel = { x: 0, y: 0 };
    this.ang = 0;
    this.angVel = 0;
    this.fuel = this.maxFuel;
    this.crashed = false;
    this.stopped = false;
    this.airTime = 0;
    this.airT = 0;
    this.spinAccum = 0;
    this.distance = 0;
    this.startX = x;
    var self = this;
    this.wheels.forEach(function (w) {
      w.pos.x = self.pos.x + w.lx;
      w.pos.y = self.pos.y + w.ly + self.suspRest;
      w.vel.x = 0; w.vel.y = 0;
      w.spin = 0; w.spinAngle = 0; w.contact = false;
    });
  };

  Vehicle.prototype.worldPoint = function (lx, ly) {
    var c = Math.cos(this.ang), s = Math.sin(this.ang);
    return { x: this.pos.x + lx * c - ly * s, y: this.pos.y + lx * s + ly * c };
  };

  Vehicle.prototype.applyImpulse = function (ix, iy, px, py) {
    this.vel.x += ix / this.mass;
    this.vel.y += iy / this.mass;
    var rx = px - this.pos.x, ry = py - this.pos.y;
    this.angVel += (rx * iy - ry * ix) / this.I;
  };

  /* --- Один шаг физики ------------------------------------ */
  Vehicle.prototype.step = function (h, input) {
    var T = this.terrain, g = this.gravity;
    var c = Math.cos(this.ang), s = Math.sin(this.ang);
    var ax_ = { x: c, y: s };          // ось "вперёд" кузова
    var dn = { x: -s, y: c };          // ось "вниз" кузова
    var throttle = this.crashed ? 0 : input.throttle;
    if (this.fuel <= 0) throttle = 0;

    // в воздухе луноход падает медленнее — он «немного летает»
    if (this.lift && !this.onGround) g *= (1 - this.lift);

    this.vel.y += g * h;

    var anyContact = false;
    var i, w;

    /* 1. Двигатель: момент на колёса и отдача на кузов */
    if (throttle !== 0) {
      var force = this.power * throttle;
      var n = this.driven.length;
      for (i = 0; i < n; i++) {
        w = this.driven[i];
        var v = w.spin * w.r;
        // не разгоняем колесо выше предельной скорости
        if (!(throttle > 0 && v > this.topSpeed) && !(throttle < 0 && v < -this.topSpeed * 0.55)) {
          w.spin += (force / n) * w.r / w.I * h;
        }
      }
    }

    /* 2. Подвеска */
    for (i = 0; i < this.wheels.length; i++) {
      w = this.wheels[i];
      w.vel.y += g * h;

      var axp = this.pos.x + w.lx * c - w.ly * s;
      var ayp = this.pos.y + w.lx * s + w.ly * c;
      var arx = axp - this.pos.x, ary = ayp - this.pos.y;
      var avx = this.vel.x - this.angVel * ary;
      var avy = this.vel.y + this.angVel * arx;

      var dx = w.pos.x - axp, dy = w.pos.y - ayp;
      var len = dx * dn.x + dy * dn.y;              // ход подвески
      var lat = dx * ax_.x + dy * ax_.y;            // боковой увод

      var rvx = w.vel.x - avx, rvy = w.vel.y - avy;
      var vs = rvx * dn.x + rvy * dn.y;
      var vl = rvx * ax_.x + rvy * ax_.y;

      var Fs = this.suspK * (this.suspRest - len) - this.suspC * vs;
      if (len > this.suspMax) Fs -= (len - this.suspMax) * this.suspK * 10;
      if (len < this.suspMin) Fs += (this.suspMin - len) * this.suspK * 10;
      var Fl = -lat * this.suspK * 14 - vl * this.suspC * 3;

      var fx = dn.x * Fs + ax_.x * Fl;
      var fy = dn.y * Fs + ax_.y * Fl;

      w.vel.x += fx / w.mass * h;
      w.vel.y += fy / w.mass * h;
      this.applyImpulse(-fx * h, -fy * h, axp, ayp);
    }

    /* 3. Колёса и земля */
    for (i = 0; i < this.wheels.length; i++) {
      w = this.wheels[i];
      w.contact = false;
      w.load = 0;

      // ищем самую глубокую точку касания по дуге колеса
      var best = null;
      for (var k = -2; k <= 2; k++) {
        var a = k * 0.45;
        var px = w.pos.x + Math.sin(a) * w.r;
        var py = w.pos.y + Math.cos(a) * w.r;
        var gy = T.height(px);
        var pen = py - gy;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen: pen, px: px, py: py };
      }
      if (!best) continue;

      anyContact = true;
      w.contact = true;
      var nrm = T.normal(best.px);
      var tan = { x: -nrm.y, y: nrm.x };

      // нормальная реакция (пружинный контакт)
      var vn = w.vel.x * nrm.x + w.vel.y * nrm.y;
      var kG = 260 * this.mass * REF_G / Math.max(1, w.r) * 0.7;
      var N = kG * best.pen - 450 * w.mass * Math.min(vn, 0);
      if (N < 0) N = 0;
      w.load = N;
      w.vel.x += nrm.x * (N / w.mass) * h;
      w.vel.y += nrm.y * (N / w.mass) * h;

      // не даём провалиться сквозь землю на больших скоростях
      if (best.pen > w.r * 0.6) w.pos.y -= (best.pen - w.r * 0.6);

      // трение: гасим проскальзывание пятна контакта
      var rho = { x: best.px - w.pos.x, y: best.py - w.pos.y };
      var mvx = w.vel.x + w.spin * -rho.y;
      var mvy = w.vel.y + w.spin * rho.x;
      var slip = mvx * tan.x + mvy * tan.y;
      var meff = 1 / (1 / w.mass + (w.r * w.r) / w.I);
      var j = -slip * meff;
      var jmax = this.grip * N * h;
      j = clamp(j, -jmax, jmax);
      w.vel.x += tan.x * j / w.mass;
      w.vel.y += tan.y * j / w.mass;
      w.spin += (rho.x * (tan.y * j) - rho.y * (tan.x * j)) / w.I;

      // вязкое покрытие тормозит колесо, пока оно касается земли
      if (this.surfRoll > 1) {
        var sink = (this.surfRoll - 1) * 1.5 * h;
        w.vel.x -= w.vel.x * sink;
        w.spin -= w.spin * sink;
      }
      // отдача двигателя на кузов: ровно та тяга, что ушла в землю.
      // Из-за неё машина и встаёт на дыбы — но только когда колесо реально гребёт.
      this.angVel -= j * w.r * (this.def.react || 1) / this.I;
    }

    /* 4. Кузов и земля */
    for (i = 0; i < this.hull.length; i++) {
      var p = this.worldPoint(this.hull[i][0], this.hull[i][1]);
      var ground = T.height(p.x);
      var pen2 = p.y - ground;
      if (pen2 <= 0) continue;
      var n2 = T.normal(p.x);
      var rx2 = p.x - this.pos.x, ry2 = p.y - this.pos.y;
      var vx2 = this.vel.x - this.angVel * ry2;
      var vy2 = this.vel.y + this.angVel * rx2;
      var vn2 = vx2 * n2.x + vy2 * n2.y;
      var kB = 90 * this.mass * REF_G / 20;
      var N2 = kB * pen2 - 380 * this.mass * Math.min(vn2, 0);
      if (N2 < 0) N2 = 0;
      this.applyImpulse(n2.x * N2 * h, n2.y * N2 * h, p.x, p.y);
      // скрежет по земле
      var t2 = { x: -n2.y, y: n2.x };
      var vt2 = vx2 * t2.x + vy2 * t2.y;
      var jt = clamp(-vt2 * this.mass * 0.4, -0.7 * N2 * h, 0.7 * N2 * h);
      this.applyImpulse(t2.x * jt, t2.y * jt, p.x, p.y);
      if (pen2 > 8) this.pos.y -= (pen2 - 8) * 0.5;
    }

    /* 5. Голова водителя.
       Небольшой запас: голова может чиркнуть землю на крутой посадке и
       остаться цела. Без него любое сальто заканчивалось аварией. */
    var head = this.worldPoint(this.def.head[0], this.def.head[1]);
    if (head.y > T.height(head.x) + 9) this.crashed = true;

    /* 6. Управление в полёте.
       Включается не мгновенно, а за десятую долю секунды: иначе короткий
       отрыв колёс на кочке успевал бы развернуть машину на спину. */
    this.onGround = anyContact;
    if (anyContact) {
      this.airT = 0;
    } else {
      this.airT = (this.airT || 0) + h;
      if (throttle !== 0) {
        var ramp = Math.min(1, this.airT / 0.28);
        this.angVel -= throttle * this.airK * ramp * h;
        this.angVel = clamp(this.angVel, -this.airMax, this.airMax);
      }
    }

    /* 7. Сопротивление и качение */
    var drag = 1 - 0.10 * h;
    this.vel.x *= drag; this.vel.y *= drag;
    // в воздухе вращение почти не гасится — иначе машина не слушается руля.
    // На земле гасим сильнее, чтобы не козлила.
    this.angVel *= 1 - (anyContact ? 1.25 : 0.22) * h;
    for (i = 0; i < this.wheels.length; i++) {
      this.wheels[i].spin *= 1 - (throttle === 0 ? this.rollFree : 0.06) * h;
    }

    /* 8. Интегрируем */
    this.pos.x += this.vel.x * h;
    this.pos.y += this.vel.y * h;
    this.ang += this.angVel * h;
    for (i = 0; i < this.wheels.length; i++) {
      w = this.wheels[i];
      w.pos.x += w.vel.x * h;
      w.pos.y += w.vel.y * h;
      w.spinAngle += w.spin * h;
    }
  };

  /* Если физику всё-таки унесёт в бесконечность — не роняем игру,
     а откатываемся на последнее живое положение и заканчиваем заезд. */
  Vehicle.prototype.recover = function () {
    var p = this.lastGood || { x: this.startX, y: this.terrain.height(this.startX) - 60 };
    this.pos = { x: p.x, y: p.y };
    this.vel = { x: 0, y: 0 };
    this.ang = 0; this.angVel = 0;
    var self = this;
    this.wheels.forEach(function (w) {
      w.pos.x = self.pos.x + w.lx;
      w.pos.y = self.pos.y + w.ly + self.suspRest;
      w.vel.x = 0; w.vel.y = 0; w.spin = 0;
    });
    this.crashed = true;
  };

  /* --- Кадр ----------------------------------------------- */
  Vehicle.prototype.update = function (dt, input) {
    var n = HC.WORLD.substeps;
    var h = dt / n;
    for (var i = 0; i < n; i++) this.step(h, input);

    if (isFinite(this.pos.x + this.pos.y + this.ang)) this.lastGood = { x: this.pos.x, y: this.pos.y };
    else this.recover();

    // топливо
    if (!this.crashed && this.fuel > 0) {
      var use = this.def.burn * this.burnK * (0.45 + 0.55 * Math.abs(input.throttle)) * dt;
      this.fuel = Math.max(0, this.fuel - use);
    }
    // полёт и сальто
    if (this.onGround) {
      this.airTime = 0;
      this.spinAccum = 0;
    } else {
      this.airTime += dt;
      this.spinAccum += this.angVel * dt;
    }
    var d = (this.pos.x - this.startX) / HC.PPM;
    if (isFinite(d)) this.distance = Math.max(this.distance, d);
    this.speed = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
  };

  /* --- Рисование ------------------------------------------ */
  Vehicle.prototype.draw = function (g, P) {
    var self = this;

    // тень на земле: чем выше машина, тем бледнее и шире
    if (this.terrain) {
      var gy = this.terrain.height(this.pos.x);
      var up = Math.max(0, gy - this.pos.y);
      var a = Math.max(0.05, Math.min(0.42, 0.42 - (up - 50) / 320));
      g.save();
      g.globalAlpha = a;
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.translate(this.pos.x, gy - 3);
      g.scale(1, 0.16);
      g.beginPath();
      g.arc(0, 0, 54 + up * 0.22, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.globalAlpha = 1;
    }

    // колёса
    this.wheels.forEach(function (w) {
      g.save();
      g.translate(w.pos.x, w.pos.y);
      g.rotate(w.spinAngle);
      var tg = g.createRadialGradient(-w.r * 0.4, -w.r * 0.45, w.r * 0.1, 0, 0, w.r * 1.15);
      tg.addColorStop(0, P.tyreHi || P.tyre);
      tg.addColorStop(1, P.tyre);
      g.fillStyle = tg;
      g.strokeStyle = P.ink;
      g.lineWidth = 2.2;
      g.beginPath(); g.arc(0, 0, w.r, 0, Math.PI * 2); g.fill(); g.stroke();
      // протектор
      g.lineWidth = 1.4;
      g.beginPath();
      for (var t = 0; t < 10; t++) {
        var a = t / 10 * Math.PI * 2;
        g.moveTo(Math.cos(a) * (w.r - 5), Math.sin(a) * (w.r - 5));
        g.lineTo(Math.cos(a) * w.r, Math.sin(a) * w.r);
      }
      g.stroke();
      // диск
      var rg = g.createLinearGradient(0, -w.r * 0.45, 0, w.r * 0.45);
      rg.addColorStop(0, P.rim);
      rg.addColorStop(1, P.rimShade || P.rim);
      g.fillStyle = rg;
      g.beginPath(); g.arc(0, 0, w.r * 0.45, 0, Math.PI * 2); g.fill(); g.stroke();
      g.lineWidth = 1.8;
      g.beginPath();
      for (var k = 0; k < 4; k++) {
        var b = k / 4 * Math.PI * 2;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(b) * w.r * 0.45, Math.sin(b) * w.r * 0.45);
      }
      g.stroke();
      g.restore();
    });

    g.save();
    g.translate(this.pos.x, this.pos.y);
    g.rotate(this.ang);

    // стойки подвески
    g.strokeStyle = P.ink;
    g.lineWidth = 3;
    g.beginPath();
    this.def.axles.forEach(function (a, idx) {
      var w = self.wheels[idx];
      var cc = Math.cos(-self.ang), ss = Math.sin(-self.ang);
      var dx = w.pos.x - self.pos.x, dy = w.pos.y - self.pos.y;
      g.moveTo(a.x, a.y);
      g.lineTo(dx * cc - dy * ss, dx * ss + dy * cc);
    });
    g.stroke();

    // кузов: светлее сверху, темнее снизу — читается как объём
    var bb0 = 1e9, bb1 = -1e9;
    this.def.body.forEach(function (p) { bb0 = Math.min(bb0, p[1]); bb1 = Math.max(bb1, p[1]); });
    var bg = g.createLinearGradient(0, bb0, 0, bb1);
    bg.addColorStop(0, P.bodyHi || P.bodyFill);
    bg.addColorStop(0.48, P.bodyFill);
    bg.addColorStop(0.52, P.bodyShade || P.bodyFill);
    bg.addColorStop(1, P.bodyShade || P.bodyFill);
    g.fillStyle = bg;
    g.strokeStyle = P.ink;
    g.lineWidth = 2.6;
    g.lineJoin = 'round';
    g.beginPath();
    this.def.body.forEach(function (p, idx) {
      if (idx === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    });
    g.closePath();
    g.fill(); g.stroke();

    // водитель
    var hx = this.def.head[0], hy = this.def.head[1];
    var hg = g.createLinearGradient(hx - 8, hy - 4, hx + 8, hy + 12);
    hg.addColorStop(0, P.bodyHi || P.driver);
    hg.addColorStop(1, P.bodyShade || P.driver);
    g.fillStyle = hg;
    g.beginPath(); g.arc(hx, hy + 4, 8, 0, Math.PI * 2); g.fill(); g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(hx, hy + 12);
    g.lineTo(hx + 4, hy + 26);
    g.stroke();

    g.restore();
  };

  /* Рисуем машину в покое, без физики — для картинок в магазине.
     Рамка у всех машин общая, поэтому в списке сразу видно,
     что монстр-трак крупнее мотоцикла. */
  HC.vehicleSprite = function (def, P, W, H) {
    var rest = def.susp.rest;
    var box = { x0: -80, x1: 80, y0: -60, y1: 72 };

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var c = document.createElement('canvas');
    c.width = W * dpr; c.height = H * dpr;
    var g = c.getContext('2d');
    g.scale(dpr, dpr);

    var s = Math.min(W / (box.x1 - box.x0), H / (box.y1 - box.y0));
    g.translate(W / 2, H - 2);
    g.scale(s, s);
    g.translate(-(box.x0 + box.x1) / 2, -box.y1);

    var fake = {
      def: def, ang: 0, pos: { x: 0, y: 0 },
      wheels: def.axles.map(function (a) {
        return { pos: { x: a.x, y: a.y + rest }, r: a.r || def.wheel.r, spinAngle: 0.4 };
      })
    };
    Vehicle.prototype.draw.call(fake, g, P);
    return c.toDataURL('image/png');
  };

  HC.Vehicle = Vehicle;
})(window.HC);
