/* ============================================================
   Декорации: деревья, камни, столбы, заборы, трава.
   Всё рисуется теми же чернилами, что и остальная игра, и
   расставляется из числа-семечка — то есть у одной трассы
   пейзаж всегда один и тот же.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  /* Наборы для разных мест. Первым идёт то, что встречается чаще. */
  HC.DECOR_SETS = {
    hills:  ['tree', 'tree', 'bush', 'pine', 'rock', 'fence', 'pole', 'grass', 'grass', 'lamp', 'crates'],
    sand:    ['cactus', 'cactus', 'rock', 'grass', 'bush', 'skull', 'crates'],
    highway: ['lamp', 'sign', 'pole', 'grass', 'lamp', 'cone', 'sign', 'kmpost', 'barrier', 'pole', 'billboard', 'lamp'],
    forest:  ['pine', 'tree', 'bush', 'grass', 'rock', 'pine'],
    moon:   ['rock', 'rock', 'crater', 'flag', 'rock', 'crater'],
    base:   ['tree', 'bush', 'grass', 'rock', 'fence', 'pine']
  };

  /* Своя мера у каждого предмета: втрое крупнее должны стать деревья и
     камни, а щит и без того огромный — иначе он заслоняет пол-экрана.
     Множитель применяется при расстановке, поэтому камень-препятствие
     ровно того же размера, что и нарисованный камень. */
  HC.DECOR_SIZE = {
    billboard: 0.5, barrier: 0.6, tower: 0.6, crates: 0.75, kmpost: 0.7,
    fence: 0.8, sign: 0.85, skull: 0.7, crater: 0.8, flag: 0.8, flagpole: 0.7,
    pole: 0.9, lamp: 0.95
  };

  /* Неровный кругляш одним контуром — крона дерева или куст.
     Важно рисовать именно одним путём: иначе на стыках кружков
     видны лишние обводки и получается не крона, а связка колец. */
  function blob(g, cx, cy, r, flat) {
    var n = 9;
    g.beginPath();
    for (var i = 0; i <= n; i++) {
      var a = i / n * Math.PI * 2 - Math.PI / 2;
      var rr = r * (0.88 + 0.12 * Math.sin(i * 2.7 + 0.6));
      var x = cx + Math.cos(a) * rr;
      var y = cy + Math.sin(a) * rr * (flat || 0.94);
      if (i === 0) { g.moveTo(x, y); continue; }
      var pa = (i - 0.5) / n * Math.PI * 2 - Math.PI / 2;
      var pr = r * (1.06 + 0.10 * Math.sin(i * 3.3));
      g.quadraticCurveTo(cx + Math.cos(pa) * pr, cy + Math.sin(pa) * pr * (flat || 0.94), x, y);
    }
    g.closePath();
  }

  var S = {
    /* Лиственное дерево */
    tree: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2.6; g.lineCap = 'round';
      g.lineWidth = 3.4;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-2, -28); g.stroke();
      g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(-2, -17); g.lineTo(-12, -26); g.moveTo(-2, -22); g.lineTo(9, -29); g.stroke();
      var cg = g.createLinearGradient(0, -70, 0, -20);
      cg.addColorStop(0, P.bodyHi || P.bodyFill);
      cg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = cg; g.lineWidth = 2.4;
      blob(g, -1, -44, 27, 0.84);
      g.fill(); g.stroke();
    },
    /* Ёлка */
    pine: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -14); g.stroke();
      var pg = g.createLinearGradient(-18, -66, 18, -14);
      pg.addColorStop(0, P.bodyHi || P.bodyFill);
      pg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = pg;
      for (var i = 0; i < 3; i++) {
        var y = -14 - i * 17, w = 18 - i * 4.5;
        g.beginPath();
        g.moveTo(-w, y); g.lineTo(0, y - 24); g.lineTo(w, y);
        g.closePath(); g.fill(); g.stroke();
      }
    },
    /* Куст */
    bush: function (g, P) {
      var bg = g.createLinearGradient(0, -24, 0, 2);
      bg.addColorStop(0, P.bodyHi || P.bodyFill);
      bg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = bg; g.strokeStyle = P.ink; g.lineWidth = 2.2;
      g.save();
      g.beginPath(); g.rect(-30, -40, 60, 40); g.clip();   // низ куста уходит в землю
      blob(g, 0, -9, 15, 0.95);
      g.fill(); g.stroke();
      g.restore();
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(14, 0); g.stroke();
    },
    /* Камень */
    rock: function (g, P) {
      var rg = g.createLinearGradient(-14, -20, 14, 2);
      rg.addColorStop(0, P.bodyHi || P.bodyFill);
      rg.addColorStop(0.5, P.bodyFill);
      rg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = rg; g.strokeStyle = P.ink; g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-15, 0); g.lineTo(-10, -13); g.lineTo(2, -18); g.lineTo(13, -9); g.lineTo(15, 0);
      g.closePath(); g.fill(); g.stroke();
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-10, -13); g.lineTo(0, -6); g.lineTo(13, -9); g.stroke();
    },
    /* Телеграфный столб */
    pole: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -76); g.stroke();
      g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(-13, -66); g.lineTo(13, -66); g.stroke();
      g.beginPath(); g.moveTo(-10, -55); g.lineTo(10, -55); g.stroke();
      g.lineWidth = 1.4;
      g.globalAlpha = 0.55;
      g.beginPath(); g.moveTo(-13, -66); g.quadraticCurveTo(-70, -52, -130, -62); g.stroke();
      g.beginPath(); g.moveTo(13, -66); g.quadraticCurveTo(70, -52, 130, -62); g.stroke();
      g.globalAlpha = 1;
    },
    /* Оградка */
    fence: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2.4; g.lineCap = 'round';
      for (var i = 0; i < 4; i++) {
        var x = -30 + i * 20;
        g.beginPath(); g.moveTo(x, 2); g.lineTo(x, -26); g.stroke();
      }
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(-32, -20); g.lineTo(32, -20); g.moveTo(-32, -9); g.lineTo(32, -9); g.stroke();
    },
    /* Пучок травы */
    grass: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 1.8; g.lineCap = 'round';
      g.globalAlpha = 0.75;
      g.beginPath();
      g.moveTo(-7, 0); g.quadraticCurveTo(-9, -9, -13, -14);
      g.moveTo(-2, 0); g.quadraticCurveTo(-2, -12, 1, -19);
      g.moveTo(4, 0); g.quadraticCurveTo(7, -9, 12, -13);
      g.stroke();
      g.globalAlpha = 1;
    },
    /* Кактус */
    cactus: function (g, P) {
      var cg = g.createLinearGradient(-12, -44, 12, 0);
      cg.addColorStop(0, P.bodyHi || P.bodyFill);
      cg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = cg; g.strokeStyle = P.ink; g.lineWidth = 2.4; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(-6, 0); g.lineTo(-6, -30);
      g.quadraticCurveTo(-6, -44, 0, -44);
      g.quadraticCurveTo(6, -44, 6, -30); g.lineTo(6, 0);
      g.closePath(); g.fill(); g.stroke();
      g.beginPath();
      g.moveTo(-6, -22); g.lineTo(-15, -22);
      g.quadraticCurveTo(-20, -22, -20, -30); g.lineTo(-20, -36);
      g.stroke();
      g.beginPath();
      g.moveTo(6, -28); g.lineTo(14, -28);
      g.quadraticCurveTo(18, -28, 18, -34); g.lineTo(18, -39);
      g.stroke();
    },
    /* Череп в песке — единственная шутка на всю игру */
    skull: function (g, P) {
      g.fillStyle = P.bodyFill; g.strokeStyle = P.ink; g.lineWidth = 1.8;
      g.beginPath(); g.arc(0, -7, 8, Math.PI, 0); g.lineTo(6, 0); g.lineTo(-6, 0); g.closePath();
      g.fill(); g.stroke();
      g.fillStyle = P.ink;
      g.beginPath(); g.arc(-3, -7, 1.8, 0, 6.3); g.arc(3, -7, 1.8, 0, 6.3); g.fill();
    },
    /* Лунный кратер */
    crater: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2;
      g.fillStyle = P.groundDeep || P.ground;
      g.globalAlpha = 0.8;
      g.beginPath(); g.ellipse(0, -2, 24, 6, 0, 0, 6.3); g.fill(); g.stroke();
      g.globalAlpha = 1;
    },
    /* Фонарь вдоль дороги */
    lamp: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -58); g.stroke();
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(0, -58); g.quadraticCurveTo(0, -68, 12, -68); g.stroke();
      var lg = g.createLinearGradient(0, -70, 0, -58);
      lg.addColorStop(0, P.bodyHi || P.bodyFill);
      lg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(6, -68); g.lineTo(18, -68); g.lineTo(15, -59); g.lineTo(9, -59);
      g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-5, 0); g.lineTo(5, 0); g.stroke();
    },
    /* Водонапорная башня */
    tower: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(-20, 0); g.lineTo(-11, -46); g.moveTo(20, 0); g.lineTo(11, -46);
      g.stroke();
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(-17, -18); g.lineTo(17, -18); g.moveTo(-14, -32); g.lineTo(14, -32); g.stroke();
      g.beginPath(); g.moveTo(-17, -18); g.lineTo(14, -32); g.moveTo(17, -18); g.lineTo(-14, -32); g.stroke();
      var tg = g.createLinearGradient(-18, -76, 18, -46);
      tg.addColorStop(0, P.bodyHi || P.bodyFill);
      tg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = tg; g.lineWidth = 2.4;
      g.beginPath(); g.rect(-18, -72, 36, 26); g.fill(); g.stroke();
      g.beginPath();
      g.moveTo(-22, -72); g.lineTo(0, -88); g.lineTo(22, -72);
      g.closePath(); g.fill(); g.stroke();
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-18, -62); g.lineTo(18, -62); g.stroke();
    },
    /* Ящики */
    crates: function (g, P) {
      var cg = g.createLinearGradient(0, -34, 0, 0);
      cg.addColorStop(0, P.bodyHi || P.bodyFill);
      cg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = cg; g.strokeStyle = P.ink; g.lineWidth = 2.2;
      function box(x, y, w2, h2) {
        g.beginPath(); g.rect(x, y, w2, h2); g.fill(); g.stroke();
        g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w2, y + h2); g.moveTo(x + w2, y); g.lineTo(x, y + h2); g.stroke();
        g.lineWidth = 2.2;
      }
      box(-22, -17, 17, 17);
      box(-3, -15, 15, 15);
      box(-16, -32, 16, 15);
    },
    /* Флагшток */
    flagpole: function (g, P, t) {
      g.strokeStyle = P.ink; g.lineWidth = 2.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -76); g.stroke();
      g.lineWidth = 2.2;
      var fg = g.createLinearGradient(0, -76, 30, -56);
      fg.addColorStop(0, P.bodyHi || P.bodyFill);
      fg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = fg;
      g.beginPath();
      g.moveTo(1, -74);
      g.quadraticCurveTo(16, -70, 30, -74);
      g.lineTo(30, -58);
      g.quadraticCurveTo(16, -54, 1, -58);
      g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.arc(0, -78, 3, 0, 6.3); g.fill(); g.stroke();
    },
    /* Дорожный знак на столбике */
    sign: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -44); g.stroke();
      var sg = g.createLinearGradient(0, -70, 0, -40);
      sg.addColorStop(0, P.bodyHi || P.bodyFill);
      sg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = sg; g.lineWidth = 2.4; g.lineJoin = 'round';
      g.beginPath();
      if (g.roundRect) g.roundRect(-17, -68, 34, 26, 5); else g.rect(-17, -68, 34, 26);
      g.fill(); g.stroke();
      // стрелка вперёд — единственное, что знак сообщает
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-8, -55); g.lineTo(8, -55);
      g.moveTo(3, -60); g.lineTo(8, -55); g.lineTo(3, -50);
      g.stroke();
    },
    /* Конус */
    cone: function (g, P) {
      var cg = g.createLinearGradient(-10, -26, 10, 0);
      cg.addColorStop(0, P.bodyHi || P.bodyFill);
      cg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = cg; g.strokeStyle = P.ink; g.lineWidth = 2.2; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(-11, 0); g.lineTo(-4, -24); g.lineTo(4, -24); g.lineTo(11, 0);
      g.closePath(); g.fill(); g.stroke();
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(-8, -9); g.lineTo(8, -9); g.moveTo(-6, -16); g.lineTo(6, -16); g.stroke();
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(14, 0); g.stroke();
    },
    /* Бетонный блок с полосами */
    barrier: function (g, P) {
      var bg = g.createLinearGradient(0, -22, 0, 0);
      bg.addColorStop(0, P.bodyHi || P.bodyFill);
      bg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = bg; g.strokeStyle = P.ink; g.lineWidth = 2.3; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(-26, 0); g.lineTo(-20, -20); g.lineTo(20, -20); g.lineTo(26, 0);
      g.closePath(); g.fill(); g.stroke();
      g.lineWidth = 1.5;
      g.globalAlpha = 0.7;
      g.beginPath();
      for (var i = -3; i <= 3; i++) {
        g.moveTo(i * 8 - 4, -2); g.lineTo(i * 8 + 4, -18);
      }
      g.stroke();
      g.globalAlpha = 1;
    },
    /* Километровый столбик */
    kmpost: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2.4; g.lineJoin = 'round';
      var pg = g.createLinearGradient(0, -34, 0, 0);
      pg.addColorStop(0, P.bodyHi || P.bodyFill);
      pg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = pg;
      g.beginPath();
      if (g.roundRect) g.roundRect(-6, -34, 12, 34, 5); else g.rect(-6, -34, 12, 34);
      g.fill(); g.stroke();
      g.lineWidth = 1.6;
      g.globalAlpha = 0.7;
      g.beginPath();
      g.moveTo(-4, -26); g.lineTo(4, -26);
      g.moveTo(-4, -20); g.lineTo(2, -20);
      g.stroke();
      g.globalAlpha = 1;
    },
    /* Пустой щит на двух ногах */
    billboard: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(-14, 0); g.lineTo(-12, -46);
      g.moveTo(14, 0); g.lineTo(12, -46);
      g.stroke();
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(-13, -24); g.lineTo(13, -24); g.stroke();
      var bg = g.createLinearGradient(0, -84, 0, -44);
      bg.addColorStop(0, P.bodyHi || P.bodyFill);
      bg.addColorStop(1, P.bodyShade || P.bodyFill);
      g.fillStyle = bg; g.lineWidth = 2.4;
      g.beginPath(); g.rect(-30, -82, 60, 38); g.fill(); g.stroke();
      g.lineWidth = 1.4; g.globalAlpha = 0.5;
      g.beginPath();
      g.moveTo(-22, -70); g.lineTo(14, -70);
      g.moveTo(-22, -62); g.lineTo(18, -62);
      g.moveTo(-22, -54); g.lineTo(2, -54);
      g.stroke();
      g.globalAlpha = 1;
    },
    /* Флажок на Луне */
    flag: function (g, P) {
      g.strokeStyle = P.ink; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -48); g.stroke();
      g.fillStyle = P.bodyFill; g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -48); g.lineTo(26, -42); g.lineTo(0, -34);
      g.closePath(); g.fill(); g.stroke();
    }
  };

  /* Что нельзя отражать: у знака отражается стрелка, и она начинает
     показывать назад. */
  var NO_FLIP = { sign: 1, billboard: 1 };

  HC.Decor = {
    shapes: S,
    /* Нарисовать один предмет. Начало координат — точка на земле. */
    draw: function (g, type, P, scale, flip) {
      var fn = S[type];
      if (!fn) return;
      g.save();
      if (scale !== 1) g.scale(scale, scale);
      if (flip && !NO_FLIP[type]) g.scale(-1, 1);
      g.lineJoin = 'round';
      fn(g, P);
      g.restore();
    },
    /* Мягкая тень под предметом — он перестаёт быть наклейкой */
    shadow: function (g, P, w, alpha) {
      g.save();
      g.globalAlpha = alpha === undefined ? 0.3 : alpha;
      g.fillStyle = P.shadow || 'rgba(0,0,0,.2)';
      g.scale(1, 0.15);
      g.beginPath(); g.arc(w * 0.15, 0, w, 0, 6.3); g.fill();
      g.restore();
      g.globalAlpha = 1;
    }
  };
})(window.HC);
