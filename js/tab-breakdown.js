/* tab-breakdown.js — category view, built on Calc.categoryTotals (spec 3.8). */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, Calc = root.Calc, Fmt = root.Fmt, C = root.Cycles;
  var kind = 'expense';

  function render(host) {
    var cycleKey = root.App.cycleKey();
    var r = C.getCycleRangeForKey(cycleKey);
    var data = Calc.categoryTotals(r.startIso, r.endIso, kind);
    host.innerHTML = '';

    host.appendChild(UI.segmented(
      [{ value: 'expense', label: 'Money out' }, { value: 'income', label: 'Money in' }],
      kind, function (v) { kind = v; root.App.refresh(); }
    ));

    host.appendChild(el('section', { class: 'card' }, [
      el('div', {
        class: 'chart-holder', html: root.Charts.doughnut(data.items, {
          size: 200,
          centerTop: Fmt.moneyShort(data.total),
          centerSub: kind === 'expense' ? 'spent' : 'received'
        })
      }),
      el('p', { class: 'card-note', text: 'Excludes transfers and items ticked off your Plan — the same rule the daily budget uses, so this total always matches.' })
    ]));

    if (!data.items.length) {
      host.appendChild(UI.emptyState('Nothing to break down',
        'Log a few transactions with categories and they show up here.', 'Log a transaction',
        function () { root.Forms.transaction(); }));
      return;
    }

    var list = el('ul', { class: 'cat-list' });
    data.items.forEach(function (c, i) {
      list.appendChild(el('li', { class: 'cat-row' }, [
        el('span', { class: 'cat-dot', style: 'background:var(--cat-' + (i % 8) + ')' }),
        el('span', { class: 'cat-main' }, [
          el('span', { class: 'cat-name', text: c.name }),
          el('span', { class: 'log-meta', text: Math.round(c.share * 100) + '% · ' + c.count + ' item' + (c.count === 1 ? '' : 's') })
        ]),
        el('b', { class: 'num', text: Fmt.money(c.amount) })
      ]));
    });
    host.appendChild(list);

    var bars = el('section', { class: 'card' }, [el('span', { class: 'eyebrow', text: 'Share of ' + (kind === 'expense' ? 'spending' : 'income') })]);
    data.items.forEach(function (c, i) {
      bars.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bar-label', text: c.name }),
        el('span', { class: 'bar-track' }, [
          el('span', { class: 'bar-fill', style: 'width:' + Math.max(2, c.share * 100) + '%;background:var(--cat-' + (i % 8) + ')' })
        ])
      ]));
    });
    host.appendChild(bars);
  }

  root.TabBreakdown = { render: render };
})(typeof self !== 'undefined' ? self : globalThis);
