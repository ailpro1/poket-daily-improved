/* tab-home.js */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, C = root.Cycles, Calc = root.Calc, Fmt = root.Fmt;

  function dayStripData(cycleKey) {
    var r = C.getCycleRangeForKey(cycleKey);
    var allowance = Calc.dailyAllowance(cycleKey);
    var todayIso = C.iso(C.today());
    /* Days before budgeting began carry no allowance, so they must not be
       judged against one. Read the rule directly rather than off today's
       dailyBudget, so the strip is still right when a past cycle is in view.
       Bar count still comes from totalDays. */
    var m = Calc.midCycle();
    var joinIso = (m && m.cycleKey === String(cycleKey)) ? m.joinIso : null;
    var bars = [], cur = r.startIso;
    for (var i = 0; i < r.totalDays; i++) {
      var spend = Calc.budgetDrainOnDay(cur);
      var pre = !!joinIso && cur < joinIso;
      bars.push({
        iso: cur,
        label: C.dateLabel(cur),
        spend: Math.max(0, spend),
        spendLabel: Fmt.money(spend),
        allowance: pre ? 0 : allowance,
        state: pre ? 'pre' : (cur < todayIso ? 'past' : (cur === todayIso ? 'today' : 'future'))
      });
      cur = C.iso(C.addDays(cur, 1));
    }
    return bars;
  }

  function coachLine(db, summary) {
    if (!root.S.accounts.length) return 'Add your accounts first — the totals come straight from them.';
    /* Ahead of the no-Plan line: a mid-cycle joiner has a real budget from the
       figure they stated, even with an empty Plan. */
    if (db.midCycleJoinIso && !summary.plannedIncome) {
      return 'Using what you had left when you started. Set up your Plan for ' +
        C.cycleLabel(C.shiftCycleKey(db.cycleKey, 1)) + ' onwards.';
    }
    if (!summary.plannedIncome) return 'Set up your Plan to switch on the daily budget.';
    if (db.carry < -0.5) return 'You are ' + Fmt.money(Math.abs(db.carry)) + ' short. Today\'s figure already takes that off.';
    if (db.carry > 0.5) return Fmt.money(db.carry) + ' left over from before, so today has more room.';
    if (db.left < 0) return 'Nothing left for today. Tomorrow starts ' + Fmt.money(Math.abs(db.left)) + ' short.';
    return 'On track. ' + db.daysLeft + ' day' + (db.daysLeft === 1 ? '' : 's') + ' left this month.';
  }

  function balanceCard(opts) {
    return el('button', {
      class: 'bal-card ' + opts.cls, type: 'button', onclick: opts.onclick
    }, [
      el('span', { class: 'eyebrow', text: opts.eyebrow }),
      el('span', { class: 'bal-value', text: Fmt.money(opts.value) }),
      el('span', { class: 'bal-sub', text: opts.sub }),
      el('span', { class: 'bal-chev', html: '&rsaquo;' })
    ]);
  }

  function graphSheet(kind) {
    var isSaving = kind === 'saving';
    var step = isSaving ? 'month' : 'month';
    UI.sheet({
      title: isSaving ? 'Savings over time' : 'Monthly Balance over time',
      render: function (body) {
        var holder = el('div', { class: 'chart-holder' });
        var legend = el('p', { class: 'sheet-note' });
        function paint() {
          var firstIso = Calc.firstActivityIso();
          var todayIso = C.iso(C.today());
          /* Window starts at real first activity, never an empty fixed window. */
          var wantBackDays = step === 'day' ? 30 : step === 'week' ? 120 : 365;
          var earliest = C.iso(C.addDays(todayIso, -wantBackDays));
          var fromIso = earliest < firstIso ? firstIso : earliest;
          var series = Calc.balanceSeries(isSaving ? 'saving' : 'general', fromIso, todayIso, step);
          var forecast = isSaving ? Calc.savingsForecast(todayIso, 6).slice(1) : null;
          holder.innerHTML = root.Charts.line(series, {
            id: kind, forecast: forecast, width: 340, height: 200,
            aria: isSaving ? 'Savings balance over time' : 'Monthly balance over time'
          });
          var now = isSaving ? Calc.savingsBalance() : Calc.monthlyBalance();
          legend.textContent = 'Now ' + Fmt.money(now) + ' · history starts ' + C.dateLabel(fromIso) +
            (isSaving ? ' · dotted line projects your Plan\'s savings rate' : '');
        }
        body.appendChild(UI.segmented(
          [{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }],
          'month',
          function (v) { step = v === 'week' ? 'week' : 'month'; paint(); }
        ));
        body.appendChild(holder);
        body.appendChild(legend);
        paint();

        var accs = Calc.accountsOfType(isSaving ? 'saving' : 'general');
        var list = el('ul', { class: 'mini-list' });
        accs.forEach(function (a) {
          list.appendChild(el('li', {}, [
            el('span', { text: a.icon + ' ' + a.name }),
            el('b', { class: 'num', text: Fmt.money(Calc.accountBalance(a.id)) })
          ]));
        });
        list.appendChild(el('li', { class: 'mini-total' }, [
          el('span', { text: isSaving ? 'Savings' : 'Spending money' }),
          el('b', { class: 'num', text: Fmt.money(isSaving ? Calc.savingsBalance() : Calc.monthlyBalance()) })
        ]));
        body.appendChild(list);
      }
    });
  }

  /* Tapping the hero opens the next three days, each split into the two parts
     it is made of: what rolled over from the day before, plus that day's own
     share. Tomorrow and the day after assume nothing more is spent today —
     said out loud at the bottom, because it is a real assumption. */
  function forecastSheet() {
    var days = Calc.forecastDays(3);
    var names = ['Today', 'Tomorrow'];

    function dayName(p) {
      if (names[p.offset]) return names[p.offset];
      var d = C.toDate(p.iso);
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate();
    }

    UI.sheet({
      title: 'Today and the next 2 days',
      render: function (body) {
        var holder = el('div', {
          class: 'chart-holder',
          html: root.Charts.forecast(days.map(function (p) {
            return { value: p.left, label: dayName(p) + ': ' + Fmt.money(p.left), short: dayName(p) };
          }))
        });
        body.appendChild(holder);

        var grid = el('div', { class: 'fc-grid' });
        var dots = UI.$$('.fc-dot', holder);
        var cards = [];
        var picked = 0;

        function paint() {
          dots.forEach(function (d, i) { d.classList.toggle('on', i === picked); });
          cards.forEach(function (c, i) {
            c.classList.toggle('on', i === picked);
            c.setAttribute('aria-pressed', i === picked ? 'true' : 'false');
          });
        }
        function pick(i) { picked = i; paint(); }

        days.forEach(function (p, i) {
          var card = el('div', {
            class: 'fc-card', tabindex: '0', role: 'button', 'aria-pressed': 'false',
            onclick: function () { pick(i); },
            onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); } }
          }, [
            el('span', { class: 'fc-day', text: dayName(p) }),
            el('b', { class: 'fc-big num' + (p.left < 0 ? ' neg' : ''), text: Fmt.money(p.left) }),
            el('span', { class: 'fc-part' }, [
              document.createTextNode('Left over'),
              el('b', { class: 'num', text: Fmt.money(p.rollover) })
            ]),
            el('span', { class: 'fc-part' }, [
              document.createTextNode('For the day'),
              el('b', { class: 'num', text: '+ ' + Fmt.money(p.allowance) })
            ])
          ]);
          if (p.offset === 0 && p.spent > 0.005) {
            card.appendChild(el('span', { class: 'fc-sum', text: 'Spent so far ' + Fmt.money(p.spent) }));
          } else if (p.projected) {
            card.appendChild(el('span', { class: 'fc-sum', text: 'If you stop now' }));
          }
          cards.push(card);
          grid.appendChild(card);
        });
        body.appendChild(grid);

        dots.forEach(function (d, i) {
          d.addEventListener('click', function () { pick(i); });
          d.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); }
          });
        });
        paint();

        body.appendChild(el('p', { class: 'sheet-note', text: 'Each day gets ' + Fmt.money(days[0].allowance) + '. Whatever you do not spend rolls over to the next day, so tomorrow and the day after assume you stop spending now.' }));
      }
    });
  }

  function render(host) {
    var cycleKey = root.App.cycleKey();
    var db = Calc.dailyBudget();
    var summary = Calc.cycleSummary(cycleKey);
    host.innerHTML = '';

    var hero = el('section', {
      class: 'hero tappable' + (db.left < 0 ? ' hero-over' : ''),
      tabindex: '0', role: 'button', 'aria-label': 'Today and the next 2 days',
      onclick: forecastSheet,
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); forecastSheet(); } }
    }, [
      el('span', { class: 'eyebrow', text: 'You can spend today' }),
      el('p', { class: 'hero-value', text: Fmt.money(db.left) }),
      el('p', { class: 'hero-sub', text: Fmt.money(db.allowance) + ' a day' + (Math.abs(db.carry) > 0.005 ? (db.carry > 0 ? '  +' : '  −') + Fmt.money(Math.abs(db.carry)) + ' left over' : '') })
    ]);
    var strip = el('div', { class: 'strip-holder', html: root.Charts.dayStrip(dayStripData(cycleKey)) });
    hero.appendChild(strip);
    hero.appendChild(el('div', { class: 'hero-foot' }, [
      el('span', { text: db.daysLeft + ' of ' + db.totalDays + ' days left' }),
      el('span', { text: 'Tap for the next 2 days ›' })
    ]));
    host.appendChild(hero);

    /* The joining cycle's allowance comes from a stated figure, so it will not
       reconcile with the Plan pool shown further down. Keep the facts here and
       leave the explanation to the ? sheet. */
    if (db.midCycleJoinIso) {
      host.appendChild(el('p', {
        class: 'card-note',
        text: 'Started ' + C.dateLabel(db.midCycleJoinIso) + ' · ' +
          Fmt.money(db.effectivePool) + ' over ' + db.midCycleDays +
          ' day' + (db.midCycleDays === 1 ? '' : 's')
      }));
    }

    host.appendChild(el('p', { class: 'coach', text: coachLine(db, summary) }));

    var cards = el('div', { class: 'bal-grid' }, [
      balanceCard({
        cls: 'bal-general', eyebrow: 'Spending money',
        value: Calc.monthlyBalance(),
        sub: Calc.accountsOfType('general').length + ' spending account' + (Calc.accountsOfType('general').length === 1 ? '' : 's'),
        onclick: function () { graphSheet('general'); }
      }),
      balanceCard({
        cls: 'bal-saving', eyebrow: 'Savings',
        value: Calc.savingsBalance(),
        sub: Calc.accountsOfType('saving').length + ' saving account' + (Calc.accountsOfType('saving').length === 1 ? '' : 's'),
        onclick: function () { graphSheet('saving'); }
      })
    ]);
    host.appendChild(cards);

    var pool = el('section', { class: 'card' }, [
      el('span', { class: 'eyebrow', text: 'This month\'s plan' }),
      el('ul', { class: 'kv' }, [
        row('Income', summary.plannedIncome),
        row('Commitments', -summary.plannedCommitments),
        row('Savings', -summary.plannedSavings),
        row('Left to spend', summary.pool, true)
      ]),
      el('div', { class: 'kv-split' }),
      el('ul', { class: 'kv' }, [
        row('Spent so far', -summary.actualSpent),
        row('Of that, from the Plan', -summary.checklistSpent)
      ])
    ]);
    host.appendChild(pool);

    if (!root.S.accounts.length) {
      host.appendChild(UI.emptyState(
        'No accounts yet',
        'Monthly Balance and Savings Balance are live sums of your accounts. Add your main spending account to switch them on.',
        'Add an account', function () { root.Forms.account(); }
      ));
    }
  }

  function row(label, value, strong) {
    return el('li', { class: strong ? 'kv-strong' : '' }, [
      el('span', { text: label }),
      el('b', { class: 'num' + (value < 0 ? ' neg' : ''), text: Fmt.money(value) })
    ]);
  }

  root.TabHome = { render: render, graphSheet: graphSheet };
})(typeof self !== 'undefined' ? self : globalThis);
