/* ============================================================
   Заезд.
   Камера, сбор монет, топливо, подсчёт результата.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var FLIP_NAMES = ['САЛЬТО', 'ДВОЙНОЕ САЛЬТО', 'ТРОЙНОЕ САЛЬТО', 'ЧЕТВЕРНОЕ!', 'НЕВЕРОЯТНО!'];
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
      this.airFlips = 0;
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
      this.prevX = this.car.pos.x;
      this.stuckT = 0;       // сколько стоим на месте, пытаясь ехать
      this.shake = 0;        // тряска камеры от удара
      this.slowT = 0;        // замедление времени на сальто
      this.zoomK = 1;        // камера отъезжает на скорости
      this.wasAir = false;
      HC.Audio.engineStart();
    },

    stop: function () { this.active = false; HC.Audio.engineStop(); },

    /* --- Логика ------------------------------------------- */
    update: function (dt, input) {
      if (!this.active || this.paused) return;
      dt = Math.min(dt, 1 / 30);

      // На большом сальто время чуть тянется — успеваешь увидеть, что делаешь.
      // Тихо и без рывка: коэффициент сам сползает к единице.
      if (this.slowT > 0) this.slowT = Math.max(0, this.slowT - dt * 1.5);
      dt *= 1 - 0.38 * this.slowT;
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3.4);

      this.time += dt;
      var car = this.car, T = this.terrain;
      var wasAir = !car.onGround;
      var fallV = car.vel.y;

      if (this.demo) {
        input = { throttle: this.autoThrottle() };
        car.fuel = car.maxFuel;
      }
      var thr = this.phase === 'run' ? input.throttle : 0;
      car.update(dt, { throttle: thr });

      // приземление: тряска, пыль из-под колёс и глухой удар
      if (wasAir && car.onGround && fallV > 240) {
        var force = Math.min(1, (fallV - 240) / 900);
        // на заставке трясти незачем — там просто спокойно едет машина
        if (!this.demo) this.shake = Math.max(this.shake, 0.35 + force * 0.65);
        HC.Audio.land(force);
        if (!this.game.state.settings.calmMode) {
          // хлопок по земле: расходящееся кольцо в точке касания
          var cw = car.wheels[0];
          for (var ri = 0; ri < car.wheels.length; ri++) {
            if (car.wheels[ri].contact) { cw = car.wheels[ri]; break; }
          }
          this.particles.push({
            ring: true, x: cw.pos.x, y: cw.pos.y + cw.r * 0.8,
            vx: 0, vy: 0, r: 10, t: 0, life: 0.42 + force * 0.2, force: force
          });
          for (var pi = 0; pi < car.wheels.length; pi++) {
            var pw = car.wheels[pi];
            var burst = 5 + Math.round(force * 9);
            for (var pj = 0; pj < burst; pj++) {
              this.particles.push({
                x: pw.pos.x + (Math.random() - 0.5) * 16,
                y: pw.pos.y + pw.r * 0.75,
                vx: (Math.random() - 0.5) * 170 - car.vel.x * 0.05,
                vy: -50 - Math.random() * 130 * (0.4 + force),
                r: 5 + Math.random() * 9, t: 0, life: 0.6 + Math.random() * 0.6,
                big: true
              });
            }
          }
        }
      }

      // сальто и полёт
      if (!car.onGround) {
        if (Math.abs(car.spinAccum) > Math.PI * 2) {
          car.spinAccum -= Math.sign(car.spinAccum) * Math.PI * 2;
          this.flips++;
          this.airFlips++;
          // каждое следующее сальто в одном прыжке дороже предыдущего
          var n = this.airFlips;
          var gain = HC.ECON.flipCoins * n;
          this.coins += gain;
          this.floats.push({
            x: car.pos.x, y: car.pos.y - 78, t: 0, big: true,
            text: (FLIP_NAMES[Math.min(n, FLIP_NAMES.length) - 1]) + '  +' + gain
          });
          HC.Audio.flip(n);
          if (n >= 2) this.slowT = 1;   // с двойного сальто время тянется
        }
      } else {
        if (car.airTime === 0 && this._lastAir > HC.ECON.airMin && !car.crashed && this.airFlips === 0) {
          var ab = Math.round(this._lastAir * HC.ECON.airBonus);
          this.coins += ab;
          this.floats.push({ x: car.pos.x, y: car.pos.y - 74, t: 0, big: true, text: 'ДОЛГИЙ ПРЫЖОК  +' + ab });
          HC.Audio.chime();
        }
        this.airFlips = 0;
      }
      this._lastAir = car.airTime;

      if (!car.onGround && this.phase === 'run') this.airTotal += dt;
      this.hitTrees();
      this.collect();
      this.dust(dt);
      this.updateFx(dt);

      // в демо просто начинаем заново, ничего не считая
      if (this.demo) {
        if (car.crashed) {
          this.demoWait = (this.demoWait || 0) + dt;
          if (this.demoWait > 1.6) { this.demoWait = 0; this.start(this.game, this.trackId, true); }
        }
        HC.Audio.engine(car.rpm || 0, Math.abs(thr), car.slipAmount || 0,
                        Math.min(1, car.speed / 1300));
        this.camFollow(dt);
        return;
      }

      // Застряли: машина может заклиниться в разломе — газ есть, движения
      // нет. Раньше заезд висел, пока не кончится топливо.
      if (this.phase === 'run' && this.time > 1.5 && car.speed < 22 &&
          (Math.abs(thr) > 0.1 || !car.onGround)) {
        this.stuckT += dt;
      } else {
        this.stuckT = 0;
      }

      // чем кончился заезд
      if (this.phase === 'run') {
        if (car.crashed) this.beginEnd('Приехали');
        else if (this.stuckT > 6) this.beginEnd('Застряли');
        else if (car.fuel <= 0) this.beginEnd('Кончилось топливо');
      } else if (this.phase === 'ending') {
        this.endTimer += dt;
        var slow = car.speed < 40;
        if (this.endTimer > (car.crashed ? 1.3 : 2.2) && (slow || this.endTimer > 7)) this.finish();
      }

      HC.Audio.engine(car.rpm || 0, Math.abs(thr), car.slipAmount || 0,
                      Math.min(1, car.speed / 1300));
      this.camFollow(dt);
    },

    camFollow: function (dt) {
      var car = this.car;
      var lead = clamp(car.vel.x * 0.22, -160, 260);
      var k = 1 - Math.pow(0.0025, dt);
      this.cam.x = lerp(this.cam.x, car.pos.x + lead, k);
      var drop = (this.viewH || 600) * 0.10 / this.cam.z;   // машина чуть ниже центра экрана
      this.cam.y = lerp(this.cam.y, car.pos.y - drop, 1 - Math.pow(0.02, dt));

      // На скорости и в высоком полёте камера отъезжает: видно, куда летишь,
      // и сама скорость читается телом, а не только цифрой.
      var spd = Math.min(1, Math.abs(car.vel.x) / 1250);
      var air = car.onGround ? 0 : Math.min(1, car.airTime / 1.3);
      var want = 1 - spd * 0.17 - air * 0.1;
      this.zoomK = lerp(this.zoomK, want, 1 - Math.pow(0.12, dt));
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
      HC.Audio.engineStop();
      var st = this.game.state;
      var dist = Math.max(0, Math.floor(this.car.distance));
      var distCoins = Math.floor(dist / 100 * HC.ECON.distancePer100 * this.track.payout);
      var base = Math.floor(this.coins * this.track.payout);
      var prev = st.stats.best[this.trackId] || 0;
      var record = dist > prev;
      var medalBefore = HC.medalFor(this.trackId, prev);
      var medalNow = HC.medalFor(this.trackId, Math.max(prev, dist));
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
        medal: medalNow,
        newMedal: medalNow > medalBefore ? medalNow : -1,
        best: st.stats.best[this.trackId],
        track: this.trackId,
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

    /* Дерево на дороге: снести можно, но машина резко теряет ход. */
    hitTrees: function () {
      var T = this.terrain;
      if (!T.track.trees || this.phase !== 'run') { this.prevX = this.car.pos.x; return; }
      var car = this.car;
      var from = Math.min(this.prevX === undefined ? car.pos.x : this.prevX, car.pos.x);
      var to = Math.max(this.prevX === undefined ? car.pos.x : this.prevX, car.pos.x);
      var list = T.treesIn(from - 60, to + 60);
      for (var i = 0; i < list.length; i++) {
        var tr = list[i];
        if (tr.broken) continue;
        if (tr.x < from - 26 || tr.x > to + 26) continue;
        var top = T.height(tr.x) - 74 * tr.s;
        if (car.pos.y < top) continue;                  // перелетел поверху
        if (!T.breakTree(tr.id)) continue;
        car.vel.x *= 0.62;
        car.angVel += 0.8 * Math.sign(car.vel.x || 1);
        HC.Audio.crack();
        for (var p = 0; p < 7; p++) {
          this.particles.push({
            x: tr.x, y: T.height(tr.x) - 40 - Math.random() * 50,
            vx: (Math.random() - 0.5) * 180, vy: -Math.random() * 120,
            r: 2 + Math.random() * 4, t: 0, life: 0.6 + Math.random() * 0.5
          });
        }
      }
      this.prevX = car.pos.x;
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
            // чем дальше уехал, тем дороже монетка
            var val = HC.ECON.coinPickup + HC.ECON.coinPer100 * Math.floor(car.distance / 100);
            this.addCoins(val, it.x, it.y);
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
        if (!p.ring) {
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vy += 40 * dt;
          p.r += dt * 8;
        }
        if (p.t > p.life) this.particles.splice(i, 1);
      }
      for (i = this.floats.length - 1; i >= 0; i--) {
        p = this.floats[i];
        p.t += dt;
        p.y -= dt * (p.big ? 22 : 34);
        if (p.t > (p.big ? 1.7 : 1.5)) this.floats.splice(i, 1);
      }
    },

    /* --- Рисование ---------------------------------------- */
    draw: function (g, W, H, P) {
      var T = this.terrain, cam = this.cam;
      this.viewH = H;
      cam.z = clamp(Math.min(W / 700, H / 760) * (this.zoomK || 1), 0.44, 1.35);

      // Тряска — в экранных координатах, на физику не влияет. Кадр при этом
      // чуть раздвигаем, иначе по краям вылезала бы пустота.
      var sh = this.shake || 0;
      g.save();
      if (sh > 0.001) {
        var kz = 1 + 0.035 * sh;
        g.translate(W / 2, H / 2);
        g.scale(kz, kz);
        g.translate(-W / 2 + Math.sin(this.time * 63) * 10 * sh,
                    -H / 2 + Math.sin(this.time * 48 + 1.7) * 12 * sh);
      }

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
        var u = p.t / p.life;
        if (p.ring) {
          // хлопок: низкое расходящееся кольцо, как пыль из-под колёс
          var rr = 16 + (70 + 60 * p.force) * u;
          g.save();
          g.globalAlpha = (1 - u) * 0.34;
          g.strokeStyle = P.ink;
          g.lineWidth = 2.5 + 4 * (1 - u);
          g.translate(p.x, p.y);
          g.scale(1, 0.3);
          g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.stroke();
          g.restore();
          continue;
        }
        g.globalAlpha = (1 - u) * (p.big ? 0.62 : 0.4);
        g.fillStyle = p.big ? P.hatch : P.dust;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = P.dust;
      g.globalAlpha = 1;

      this.car.draw(g, P);

      // всплывающие подписи; за трюки — крупно, с подложкой
      g.textAlign = 'center';
      for (i = 0; i < this.floats.length; i++) {
        var f = this.floats[i];
        var a = clamp(1.6 - f.t, 0, 1);
        if (f.big) {
          g.font = '700 23px ui-sans-serif, system-ui, sans-serif';
          var w = g.measureText(f.text).width;
          g.globalAlpha = a * 0.9;
          g.fillStyle = P.panelSolid || P.bodyFill;
          g.beginPath();
          if (g.roundRect) g.roundRect(f.x - w / 2 - 14, f.y - 22, w + 28, 32, 16);
          else g.rect(f.x - w / 2 - 14, f.y - 22, w + 28, 32);
          g.fill();
          g.lineWidth = 2; g.strokeStyle = P.ink; g.stroke();
          g.fillStyle = P.ink;
          g.fillText(f.text, f.x, f.y);
        } else {
          g.font = '600 15px ui-sans-serif, system-ui, sans-serif';
          g.globalAlpha = a * 0.85;
          g.fillStyle = P.ink;
          g.fillText(f.text, f.x, f.y);
        }
      }
      g.globalAlpha = 1;
      g.restore();

      // передний план уезжает быстрее машины — отсюда ощущение скорости
      this.drawForeground(g, cam, W, H, P);
      g.restore();            // конец тряски
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

      // деревья-препятствия: сломанные лежат
      var trees = T.treesIn(cam.x - W / cam.z * 0.7, cam.x + W / cam.z * 0.7);
      for (var ti = 0; ti < trees.length; ti++) {
        var tr = trees[ti];
        var ty = T.height(tr.x);
        g.save();
        g.translate(tr.x, ty);
        if (tr.broken) {
          g.rotate(1.35);
          g.globalAlpha = 0.75;
        } else {
          HC.Decor.shadow(g, P, 20 * tr.s, 0.24);
        }
        HC.Decor.draw(g, tr.kind, P, tr.s, false);
        g.restore();
        g.globalAlpha = 1;
      }

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
