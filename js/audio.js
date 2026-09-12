/* ============================================================
   Звук.
   Музыки-файлов нет: всё живьём считает Web Audio.
   Медленные аккорды, редкие колокольчики, тихий ветер.
   Каждый раз получается чуть иначе и никогда не надоедает.
   ============================================================ */
window.HC = window.HC || {};
(function (HC) {
  'use strict';

  var ctx = null, master = null, musicBus = null, sfxBus = null, wet = null;
  var started = false, running = false;
  var timers = [];
  var padVoices = [];
  var windSrc = null;
  var settings = { music: true, musicVol: 0.55, sfx: true, sfxVol: 0.5 };

  // Аккорды (номера MIDI). Медленная петля без разрешения — чтобы не тянуло к развязке.
  var CHORDS = [
    [45, 57, 60, 64, 67],   // Am9
    [41, 53, 57, 60, 64],   // Fmaj7
    [43, 55, 59, 62, 67],   // G6
    [48, 55, 60, 64, 67],   // Cmaj
    [45, 57, 60, 67, 72],   // Am (шире)
    [38, 53, 57, 62, 65]    // Dm7
  ];
  var BELLS = [72, 74, 76, 79, 81, 84, 86];

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function later(fn, ms) {
    var id = setTimeout(function () {
      timers = timers.filter(function (t) { return t !== id; });
      if (running) fn();
    }, ms);
    timers.push(id);
    return id;
  }
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  /* --- Искусственная реверберация ------------------------- */
  function makeReverb(seconds, decay) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    var conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  function noiseBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      // мягкий "коричневый" шум — он спокойнее белого
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  /* --- Инициализация -------------------------------------- */
  function ensureCtx() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }

    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    var reverb = makeReverb(3.4, 2.6);
    wet = ctx.createGain();
    wet.gain.value = 0.34;
    reverb.connect(wet);
    wet.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = settings.music ? settings.musicVol : 0;
    musicBus.connect(master);
    musicBus.connect(reverb);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfx ? settings.sfxVol : 0;
    sfxBus.connect(master);
    sfxBus.connect(reverb);
    return true;
  }

  /* --- Слой 1: подушка из аккордов ------------------------ */
  function playChord(notes, dur) {
    var t = ctx.currentTime;
    var attack = rnd(5, 8), release = rnd(6, 9);
    notes.forEach(function (n, i) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      var filt = ctx.createBiquadFilter();

      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = mtof(n) * rnd(0.998, 1.002); // лёгкая расстройка = живое звучание
      osc.detune.value = rnd(-6, 6);

      filt.type = 'lowpass';
      filt.frequency.value = rnd(500, 900);
      filt.Q.value = 0.4;

      // очень медленное дыхание фильтра
      var lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      lfo.frequency.value = rnd(0.02, 0.06);
      lfoGain.gain.value = rnd(120, 260);
      lfo.connect(lfoGain); lfoGain.connect(filt.frequency);

      var peak = (i === 0 ? 0.10 : 0.055) * rnd(0.8, 1.15);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, t + dur - release);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(filt); filt.connect(g); g.connect(musicBus);
      osc.start(t); lfo.start(t);
      osc.stop(t + dur + 0.2); lfo.stop(t + dur + 0.2);
      padVoices.push(osc, lfo);
      if (padVoices.length > 60) padVoices.splice(0, 20);
    });
  }

  function chordLoop() {
    var dur = rnd(22, 34);
    playChord(pick(CHORDS), dur);
    later(chordLoop, (dur - rnd(7, 10)) * 1000);  // следующий аккорд наплывает на текущий
  }

  /* --- Слой 2: редкие колокольчики ------------------------ */
  function bell() {
    var t = ctx.currentTime;
    var n = pick(BELLS) - (Math.random() < 0.25 ? 12 : 0);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = mtof(n);
    var dur = rnd(4, 7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(rnd(0.05, 0.10), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(musicBus);
    osc.start(t); osc.stop(t + dur + 0.1);

    later(bell, rnd(6, 17) * 1000);
  }

  /* --- Слой 3: ветер -------------------------------------- */
  function startWind() {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(6);
    src.loop = true;
    var filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 320; filt.Q.value = 0.3;
    var g = ctx.createGain(); g.gain.value = 0.05;

    var lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.035; lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain);

    src.connect(filt); filt.connect(g); g.connect(musicBus);
    src.start(); lfo.start();
    windSrc = { src: src, lfo: lfo };
  }

  /* --- Двигатель -------------------------------------------
     Ноты нет — есть пила, частота которой идёт за оборотами колеса.
     Плюс шум пробуксовки и ветер на скорости. Всё считается на месте.
  */
  var eng = null;

  function engineStart() {
    if (!ensureCtx() || eng) return;
    var t = ctx.currentTime;

    var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 70;
    var o2 = ctx.createOscillator(); o2.type = 'square';   o2.frequency.value = 35;
    var filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 500; filt.Q.value = 3.5;
    var g1 = ctx.createGain(); g1.gain.value = 0.0001;
    var g2 = ctx.createGain(); g2.gain.value = 0.0001;

    // пробуксовка
    var ns = ctx.createBufferSource(); ns.buffer = noiseBuffer(2); ns.loop = true;
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2100; nf.Q.value = 0.9;
    var ng = ctx.createGain(); ng.gain.value = 0.0001;

    // ветер на скорости
    var ws = ctx.createBufferSource(); ws.buffer = noiseBuffer(3); ws.loop = true;
    var wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 700;
    var wg = ctx.createGain(); wg.gain.value = 0.0001;

    o1.connect(g1); g1.connect(filt);
    o2.connect(g2); g2.connect(filt);
    filt.connect(sfxBus);
    ns.connect(nf); nf.connect(ng); ng.connect(sfxBus);
    ws.connect(wf); wf.connect(wg); wg.connect(sfxBus);

    o1.start(t); o2.start(t); ns.start(t); ws.start(t);
    eng = { o1: o1, o2: o2, filt: filt, g1: g1, g2: g2, ng: ng, wg: wg, ns: ns, ws: ws };
  }

  function engineStop() {
    if (!eng) return;
    var t = ctx.currentTime;
    [eng.g1, eng.g2, eng.ng, eng.wg].forEach(function (g) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.0001, t, 0.05);
    });
    var e = eng;
    eng = null;
    setTimeout(function () {
      try { e.o1.stop(); e.o2.stop(); e.ns.stop(); e.ws.stop(); } catch (err) { /* уже остановлено */ }
    }, 300);
  }

  /* --- Публичный интерфейс -------------------------------- */
  HC.Audio = {
    applySettings: function (s) {
      settings.music = !!s.music;
      settings.musicVol = s.musicVol;
      settings.sfx = !!s.sfx;
      settings.sfxVol = s.sfxVol;
      if (!ctx) return;
      var t = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.linearRampToValueAtTime(settings.music ? settings.musicVol : 0, t + 0.6);
      sfxBus.gain.cancelScheduledValues(t);
      sfxBus.gain.linearRampToValueAtTime(settings.sfx ? settings.sfxVol : 0, t + 0.1);
      if (settings.music && !running) HC.Audio.start();
    },

    engineStart: engineStart,
    engineStop: engineStop,

    /* rpm 0..1.3, газ 0..1, буксует 0..1, скорость 0..1 */
    engine: function (rpm, thr, slip, spd) {
      if (!eng || !ctx) return;
      var t = ctx.currentTime;
      var f = 58 + rpm * 215;
      eng.o1.frequency.setTargetAtTime(f, t, 0.035);
      eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.035);
      eng.filt.frequency.setTargetAtTime(360 + rpm * 1700 + thr * 800, t, 0.05);
      var load = 0.30 + 0.70 * rpm;
      eng.g1.gain.setTargetAtTime((0.030 + 0.055 * thr) * load, t, 0.06);
      eng.g2.gain.setTargetAtTime((0.018 + 0.030 * thr) * load, t, 0.06);
      eng.ng.gain.setTargetAtTime(0.0001 + slip * 0.055, t, 0.05);
      eng.wg.gain.setTargetAtTime(0.0001 + Math.max(0, spd - 0.4) * 0.075, t, 0.12);
    },

    // Браузер разрешает звук только после действия пользователя
    unlock: function () {
      if (!ensureCtx()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (settings.music && !started) HC.Audio.start();
    },

    start: function () {
      if (!ensureCtx()) return;
      if (running) return;
      running = true; started = true;
      if (ctx.state === 'suspended') ctx.resume();
      startWind();
      chordLoop();
      later(bell, rnd(4, 9) * 1000);
    },

    stop: function () {
      running = false;
      engineStop();
      clearTimers();
      if (!ctx) return;
      try {
        if (windSrc) { windSrc.src.stop(); windSrc.lfo.stop(); windSrc = null; }
      } catch (e) { /* уже остановлено */ }
      padVoices.forEach(function (v) { try { v.stop(); } catch (e) {} });
      padVoices = [];
      started = false;
    },

    suspend: function () { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume: function () { if (ctx && ctx.state === 'suspended' && settings.music) ctx.resume(); },

    /* --- Короткие звуки. Все мягкие, без резких атак ------ */
    blip: function (freq, dur, vol, type) {
      if (!ctx || !settings.sfx) return;
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(sfxBus);
      osc.start(t); osc.stop(t + dur + 0.05);
    },

    coin: function () {
      this.blip(mtof(pick([84, 86, 88, 91])), 0.5, 0.09, 'sine');
    },
    ore: function () {
      this.blip(mtof(pick([60, 62, 64])), 0.9, 0.10, 'triangle');
    },
    fuel: function () {
      this.blip(mtof(69), 0.35, 0.07, 'sine');
      var self = this;
      setTimeout(function () { self.blip(mtof(76), 0.5, 0.06, 'sine'); }, 90);
    },
    click: function () {
      this.blip(mtof(78), 0.10, 0.045, 'sine');
    },
    build: function () {
      var self = this;
      [64, 71, 76].forEach(function (n, i) {
        setTimeout(function () { self.blip(mtof(n), 0.9, 0.075, 'sine'); }, i * 120);
      });
    },
    deny: function () {
      this.blip(mtof(56), 0.22, 0.05, 'sine');
    },
    crash: function () {
      if (!ctx || !settings.sfx) return;
      var t = ctx.currentTime;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(1);
      var filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(700, t);
      filt.frequency.exponentialRampToValueAtTime(90, t + 0.7);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      src.connect(filt); filt.connect(g); g.connect(sfxBus);
      src.start(t); src.stop(t + 0.9);
    },
    /* Приземление: глухой удар, громкость по силе */
    land: function (force) {
      if (!ctx || !settings.sfx) return;
      var f = Math.max(0.15, Math.min(1, force || 0.5));
      var t = ctx.currentTime;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.4);
      var filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(420, t);
      filt.frequency.exponentialRampToValueAtTime(80, t + 0.26);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.05 + 0.09 * f, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      src.connect(filt); filt.connect(g); g.connect(sfxBus);
      src.start(t); src.stop(t + 0.35);
      // низкий тон вместе с ударом — вес машины
      var osc = ctx.createOscillator(), og = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(70 + 40 * f, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.22);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.03 + 0.05 * f, t + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(og); og.connect(sfxBus);
      osc.start(t); osc.stop(t + 0.35);
    },

    crack: function () {
      if (!ctx || !settings.sfx) return;
      var t = ctx.currentTime;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.5);
      var filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.setValueAtTime(1400, t);
      filt.frequency.exponentialRampToValueAtTime(320, t + 0.3);
      filt.Q.value = 1.2;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      src.connect(filt); filt.connect(g); g.connect(sfxBus);
      src.start(t); src.stop(t + 0.5);
    },

    flip: function (n) {
      var self = this;
      var base = 72 + Math.min(n - 1, 3) * 4;
      [0, 4, 7].forEach(function (step, i) {
        setTimeout(function () { self.blip(mtof(base + step), 0.7, 0.085, 'sine'); }, i * 70);
      });
    },
    // мягкий аккорд в конце заезда
    chime: function () {
      var self = this;
      [72, 76, 79].forEach(function (n, i) {
        setTimeout(function () { self.blip(mtof(n), 1.6, 0.07, 'sine'); }, i * 180);
      });
    }
  };
})(window.HC);
