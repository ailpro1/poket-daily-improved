/* tab-log.js — the full transaction log. */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, C = root.Cycles, Calc = root.Calc, Fmt = root.Fmt;
  var filters = { type: 'all', categoryId: 'all' };

  function typeLabel(l) {
    if (l.type === 'transfer_in') return 'In from ' + accName(l.transferCounterpartAccountId);
    if (l.type === 'transfer_out') return 'Out to ' + accName(l.transferCounterpartAccountId);
    return l.categoryName || (l.type === 'income' ? 'Income' : 'Uncategorised');
  }

  function accName(id) {
    var a = Calc.account(id);
    return a ? a.name : 'closed account';
  }

  function render(host) {
    var cycleKey = root.App.cycleKey();
    var r = C.getCycleRangeForKey(cycleKey);
    var summary = Calc.cycleSummary(cycleKey);
    host.innerHTML = '';

    /* Cycle in-and-out only. The live account balances belong on Accounts,
       next to the cards they are the sum of. */
    host.appendChild(el('section', { class: 'card totals' }, [
      el('div', { class: 'totals-row' }, [
        stat('In this cycle', summary.actualIncome, 'pos'),
        stat('Out this cycle', summary.actualSpent, 'neg')
      ])
    ]));

    var bar = el('div', { class: 'filter-bar' });
    bar.appendChild(UI.select(
      [{ value: 'all', label: 'All types' }, { value: 'expense', label: 'Money out' },
      { value: 'income', label: 'Money in' }, { value: 'transfer', label: 'Transfers' }],
      filters.type, { class: 'input input-sm', onchange: function (e) { filters.type = e.target.value; root.App.refresh(); } }
    ));
    var cats = [{ value: 'all', label: 'All categories' }]
      .concat((root.S.settings.categories.expense || []).concat(root.S.settings.categories.income || [])
        .map(function (c) { return { value: c.id, label: c.name }; }));
    bar.appendChild(UI.select(cats, filters.categoryId, {
      class: 'input input-sm', onchange: function (e) { filters.categoryId = e.target.value; root.App.refresh(); }
    }));
    host.appendChild(bar);

    var logs = Calc.logsInRange(r.startIso, r.endIso, function (l) {
      if (filters.type === 'transfer' && !Calc.isTransfer(l)) return false;
      if (filters.type !== 'all' && filters.type !== 'transfer' && l.type !== filters.type) return false;
      if (filters.categoryId !== 'all' && l.categoryId !== filters.categoryId) return false;
      return true;
    });

    if (!logs.length) {
      host.appendChild(UI.emptyState('Nothing logged in this cycle',
        'Tap the + button to log what you spent.', 'Log a transaction',
        function () { root.Forms.transaction(); }));
      return;
    }

    var list = el('ul', { class: 'log-list' });
    var lastDate = null;
    logs.forEach(function (l) {
      if (l.date !== lastDate) {
        lastDate = l.date;
        list.appendChild(el('li', { class: 'log-day' }, [
          el('span', { text: C.dateLabel(l.date) }),
          el('span', { class: 'num', text: Fmt.money(dayNet(l.date, logs)) })
        ]));
      }
      list.appendChild(logRow(l));
    });
    host.appendChild(list);
  }

  function dayNet(iso, logs) {
    return Fmt.round2(logs.filter(function (l) { return l.date === iso && !Calc.isTransfer(l); })
      .reduce(function (t, l) { return t + Calc.signedAmount(l); }, 0));
  }

  function logRow(l) {
    var neg = Calc.sign(l) < 0;
    var tags = [];
    if (l.spreadType === 'spread') tags.push('spread');
    if (l.sourceChecklistId) tags.push('from Plan');
    return el('li', {
      class: 'log-row', tabindex: '0', role: 'button',
      onclick: function () {
        if (Calc.isTransfer(l)) return transferSheet(l);
        root.Forms.transaction(l);
      },
      onkeydown: function (e) { if (e.key === 'Enter') e.target.click(); }
    }, [
      el('span', { class: 'log-icon', text: (Calc.account(l.accountId) || {}).icon || '•' }),
      el('span', { class: 'log-main' }, [
        el('span', { class: 'log-name', text: l.name }),
        el('span', { class: 'log-meta', text: typeLabel(l) + ' · ' + accName(l.accountId) + (tags.length ? ' · ' + tags.join(' · ') : '') })
      ]),
      el('span', { class: 'num log-amt' + (neg ? ' neg' : ' pos'), text: (neg ? '−' : '+') + Fmt.money(Math.abs(l.amount)) })
    ]);
  }

  function transferSheet(l) {
    UI.sheet({
      title: 'Transfer',
      render: function (body, s) {
        body.appendChild(el('p', { class: 'sheet-note', text: l.name + ' · ' + Fmt.money(Math.abs(l.amount)) + ' · ' + C.dateLabel(l.date) }));
        body.appendChild(el('p', { class: 'sheet-note', text: 'Between ' + accName(l.accountId) + ' and ' + accName(l.transferCounterpartAccountId) + '. Deleting removes both halves so the two balances stay in step.' }));
        body.appendChild(el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'btn btn-ghost btn-danger-text', text: 'Delete transfer',
            onclick: function () { s.close(); root.Actions.deleteLog(l.id); }
          })
        ]));
      }
    });
  }

  function stat(label, value, tone) {
    return el('div', { class: 'stat' }, [
      el('span', { class: 'eyebrow', text: label }),
      el('b', { class: 'num stat-value ' + tone, text: Fmt.money(value) })
    ]);
  }

  root.TabLog = { render: render };
})(typeof self !== 'undefined' ? self : globalThis);
