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
    hills:  ['tree', 'tree', 'bush', 'pine', 'rock', 'fence', 'pole', 'grass', 'grass'],
    dunes:  ['bush', 'grass', 'rock', 'cactus', 'cactus', 'grass', 'skull'],
    ridge:  ['pine', 'pine', 'rock', 'rock', 'bush', 'pole', 'grass'],
    moon:   ['rock', 'rock', 'crater', 'flag', 'rock', 'crater'],
    base:   ['tree', 'bush', 'grass', 'rock', 'fence', 'pine']
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

  HC.Decor = {
    shapes: S,
    /* Нарисовать один предмет. Начало координат — точка на земле. */
    draw: function (g, type, P, scale, flip) {
      var fn = S[type];
      if (!fn) return;
      g.save();
      if (scale !== 1) g.scale(scale, scale);
      if (flip) g.scale(-1, 1);
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
