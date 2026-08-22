/* calc.js — SINGLE SOURCE OF TRUTH.
   Every number rendered anywhere in Poket Daily comes out of this file.
   No tab, card, total or chart may re-derive a figure with its own maths.

   Two families of numbers, deliberately different (spec 3.7):
     ACTUAL  — accountBalance / monthlyBalance / savingsBalance: live sums of
               real logs against real accounts. "What I have right now."
     PLANNED — dailyBudget: the forecast. "What I can safely spend today."

   Double-counting rule: the daily budget pool already deducts planned
   commitments + savings, so logs created by ticking the Checklist
   (sourceChecklistId set) are EXCLUDED from budget/breakdown spend.
   They are still real money and still hit account balances. */
(function (root) {
  'use strict';

  var C = root.Cycles;
  var R = function (n) { return root.Fmt.round2(n); };

  var cache = {};
  function invalidate() { cache = {}; }

  function S() { return root.S; }

  /* ---------- log classification ---------------------------------------- */

  function sign(log) {
    return (log.type === 'income' || log.type === 'transfer_in') ? 1 : -1;
  }
  function signedAmount(log) { return sign(log) * Math.abs(log.amount || 0); }
  function isTransfer(log) { return log.type === 'transfer_in' || log.type === 'transfer_out'; }
  function isChecklistLog(log) { return !!log.sourceChecklistId; }
  /* Counts against the daily spending budget? */
  function affectsBudget(log) { return !isTransfer(log) && !isChecklistLog(log); }

  /* ---------- accounts (spec 3.4) --------------------------------------- */

  function account(id) {
    var list = S().accounts;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function accountsOfType(type) {
    return S().accounts.filter(function (a) { return a.type === type; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  /* balance = startBalance + every signed log tagged to the account,
     optionally only up to and including a date. */
  function accountBalance(accountId, uptoIso) {
    var a = account(accountId);
    if (!a) return 0;
    var total = a.startBalance || 0;
    var logs = S().logs;
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      if (l.accountId !== accountId) continue;
      if (uptoIso && l.date > uptoIso) continue;
      total += signedAmount(l);
    }
    return R(total);
  }

  function sumAccounts(type, uptoIso) {
    return R(accountsOfType(type).reduce(function (t, a) {
      return t + accountBalance(a.id, uptoIso);
    }, 0));
  }

  /* spec 3.5 / 3.6 — live sums, never separately tracked */
  function monthlyBalance(uptoIso) { return sumAccounts('general', uptoIso); }
  function savingsBalance(uptoIso) { return sumAccounts('saving', uptoIso); }

  /* ---------- plan (spec 4) --------------------------------------------- */

  function planSections() { return ['income', 'commitments', 'savings']; }

  function planItems(section) { return (S().plan[section] || []); }

  function findPlanItem(id) {
    var secs = planSections();
    for (var i = 0; i < secs.length; i++) {
      var list = planItems(secs[i]);
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === id) return { item: list[j], section: secs[i] };
      }
    }
    return null;
  }

  function isActiveInCycle(item, cycleKey) {
    if (item.startMonth && cycleKey < item.startMonth) return false;
    if (item.endMonth && cycleKey > item.endMonth) return false;
    return true;
  }

  /* per-cycle override wins, else the permanent plan amount */
  function planAmount(item, cycleKey) {
    if (!isActiveInCycle(item, cycleKey)) return 0;
    var o = item.cycleOverrides || {};
    var v = Object.prototype.hasOwnProperty.call(o, cycleKey) ? o[cycleKey] : item.amount;
    return R(Math.abs(v || 0));
  }

  function planTotal(section, cycleKey) {
    return R(planItems(section).reduce(function (t, it) {
      return t + planAmount(it, cycleKey);
    }, 0));
  }

  /* the pool the daily budget divides up */
  function cyclePool(cycleKey) {
    return R(planTotal('income', cycleKey) - planTotal('commitments', cycleKey) - planTotal('savings', cycleKey));
  }

  function dailyAllowance(cycleKey) {
    var r = C.getCycleRangeForKey(cycleKey);
    return R(cyclePool(cycleKey) / r.totalDays);
  }

  /* ---------- spread vs one-time (spec 3.2) ------------------------------ */

  /* How much of this log lands on this specific day? */
  function attributedOnDay(log, iso) {
    if (log.spreadType !== 'spread') return log.date === iso ? Math.abs(log.amount || 0) : 0;
    var r = C.getCycleRangeForKey(C.getMonthKey(log.date));
    if (iso < log.date || iso > r.endIso) return 0;
    var days = C.daysBetween(log.date, r.end) + 1;
    return days > 0 ? Math.abs(log.amount || 0) / days : 0;
  }

  function attributedInRange(log, fromIso, toIso) {
    if (log.spreadType !== 'spread') {
      return (log.date >= fromIso && log.date <= toIso) ? Math.abs(log.amount || 0) : 0;
    }
    var r = C.getCycleRangeForKey(C.getMonthKey(log.date));
    var spreadStart = log.date, spreadEnd = r.endIso;
    var lo = spreadStart > fromIso ? spreadStart : fromIso;
    var hi = spreadEnd < toIso ? spreadEnd : toIso;
    if (lo > hi) return 0;
    var totalDays = C.daysBetween(spreadStart, spreadEnd) + 1;
    var hitDays = C.daysBetween(lo, hi) + 1;
    return Math.abs(log.amount || 0) * (hitDays / totalDays);
  }

  /* Net drain on the budget for one day: discretionary spend minus any
     unplanned income logged that day. Checklist logs and transfers excluded. */
  function budgetDrainOnDay(iso) {
    var k = 'drain:' + iso;
    if (cache[k] != null) return cache[k];
    var logs = S().logs, total = 0;
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      if (!affectsBudget(l)) continue;
      var amt = attributedOnDay(l, iso);
      if (!amt) continue;
      total += (l.type === 'income' ? -amt : amt);
    }
    cache[k] = R(total);
    return cache[k];
  }

  function budgetDrainInRange(fromIso, toIso) {
    var logs = S().logs, total = 0;
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      if (!affectsBudget(l)) continue;
      var amt = attributedInRange(l, fromIso, toIso);
      if (!amt) continue;
      total += (l.type === 'income' ? -amt : amt);
    }
    return R(total);
  }

  /* ---------- when did budgeting actually begin? (spec 3.3) -------------- */

  function firstActivityIso() {
    if (cache.first) return cache.first;
    var earliest = S().settings.budgetStartDate || null;
    S().logs.forEach(function (l) {
      if (!earliest || l.date < earliest) earliest = l.date;
    });
    S().accounts.forEach(function (a) {
      var iso = (a.createdAt || '').slice(0, 10);
      if (iso && (!earliest || iso < earliest)) earliest = iso;
    });
    cache.first = earliest || C.iso(C.today());
    return cache.first;
  }

  /* ---------- daily spending budget (spec 3.3) --------------------------- */

  /* Walks every day from the day budgeting began up to (not including) the
     given day, accumulating allowance minus actual drain. That single walk is
     what produces both within-cycle and across-cycle carry-over. */
  function carryInto(iso) {
    var k = 'carry:' + iso;
    if (cache[k] != null) return cache[k];
    var start = firstActivityIso();
    if (start >= iso) { cache[k] = 0; return 0; }
    var days = C.daysBetween(start, iso);
    if (days > 1500) { start = C.iso(C.addDays(iso, -1500)); days = 1500; }
    var running = 0, cur = start;
    for (var i = 0; i < days; i++) {
      running += dailyAllowance(C.getMonthKey(cur)) - budgetDrainOnDay(cur);
      cur = C.iso(C.addDays(cur, 1));
    }
    cache[k] = R(running);
    return cache[k];
  }

  function dailyBudget(iso) {
    var day = iso || C.iso(C.today());
    var cycleKey = C.getMonthKey(day);
    var range = C.getCycleRangeForKey(cycleKey);
    var allowance = dailyAllowance(cycleKey);
    var carry = carryInto(day);
    var spentToday = budgetDrainOnDay(day);
    var budget = R(allowance + carry);
    return {
      date: day,
      cycleKey: cycleKey,
      allowance: allowance,
      carry: carry,
      budget: budget,
      spentToday: R(spentToday),
      left: R(budget - spentToday),
      daysLeft: Math.max(0, C.daysBetween(day, range.end) + 1),
      totalDays: range.totalDays,
      pool: cyclePool(cycleKey)
    };
  }

  /* ---------- cycle roll-up used by Home + Log tabs ---------------------- */

  function cycleSummary(cycleKey) {
    var r = C.getCycleRangeForKey(cycleKey);
    var logs = logsInRange(r.startIso, r.endIso);
    var actualIncome = 0, actualSpent = 0, checklistSpent = 0;
    logs.forEach(function (l) {
      if (isTransfer(l)) return;
      if (l.type === 'income') actualIncome += Math.abs(l.amount);
      else {
        actualSpent += Math.abs(l.amount);
        if (isChecklistLog(l)) checklistSpent += Math.abs(l.amount);
      }
    });
    return {
      cycleKey: cycleKey,
      range: r,
      plannedIncome: planTotal('income', cycleKey),
      plannedCommitments: planTotal('commitments', cycleKey),
      plannedSavings: planTotal('savings', cycleKey),
      pool: cyclePool(cycleKey),
      actualIncome: R(actualIncome),
      actualSpent: R(actualSpent),
      checklistSpent: R(checklistSpent),
      discretionarySpent: budgetDrainInRange(r.startIso, r.endIso)
    };
  }

  function logsInRange(fromIso, toIso, filter) {
    return S().logs.filter(function (l) {
      if (l.date < fromIso || l.date > toIso) return false;
      if (filter && !filter(l)) return false;
      return true;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || '') > (a.createdAt || '') ? 1 : -1;
    });
  }

  /* ---------- category breakdown (spec 3.8) ------------------------------ */

  function categoryTotals(fromIso, toIso, kind) {
    var want = kind || 'expense';
    var map = {}, total = 0;
    S().logs.forEach(function (l) {
      if (isTransfer(l)) return;
      if (!affectsBudget(l)) return;          /* same exclusion as the budget */
      if (want === 'expense' && l.type !== 'expense') return;
      if (want === 'income' && l.type !== 'income') return;
      var amt = attributedInRange(l, fromIso, toIso);
      if (!amt) return;
      var key = l.categoryId || 'uncategorised';
      var name = l.categoryName || 'Uncategorised';
      if (!map[key]) map[key] = { id: key, name: name, amount: 0, count: 0 };
      map[key].amount += amt;
      map[key].count += 1;
      total += amt;
    });
    var list = Object.keys(map).map(function (k) {
      map[k].amount = R(map[k].amount);
      map[k].share = total ? map[k].amount / total : 0;
      return map[k];
    }).sort(function (a, b) { return b.amount - a.amount; });
    return { total: R(total), items: list };
  }

  /* ---------- series for charts (spec 3.9) -------------------------------
     Built by calling the very same balance functions per date. */

  function balanceSeries(kind, fromIso, toIso, step) {
    var fn = kind === 'saving' ? savingsBalance : monthlyBalance;
    var out = [], cur = fromIso, guard = 0;
    var stepDays = step === 'week' ? 7 : step === 'month' ? 0 : 1;
    if (stepDays === 0) {
      var k = C.getMonthKey(fromIso), endKey = C.getMonthKey(toIso);
      while (k <= endKey && guard++ < 400) {
        var r = C.getCycleRangeForKey(k);
        var at = r.endIso > toIso ? toIso : r.endIso;
        out.push({ iso: at, label: C.cycleLabel(k), value: fn(at) });
        k = C.shiftCycleKey(k, 1);
      }
      return out;
    }
    while (cur <= toIso && guard++ < 800) {
      out.push({ iso: cur, label: C.dateLabel(cur), value: fn(cur) });
      cur = C.iso(C.addDays(cur, stepDays));
    }
    if (out.length && out[out.length - 1].iso !== toIso) {
      out.push({ iso: toIso, label: C.dateLabel(toIso), value: fn(toIso) });
    }
    return out;
  }

  /* Savings forecast: continue at the current plan's savings rate. */
  function savingsForecast(fromIso, months) {
    var base = savingsBalance(fromIso);
    var out = [{ iso: fromIso, label: C.dateLabel(fromIso), value: base, forecast: true }];
    var k = C.getMonthKey(fromIso);
    for (var i = 1; i <= (months || 6); i++) {
      k = C.shiftCycleKey(k, 1);
      var r = C.getCycleRangeForKey(k);
      base = R(base + planTotal('savings', k));
      out.push({ iso: r.endIso, label: C.cycleLabel(k), value: base, forecast: true });
    }
    return out;
  }

  root.Calc = {
    invalidate: invalidate,
    sign: sign,
    signedAmount: signedAmount,
    isTransfer: isTransfer,
    isChecklistLog: isChecklistLog,
    affectsBudget: affectsBudget,
    account: account,
    accountsOfType: accountsOfType,
    accountBalance: accountBalance,
    monthlyBalance: monthlyBalance,
    savingsBalance: savingsBalance,
    planSections: planSections,
    planItems: planItems,
    findPlanItem: findPlanItem,
    isActiveInCycle: isActiveInCycle,
    planAmount: planAmount,
    planTotal: planTotal,
    cyclePool: cyclePool,
    dailyAllowance: dailyAllowance,
    attributedOnDay: attributedOnDay,
    attributedInRange: attributedInRange,
    budgetDrainOnDay: budgetDrainOnDay,
    budgetDrainInRange: budgetDrainInRange,
    firstActivityIso: firstActivityIso,
    carryInto: carryInto,
    dailyBudget: dailyBudget,
    cycleSummary: cycleSummary,
    logsInRange: logsInRange,
    categoryTotals: categoryTotals,
    balanceSeries: balanceSeries,
    savingsForecast: savingsForecast
  };
})(typeof self !== 'undefined' ? self : globalThis);
