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
    airControl: 2.6    // управление в полёте
  };

  /* --- Машины -------------------------------------------
     body   — контур кузова в локальных координатах (x вправо, y вниз)
     axles  — куда крепятся колёса
     head   — голова водителя: коснулась земли -> заезд окончен
  */
  HC.VEHICLES = {
    jeep: {
      name: 'Джип', order: 0,
      about: 'Спокойный универсал. Ничего лишнего.',
      price: 0, priceOre: 0,
      mass: 9, power: 15000, fuel: 100, burn: 2.5, topSpeed: 900, react: 1.00,
      drive: 'all',
      wheel: { r: 21, mass: 1.5, grip: 1.00 },
      susp:  { rest: 26, min: 9, max: 44, sag: 9, damp: 0.55 },
      axles: [ { x: -35, y: 6 }, { x: 35, y: 6 } ],
      body:  [ [-48,-8], [-42,-24], [-6,-28], [8,-14], [50,-10], [50,12], [-48,12] ],
      head:  [ -18, -38 ]
    },
    bike: {
      name: 'Мотоцикл', order: 1,
      about: 'Лёгкий и вертлявый. Легко встаёт на дыбы.',
      price: 3500, priceOre: 0,
      mass: 5.2, power: 9800, fuel: 70, burn: 1.9, topSpeed: 1020, react: 1.15,
      drive: 'rear',
      wheel: { r: 24, mass: 1.1, grip: 0.92 },
      susp:  { rest: 30, min: 11, max: 54, sag: 11, damp: 0.50 },
      axles: [ { x: -32, y: 4 }, { x: 32, y: 4 } ],
      body:  [ [-36,-6], [-16,-16], [6,-16], [22,-4], [36,-2], [36,8], [-36,8] ],
      head:  [ -6, -34 ]
    },
    buggy: {
      name: 'Багги', order: 2,
      about: 'Открытая рама и длинные рычаги. Прыгает охотно, садится мягко.',
      price: 9000, priceOre: 0,
      mass: 6.4, power: 12200, fuel: 85, burn: 2.3, topSpeed: 1080, react: 1.20,
      drive: 'rear',
      wheel: { r: 23, mass: 1.3, grip: 1.05 },
      susp:  { rest: 34, min: 12, max: 66, sag: 13, damp: 0.46 },
      axles: [ { x: -38, y: 2 }, { x: 38, y: 2 } ],
      body:  [ [-44,-4], [-38,-22], [-14,-30], [2,-14], [30,-12], [44,-4], [44,8], [-44,8] ],
      head:  [ -16, -40 ]
    },
    truck: {
      name: 'Грузовик', order: 3,
      about: 'Тяжёлый и упрямый. Держит горку и везёт много топлива.',
      price: 18000, priceOre: 40,
      mass: 15, power: 27000, fuel: 165, burn: 3.6, topSpeed: 820, react: 0.85,
      drive: 'rear',
      wheel: { r: 26, mass: 2.6, grip: 1.12 },
      susp:  { rest: 30, min: 11, max: 48, sag: 8, damp: 0.62 },
      axles: [ { x: -46, y: 8 }, { x: 46, y: 8 } ],
      body:  [ [-62,-10], [-56,-34], [-20,-38], [-8,-16], [62,-14], [62,14], [-62,14] ],
      head:  [ -34, -48 ]
    },
    tractor: {
      name: 'Трактор', order: 4,
      about: 'Огромное заднее колесо и вечная первая передача. Вползёт куда угодно.',
      price: 34000, priceOre: 90,
      mass: 13, power: 24000, fuel: 140, burn: 3.2, topSpeed: 700, react: 1.10,
      drive: 'rear',
      wheel: { r: 34, mass: 2.4, grip: 1.40 },
      susp:  { rest: 24, min: 9, max: 40, sag: 7, damp: 0.66 },
      axles: [ { x: -34, y: 2, r: 34 }, { x: 40, y: 12, r: 17, mass: 1.2 } ],
      body:  [ [-52,-6], [-46,-42], [-14,-46], [-8,-20], [48,-16], [48,10], [-52,10] ],
      head:  [ -30, -56 ]
    },
    monster: {
      name: 'Монстр-трак', order: 5,
      about: 'Колёса выше кузова. Переезжает холмы, вместо того чтобы их объезжать.',
      price: 60000, priceOre: 200,
      mass: 17, power: 34000, fuel: 180, burn: 4.0, topSpeed: 950, react: 0.95,
      drive: 'all',
      wheel: { r: 35, mass: 3.0, grip: 1.22 },
      susp:  { rest: 36, min: 13, max: 62, sag: 10, damp: 0.58 },
      axles: [ { x: -42, y: -2 }, { x: 42, y: -2 } ],
      body:  [ [-50,-14], [-44,-36], [-6,-40], [8,-20], [52,-16], [52,8], [-50,8] ],
      head:  [ -24, -50 ]
    },
    rover: {
      name: 'Луноход', order: 6,
      about: 'Липкий ход и почти неубиваемая подвеска. Едет там, где не едет никто.',
      price: 95000, priceOre: 350,
      mass: 11, power: 20000, fuel: 200, burn: 3.0, topSpeed: 880, react: 1.00,
      drive: 'all',
      wheel: { r: 33, mass: 2.0, grip: 1.35 },
      susp:  { rest: 38, min: 14, max: 64, sag: 12, damp: 0.55 },
      axles: [ { x: -42, y: 2 }, { x: 42, y: 2 } ],
      body:  [ [-50,-6], [-44,-26], [-4,-30], [10,-16], [52,-12], [52,10], [-50,10] ],
      head:  [ -20, -40 ]
    },
    crawler: {
      name: 'Вездеход 6×6', order: 7,
      about: 'Три оси и полный привод. Самый спокойный способ уехать далеко.',
      price: 150000, priceOre: 700,
      mass: 19, power: 33000, fuel: 240, burn: 3.4, topSpeed: 780, react: 0.75,
      drive: 'all',
      wheel: { r: 22, mass: 1.9, grip: 1.30 },
      susp:  { rest: 28, min: 10, max: 50, sag: 9, damp: 0.60 },
      axles: [ { x: -54, y: 8 }, { x: 0, y: 8 }, { x: 54, y: 8 } ],
      body:  [ [-70,-10], [-64,-32], [-22,-36], [-10,-16], [70,-12], [70,12], [-70,12] ],
      head:  [ -40, -46 ]
    }
  };

  /* --- Маршруты ------------------------------------------
     amp/freq/rough — форма холмов, gravity — своя гравитация,
     coinRate — как густо лежат монеты, payout — множитель награды
  */
  HC.TRACKS = {
    hills: {
      name: 'Холмы', order: 0, price: 0, priceOre: 0,
      about: 'Мягкие волны. Место, куда возвращаются.',
      amp: 150, len: 620, rough: 0.45, gravity: 1750,
      coinRate: 1.00, oreRate: 0.10, payout: 1.00
    },
    dunes: {
      name: 'Дюны', order: 1, price: 2500, priceOre: 0,
      about: 'Длинные пологие спуски. Топливо тает медленно.',
      amp: 120, len: 950, rough: 0.30, gravity: 1750,
      coinRate: 1.15, oreRate: 0.12, payout: 1.25
    },
    ridge: {
      name: 'Хребет', order: 2, price: 9000, priceOre: 25,
      about: 'Круто вверх, круто вниз. Требует терпения.',
      amp: 220, len: 950, rough: 0.70, gravity: 1800,
      coinRate: 0.95, oreRate: 0.28, payout: 1.75
    },
    moon: {
      name: 'Луна', order: 3, price: 30000, priceOre: 150,
      about: 'Гравитация вполсилы. Долгие тихие прыжки.',
      amp: 200, len: 800, rough: 0.45, gravity: 620,
      coinRate: 1.05, oreRate: 0.40, payout: 2.40
    }
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
    engine:  { name: 'Двигатель',  max: 15, base: 220,  mult: 1.42, ore: 0,    oreFrom: 8,  oreBase: 6,
               about: 'Тяга. Больше тяги — легче в гору, но легче и на спину.' },
    tires:   { name: 'Шины',       max: 15, base: 190,  mult: 1.40, ore: 0,    oreFrom: 8,  oreBase: 5,
               about: 'Сцепление с землёй. Меньше пробуксовки.' },
    susp:    { name: 'Подвеска',   max: 15, base: 240,  mult: 1.41, ore: 0,    oreFrom: 8,  oreBase: 6,
               about: 'Мягче приземления, реже кувырки.' },
    fuel:    { name: 'Бак',        max: 15, base: 200,  mult: 1.38, ore: 0,    oreFrom: 9,  oreBase: 5,
               about: 'Дольше едешь — дальше уезжаешь.' },
    magnet:  { name: 'Магнит',     max: 10, base: 600,  mult: 1.55, ore: 0,    oreFrom: 4,  oreBase: 8,
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
      cost: 250, costMult: 1.62, ore: 0, oreMult: 1.5, oreFrom: 6, oreBase: 8,
      about: 'Тихо стучит внутри холма и приносит монеты.',
      rate: 20, rateMult: 1.44, res: 'coins'
    },
    drill: {
      name: 'Бур', icon: 'drill', max: 12,
      cost: 1800, costMult: 1.66, ore: 10, oreMult: 1.52, oreFrom: 1, oreBase: 10,
      about: 'Достаёт руду с глубины. Руда нужна для серьёзных вещей.',
      rate: 0.9, rateMult: 1.40, res: 'ore'
    },
    storage: {
      name: 'Склад', icon: 'storage', max: 12,
      cost: 400, costMult: 1.58, ore: 0, oreMult: 1.5, oreFrom: 7, oreBase: 6,
      about: 'Сколько добра накопится, пока тебя нет.',
      capCoins: 900, capOre: 45, capMult: 1.55
    },
    windmill: {
      name: 'Ветряк', icon: 'windmill', max: 10,
      cost: 1200, costMult: 1.70, ore: 4, oreMult: 1.55, oreFrom: 3, oreBase: 6,
      about: 'Крутится медленно. Ускоряет всё вокруг.',
      bonus: 0.10   // +10% ко всей добыче за уровень
    },
    workshop: {
      name: 'Мастерская', icon: 'workshop', max: 10,
      cost: 1500, costMult: 1.72, ore: 6, oreMult: 1.55, oreFrom: 2, oreBase: 8,
      about: 'Скидка на прокачку машины и больше монет с заездов.',
      discount: 0.03, // -3% к цене прокачки за уровень
      ridebonus: 0.06 // +6% монет с заезда за уровень
    },
    garden: {
      name: 'Сад', icon: 'garden', max: 8,
      cost: 900, costMult: 1.66, ore: 0, oreMult: 1.5, oreFrom: 5, oreBase: 5,
      about: 'Ничего не производит. Просто держит время дольше.',
      offline: 1.5   // +1.5 часа к копилке офлайна за уровень
    }
  };

  /* --- Участки под постройки ------------------------------ */
  HC.PLOTS = {
    free: 4,          // открыто с самого начала
    cost: 800,        // цена следующего участка
    mult: 1.85,
    // x на виртуальном поле и ярус долины (0 — ближний, 1 — верхняя терраса).
    // Высоту участка считает сцена, чтобы постройки стояли ровно на земле.
    spots: [
      { x: 330, row: 0 }, { x: 520, row: 0 }, { x: 710, row: 0 }, { x: 900, row: 0 },
      { x: 140, row: 0 }, { x: 1090, row: 0 },
      { x: 360, row: 1 }, { x: 530, row: 1 }, { x: 700, row: 1 }, { x: 870, row: 1 },
      { x: 190, row: 1 }, { x: 1040, row: 1 }
    ]
  };

  /* --- Прочая экономика ----------------------------------- */
  HC.ECON = {
    coinPickup: 7,        // монет за одну монетку на трассе
    orePickup: 1,          // руды за один камень
    fuelPickup: 0.38,      // доля бака за канистру
    distancePer100: 6,     // монет за каждые 100 м
    recordBonus: 0.5,      // доля сверху за новый рекорд
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
