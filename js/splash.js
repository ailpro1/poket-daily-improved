/* splash.js — the first thing you see each day: a greeting for the time of
   day and today's spending figure. Shows once per calendar day; after that
   opening the app goes straight to Home. */
(function (root) {
  'use strict';

  var UI = root.UI, C = root.Cycles, Fmt = root.Fmt;

  var GREETINGS = [
    { until: 5, emoji: '🌙', text: 'Still up?' },
    { until: 12, emoji: '☀️', text: 'Good morning!' },
    { until: 18, emoji: '🌤️', text: 'Good afternoon!' },
    { until: 22, emoji: '🌆', text: 'Good evening!' },
    { until: 24, emoji: '🌙', text: 'Good night!' }
  ];

  function greeting(hour) {
    for (var i = 0; i < GREETINGS.length; i++) {
      if (hour < GREETINGS[i].until) return GREETINGS[i];
    }
    return GREETINGS[1];
  }

  function splitAmount(value) {
    var sym = root.S.settings.currency || 'RM';
    var neg = value < 0;
    return { symbol: sym, figure: (neg ? '-' : '') + Fmt.group(Math.abs(value)) };
  }

  /* How long the branded artwork holds the screen on every open. */
  var ART_HOLD = 3000;

  /* ---------- arcade roll ------------------------------------------------
     Each digit is a column of 0-9 that spins up and lands on its target,
     like the reels on an old machine. Later digits run longer so the number
     settles left to right instead of all at once.

     Built from real elements rather than a text swap so it cannot land on a
     half-rendered figure: the strip is translated, and the final position is
     the digit itself. Anyone who has asked for less motion just gets the
     number. */
  var ROLL_BASE = 620;      /* ms for the first digit */
  var ROLL_STEP = 110;      /* extra ms per digit along */
  var ROLL_SPINS = 3;       /* full 0-9 passes before landing */

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function rollInto(host, text) {
    host.innerHTML = '';
    if (reducedMotion()) { host.textContent = text; return; }

    var chars = String(text).split('');
    var digitIndex = 0;
    chars.forEach(function (ch) {
      if (!/[0-9]/.test(ch)) {
        /* commas and the decimal point stay put — only reels spin */
        host.appendChild(UI.el('span', { class: 'roll-fixed', text: ch }));
        return;
      }
      var strip = UI.el('span', { class: 'roll-strip' });
      for (var s = 0; s < ROLL_SPINS; s++) {
        for (var d = 0; d <= 9; d++) strip.appendChild(UI.el('span', { class: 'roll-cell', text: String(d) }));
      }
      strip.appendChild(UI.el('span', { class: 'roll-cell', text: ch }));
      var reel = UI.el('span', { class: 'roll-reel' }, [strip]);
      host.appendChild(reel);

      /* The target cell is appended AFTER the filler passes, so it sits at
         index ROLL_SPINS*10 whatever the digit is. Adding `target` here
         overshoots into blank space for every digit except 0. Distance is in
         cells because one cell is 1em of line box, set in CSS. */
      var cells = ROLL_SPINS * 10;
      var ms = ROLL_BASE + digitIndex * ROLL_STEP;
      digitIndex += 1;
      /* Start at the top, then let the transition run on the next frame. */
      strip.style.transform = 'translateY(0)';
      requestAnimationFrame(function () {
        strip.style.transition = 'transform ' + ms + 'ms cubic-bezier(.16,.9,.24,1)';
        strip.style.transform = 'translateY(-' + cells + 'em)';
      });
    });
  }

  /* Resolves once the splash is done, so boot can carry on behind it. */
  function run() {
    var node = UI.$('#splash');
    if (!node) return Promise.resolve();

    var todayIso = C.iso(C.today());
    var seenToday = root.S.settings.lastSplashDate === todayIso;

    return new Promise(function (resolve) {
      function finish() {
        node.classList.add('leaving');
        if (!seenToday) root.Actions.saveSettings({ lastSplashDate: todayIso });
        setTimeout(function () {
          if (node.parentNode) node.remove();
          resolve();
        }, 280);
      }

      function showGreeting() {
        var g = greeting(new Date().getHours());
        var db = root.Calc.dailyBudget();
        /* effectivePool, not cyclePool: a mid-cycle joiner with a stated
           figure and an empty Plan does have a budget to show. */
        var hasPlan = db.effectivePool !== 0;
        var amount = splitAmount(db.left);

        UI.$('.splash-emoji', node).textContent = g.emoji;
        UI.$('.splash-greet', node).textContent = g.text;

        if (hasPlan) {
          UI.$('.splash-label', node).textContent = db.left < 0 ? 'Today you are over by' : 'Today you can spend';
          UI.$('.splash-cur', node).textContent = amount.symbol;
          rollInto(UI.$('.splash-num', node), amount.figure.replace('-', ''));
          UI.$('.splash-amount', node).classList.toggle('over', db.left < 0);
        } else {
          UI.$('.splash-label', node).textContent = 'No plan set up yet';
          UI.$('.splash-amount', node).classList.add('hidden');
        }

        node.classList.add('ready');
        UI.$('.splash-go', node).addEventListener('click', finish);
        node.addEventListener('keydown', function (e) { if (e.key === 'Escape') finish(); });
        setTimeout(function () { var b = UI.$('.splash-go', node); if (b) b.focus(); }, 120);
      }

      /* The artwork holds for three seconds every time the app opens. After
         that the daily greeting takes over — but only once per calendar day;
         on later opens the splash simply gets out of the way. */
      setTimeout(function () {
        node.classList.add('art-done');
        if (seenToday) finish();
        else showGreeting();
      }, ART_HOLD);
    });
  }

  root.Splash = {
    rollInto: rollInto, run: run, greeting: greeting };
})(typeof self !== 'undefined' ? self : globalThis);
