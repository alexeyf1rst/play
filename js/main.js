/* ============================================================
   Сборка всего вместе: холст, цикл, управление, сцены.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  var PALETTES = {
    /* Цветная тема — та, в которой игру показывают людям: небо синее,
       по кромке земли дёрн, под ним грунт, машина красная. Формы и
       обводки те же, что и в тихих темах. */
    color: {
      vivid: true,
      sky0: '#37b9fa', sky1: '#c4f3ff',
      cloud: '#ffffff', sun: '#fff2a8', sunGlow: 'rgba(255,238,150,0.5)',
      far0: '#8ee4ad', far1: '#53c978', far2: '#32a965',
      grass: '#60c932', grassHi: '#a1ec49', grassDeep: '#288e32',
      ground: '#bd8045', groundTop: '#60c932', groundDeep: '#754831',
      hatch: '#8a5c31', ink: '#3d5239',
      bodyFill: '#f7f2e7', bodyHi: '#fffdf7', bodyShade: '#ddd2be',
      carFill: '#e04a3b', carHi: '#f4705f', carShade: '#a72e25',
      driver: '#f6dcb8', tyre: '#2a2724', tyreHi: '#4c453d',
      rim: '#ece8dd', rimShade: '#bdb6a8',
      coin: '#f5c33f', coinHi: '#ffe484',
      can: '#d94a38', canHi: '#f07a68',
      dust: '#caa877',
      leaf: '#60c933', leafHi: '#a0ef53', leafDeep: '#208434',
      stone: '#a9a49b', stoneHi: '#c6c1b8', stoneDeep: '#7b766d',
      wood: '#9c6b3f', woodHi: '#ba8452', woodDeep: '#6d4826',
      bone: '#efe6d6', metal: '#bcc1c7', panel: '#f4f0e8',
      shadow: 'rgba(30,40,20,0.24)', vignette: 'rgba(20,50,70,0.10)',
      fore: '#2f6b2c', panelSolid: '#ffffff', sideFace: '#588b3c',
      road: '#6e7276', roadLine: '#f7f6f2',
      // долина: трава, натоптанные дорожки и земляные площадки под постройки
      plate: '#70cf3b', plateDeep: '#43ad35', path: '#efcf91', pad: '#7bc043'
    },
    paper: {
      sky0: '#f4f2ee', sky1: '#e2dfd8',
      far0: '#d5d2ca', far1: '#c3bfb5', far2: '#b4b0a5',
      ground: '#ddd9d1', hatch: '#8e8b83', ink: '#1c1b19', hatchOn: 1,
      bodyFill: '#faf9f6', tyre: '#2b2a27', rim: '#eceae5',
      driver: '#faf9f6', coin: '#e8e5de', dust: '#9b978f',
      // тона для объёма
      groundTop: '#e7e3db', groundDeep: '#b9b4a8',
      bodyHi: '#ffffff', bodyShade: '#ddd9d2',
      tyreHi: '#4a4843', rimShade: '#cfccc5',
      shadow: 'rgba(28,27,25,0.20)', vignette: 'rgba(60,55,45,0.12)', fore: '#9c968a', panelSolid: '#fbfaf8', sideFace: '#b2aca0',
      road: '#a8a29a', roadLine: '#f7f5f1'
    },
    dark: {
      sky0: '#0f1012', sky1: '#191a1d',
      far0: '#212226', far1: '#2a2b30', far2: '#33343a',
      ground: '#1d1e21', hatch: '#3c3e43', ink: '#e9e8e4', hatchOn: 1,
      bodyFill: '#2c2d32', tyre: '#0c0c0e', rim: '#3d3f45',
      driver: '#e9e8e4', coin: '#3a3c42', dust: '#5a5c62',
      groundTop: '#2b2c32', groundDeep: '#0e0f11',
      bodyHi: '#41434a', bodyShade: '#212228',
      tyreHi: '#26272b', rimShade: '#303238',
      shadow: 'rgba(0,0,0,0.45)', vignette: 'rgba(0,0,0,0.34)', fore: '#08090a', panelSolid: '#17181b', sideFace: '#3c3e45',
      road: '#15161a', roadLine: '#7e8087'
    }
  };

  var Game = {
    scene: 'base',
    quality: 'normal',
    lastTrack: 'hills',

    init: function () {
      this.canvas = document.getElementById('scene');
      this.g = this.canvas.getContext('2d');
      this.state = HC.load();
      HC.setDiff(this.state.settings.diff);
      this.applyTheme();

      HC.Economy.welcomeVillage(this.state);
      if (HC.Art) HC.Art.init(this.state);
      HC.UI.init(this);
      HC.Audio.applySettings(this.state.settings);

      this.bindInput();
      this.resize();
      window.addEventListener('resize', this.resize.bind(this));

      HC.Quests.ensure(this.state);

      // что накопилось, пока игра была закрыта
      HC.Economy.applyOffline(this.state);
      HC.UI.refreshTop();
      HC.UI.refreshPending();

      this.goTitle();
      this.last = performance.now();
      this.accum = 0;
      requestAnimationFrame(this.frame.bind(this));

      var self = this;
      this.saveTimer = setInterval(function () {
        // новый день/неделя/месяц могут наступить прямо во время игры
        if (HC.Quests.ensure(self.state).length) HC.UI.toast('Появились новые задания');
        HC.UI.refreshQuestBadge();
        HC.save(self.state);
      }, 10000);
      this.onUnload = function () { HC.save(self.state, true); };
      window.addEventListener('beforeunload', this.onUnload);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          self.clearInput();
          if (self.scene === 'ride' && HC.Ride.phase === 'run' && !HC.Ride.paused) self.togglePause();
          HC.save(self.state, true); HC.Audio.suspend();
        }
        else HC.Audio.resume();
      });

    },

    /* --- Тема и размеры ----------------------------------- */
    applyTheme: function () {
      var name = PALETTES[this.state.settings.theme] ? this.state.settings.theme : 'paper';
      document.body.classList.toggle('theme-dark', name === 'dark');
      document.body.classList.toggle('theme-color', name === 'color');
      this.P = PALETTES[name];
      HC.Base._thumbs = {};      // картинки перерисуются под новую тему
      HC.Base._fill = null;      // и градиент корпуса тоже
      var meta = document.querySelector('meta[name="theme-color"]');
      var bar = { dark: '#0f1012', color: '#37b9fa', paper: '#f4f2ee' }[name];
      if (meta) meta.setAttribute('content', bar);
    },

    resize: function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.W = w; this.H = h; this.dpr = dpr;
      this.quality = (w * h > 1600 * 900) ? 'normal' : 'normal';
    },

    /* --- Управление --------------------------------------- */
    bindInput: function () {
      var self = this;
      this.keys = { gas: false, brake: false, boost: false };
      this.touch = { gas: false, brake: false, boost: false };
      this.input = { throttle: 0, boost: false };

      function keyFlag(e, down) {
        var k = e.key;
        if (self.scene !== 'ride') return;
        if (e.target && e.target.tagName === 'BUTTON' && k === ' ' &&
            e.target.id !== 'pedal-gas' && e.target.id !== 'pedal-brake') return;
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'в' || k === 'В' || k === ' ') { self.keys.gas = down; e.preventDefault(); }
        if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ф' || k === 'Ф') { self.keys.brake = down; e.preventDefault(); }
        if (k === 'Shift') { self.keys.boost = down; e.preventDefault(); }
        if (down && (k === 'r' || k === 'R' || k === 'к' || k === 'К')) HC.Ride.recover();
        if (down && !e.repeat && k === 'Escape') self.togglePause();
      }
      // первое касание/нажатие где угодно — браузеру этого хватает, чтобы разрешить звук
      var unlockOnce = function () {
        HC.Audio.unlock();
        document.removeEventListener('pointerdown', unlockOnce, true);
        document.removeEventListener('keydown', unlockOnce, true);
      };
      document.addEventListener('pointerdown', unlockOnce, true);
      document.addEventListener('keydown', unlockOnce, true);

      window.addEventListener('keydown', function (e) { keyFlag(e, true); });
      window.addEventListener('keyup', function (e) { keyFlag(e, false); });
      window.addEventListener('blur', function () {
        self.clearInput();
        if (self.scene === 'ride' && HC.Ride.phase === 'run' && !HC.Ride.paused) self.togglePause();
      });

      document.getElementById('btn-ride-sound').addEventListener('click', function () {
        self.state.settings.music = !self.state.settings.music;
        HC.Audio.unlock(); HC.Audio.applySettings(self.state.settings);
        HC.UI.syncSound(); HC.save(self.state, true);
      });

      ['brake', 'gas', 'boost'].forEach(function (which) {
        var node = document.getElementById('pedal-' + which);
        var set = function (v) { return function (e) {
          self.touch[which] = v;
          if (v && e.pointerId !== undefined) node.setPointerCapture(e.pointerId);
          e.preventDefault();
        }; };
        node.addEventListener('pointerdown', set(true));
        node.addEventListener('pointerup', set(false));
        node.addEventListener('pointercancel', set(false));
        node.addEventListener('pointerleave', set(false));
        // Педаль держат долго, а долгое нажатие на телефоне — это лупа,
        // выделение и «скопировать». Глушим всё это прямо на педали.
        node.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
        node.addEventListener('touchend', set(false), { passive: false });
      });

      // то же самое для холста и вообще для всего: в игре выделять нечего
      ['contextmenu', 'selectstart', 'dragstart'].forEach(function (ev) {
        document.addEventListener(ev, function (e) {
          var t = e.target;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
          e.preventDefault();
        });
      });

      document.getElementById('btn-recover').addEventListener('click', function () { HC.Ride.recover(); });
      document.getElementById('btn-rescue-finish').addEventListener('click', function () { HC.Ride.giveUp(); });
      document.getElementById('btn-pause').addEventListener('click', function () { self.togglePause(); });
      document.getElementById('btn-play').addEventListener('click', function () { self.startFromTitle(); });
      document.getElementById('btn-village').addEventListener('click', function () {
        HC.Audio.unlock();
        self.fadeTo(function () { document.getElementById('title').hidden = true; self.goBase(); });
      });
      document.getElementById('btn-title-settings').addEventListener('click', function () {
        HC.Audio.unlock(); HC.UI.openSettings();
      });
      document.getElementById('btn-title-sound').addEventListener('click', function () {
        var s = self.state.settings;
        s.music = !s.music;
        HC.Audio.unlock();
        HC.Audio.applySettings(s);
        HC.UI.syncSound();
        HC.save(self.state, true);
      });

      // база: тянем в любую сторону, зумим колесом и щипком
      var c = this.canvas;
      var ptrs = {}, pinch = null;
      function count() { return Object.keys(ptrs).length; }

      c.addEventListener('pointerdown', function (e) {
        HC.Audio.unlock();
        if (self.scene !== 'base') return;
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0 };
        HC.Base.dragging = true;
        c.setPointerCapture(e.pointerId);
        if (count() === 2) {
          var ks = Object.keys(ptrs), a2 = ptrs[ks[0]], b2 = ptrs[ks[1]];
          pinch = { d: Math.hypot(a2.x - b2.x, a2.y - b2.y), zoom: HC.Base.zoom };
        }
      });
      c.addEventListener('pointermove', function (e) {
        if (self.scene !== 'base') return;
        var p = ptrs[e.pointerId];
        if (!p) return;
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        p.moved += Math.abs(dx) + Math.abs(dy);
        if (count() >= 2 && pinch) {
          var ks2 = Object.keys(ptrs), a3 = ptrs[ks2[0]], b3 = ptrs[ks2[1]];
          var d = Math.hypot(a3.x - b3.x, a3.y - b3.y);
          var rect2 = c.getBoundingClientRect();
          if (pinch.d > 12) {
            HC.Base.setZoom(pinch.zoom * d / pinch.d,
                            (a3.x + b3.x) / 2 - rect2.left, (a3.y + b3.y) / 2 - rect2.top);
          }
        } else {
          HC.Base.panBy(dx, dy);
        }
      });
      function endPtr(e) {
        var p = ptrs[e.pointerId];
        delete ptrs[e.pointerId];
        if (count() < 2) pinch = null;
        if (count() === 0) HC.Base.dragging = false;
        if (self.scene !== 'base' || !p) return;
        if (p.moved > 10) return;                    // это было перетаскивание
        var rect = c.getBoundingClientRect();
        var i = HC.Base.hitTest(p.sx - rect.left, p.sy - rect.top, self.state);
        if (i >= 0) { HC.Audio.click(); HC.Base.pingPad(i); HC.UI.openPlot(i); }
      }
      c.addEventListener('pointerup', endPtr);
      c.addEventListener('pointercancel', endPtr);

      c.addEventListener('wheel', function (e) {
        if (self.scene !== 'base') return;
        e.preventDefault();
        var rect = c.getBoundingClientRect();
        HC.Base.zoomBy(e.deltaY < 0 ? 1.14 : 1 / 1.14, e.clientX - rect.left, e.clientY - rect.top);
      }, { passive: false });

      // кнопка «вся база»: отъехать и увидеть долину целиком
      var fit = document.getElementById('btn-fit');
      if (fit) fit.addEventListener('click', function () {
        HC.Audio.click();
        HC.Base.showAll();
      });
    },

    clearInput: function () {
      this.keys.gas = this.keys.brake = this.touch.gas = this.touch.brake = false;
      this.input.throttle = 0;
      this.keys.boost = this.touch.boost = this.input.boost = false;
    },

    readInput: function () {
      var gas = this.keys.gas || this.touch.gas;
      var brake = this.keys.brake || this.touch.brake;
      this.input.throttle = (gas ? 1 : 0) + (brake ? -1 : 0);
      this.input.boost = this.keys.boost || this.touch.boost;
      return this.input;
    },

    /* --- Сцены -------------------------------------------- */

    /* Заставка: сверху название, на фоне по-настоящему едет машина */
    goTitle: function () {
      this.scene = 'title';
      document.getElementById('title').hidden = false;
      document.getElementById('ride-hud').hidden = true;
      document.getElementById('base-bar').hidden = true;
      document.getElementById('top').hidden = true;
      document.getElementById('pending').hidden = true;

      var pick = 'hills';
      HC.Ride.start(this, pick, true);

      var st = this.state.stats;
      var best = 0;
      for (var k in st.best) best = Math.max(best, st.best[k]);
      var line = document.getElementById('title-stats');
      if (st.runs > 0) {
        line.hidden = false;
        line.textContent = 'рекорд ' + HC.fmt(best) + ' м · заездов ' + st.runs +
          (this.state.coins ? ' · ' + HC.fmt(this.state.coins) + ' монет' : '');
      } else {
        line.hidden = true;
      }
    },

    /* Плавный переход между сценами */
    fadeTo: function (fn) {
      var f = document.getElementById('fade');
      f.classList.add('on');
      setTimeout(function () {
        fn();
        setTimeout(function () { f.classList.remove('on'); }, 30);
      }, 250);
    },

    startFromTitle: function () {
      var self = this;
      HC.Audio.unlock();
      this.fadeTo(function () {
        document.getElementById('title').hidden = true;
        HC.Ride.stop();
        self.goBase();
        self.state.settings.diffPicked = true;
        HC.save(self.state, true);
        self.beginRide(HC.trackOpen(self.state, self.state.track) ? self.state.track : 'hills');
      });
    },

    goBase: function () {
      this.scene = 'base';
      HC.Ride.stop();
      document.getElementById('ride-hud').hidden = true;
      document.getElementById('base-bar').hidden = false;
      document.getElementById('top').hidden = false;
      HC.UI.refreshPending();
      HC.save(this.state, true);
    },

    startRide: function (trackId) {
      if (!HC.trackOpen(this.state, trackId)) return;
      var self = this;
      if (this.scene === 'base') {
        this.fadeTo(function () { self.beginRide(trackId); });
        return;
      }
      this.beginRide(trackId);
    },

    beginRide: function (trackId) {
      this.clearInput();
      this._d = this._c = null;
      document.getElementById('ride-rescue').hidden = true;
      this.lastTrack = trackId;
      this.state.track = trackId;
      this.scene = 'ride';
      document.getElementById('ride-hud').hidden = false;
      document.getElementById('base-bar').hidden = true;
      document.getElementById('pending').hidden = true;
      document.getElementById('top').hidden = true;
      HC.Ride.start(this, trackId);
      HC.Audio.unlock();
    },

    onRideFinished: function (r) {
      this.scene = 'base';
      document.getElementById('ride-hud').hidden = true;
      document.getElementById('base-bar').hidden = false;
      document.getElementById('top').hidden = false;
      HC.UI.refreshTop();
      HC.UI.refreshPending();
      HC.UI.showResults(r);
    },

    togglePause: function () {
      if (this.scene !== 'ride' || !HC.Ride.active || HC.Ride.phase === 'rescue') return;
      if (HC.Ride.paused) { HC.Ride.paused = false; HC.UI.close(); return; }
      this.clearInput();
      HC.Ride.paused = true;
      var self = this;
      HC.UI.onClose = function () { HC.Ride.paused = false; };
      HC.UI.open(function () {
        return {
          title: 'Пауза', html:
            '<p class="lead">Можно посидеть сколько нужно. Игра подождёт.</p>' +
            '<div class="row"><button class="btn main wide" data-resume>Продолжить</button></div>' +
            '<div class="row"><button class="btn wide" data-stop>Закончить заезд</button></div>',
          bind: function (root) {
            root.querySelector('[data-resume]').addEventListener('click', function () {
              HC.Audio.click(); HC.UI.close();
            });
            root.querySelector('[data-stop]').addEventListener('click', function () {
              HC.UI.onClose = null;
              HC.UI.close();
              HC.Ride.giveUp();
            });
          }
        };
      });
    },

    /* «Начать заново»: стираем всё и перезагружаемся начисто.
       Порядок важен — сначала глушим автосохранение и обработчик выгрузки,
       иначе перезагрузка вернула бы стёртый сейв на место. */
    hardReset: function () {
      clearInterval(this.saveTimer);
      window.removeEventListener('beforeunload', this.onUnload);
      HC.Audio.stop();
      var removed = HC.wipe();
      this.state = HC.defaultState();
      window.location.reload();
      return removed;
    },

    replaceState: function (st) {
      this.state = st;
      HC.setDiff(st.settings.diff);
      this.applyTheme();
      HC.Audio.applySettings(st.settings);
      HC.save(st, true);
      HC.UI.refreshTop();
      HC.UI.refreshPending();
      HC.UI.syncSound();
      this.goBase();
    },

    /* --- Кадр --------------------------------------------- */
    frame: function (now) {
      requestAnimationFrame(this.frame.bind(this));
      var dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;

      var g = this.g;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      if (this.scene === 'title' || this.scene === 'ride') {
        HC.Ride.update(dt, this.readInput());
        if (HC.Ride.active || HC.Ride.phase === 'ending') HC.Ride.draw(g, this.W, this.H, this.P);
        if (this.scene === 'ride') this.updateRideHud();
      } else {
        HC.Base.update(dt);
        HC.Base.draw(g, this.W, this.H, this.P, this.state);
      }

      // добыча копится и на базе, и в заезде
      this.accum += dt;
      if (this.accum >= 1) {
        var got = HC.Economy.accrue(this.state, this.accum, true);
        this.accum = 0;
        this.state.stats.playTime += 1;
        if (got.done && got.done.length) this.onBuilt(got.done);
        if (this.scene === 'base') HC.UI.refreshPending();
      }
    },

    /* Стройка закончилась — постройка садится на место, и об этом говорят. */
    onBuilt: function (list) {
      var st = this.state, names = [];
      for (var i = 0; i < list.length; i++) {
        var p = st.base.plots[list[i]];
        if (!p) continue;
        HC.Base.pop(list[i]);
        names.push(HC.BUILDINGS[p.type].name);
      }
      HC.save(st, true);
      if (!names.length) return;
      HC.Audio.build();
      if (this.scene === 'base') {
        HC.UI.toast(names.length === 1 ? names[0] + ': готово' : 'Готово построек: ' + names.length);
        HC.UI.refresh();
      }
    },

    updateRideHud: function () {
      var r = HC.Ride, car = r.car;
      if (!car) return;
      var pct = Math.max(0, car.fuel / car.maxFuel * 100);
      var bar = document.getElementById('fuel-bar');
      bar.style.width = pct.toFixed(1) + '%';
      bar.parentNode.classList.toggle('low', pct < 20);
      var d = Math.floor(car.distance);
      if (d !== this._d) { document.getElementById('dist').textContent = d + ' м'; this._d = d; }
      if (r.coins !== this._c) { document.getElementById('run-coins').textContent = HC.fmt(r.coins); this._c = r.coins; }
      document.getElementById('fuel-info').textContent = Math.ceil(pct) + '% · канистра через ' +
        Math.max(0, Math.ceil((r.terrain.nextFuelX(car.pos.x) - car.pos.x) / HC.PPM)) + ' м';
      document.getElementById('ride-speed').textContent = Math.round(Math.abs(car.vel.x) / HC.PPM * 3.6) + ' км/ч';
      var boostButton = document.getElementById('pedal-boost');
      boostButton.classList.toggle('pressed', r.boosting);
      boostButton.classList.toggle('empty', r.boost < 0.02);
      document.getElementById('boost-bar').style.width = Math.round(r.boost * 100) + '%';
      document.getElementById('boost-charge').textContent = r.boostLocked && this.input.boost
        ? 'отпусти' : Math.round(r.boost * 100) + '%';
      var m = r.mission;
      document.getElementById('ride-mission').textContent = m.done
        ? '✓ Цель выполнена · +' + m.ore + ' руды'
        : m.title + ' · ' + Math.min(m.target, r[m.key]) + '/' + m.target + ' · +' + m.ore + ' руды';
      document.getElementById('ride-mission').classList.toggle('complete', m.done);
      var goal = r.goal;
      document.getElementById('ride-goal-label').textContent = goal.label + ' · ' + goal.distance + ' м';
      document.getElementById('ride-goal-left').textContent = 'ещё ' + Math.max(0, Math.ceil(goal.distance - car.distance)) + ' м';
      document.getElementById('ride-goal-bar').style.width = Math.min(100, car.distance / goal.distance * 100) + '%';
      var hint = document.getElementById('ride-hint');
      hint.hidden = !this.state.settings.showHints || r.phase !== 'run';
      hint.textContent = pct < 20 ? 'Топливо на исходе — следующая канистра впереди' :
        r.stuckT > 2 ? 'Попробуй сдать назад и взять разгон' :
        !car.onGround && car.airTime > 0.3 ? 'В воздухе: газ — нос вверх, тормоз — нос вниз' :
        r.boosting ? 'Разгон! Отпусти перед трамплином, чтобы сохранить контроль' :
        d < 120 ? (window.matchMedia('(pointer: coarse)').matches
          ? 'Газ справа, тормоз слева. Разгон — вместе с газом.'
          : 'Газ → / D · тормоз ← / A · разгон Shift + газ') : '';
      if (!hint.textContent) hint.hidden = true;
      document.getElementById('pedal-gas').classList.toggle('pressed', this.keys.gas || this.touch.gas);
      document.getElementById('pedal-brake').classList.toggle('pressed', this.keys.brake || this.touch.brake);
    }
  };

  HC.Game = Game;
  window.addEventListener('DOMContentLoaded', function () { Game.init(); });
})(window.HC);
