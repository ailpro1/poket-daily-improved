/* tab-breakdown.js — where the cycle's money went, and where it came from.

   Three views, drawn from three different halves of the same rule (the
   double-counting rule in the README):

     Spendable  discretionary spend by category — Calc.categoryTotals().
                Excludes anything ticked off the Plan, so on its own it can
                never account for a whole cycle.
     Committed  the other half of money out: Plan commitments and savings per
                item, with what has been ticked off — Calc.planBreakdown().
     Money in   planned income per item PLUS anything logged by hand —
                Calc.incomeBreakdown(). A ticked-off plan item is counted
                once, as the item; its checklist log stays excluded.

   Every chart is tappable: pick a slice or a row and the middle of the
   doughnut reads that one back. */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, Calc = root.Calc, Fmt = root.Fmt, C = root.Cycles;
  var view = 'spendable';

  var SECTION_LABEL = { commitments: 'Commitment', savings: 'Savings' };

  /* Long names would run out of a 200px doughnut. */
  function fitCentre(name) {
    var n = String(name || '');
    return n.length > 15 ? n.slice(0, 14) + '…' : n;
  }

  /* Ties one doughnut to one list so a tap on either highlights both, and
     the centre of the chart reads back whatever is selected. */
  function makeChart(items, centreTop, centreSub, note, rowMeta) {
    var holder = el('div', {
      class: 'chart-holder',
      html: root.Charts.doughnut(items, { size: 200, centerTop: centreTop, centerSub: centreSub })
    });
    var card = el('section', { class: 'card' }, [holder]);
    var list = el('ul', { class: 'cat-list' });

    var svg = holder.querySelector('.doughnut');
    var top = svg && svg.querySelector('.dn-top');
    var sub = svg && svg.querySelector('.dn-sub');
    var slices = svg ? UI.$$('.slice', svg) : [];
    var rows = [];
    var picked = -1;

    function paint() {
      if (svg) svg.classList.toggle('has-sel', picked >= 0);
      slices.forEach(function (p, i) { p.classList.toggle('on', i === picked); });
      rows.forEach(function (rw, i) {
        rw.classList.toggle('on', i === picked);
        rw.setAttribute('aria-pressed', i === picked ? 'true' : 'false');
      });
      if (!top || !sub) return;
      if (picked < 0) {
        top.textContent = centreTop;
        sub.textContent = centreSub;
      } else {
        top.textContent = Fmt.moneyShort(items[picked].amount);
        sub.textContent = fitCentre(items[picked].name);
      }
    }

    /* Tapping the same thing twice clears it, so there is always a way back
       to the total without hunting for a close button. */
    function pick(i) { picked = (picked === i) ? -1 : i; paint(); }

    slices.forEach(function (p, i) {
      p.addEventListener('click', function () { pick(i); });
      p.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); }
      });
    });

    items.forEach(function (c, i) {
      var rw = el('li', {
        class: 'cat-row tappable', tabindex: '0', role: 'button', 'aria-pressed': 'false',
        onclick: function () { pick(i); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); } }
      }, [
        el('span', { class: 'cat-dot', style: 'background:var(--cat-' + (i % 8) + ')' }),
        el('span', { class: 'cat-main' }, [
          el('span', { class: 'cat-name', text: c.name }),
          el('span', { class: 'log-meta', text: rowMeta(c) })
        ]),
        el('b', { class: 'num', text: Fmt.money(c.amount) })
      ]);
      rows.push(rw);
      list.appendChild(rw);
    });

    if (items.length) card.appendChild(el('p', { class: 'cat-hint', text: 'Tap a slice to read it on its own.' }));
    card.appendChild(el('p', { class: 'card-note', text: note }));
    paint();
    return { card: card, list: list };
  }

  function shareBars(items, title) {
    var bars = el('section', { class: 'card' }, [el('span', { class: 'eyebrow', text: title })]);
    items.forEach(function (c, i) {
      bars.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bar-label', text: c.name }),
        el('span', { class: 'bar-track' }, [
          el('span', {
            class: 'bar-fill',
            style: 'width:' + Math.max(2, c.share * 100) + '%;background:var(--cat-' + (i % 8) + ')'
          })
        ])
      ]));
    });
    return bars;
  }

  function statRow(pairs) {
    return el('div', { class: 'totals-row' }, pairs.map(function (p) {
      return el('div', { class: 'stat' }, [
        el('span', { class: 'eyebrow', text: p[0] }),
        el('b', { class: 'num stat-value', text: Fmt.money(p[1]) })
      ]);
    }));
  }

  function draw(host, items, centreTop, centreSub, note, rowMeta, barsTitle) {
    var built = makeChart(items, centreTop, centreSub, note, rowMeta);
    host.appendChild(built.card);
    if (!items.length) return false;
    host.appendChild(built.list);
    host.appendChild(shareBars(items, barsTitle));
    return true;
  }

  /* ---------- spendable: day-to-day spending by category ----------------- */

  function renderSpendable(host, cycleKey) {
    var r = C.getCycleRangeForKey(cycleKey);
    var data = Calc.categoryTotals(r.startIso, r.endIso, 'expense');
    var drawn = draw(host, data.items, Fmt.moneyShort(data.total), 'spendable',
      'Day-to-day spending only. Anything ticked off your Plan sits under Committed instead — the same rule the daily budget uses, so this total always matches.',
      function (c) { return Math.round(c.share * 100) + '% · ' + c.count + ' item' + (c.count === 1 ? '' : 's'); },
      'Share of spending');
    if (!drawn) {
      host.appendChild(UI.emptyState('Nothing to break down',
        'Log a few transactions with categories and they show up here.', 'Log a transaction',
        function () { root.Forms.transaction(); }));
    }
  }

  /* ---------- committed: plan commitments and savings -------------------- */

  function renderCommitted(host, cycleKey) {
    var data = Calc.planBreakdown(cycleKey);
    var drawn = draw(host, data.items, Fmt.moneyShort(data.total), 'committed',
      'Commitments and savings from your Plan for this cycle. The daily budget already subtracts all of it, which is why none of it shows under Spendable.',
      function (c) {
        return SECTION_LABEL[c.section] + ' · ' + Math.round(c.share * 100) + '% · ' +
          (c.paid ? 'ticked off' : 'not yet paid');
      },
      'Share of committed money');
    if (!drawn) {
      host.appendChild(UI.emptyState('Nothing committed this cycle',
        'Add commitments and savings goals to your Plan and they show up here.', 'Open the Plan tab',
        function () { root.App.go('plan'); }));
      return;
    }
    host.appendChild(el('section', { class: 'card totals' }, [
      statRow([['Ticked off', data.paid], ['Still to pay', data.unpaid]]),
      el('div', { class: 'kv-split' }),
      statRow([['Commitments', data.commitments], ['Savings', data.savings]]),
      el('button', {
        class: 'btn btn-ghost btn-block', text: 'Open checklist',
        onclick: function () { root.Checklist.open(); }
      })
    ]));
  }

  /* ---------- money in: planned income plus anything logged ------------- */

  function renderIncome(host, cycleKey) {
    var data = Calc.incomeBreakdown(cycleKey);
    var drawn = draw(host, data.items, Fmt.moneyShort(data.total), 'money in',
      'Your Plan\'s income alongside anything you logged by hand. A planned item you ticked off is counted once, as the item — its transaction is not added on top.',
      function (c) {
        return (c.kind === 'plan' ? 'Planned' : 'Logged') + ' · ' + Math.round(c.share * 100) + '% · ' +
          (c.received ? 'received' : 'not in yet');
      },
      'Share of money in');
    if (!drawn) {
      host.appendChild(UI.emptyState('No money in this cycle',
        'Add your income to the Plan, or log what came in.', 'Open the Plan tab',
        function () { root.App.go('plan'); }));
      return;
    }
    host.appendChild(el('section', { class: 'card totals' }, [
      statRow([['Received', data.received], ['Still to come', data.due]]),
      el('div', { class: 'kv-split' }),
      statRow([['From the Plan', data.planned], ['Logged by hand', data.unplanned]])
    ]));
  }

  function render(host) {
    var cycleKey = root.App.cycleKey();
    host.innerHTML = '';

    host.appendChild(UI.segmented(
      [{ value: 'spendable', label: 'Spendable' },
      { value: 'committed', label: 'Committed' },
      { value: 'income', label: 'Money in' }],
      view, function (v) { view = v; root.App.refresh(); }
    ));

    if (view === 'committed') renderCommitted(host, cycleKey);
    else if (view === 'income') renderIncome(host, cycleKey);
    else renderSpendable(host, cycleKey);
  }

  root.TabBreakdown = { render: render };
})(typeof self !== 'undefined' ? self : globalThis);
