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
            el('span', { class: 'plan-name-row' }, [
              el('span', { class: 'plan-name', text: it.name }),
              /* Green dot = changed for THIS month only, via cycleOverrides —
                 it reverts on its own next month, unlike an "always" edit. */
              overridden ? el('span', {
                class: 'plan-dot', 'aria-label': 'Changed for this month only', title: 'Changed for this month only'
              }) : null
            ]),
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
    var split = Calc.planSplitSummary(cycleKey);
    var overCommitted = pool < 0;
    var heroCard = el('section', { class: 'card plan-hero' }, [
      el('span', { class: 'eyebrow', text: 'Plan for ' + C.cycleLabel(cycleKey) }),
      el('p', { class: 'plan-pool num' + (overCommitted ? ' neg' : ''), text: Fmt.money(pool) }),
      el('p', {
        class: 'card-note',
        text: overCommitted
          ? 'Short by ' + Fmt.money(Math.abs(pool)) + ' — income does not cover commitments and savings this month.'
          : Fmt.money(per) + ' a day'
      })
    ]);
    /* Same bar-and-legend widget as the Total money card on Accounts — here
       it splits what is NOT left to spend between commitments and savings,
       rather than spending vs saved. Only shown once there is something to
       split; an empty Plan has nothing to draw a ratio from.

       A third segment shows what income never reached — sized off
       uncoveredShare, which is 0 whenever income covers commitments and
       savings in full, so this is the same bar as before in that case, not
       a special-cased alternate rendering. */
    if (split.commitments + split.savings > 0) {
      heroCard.appendChild(el('div', { class: 'net-bar plan-split-bar' }, [
        el('span', { class: 'net-bar-spend plan-split-commit', style: 'width:' + (split.fundedCommitmentsShare * 100).toFixed(1) + '%' }),
        el('span', { class: 'net-bar-save', style: 'width:' + (split.fundedSavingsShare * 100).toFixed(1) + '%' }),
        el('span', { class: 'plan-split-uncovered', style: 'width:' + (split.uncoveredShare * 100).toFixed(1) + '%' })
      ]));
      var legend = el('div', { class: 'net-legend' }, [
        el('span', {}, [
          el('i', { class: 'net-dot plan-split-commit' }),
          document.createTextNode('Commitments ' + Math.round(split.commitmentsShare * 100) + '%')
        ]),
        el('span', {}, [
          el('i', { class: 'net-dot net-dot-save' }),
          document.createTextNode('To savings ' + Math.round(split.savingsShare * 100) + '%')
        ])
      ]);
      if (split.uncoveredShare > 0) {
        legend.appendChild(el('span', {}, [
          el('i', { class: 'net-dot plan-split-uncovered' }),
          document.createTextNode('Not covered ' + Math.round(split.uncoveredShare * 100) + '%')
        ]));
      }
      heroCard.appendChild(legend);
    }
    host.appendChild(heroCard);

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
