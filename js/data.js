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

     Скорости здесь вдвое ниже прежних: игра не про то, чтобы
     пролетать холмы, а про то, чтобы их переезжать. Тяга при этом
     осталась прежней — иначе машина перестала бы залезать в гору,
     а замедлить хотелось не это.
  */
  HC.VEHICLES = {
    jeep: {
      name: 'Джип', order: 0,
      about: 'Средний во всём: обычные колёса, обычная скорость. С него начинают.',
      price: 0, priceOre: 0,
      mass: 9, power: 15000, fuel: 100, burn: 2.5, topSpeed: 475, react: 1.00, airCtrl: 1.00,
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
      price: 260000, priceOre: 0,
      mass: 4.6, power: 9000, fuel: 62, burn: 1.7, topSpeed: 410, react: 0.40, airCtrl: 1.85,
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
      price: 1500000, priceOre: 90,
      mass: 7.5, power: 21000, fuel: 125, burn: 3.1, topSpeed: 750, react: 0.80, airCtrl: 1.25,
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
      price: 4800000, priceOre: 340,
      mass: 18, power: 27000, fuel: 190, burn: 3.8, topSpeed: 490, react: 0.90, airCtrl: 0.85,
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
      price: 11000000, priceOre: 1000,
      mass: 11, power: 17000, fuel: 210, burn: 2.7, topSpeed: 450, react: 1.00, airCtrl: 1.15,
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
     far    — что стоит силуэтами на дальней гряде
     feats  — какие фигуры попадаются именно здесь
  */
  HC.TRACKS = {
    hills: {
      name: 'Холмы', order: 0, unlock: null,
      about: 'Мягкие волны и трамплины. Место, где учатся.',
      amp: 200, len: 620, rough: 0.64, gravity: 1350,
      grip: 1.00, roll: 1.00,
      coinRate: 1.00, oreRate: 0.10, payout: 1.00,
      far: ['pine', 'tree'],
      goals: [ 300, 700, 1200 ]
    },
    sand: {
      name: 'Песочница', order: 1, unlock: 'hills',
      about: 'Дюны с крутым сыпучим склоном. В рыхлых пятнах колёса проваливаются: стоять нельзя.',
      amp: 165, len: 900, rough: 0.46, gravity: 1330,
      grip: 0.62, roll: 2.6,
      coinRate: 1.10, oreRate: 0.14, payout: 1.35,
      far: ['cactus', 'rock'],
      dunes: 1, soft: 1,
      goals: [ 250, 600, 1100 ]
    },
    highway: {
      name: 'Хайвэй', order: 2, unlock: 'sand',
      about: 'Асфальт, разметка и отбойник. Ровно, быстро — и падать тут не на песок.',
      amp: 155, len: 1600, rough: 0.40, gravity: 1330,
      grip: 1.20, roll: 0.60,
      coinRate: 1.00, oreRate: 0.08, payout: 1.60,
      far: ['pole', 'lamp', 'tower'],
      road: 1, rail: 1, pylons: 1, featAmp: 2.2,
      feats: { ramp: 0.44, table: 0.38, bumps: 0.18 },
      goals: [ 400, 900, 1600 ]
    },
    moon: {
      name: 'Луна', order: 3, unlock: 'highway',
      about: 'Гравитация вполсилы. Прыжки длинные, времени на сальто вагон.',
      amp: 235, len: 900, rough: 0.70, gravity: 520,
      grip: 0.90, roll: 0.90, featAmp: 0.8,
      coinRate: 1.05, oreRate: 0.40, payout: 2.10,
      far: ['rock'],
      goals: [ 400, 850, 1500 ]
    },
    forest: {
      name: 'Лес', order: 4, unlock: 'moon',
      about: 'Деревья стоят прямо на дороге. Сбить можно — только ствол потом лежит поперёк, и через него надо переползать.',
      amp: 200, len: 700, rough: 0.66, gravity: 1350,
      grip: 1.05, roll: 1.10,
      coinRate: 1.15, oreRate: 0.30, payout: 2.60,
      far: ['pine', 'tree'],
      goals: [ 250, 650, 1200 ],
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

  /* Темы: две тихие и одна цветная — чтобы было что показать */
  HC.THEME_NAMES = { paper: 'Бумага', dark: 'Тёмная', color: 'Цветная' };

  HC.DRIVE = {
    all:   { name: 'Полный',  about: 'Тяга на все колёса: лучше держит, спокойнее.' },
    rear:  { name: 'Задний',  about: 'Только задние: охотнее встаёт на дыбы.' },
    front: { name: 'Передний', about: 'Только передние: тянет машину носом, реже опрокидывает.' }
  };

  /* --- Гараж: прокачка машины ----------------------------
     cost(l) = base * mult^l  (l — текущий уровень, с нуля)
     effect  — прибавка за уровень
  */
  HC.UPGRADES = {
    engine:  { name: 'Двигатель',  max: 15, base: 14500, mult: 1.46, ore: 0,    oreFrom: 8,  oreBase: 9,
               about: 'Тяга и предел скорости. На максимуме машина вдвое сильнее и вдвое быстрее.' },
    tires:   { name: 'Шины',       max: 15, base: 12500, mult: 1.44, ore: 0,    oreFrom: 8,  oreBase: 8,
               about: 'Сцепление с землёй. На максимуме держит вдвое лучше.' },
    susp:    { name: 'Подвеска',   max: 15, base: 16000, mult: 1.45, ore: 0,    oreFrom: 8,  oreBase: 9,
               about: 'Мягче приземления, реже кувырки. На максимуме вдвое спокойнее.' },
    fuel:    { name: 'Бак',        max: 15, base: 13500, mult: 1.42, ore: 0,    oreFrom: 9,  oreBase: 8,
               about: 'Дольше едешь — дальше уезжаешь. На максимуме бак вдвое больше.' }
  };

  /* Во что превращается уровень прокачки.
     Правило простое: на максимуме ровно вдвое больше, чем на нуле. */
  function twice(key) {
    return function (l) { return 1 + l / HC.UPGRADES[key].max; };
  }
  HC.upgradeEffect = {
    engine: twice('engine'),   // тяга и предел скорости
    tires:  twice('tires'),    // сцепление
    susp:   twice('susp'),     // мягкость подвески
    fuel:   twice('fuel')      // объём бака
  };

  /* --- База: постройки -----------------------------------
     rate  — за минуту на первом уровне, растёт как rate * rateMult^l
     build — сколько секунд идёт стройка первого уровня,
             каждый следующий дольше в buildMult раз
  */
  HC.BUILDINGS = {
    mine: {
      name: 'Шахта', icon: 'mine', limit: 6, max: 12,
      cost: 16500, costMult: 1.68, ore: 0, oreMult: 1.5, oreFrom: 6, oreBase: 12,
      about: 'Тихо стучит внутри холма и приносит монеты.',
      rate: 5.4, rateMult: 1.40, res: 'coins',
      build: 450, buildMult: 1.62
    },
    drill: {
      name: 'Бур', icon: 'drill', limit: 3, max: 12,
      cost: 120000, costMult: 1.72, ore: 14, oreMult: 1.52, oreFrom: 1, oreBase: 14,
      about: 'Достаёт руду с глубины. Руда нужна для серьёзных вещей.',
      rate: 0.52, rateMult: 1.36, res: 'ore',
      build: 1500, buildMult: 1.60
    },
    storage: {
      name: 'Склад', icon: 'storage', limit: 3, max: 12,
      cost: 27000, costMult: 1.64, ore: 0, oreMult: 1.5, oreFrom: 7, oreBase: 9,
      about: 'Сколько добра накопится, пока тебя нет.',
      capCoins: 340, capOre: 38, capMult: 1.52,
      build: 700, buildMult: 1.58
    },
    windmill: {
      name: 'Ветряк', icon: 'windmill', limit: 2, max: 10,
      cost: 81000, costMult: 1.76, ore: 6, oreMult: 1.55, oreFrom: 3, oreBase: 9,
      about: 'Крутится медленно. Ускоряет всё вокруг.',
      bonus: 0.08,   // +8% ко всей добыче за уровень
      build: 2000, buildMult: 1.60
    },
    workshop: {
      name: 'Мастерская', icon: 'workshop', limit: 1, max: 10,
      cost: 102000, costMult: 1.78, ore: 9, oreMult: 1.55, oreFrom: 2, oreBase: 12,
      about: 'Скидка на прокачку машины и больше монет с заездов.',
      discount: 0.025, // −2.5% к цене прокачки за уровень
      ridebonus: 0.05, // +5% монет с заезда за уровень
      build: 2400, buildMult: 1.62
    },
    garden: {
      name: 'Сад', icon: 'garden', limit: 3, max: 8,
      cost: 60000, costMult: 1.70, ore: 0, oreMult: 1.5, oreFrom: 5, oreBase: 8,
      about: 'Ничего не производит. Просто держит время дольше.',
      offline: 1.2,   // +1.2 часа к копилке офлайна за уровень
      build: 1100, buildMult: 1.58
    },
    smelter: {
      name: 'Плавильня', icon: 'smelter', limit: 2, max: 10,
      cost: 54000, costMult: 1.68, ore: 9, oreMult: 1.5, oreFrom: 2, oreBase: 12,
      about: 'Переплавляет свежую руду в монеты. Без буров стоит холодная.',
      melt: 30, meltMult: 1.40, eats: 0.5,   // монет/мин и руды/мин за уровень
      build: 1600, buildMult: 1.60
    },
    garage: {
      name: 'Гараж', icon: 'carport', limit: 1, max: 10,
      cost: 78000, costMult: 1.56, ore: 6, oreMult: 1.5, oreFrom: 3, oreBase: 9,
      about: 'Машина ночует под крышей: бак больше, расход меньше.',
      fuel: 0.05, burn: 0.02,   // +5% к баку и −2% расхода за уровень
      build: 1800, buildMult: 1.56
    },
    radio: {
      name: 'Радиовышка', icon: 'radio', limit: 1, max: 8,
      cost: 105000, costMult: 1.60, ore: 8, oreMult: 1.5, oreFrom: 2, oreBase: 11,
      about: 'Ловит заказы издалека — за задания платят больше.',
      questBonus: 0.08,   // +8% к наградам заданий за уровень
      build: 2600, buildMult: 1.58
    },
    depot: {
      name: 'Депо', icon: 'depot', limit: 1, max: 8,
      cost: 90000, costMult: 1.56, ore: 9, oreMult: 1.5, oreFrom: 2, oreBase: 12,
      about: 'Свозит добычу на склад само, пока игра открыта.',
      auto: 16,   // автосбор раз в 16/уровень минут
      build: 2200, buildMult: 1.56
    }
  };

  /* --- Участки под постройки ------------------------------ */
  HC.PLOTS = {
    free: 4,          // открыто с самого начала
    cost: 50000,      // цена следующего участка
    mult: 1.60,
    // Площадки на изометрической сетке: gx/gy — левый верхний угол участка
    // (участок занимает 2×2 плитки). Первые открытые стоят у въезда, дальше
    // база разрастается вглубь.
    spots: [
      { gx: 16, gy: 10 }, { gx: 16, gy: 7 }, { gx: 13, gy: 10 }, { gx: 16, gy: 4 },
      { gx: 13, gy: 7 }, { gx: 10, gy: 10 }, { gx: 16, gy: 1 }, { gx: 13, gy: 4 },
      { gx: 10, gy: 7 }, { gx: 7, gy: 10 }, { gx: 13, gy: 1 }, { gx: 10, gy: 4 },
      { gx: 7, gy: 7 }, { gx: 4, gy: 10 }, { gx: 10, gy: 1 }, { gx: 7, gy: 4 },
      { gx: 4, gy: 7 }, { gx: 1, gy: 10 }, { gx: 7, gy: 1 }, { gx: 4, gy: 4 },
      { gx: 1, gy: 7 }, { gx: 4, gy: 1 }, { gx: 1, gy: 4 }, { gx: 1, gy: 1 }
    ]
  };

  /* --- Прочая экономика ----------------------------------- */
  HC.ECON = {
    coinPickup: 1,         // монет за монетку у старта
    coinPer100: 0.2,       // и ещё столько же за каждые пройденные 100 м
    coinPer100Max: 25,     // но не бесконечно: дальше монетка не дорожает
    orePickup: 1,          // руды за один камень
    fuelPickup: 0.16,      // доля бака за канистру
    coinEvery: 100,        // монетки лежат примерно через столько метров
    distancePer100: 0.3,   // монет за каждые 100 м
    recordBonus: 0.35,     // доля сверху за новый рекорд
    flipCoins: 7,          // за первое сальто в прыжке; второе дороже вдвое и т.д.
    flipPart: 0.8,         // сальто засчитывается, когда докрутил столько оборота
    airBonus: 3,           // за каждую секунду в воздухе, если прыжок был долгий
    airMin: 1.1,           // с какого времени полёта идёт награда
    kmBonus: 6,            // за каждый километр: 6, 12, 18... — за риск
    rushOrePerMin: 1,      // руды за минуту, которую снимаем со стройки
    offlineHoursBase: 3,   // базовый потолок офлайн-копилки
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
  /* Сколько секунд идёт стройка до уровня level (1 — первая постройка) */
  HC.buildTimeOf = function (def, level) {
    if (!def.build) return 0;
    return Math.round(def.build * Math.pow(def.buildMult || 1.5, Math.max(0, level - 1)));
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
  /* Коротко, для таймера стройки: 1:05:09 / 5:09 / 9 с */
  HC.fmtLeft = function (sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    if (h) return h + ':' + p(m) + ':' + p(s);
    if (m) return m + ':' + p(s);
    return s + ' с';
  };
})(window.HC);
