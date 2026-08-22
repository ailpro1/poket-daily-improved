/* checklist.js — ticking an item writes a real transaction (spec 3.1). */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, Calc = root.Calc, Fmt = root.Fmt, C = root.Cycles;

  function open() {
    var cycleKey = root.App.cycleKey();
    UI.sheet({
      title: 'Checklist · ' + C.cycleLabel(cycleKey),
      render: function (body) {
        var holder = el('div');
        body.appendChild(holder);
        paint(holder, cycleKey);
        body.appendChild(el('p', { class: 'sheet-note', text: 'Ticking an item logs the real transaction against its account. Unticking removes that log again.' }));
      }
    });
  }

  function paint(holder, cycleKey) {
    holder.innerHTML = '';
    var sections = [
      { key: 'income', title: 'Income', actionable: false },
      { key: 'commitments', title: 'Commitments', actionable: true },
      { key: 'savings', title: 'Savings', actionable: true }
    ];
    var anything = false;

    sections.forEach(function (sec) {
      var items = Calc.planItems(sec.key).filter(function (it) { return Calc.isActiveInCycle(it, cycleKey); });
      if (!items.length) return;
      anything = true;
      var done = items.filter(function (it) { return root.Actions.isChecked(cycleKey, it.id); }).length;
      var group = el('section', { class: 'card' });
      group.appendChild(el('div', { class: 'sec-head' }, [
        el('span', { class: 'eyebrow', text: sec.title + (sec.actionable ? ' (' + done + '/' + items.length + ')' : '') }),
        el('b', { class: 'num', text: Fmt.money(Calc.planTotal(sec.key, cycleKey)) })
      ]));
      var list = el('ul', { class: 'check-list' });
      items.forEach(function (it) {
        var checked = sec.actionable ? root.Actions.isChecked(cycleKey, it.id) : true;
        var acc = Calc.account(it.accountId);
        var row = el('li', { class: 'check-row' + (checked ? ' on' : '') + (sec.actionable ? '' : ' static') }, [
          el('span', { class: 'check-box', text: checked ? '✓' : '' }),
          el('span', { class: 'check-main' }, [
            el('span', { class: 'check-name', text: it.name }),
            el('span', { class: 'log-meta', text: (acc ? acc.icon + ' ' + acc.name : 'no account') + (sec.actionable ? '' : ' · always counted') })
          ]),
          el('b', { class: 'num', text: Fmt.money(Calc.planAmount(it, cycleKey)) })
        ]);
        if (sec.actionable) {
          row.tabIndex = 0;
          row.setAttribute('role', 'checkbox');
          row.setAttribute('aria-checked', String(checked));
          var toggle = function () {
            UI.buzz();
            root.Actions.setChecked(cycleKey, sec.key, it, !checked)
              .then(function () { paint(holder, cycleKey); });
          };
          row.addEventListener('click', toggle);
          row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        }
        list.appendChild(row);
      });
      group.appendChild(list);
      holder.appendChild(group);
    });

    if (!anything) {
      holder.appendChild(UI.emptyState('Your Plan is empty',
        'Add income, commitments and savings in the Plan tab and they appear here each cycle.',
        'Open Plan', function () { UI.$('.sheet-head .icon-btn').click(); root.App.go('plan'); }));
    }
  }

  root.Checklist = { open: open };
})(typeof self !== 'undefined' ? self : globalThis);
