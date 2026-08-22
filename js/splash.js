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
        var hasPlan = root.Calc.cyclePool(db.cycleKey) !== 0;
        var amount = splitAmount(db.left);

        UI.$('.splash-emoji', node).textContent = g.emoji;
        UI.$('.splash-greet', node).textContent = g.text;

        if (hasPlan) {
          UI.$('.splash-label', node).textContent = db.left < 0 ? 'Today you are over by' : 'Today you can spend';
          UI.$('.splash-cur', node).textContent = amount.symbol;
          UI.$('.splash-num', node).textContent = amount.figure.replace('-', '');
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

  root.Splash = { run: run, greeting: greeting };
})(typeof self !== 'undefined' ? self : globalThis);
