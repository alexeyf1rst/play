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

  var REF_G = 1750;    // гравитация, под которую считаем пружины
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function Vehicle(id, up, terrain, gravity) {
    var def = HC.VEHICLES[id];
    var E = HC.upgradeEffect;
    up = up || {};

    this.id = id;
    this.def = def;
    this.terrain = terrain;
    this.gravity = gravity;

    var lu = { engine: up.engine | 0, tires: up.tires | 0, susp: up.susp | 0, fuel: up.fuel | 0, magnet: up.magnet | 0 };
    this.power = def.power * E.engine(lu.engine);
    this.grip = def.wheel.grip * E.tires(lu.tires);
    this.maxFuel = def.fuel * E.fuel(lu.fuel);
    this.magnet = E.magnet(lu.magnet);
    this.topSpeed = def.topSpeed * (1 + lu.engine * 0.012);

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
    var suspMul = 1 + lu.susp * 0.02;
    this.suspRest = def.susp.rest;
    this.suspMin = def.susp.min;
    this.suspMax = def.susp.max * (1 + lu.susp * 0.03);
    this.suspK = (total * REF_G / def.axles.length) / def.susp.sag * suspMul;
    this.suspC = 2 * Math.sqrt(this.suspK * (total / def.axles.length)) * def.susp.damp * (1 + lu.susp * 0.05);

    // колёса
    this.wheels = def.axles.map(function (a) {
      var r = def.wheel.r;
      return {
        lx: a.x, ly: a.y, r: r,
        mass: def.wheel.mass,
        I: 0.5 * def.wheel.mass * r * r,
        pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
        spin: 0, spinAngle: 0,
        contact: false, load: 0
      };
    });

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

    this.vel.y += g * h;

    var anyContact = false;
    var i, w;

    /* 1. Двигатель: момент на колёса и отдача на кузов */
    if (throttle !== 0) {
      var force = this.power * throttle;
      var n = this.wheels.length;
      for (i = 0; i < n; i++) {
        w = this.wheels[i];
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

    /* 5. Голова водителя */
    var head = this.worldPoint(this.def.head[0], this.def.head[1]);
    if (head.y > T.height(head.x) - 2) this.crashed = true;

    /* 6. Управление в полёте */
    this.onGround = anyContact;
    if (!anyContact && throttle !== 0) {
      this.angVel -= throttle * HC.WORLD.airControl * h;
      this.angVel = clamp(this.angVel, -4.0, 4.0);
    }

    /* 7. Сопротивление и качение */
    var drag = 1 - 0.10 * h;
    this.vel.x *= drag; this.vel.y *= drag;
    this.angVel *= 1 - 0.9 * h;
    for (i = 0; i < this.wheels.length; i++) {
      this.wheels[i].spin *= 1 - (throttle === 0 ? 0.5 : 0.06) * h;
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
      var use = this.def.burn * (0.45 + 0.55 * Math.abs(input.throttle)) * dt;
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

    // колёса
    this.wheels.forEach(function (w) {
      g.save();
      g.translate(w.pos.x, w.pos.y);
      g.rotate(w.spinAngle);
      g.fillStyle = P.tyre;
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
      g.fillStyle = P.rim;
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

    // кузов
    g.fillStyle = P.bodyFill;
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
    g.fillStyle = P.driver;
    g.beginPath(); g.arc(hx, hy + 4, 8, 0, Math.PI * 2); g.fill(); g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(hx, hy + 12);
    g.lineTo(hx + 4, hy + 26);
    g.stroke();

    g.restore();
  };

  HC.Vehicle = Vehicle;
})(window.HC);
