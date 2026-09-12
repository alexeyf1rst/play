/* ============================================================
   Сборка всего вместе: холст, цикл, управление, сцены.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  var PALETTES = {
    paper: {
      sky0: '#f4f2ee', sky1: '#e2dfd8',
      far0: '#d5d2ca', far1: '#c3bfb5',
      ground: '#ddd9d1', hatch: '#8e8b83', ink: '#1c1b19',
      bodyFill: '#faf9f6', tyre: '#2b2a27', rim: '#eceae5',
      driver: '#faf9f6', coin: '#e8e5de', dust: '#9b978f',
      // тона для объёма
      groundTop: '#e7e3db', groundDeep: '#b9b4a8',
      bodyHi: '#ffffff', bodyShade: '#ddd9d2',
      tyreHi: '#4a4843', rimShade: '#cfccc5',
      shadow: 'rgba(28,27,25,0.20)', vignette: 'rgba(60,55,45,0.12)', fore: '#9c968a', panelSolid: '#fbfaf8', sideFace: '#b2aca0',
      road: '#a8a29a', roadLine: '#f7f5f1'
    },
    /* Цветная тема: те же чернила и те же формы, просто мир не серый.
       Нужна, чтобы показывать игру людям, которым «чёрно-белое» непонятно. */
    color: {
      sky0: '#e2f1f8', sky1: '#bedded',
      far0: '#b7d2c6', far1: '#96bcaa',
      ground: '#b9cf92', hatch: '#6f8a5a', ink: '#22301e',
      bodyFill: '#fff8e8', tyre: '#2c2a28', rim: '#e9e5db',
      driver: '#fff8e8', coin: '#f0cc66', dust: '#a99f86',
      groundTop: '#cbdea6', groundDeep: '#7f9a63',
      bodyHi: '#fffdf5', bodyShade: '#e6d7bc',
      tyreHi: '#4c4844', rimShade: '#c8c2b5',
      shadow: 'rgba(32,46,22,0.22)', vignette: 'rgba(34,56,20,0.12)', fore: '#6d8a55',
      panelSolid: '#fffdf7', sideFace: '#93ac74',
      road: '#9d9c95', roadLine: '#f8f6f0'
    },
    dark: {
      sky0: '#0f1012', sky1: '#191a1d',
      far0: '#212226', far1: '#2a2b30',
      ground: '#1d1e21', hatch: '#3c3e43', ink: '#e9e8e4',
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
      this.applyTheme();

      HC.UI.init(this);
      HC.Audio.applySettings(this.state.settings);

      this.bindInput();
      this.resize();
      window.addEventListener('resize', this.resize.bind(this));

      HC.Quests.ensure(this.state);

      // что накопилось, пока игра была закрыта
      var off = HC.Economy.applyOffline(this.state);
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
        if (document.hidden) { HC.save(self.state, true); HC.Audio.suspend(); }
        else HC.Audio.resume();
      });

      this.pendingOffline = (Math.floor(this.state.base.pending.coins) >= 1 && off.seconds > 120) ? off : null;
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
      var bar = { dark: '#0f1012', color: '#e2f1f8', paper: '#f4f2ee' }[name];
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
      this.keys = { gas: false, brake: false };
      this.touch = { gas: false, brake: false };
      this.input = { throttle: 0 };

      function keyFlag(e, down) {
        var k = e.key;
        if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'в' || k === 'В' || k === ' ') { self.keys.gas = down; e.preventDefault(); }
        if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ф' || k === 'Ф') { self.keys.brake = down; e.preventDefault(); }
        if (down && k === 'Escape') self.togglePause();
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
      window.addEventListener('blur', function () { self.keys.gas = self.keys.brake = false; });

      ['brake', 'gas'].forEach(function (which) {
        var node = document.getElementById(which === 'gas' ? 'pedal-gas' : 'pedal-brake');
        var set = function (v) { return function (e) { self.touch[which] = v; e.preventDefault(); }; };
        node.addEventListener('pointerdown', set(true));
        node.addEventListener('pointerup', set(false));
        node.addEventListener('pointercancel', set(false));
        node.addEventListener('pointerleave', set(false));
      });

      document.getElementById('btn-pause').addEventListener('click', function () { self.togglePause(); });
      document.getElementById('btn-play').addEventListener('click', function () { self.startFromTitle(); });
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

    readInput: function () {
      var gas = this.keys.gas || this.touch.gas;
      var brake = this.keys.brake || this.touch.brake;
      this.input.throttle = (gas ? 1 : 0) + (brake ? -1 : 0);
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

      var open = Object.keys(HC.TRACKS).filter(function (t) { return true; });
      var pick = open[(Math.random() * open.length) | 0];
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
        if (self.state.stats.runs === 0 && !self.state.base.plots.some(Boolean)) self.showWelcome();
        else if (self.pendingOffline) { HC.UI.showOffline(self.pendingOffline); self.pendingOffline = null; }
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
      if (this.scene !== 'ride' || !HC.Ride.active) return;
      if (HC.Ride.paused) { HC.Ride.paused = false; HC.UI.close(); return; }
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

    showWelcome: function () {
      HC.UI.open(function () {
        return {
          title: 'Тихие холмы', html:
            '<p class="lead">Здесь некуда спешить. Катаешься по холмам, собираешь монеты, ' +
            'строишь в долине шахты — и они работают, пока тебя нет.</p>' +
            '<div class="stat"><span>газ</span><b>→ или пробел</b></div>' +
            '<div class="stat"><span>тормоз и назад</span><b>←</b></div>' +
            '<div class="stat"><span>на телефоне</span><b>две педали снизу</b></div>' +
            '<p class="muted">В воздухе газ задирает нос, тормоз опускает. Голова водителя ' +
            'не должна коснуться земли — вот и всё, что нужно знать.</p>' +
            '<div class="row"><button class="btn main wide" data-go>Поехали</button></div>',
          bind: function (root) {
            root.querySelector('[data-go]').addEventListener('click', function () {
              HC.Audio.unlock();
              HC.UI.close();
              HC.UI.openTracks();
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
    }
  };

  HC.Game = Game;
  window.addEventListener('DOMContentLoaded', function () { Game.init(); });
})(window.HC);
