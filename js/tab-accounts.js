/* tab-accounts.js */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, Calc = root.Calc, Fmt = root.Fmt, C = root.Cycles;

  function card(a) {
    return el('div', {
      class: 'acc-card', tabindex: '0', role: 'button', dataset: { id: a.id },
      onclick: function (e) { if (!e.currentTarget.classList.contains('was-dragged')) detail(a.id); },
      onkeydown: function (e) { if (e.key === 'Enter') detail(a.id); }
    }, [
      el('span', { class: 'acc-icon', text: a.icon }),
      el('span', { class: 'acc-name', text: a.name }),
      el('b', { class: 'num acc-bal', text: Fmt.money(Calc.accountBalance(a.id)) }),
      el('span', { class: 'acc-grip', 'aria-hidden': 'true', text: '⠿' })
    ]);
  }

  /* Long-press then drag to reorder within a group. */
  function makeSortable(grid, type) {
    var holdTimer = null, dragging = null, startY = 0, startX = 0;

    function cards() { return UI.$$('.acc-card', grid); }

    function pointerDown(e) {
      var target = e.target.closest('.acc-card');
      if (!target) return;
      startY = e.clientY; startX = e.clientX;
      holdTimer = setTimeout(function () {
        dragging = target;
        dragging.classList.add('dragging', 'was-dragged');
        grid.classList.add('sorting');
        UI.buzz(12);
      }, 320);
      window.addEventListener('pointermove', pointerMove);
      window.addEventListener('pointerup', pointerUp, { once: true });
      window.addEventListener('pointercancel', pointerUp, { once: true });
    }

    function pointerMove(e) {
      if (!dragging) {
        if (Math.abs(e.clientY - startY) > 8 || Math.abs(e.clientX - startX) > 8) clearTimeout(holdTimer);
        return;
      }
      e.preventDefault();
      var others = cards().filter(function (c) { return c !== dragging; });
      var best = null, bestDist = Infinity;
      others.forEach(function (c) {
        var r = c.getBoundingClientRect();
        var d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (d < bestDist) { bestDist = d; best = c; }
      });
      if (best && bestDist < 140) {
        var r = best.getBoundingClientRect();
        var after = e.clientY > r.top + r.height / 2 || (Math.abs(e.clientY - (r.top + r.height / 2)) < 12 && e.clientX > r.left + r.width / 2);
        grid.insertBefore(dragging, after ? best.nextSibling : best);
      }
    }

    function pointerUp() {
      clearTimeout(holdTimer);
      window.removeEventListener('pointermove', pointerMove);
      if (dragging) {
        dragging.classList.remove('dragging');
        var node = dragging;
        dragging = null;
        grid.classList.remove('sorting');
        root.Actions.reorderAccounts(type, cards().map(function (c) { return c.dataset.id; }))
          .then(function () { UI.toast('Order saved'); });
        setTimeout(function () { node.classList.remove('was-dragged'); }, 300);
      }
    }

    grid.addEventListener('pointerdown', pointerDown);
  }

  function group(type, title, host) {
    var accs = Calc.accountsOfType(type);
    var total = type === 'saving' ? Calc.savingsBalance() : Calc.monthlyBalance();
    var sec = el('section', { class: 'acc-group' });
    sec.appendChild(el('div', { class: 'sec-head' }, [
      el('span', { class: 'eyebrow', text: title + ' (' + accs.length + ')' }),
      el('b', { class: 'num', text: Fmt.money(total) })
    ]));
    if (!accs.length) {
      sec.appendChild(el('p', { class: 'card-note', text: type === 'saving' ? 'No saving accounts yet.' : 'No spending accounts yet.' }));
    } else {
      var grid = el('div', { class: 'acc-grid' });
      accs.forEach(function (a) { grid.appendChild(card(a)); });
      sec.appendChild(grid);
      makeSortable(grid, type);
    }
    sec.appendChild(el('button', {
      class: 'btn btn-ghost btn-block',
      text: type === 'saving' ? '+ Add saving account' : '+ Add spending account',
      onclick: function () { root.Forms.account(null, { type: type }); }
    }));
    host.appendChild(sec);
  }

  function detail(id) {
    var a = Calc.account(id);
    if (!a) return;
    var cycleKey = root.App.cycleKey();
    UI.sheet({
      title: a.icon + '  ' + a.name,
      render: function (body, s) {
        var head = el('div', { class: 'acc-detail-head' }, [
          el('span', { class: 'eyebrow', text: 'In here now' }),
          el('p', { class: 'num acc-detail-bal', text: Fmt.money(Calc.accountBalance(a.id)) }),
          el('p', { class: 'card-note', text: 'Started at ' + Fmt.money(a.startBalance) + ' · ' + (a.type === 'saving' ? 'counted as savings' : 'counted as spending money') })
        ]);
        body.appendChild(head);

        var nav = el('div', { class: 'month-nav' });
        var label = el('span', { class: 'month-label' });
        var listHolder = el('ul', { class: 'log-list' });
        function paint() {
          var r = C.getCycleRangeForKey(cycleKey);
          label.textContent = C.cycleLabel(cycleKey);
          listHolder.innerHTML = '';
          var logs = Calc.logsInRange(r.startIso, r.endIso, function (l) { return l.accountId === a.id; });
          if (!logs.length) {
            listHolder.appendChild(el('li', { class: 'card-note', text: 'Nothing logged this month.' }));
            return;
          }
          logs.forEach(function (l) {
            var neg = Calc.sign(l) < 0;
            listHolder.appendChild(el('li', { class: 'log-row' }, [
              el('span', { class: 'log-main' }, [
                el('span', { class: 'log-name', text: l.name }),
                el('span', { class: 'log-meta', text: C.dateLabel(l.date) + (l.sourceChecklistId ? ' · from Plan' : '') })
              ]),
              el('span', { class: 'num log-amt' + (neg ? ' neg' : ' pos'), text: (neg ? '−' : '+') + Fmt.money(Math.abs(l.amount)) })
            ]));
          });
        }
        nav.appendChild(el('button', { class: 'icon-btn', text: '‹', 'aria-label': 'Previous cycle', onclick: function () { cycleKey = C.shiftCycleKey(cycleKey, -1); paint(); } }));
        nav.appendChild(label);
        nav.appendChild(el('button', { class: 'icon-btn', text: '›', 'aria-label': 'Next cycle', onclick: function () { cycleKey = C.shiftCycleKey(cycleKey, 1); paint(); } }));
        body.appendChild(nav);
        body.appendChild(listHolder);
        paint();

        body.appendChild(el('div', { class: 'row-actions' }, [
          el('button', { class: 'btn btn-ghost', text: 'Edit account', onclick: function () { s.close(); root.Forms.account(a); } }),
          el('button', { class: 'btn btn-primary', text: 'Move money', onclick: function () { s.close(); root.Forms.transfer(); } })
        ]));
      }
    });
  }

  function render(host) {
    host.innerHTML = '';
    /* The two group totals are already printed next to their own headings
       below, so repeating them here said nothing. What is NOT anywhere else:
       how much the total has moved this month, and how it splits. */
    var nw = Calc.netWorthSummary(root.App.cycleKey());
    var up = nw.change >= 0;
    var card = el('section', { class: 'card net-card' }, [
      el('span', { class: 'eyebrow', text: 'Total money' }),
      el('p', { class: 'num net-worth', text: Fmt.money(nw.total) })
    ]);
    if (Math.abs(nw.change) > 0.005) {
      card.appendChild(el('p', { class: 'net-delta ' + (up ? 'pos' : 'neg') }, [
        el('span', { class: 'net-arrow', text: up ? '▲' : '▼' }),
        el('span', { class: 'num', text: Fmt.money(Math.abs(nw.change)) }),
        el('span', { class: 'net-since', text: 'since ' + C.dateLabel(nw.sinceIso) })
      ]));
    }
    /* One bar instead of two more numbers: the mix is the thing you cannot
       read off the lists below at a glance. */
    if (nw.total !== 0) {
      card.appendChild(el('div', { class: 'net-bar' }, [
        el('span', { class: 'net-bar-spend', style: 'width:' + (nw.spendingShare * 100).toFixed(1) + '%' }),
        el('span', { class: 'net-bar-save', style: 'width:' + (nw.savingsShare * 100).toFixed(1) + '%' })
      ]));
      card.appendChild(el('div', { class: 'net-legend' }, [
        el('span', {}, [
          el('i', { class: 'net-dot net-dot-spend' }),
          document.createTextNode('To spend ' + Math.round(nw.spendingShare * 100) + '%')
        ]),
        el('span', {}, [
          el('i', { class: 'net-dot net-dot-save' }),
          document.createTextNode('Saved ' + Math.round(nw.savingsShare * 100) + '%')
        ])
      ]));
    }
    host.appendChild(card);

    group('general', 'Accounts', host);
    group('saving', 'Saving Accounts', host);

    host.appendChild(el('button', {
      class: 'btn btn-primary btn-block', text: 'Move money between accounts',
      onclick: function () { root.Forms.transfer(); }
    }));
  }

  root.TabAccounts = { render: render, detail: detail };
})(typeof self !== 'undefined' ? self : globalThis);
