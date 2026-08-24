/* onboarding.js — cycle first, accounts second, plan third. Getting the cycle
   and the starting balances right is the whole point (spec 11).

   Step 4 is the mid-cycle question: someone installing on day 20 has neither a
   full cycle's pool left nor a full cycle's days to spend it over, so we ask
   what is actually left and let Calc.midCycle() spread that instead. It is
   skipped entirely when today IS the first day of the cycle. */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, Calc = root.Calc, Fmt = root.Fmt, C = root.Cycles;

  /* The join date budgeting actually began on, for the question's maths. */
  function joinDate() {
    var st = (root.S && root.S.settings) || {};
    return st.midCycleJoinDate || st.budgetStartDate || C.iso(C.today());
  }

  /* Step 4 is only meaningful while the user is still IN the cycle they joined.
     Someone re-running the guide months later is not joining mid-cycle any
     more, and re-flooring carryInto() at today would silently discard the
     carry-over they have built up since. */
  function midCycleApplies() {
    var join = joinDate();
    return C.isMidCycle(C.iso(C.today())) &&
      C.isMidCycle(join) &&
      C.getMonthKey(join) === C.currentCycleKey();
  }

  /* Step 4 drops out of the flow — and out of the dots — when it does not apply. */
  function visibleSteps() {
    return midCycleApplies() ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 5];
  }

  function progressDots(step) {
    var vis = visibleSteps(), at = vis.indexOf(step);
    var wrap = el('div', { class: 'dots' });
    vis.forEach(function (s, i) {
      wrap.appendChild(el('span', { class: 'dot' + (i === at ? ' on' : (i < at ? ' done' : '')) }));
    });
    return wrap;
  }

  function existingList(accs) {
    if (!accs.length) return el('p', { class: 'card-note', text: 'None added yet.' });
    var ul = el('ul', { class: 'mini-list' });
    accs.forEach(function (a) {
      ul.appendChild(el('li', {}, [
        el('span', { text: a.icon + ' ' + a.name }),
        el('b', { class: 'num', text: Fmt.money(Calc.accountBalance(a.id)) })
      ]));
    });
    return ul;
  }

  function summaryRow(label, value) {
    return el('div', { class: 'ob-sum-row' }, [
      el('span', { class: 'eyebrow', text: label }),
      el('b', { class: 'num', text: Fmt.money(value) })
    ]);
  }

  /* ---------- the mid-cycle question ------------------------------------- */

  /* Appends the whole question to `body`. Used by onboarding step 4 and by the
     standalone sheet that Settings and the once-only boot prompt open, so the
     wording and the maths can never drift apart. opts.onDone(saved) fires
     after whichever button was pressed has persisted. */
  function midCycleQuestion(body, opts) {
    opts = opts || {};
    var joinIso = opts.joinIso || C.iso(C.today());
    var range = C.getCycleRangeForKey(C.getMonthKey(joinIso));
    var days = C.daysToCycleEnd(joinIso);
    var endLabel = C.dateLabel(range.endIso);

    body.appendChild(el('h3', { class: 'ob-title', text: 'You are starting part-way through' }));
    body.appendChild(el('p', { class: 'ob-copy', text: 'This month runs to ' + endLabel + '. That is ' + days + ' day' + (days === 1 ? '' : 's') + ' left, counting today.' }));
    body.appendChild(el('p', { class: 'ob-copy', text: 'Your Plan is for a whole month, and most of this one is already gone. So for this first month we use what you really have, not what the Plan says.' }));

    var suggested = Math.max(0, Calc.suggestMidCycleRemaining(joinIso));
    var amount = el('input', { class: 'input input-amount' });
    root.CentInput.bind(amount, suggested || '');
    body.appendChild(UI.field('Money left until ' + endLabel, amount));

    body.appendChild(el('p', { class: 'ob-copy', text: 'We guessed ' + Fmt.money(suggested) + ' from your spending accounts. That counts every cent as yours to spend — take out any rent, bills or instalments you still have to pay before ' + endLabel + '.' }));

    var rate = el('p', { class: 'ob-copy strong' });
    function paintRate() {
      var v = root.CentInput.value(amount);
      rate.textContent = 'That is ' + Fmt.money(v / days) + ' a day until ' + endLabel + '.';
    }
    amount.addEventListener('input', paintRate);
    paintRate();
    body.appendChild(rate);

    function done(patch) {
      root.Actions.saveSettings(patch).then(function () {
        if (opts.onDone) opts.onDone(patch.midCycleMode === 'remaining');
      });
    }

    body.appendChild(el('button', {
      class: 'btn btn-primary btn-block', text: 'Use this for the rest of the month',
      onclick: function () {
        done({
          midCycleMode: 'remaining',
          midCycleJoinDate: joinIso,
          midCycleRemaining: root.CentInput.value(amount),
          midCycleAsked: true
        });
      }
    }));
    body.appendChild(el('button', {
      class: 'btn btn-ghost btn-block', text: 'I already spent my share — use the normal amount',
      onclick: function () { done({ midCycleMode: 'prorate', midCycleAsked: true }); }
    }));
    body.appendChild(el('p', { class: 'sheet-note', text: 'You can change this later in Settings, under Your first month.' }));
  }

  /* Standalone version for Settings and for the once-only prompt at boot. */
  function openMidCycleSheet(opts) {
    opts = opts || {};
    return UI.sheet({
      title: 'Your first month',
      render: function (body, api) {
        midCycleQuestion(body, {
          joinIso: opts.joinIso,
          onDone: function (spread) {
            api.close();
            UI.toast(spread ? 'Daily budget set for the rest of the month' : 'Using the normal amount');
          }
        });
      }
    });
  }

  /* Installed part-way through the cycle they are STILL in, and never asked.
     Deliberately not fired for an older join date: re-spreading a historical
     cycle would rewrite carry-over that has already flowed through everything
     since. Those users can still set it from Settings. */
  function midCyclePending() {
    var s = (root.S && root.S.settings) || {};
    if (!s.onboarded || s.midCycleAsked) return false;
    if ((s.midCycleMode || 'prorate') !== 'prorate') return false;
    if (!(s.midCycleJoinDate || s.budgetStartDate)) return false;
    return midCycleApplies();
  }

  /* ---------- the guide -------------------------------------------------- */

  function open(startStep) {
    var step = startStep || 0;
    var s = UI.sheet({
      title: 'Set up Poket Daily',
      render: function (body, api) { paint(body, api); }
    });

    function paint(body, api) {
      body.innerHTML = '';
      body.appendChild(progressDots(step));

      if (step === 0) {
        body.appendChild(el('h3', { class: 'ob-title', text: 'Two kinds of number' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'Spending money and Savings show what you really have — added straight up from your accounts.' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'The daily budget on Home is a guess based on your Plan. Different thing, different number.' }));
        body.appendChild(el('p', { class: 'ob-copy strong', text: 'Do accounts first, then the Plan. Skip the accounts and those totals will show zero later.' }));
        next(body, api, 'Next: your money month');
      }

      if (step === 1) {
        body.appendChild(el('h3', { class: 'ob-title', text: 'When does your money month start?' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'Payday, not the 1st, for most people. Put 25 if your month runs 25th to 24th. Every figure in the app counts from this day.' }));

        var day = el('input', {
          class: 'input', type: 'number', min: '1', max: '31',
          value: root.S.settings.cycleStartDay
        });
        var preview = el('p', { class: 'ob-copy strong' });
        function clamped() { return Math.min(31, Math.max(1, parseInt(day.value, 10) || 1)); }
        /* Previewing needs cycleStartDay live, so save on the way out, but
           label from the typed value rather than from settings. */
        function paintPreview() {
          var d = clamped();
          var was = root.S.settings.cycleStartDay;
          root.S.settings.cycleStartDay = d;
          preview.textContent = 'This cycle: ' + C.cycleLabel(C.currentCycleKey()) + '.';
          root.S.settings.cycleStartDay = was;
        }
        day.addEventListener('input', paintPreview);
        paintPreview();
        body.appendChild(UI.field('Money month starts on day', day,
          'Pick 29, 30 or 31 and a short month uses its last day — same as the bank paying you early.'));
        body.appendChild(preview);

        body.appendChild(el('button', {
          class: 'btn btn-primary btn-block', text: 'Next: accounts',
          onclick: function () {
            root.Actions.saveSettings({ cycleStartDay: clamped() }).then(function () {
              advance(body, api);
            });
          }
        }));
        skipRow(body, api);
      }

      if (step === 2) {
        var gens = Calc.accountsOfType('general');
        body.appendChild(el('h3', { class: 'ob-title', text: 'Add your main spending account' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'Current account, wallet, e-wallet — whatever you actually pay with every day.' }));
        body.appendChild(el('p', { class: 'ob-copy strong', text: 'Check your bank app now and put in what is really there. That becomes your spending money.' }));
        body.appendChild(existingList(gens));
        body.appendChild(el('button', {
          class: 'btn btn-primary btn-block', text: gens.length ? '+ Add another spending account' : '+ Add spending account',
          onclick: function () {
            root.Forms.account(null, { type: 'general', onSaved: function () { paint(body, api); } });
          }
        }));
        if (gens.length) next(body, api, 'Next: savings');
        else skipRow(body, api);
      }

      if (step === 3) {
        var savs = Calc.accountsOfType('saving');
        body.appendChild(el('h3', { class: 'ob-title', text: 'Keep savings separate?' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'ASB, fixed deposit, digital bank, tabung — put it here and it counts as savings. Optional.' }));
        body.appendChild(existingList(savs));
        body.appendChild(el('button', {
          class: 'btn btn-ghost btn-block', text: savs.length ? '+ Add another saving account' : '+ Add saving account',
          onclick: function () {
            root.Forms.account(null, { type: 'saving', onSaved: function () { paint(body, api); } });
          }
        }));
        next(body, api, midCycleApplies() ? 'Next: this month' : 'Next: your plan');
      }

      if (step === 4) {
        midCycleQuestion(body, {
          joinIso: joinDate(),
          onDone: function () { advance(body, api); }
        });
      }

      if (step === 5) {
        body.appendChild(el('h3', { class: 'ob-title', text: 'Now set up your Plan' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'Income, commitments and savings. Each one goes to an account you just added.' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'This is what the daily budget is worked out from — separate from the account totals you just put in.' }));
        body.appendChild(el('div', { class: 'ob-summary' }, [
          summaryRow('Monthly Balance', Calc.monthlyBalance()),
          summaryRow('Savings Balance', Calc.savingsBalance())
        ]));
        body.appendChild(el('button', {
          class: 'btn btn-primary btn-block', text: 'Open the Plan tab',
          onclick: function () {
            finish();
            api.close();
            root.App.go('plan');
          }
        }));
        body.appendChild(el('button', {
          class: 'btn btn-ghost btn-block', text: 'Do this later',
          onclick: function () { finish(); api.close(); }
        }));
      }
    }

    function advance(body, api) {
      var vis = visibleSteps();
      var at = vis.indexOf(step);
      step = vis[Math.min(at + 1, vis.length - 1)];
      paint(body, api);
    }

    function next(body, api, label) {
      body.appendChild(el('button', {
        class: 'btn btn-primary btn-block', text: label,
        onclick: function () { advance(body, api); }
      }));
      /* intro, cycle, spending and saving are all skippable — the plan
         hand-off and the mid-cycle question have their own way out. */
      if (step < 4) skipRow(body, api);
    }

    function skipRow(body, api) {
      body.appendChild(el('button', {
        class: 'btn btn-ghost btn-block btn-sm', text: 'Skip setup',
        onclick: function () {
          UI.confirm({
            title: 'Skip account setup?',
            message: 'Your totals will show zero until you add accounts with real amounts. You can run this guide again from Settings.',
            confirmLabel: 'Skip anyway'
          }).then(function (ok) { if (ok) { finish(); api.close(); } });
        }
      }));
    }

    /* Only step 4 latches midCycleAsked, so someone who skips the guide still
       gets the question once from the boot prompt. */
    function finish() {
      root.Actions.saveSettings({ onboarded: true });
    }

    return s;
  }

  root.Onboarding = {
    open: open,
    midCycle: openMidCycleSheet,
    midCyclePending: midCyclePending,
    midCycleQuestion: midCycleQuestion
  };
})(typeof self !== 'undefined' ? self : globalThis);
