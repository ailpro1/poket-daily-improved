/* forms.js — the edit sheets shared by every tab. */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, C = root.Cycles, Fmt = root.Fmt;
  var ICONS = ['🏦', '👛', '💳', '📱', '🐖', '🏠', '🚗', '🎓', '🌴', '💼', '🧾', '⭐'];

  function accountOptions(filterType) {
    return root.S.accounts
      .filter(function (a) { return !filterType || a.type === filterType; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
      .map(function (a) { return { value: a.id, label: a.icon + '  ' + a.name }; });
  }

  function categoryOptions(kind) {
    var cats = (root.S.settings.categories && root.S.settings.categories[kind]) || [];
    return cats.map(function (c) { return { value: c.id, label: c.name }; })
      .concat([{ value: '__new', label: '+ New category' }]);
  }

  function addCategory(kind, name) {
    var cat = { id: Fmt.uid('cat'), name: name };
    root.S.settings.categories[kind].push(cat);
    root.Actions.saveSettings({ categories: root.S.settings.categories });
    return cat;
  }

  function dateInput(value) {
    var i = el('input', { class: 'input', type: 'date', value: value || C.iso(C.today()) });
    return i;
  }

  /* ---------- transaction ------------------------------------------------- */

  function transaction(existing, presets) {
    var isNew = !existing;
    var log = existing ? Object.assign({}, existing) : root.Actions.newLog(presets || {});
    if (isNew && !log.accountId) {
      var gen = root.Calc.accountsOfType('general')[0];
      log.accountId = gen ? gen.id : (root.S.accounts[0] ? root.S.accounts[0].id : null);
    }
    var locked = !!log.sourceChecklistId;

    UI.sheet({
      title: isNew ? 'Log a transaction' : 'Edit transaction',
      render: function (body, s) {
        var amount = el('input', { class: 'input input-amount', placeholder: Fmt.money(0) });
        root.CentInput.bind(amount, log.amount || '');
        body.appendChild(UI.field('Amount', amount, 'Type digits — they fill from the cents.'));

        var typeWrap = el('div');
        var kind = log.type === 'income' ? 'income' : 'expense';
        typeWrap.appendChild(UI.segmented(
          [{ value: 'expense', label: 'Money out' }, { value: 'income', label: 'Money in' }],
          kind,
          function (v) { kind = v; catSel.innerHTML = ''; rebuildCats(); }
        ));
        body.appendChild(UI.field('Direction', typeWrap));

        var name = el('input', { class: 'input', type: 'text', value: log.name || '', placeholder: 'Nasi lemak, Grab, salary…' });
        body.appendChild(UI.field('What was it?', name));

        var catSel = UI.select([], log.categoryId);
        function rebuildCats() {
          var opts = categoryOptions(kind);
          opts.forEach(function (o) {
            var opt = el('option', { value: o.value, text: o.label });
            if (String(o.value) === String(log.categoryId)) opt.selected = true;
            catSel.appendChild(opt);
          });
        }
        rebuildCats();
        catSel.addEventListener('change', function () {
          if (catSel.value !== '__new') return;
          var nm = prompt('New category name');
          if (nm && nm.trim()) {
            var cat = addCategory(kind, nm.trim());
            catSel.innerHTML = ''; log.categoryId = cat.id; rebuildCats();
          } else { catSel.value = log.categoryId || ''; }
        });
        body.appendChild(UI.field('Category', catSel));

        var acc = UI.select(accountOptions(), log.accountId);
        body.appendChild(UI.field('Account', acc, locked ? 'From your Plan — edit the item in Plan to change it.' : null));

        var date = dateInput(log.date);
        body.appendChild(UI.field('Date', date));

        var spread = log.spreadType || 'onetime';
        body.appendChild(UI.field('How it hits the budget', UI.segmented(
          [{ value: 'onetime', label: 'All on this date' }, { value: 'spread', label: 'Spread over cycle' }],
          spread, function (v) { spread = v; }
        ), 'Spread splits it evenly across the days left in its cycle.'));

        var actions = el('div', { class: 'row-actions' });
        if (!isNew) {
          actions.appendChild(el('button', {
            class: 'btn btn-ghost btn-danger-text', text: 'Delete',
            onclick: function () {
              s.close();
              root.Actions.deleteLog(log.id);
            }
          }));
        }
        actions.appendChild(el('button', {
          class: 'btn btn-primary', text: isNew ? 'Add transaction' : 'Save changes',
          onclick: function () {
            var amt = root.CentInput.value(amount);
            if (!amt) { UI.toast('Enter an amount first', { tone: 'warn' }); amount.focus(); return; }
            var patch = {
              amount: amt,
              name: name.value.trim() || (kind === 'income' ? 'Income' : 'Expense'),
              type: kind,
              spreadType: spread,
              date: date.value,
              accountId: acc.value,
              categoryId: catSel.value === '__new' ? null : catSel.value || null,
              categoryName: (function () {
                var o = catSel.options[catSel.selectedIndex];
                return o && o.value !== '__new' ? o.textContent : null;
              })()
            };
            var p = isNew ? root.Actions.addLog(patch) : root.Actions.updateLog(log.id, patch);
            p.then(function () { s.close(); UI.toast(isNew ? 'Transaction added' : 'Transaction saved'); });
          }
        }));
        body.appendChild(actions);
      }
    });
  }

  /* ---------- transfer ---------------------------------------------------- */

  function transfer() {
    if (root.S.accounts.length < 2) {
      UI.toast('You need two accounts to transfer between', { tone: 'warn' });
      return;
    }
    UI.sheet({
      title: 'Move money between accounts',
      render: function (body, s) {
        var amount = el('input', { class: 'input input-amount' });
        root.CentInput.bind(amount, '');
        body.appendChild(UI.field('Amount', amount));
        var from = UI.select(accountOptions(), root.S.accounts[0].id);
        var to = UI.select(accountOptions(), root.S.accounts[1].id);
        body.appendChild(UI.field('From', from));
        body.appendChild(UI.field('To', to));
        var date = dateInput();
        body.appendChild(UI.field('Date', date));
        var note = el('input', { class: 'input', type: 'text', placeholder: 'Optional note' });
        body.appendChild(UI.field('Note', note));
        body.appendChild(el('p', { class: 'sheet-note', text: 'Moving between two spending accounts leaves Monthly Balance unchanged. Moving into a saving account lowers Monthly Balance and lifts Savings Balance by the same amount.' }));
        body.appendChild(el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'btn btn-primary', text: 'Move money',
            onclick: function () {
              var amt = root.CentInput.value(amount);
              if (!amt) { UI.toast('Enter an amount first', { tone: 'warn' }); return; }
              if (from.value === to.value) { UI.toast('Pick two different accounts', { tone: 'warn' }); return; }
              root.Actions.addTransfer(from.value, to.value, amt, date.value, note.value.trim())
                .then(function () { s.close(); UI.toast('Money moved'); });
            }
          })
        ]));
      }
    });
  }

  /* ---------- account ------------------------------------------------------ */

  function account(existing, opts) {
    var isNew = !existing;
    opts = opts || {};
    var onSaved = opts.onSaved;
    var defaults = {};
    if (opts.type) defaults.type = opts.type;
    var acc = existing ? Object.assign({}, existing) : Object.assign({
      id: Fmt.uid('acc'), name: '', icon: '🏦', type: 'general', startBalance: 0,
      order: root.S.accounts.length, createdAt: new Date().toISOString()
    }, defaults);

    UI.sheet({
      title: isNew ? 'Add an account' : 'Edit account',
      render: function (body, s) {
        var name = el('input', { class: 'input', type: 'text', value: acc.name, placeholder: 'Maybank, TnG, ASB…' });
        body.appendChild(UI.field('Account name', name));

        var iconWrap = el('div', { class: 'icon-grid' });
        var chosen = acc.icon;
        ICONS.forEach(function (ic) {
          var b = el('button', {
            type: 'button', class: 'icon-pick' + (ic === chosen ? ' on' : ''), text: ic,
            onclick: function () {
              chosen = ic;
              UI.$$('.icon-pick', iconWrap).forEach(function (x) { x.classList.remove('on'); });
              b.classList.add('on');
            }
          });
          iconWrap.appendChild(b);
        });
        body.appendChild(UI.field('Icon', iconWrap));

        var type = acc.type;
        body.appendChild(UI.field('Type', UI.segmented(
          [{ value: 'general', label: 'Spending' }, { value: 'saving', label: 'Saving' }],
          type, function (v) { type = v; }
        ), 'Spending accounts add up to Monthly Balance. Saving accounts add up to Savings Balance.'));

        var bal = el('input', { class: 'input input-amount' });
        root.CentInput.bind(bal, acc.startBalance || '');
        body.appendChild(UI.field('Starting balance', bal, 'Open your bank app and enter what is actually in there right now.'));

        var actions = el('div', { class: 'row-actions' });
        if (!isNew) {
          actions.appendChild(el('button', {
            class: 'btn btn-ghost btn-danger-text', text: 'Delete',
            onclick: function () {
              UI.confirm({
                title: 'Delete ' + acc.name + '?',
                message: 'This removes the account. Accounts with transactions cannot be deleted.',
                confirmLabel: 'Delete account', danger: true
              }).then(function (ok) {
                if (!ok) return;
                root.Actions.deleteAccount(acc.id)
                  .then(function () { s.close(); UI.toast('Account deleted'); })
                  .catch(function () {
                    UI.toast('This account has transactions. Move or delete them first.', { tone: 'warn' });
                  });
              });
            }
          }));
        }
        actions.appendChild(el('button', {
          class: 'btn btn-primary', text: isNew ? 'Add account' : 'Save account',
          onclick: function () {
            if (!name.value.trim()) { UI.toast('Give the account a name', { tone: 'warn' }); return; }
            acc.name = name.value.trim();
            acc.icon = chosen;
            acc.type = type;
            acc.startBalance = root.CentInput.value(bal);
            root.Actions.saveAccount(acc).then(function () {
              s.close();
              UI.toast(isNew ? 'Account added' : 'Account saved');
              if (onSaved) onSaved(acc);
            });
          }
        }));
        body.appendChild(actions);
      }
    });
  }

  /* ---------- plan item ----------------------------------------------------- */

  function planItem(section, existing) {
    var isNew = !existing;
    var cycleKey = root.App.cycleKey();
    var defaultAcc = section === 'savings'
      ? (root.Calc.accountsOfType('saving')[0] || root.Calc.accountsOfType('general')[0])
      : (root.Calc.accountsOfType('general')[0]);
    var item = existing ? Object.assign({}, existing) : {
      id: Fmt.uid('plan'), name: '', amount: 0,
      accountId: defaultAcc ? defaultAcc.id : null,
      dueType: 'day', dueDay: 1, cycleOverrides: {}
    };
    item.cycleOverrides = Object.assign({}, item.cycleOverrides || {});
    var titles = { income: 'income', commitments: 'commitment', savings: 'savings goal' };
    var hasLog = !isNew && !!root.Actions.checklistLogFor(cycleKey, item.id);
    var currentAmount = root.Calc.planAmount(item, cycleKey);

    UI.sheet({
      title: (isNew ? 'Add ' : 'Edit ') + titles[section],
      render: function (body, s) {
        var name = el('input', { class: 'input', type: 'text', value: item.name, placeholder: section === 'income' ? 'Salary, side job…' : 'Rent, car loan, ASB…' });
        body.appendChild(UI.field('Name', name));

        var amount = el('input', { class: 'input input-amount' });
        root.CentInput.bind(amount, currentAmount || '');
        body.appendChild(UI.field('Amount each cycle', amount));

        var acc = UI.select(accountOptions(), item.accountId);
        body.appendChild(UI.field('Account', acc, section === 'savings' ? 'Defaults to a saving account.' : null));

        var dueType = item.dueType || 'day';
        var dueDay = el('input', { class: 'input', type: 'number', min: '1', max: '31', value: item.dueDay || 1 });
        var dueDate = el('input', { class: 'input', type: 'date', value: item.dueDate || '' });
        var dueHolder = el('div');
        function paintDue() {
          dueHolder.innerHTML = '';
          dueHolder.appendChild(dueType === 'day' ? dueDay : dueDate);
        }
        body.appendChild(UI.field('Due', UI.segmented(
          [{ value: 'day', label: 'Day of month' }, { value: 'date', label: 'Exact date' }],
          dueType, function (v) { dueType = v; paintDue(); }
        )));
        paintDue();
        body.appendChild(UI.field(' ', dueHolder));

        var endMonth = el('input', { class: 'input', type: 'month', value: item.endMonth || '' });
        body.appendChild(UI.field('Stops after', endMonth, 'Leave blank if it keeps going.'));

        var applyMode = 'always';
        if (!isNew) {
          body.appendChild(UI.field('If the amount changed', UI.segmented(
            [{ value: 'always', label: 'From now on' }, { value: 'cycle', label: 'Just this cycle' }],
            'always', function (v) { applyMode = v; }
          ), hasLog ? 'This item is already ticked off this cycle — its logged amount updates too.' : null));
        }

        var actions = el('div', { class: 'row-actions' });
        if (!isNew) {
          actions.appendChild(el('button', {
            class: 'btn btn-ghost btn-danger-text', text: 'Delete',
            onclick: function () {
              UI.confirm({
                title: 'Delete ' + (item.name || 'this item') + '?',
                message: 'Transactions already logged from it stay in your history.',
                confirmLabel: 'Delete', danger: true
              }).then(function (ok) {
                if (!ok) return;
                root.Actions.deletePlanItem(section, item.id).then(function () { s.close(); UI.toast('Removed from Plan'); });
              });
            }
          }));
        }
        actions.appendChild(el('button', {
          class: 'btn btn-primary', text: isNew ? 'Add to Plan' : 'Save',
          onclick: function () {
            var amt = root.CentInput.value(amount);
            if (!name.value.trim()) { UI.toast('Give it a name', { tone: 'warn' }); return; }
            item.name = name.value.trim();
            item.accountId = acc.value;
            item.dueType = dueType;
            item.dueDay = parseInt(dueDay.value, 10) || 1;
            item.dueDate = dueDate.value || null;
            item.endMonth = endMonth.value || null;
            if (applyMode === 'cycle' && !isNew) item.cycleOverrides[cycleKey] = amt;
            else {
              item.amount = amt;
              delete item.cycleOverrides[cycleKey];
            }
            root.Actions.savePlanItem(section, item).then(function () {
              if (hasLog) return root.Actions.syncChecklistLogAmount(cycleKey, item.id, root.Calc.planAmount(item, cycleKey));
            }).then(function () {
              s.close();
              UI.toast(isNew ? 'Added to Plan' : 'Plan updated');
            });
          }
        }));
        body.appendChild(actions);
      }
    });
  }

  root.Forms = {
    ICONS: ICONS,
    transaction: transaction,
    transfer: transfer,
    account: account,
    planItem: planItem,
    accountOptions: accountOptions
  };
})(typeof self !== 'undefined' ? self : globalThis);
