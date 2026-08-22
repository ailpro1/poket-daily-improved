/* actions.js — every write to state goes through here, so persistence,
   cache invalidation and re-render always happen together. */
(function (root) {
  'use strict';

  var C = root.Cycles;

  function commit() {
    root.Calc.invalidate();
    root.App.refresh();
  }

  function nowIso() { return new Date().toISOString(); }

  /* ---------- transactions ------------------------------------------------ */

  function newLog(data) {
    return Object.assign({
      id: root.Fmt.uid('log'),
      name: '',
      amount: 0,
      type: 'expense',
      spreadType: 'onetime',
      date: C.iso(C.today()),
      accountId: null,
      categoryId: null,
      categoryName: null,
      createdAt: nowIso()
    }, data || {});
  }

  function addLog(data) {
    var log = newLog(data);
    root.S.logs.push(log);
    return root.DB.put('logs', log).then(function () { commit(); return log; });
  }

  function updateLog(id, patch) {
    var log = root.S.logs.filter(function (l) { return l.id === id; })[0];
    if (!log) return Promise.resolve(null);
    Object.assign(log, patch);
    return root.DB.put('logs', log).then(function () { commit(); return log; });
  }

  /* Deleting is undoable for the most recent record only (spec 11). */
  var lastDeleted = null;

  function removeLogRecord(id) {
    root.S.logs = root.S.logs.filter(function (l) { return l.id !== id; });
    return root.DB.del('logs', id);
  }

  function deleteLog(id, opts) {
    opts = opts || {};
    var log = root.S.logs.filter(function (l) { return l.id === id; })[0];
    if (!log) return Promise.resolve();
    /* a transfer is always a pair — delete and restore both halves together */
    var group = log.transferPairId
      ? root.S.logs.filter(function (l) { return l.transferPairId === log.transferPairId; }).slice()
      : [log];
    var checklistKeys = [];
    group.forEach(function (g) {
      if (g.sourceChecklistId && g.sourceCycle) checklistKeys.push(g.sourceCycle + ':' + g.sourceChecklistId);
    });
    lastDeleted = { logs: group.map(function (g) { return Object.assign({}, g); }), checklistKeys: checklistKeys };

    return Promise.all(group.map(function (g) { return removeLogRecord(g.id); }))
      .then(function () {
        /* checklist self-heals on next render, but drop the stale record now */
        return Promise.all(checklistKeys.map(function (k) {
          delete root.S.checklist[k];
          return root.DB.del('checklist', k);
        }));
      })
      .then(function () {
        commit();
        if (opts.silent) return;
        root.UI.toast(group.length > 1 ? 'Transfer deleted' : 'Transaction deleted', {
          seconds: 6,
          actionLabel: 'Undo',
          onAction: undoDelete
        });
      });
  }

  function undoDelete() {
    if (!lastDeleted) return;
    var pack = lastDeleted;
    lastDeleted = null;
    pack.logs.forEach(function (l) { root.S.logs.push(l); });
    Promise.all(pack.logs.map(function (l) { return root.DB.put('logs', l); }))
      .then(function () {
        return Promise.all(pack.checklistKeys.map(function (k, i) {
          var rec = { id: k, checked: true, logId: pack.logs[i] ? pack.logs[i].id : null };
          root.S.checklist[k] = rec;
          return root.DB.put('checklist', rec);
        }));
      })
      .then(function () {
        commit();
        root.UI.toast('Restored');
      });
  }

  /* ---------- transfers (spec 3.4) ---------------------------------------- */

  function addTransfer(fromId, toId, amount, date, note) {
    if (fromId === toId) return Promise.reject(new Error('Pick two different accounts'));
    var pairId = root.Fmt.uid('pair');
    var label = note || 'Transfer';
    var out = newLog({
      name: label, amount: amount, type: 'transfer_out', date: date,
      accountId: fromId, transferPairId: pairId, transferCounterpartAccountId: toId
    });
    var inn = newLog({
      name: label, amount: amount, type: 'transfer_in', date: date,
      accountId: toId, transferPairId: pairId, transferCounterpartAccountId: fromId
    });
    root.S.logs.push(out, inn);
    return root.DB.putMany('logs', [out, inn]).then(commit);
  }

  /* ---------- checklist (spec 3.1) ---------------------------------------- */

  function checklistKey(cycleKey, itemId) { return cycleKey + ':' + itemId; }

  function checklistLogFor(cycleKey, itemId) {
    var found = root.S.logs.filter(function (l) {
      return l.sourceChecklistId === itemId && l.sourceCycle === cycleKey;
    });
    return found[0] || null;
  }

  /* Self-healing read: the log is the truth, the checklist record is a cache. */
  function isChecked(cycleKey, itemId) {
    var log = checklistLogFor(cycleKey, itemId);
    var key = checklistKey(cycleKey, itemId);
    var rec = root.S.checklist[key];
    if (!log && rec) { delete root.S.checklist[key]; root.DB.del('checklist', key); }
    return !!log;
  }

  function setChecked(cycleKey, section, item, checked) {
    var key = checklistKey(cycleKey, item.id);
    var existing = checklistLogFor(cycleKey, item.id);
    if (checked) {
      if (existing) return Promise.resolve();
      var range = C.getCycleRangeForKey(cycleKey);
      var todayIso = C.iso(C.today());
      var date = (todayIso >= range.startIso && todayIso <= range.endIso) ? todayIso : range.startIso;
      var log = newLog({
        name: item.name,
        amount: root.Calc.planAmount(item, cycleKey),
        type: section === 'income' ? 'income' : 'expense',
        date: date,
        accountId: item.accountId,
        categoryName: section === 'savings' ? 'Savings' : 'Commitment',
        categoryId: section === 'savings' ? 'savings' : 'commitment',
        sourceChecklistId: item.id,
        sourceCycle: cycleKey,
        sourceSection: section
      });
      root.S.logs.push(log);
      root.S.checklist[key] = { id: key, checked: true, logId: log.id };
      return root.DB.put('logs', log)
        .then(function () { return root.DB.put('checklist', root.S.checklist[key]); })
        .then(commit);
    }
    delete root.S.checklist[key];
    return (existing ? removeLogRecord(existing.id) : Promise.resolve())
      .then(function () { return root.DB.del('checklist', key); })
      .then(commit);
  }

  /* ---------- plan items --------------------------------------------------- */

  function savePlanItem(section, item) {
    var list = root.S.plan[section];
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === item.id) idx = i;
    if (idx >= 0) list[idx] = item; else list.push(item);
    var rec = Object.assign({}, item, { section: section });
    return root.DB.put('plan', rec).then(commit);
  }

  function deletePlanItem(section, id) {
    root.S.plan[section] = root.S.plan[section].filter(function (i) { return i.id !== id; });
    /* leave existing logs alone — they are real money already spent */
    Object.keys(root.S.checklist).forEach(function (k) {
      if (k.split(':')[1] === id) { delete root.S.checklist[k]; root.DB.del('checklist', k); }
    });
    return root.DB.del('plan', id).then(commit);
  }

  /* Keep a checked-off log in step with an edited plan amount (spec 4). */
  function syncChecklistLogAmount(cycleKey, itemId, amount) {
    var log = checklistLogFor(cycleKey, itemId);
    if (!log) return Promise.resolve();
    log.amount = amount;
    return root.DB.put('logs', log).then(commit);
  }

  /* ---------- accounts ----------------------------------------------------- */

  function saveAccount(acc) {
    var idx = -1;
    for (var i = 0; i < root.S.accounts.length; i++) if (root.S.accounts[i].id === acc.id) idx = i;
    if (idx >= 0) root.S.accounts[idx] = acc; else root.S.accounts.push(acc);
    return root.DB.put('accounts', acc).then(commit);
  }

  function deleteAccount(id) {
    var used = root.S.logs.some(function (l) { return l.accountId === id; });
    if (used) return Promise.reject(new Error('has-transactions'));
    root.S.accounts = root.S.accounts.filter(function (a) { return a.id !== id; });
    return root.DB.del('accounts', id).then(commit);
  }

  function reorderAccounts(type, orderedIds) {
    var updated = [];
    orderedIds.forEach(function (id, i) {
      var a = root.Calc.account(id);
      if (a && a.type === type) { a.order = i; updated.push(a); }
    });
    return root.DB.putMany('accounts', updated).then(commit);
  }

  /* ---------- settings ------------------------------------------------------ */

  function saveSettings(patch) {
    Object.assign(root.S.settings, patch);
    root.S.settings.id = 'settings';
    return root.DB.put('settings', root.S.settings).then(commit);
  }

  root.Actions = {
    newLog: newLog,
    addLog: addLog,
    updateLog: updateLog,
    deleteLog: deleteLog,
    undoDelete: undoDelete,
    addTransfer: addTransfer,
    checklistKey: checklistKey,
    checklistLogFor: checklistLogFor,
    isChecked: isChecked,
    setChecked: setChecked,
    savePlanItem: savePlanItem,
    deletePlanItem: deletePlanItem,
    syncChecklistLogAmount: syncChecklistLogAmount,
    saveAccount: saveAccount,
    deleteAccount: deleteAccount,
    reorderAccounts: reorderAccounts,
    saveSettings: saveSettings
  };
})(typeof self !== 'undefined' ? self : globalThis);
