/* ============================================================
   Интерфейс: окна, списки, кнопки.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  var G = null;           // ссылка на игру
  var current = null;     // открытая панель (чтобы перерисовывать после покупки)
  var el = {};

  function $(id) { return document.getElementById(id); }

  /* Значок из общего набора. Цвет наследует от текста. */
  function ic(name, cls) {
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }
  HC.icon = ic;

  var UP_ICON = { engine: 'engine', tires: 'tires', susp: 'susp', fuel: 'fuel', magnet: 'magnet' };
  var QUEST_ICON = {
    dist_run: 'flag', coins_run: 'coin', dist_total: 'road', coins_earn: 'coin',
    flips: 'flip', air: 'cloud', ore: 'ore', runs: 'repeat', cans: 'fuel',
    collect: 'collect', build: 'hammer', track_dist: 'pin'
  };
  function money(n) { return HC.fmt(n); }
  function can(cost, ore) {
    var s = G.state;
    return s.coins >= (cost || 0) && s.ore >= (ore || 0);
  }
  function pay(cost, ore) {
    if (!can(cost, ore)) { HC.Audio.deny(); UI.toast('Не хватает'); return false; }
    G.state.coins -= (cost || 0);
    G.state.ore -= (ore || 0);
    return true;
  }
  function priceTag(cost, ore) {
    var out = '<span class="price' + (can(cost, ore) ? '' : ' short') + '">';
    if (cost) out += ic('coin') + money(cost);
    if (ore) out += ic('ore') + money(ore);
    if (!cost && !ore) out += 'бесплатно';
    return out + '</span>';
  }

  function buildingPic(type, w, h) {
    try {
      return '<img class="thumb" src="' + HC.Base.thumb(type, G.P, w || 112, h || 80) + '" alt="">';
    } catch (e) { return ''; }
  }
  function vehiclePic(id, w, h) {
    try {
      return '<img class="thumb" src="' + HC.vehicleSprite(HC.VEHICLES[id], G.P, w || 124, h || 80) + '" alt="">';
    } catch (e) { return ''; }
  }

  var UI = {
    init: function (game) {
      G = game;
      ['coins', 'ore', 'modal', 'modal-title', 'modal-body', 'toast', 'pending',
       'ride-hud', 'fuel-bar', 'dist', 'run-coins', 'base-bar', 'top'].forEach(function (id) {
        el[id] = $(id);
      });

      $('modal-close').addEventListener('click', function () { UI.close(); });
      el.modal.addEventListener('click', function (e) { if (e.target === el.modal) UI.close(); });

      $('btn-ride').addEventListener('click', function () { HC.Audio.click(); UI.openTracks(); });
      $('btn-garage').addEventListener('click', function () { HC.Audio.click(); UI.openGarage(); });
      $('btn-shop').addEventListener('click', function () { HC.Audio.click(); UI.openShop(); });
      $('btn-quests').addEventListener('click', function () { HC.Audio.click(); UI.openQuests(); });
      $('btn-settings').addEventListener('click', function () { HC.Audio.click(); UI.openSettings(); });
      $('btn-sound').addEventListener('click', function () {
        var s = G.state.settings;
        s.music = !s.music;
        HC.Audio.applySettings(s);
        UI.syncSound();
        HC.save(G.state, true);
      });
      el.pending.addEventListener('click', function () {
        var got = HC.Economy.collect(G.state);
        if (got.coins || got.ore) {
          HC.Quests.report(G.state, 'collect', 1);
          HC.Base.burst(G.state, got);
          HC.Audio.build();
          UI.toast('Собрано: ' + money(got.coins) + ' монет' + (got.ore ? ', ' + money(got.ore) + ' руды' : ''));
        }
        UI.refreshTop();
        HC.save(G.state, true);
      });
      this.syncSound();
    },

    /* --- Мелочи ------------------------------------------- */
    toast: function (msg) {
      el.toast.textContent = msg;
      el.toast.classList.add('show');
      clearTimeout(this._tt);
      this._tt = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
    },

    syncSound: function () {
      var on = G.state.settings.music;
      ['btn-sound', 'btn-title-sound'].forEach(function (id) {
        var b = $(id);
        if (!b) return;
        b.textContent = on ? '♪' : '♪̸';
        b.classList.toggle('off', !on);
      });
    },

    refreshTop: function () {
      el.coins.textContent = money(G.state.coins);
      el.ore.textContent = money(G.state.ore);
      this.refreshQuestBadge();
    },

    /* Кружок с числом готовых заданий на кнопке */
    refreshQuestBadge: function () {
      var n = HC.Quests.ready(G.state);
      var b = $('quest-badge');
      if (!b) return;
      b.textContent = n;
      b.hidden = n === 0;
    },

    /* Пузырь с накопленной добычей */
    refreshPending: function () {
      var p = G.state.base.pending;
      var cap = HC.Economy.capacity(G.state);
      var c = Math.floor(p.coins), o = Math.floor(p.ore);
      if (G.scene !== 'base' || (c < 1 && o < 1)) { el.pending.hidden = true; return; }
      el.pending.hidden = false;
      var full = c >= cap.coins || (o >= cap.ore && cap.ore > 0);
      el.pending.className = full ? 'full' : '';
      el.pending.innerHTML = '<b>' + ic('collect', 'sm') + 'Собрать</b><span>' + ic('coin', 'sm') + money(c) +
        (o ? ' ' + ic('ore', 'sm') + money(o) : '') + '</span>' +
        (full ? '<em>склад полон</em>' : '');
    },

    /* --- Окна --------------------------------------------- */
    open: function (panel) {
      current = panel;
      this.render();
      el.modal.hidden = false;
    },
    close: function () {
      el.modal.hidden = true;
      current = null;
      if (this._tick) { clearInterval(this._tick); this._tick = null; }
      if (UI.onClose) { var f = UI.onClose; UI.onClose = null; f(); }
    },
    render: function () {
      if (!current) return;
      var p = current();
      el['modal-title'].textContent = p.title;
      el['modal-body'].innerHTML = p.html;
      if (p.bind) p.bind(el['modal-body']);
      // живой таймер: панель со стройкой сама обновляет свои цифры
      if (this._tick) { clearInterval(this._tick); this._tick = null; }
      if (p.tick) {
        var root = el['modal-body'];
        this._tick = setInterval(function () { p.tick(root); }, 500);
      }
      this.refreshTop();
    },
    refresh: function () {
      this.render();
      this.refreshTop();
      this.refreshPending();
    },

    /* --- Карта этапов ------------------------------------- */
    openTracks: function () {
      this.open(function () {
        var s = G.state;
        var ids = Object.keys(HC.TRACKS).sort(function (a, b) { return HC.TRACKS[a].order - HC.TRACKS[b].order; });
        var html = '<p class="lead">Пять этапов. Чтобы открыть следующий, хватит бронзы на текущем.</p>';

        ids.forEach(function (id, n) {
          var t = HC.TRACKS[id];
          var open = HC.trackOpen(s, id);
          var best = s.stats.best[id] || 0;
          var medal = HC.medalFor(id, best);
          var next = t.goals.find(function (gg) { return best < gg; });
          var pct = next ? Math.min(100, Math.round(best / next * 100)) : 100;

          html += '<div class="stage' + (open ? '' : ' locked') + (medal >= 0 ? ' won' : '') + '">' +
            '<div class="stage-no">' + (n + 1) + '</div>' +
            '<div class="stage-main">' +
              '<h3>' + t.name +
                (medal >= 0 ? '<span class="medal m' + medal + '">' + ic('medal', 'sm') + HC.MEDALS[medal].name + '</span>' : '') +
              '</h3>' +
              '<p>' + t.about + '</p>' +
              '<div class="goals">';
          t.goals.forEach(function (gg, i) {
            var done = best >= gg;
            html += '<span class="goal' + (done ? ' done' : '') + '">' +
                    ic(done ? 'medal' : 'flag', 'sm') + HC.fmt(gg) + ' м</span>';
          });
          html += '</div>' +
              '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
              '<p class="muted">' + (best ? 'лучший результат ' + HC.fmt(best) + ' м' : 'ещё не ездил') +
              ' · награда ×' + t.payout.toFixed(2) + '</p>' +
            '</div>' +
            '<div class="stage-side">' +
              (open ? '<button class="btn main" data-go="' + id + '">Поехать</button>'
                    : '<span class="done">' + ic('lock', 'sm') + ' нужна бронза<br>на «' + HC.TRACKS[t.unlock].name + '»</span>') +
            '</div></div>';
        });

        return {
          title: 'Этапы', html: html,
          bind: function (root) {
            root.querySelectorAll('[data-go]').forEach(function (b) {
              b.addEventListener('click', function () {
                HC.Audio.click();
                UI.close();
                G.startRide(b.getAttribute('data-go'));
              });
            });
          }
        };
      });
    },

    /* --- Гараж -------------------------------------------- */
    openGarage: function () {
      this.open(function () {
        var s = G.state;
        var vid = s.vehicle, v = HC.VEHICLES[vid];
        var disc = HC.Economy.workshopDiscount(s);
        var html = '<div class="hero">' + vehiclePic(vid, 200, 130) +
          '<p>Прокачка <b>' + v.name + '</b>. У каждой машины она своя, купленное остаётся навсегда.' +
          (disc > 0 ? ' Мастерская даёт скидку ' + Math.round(disc * 100) + '%.' : '') + '</p></div>';
        Object.keys(HC.UPGRADES).forEach(function (uid) {
          var u = HC.UPGRADES[uid];
          var lvl = s.up[vid][uid] | 0;
          var maxed = lvl >= u.max;
          var cost = maxed ? 0 : HC.upCostOf(u, lvl, disc);
          var ore = maxed ? 0 : HC.upOreCostOf(u, lvl);
          var pct = Math.round(lvl / u.max * 100);
          html += '<div class="card"><div class="card-main">' +
            '<h3>' + ic(UP_ICON[uid] || 'engine') + u.name +
            ' <span class="lvl">' + lvl + ' / ' + u.max + '</span></h3>' +
            '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
            '<p>' + u.about + '</p></div>' +
            '<div class="card-side">' +
            (maxed ? '<span class="done">максимум</span>'
                   : '<button class="btn" data-up="' + uid + '" ' + (can(cost, ore) ? '' : 'disabled') + '>Улучшить</button>' + priceTag(cost, ore)) +
            '</div></div>';
        });
        // Характеристики машины: они у неё свои и не настраиваются.
        var tank = Math.round(v.fuel * HC.upgradeEffect.fuel(s.up[vid].fuel | 0) *
                              HC.Economy.garageFuel(s) / (v.burn * HC.Economy.garageBurn(s)));
        html += '<h4 class="sec">' + ic('chart') + 'Какая она</h4>' +
          '<div class="stat"><span>' + ic('drive', 'sm') + 'привод</span><b>' +
          (HC.DRIVE[v.drive] || HC.DRIVE.all).name.toLowerCase() + '</b></div>' +
          '<div class="stat"><span>' + ic('engine', 'sm') + 'предел скорости</span><b>' +
          Math.round(v.topSpeed * (1 + (s.up[vid].engine | 0) * 0.018) / HC.PPM * 3.6) + ' км/ч</b></div>' +
          '<div class="stat"><span>' + ic('fuel', 'sm') + 'бак</span><b>' + tank + ' с хода</b></div>' +
          '<div class="stat"><span>' + ic('susp', 'sm') + 'колесо</span><b>' +
          Math.round(v.wheel.r * 2 / HC.PPM * 100) + ' см</b></div>' +
          '<div class="stat"><span>' + ic('chart', 'sm') + 'масса</span><b>' + v.mass + '</b></div>' +
          '<p class="muted">' + (HC.DRIVE[v.drive] || HC.DRIVE.all).about + '</p>';

        return {
          title: 'Гараж', html: html,
          bind: function (root) {
            root.querySelectorAll('[data-up]').forEach(function (b) {
              b.addEventListener('click', function () {
                var uid = b.getAttribute('data-up'), u = HC.UPGRADES[uid];
                var lvl = G.state.up[G.state.vehicle][uid] | 0;
                if (lvl >= u.max) return;
                var d = HC.Economy.workshopDiscount(G.state);
                if (!pay(HC.upCostOf(u, lvl, d), HC.upOreCostOf(u, lvl))) return;
                G.state.up[G.state.vehicle][uid] = lvl + 1;
                HC.Quests.report(G.state, 'build', 1);
                HC.Audio.build();
                HC.save(G.state, true);
                UI.refresh();
              });
            });
          }
        };
      });
    },

    /* --- Магазин: машины и участки ------------------------ */
    openShop: function () {
      this.open(function () {
        var s = G.state;
        var ids = Object.keys(HC.VEHICLES).sort(function (a, b) { return HC.VEHICLES[a].order - HC.VEHICLES[b].order; });
        var html = '<p class="lead">Машины. Купленное остаётся навсегда, прокачка у каждой своя.</p>';
        ids.forEach(function (id) {
          var v = HC.VEHICLES[id];
          var owned = !!s.owned[id];
          var active = s.vehicle === id;
          html += '<div class="card' + (owned ? '' : ' locked') + '">' + vehiclePic(id) +
            '<div class="card-main"><h3>' + v.name + '</h3><p>' + v.about + '</p>' +
            '<p class="muted">' + (v.axles.length > 2 ? v.axles.length + ' оси · ' : '') +
            'бак на ' + Math.round(v.fuel / v.burn) + ' с · привод ' +
            (HC.DRIVE[v.drive] || HC.DRIVE.all).name.toLowerCase() + ' · масса ' + v.mass + '</p></div>' +
            '<div class="card-side">' +
            (active ? '<span class="done">выбрана</span>'
              : owned ? '<button class="btn main" data-pick="' + id + '">Выбрать</button>'
              : '<button class="btn" data-buy-car="' + id + '" ' + (can(v.price, v.priceOre) ? '' : 'disabled') + '>Купить</button>' + priceTag(v.price, v.priceOre)) +
            '</div></div>';
        });

        var cost = HC.Economy.plotCost(s);
        var left = HC.PLOTS.spots.length - s.base.unlocked;
        html += '<h4 class="sec">' + ic('plus') + 'Участки под постройки</h4>' +
          '<div class="card"><div class="card-main"><h3>Новый участок</h3>' +
          '<p>' + (left > 0 ? 'Свободных мест в долине: ' + left + '.' : 'Вся долина застроена.') + '</p></div>' +
          '<div class="card-side">' +
          (left > 0 ? '<button class="btn" data-plot ' + (can(cost, 0) ? '' : 'disabled') + '>Расчистить</button>' + priceTag(cost, 0)
                    : '<span class="done">всё занято</span>') +
          '</div></div>';

        return {
          title: 'Магазин', html: html,
          bind: function (root) {
            root.querySelectorAll('[data-pick]').forEach(function (b) {
              b.addEventListener('click', function () {
                G.state.vehicle = b.getAttribute('data-pick');
                HC.Audio.click(); HC.save(G.state, true); UI.refresh();
              });
            });
            root.querySelectorAll('[data-buy-car]').forEach(function (b) {
              b.addEventListener('click', function () {
                var id = b.getAttribute('data-buy-car'), v = HC.VEHICLES[id];
                if (!pay(v.price, v.priceOre)) return;
                G.state.owned[id] = true;
                G.state.vehicle = id;
                if (!G.state.up[id]) {
                  G.state.up[id] = {};
                  for (var uid in HC.UPGRADES) G.state.up[id][uid] = 0;
                }
                HC.Audio.build();
                UI.toast('Куплена ' + v.name);
                HC.save(G.state, true); UI.refresh();
              });
            });
            var pb = root.querySelector('[data-plot]');
            if (pb) pb.addEventListener('click', function () {
              if (!pay(HC.Economy.plotCost(G.state), 0)) return;
              G.state.base.unlocked++;
              HC.Audio.build();
              UI.toast('Участок расчищен');
              HC.save(G.state, true); UI.refresh();
            });
          }
        };
      });
    },

    /* --- Участок на базе ---------------------------------- */
    openPlot: function (index) {
      this.open(function () {
        var s = G.state, plot = s.base.plots[index];
        var html = '', title, tick = null;

        if (!plot) {
          title = 'Пустой участок';
          html = '<p class="lead">Что здесь построить? Стройка занимает время — и идёт даже с закрытой игрой.</p>';
          Object.keys(HC.BUILDINGS).forEach(function (bid) {
            var d = HC.BUILDINGS[bid];
            var cost = HC.costOf(d, 0), ore = HC.oreCostOf(d, 0);
            html += '<div class="card">' + buildingPic(bid) +
              '<div class="card-main"><h3>' + ic(d.icon || bid) + d.name + '</h3><p>' + d.about + '</p>' +
              '<p class="muted">' + UI.buildingEffect(bid, 1) + ' · ' +
              ic('clock', 'sm') + ' ' + HC.fmtTime(HC.buildTimeOf(d, 1)) + '</p></div>' +
              '<div class="card-side"><button class="btn" data-build="' + bid + '" ' + (can(cost, ore) ? '' : 'disabled') + '>Строить</button>' +
              priceTag(cost, ore) + '</div></div>';
          });
        } else if (plot.build) {
          // Стройка идёт. Улучшение не мешает работать: постройка остаётся
          // на прежнем уровне, пока каркас не снимут.
          var d = HC.BUILDINGS[plot.type];
          var fresh = plot.level < 1;
          var to = plot.build.to;
          title = fresh ? ('Стройка: ' + d.name) : (d.name + ' · улучшение до ' + to);
          html = '<div class="hero">' + buildingPic(plot.type, 190, 140) + '<p>' +
            (fresh ? 'Строится. Пока идёт стройка, участок ничего не приносит.'
                   : 'Работает на уровне ' + plot.level + ', пока идёт улучшение.') +
            ' Время идёт и когда игра закрыта.</p></div>' +
            '<div class="stat"><span>' + ic('clock', 'sm') + 'осталось</span><b data-left>' +
            HC.fmtLeft(HC.Economy.buildLeft(plot)) + '</b></div>' +
            '<div class="bar"><i data-prog style="width:' +
            Math.round(HC.Economy.buildProgress(plot) * 100) + '%"></i></div>' +
            '<div class="stat"><span>' + ic('plus', 'sm') + 'станет</span><b>' +
            UI.buildingEffect(plot.type, to) + '</b></div>' +
            '<button class="btn ghost wide" data-cancel>Отменить стройку (деньги вернутся полностью)</button>';
          tick = function (root) {
            var pl = G.state.base.plots[index];
            if (!pl || !pl.build) { UI.refresh(); return; }
            var lb = root.querySelector('[data-left]');
            var pg = root.querySelector('[data-prog]');
            if (lb) lb.textContent = HC.fmtLeft(HC.Economy.buildLeft(pl));
            if (pg) pg.style.width = Math.round(HC.Economy.buildProgress(pl) * 100) + '%';
          };
        } else {
          var d2 = HC.BUILDINGS[plot.type];
          title = d2.name + ' · уровень ' + plot.level;
          var maxed = plot.level >= d2.max;
          var cost2 = maxed ? 0 : HC.costOf(d2, plot.level);
          var ore2 = maxed ? 0 : HC.oreCostOf(d2, plot.level);
          var sec = maxed ? 0 : HC.buildTimeOf(d2, plot.level + 1);
          html = '<div class="hero">' + buildingPic(plot.type, 190, 140) + '<p>' + d2.about + '</p></div>' +
            '<div class="stat"><span>' + ic(d2.icon || plot.type, 'sm') + 'сейчас</span><b>' + UI.buildingEffect(plot.type, plot.level) + '</b></div>' +
            (maxed ? '' : '<div class="stat"><span>' + ic('plus', 'sm') + 'станет</span><b>' + UI.buildingEffect(plot.type, plot.level + 1) + '</b></div>' +
                          '<div class="stat"><span>' + ic('clock', 'sm') + 'стройка</span><b>' + HC.fmtTime(sec) + '</b></div>') +
            '<div class="card"><div class="card-main"><h3>' + (maxed ? 'Дальше некуда' : 'Улучшить до ' + (plot.level + 1)) + '</h3>' +
            '<div class="bar"><i style="width:' + Math.round(plot.level / d2.max * 100) + '%"></i></div></div>' +
            '<div class="card-side">' +
            (maxed ? '<span class="done">максимум</span>'
                   : '<button class="btn main" data-upg ' + (can(cost2, ore2) ? '' : 'disabled') + '>Улучшить</button>' + priceTag(cost2, ore2)) +
            '</div></div>' +
            '<button class="btn ghost wide" data-demolish>Разобрать (вернётся половина вложенного)</button>';
        }
        return {
          title: title, html: html, tick: tick,
          bind: function (root) {
            root.querySelectorAll('[data-build]').forEach(function (b) {
              b.addEventListener('click', function () {
                var bid = b.getAttribute('data-build'), d = HC.BUILDINGS[bid];
                if (!pay(HC.costOf(d, 0), HC.oreCostOf(d, 0))) return;
                var sec = HC.Economy.startBuild(G.state, index, bid, 1);
                HC.Quests.report(G.state, 'build', 1);
                HC.Base.pop(index);
                HC.Audio.build();
                UI.toast(sec ? d.name + ': стройка на ' + HC.fmtTime(sec) : d.name + ' построена');
                HC.save(G.state, true);
                UI.refresh();
              });
            });
            var ub = root.querySelector('[data-upg]');
            if (ub) ub.addEventListener('click', function () {
              var p = G.state.base.plots[index], d = HC.BUILDINGS[p.type];
              if (p.level >= d.max) return;
              if (!pay(HC.costOf(d, p.level), HC.oreCostOf(d, p.level))) return;
              var sec = HC.Economy.startBuild(G.state, index, p.type, p.level + 1);
              HC.Quests.report(G.state, 'build', 1);
              HC.Base.pop(index);
              HC.Audio.build();
              if (sec) UI.toast('Улучшение: ' + HC.fmtTime(sec));
              HC.save(G.state, true);
              UI.refresh();
            });
            // Отменённая стройка возвращает всё: наказывать за передумал незачем.
            var cb = root.querySelector('[data-cancel]');
            if (cb) cb.addEventListener('click', function () {
              var p = G.state.base.plots[index];
              if (!p || !p.build) return;
              var d = HC.BUILDINGS[p.type];
              G.state.coins += HC.costOf(d, p.build.to - 1);
              G.state.ore += HC.oreCostOf(d, p.build.to - 1);
              if (p.level < 1) G.state.base.plots[index] = null;
              else delete p.build;
              HC.Audio.click();
              UI.toast('Стройка отменена');
              HC.save(G.state, true);
              if (G.state.base.plots[index]) UI.refresh(); else UI.close();
            });
            var db = root.querySelector('[data-demolish]');
            if (db) db.addEventListener('click', function () {
              var p = G.state.base.plots[index], d = HC.BUILDINGS[p.type];
              if (!window.confirm('Разобрать ' + d.name + '? Вернётся половина вложенного.')) return;
              var back = 0, backOre = 0;
              for (var l = 0; l < p.level; l++) { back += HC.costOf(d, l); backOre += HC.oreCostOf(d, l); }
              G.state.coins += Math.floor(back / 2);
              G.state.ore += Math.floor(backOre / 2);
              G.state.base.plots[index] = null;
              HC.Audio.click();
              UI.toast('Вернулось ' + money(Math.floor(back / 2)) + ' монет');
              HC.save(G.state, true);
              UI.close();
            });
          }
        };
      });
    },

    /* Какой этап открылся после медали на этом */
    unlockedBy: function (trackId) {
      var next = null;
      Object.keys(HC.TRACKS).forEach(function (id) {
        if (HC.TRACKS[id].unlock === trackId) next = HC.TRACKS[id].name;
      });
      return next;
    },

    buildingEffect: function (type, level) {
      var d = HC.BUILDINGS[type];
      if (type === 'mine') return '+' + HC.fmt1(HC.Economy.buildingRate('mine', level)) + ' монет в минуту';
      if (type === 'drill') return '+' + HC.fmt1(HC.Economy.buildingRate('drill', level)) + ' руды в минуту';
      if (type === 'storage') return '+' + money(d.capCoins * Math.pow(d.capMult, level - 1)) + ' к складу монет';
      if (type === 'windmill') return '+' + Math.round(d.bonus * level * 100) + '% ко всей добыче';
      if (type === 'workshop') return '−' + Math.round(d.discount * level * 100) + '% к цене прокачки, +' + Math.round(d.ridebonus * level * 100) + '% монет с заездов';
      if (type === 'garden') return '+' + HC.fmt1(d.offline * level) + ' ч к копилке офлайна';
      if (type === 'smelter') return '+' + HC.fmt(Math.round(d.melt * Math.pow(d.meltMult, level - 1))) + ' монет в минуту, ест ' + HC.fmt1(d.eats * level) + ' руды в минуту';
      if (type === 'garage') return '+' + Math.round(d.fuel * level * 100) + '% к баку, −' + Math.round(d.burn * level * 100) + '% расхода';
      if (type === 'radio') return '+' + Math.round(d.questBonus * level * 100) + '% к наградам за задания';
      if (type === 'depot') return 'свозит добычу раз в ' + HC.fmt1(d.auto / level) + ' мин';
      return '';
    },

    /* --- Результат заезда --------------------------------- */
    showResults: function (r) {
      this.open(function () {
        var html = '<p class="lead">' + r.reason + (r.record ? ' · новый рекорд!' : '') + '</p>' +
          (r.newMedal >= 0
            ? '<div class="medal-won">' + ic('medal', 'lg') + '<b>' + HC.MEDALS[r.newMedal].name + ' на «' +
              HC.TRACKS[r.track].name + '»</b>' + (UI.unlockedBy(r.track) ? '<em>открыт этап «' + UI.unlockedBy(r.track) + '»</em>' : '') + '</div>'
            : '') +
          '<div class="result"><div class="big">' + r.distance + ' <small>м</small></div>' +
          '<div class="muted">лучший результат ' + r.best + ' м · ' + HC.fmtTime(r.time) + '</div></div>' +
          '<div class="stat"><span>' + ic('coin', 'sm') + 'монеты на трассе</span><b>' + money(r.coinsRaw) + '</b></div>' +
          '<div class="stat"><span>' + ic('road', 'sm') + 'за расстояние</span><b>' + money(r.distCoins) + '</b></div>' +
          (r.bonus ? '<div class="stat"><span>' + ic('trophy', 'sm') + 'бонус за рекорд</span><b>' + money(r.bonus) + '</b></div>' : '') +
          (r.flips ? '<div class="stat"><span>' + ic('flip', 'sm') + 'сальто</span><b>' + r.flips + '</b></div>' : '') +
          (r.cans ? '<div class="stat"><span>' + ic('fuel', 'sm') + 'канистр подобрано</span><b>' + r.cans + '</b></div>' : '') +
          (r.ore ? '<div class="stat"><span>' + ic('ore', 'sm') + 'руда</span><b>' + money(r.ore) + '</b></div>' : '') +
          '<div class="stat total"><span>' + ic('coin') + 'всего монет</span><b>' + money(r.total) + '</b></div>' +
          '<div class="row"><button class="btn main wide" data-again>Ещё заезд</button>' +
          '<button class="btn wide" data-home>На базу</button></div>';
        return {
          title: 'Заезд окончен', html: html,
          bind: function (root) {
            root.querySelector('[data-again]').addEventListener('click', function () {
              HC.Audio.click(); UI.close(); G.startRide(G.lastTrack);
            });
            root.querySelector('[data-home]').addEventListener('click', function () {
              HC.Audio.click(); UI.close(); G.goBase();
            });
          }
        };
      });
    },

    /* --- Пока тебя не было -------------------------------- */
    showOffline: function (info) {
      this.open(function () {
        return {
          title: 'Пока тебя не было', html:
            '<p class="lead">Прошло ' + HC.fmtTime(info.seconds) + '. Шахты работали' +
            (info.capped ? ', но склад заполнился и часть пропала — расширь склад или заходи почаще.' : '.') + '</p>' +
            '<div class="stat"><span>накопилось монет</span><b>' + money(Math.floor(G.state.base.pending.coins)) + '</b></div>' +
            (G.state.base.pending.ore >= 1 ? '<div class="stat"><span>руды</span><b>' + money(Math.floor(G.state.base.pending.ore)) + '</b></div>' : '') +
            '<div class="row"><button class="btn main wide" data-take>Забрать</button></div>',
          bind: function (root) {
            root.querySelector('[data-take]').addEventListener('click', function () {
              var got = HC.Economy.collect(G.state);
              HC.Quests.report(G.state, 'collect', 1);
              HC.Audio.build();
              UI.toast('Собрано ' + money(got.coins) + ' монет');
              HC.save(G.state, true);
              UI.close(); UI.refreshTop(); UI.refreshPending();
            });
          }
        };
      });
    },

    /* --- Задания ------------------------------------------ */
    questTab: 'daily',

    openQuests: function () {
      this.open(function () {
        HC.Quests.ensure(G.state);
        var period = UI.questTab;
        if (!HC.QUEST_PERIODS[period]) period = UI.questTab = 'daily';
        var P = HC.QUEST_PERIODS[period];
        var group = G.state.quests[period];

        // вкладки: сразу видно, где ждёт награда
        var html = '<div class="tabs">';
        Object.keys(HC.QUEST_PERIODS).forEach(function (p) {
          var list = (G.state.quests[p] && G.state.quests[p].list) || [];
          var ready = list.filter(function (q) { return !q.c && HC.Quests.done(q); }).length;
          html += '<button data-tab="' + p + '" class="' + (p === period ? 'on' : '') + '">' +
                  HC.QUEST_PERIODS[p].tab +
                  (ready ? '<span class="tab-n">' + ready + '</span>' : '') + '</button>';
        });
        html += '</div>';

        html += '<p class="tab-note">' + ic('clock', 'sm') + 'Список обновится через ' +
                HC.fmtTime(HC.Quests.resetIn(period)) + '. Незабранная награда уйдёт вместе с ним.</p>';

        if (group) {
          group.list.forEach(function (q, i) {
            var done = HC.Quests.done(q);
            var pct = Math.min(100, Math.round(q.p / q.n * 100));
            var reward = '<span class="price">' + ic('coin') + money(q.rc) +
                         (q.ro ? ic('ore') + money(q.ro) : '') + '</span>';
            html += '<div class="card quest' + (q.c ? ' claimed' : (done ? ' ready' : '')) + '">' +
              '<div class="card-main"><h3>' + ic(QUEST_ICON[q.t] || 'flag') + HC.Quests.text(q) + '</h3>' +
              '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
              '<p class="muted">' + HC.Quests.progressText(q) + '</p></div>' +
              '<div class="card-side">' +
              (q.c ? '<span class="done">' + ic('check', 'sm') + ' получено</span>'
                   : done ? '<button class="btn main" data-claim="' + period + ':' + i + '">Забрать</button>'
                          : reward) +
              '</div></div>';
          });
        }

        return {
          title: 'Задания · ' + P.name.toLowerCase(), html: html,
          bind: function (root) {
            root.querySelectorAll('[data-tab]').forEach(function (b) {
              b.addEventListener('click', function () {
                UI.questTab = b.getAttribute('data-tab');
                HC.Audio.click();
                UI.render();
              });
            });
            root.querySelectorAll('[data-claim]').forEach(function (b) {
              b.addEventListener('click', function () {
                var parts = b.getAttribute('data-claim').split(':');
                var got = HC.Quests.claim(G.state, parts[0], parseInt(parts[1], 10));
                if (!got) return;
                HC.Audio.build();
                UI.toast('Награда: ' + money(got.coins) + ' монет' + (got.ore ? ' и ' + money(got.ore) + ' руды' : ''));
                HC.save(G.state, true);
                UI.refresh();
              });
            });
          }
        };
      });
    },

    /* --- Настройки и сейвы -------------------------------- */
    openSettings: function () {
      this.open(function () {
        var s = G.state, st = s.stats, set = s.settings;
        var r = HC.Economy.rates(s), cap = HC.Economy.capacity(s);
        var html =
          '<h4 class="sec">' + ic('sound') + 'Звук</h4>' +
          '<label class="row switch"><span>Музыка</span><input type="checkbox" id="set-music" ' + (set.music ? 'checked' : '') + '></label>' +
          '<label class="row slider"><span>Громкость</span><input type="range" id="set-mvol" min="0" max="100" value="' + Math.round(set.musicVol * 100) + '"></label>' +
          '<label class="row switch"><span>Звуки</span><input type="checkbox" id="set-sfx" ' + (set.sfx ? 'checked' : '') + '></label>' +
          '<label class="row slider"><span>Громкость</span><input type="range" id="set-svol" min="0" max="100" value="' + Math.round(set.sfxVol * 100) + '"></label>' +

          '<h4 class="sec">' + ic('settings') + 'Вид</h4>' +
          '<label class="row switch"><span>Тёмная тема</span><input type="checkbox" id="set-theme" ' + (set.theme === 'dark' ? 'checked' : '') + '></label>' +
          '<label class="row switch"><span>Спокойный режим <em>(без пыли и тряски)</em></span><input type="checkbox" id="set-calm" ' + (set.calmMode ? 'checked' : '') + '></label>' +

          '<h4 class="sec">' + ic('mine') + 'Добыча</h4>' +
          '<div class="stat"><span>' + ic('coin', 'sm') + 'монет в минуту</span><b>' + HC.fmt1(r.coins) + '</b></div>' +
          '<div class="stat"><span>' + ic('ore', 'sm') + 'руды в минуту</span><b>' + HC.fmt1(r.ore) + '</b></div>' +
          '<div class="stat"><span>' + ic('storage', 'sm') + 'склад</span><b>' + money(cap.coins) + ' / ' + money(cap.ore) + '</b></div>' +
          '<div class="stat"><span>' + ic('clock', 'sm') + 'копилка офлайна</span><b>' + HC.fmt1(HC.Economy.offlineHours(s)) + ' ч</b></div>' +

          '<h4 class="sec">' + ic('chart') + 'Пройдено</h4>' +
          '<div class="stat"><span>' + ic('repeat', 'sm') + 'заездов</span><b>' + st.runs + '</b></div>' +
          '<div class="stat"><span>' + ic('road', 'sm') + 'всего метров</span><b>' + money(st.totalDistance) + '</b></div>' +
          '<div class="stat"><span>' + ic('coin', 'sm') + 'всего монет заработано</span><b>' + money(st.totalCoins) + '</b></div>' +

          '<h4 class="sec">' + ic('beaker') + 'Песочница <em>для проверки</em></h4>' +
          '<p class="muted">Выдать себе ресурсы и всё открыть, чтобы посмотреть игру целиком. ' +
          'Игра только твоя и офлайновая, так что портить тут нечего — но если хочешь честный ' +
          'прогресс, сначала сохранись в файл.</p>' +
          '<div class="row give">' +
          '<input type="number" id="give-coins" placeholder="монет" min="0" step="1000">' +
          '<input type="number" id="give-ore" placeholder="руды" min="0" step="100">' +
          '<button class="btn" id="give-go">Выдать</button></div>' +
          '<div class="row wrap">' +
          '<button class="btn" data-cheat="rich">+100 000 монет</button>' +
          '<button class="btn" data-cheat="ore">+2 000 руды</button>' +
          '<button class="btn" data-cheat="hour">+1 час добычи</button>' +
          '<button class="btn" data-cheat="ready">Достроить всё</button>' +
          '</div>' +
          '<div class="row wrap">' +
          '<button class="btn" data-cheat="unlock">Открыть всё</button>' +
          '<button class="btn" data-cheat="maxup">Прокачать машину</button>' +
          '<button class="btn" data-cheat="quests">Закрыть задания</button>' +
          '<button class="btn ghost" data-cheat="poor">Обнулить ресурсы</button>' +
          '</div>' +

          '<h4 class="sec">' + ic('save') + 'Сохранение</h4>' +
          '<p class="muted">Игра сама пишется в память браузера каждые несколько секунд. ' +
          (HC.isMemoryOnly() ? '<b>Сейчас автосохранение недоступно</b> — браузер запретил запись. Сохраняйся в файл.' :
           'Чтобы не потерять прогресс при чистке браузера — выгружай файл или код.') + '</p>' +
          '<div class="row wrap">' +
          '<button class="btn" id="save-file">Сохранить в файл</button>' +
          '<button class="btn" id="save-code">Скопировать код</button>' +
          '<button class="btn" id="load-file">Загрузить файл</button>' +
          '</div>' +
          '<textarea id="code-box" placeholder="Сюда можно вставить код сейва с другого устройства и нажать «Применить»"></textarea>' +
          '<div class="row wrap"><button class="btn" id="apply-code">Применить код</button>' +
          '<button class="btn ghost" id="wipe">Начать заново</button></div>' +
          '<input type="file" id="file-input" accept=".json,application/json" hidden>';

        return {
          title: 'Настройки', html: html,
          bind: function (root) {
            function onSet() { HC.Audio.applySettings(G.state.settings); HC.save(G.state, true); }
            root.querySelector('#set-music').addEventListener('change', function (e) {
              G.state.settings.music = e.target.checked; onSet(); UI.syncSound();
              if (e.target.checked) HC.Audio.unlock();
            });
            root.querySelector('#set-sfx').addEventListener('change', function (e) {
              G.state.settings.sfx = e.target.checked; onSet();
            });
            root.querySelector('#set-mvol').addEventListener('input', function (e) {
              G.state.settings.musicVol = e.target.value / 100; HC.Audio.applySettings(G.state.settings);
            });
            root.querySelector('#set-svol').addEventListener('input', function (e) {
              G.state.settings.sfxVol = e.target.value / 100; HC.Audio.applySettings(G.state.settings);
            });
            root.querySelector('#set-theme').addEventListener('change', function (e) {
              G.state.settings.theme = e.target.checked ? 'dark' : 'paper';
              G.applyTheme(); HC.save(G.state, true);
            });
            root.querySelector('#set-calm').addEventListener('change', function (e) {
              G.state.settings.calmMode = e.target.checked; HC.save(G.state, true);
            });

            function afterCheat(msg) {
              HC.Audio.build();
              UI.toast(msg);
              HC.save(G.state, true);
              UI.refresh();
              UI.refreshPending();
            }
            root.querySelector('#give-go').addEventListener('click', function () {
              var c = parseInt(root.querySelector('#give-coins').value, 10) || 0;
              var o = parseInt(root.querySelector('#give-ore').value, 10) || 0;
              if (!c && !o) { UI.toast('Впиши сколько выдать'); return; }
              G.state.coins += Math.max(0, c);
              G.state.ore += Math.max(0, o);
              afterCheat('Выдано ' + money(c) + ' монет' + (o ? ' и ' + money(o) + ' руды' : ''));
            });
            root.querySelectorAll('[data-cheat]').forEach(function (b) {
              b.addEventListener('click', function () {
                var what = b.getAttribute('data-cheat'), s = G.state, i;
                if (what === 'rich') { s.coins += 100000; afterCheat('+100 000 монет'); }
                else if (what === 'ore') { s.ore += 2000; afterCheat('+2 000 руды'); }
                else if (what === 'hour') {
                  var got = HC.Economy.accrue(s, 3600);
                  afterCheat('Шахты поработали час: +' + money(Math.floor(got.coins)) + ' в копилку');
                }
                else if (what === 'ready') {
                  var fin = HC.Economy.finishDue(s, Date.now() + 1e12);
                  fin.forEach(function (idx) { HC.Base.pop(idx); });
                  afterCheat(fin.length ? 'Достроено: ' + fin.length : 'Стройки нет');
                }
                else if (what === 'unlock') {
                  for (i in HC.VEHICLES) {
                    s.owned[i] = true;
                    if (!s.up[i]) { s.up[i] = {}; for (var u2 in HC.UPGRADES) s.up[i][u2] = 0; }
                  }
                  // этапы открываются медалями, поэтому проставляем бронзу
                  for (i in HC.TRACKS) {
                    s.tracks[i] = true;
                    var g0 = HC.TRACKS[i].goals[0];
                    if ((s.stats.best[i] || 0) < g0) s.stats.best[i] = g0;
                  }
                  s.base.unlocked = HC.PLOTS.spots.length;
                  afterCheat('Открыты все машины, этапы и участки');
                }
                else if (what === 'maxup') {
                  var v = s.vehicle;
                  for (i in HC.UPGRADES) s.up[v][i] = HC.UPGRADES[i].max;
                  afterCheat(HC.VEHICLES[v].name + ': прокачка в максимум');
                }
                else if (what === 'quests') {
                  HC.Quests.ensure(s);
                  for (var p in s.quests) {
                    (s.quests[p].list || []).forEach(function (q) { q.p = q.n; });
                  }
                  afterCheat('Все задания выполнены — забирай награды');
                }
                else if (what === 'poor') {
                  s.coins = 0; s.ore = 0;
                  s.base.pending = { coins: 0, ore: 0 };
                  afterCheat('Ресурсы обнулены');
                }
              });
            });

            root.querySelector('#save-file').addEventListener('click', function () {
              var name = HC.exportFile(G.state);
              UI.toast('Скачан файл ' + name);
            });
            root.querySelector('#save-code').addEventListener('click', function () {
              var code = HC.exportCode(G.state);
              var box = root.querySelector('#code-box');
              box.value = code;
              box.select();
              var done = function () { UI.toast('Код сейва скопирован'); };
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(code).then(done, function () {
                  UI.toast('Код в поле ниже — скопируй вручную');
                });
              } else {
                try { document.execCommand('copy'); done(); }
                catch (e) { UI.toast('Код в поле ниже — скопируй вручную'); }
              }
            });
            var fi = root.querySelector('#file-input');
            root.querySelector('#load-file').addEventListener('click', function () { fi.click(); });
            fi.addEventListener('change', function () {
              if (!fi.files[0]) return;
              HC.importFile(fi.files[0]).then(function (st) {
                G.replaceState(st);
                UI.toast('Сейв загружен');
                UI.refresh();
              }, function (err) { UI.toast(err.message); });
            });
            root.querySelector('#apply-code').addEventListener('click', function () {
              var v = root.querySelector('#code-box').value.trim();
              if (!v) { UI.toast('Вставь код в поле'); return; }
              try {
                G.replaceState(HC.importCode(v));
                UI.toast('Сейв загружен');
                UI.refresh();
              } catch (e) { UI.toast(e.message); }
            });
            root.querySelector('#wipe').addEventListener('click', function () {
              if (!window.confirm('Стереть весь прогресс и начать заново?\n\nУйдут монеты, руда, машины, прокачка, база и задания. Это не отменить.')) return;
              G.hardReset();
            });
          }
        };
      });
    }
  };

  HC.UI = UI;
})(window.HC);
