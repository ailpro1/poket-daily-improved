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
      .concat([
        { value: '__new', label: '+ New category' },
        { value: '__manage', label: '✎ Edit categories' }
      ]);
  }

  var KIND_LABEL = { expense: 'Money out', income: 'Money in' };

  /* ---------- managing categories ----------------------------------------
     Rename and delete both have to touch the transactions using a category,
     not just the settings list — see Actions.renameCategory. Reached from the
     Category field on a transaction and from Settings. */
  function categories(opts) {
    opts = opts || {};
    UI.sheet({
      title: 'Categories',
      onClose: function () { if (opts.onDone) opts.onDone(); },
      render: function (body) {
        var holder = el('div');
        body.appendChild(holder);
        paint();

        function paint() {
          holder.innerHTML = '';
          ['expense', 'income'].forEach(function (kind) {
            var list = root.Actions.categoryList(kind);
            var sec = el('section', { class: 'card' });
            sec.appendChild(el('span', { class: 'eyebrow', text: KIND_LABEL[kind] + ' (' + list.length + ')' }));
            if (!list.length) {
              sec.appendChild(el('p', { class: 'card-note', text: 'None yet.' }));
            } else {
              var ul = el('ul', { class: 'cat-manage' });
              list.forEach(function (c) {
                var used = root.Actions.logsUsingCategory(c.id).length;
                ul.appendChild(el('li', {}, [
                  el('span', { class: 'cat-manage-main' }, [
                    el('span', { class: 'cat-name', text: c.name }),
                    el('span', { class: 'log-meta', text: used ? 'used ' + used + ' time' + (used === 1 ? '' : 's') : 'not used yet' })
                  ]),
                  el('button', {
                    class: 'icon-btn', text: '✎', 'aria-label': 'Rename ' + c.name,
                    onclick: function () { rename(kind, c, paint); }
                  }),
                  el('button', {
                    class: 'icon-btn', text: '🗑', 'aria-label': 'Delete ' + c.name,
                    onclick: function () { remove(kind, c, used, paint); }
                  })
                ]));
              });
              sec.appendChild(ul);
            }
            sec.appendChild(el('button', {
              class: 'btn btn-ghost btn-block btn-sm', text: '+ Add a ' + KIND_LABEL[kind].toLowerCase() + ' category',
              onclick: function () { create(kind, paint); }
            }));
            holder.appendChild(sec);
          });
        }
      }
    });
  }

  function nameSheet(title, value, label, onSave) {
    UI.sheet({
      title: title,
      render: function (body, s) {
        var input = el('input', { class: 'input', type: 'text', value: value || '', placeholder: 'Food, Petrol, Bonus…' });
        body.appendChild(UI.field(label, input));
        body.appendChild(el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'btn btn-primary', text: 'Save',
            onclick: function () {
              var v = input.value.trim();
              if (!v) { UI.toast('Give it a name', { tone: 'warn' }); input.focus(); return; }
              s.close();
              onSave(v);
            }
          })
        ]));
        setTimeout(function () { input.focus(); }, 120);
      }
    });
  }

  function create(kind, done) {
    nameSheet('New category', '', 'Name', function (name) {
      root.Actions.addCategory(kind, name).then(function () { done(); UI.toast('Category added'); });
    });
  }

  function rename(kind, cat, done) {
    nameSheet('Rename ' + cat.name, cat.name, 'Name', function (name) {
      root.Actions.renameCategory(kind, cat.id, name).then(function () {
        done();
        UI.toast('Renamed — your past transactions updated too');
      });
    });
  }

  /* A category in use cannot just vanish: those transactions would point at
     nothing. Ask where they should go instead. */
  function remove(kind, cat, used, done) {
    if (!used) {
      UI.confirm({
        title: 'Delete ' + cat.name + '?',
        message: 'Nothing is using it, so nothing else changes.',
        confirmLabel: 'Delete', danger: true
      }).then(function (ok) {
        if (!ok) return;
        root.Actions.deleteCategory(kind, cat.id, null).then(function () { done(); UI.toast('Category deleted'); });
      });
      return;
    }
    UI.sheet({
      title: 'Delete ' + cat.name + '?',
      render: function (body, s) {
        body.appendChild(el('p', { class: 'sheet-note', text: used + ' transaction' + (used === 1 ? '' : 's') + ' use this category. They stay in your history — pick where to put them.' }));
        var options = [{ value: '', label: 'No category' }].concat(
          root.Actions.categoryList(kind)
            .filter(function (c) { return c.id !== cat.id; })
            .map(function (c) { return { value: c.id, label: c.name }; })
        );
        var pick = UI.select(options, '');
        body.appendChild(UI.field('Move them to', pick));
        body.appendChild(el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'btn btn-danger', text: 'Delete category',
            onclick: function () {
              var to = pick.value || null;
              s.close();
              root.Actions.deleteCategory(kind, cat.id, to).then(function (n) {
                done();
                UI.toast('Deleted — ' + n + ' transaction' + (n === 1 ? '' : 's') + ' moved');
              });
            }
          })
        ]));
      }
    });
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
        body.appendChild(UI.field('Amount', amount, 'Just type the numbers — they fill in from the cents.'));

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
          if (catSel.value === '__manage') {
            catSel.value = log.categoryId || '';
            categories({ onDone: function () { catSel.innerHTML = ''; rebuildCats(); } });
            return;
          }
          if (catSel.value !== '__new') return;
          catSel.value = log.categoryId || '';
          nameSheet('New category', '', 'Name', function (nm) {
            root.Actions.addCategory(kind, nm).then(function (cat) {
              if (!cat) return;
              log.categoryId = cat.id;
              catSel.innerHTML = '';
              rebuildCats();
            });
          });
        });
        body.appendChild(UI.field('Category', catSel, 'Pick Edit categories to rename or delete one.'));

        var acc = UI.select(accountOptions(), log.accountId);
        body.appendChild(UI.field('Account', acc, locked ? 'This came from your Plan — change it there.' : null));

        var date = dateInput(log.date);
        body.appendChild(UI.field('Date', date));

        var spread = log.spreadType || 'onetime';
        body.appendChild(UI.field('How to count it', UI.segmented(
          [{ value: 'onetime', label: 'All on this date' }, { value: 'spread', label: 'Split over days' }],
          spread, function (v) { spread = v; }
        ), 'Splits it evenly over the days left in the month.'));

        /* Refunds are their own log, so offer it on anything already saved —
           a planned commitment can be reimbursed just as easily as a coffee. */
        if (!isNew && !root.Calc.isTransfer(log)) {
          var back = root.Actions.refundedTotal(log.id);
          body.appendChild(el('button', {
            class: 'btn btn-ghost btn-block', text: back ? 'Got more back' : 'Got money back',
            onclick: function () { s.close(); refund(log); }
          }));
          if (back) {
            body.appendChild(el('p', { class: 'sheet-note', text: Fmt.money(back) + ' of this already came back.' }));
          }
        }

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
              categoryId: (catSel.value === '__new' || catSel.value === '__manage') ? null : catSel.value || null,
              categoryName: (function () {
                var o = catSel.options[catSel.selectedIndex];
                return o && o.value !== '__new' && o.value !== '__manage' ? o.textContent : null;
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

  /* ---------- refund / reimbursement -------------------------------------
     Reachable from any logged transaction, planned or not. Writes a separate
     income log rather than editing the original down, so the history keeps
     both halves: what you spent, and what came back. */
  function refund(original) {
    var already = root.Actions.refundedTotal(original.id);
    var spent = Math.abs(original.amount || 0);
    var outstanding = root.Fmt.round2(Math.max(0, spent - already));
    var planned = !!original.sourceChecklistId;

    UI.sheet({
      title: 'Got money back',
      render: function (body, s) {
        body.appendChild(el('p', { class: 'sheet-note', text: original.name + ' · ' + Fmt.money(spent) + ' on ' + C.dateLabel(original.date) }));

        var amount = el('input', { class: 'input input-amount' });
        root.CentInput.bind(amount, outstanding || '');
        body.appendChild(UI.field('How much came back', amount,
          already ? Fmt.money(already) + ' of ' + Fmt.money(spent) + ' already came back.'
            : 'The full amount. Change it if you only got part back.'));

        var name = el('input', { class: 'input', type: 'text', value: 'Refund · ' + (original.name || ''), placeholder: 'Reimbursed by work…' });
        body.appendChild(UI.field('What to call it', name));

        var acc = UI.select(accountOptions(), original.accountId);
        body.appendChild(UI.field('Into which account', acc, 'The one it was paid from.'));

        var date = dateInput(C.iso(C.today()));
        body.appendChild(UI.field('When it came back', date));

        body.appendChild(el('p', { class: 'sheet-note', text: planned
          ? 'Counted as money in. Your Plan still sets aside the full amount, so what comes back goes to your daily budget.'
          : 'Counted as money in, so it cancels out this spending for that day.' }));

        body.appendChild(el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'btn btn-primary', text: 'Log the refund',
            onclick: function () {
              var amt = root.CentInput.value(amount);
              if (!amt) { UI.toast('Enter an amount first', { tone: 'warn' }); amount.focus(); return; }
              root.Actions.addRefund(original, {
                amount: amt, name: name.value.trim(), accountId: acc.value, date: date.value
              }).then(function () {
                s.close();
                UI.toast(amt > outstanding && outstanding > 0
                  ? 'Saved — that is more than you spent'
                  : 'Money back saved');
              });
            }
          })
        ]));
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
        body.appendChild(el('p', { class: 'sheet-note', text: 'Between two spending accounts, your spending money stays the same. Into a savings account, spending money goes down and savings goes up by the same amount.' }));
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
        body.appendChild(UI.field('Amount in it now', bal, 'Check your bank app and put in what is really there now.'));

        var actions = el('div', { class: 'row-actions' });
        if (!isNew) {
          actions.appendChild(el('button', {
            class: 'btn btn-ghost btn-danger-text', text: 'Delete',
            onclick: function () {
              UI.confirm({
                title: 'Delete ' + acc.name + '?',
                message: 'This removes the account. You cannot delete one that still has transactions.',
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
        body.appendChild(UI.field('Amount each month', amount));

        var acc = UI.select(accountOptions(), item.accountId);
        body.appendChild(UI.field('Account', acc, section === 'savings' ? 'Usually a savings account.' : null));

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
        body.appendChild(UI.field('Stops after', endMonth, 'Leave empty if it keeps going.'));

        var applyMode = 'always';
        if (!isNew) {
          body.appendChild(UI.field('If the amount changed', UI.segmented(
            [{ value: 'always', label: 'From now on' }, { value: 'cycle', label: 'Just this month' }],
            'always', function (v) { applyMode = v; }
          ), hasLog ? 'You already ticked this off this month, so its transaction changes too.' : null));
        }

        var actions = el('div', { class: 'row-actions' });
        if (!isNew) {
          actions.appendChild(el('button', {
            class: 'btn btn-ghost btn-danger-text', text: 'Delete',
            onclick: function () {
              UI.confirm({
                title: 'Delete ' + (item.name || 'this item') + '?',
                message: 'Anything you already logged from it stays in your history.',
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

            function commit() {
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

            /* Changing what a Plan item is worth changes the daily budget, so
               ask first — and say plainly whether it is just this month or
               every month, since that is easy to pick the wrong segment on
               and not notice until the total looks off. Only the amount
               triggers this; renaming or moving an account does not. */
            var amountChanged = !isNew && Math.round(amt * 100) !== Math.round(currentAmount * 100);
            if (!amountChanged) { commit(); return; }

            var forThisMonth = applyMode === 'cycle';
            UI.confirm({
              title: 'Change ' + (item.name.trim() || name.value.trim() || 'this amount') + '?',
              message: forThisMonth
                ? 'This sets it to ' + Fmt.money(amt) + ' for ' + C.cycleLabel(cycleKey) + ' only. It goes back to ' + Fmt.money(item.amount) + ' next month.'
                : 'This sets it to ' + Fmt.money(amt) + ' for every month from now on.',
              confirmLabel: forThisMonth ? 'Save for this month only' : 'Save for every month'
            }).then(function (ok) { if (ok) commit(); });
          }
        }));
        body.appendChild(actions);
      }
    });
  }

  root.Forms = {
    ICONS: ICONS,
    transaction: transaction,
    categories: categories,
    refund: refund,
    transfer: transfer,
    account: account,
    planItem: planItem,
    accountOptions: accountOptions
  };
})(typeof self !== 'undefined' ? self : globalThis);
