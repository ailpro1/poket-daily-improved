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
    if (!root.S.accounts.length) return 'Add your accounts first — Monthly Balance reads straight from them.';
    /* Ahead of the no-Plan line: a mid-cycle joiner has a real budget from the
       figure they stated, even with an empty Plan. */
    if (db.midCycleJoinIso && !summary.plannedIncome) {
      return 'Running on what you had left when you started. Set up your Plan for ' +
        C.cycleLabel(C.shiftCycleKey(db.cycleKey, 1)) + ' onwards.';
    }
    if (!summary.plannedIncome) return 'Set up your Plan to turn on the daily budget.';
    if (db.carry < -0.5) return 'You are ' + Fmt.money(Math.abs(db.carry)) + ' behind your plan. Today\'s figure already absorbs it.';
    if (db.carry > 0.5) return Fmt.money(db.carry) + ' rolled over from earlier days, so today has more room.';
    if (db.left < 0) return 'Today is spent. Tomorrow starts ' + Fmt.money(Math.abs(db.left)) + ' down.';
    return 'On plan. ' + db.daysLeft + ' day' + (db.daysLeft === 1 ? '' : 's') + ' left in this cycle.';
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
          el('span', { text: isSaving ? 'Savings Balance' : 'Monthly Balance' }),
          el('b', { class: 'num', text: Fmt.money(isSaving ? Calc.savingsBalance() : Calc.monthlyBalance()) })
        ]));
        body.appendChild(list);
      }
    });
  }

  function render(host) {
    var cycleKey = root.App.cycleKey();
    var db = Calc.dailyBudget();
    var summary = Calc.cycleSummary(cycleKey);
    host.innerHTML = '';

    var hero = el('section', { class: 'hero' + (db.left < 0 ? ' hero-over' : '') }, [
      el('span', { class: 'eyebrow', text: 'Safe to spend today · forecast' }),
      el('p', { class: 'hero-value', text: Fmt.money(db.left) }),
      el('p', { class: 'hero-sub', text: Fmt.money(db.allowance) + ' a day' + (Math.abs(db.carry) > 0.005 ? (db.carry > 0 ? '  +' : '  −') + Fmt.money(Math.abs(db.carry)) + ' carried over' : '') })
    ]);
    var strip = el('div', { class: 'strip-holder', html: root.Charts.dayStrip(dayStripData(cycleKey)) });
    hero.appendChild(strip);
    hero.appendChild(el('div', { class: 'hero-foot' }, [
      el('span', { text: C.cycleLabel(cycleKey) }),
      el('span', { text: db.daysLeft + ' of ' + db.totalDays + ' days left' })
    ]));
    host.appendChild(hero);

    /* The joining cycle's allowance comes from a stated figure, so it will not
       reconcile with the Plan pool shown further down. Say why. */
    if (db.midCycleJoinIso) {
      host.appendChild(el('p', {
        class: 'card-note',
        text: 'Started ' + C.dateLabel(db.midCycleJoinIso) + ' · spreading the ' +
          Fmt.money(db.effectivePool) + ' you had left over ' + db.midCycleDays +
          ' day' + (db.midCycleDays === 1 ? '' : 's') + '. Your Plan takes over on ' +
          C.dateLabel(C.getCycleRangeForKey(C.shiftCycleKey(db.cycleKey, 1)).startIso) + '.'
      }));
    }

    host.appendChild(el('p', { class: 'coach', text: coachLine(db, summary) }));

    var cards = el('div', { class: 'bal-grid' }, [
      balanceCard({
        cls: 'bal-general', eyebrow: 'Monthly Balance · actual',
        value: Calc.monthlyBalance(),
        sub: Calc.accountsOfType('general').length + ' spending account' + (Calc.accountsOfType('general').length === 1 ? '' : 's'),
        onclick: function () { graphSheet('general'); }
      }),
      balanceCard({
        cls: 'bal-saving', eyebrow: 'Savings Balance · actual',
        value: Calc.savingsBalance(),
        sub: Calc.accountsOfType('saving').length + ' saving account' + (Calc.accountsOfType('saving').length === 1 ? '' : 's'),
        onclick: function () { graphSheet('saving'); }
      })
    ]);
    host.appendChild(cards);

    var pool = el('section', { class: 'card' }, [
      el('span', { class: 'eyebrow', text: 'This cycle, planned' }),
      el('ul', { class: 'kv' }, [
        row('Income', summary.plannedIncome),
        row('Commitments', -summary.plannedCommitments),
        row('Savings', -summary.plannedSavings),
        row('Left to live on', summary.pool, true)
      ]),
      el('div', { class: 'kv-split' }),
      el('ul', { class: 'kv' }, [
        row('Spent so far (all logged)', -summary.actualSpent),
        row('Of that, ticked off Plan', -summary.checklistSpent)
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
