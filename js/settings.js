/* settings.js — preferences, JSON backup/restore, CSV export of the Plan. */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, Calc = root.Calc, C = root.Cycles;

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportJson() {
    var payload = {
      app: 'poket-daily',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: root.S.settings,
      accounts: root.S.accounts,
      plan: root.S.plan,
      logs: root.S.logs,
      checklist: Object.keys(root.S.checklist).map(function (k) { return root.S.checklist[k]; })
    };
    download('poket-daily-backup-' + C.iso(C.today()) + '.json', JSON.stringify(payload, null, 2));
    UI.toast('Backup downloaded');
  }

  function exportPlanCsv() {
    var rows = [['Section', 'Name', 'Amount', 'Account', 'Due type', 'Due', 'Ends after']];
    ['income', 'commitments', 'savings'].forEach(function (sec) {
      Calc.planItemsSorted(sec, C.currentCycleKey()).forEach(function (it) {
        var acc = Calc.account(it.accountId);
        rows.push([sec, it.name, (it.amount || 0).toFixed(2), acc ? acc.name : '',
          it.dueType || 'day', it.dueType === 'date' ? (it.dueDate || '') : (it.dueDay || ''), it.endMonth || '']);
      });
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    download('poket-daily-plan-' + C.iso(C.today()) + '.csv', csv, 'text/csv');
    UI.toast('Plan exported');
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) {
        UI.toast('That is not a Poket Daily backup file', { tone: 'warn' });
        return;
      }
      if (!data || data.app !== 'poket-daily') {
        UI.toast('That file is not a Poket Daily backup', { tone: 'warn' });
        return;
      }
      UI.confirm({
        title: 'Replace everything?',
        message: 'This clears everything in the app now and puts the backup back instead.',
        confirmLabel: 'Import backup', danger: true
      }).then(function (ok) {
        if (!ok) return;
        Promise.all(root.DB.STORES.map(function (s) { return root.DB.clear(s); }))
          .then(function () {
            var planRecs = [];
            ['income', 'commitments', 'savings'].forEach(function (sec) {
              (data.plan && data.plan[sec] ? data.plan[sec] : []).forEach(function (it) {
                planRecs.push(Object.assign({}, it, { section: sec }));
              });
            });
            var settings = Object.assign({}, data.settings || {}, { id: 'settings' });
            return Promise.all([
              root.DB.putMany('accounts', data.accounts || []),
              root.DB.putMany('logs', data.logs || []),
              root.DB.putMany('plan', planRecs),
              root.DB.putMany('checklist', data.checklist || []),
              root.DB.put('settings', settings)
            ]);
          })
          .then(function () { return root.App.reload(); })
          .then(function () { UI.toast('Backup restored'); });
      });
    };
    reader.readAsText(file);
  }

  /* ---------- this cycle (joining part-way through) ----------------------
     Only rendered when the join date actually falls mid-cycle — the controls
     are meaningless otherwise, and Calc.midCycle() ignores them anyway. */
  function midCycleSection(body) {
    var st = root.S.settings;
    var join = st.midCycleJoinDate || st.budgetStartDate || C.iso(C.today());
    if (!C.isMidCycle(join)) return null;

    var mode = (st.midCycleMode || 'prorate') === 'remaining' ? 'remaining' : 'prorate';

    body.appendChild(el('div', { class: 'kv-split' }));
    body.appendChild(el('span', { class: 'eyebrow', text: 'Your first month' }));

    var joinInput = el('input', { class: 'input', type: 'date', value: join });
    body.appendChild(UI.field('Budgeting started on', joinInput,
      'The day you started using Poket Daily. Anything before that is not counted.'));

    var amountWrap = el('div', {});
    var amount = el('input', { class: 'input input-amount' });
    root.CentInput.bind(amount, st.midCycleRemaining || '');
    amountWrap.appendChild(UI.field('Money you had left that day', amount));
    var rate = el('p', { class: 'sheet-note' });
    amountWrap.appendChild(rate);
    amountWrap.appendChild(el('button', {
      class: 'btn btn-ghost btn-block btn-sm', text: 'Work it out for me',
      onclick: function () {
        root.CentInput.set(amount, Math.max(0, Calc.suggestMidCycleRemaining(joinInput.value)));
      }
    }));

    function paintRate() {
      var days = C.daysToCycleEnd(joinInput.value || join);
      var endLabel = C.dateLabel(C.getCycleRangeForKey(C.getMonthKey(joinInput.value || join)).endIso);
      rate.textContent = C.isMidCycle(joinInput.value || join)
        ? root.Fmt.money(root.CentInput.value(amount) / days) + ' a day across ' + days +
          ' day' + (days === 1 ? '' : 's') + ' to ' + endLabel + '.'
        : 'That is the first day of a month, so the normal amount applies.';
    }
    amount.addEventListener('input', paintRate);
    joinInput.addEventListener('change', paintRate);

    function applyMode() {
      amountWrap.classList.toggle('hidden', mode !== 'remaining');
      if (mode === 'remaining') paintRate();
    }

    body.appendChild(UI.segmented([
      { value: 'remaining', label: 'Use what I had left' },
      { value: 'prorate', label: 'Use the normal amount' }
    ], mode, function (v) { mode = v; applyMode(); }));
    body.appendChild(el('p', { class: 'sheet-note', text: 'This uses what you had left instead of your Plan, and only for the month you started in. After that it always uses the Plan.' }));
    body.appendChild(amountWrap);
    applyMode();

    return {
      patch: function () {
        return {
          midCycleMode: mode,
          midCycleJoinDate: joinInput.value || join,
          midCycleRemaining: root.CentInput.value(amount),
          midCycleAsked: true
        };
      }
    };
  }

  function open() {
    var saved = false;
    var styleWas = root.S.settings.cardStyle || 'flat';

    UI.sheet({
      title: 'Settings',
      /* Card style previews live, so put it back if you close without saving. */
      onClose: function () { if (!saved) document.documentElement.dataset.cardStyle = styleWas; },
      render: function (body, s) {
        var cur = el('input', { class: 'input', type: 'text', value: root.S.settings.currency, maxlength: '4' });
        body.appendChild(UI.field('Currency symbol', cur));

        var startDay = el('input', { class: 'input', type: 'number', min: '1', max: '31', value: root.S.settings.cycleStartDay });
        body.appendChild(UI.field('Money month starts on day', startDay,
          'Payday, for most people. Put 25 if your month runs 25th to 24th. Pick 29, 30 or 31 and a short month uses its last day.'));

        var mid = midCycleSection(body);

        var carry = UI.select([
          { value: 'on', label: 'Extra and shortage both carry over' },
          { value: 'surplus', label: 'Only extra carries over' },
          { value: 'off', label: 'Every month starts fresh' }
        ], root.S.settings.carryOver || 'on');
        body.appendChild(UI.field('Carry over from last month', carry,
          'Carrying both is the honest one: spend less and today has more room, spend more and it has less. Keeping only the extra means overspending is never paid back, so the daily figure will always look better than it is.'));

        var theme = UI.select(
          [{ value: 'system', label: 'Match my phone' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
          root.S.settings.theme
        );
        body.appendChild(UI.field('Theme', theme));

        var cardStyle = UI.select(root.App.CARD_STYLES, styleWas);
        cardStyle.addEventListener('change', function () {
          document.documentElement.dataset.cardStyle = cardStyle.value;
        });
        body.appendChild(UI.field('Card style', cardStyle,
          'Changes how the cards look. You can see it right away; Save keeps it.'));

        body.appendChild(el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'btn btn-primary', text: 'Save settings',
            onclick: function () {
              var day = Math.min(31, Math.max(1, parseInt(startDay.value, 10) || 1));
              var dayMoved = day !== root.S.settings.cycleStartDay;
              var patch = {
                currency: cur.value.trim() || 'RM',
                cycleStartDay: day,
                carryOver: carry.value,
                theme: theme.value,
                cardStyle: cardStyle.value
              };
              if (mid) Object.assign(patch, mid.patch());
              root.Actions.saveSettings(patch).then(function () {
                saved = true;
                root.App.applyTheme();
                s.close();
                /* Moving the cycle start moves the cycle END, so a spread
                   figure re-spreads over a different number of days. That is
                   unavoidable, but it must not be silent. */
                UI.toast(dayMoved && patch.midCycleMode === 'remaining'
                  ? 'Saved — your first month now ends on a different day'
                  : 'Settings saved');
              });
            }
          })
        ]));

        body.appendChild(el('div', { class: 'kv-split' }));
        body.appendChild(el('span', { class: 'eyebrow', text: 'Tab order' }));
        var order = (root.S.settings.navOrder || root.App.DEFAULT_NAV).slice();
        var orderList = el('ul', { class: 'order-list' });
        function paintOrder() {
          orderList.innerHTML = '';
          order.forEach(function (k, i) {
            orderList.appendChild(el('li', {}, [
              el('span', { text: root.App.TABS[k].icon + '  ' + root.App.TABS[k].label }),
              el('span', { class: 'order-btns' }, [
                el('button', {
                  class: 'icon-btn', text: '↑', 'aria-label': 'Move up', disabled: i === 0,
                  onclick: function () { order.splice(i - 1, 0, order.splice(i, 1)[0]); paintOrder(); save(); }
                }),
                el('button', {
                  class: 'icon-btn', text: '↓', 'aria-label': 'Move down', disabled: i === order.length - 1,
                  onclick: function () { order.splice(i + 1, 0, order.splice(i, 1)[0]); paintOrder(); save(); }
                })
              ])
            ]));
          });
        }
        function save() { root.Actions.saveSettings({ navOrder: order.slice() }); }
        paintOrder();
        body.appendChild(orderList);

        body.appendChild(el('div', { class: 'kv-split' }));
        body.appendChild(el('span', { class: 'eyebrow', text: 'Your data' }));
        body.appendChild(el('button', { class: 'btn btn-ghost btn-block', text: 'Download full backup (JSON)', onclick: exportJson }));
        body.appendChild(el('button', { class: 'btn btn-ghost btn-block', text: 'Export Plan as CSV', onclick: exportPlanCsv }));

        var picker = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
        picker.addEventListener('change', function () {
          if (picker.files && picker.files[0]) { s.close(); importJson(picker.files[0]); }
        });
        body.appendChild(picker);
        body.appendChild(el('button', { class: 'btn btn-ghost btn-block', text: 'Restore from backup', onclick: function () { picker.click(); } }));

        body.appendChild(el('div', { class: 'kv-split' }));
        body.appendChild(el('button', {
          class: 'btn btn-ghost btn-block', text: 'Run the setup guide again',
          onclick: function () { s.close(); root.Onboarding.open(0); }
        }));
        body.appendChild(el('p', { class: 'sheet-note', text: 'Everything stays on this phone. Back up before you clear your browser data.' }));
      }
    });
  }

  root.Settings = { open: open, exportJson: exportJson, exportPlanCsv: exportPlanCsv };
})(typeof self !== 'undefined' ? self : globalThis);
