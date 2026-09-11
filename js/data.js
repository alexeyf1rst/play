/* ============================================================
   Тихие холмы — данные и баланс.
   Всё, что можно крутить руками, лежит в этом файле.
   Правишь число -> перезагружаешь страницу -> играешь.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  HC.VERSION = '0.1.0';
  HC.SAVE_KEY = 'quiet-hills/save/v1';

  /* --- Физика мира --------------------------------------- */
  HC.WORLD = {
    gravity: 1750,     // px/с^2
    substeps: 8,       // шагов физики на кадр (больше = стабильнее)
    airControl: 20.0   // отзывчивость в воздухе (у каждой машины свой множитель airCtrl)
  };

  /* --- Машины -------------------------------------------
     body   — контур кузова в локальных координатах (x вправо, y вниз)
     axles  — куда крепятся колёса
     head   — голова водителя: коснулась земли -> заезд окончен
  */
  HC.VEHICLES = {
    jeep: {
      name: 'Джип', order: 0,
      about: 'Средний во всём: обычные колёса, обычная скорость. С него начинают.',
      price: 0, priceOre: 0,
      mass: 9, power: 15000, fuel: 100, burn: 2.5, topSpeed: 950, react: 1.00, airCtrl: 1.00,
      drive: 'all',
      wheel: { r: 21, mass: 1.5, grip: 1.00 },
      susp:  { rest: 26, min: 9, max: 44, sag: 9, damp: 0.55 },
      axles: [ { x: -35, y: 6 }, { x: 35, y: 6 } ],
      body:  [ [-48,-8], [-42,-24], [-6,-28], [8,-14], [50,-10], [50,12], [-48,12] ],
      head:  [ -18, -38 ]
    },
    scooter: {
      name: 'Скутер', order: 1,
      about: 'Маленькие колёса и лёгкая рама. Вертлявый и экономный, но каждая кочка — его враг.',
      price: 20000, priceOre: 0,
      mass: 4.6, power: 9000, fuel: 62, burn: 1.7, topSpeed: 820, react: 0.40, airCtrl: 1.85,
      drive: 'rear',
      wheel: { r: 14, mass: 0.8, grip: 0.90 },
      susp:  { rest: 22, min: 8, max: 38, sag: 7, damp: 0.58 },
      axles: [ { x: -31, y: 10 }, { x: 31, y: 10 } ],
      body:  [ [-30,-4], [-24,-18], [-6,-20], [4,-8], [26,-6], [30,2], [30,12], [-30,12] ],
      head:  [ -8, -34 ]
    },
    bolid: {
      name: 'Болид', order: 2,
      about: 'Длинный, низкий, очень быстрый. На ровном никто не догонит, на кочках цепляет днищем.',
      price: 95000, priceOre: 60,
      mass: 7.5, power: 21000, fuel: 125, burn: 3.1, topSpeed: 1500, react: 0.80, airCtrl: 1.25,
      drive: 'rear',
      wheel: { r: 16, mass: 1.1, grip: 1.28 },
      susp:  { rest: 18, min: 7, max: 30, sag: 6, damp: 0.70 },
      axles: [ { x: -48, y: 8 }, { x: 48, y: 8 } ],
      body:  [ [-64,0], [-58,-12], [-30,-14], [-14,-24], [6,-24], [16,-12], [64,-8], [66,4], [-64,8] ],
      head:  [ -4, -32 ]
    },
    truck: {
      name: 'Трак', order: 3,
      about: 'Огромные колёса переезжают то, обо что спотыкаются остальные. Тяжёлый и стойкий.',
      price: 300000, priceOre: 220,
      mass: 18, power: 27000, fuel: 190, burn: 3.8, topSpeed: 980, react: 0.90, airCtrl: 0.85,
      drive: 'all',
      wheel: { r: 36, mass: 3.1, grip: 1.32 },
      susp:  { rest: 36, min: 13, max: 64, sag: 10, damp: 0.60 },
      axles: [ { x: -44, y: -2 }, { x: 44, y: -2 } ],
      body:  [ [-52,-14], [-46,-38], [-6,-42], [8,-20], [54,-16], [54,8], [-52,8] ],
      head:  [ -24, -52 ]
    },
    rover: {
      name: 'Луноход', order: 4,
      about: 'Немного парит: в воздухе тянет вниз слабее, чем остальных. Липкое сцепление, долгие прыжки.',
      price: 700000, priceOre: 650,
      mass: 11, power: 17000, fuel: 210, burn: 2.7, topSpeed: 900, react: 1.00, airCtrl: 1.15,
      drive: 'all', lift: 0.38,
      wheel: { r: 30, mass: 2.0, grip: 1.45 },
      susp:  { rest: 38, min: 14, max: 64, sag: 12, damp: 0.55 },
      axles: [ { x: -42, y: 2 }, { x: 42, y: 2 } ],
      body:  [ [-50,-6], [-44,-26], [-4,-30], [10,-16], [52,-12], [52,10], [-50,10] ],
      head:  [ -20, -40 ]
    }
  };

  /* --- Маршруты ------------------------------------------
     amp/freq/rough — форма холмов, gravity — своя гравитация,
     coinRate — как густо лежат монеты, payout — множитель награды
  */
  HC.TRACKS = {
    hills: {
      name: 'Холмы', order: 0, unlock: null,
      about: 'Мягкие волны и трамплины. Место, где учатся.',
      amp: 150, len: 620, rough: 0.45, gravity: 1350,
      grip: 1.00, roll: 1.00,
      coinRate: 1.00, oreRate: 0.10, payout: 1.00,
      goals: [ 500, 1200, 2200 ]
    },
    sand: {
      name: 'Песочница', order: 1, unlock: 'hills',
      about: 'Песок вязкий: колёса буксуют, разгон тонет. Зато платят больше.',
      amp: 130, len: 900, rough: 0.35, gravity: 1330,
      grip: 0.62, roll: 2.6,
      coinRate: 1.10, oreRate: 0.14, payout: 1.35,
      goals: [ 400, 900, 1700 ]
    },
    highway: {
      name: 'Хайвэй', order: 2, unlock: 'sand',
      about: 'Гладкое покрытие и длинные пологие волны. Здесь решает скорость.',
      amp: 95, len: 1300, rough: 0.18, gravity: 1330,
      grip: 1.20, roll: 0.60,
      coinRate: 1.00, oreRate: 0.08, payout: 1.60,
      goals: [ 900, 2000, 3600 ]
    },
    moon: {
      name: 'Луна', order: 3, unlock: 'highway',
      about: 'Гравитация вполсилы. Прыжки длинные, времени на сальто вагон.',
      amp: 160, len: 900, rough: 0.40, gravity: 520,
      grip: 0.90, roll: 0.90,
      coinRate: 1.05, oreRate: 0.40, payout: 2.10,
      goals: [ 550, 1300, 2400 ]
    },
    forest: {
      name: 'Лес', order: 4, unlock: 'moon',
      about: 'Деревья стоят прямо на дороге. Снести можно, но машина теряет ход.',
      amp: 160, len: 700, rough: 0.50, gravity: 1350,
      grip: 1.05, roll: 1.10,
      coinRate: 1.15, oreRate: 0.30, payout: 2.60,
      goals: [ 550, 1300, 2300 ],
      trees: true
    }
  };

  /* Медали за расстояние: бронза открывает следующую трассу. */
  HC.MEDALS = [
    { key: 'bronze', name: 'Бронза', idx: 0 },
    { key: 'silver', name: 'Серебро', idx: 1 },
    { key: 'gold',   name: 'Золото', idx: 2 }
  ];
  /* Трасса открыта, если на предыдущей взята хотя бы бронза. */
  HC.trackOpen = function (state, id) {
    var t = HC.TRACKS[id];
    if (!t) return false;
    if (!t.unlock) return true;
    var best = (state.stats && state.stats.best && state.stats.best[t.unlock]) || 0;
    return HC.medalFor(t.unlock, best) >= 0;
  };

  HC.medalFor = function (trackId, dist) {
    var t = HC.TRACKS[trackId];
    if (!t) return -1;
    var m = -1;
    for (var i = 0; i < t.goals.length; i++) if (dist >= t.goals[i]) m = i;
    return m;
  };

  /* --- Тюнинг ---------------------------------------------
     Это не покупается: крути сколько хочешь, бесплатно и в любой момент.
     Каждый ползунок — настоящий множитель в физике, а не косметика.
  */
  HC.TUNING = {
    gear: {
      name: 'Передача', min: 0.70, max: 1.40, def: 1, step: 0.05,
      low: 'короткая', high: 'длинная',
      about: 'Короткая — резче со старта и лучше в гору. Длинная — выше скорость на равнине.'
    },
    stiff: {
      name: 'Жёсткость подвески', min: 0.60, max: 1.70, def: 1, step: 0.05,
      low: 'мягкая', high: 'жёсткая',
      about: 'Мягкая глотает кочки и мягче садится. Жёсткая точнее держит и меньше раскачивает.'
    },
    travel: {
      name: 'Ход подвески', min: 0.70, max: 1.50, def: 1, step: 0.05,
      low: 'короткий', high: 'длинный',
      about: 'Длинный ход прощает жёсткие приземления, но машина становится валкой.'
    },
    press: {
      name: 'Давление в шинах', min: 0.70, max: 1.30, def: 1, step: 0.05,
      low: '低'.replace('低', 'низкое'), high: 'высокое',
      about: 'Низкое — больше сцепления, но колёса хуже катятся. Высокое — наоборот.'
    },
    balance: {
      name: 'Развесовка', min: -1, max: 1, def: 0, step: 0.1,
      low: 'вперёд', high: 'назад',
      about: 'Назад — легче поднимается в гору и охотнее встаёт на дыбы. Вперёд — устойчивее.'
    },
    air: {
      name: 'Управление в полёте', min: 0.50, max: 1.80, def: 1, step: 0.05,
      low: 'вялое', high: 'резкое',
      about: 'Насколько быстро машина крутится в воздухе от газа и тормоза.'
    }
  };

  HC.DRIVE = {
    all:   { name: 'Полный',  about: 'Тяга на все колёса: лучше держит, спокойнее.' },
    rear:  { name: 'Задний',  about: 'Только задние: охотнее встаёт на дыбы.' },
    front: { name: 'Передний', about: 'Только передние: тянет машину носом, реже опрокидывает.' }
  };

  HC.defaultTune = function (vid) {
    var t = {};
    for (var k in HC.TUNING) t[k] = HC.TUNING[k].def;
    t.drive = (HC.VEHICLES[vid] && HC.VEHICLES[vid].drive) || 'all';
    return t;
  };

  /* --- Гараж: прокачка машины ----------------------------
     cost(l) = base * mult^l  (l — текущий уровень, с нуля)
     effect  — прибавка за уровень
  */
  HC.UPGRADES = {
    engine:  { name: 'Двигатель',  max: 15, base: 1000, mult: 1.42, ore: 0,    oreFrom: 8,  oreBase: 6,
               about: 'Тяга. Больше тяги — легче в гору, но легче и на спину.' },
    tires:   { name: 'Шины',       max: 15, base: 850,  mult: 1.40, ore: 0,    oreFrom: 8,  oreBase: 5,
               about: 'Сцепление с землёй. Меньше пробуксовки.' },
    susp:    { name: 'Подвеска',   max: 15, base: 1100, mult: 1.41, ore: 0,    oreFrom: 8,  oreBase: 6,
               about: 'Мягче приземления, реже кувырки.' },
    fuel:    { name: 'Бак',        max: 15, base: 900,  mult: 1.38, ore: 0,    oreFrom: 9,  oreBase: 5,
               about: 'Дольше едешь — дальше уезжаешь.' },
    magnet:  { name: 'Магнит',     max: 10, base: 2700, mult: 1.55, ore: 0,    oreFrom: 4,  oreBase: 8,
               about: 'Притягивает монеты. Меньше нужно целиться.' }
  };

  // Во что превращается уровень прокачки
  HC.upgradeEffect = {
    engine: function (l) { return 1 + l * 0.055; },   // множитель тяги
    tires:  function (l) { return 1 + l * 0.055; },   // множитель сцепления
    susp:   function (l) { return 1 + l * 0.060; },   // жёсткость/демпфер
    fuel:   function (l) { return 1 + l * 0.110; },   // множитель бака
    magnet: function (l) { return l === 0 ? 0 : 40 + l * 26; } // радиус притяжения, px
  };

  /* --- База: постройки -----------------------------------
     rate — за минуту на первом уровне, растёт как rate * rateMult^l
  */
  HC.BUILDINGS = {
    mine: {
      name: 'Шахта', icon: 'mine', max: 12,
      cost: 1100, costMult: 1.62, ore: 0, oreMult: 1.5, oreFrom: 6, oreBase: 8,
      about: 'Тихо стучит внутри холма и приносит монеты.',
      rate: 90, rateMult: 1.44, res: 'coins'
    },
    drill: {
      name: 'Бур', icon: 'drill', max: 12,
      cost: 8000, costMult: 1.66, ore: 10, oreMult: 1.52, oreFrom: 1, oreBase: 10,
      about: 'Достаёт руду с глубины. Руда нужна для серьёзных вещей.',
      rate: 0.9, rateMult: 1.40, res: 'ore'
    },
    storage: {
      name: 'Склад', icon: 'storage', max: 12,
      cost: 1800, costMult: 1.58, ore: 0, oreMult: 1.5, oreFrom: 7, oreBase: 6,
      about: 'Сколько добра накопится, пока тебя нет.',
      capCoins: 4000, capOre: 45, capMult: 1.55
    },
    windmill: {
      name: 'Ветряк', icon: 'windmill', max: 10,
      cost: 5400, costMult: 1.70, ore: 4, oreMult: 1.55, oreFrom: 3, oreBase: 6,
      about: 'Крутится медленно. Ускоряет всё вокруг.',
      bonus: 0.10   // +10% ко всей добыче за уровень
    },
    workshop: {
      name: 'Мастерская', icon: 'workshop', max: 10,
      cost: 6800, costMult: 1.72, ore: 6, oreMult: 1.55, oreFrom: 2, oreBase: 8,
      about: 'Скидка на прокачку машины и больше монет с заездов.',
      discount: 0.03, // -3% к цене прокачки за уровень
      ridebonus: 0.06 // +6% монет с заезда за уровень
    },
    garden: {
      name: 'Сад', icon: 'garden', max: 8,
      cost: 4000, costMult: 1.66, ore: 0, oreMult: 1.5, oreFrom: 5, oreBase: 5,
      about: 'Ничего не производит. Просто держит время дольше.',
      offline: 1.5   // +1.5 часа к копилке офлайна за уровень
    }
  };

  /* --- Участки под постройки ------------------------------ */
  HC.PLOTS = {
    free: 4,          // открыто с самого начала
    cost: 3600,       // цена следующего участка
    mult: 1.85,
    // x на виртуальном поле и план долины: 0 — передний, 2 — дальний.
    // Чем дальше план, тем выше на экране и мельче постройка.
    spots: [
      { x: 300, row: 0 }, { x: 490, row: 0 }, { x: 680, row: 0 }, { x: 870, row: 0 },
      { x: 395, row: 1 }, { x: 585, row: 1 }, { x: 775, row: 1 }, { x: 965, row: 1 },
      { x: 330, row: 2 }, { x: 520, row: 2 }, { x: 710, row: 2 }, { x: 900, row: 2 }
    ]
  };

  /* --- Прочая экономика ----------------------------------- */
  HC.ECON = {
    coinPickup: 10,       // монет за монетку у старта
    coinPer100: 5,        // и ещё столько же за каждые пройденные 100 м
    orePickup: 1,          // руды за один камень
    fuelPickup: 0.38,      // доля бака за канистру
    distancePer100: 5,     // монет за каждые 100 м
    recordBonus: 0.5,      // доля сверху за новый рекорд
    flipCoins: 110,        // за первое сальто в прыжке; второе дороже вдвое и т.д.
    airBonus: 55,          // за каждую секунду в воздухе, если прыжок был долгий
    airMin: 1.1,           // с какого времени полёта идёт награда
    offlineHoursBase: 4,   // базовый потолок офлайн-копилки
    startCoins: 0
  };

  /* --- Утилиты цены --------------------------------------- */
  HC.costOf = function (def, level) {
    return Math.round(def.cost * Math.pow(def.costMult, level));
  };
  HC.oreCostOf = function (def, level) {
    if (level + 1 < (def.oreFrom || 0)) return 0;
    var base = def.oreBase || 0;
    if (!base) return 0;
    var step = (level + 1) - (def.oreFrom || 0);
    return Math.round(base * Math.pow(def.oreMult || 1.5, step));
  };
  HC.upCostOf = function (def, level, discount) {
    var c = def.base * Math.pow(def.mult, level);
    return Math.max(1, Math.round(c * (1 - (discount || 0))));
  };
  HC.upOreCostOf = function (def, level) {
    if (level + 1 < (def.oreFrom || 0)) return 0;
    var step = (level + 1) - def.oreFrom;
    return Math.round((def.oreBase || 0) * Math.pow(1.45, step));
  };

  /* --- Форматирование чисел ------------------------------- */
  HC.fmt = function (n) {
    n = Math.floor(n);
    if (n < 10000) return String(n);
    if (n < 1e6) return (n / 1000).toFixed(n < 1e5 ? 1 : 0).replace('.0', '') + 'K';
    if (n < 1e9) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
    return (n / 1e9).toFixed(1).replace('.0', '') + 'B';
  };
  HC.fmt1 = function (n) {
    return (Math.round(n * 10) / 10).toString();
  };
  HC.fmtTime = function (sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (h) return h + ' ч ' + m + ' мин';
    if (m) return m + ' мин ' + s + ' с';
    return s + ' с';
  };
})(window.HC);
