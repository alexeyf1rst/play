/* ============================================================
   Заезд.
   Камера, сбор монет, топливо, подсчёт результата.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  var Ride = {
    active: false,

    start: function (game, trackId, demo) {
      var st = game.state;
      var track = HC.TRACKS[trackId];
      this.game = game;
      this.trackId = trackId;
      this.track = track;
      this.terrain = new HC.Terrain(track, (Math.random() * 1e9) | 0, trackId);
      this.car = new HC.Vehicle(st.vehicle, st.up[st.vehicle], this.terrain, track.gravity, st.tune[st.vehicle]);
      this.cam = { x: this.car.pos.x, y: this.car.pos.y, z: 1 };
      this.coins = 0;
      this.ore = 0;
      this.flips = 0;
      this.cans = 0;
      this.airTotal = 0;
      this.airBonus = 0;
      this.time = 0;
      this.phase = 'run';
      this.endTimer = 0;
      this.reason = '';
      this.particles = [];
      this.floats = [];
      this.active = true;
      this.paused = false;
      this.demo = !!demo;
      this.input = { throttle: 0 };
      this.rideMul = 1 + HC.Economy.workshopRide(st);
    },

    stop: function () { this.active = false; },

    /* --- Логика ------------------------------------------- */
    update: function (dt, input) {
      if (!this.active || this.paused) return;
      dt = Math.min(dt, 1 / 30);
      this.time += dt;
      var car = this.car, T = this.terrain;

      if (this.demo) {
        input = { throttle: this.autoThrottle() };
        car.fuel = car.maxFuel;
      }
      var thr = this.phase === 'run' ? input.throttle : 0;
      car.update(dt, { throttle: thr });

      // сальто и полёт
      if (!car.onGround) {
        if (Math.abs(car.spinAccum) > Math.PI * 2) {
          car.spinAccum -= Math.sign(car.spinAccum) * Math.PI * 2;
          this.flips++;
          this.addCoins(40, car.pos.x, car.pos.y - 60, 'сальто');
        }
      } else if (car.airTime === 0 && this._lastAir > 1.1 && !car.crashed) {
        this.addCoins(Math.round(this._lastAir * 18), car.pos.x, car.pos.y - 60, 'полёт');
      }
      this._lastAir = car.airTime;

      if (!car.onGround && this.phase === 'run') this.airTotal += dt;
      this.collect();
      this.dust(dt);
      this.updateFx(dt);

      // в демо просто начинаем заново, ничего не считая
      if (this.demo) {
        if (car.crashed) {
          this.demoWait = (this.demoWait || 0) + dt;
          if (this.demoWait > 1.6) { this.demoWait = 0; this.start(this.game, this.trackId, true); }
        }
        this.camFollow(dt);
        return;
      }

      // чем кончился заезд
      if (this.phase === 'run') {
        if (car.crashed) this.beginEnd('Приехали');
        else if (car.fuel <= 0) this.beginEnd('Кончилось топливо');
      } else if (this.phase === 'ending') {
        this.endTimer += dt;
        var slow = car.speed < 40;
        if (this.endTimer > (car.crashed ? 1.3 : 2.2) && (slow || this.endTimer > 7)) this.finish();
      }

      this.camFollow(dt);
    },

    camFollow: function (dt) {
      var car = this.car;
      var lead = clamp(car.vel.x * 0.22, -160, 260);
      var k = 1 - Math.pow(0.0025, dt);
      this.cam.x = lerp(this.cam.x, car.pos.x + lead, k);
      var drop = (this.viewH || 600) * 0.10 / this.cam.z;   // машина чуть ниже центра экрана
      this.cam.y = lerp(this.cam.y, car.pos.y - drop, 1 - Math.pow(0.02, dt));
    },

    /* Водитель для заставки: в полёте выравнивается, на спуске придерживает */
    autoThrottle: function () {
      var car = this.car, T = this.terrain;
      if (car.crashed) return 0;
      if (!car.onGround) {
        var err = -0.12 - car.ang - car.angVel * 0.35;
        return Math.abs(err) < 0.05 ? 0 : (err < 0 ? 1 : -1);
      }
      return T.slope(car.pos.x + 70) < -0.28 ? 0.5 : 0.92;
    },

    beginEnd: function (reason) {
      if (this.phase !== 'run') return;
      this.phase = 'ending';
      this.endTimer = 0;
      this.reason = reason;
      if (this.car.crashed) HC.Audio.crash();
    },

    finish: function () {
      if (this.phase === 'done') return;
      this.phase = 'done';
      this.active = false;
      var st = this.game.state;
      var dist = Math.max(0, Math.floor(this.car.distance));
      var distCoins = Math.floor(dist / 100 * HC.ECON.distancePer100 * this.track.payout);
      var base = Math.floor(this.coins * this.track.payout);
      var prev = st.stats.best[this.trackId] || 0;
      var record = dist > prev;
      // запись о рекорде должна существовать всегда, иначе в итогах
      // окажется «лучший результат undefined м»
      st.stats.best[this.trackId] = Math.max(prev, dist);
      var bonus = record ? Math.floor((base + distCoins) * HC.ECON.recordBonus) : 0;
      var total = Math.floor((base + distCoins + bonus) * this.rideMul);

      var Q = HC.Quests;
      Q.report(st, 'dist_run', dist);
      Q.report(st, 'dist_total', dist);
      Q.report(st, 'track_dist', dist, this.trackId);
      Q.report(st, 'coins_run', this.coins);
      Q.report(st, 'coins_earn', total);
      Q.report(st, 'flips', this.flips);
      Q.report(st, 'air', Math.floor(this.airTotal));
      Q.report(st, 'ore', this.ore);
      Q.report(st, 'cans', this.cans);
      Q.report(st, 'runs', 1);

      st.coins += total;
      st.ore += this.ore;
      st.stats.runs++;
      st.stats.totalDistance += dist;
      st.stats.totalCoins += total;
      HC.save(st, true);
      HC.Audio.chime();

      this.game.onRideFinished({
        reason: this.reason,
        distance: dist,
        coinsRaw: base,
        distCoins: distCoins,
        bonus: bonus,
        total: total,
        ore: this.ore,
        flips: this.flips,
        cans: this.cans,
        air: this.airTotal,
        record: record,
        best: st.stats.best[this.trackId],
        time: this.time
      });
    },

    /* Игрок сам решил закончить */
    giveUp: function () {
      this.paused = false;
      if (this.phase === 'run') { this.phase = 'ending'; this.reason = 'Заезд окончен'; }
      this.finish();
    },

    addCoins: function (n, x, y, label) {
      this.coins += n;
      this.floats.push({ x: x, y: y, t: 0, text: (label ? label + ' +' : '+') + n });
    },

    collect: function () {
      var car = this.car;
      var reach = 44 + car.def.wheel.r * 0.5;
      var pull = car.magnet;
      var items = this.terrain.itemsIn(car.pos.x - 400, car.pos.x + 500);
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var dx = car.pos.x - it.x, dy = car.pos.y - it.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (pull > 0 && d < pull && d > 1) {
          var s = Math.min(1, (pull - d) / pull) * 9;
          it.x += dx / d * s; it.y += dy / d * s;
        }
        if (d < reach) {
          this.terrain.take(it);
          if (it.type === 'coin') {
            this.addCoins(HC.ECON.coinPickup, it.x, it.y);
            HC.Audio.coin();
          } else if (it.type === 'ore') {
            this.ore += HC.ECON.orePickup;
            this.floats.push({ x: it.x, y: it.y, t: 0, text: '+' + HC.ECON.orePickup + ' руды' });
            HC.Audio.ore();
          } else if (it.type === 'fuel') {
            car.fuel = Math.min(car.maxFuel, car.fuel + car.maxFuel * HC.ECON.fuelPickup);
            this.cans++;
            this.floats.push({ x: it.x, y: it.y, t: 0, text: 'топливо' });
            HC.Audio.fuel();
          }
        }
      }
    },

    dust: function (dt) {
      var car = this.car;
      if (this.game.state.settings.calmMode) return;
      for (var i = 0; i < car.wheels.length; i++) {
        var w = car.wheels[i];
        if (!w.contact) continue;
        var slip = Math.abs(w.spin * w.r - car.vel.x);
        if (slip > 140 && Math.random() < dt * 30) {
          this.particles.push({
            x: w.pos.x, y: w.pos.y + w.r * 0.7,
            vx: -car.vel.x * 0.12 + (Math.random() - 0.5) * 40,
            vy: -Math.random() * 60,
            r: 3 + Math.random() * 5, t: 0, life: 0.7 + Math.random() * 0.5
          });
        }
      }
    },

    updateFx: function (dt) {
      var i, p;
      for (i = this.particles.length - 1; i >= 0; i--) {
        p = this.particles[i];
        p.t += dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 40 * dt;
        p.r += dt * 8;
        if (p.t > p.life) this.particles.splice(i, 1);
      }
      for (i = this.floats.length - 1; i >= 0; i--) {
        p = this.floats[i];
        p.t += dt;
        p.y -= dt * 34;
        if (p.t > 1.5) this.floats.splice(i, 1);
      }
    },

    /* --- Рисование ---------------------------------------- */
    draw: function (g, W, H, P) {
      var T = this.terrain, cam = this.cam;
      this.viewH = H;
      cam.z = clamp(Math.min(W / 700, H / 760), 0.50, 1.35);

      T.drawSky(g, W, H, P);
      HC.drawSun(g, W, H, P, cam.x, this.game.state.settings.theme === 'dark');
      HC.drawClouds(g, W, H, P, cam.x * 0.12, H * 0.62, this.time * 0.6);
      HC.drawBirds(g, W, H, P, this.time, cam.x);
      T.drawParallax(g, cam, W, H, P);
      this.drawFarDecor(g, cam, W, H, P);
      T.drawGround(g, cam, W, H, P, this.game.quality);
      this.drawMarkers(g, W, H, P);

      g.save();
      g.translate(W / 2, H / 2);
      g.scale(cam.z, cam.z);
      g.translate(-cam.x, -cam.y);

      // декорации стоят на земле вместе с машиной
      this.drawDecor(g, cam, W, H, P);

      // предметы
      var items = T.itemsIn(cam.x - W / cam.z, cam.x + W / cam.z);
      for (var i = 0; i < items.length; i++) this.drawItem(g, items[i], P);

      // пыль
      g.fillStyle = P.dust;
      for (i = 0; i < this.particles.length; i++) {
        var p = this.particles[i];
        g.globalAlpha = (1 - p.t / p.life) * 0.5;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;

      this.car.draw(g, P);

      // всплывающие подписи
      g.font = '600 15px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      for (i = 0; i < this.floats.length; i++) {
        var f = this.floats[i];
        g.globalAlpha = clamp(1.5 - f.t, 0, 1) * 0.85;
        g.fillStyle = P.ink;
        g.fillText(f.text, f.x, f.y);
      }
      g.globalAlpha = 1;
      g.restore();

      // передний план уезжает быстрее машины — отсюда ощущение скорости
      this.drawForeground(g, cam, W, H, P);
      HC.drawVignette(g, W, H, P);
    },

    /* Силуэты деревьев на дальней гряде */
    drawFarDecor: function (g, cam, W, H, P) {
      var T = this.terrain;
      var k = 0.34, base = H * 0.72;
      var x0 = cam.x * k, x1 = x0 + W;
      var list = T.farDecorIn(x0 - 200, x1 + 200, 71);
      g.save();
      g.globalAlpha = 0.5;
      for (var i = 0; i < list.length; i++) {
        var d = list[i];
        var sx = d.x - x0;
        var y = base + HC.noise(d.x * 0.0026, T.seed + 77) * 80
                     + HC.noise(d.x * 0.008, T.seed + 82) * 24;
        g.save();
        g.translate(sx, y + 2);
        HC.Decor.draw(g, d.type, { ink: P.far1, bodyFill: P.far1, bodyHi: P.far1, bodyShade: P.far1 }, d.s, false);
        g.restore();
      }
      g.restore();
      g.globalAlpha = 1;
    },

    /* Деревья, столбы и камни вдоль дороги */
    drawDecor: function (g, cam, W, H, P) {
      var T = this.terrain;
      var list = T.decorIn(cam.x - W / cam.z * 0.7, cam.x + W / cam.z * 0.7);
      for (var i = 0; i < list.length; i++) {
        var d = list[i];
        var y = T.height(d.x);
        g.save();
        g.translate(d.x, y);
        HC.Decor.shadow(g, P, 16 * d.s, 0.22);
        HC.Decor.draw(g, d.type, P, d.s, d.flip);
        g.restore();
      }
    },

    /* Кусты у нижнего края экрана, идут быстрее — глубина кадра */
    drawForeground: function (g, cam, W, H, P) {
      if (this.game.state.settings.calmMode) return;
      var k = 1.55;
      var span = 260;
      var x0 = cam.x * k;
      var from = Math.floor((x0 - 200) / span);
      var to = Math.floor((x0 + W + 200) / span);
      g.save();
      g.fillStyle = P.fore || P.groundDeep || P.ground;
      g.globalAlpha = 0.9;
      for (var i = from; i <= to; i++) {
        var h = HC.hash(i, this.terrain.seed + 91);
        if (h > 0.55) continue;
        var sx = i * span + h * span - x0;
        var s = 1.5 + h * 1.4;
        var y = H + 4 - h * 46;
        g.save();
        g.translate(sx, y);
        g.scale(s, s);
        // куст-силуэт
        g.beginPath();
        g.arc(-11, -7, 11, Math.PI, 0);
        g.arc(2, -14, 14, Math.PI, 0);
        g.arc(15, -6, 10, Math.PI, 0);
        g.lineTo(-22, 0);
        g.closePath();
        g.fill();
        g.restore();
      }
      g.restore();
      g.globalAlpha = 1;
    },

    drawMarkers: function (g, W, H, P) {
      var cam = this.cam, T = this.terrain;
      var every = 100 * HC.PPM;
      var from = Math.floor((cam.x - W / cam.z) / every) * every;
      g.save();
      g.translate(W / 2, H / 2);
      g.scale(cam.z, cam.z);
      g.translate(-cam.x, -cam.y);
      g.strokeStyle = P.ink; g.fillStyle = P.ink;
      g.lineWidth = 2;
      g.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      for (var x = from; x < cam.x + W / cam.z; x += every) {
        if (x < every) continue;
        var y = T.height(x);
        g.globalAlpha = 0.35;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 30); g.stroke();
        g.globalAlpha = 0.55;
        g.fillText(Math.round(x / HC.PPM) + ' м', x, y - 38);
      }
      g.globalAlpha = 1;
      g.restore();
    },

    drawItem: function (g, it, P) {
      g.save();
      g.translate(it.x, it.y);
      g.strokeStyle = P.ink;
      g.lineWidth = 2;
      if (it.type === 'coin') {
        var bob = Math.sin(this.time * 2 + it.x * 0.01) * 3;
        g.translate(0, bob);
        var cg = g.createRadialGradient(-4, -5, 1, 0, 0, 13);
        cg.addColorStop(0, P.bodyHi || P.coin);
        cg.addColorStop(1, P.coin);
        g.fillStyle = cg;
        g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2); g.fill(); g.stroke();
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.stroke();
      } else if (it.type === 'fuel') {
        var fg = g.createLinearGradient(-11, 0, 11, 0);
        fg.addColorStop(0, P.bodyHi || P.bodyFill);
        fg.addColorStop(0.55, P.bodyFill);
        fg.addColorStop(1, P.bodyShade || P.bodyFill);
        g.fillStyle = fg;
        g.beginPath();
        g.rect(-11, -14, 22, 28);
        g.fill(); g.stroke();
        g.beginPath();
        g.moveTo(2, -14); g.lineTo(9, -20); g.lineTo(13, -16);
        g.stroke();
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(-6, -6); g.lineTo(6, -6); g.moveTo(-6, 2); g.lineTo(6, 2); g.stroke();
      } else if (it.type === 'ore') {
        var bob2 = Math.sin(this.time * 1.6 + it.x * 0.01) * 2;
        g.translate(0, bob2);
        var og = g.createLinearGradient(-12, -14, 12, 12);
        og.addColorStop(0, P.bodyHi || P.rim);
        og.addColorStop(0.5, P.rim);
        og.addColorStop(1, P.rimShade || P.rim);
        g.fillStyle = og;
        g.beginPath();
        g.moveTo(0, -14); g.lineTo(12, -4); g.lineTo(8, 12); g.lineTo(-8, 12); g.lineTo(-12, -4);
        g.closePath(); g.fill(); g.stroke();
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 12); g.moveTo(-12, -4); g.lineTo(12, -4); g.stroke();
      }
      g.restore();
    }
  };

  HC.Ride = Ride;
})(window.HC);
