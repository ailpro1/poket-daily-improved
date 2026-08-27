/* app.js — boot, state, routing, chrome. */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, C = root.Cycles;

  var TABS = {
    home: { label: 'Home', icon: '◎', render: function (h) { root.TabHome.render(h); } },
    log: { label: 'Transaction', icon: '≡', render: function (h) { root.TabLog.render(h); } },
    plan: { label: 'Plan', icon: '◈', render: function (h) { root.TabPlan.render(h); } },
    accounts: { label: 'Accounts', icon: '▤', render: function (h) { root.TabAccounts.render(h); } },
    breakdown: { label: 'Breakdown', icon: '◐', render: function (h) { root.TabBreakdown.render(h); } }
  };
  /* Default order: what you reach for most, first. */
  var DEFAULT_NAV = ['home', 'log', 'plan', 'accounts', 'breakdown'];

  var DEFAULT_CATEGORIES = {
    income: [
      { id: 'cat_salary', name: 'Salary' },
      { id: 'cat_side', name: 'Side income' },
      { id: 'cat_gift', name: 'Gift' },
      { id: 'cat_refund', name: 'Refund' }
    ],
    expense: [
      { id: 'cat_food', name: 'Food & drink' },
      { id: 'cat_transport', name: 'Transport' },
      { id: 'cat_groceries', name: 'Groceries' },
      { id: 'cat_bills', name: 'Bills' },
      { id: 'cat_shopping', name: 'Shopping' },
      { id: 'cat_health', name: 'Health' },
      { id: 'cat_family', name: 'Family' },
      { id: 'cat_other', name: 'Other' }
    ]
  };

  /* Per-tab help, so the cards themselves can stay quiet. Reached from the ?
     in the header, which always shows the tab you are looking at. */
  var HELP = {
    home: {
      title: 'Home',
      body: [
        ['Two different numbers',
          'Spending money and Savings are what you really have, added straight up from your accounts. The daily budget is a guess worked out from your Plan. They will not match, and they are not supposed to.'],
        ['You can spend today',
          'Your Plan income, minus commitments and savings, shared out over the days in the month. Then adjusted for what you have really spent.'],
        ['Tap the top card',
          'It opens today and the next 2 days, so you can see what is coming before you spend.'],
        ['Money left over',
          'Spend less today and tomorrow has more. Spend more and it has less. What happens when a new month starts is up to you — see Settings, Carry over from last month.'],
        ['If you started mid-month',
          'We use what you said you had left, shared over the days that are left, instead of pretending you had a full month. Your Plan takes over next month. Change it in Settings, Your first month.']
      ]
    },
    log: {
      title: 'Transaction',
      body: [
        ['Money in and out',
          'Everything real this month, including things you ticked off your Plan. Moving money between your own accounts does not count as either.'],
        ['Labels on a row',
          '"from Plan" means you ticked it off the checklist. "split daily" means it is shared over the days left instead of all on one day. "refund" means money that came back.'],
        ['Getting money back',
          'Tap any transaction and choose Got money back. It goes in as money in, so the spending cancels out and your account goes back up.'],
        ['Changing categories',
          'Open the Category box on any transaction and pick Edit categories, or go to Settings. Renaming one also renames it on your past transactions. Deleting one asks where to move them, so nothing is lost.']
      ]
    },
    plan: {
      title: 'Plan',
      body: [
        ['Left to spend',
          'Income minus commitments minus savings. Share that over the days in the month and you get your daily budget. This is what Home works from, not your account totals.'],
        ['The order',
          'Biggest first, using this month\'s amount. Change one just for this month and it moves. One that has ended drops to the bottom.'],
        ['Changing an amount',
          'You choose whether it is just this month or every month from now on, and we ask you to confirm before saving. A green dot means it is changed for this month only — it goes back on its own next month.'],
        ['Ticking things off',
          'The checklist logs the real transaction on that item\'s account. Untick it and the transaction is removed.']
      ]
    },
    accounts: {
      title: 'Accounts',
      body: [
        ['Total money',
          'Your spending accounts and savings accounts added together. The arrow shows how much it has moved since this month started, and the bar shows how it splits.'],
        ['Changing the order',
          'Hold a card, then drag it. Each group remembers its own order.'],
        ['Moving money',
          'A transfer always has two sides, so deleting one deletes both and your totals stay correct.']
      ]
    },
    breakdown: {
      title: 'Breakdown',
      body: [
        ['Spendable',
          'Your day-to-day spending, by category. Things you ticked off your Plan are not here, because the daily budget already took them out — same rule, so the totals always agree.'],
        ['Committed',
          'The other half: commitments and savings from your Plan, one by one, with what you have paid and what is still to go.'],
        ['Money in',
          'Your Plan income plus anything you logged yourself. A Plan item you ticked off is counted once, as the item — its transaction is not added on top.'],
        ['The charts',
          'Tap a slice or a row and the middle of the circle shows just that one. Tap again to go back to the total.']
      ]
    }
  };

  function openHelp() {
    var h = HELP[current] || HELP.home;
    UI.sheet({
      title: h.title + ' — how it works',
      render: function (body) {
        h.body.forEach(function (pair) {
          body.appendChild(el('span', { class: 'eyebrow', text: pair[0] }));
          body.appendChild(el('p', { class: 'help-para', text: pair[1] }));
        });
      }
    });
  }

  var current = 'home';
  var viewCycle = null;

  function defaultSettings() {
    return {
      id: 'settings',
      currency: 'RM',
      cycleStartDay: 1,
      theme: 'system',
      cardStyle: 'flat',
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      budgetStartDate: null,
      /* Joining part-way through a cycle — see Calc.midCycle().
         'prorate' is the historical behaviour: pool spread over the whole
         cycle. Nothing derived is stored, only the join DATE. */
      midCycleMode: 'prorate',
      midCycleJoinDate: null,
      midCycleRemaining: null,
      midCycleAsked: false,
      /* How a surplus or shortfall behaves at a cycle boundary — see
         Calc.carryMode(). 'on' is the historical behaviour. */
      carryOver: 'on',
      lastSplashDate: null,
      navOrder: DEFAULT_NAV.slice(),
      onboarded: false
    };
  }

  function loadState() {
    return Promise.all([
      root.DB.all('settings'), root.DB.all('accounts'),
      root.DB.all('plan'), root.DB.all('logs'), root.DB.all('checklist')
    ]).then(function (res) {
      var settings = res[0][0] ? Object.assign(defaultSettings(), res[0][0]) : defaultSettings();
      if (!settings.categories) settings.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
      if (!settings.navOrder) settings.navOrder = DEFAULT_NAV.slice();
      var plan = { income: [], commitments: [], savings: [] };
      res[2].forEach(function (rec) {
        var sec = rec.section || 'commitments';
        if (!plan[sec]) plan[sec] = [];
        plan[sec].push(rec);
      });
      var checklist = {};
      res[4].forEach(function (r) { checklist[r.id] = r; });

      root.S = {
        settings: settings,
        accounts: res[1],
        plan: plan,
        logs: res[3],
        checklist: checklist
      };
      if (!settings.budgetStartDate) {
        settings.budgetStartDate = C.iso(C.today());
        root.DB.put('settings', settings);
      }
      root.Calc.invalidate();
    });
  }

  function cycleKey() { return viewCycle || C.currentCycleKey(); }

  function setCycle(key) {
    viewCycle = key === C.currentCycleKey() ? null : key;
    refresh();
  }

  var CARD_STYLES = [
    { value: 'flat', label: 'Flat pastel' },
    { value: 'frosted', label: 'Frosted glass' },
    { value: 'neumorphism', label: 'Neumorphism (soft)' }
  ];

  function applyTheme() {
    var t = root.S.settings.theme || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0f0f1a' : '#FAFAFA');
    applyCardStyle();
  }

  /* Card look for the headline cards — see [data-card-style] in css/app.css. */
  function applyCardStyle() {
    var s = root.S.settings.cardStyle || 'flat';
    var known = CARD_STYLES.some(function (o) { return o.value === s; });
    document.documentElement.dataset.cardStyle = known ? s : 'flat';
  }

  function renderHeader() {
    var head = UI.$('#app-head');
    head.innerHTML = '';
    var key = cycleKey();
    var isCurrent = key === C.currentCycleKey();
    head.appendChild(el('div', { class: 'head-row' }, [
      el('div', { class: 'brand' }, [
        el('img', { class: 'brand-logo', src: 'icons/logo-wordmark.png', alt: 'Poket Daily', width: '825', height: '185' })
      ]),
      el('div', { class: 'head-actions' }, [
        el('button', { class: 'icon-btn', 'aria-label': 'How this page works', text: '?', onclick: openHelp }),
        el('button', { class: 'icon-btn', 'aria-label': 'Checklist', text: '☑', onclick: function () { root.Checklist.open(); } }),
        el('button', { class: 'icon-btn', 'aria-label': 'Settings', text: '⚙', onclick: function () { root.Settings.open(); } })
      ])
    ]));
    /* Browsing past months is a Transaction-tab feature only — everywhere
       else always shows the current month, so the nav has no reason to be
       there. go() resets viewCycle on the way out of Log, so this can just
       key off the current tab. */
    if (current === 'log') {
      head.appendChild(el('div', { class: 'cycle-nav' }, [
        el('button', { class: 'icon-btn', 'aria-label': 'Previous month', text: '‹', onclick: function () { setCycle(C.shiftCycleKey(key, -1)); } }),
        el('button', {
          class: 'cycle-label' + (isCurrent ? '' : ' past'), text: C.cycleLabel(key),
          onclick: function () { setCycle(C.currentCycleKey()); }
        }),
        el('button', { class: 'icon-btn', 'aria-label': 'Next month', text: '›', onclick: function () { setCycle(C.shiftCycleKey(key, 1)); } })
      ]));
    }
  }

  function renderNav() {
    var nav = UI.$('#app-nav');
    nav.innerHTML = '';
    (root.S.settings.navOrder || DEFAULT_NAV).forEach(function (k) {
      if (!TABS[k]) return;
      var t = TABS[k];
      nav.appendChild(el('button', {
        class: 'nav-btn' + (k === current ? ' on' : ''),
        'aria-current': k === current ? 'page' : null,
        onclick: function () { go(k); }
      }, [
        el('span', { class: 'nav-icon', text: t.icon }),
        el('span', { class: 'nav-label', text: t.label })
      ]));
    });
  }

  function refresh() {
    root.Calc.invalidate();
    renderHeader();
    renderNav();
    var host = UI.$('#app-main');
    var y = window.scrollY;
    host.innerHTML = '';
    var page = el('div', { class: 'page page-' + current });
    TABS[current].render(page);
    host.appendChild(page);
    window.scrollTo(0, y);
    UI.$('#fab').hidden = current === 'plan' || current === 'breakdown';
  }

  /* Re-tapping the tab you're already on is a "scroll to top" gesture, not a
     navigation — so it must not tear down and re-render the page underneath
     the user. A genuine switch still jumps instantly; refresh() also scrolls
     to the top, which matters for actions that call it directly. */
  function go(tab) {
    if (!TABS[tab]) return;
    if (tab === current) {
      var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    /* The month nav only shows on Log, so a browsed-to past month must not
       silently keep steering every other tab. Leaving Log resets it. */
    if (tab !== 'log') viewCycle = null;
    current = tab;
    window.scrollTo(0, 0);
    refresh();
  }

  function reload() {
    return loadState().then(function () { applyTheme(); refresh(); });
  }

  /* ---------- picking up a new version -----------------------------------
     sw.js calls skipWaiting() on install and clients.claim() on activate, so
     a bumped CACHE constant installs and takes charge on its own. What was
     missing was the page: it keeps running the JS it parsed at boot until it
     reloads, so a user could sit on the old build indefinitely. So: say what
     is happening, then reload once the new worker is actually in charge.

     The dwell matters: on a fast connection the whole install takes a few
     milliseconds, so without it the message flashes past unread and the app
     looks like it reloaded for no reason. */
  var UPDATE_NOTICE_MS = 1400;
  var UPDATE_NOTICE = 'App is updating. Please wait…';

  function watchForUpdate(reg) {
    if (!reg) return;
    /* No controller means this is the first ever install rather than an
       update — the page already loaded these exact files from the network,
       so there is nothing to announce and nothing to reload for. */
    var replacing = !!navigator.serviceWorker.controller;
    var reloading = false;
    var noticeAt = 0;

    function go() { window.location.reload(); }

    function reload() {
      if (reloading) return;
      reloading = true;
      /* Never yank a half-filled form away. */
      if (UI.busy()) {
        UI.updateBar('Update ready. It will load when you are done here.',
          { actionLabel: 'Reload now', onAction: go });
        UI.onIdle(go);
        return;
      }
      /* Leave the notice exactly as it is — the reload IS the confirmation,
         and swapping the text now would replace the message the user is
         still reading. Just make sure it was up long enough to read. */
      notice();
      setTimeout(function () { UI.onIdle(go); },
        Math.max(0, UPDATE_NOTICE_MS - (Date.now() - noticeAt)));
    }

    function notice() {
      if (!noticeAt) noticeAt = Date.now();
      UI.updateBar(UPDATE_NOTICE);
    }

    function announce(worker) {
      if (!worker || !replacing) return;
      notice();
      /* A waiting worker means skipWaiting() has not taken hold; ask again. */
      if (worker.state === 'installed') worker.postMessage('skip-waiting');
      worker.addEventListener('statechange', function () {
        if (reloading) return;
        if (worker.state === 'installed') worker.postMessage('skip-waiting');
        /* redundant = the install failed, so stop promising an update */
        if (worker.state === 'redundant') UI.updateBar(false);
      });
    }

    announce(reg.installing || reg.waiting);
    reg.addEventListener('updatefound', function () { announce(reg.installing); });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!replacing) return;
      /* On a fast connection the worker can install, activate and claim the
         page before register() even resolves, so this is often where the
         notice first goes up rather than in announce(). */
      notice();
      reload();
    });

    /* register() only checks for a new sw.js on navigation, and a phone can
       keep a PWA alive for days. Ask on every open. */
    if (reg.update) reg.update().catch(function () { /* offline: nothing to check */ });
  }

  var booted = false;

  function boot() {
    if (booted) return Promise.resolve();
    booted = true;
    return loadState().then(function () {
      applyTheme();
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
      refresh();
      UI.$('#fab').addEventListener('click', function () { root.Forms.transaction(); });
      root.Splash.run().then(function () {
        if (!root.S.settings.onboarded && !root.S.accounts.length) {
          setTimeout(function () { root.Onboarding.open(0); }, 300);
        } else if (root.Onboarding.midCyclePending()) {
          /* Installed part-way through the cycle they are still in, and never
             asked about it. Both buttons on that sheet latch midCycleAsked. */
          setTimeout(function () { root.Onboarding.midCycle(); }, 300);
        }
      });
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
          .then(watchForUpdate)
          .catch(function () { /* offline still works from cache */ });
      }
    }).catch(function (err) {
      if (typeof console !== 'undefined') console.error('Poket Daily boot failed', err);
      document.body.innerHTML = '<p style="padding:24px;font:16px system-ui">Poket Daily could not open its database. ' +
        'Private browsing blocks storage on some phones. Error: ' + UI.esc(err.message) + '</p>';
    });
  }

  root.App = {
    boot: boot, refresh: refresh, go: go, reload: reload,
    watchForUpdate: watchForUpdate,
    cycleKey: cycleKey, setCycle: setCycle, applyTheme: applyTheme,
    applyCardStyle: applyCardStyle,
    TABS: TABS, DEFAULT_NAV: DEFAULT_NAV, CARD_STYLES: CARD_STYLES,
    HELP: HELP, openHelp: openHelp
  };

  document.addEventListener('DOMContentLoaded', boot);
})(typeof self !== 'undefined' ? self : globalThis);
