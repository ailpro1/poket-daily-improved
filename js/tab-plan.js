/* tab-plan.js — the budget plan that powers the Daily Spending Budget. */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, Calc = root.Calc, Fmt = root.Fmt, C = root.Cycles;

  var LABELS = {
    income: { title: 'Income', add: 'Add income' },
    commitments: { title: 'Commitments', add: 'Add commitment' },
    savings: { title: 'Savings', add: 'Add savings goal' }
  };

  function section(name, cycleKey) {
    var items = Calc.planItemsSorted(name, cycleKey);   /* biggest first */
    var total = Calc.planTotal(name, cycleKey);
    var wrap = el('section', { class: 'card plan-sec plan-' + name });
    wrap.appendChild(el('div', { class: 'sec-head' }, [
      el('span', { class: 'eyebrow', text: LABELS[name].title + ' (' + items.length + ')' }),
      el('b', { class: 'num', text: Fmt.money(total) })
    ]));

    if (!items.length) {
      wrap.appendChild(el('p', { class: 'card-note', text: 'Nothing here yet.' }));
    } else {
      var list = el('ul', { class: 'plan-list' });
      items.forEach(function (it) {
        var amt = Calc.planAmount(it, cycleKey);
        var overridden = (it.cycleOverrides || {})[cycleKey] != null;
        var ended = it.endMonth && cycleKey > it.endMonth;
        var due = it.dueType === 'date' && it.dueDate ? C.dateLabel(it.dueDate) : 'day ' + (it.dueDay || 1);
        var acc = Calc.account(it.accountId);
        list.appendChild(el('li', {
          class: 'plan-row' + (ended ? ' plan-ended' : ''), tabindex: '0', role: 'button',
          onclick: function () { root.Forms.planItem(name, it); },
          onkeydown: function (e) { if (e.key === 'Enter') e.target.click(); }
        }, [
          el('span', { class: 'plan-main' }, [
            el('span', { class: 'plan-name', text: it.name }),
            el('span', { class: 'log-meta', text: (acc ? acc.icon + ' ' + acc.name : 'no account') + ' · due ' + due + (ended ? ' · ended' : '') })
          ]),
          el('span', { class: 'num plan-amt' + (overridden ? ' tweaked' : ''), text: Fmt.money(amt) })
        ]));
      });
      wrap.appendChild(list);
    }

    wrap.appendChild(el('button', {
      class: 'btn btn-ghost btn-block', text: '+ ' + LABELS[name].add,
      onclick: function () { root.Forms.planItem(name); }
    }));
    return wrap;
  }

  function render(host) {
    var cycleKey = root.App.cycleKey();
    host.innerHTML = '';

    var pool = Calc.cyclePool(cycleKey);
    var per = Calc.dailyAllowance(cycleKey);
    host.appendChild(el('section', { class: 'card plan-hero' }, [
      el('span', { class: 'eyebrow', text: 'Plan for ' + C.cycleLabel(cycleKey) }),
      el('p', { class: 'plan-pool num', text: Fmt.money(pool) }),
      el('p', { class: 'card-note', text: 'Left to live on after commitments and savings — ' + Fmt.money(per) + ' a day. This drives the forecast on Home, not your account balances.' })
    ]));

    ['income', 'commitments', 'savings'].forEach(function (s) {
      host.appendChild(section(s, cycleKey));
    });

    host.appendChild(el('button', {
      class: 'btn btn-ghost btn-block', text: 'Open checklist',
      onclick: function () { root.Checklist.open(); }
    }));
  }

  root.TabPlan = { render: render };
})(typeof self !== 'undefined' ? self : globalThis);
