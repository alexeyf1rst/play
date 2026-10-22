/* Установка и офлайн. Обновление применяется только по кнопке игрока. */
window.HC = window.HC || {};
(function (HC) {
  'use strict';
  HC.VERSION = '1.1.0';
  var registration = null, installPrompt = null, ready = false, failed = false, applying = false;
  var supported = 'serviceWorker' in navigator && /^https?:$/.test(location.protocol);

  function status() {
    if (!supported) return 'Для офлайн-запуска открой игру по HTTPS или через локальный сервер.';
    if (failed) return 'Офлайн-копия пока не готова. При следующем открытии попробуем снова.';
    if (!ready) return 'Готовим игру для запуска без интернета…';
    return navigator.onLine === false ? 'Ты офлайн. Заезды, база и сохранения работают.' : 'Игра готова к запуску без интернета.';
  }

  function sync() {
    document.querySelectorAll('[data-pwa-status]').forEach(function (node) { node.textContent = status(); });
    document.querySelectorAll('[data-pwa-update]').forEach(function (node) {
      node.hidden = !(registration && registration.waiting);
      node.disabled = applying;
    });
    document.querySelectorAll('[data-pwa-install]').forEach(function (node) { node.hidden = !installPrompt; });
  }

  HC.PWA = {
    status: status,
    settingsHTML: function () {
      return '<h4 class="sec">Офлайн и установка · ' + HC.VERSION + '</h4>' +
        '<p class="muted" data-pwa-status role="status">' + status() + '</p>' +
        '<p class="muted">На iPhone: «Поделиться» → «На экран Домой». На Android и компьютере: ' +
        '«Установить приложение» в меню браузера. Прогресс хранится на этом устройстве; для переноса сохрани файл или код.</p>' +
        '<div class="row wrap"><button class="btn" data-pwa-install hidden>Установить игру</button>' +
        '<button class="btn main" data-pwa-update hidden>Сохранить и обновить игру</button></div>';
    },
    bindSettings: function (root) {
      var install = root.querySelector('[data-pwa-install]');
      var update = root.querySelector('[data-pwa-update]');
      if (install) install.addEventListener('click', async function () {
        if (!installPrompt) return;
        var pending = installPrompt;
        installPrompt = null;
        try { await pending.prompt(); await pending.userChoice; } catch (e) { /* браузер закрыл предложение */ }
        sync();
      });
      if (update) update.addEventListener('click', function () {
        if (!registration || !registration.waiting || applying) return;
        var game = HC.Game;
        if (game.scene === 'ride') {
          HC.UI.toast('Закончи заезд, чтобы обновить игру');
          return;
        }
        if (!HC.save(game.state, true)) {
          HC.UI.toast('Сначала сохрани прогресс в файл или устрани конфликт вкладок');
          return;
        }
        applying = true;
        sync();
        registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
      });
      sync();
    }
  };

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    installPrompt = event;
    sync();
  });
  window.addEventListener('appinstalled', function () { installPrompt = null; sync(); });
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  if (!supported) return;
  navigator.serviceWorker.addEventListener('controllerchange', function () { if (applying) location.reload(); });
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
      registration = reg;
      if (reg.active) ready = true;
      function watch(worker) {
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          if (worker.state === 'activated') ready = true;
          if (worker.state === 'redundant' && !reg.active) failed = true;
          sync();
        });
      }
      watch(reg.installing);
      reg.addEventListener('updatefound', function () { watch(reg.installing); sync(); });
      navigator.serviceWorker.ready.then(function () { ready = true; sync(); });
      sync();
    }).catch(function () { failed = true; sync(); });
  });
})(window.HC);
