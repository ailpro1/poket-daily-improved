/* tab-breakdown.js — where the cycle's money went.

   Two deliberately different halves, because the daily budget draws the same
   line (see the double-counting rule in the README):

     Spendable  — discretionary spend by category, via Calc.categoryTotals().
                  Excludes anything ticked off the Plan, so on its own it can
                  never account for a whole cycle.
     Committed  — the other half: Plan commitments and savings per item, via
                  Calc.planBreakdown(). Income is excluded — it is money
                  arriving, not money going somewhere.

   Money in stays as the logged-income view it always was. */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, Calc = root.Calc, Fmt = root.Fmt, C = root.Cycles;
  var view = 'spendable';

  var SECTION_LABEL = { commitments: 'Commitment', savings: 'Savings' };

  function chartCard(items, centerTop, centerSub, note) {
    return el('section', { class: 'card' }, [
      el('div', {
        class: 'chart-holder',
        html: root.Charts.doughnut(items, { size: 200, centerTop: centerTop, centerSub: centerSub })
      }),
      el('p', { class: 'card-note', text: note })
    ]);
  }

  /* Shared list + share-bar rendering. `meta` builds each row's sub-line. */
  function itemList(items, meta) {
    var list = el('ul', { class: 'cat-list' });
    items.forEach(function (c, i) {
      list.appendChild(el('li', { class: 'cat-row' }, [
        el('span', { class: 'cat-dot', style: 'background:var(--cat-' + (i % 8) + ')' }),
        el('span', { class: 'cat-main' }, [
          el('span', { class: 'cat-name', text: c.name }),
          el('span', { class: 'log-meta', text: meta(c) })
        ]),
        el('b', { class: 'num', text: Fmt.money(c.amount) })
      ]));
    });
    return list;
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

  /* ---------- logged transactions, by category --------------------------- */

  function renderLogged(host, cycleKey, kind) {
    var r = C.getCycleRangeForKey(cycleKey);
    var data = Calc.categoryTotals(r.startIso, r.endIso, kind);
    var spending = kind === 'expense';

    host.appendChild(chartCard(
      data.items, Fmt.moneyShort(data.total), spending ? 'spendable' : 'received',
      spending
        ? 'Day-to-day spending only. Anything ticked off your Plan sits under Committed instead — the same rule the daily budget uses, so this total always matches.'
        : 'Income you logged yourself. Planned income you ticked off the checklist is not counted twice.'
    ));

    if (!data.items.length) {
      host.appendChild(UI.emptyState('Nothing to break down',
        'Log a few transactions with categories and they show up here.', 'Log a transaction',
        function () { root.Forms.transaction(); }));
      return;
    }

    host.appendChild(itemList(data.items, function (c) {
      return Math.round(c.share * 100) + '% · ' + c.count + ' item' + (c.count === 1 ? '' : 's');
    }));
    host.appendChild(shareBars(data.items, 'Share of ' + (spending ? 'spending' : 'income')));
  }

  /* ---------- committed money, by plan item ------------------------------ */

  function renderCommitted(host, cycleKey) {
    var data = Calc.planBreakdown(cycleKey);

    host.appendChild(chartCard(
      data.items, Fmt.moneyShort(data.total), 'committed',
      'Commitments and savings from your Plan for this cycle. The daily budget already subtracts all of it, which is why none of it shows under Spendable.'
    ));

    if (!data.items.length) {
      host.appendChild(UI.emptyState('Nothing committed this cycle',
        'Add commitments and savings goals to your Plan and they show up here.', 'Open the Plan tab',
        function () { root.App.go('plan'); }));
      return;
    }

    /* Committed money splits again: what has actually left the account this
       cycle, and what is still to come. */
    host.appendChild(el('section', { class: 'card totals' }, [
      el('div', { class: 'totals-row' }, [
        el('div', { class: 'stat' }, [
          el('span', { class: 'eyebrow', text: 'Ticked off' }),
          el('b', { class: 'num stat-value', text: Fmt.money(data.paid) })
        ]),
        el('div', { class: 'stat' }, [
          el('span', { class: 'eyebrow', text: 'Still to pay' }),
          el('b', { class: 'num stat-value', text: Fmt.money(data.unpaid) })
        ])
      ]),
      el('div', { class: 'kv-split' }),
      el('div', { class: 'totals-row' }, [
        el('div', { class: 'stat' }, [
          el('span', { class: 'eyebrow', text: 'Commitments' }),
          el('b', { class: 'num stat-value', text: Fmt.money(data.commitments) })
        ]),
        el('div', { class: 'stat' }, [
          el('span', { class: 'eyebrow', text: 'Savings' }),
          el('b', { class: 'num stat-value', text: Fmt.money(data.savings) })
        ])
      ]),
      el('button', {
        class: 'btn btn-ghost btn-block', text: 'Open checklist',
        onclick: function () { root.Checklist.open(); }
      })
    ]));

    host.appendChild(itemList(data.items, function (c) {
      return SECTION_LABEL[c.section] + ' · ' + Math.round(c.share * 100) + '% · ' +
        (c.paid ? 'ticked off' : 'not yet paid');
    }));
    host.appendChild(shareBars(data.items, 'Share of committed money'));
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
    else renderLogged(host, cycleKey, view === 'income' ? 'income' : 'expense');
  }

  root.TabBreakdown = { render: render };
})(typeof self !== 'undefined' ? self : globalThis);
