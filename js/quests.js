/* ============================================================
   Задания на день, неделю и месяц.
   Список создаётся из даты, поэтому у одного периода он всегда
   один и тот же, а в следующем — уже другой. Ничего не качается
   с сервера: всё считается на месте.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  /* mode: max — зачитывается лучший результат за один заезд,
           sum — складывается за весь период.
     grow — во сколько раз тяжелеет цель на следующем периоде
            (для «за один заезд» растёт медленно, иначе невыполнимо). */
  HC.QUEST_KINDS = {
    dist_run:   { text: 'Проехать {n} м за один заезд',        mode: 'max', min: 500,  max: 1100, step: 50,  grow: 2.0 },
    coins_run:  { text: 'Собрать {n} монет на трассе за заезд', mode: 'max', min: 50,   max: 110,  step: 10,  grow: 1.9 },
    dist_total: { text: 'Проехать {n} м всего',                 mode: 'sum', min: 2000, max: 4000, step: 250 },
    coins_earn: { text: 'Заработать {n} монет',                 mode: 'sum', min: 800,  max: 1800, step: 100 },
    flips:      { text: 'Сделать {n} сальто',                   mode: 'sum', min: 2,    max: 5,    step: 1 },
    air:        { text: 'Пробыть в воздухе {n} с',              mode: 'sum', min: 20,   max: 45,   step: 5 },
    ore:        { text: 'Добыть {n} руды',                      mode: 'sum', min: 3,    max: 8,    step: 1 },
    runs:       { text: 'Съездить {n} раз',                     mode: 'sum', min: 3,    max: 6,    step: 1 },
    cans:       { text: 'Подобрать {n} канистр',                mode: 'sum', min: 10,   max: 25,   step: 5 },
    collect:    { text: 'Собрать добычу с базы {n} раз',        mode: 'sum', min: 3,    max: 6,    step: 1 },
    build:      { text: 'Построить или улучшить {n} раз',       mode: 'sum', min: 2,    max: 4,    step: 1 },
    track_dist: { text: 'Проехать {n} м по маршруту «{track}»', mode: 'sum', min: 800,  max: 1600, step: 100, track: true }
  };

  HC.QUEST_PERIODS = {
    daily:   { name: 'На день',   tab: 'День',   count: 3, factor: 1,   idx: 0, coins: [1600, 3100],   ore: [0, 0] },
    weekly:  { name: 'На неделю', tab: 'Неделя', count: 3, factor: 4.5, idx: 1, coins: [10000, 19000], ore: [10, 22] },
    monthly: { name: 'На месяц',  tab: 'Месяц',  count: 2, factor: 16,  idx: 2, coins: [55000, 95000], ore: [60, 120] }
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function mondayOf(d) {
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    return t;
  }

  /* Ключи текущих периодов — по местному времени игрока. */
  function keys(now) {
    var d = now ? new Date(now) : new Date();
    return {
      daily: dayKey(d),
      weekly: 'W' + dayKey(mondayOf(d)),
      monthly: d.getFullYear() + '-' + pad(d.getMonth() + 1)
    };
  }

  /* Сколько осталось до обновления списка. */
  function resetIn(period, now) {
    var d = now ? new Date(now) : new Date();
    var next;
    if (period === 'daily') {
      next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    } else if (period === 'weekly') {
      next = mondayOf(d); next.setDate(next.getDate() + 7);
    } else {
      next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return Math.max(0, (next - d) / 1000);
  }

  function rng(seedStr, salt) {
    var h = 2166136261;
    var s = seedStr + '|' + salt;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    var state = h >>> 0;
    function next() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    }
    // первые значения такого генератора коррелируют с семечком, а семечко —
    // это дата: без прогрева в соседние дни выпадало бы одно и то же
    for (var w = 0; w < 12; w++) next();
    return next;
  }

  function roundTo(v, step) { return Math.max(step, Math.round(v / step) * step); }

  /* Задания разбиты по смыслу. В каждом списке обязательно есть трюковое —
     иначе выпадали одни «проехать столько-то метров», и это скучно. */
  var GROUPS = {
    trick: ['flips', 'air', 'cans'],
    move:  ['dist_run', 'dist_total', 'track_dist'],
    money: ['coins_run', 'coins_earn', 'ore'],
    base:  ['collect', 'build', 'runs']
  };

  /* Собираем список заданий на период. Без повторов типов. */
  function build(period, key, state) {
    var P = HC.QUEST_PERIODS[period];
    var r = rng(key, period);

    function shuffle(arr) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(r() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    // трюки и движение — всегда; остальное добирается по жребию
    var order = ['trick', 'move'].concat(shuffle(['money', 'base']));
    var kinds = [];
    order.forEach(function (gname) { kinds.push(shuffle(GROUPS[gname])[0]); });
    // если нужно больше заданий, чем групп — добираем оставшимися типами
    var rest = shuffle(Object.keys(HC.QUEST_KINDS).filter(function (k) { return kinds.indexOf(k) < 0; }));
    kinds = kinds.concat(rest);
    var openTracks = Object.keys(HC.TRACKS).filter(function (t) { return HC.trackOpen(state, t); });
    var list = [];
    for (var k = 0; k < kinds.length && list.length < P.count; k++) {
      var kind = HC.QUEST_KINDS[kinds[k]];
      var base = kind.min + r() * (kind.max - kind.min);
      var target = kind.mode === 'max'
        ? roundTo(base * Math.pow(kind.grow || 2, P.idx), kind.step)
        : roundTo(base * P.factor, kind.step);
      var q = { t: kinds[k], n: target, p: 0, c: false };
      if (kind.track) q.track = openTracks[Math.floor(r() * openTracks.length)] || 'hills';
      q.rc = Math.round((P.coins[0] + r() * (P.coins[1] - P.coins[0])) / 10) * 10;
      q.ro = Math.round(P.ore[0] + r() * (P.ore[1] - P.ore[0]));
      list.push(q);
    }
    return { key: key, list: list };
  }

  HC.Quests = {
    keys: keys,
    resetIn: resetIn,

    /* Обновляет списки, если наступил новый день/неделя/месяц.
       Возвращает названия обновившихся периодов. */
    ensure: function (state, now) {
      if (!state.quests) state.quests = {};
      var k = keys(now), changed = [];
      for (var period in HC.QUEST_PERIODS) {
        var cur = state.quests[period];
        if (!cur || cur.key !== k[period] || !Array.isArray(cur.list) || !cur.list.length) {
          state.quests[period] = build(period, k[period], state);
          if (cur) changed.push(period);
        }
      }
      return changed;
    },

    /* Отметить прогресс. value — метры, монеты, штуки и т.п. */
    report: function (state, kind, value, trackId) {
      if (!state.quests || !value) return;
      var def = HC.QUEST_KINDS[kind];
      if (!def) return;
      for (var period in state.quests) {
        var list = state.quests[period] && state.quests[period].list;
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var q = list[i];
          if (q.t !== kind || q.c) continue;
          if (q.track && trackId && q.track !== trackId) continue;
          if (q.track && !trackId) continue;
          q.p = def.mode === 'max' ? Math.max(q.p, value) : q.p + value;
          if (q.p > q.n) q.p = q.n;
        }
      }
    },

    done: function (q) { return q.p >= q.n; },

    /* Сколько заданий готово к получению награды. */
    ready: function (state) {
      var n = 0, self = this;
      if (!state.quests) return 0;
      for (var period in state.quests) {
        var list = state.quests[period] && state.quests[period].list;
        if (!list) continue;
        list.forEach(function (q) { if (!q.c && self.done(q)) n++; });
      }
      return n;
    },

    claim: function (state, period, index) {
      var list = state.quests[period] && state.quests[period].list;
      if (!list || !list[index]) return null;
      var q = list[index];
      if (q.c || !this.done(q)) return null;
      q.c = true;
      // радиовышка накидывает сверху
      var k = HC.Economy ? HC.Economy.questBonus(state) : 1;
      var rc = Math.round(q.rc * k), ro = Math.round(q.ro * k);
      state.coins += rc;
      state.ore += ro;
      state.stats.totalCoins += rc;
      return { coins: rc, ore: ro };
    },

    text: function (q) {
      var def = HC.QUEST_KINDS[q.t];
      if (!def) return '';
      var s = def.text.replace('{n}', HC.fmt(q.n));
      if (q.track) s = s.replace('{track}', (HC.TRACKS[q.track] || {}).name || q.track);
      return s;
    },

    progressText: function (q) {
      var p = Math.min(q.p, q.n);
      return HC.fmt(Math.floor(p)) + ' / ' + HC.fmt(q.n);
    }
  };
})(window.HC);
