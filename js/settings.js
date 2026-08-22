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
      Calc.planItems(sec).forEach(function (it) {
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
        UI.toast('That file is not a Poket Daily backup', { tone: 'warn' });
        return;
      }
      if (!data || data.app !== 'poket-daily') {
        UI.toast('That file is not a Poket Daily backup', { tone: 'warn' });
        return;
      }
      UI.confirm({
        title: 'Replace everything?',
        message: 'Importing wipes what is in the app now and restores the backup in full.',
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

        var startDay = el('input', { class: 'input', type: 'number', min: '1', max: '28', value: root.S.settings.cycleStartDay });
        body.appendChild(UI.field('Cycle starts on day', startDay, 'Set 25 if your month runs the 25th to the 24th.'));

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
          'Changes the daily budget and balance cards. Preview is live; Save keeps it.'));

        body.appendChild(el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'btn btn-primary', text: 'Save settings',
            onclick: function () {
              root.Actions.saveSettings({
                currency: cur.value.trim() || 'RM',
                cycleStartDay: Math.min(28, Math.max(1, parseInt(startDay.value, 10) || 1)),
                theme: theme.value,
                cardStyle: cardStyle.value
              }).then(function () {
                saved = true;
                root.App.applyTheme();
                s.close();
                UI.toast('Settings saved');
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
        body.appendChild(el('p', { class: 'sheet-note', text: 'Poket Daily keeps everything on this device. Back up before clearing your browser data.' }));
      }
    });
  }

  root.Settings = { open: open, exportJson: exportJson, exportPlanCsv: exportPlanCsv };
})(typeof self !== 'undefined' ? self : globalThis);
