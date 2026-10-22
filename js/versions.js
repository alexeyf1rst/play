/* Frozen releases keep their own saves. This shared menu also works below a subpath. */
(function () {
  'use strict';
  var script = document.currentScript;
  var base = new URL('../', script.src);
  var current = script.dataset.version || 'current';
  var releases = [
    { id: 'current', name: 'Яркая долина', mark: 'НОВАЯ', title: 'Цвета на полную', text: 'Объёмная деревня, цветущие холмы, разгон и задания.', path: '' },
    { id: 'boost', name: 'Разгон и задания', mark: '03', title: 'Больше драйва', text: 'Разгон, серии мягких посадок и цель на каждый заезд.', path: 'versions/boost/index.html' },
    { id: 'improved', name: 'Мягкий баланс', mark: '02', title: 'Легче войти в ритм', text: 'Пологие холмы, больше топлива и помощь при перевороте.', path: 'versions/improved/index.html' },
    { id: 'classic', name: 'Классика', mark: '01', title: 'С самого начала', text: 'Исходная графика, физика и экономика игры.', path: 'versions/classic/index.html' }
  ];
  var active = releases.filter(function (v) { return v.id === current; })[0];
  var trigger = document.createElement('button');
  trigger.className = 'version-trigger'; trigger.type = 'button';
  trigger.textContent = active.name + ' ▾';
  trigger.setAttribute('aria-label', 'Выбрать версию игры: ' + active.name);
  trigger.setAttribute('aria-haspopup', 'dialog');
  var row = document.querySelector('.title-row');
  if (row) row.insertBefore(trigger, row.firstChild);
  var dialog = document.createElement('dialog');
  dialog.className = 'version-dialog';
  dialog.setAttribute('aria-labelledby', 'versions-title');
  dialog.innerHTML = '<div class="version-heading"><div><small>Тихие холмы</small><h2 id="versions-title">Во что играем?</h2></div><button type="button" class="version-close" aria-label="Закрыть">×</button></div>' +
    '<p class="version-note">Выбери любимый вариант. Прогресс каждой версии сохраняется отдельно.</p><div class="version-grid">' +
    releases.map(function (v) {
      return '<a class="version-card version-' + v.id + (v.id === current ? ' selected' : '') + '" href="' + new URL(v.path, base).href + '"' + (v.id === current ? ' aria-current="page"' : '') + '><span class="version-art" aria-hidden="true"><b>' + v.mark + '</b><i>▲</i></span><span class="version-copy"><small>' + v.name + (v.id === current ? ' · сейчас' : '') + '</small><strong>' + v.title + '</strong><span>' + v.text + '</span></span></a>';
    }).join('') + '</div>';
  document.body.appendChild(dialog);
  function open() {
    if (window.HC && HC.Game) {
      HC.Game.clearInput && HC.Game.clearInput();
      ['keys', 'touch'].forEach(function (group) {
        var input = HC.Game[group];
        if (input) Object.keys(input).forEach(function (key) { input[key] = false; });
      });
      if (HC.Game.scene === 'ride' && HC.Ride && !HC.Ride.paused && HC.Ride.phase === 'run') HC.Game.togglePause();
    }
    dialog.showModal();
  }
  dialog.addEventListener('keydown', function (e) { e.stopPropagation(); });
  dialog.addEventListener('keyup', function (e) { e.stopPropagation(); });
  trigger.addEventListener('click', open);
  dialog.querySelector('.version-close').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) { var r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
  dialog.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (window.HC && HC.Game && HC.Game.state) HC.save(HC.Game.state, true);
    });
  });
  // Every release shares UI.render, so the entry survives rebuilding a settings sheet.
  function addEntry() {
    var body = document.getElementById('modal-body');
    if (!body || (!body.querySelector('#set-music') && !body.querySelector('[data-resume]')) || body.querySelector('.version-settings')) return;
    var button = trigger.cloneNode(true); button.classList.add('version-settings');
    button.textContent = 'Версии игры · ' + active.name;
    button.addEventListener('click', open); body.insertBefore(button, body.firstChild);
  }
  if (window.HC && HC.UI) {
    var render = HC.UI.render;
    HC.UI.render = function () { var result = render.apply(this, arguments); addEntry(); return result; };
  }
})();
