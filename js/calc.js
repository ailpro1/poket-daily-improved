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

  /* Everything you own across both groups. Same live-sum rule, so it always
     equals the two balances added up. */
  function netWorth(uptoIso) { return R(monthlyBalance(uptoIso) + savingsBalance(uptoIso)); }

  /* How much the total has moved during this money month, and the split
     between spending and savings. Neither figure repeats what the account
     groups below already show. */
  function netWorthSummary(cycleKey) {
    var r = C.getCycleRangeForKey(cycleKey || C.currentCycleKey());
    var startedIso = C.iso(C.addDays(r.start, -1));   /* close of the day before */
    var spend = monthlyBalance();
    var saved = savingsBalance();
    var total = R(spend + saved);
    var span = Math.abs(spend) + Math.abs(saved);
    return {
      total: total,
      spending: spend,
      savings: saved,
      /* Shares are of the absolute split, so an overdrawn account cannot
         push a bar past 100% or flip it negative. */
      spendingShare: span ? Math.abs(spend) / span : 0,
      savingsShare: span ? Math.abs(saved) / span : 0,
      change: R(total - netWorth(startedIso)),
      sinceIso: r.startIso
    };
  }

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

  /* Display order for plan lists: biggest first, so what moves the pool most
     is at the top. Sorts on the CYCLE's amount, so a per-cycle override
     reorders with it and an item that has ended (0 this cycle) falls to the
     bottom. Ties break on the permanent amount, then name, so the order never
     jitters between renders.

     Deliberately NOT folded into planItems(): that is on carryInto()'s
     day-by-day walk via planTotal(), and must not sort 1500 times over. */
  function planItemsSorted(section, cycleKey) {
    return planItems(section).slice().sort(function (a, b) {
      var d = planAmount(b, cycleKey) - planAmount(a, cycleKey);
      if (d) return d;
      d = Math.abs(b.amount || 0) - Math.abs(a.amount || 0);
      if (d) return d;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
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

  /* ---------- joining part-way through a cycle ---------------------------
     Someone who installs on day 20 has neither a full cycle's pool left nor
     a full cycle's days to spend it over. When they tell us what is actually
     left, that figure — not the Plan's pool — is what gets spread, and only
     over the days from the join date to the cycle end.

     Nothing derived is ever stored: the cycle key and the day count are
     recomputed from the join DATE, so editing cycleStartDay re-derives them
     and a past cycle recomputes identically forever.

     Known limitation: attributedOnDay() spreads a 'spread' log to its cycle
     end, so a spread expense backdated ACROSS the join is partly charged
     against a stated figure that already included it. Only reachable by
     deliberately backdating a spread log over the join date; clamping it
     would put a branch on the hot path for every day of every day-strip. */
  function midCycle() {
    if ('mid' in cache) return cache.mid;      /* null is a meaningful value */
    var s = S().settings || {};
    var out = null;
    if ((s.midCycleMode || 'prorate') === 'remaining') {
      var join = s.midCycleJoinDate || s.budgetStartDate || null;
      /* A join on day 1 is not mid-cycle at all, so the rule self-disables.
         That guard is what absorbs a later cycleStartDay edit. */
      if (join && C.isMidCycle(join)) {
        out = {
          joinIso: join,
          cycleKey: C.getMonthKey(join),
          days: C.daysToCycleEnd(join),
          remaining: R(Math.abs(s.midCycleRemaining || 0))
        };
      }
    }
    cache.mid = out;
    return out;
  }

  function dailyAllowance(cycleKey) {
    var m = midCycle();
    if (m && m.cycleKey === String(cycleKey)) return R(m.remaining / m.days);
    var r = C.getCycleRangeForKey(cycleKey);
    return R(cyclePool(cycleKey) / r.totalDays);
  }

  /* The log a ticked-off plan item wrote, if it has been ticked this cycle.
     Mirrors Actions.checklistLogFor, but calc must not depend on actions —
     the dependency runs the other way. */
  function planItemLog(cycleKey, itemId) {
    var logs = S().logs;
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].sourceChecklistId === itemId && logs[i].sourceCycle === cycleKey) return logs[i];
    }
    return null;
  }

  /* Plan money for this cycle that has not been ticked off the checklist. */
  function planOutstanding(section, cycleKey) {
    return R(planItems(section).reduce(function (t, it) {
      var amt = planAmount(it, cycleKey);
      if (!amt || planItemLog(cycleKey, it.id)) return t;
      return t + amt;
    }, 0));
  }

  /* ---------- committed money, per plan item -----------------------------
     The complement of categoryTotals(): that shows discretionary spending,
     which deliberately excludes anything ticked off the Plan, so on its own
     it can never account for a whole cycle. This is the other half —
     commitments and savings, per item, with what has actually been paid.
     Income is left out: it is money arriving, not money going somewhere. */
  function planBreakdown(cycleKey) {
    var items = [], total = 0, paid = 0;
    ['commitments', 'savings'].forEach(function (sec) {
      planItems(sec).forEach(function (it) {
        var amt = planAmount(it, cycleKey);   /* 0 when inactive this cycle */
        if (!amt) return;
        var log = planItemLog(cycleKey, it.id);
        items.push({
          id: it.id, name: it.name, section: sec, amount: amt,
          paid: !!log, accountId: it.accountId
        });
        total += amt;
        if (log) paid += amt;
      });
    });
    items.forEach(function (i) { i.share = total ? i.amount / total : 0; });
    items.sort(function (a, b) { return b.amount - a.amount; });
    return {
      total: R(total),
      paid: R(paid),
      unpaid: R(total - paid),
      items: items,
      commitments: planTotal('commitments', cycleKey),
      savings: planTotal('savings', cycleKey)
    };
  }

  /* Best guess at "spending money I have left" for the mid-cycle question.
     With an empty Plan this is just the general-account balances, which is
     exactly the cash on hand; it self-improves as Plan items appear. */
  function suggestMidCycleRemaining(joinIso) {
    var at = joinIso || C.iso(C.today()), key = C.getMonthKey(at);
    return R(monthlyBalance(at) + planOutstanding('income', key)
      - planOutstanding('commitments', key) - planOutstanding('savings', key));
  }

  /* ---------- money in, planned and unplanned ----------------------------
     The mirror of planBreakdown(). categoryTotals(..., 'income') only ever
     showed income the user logged by hand, because a ticked-off Plan income
     item writes a checklist log and affectsBudget() excludes those. So
     planned income — usually the salary, i.e. nearly all of it — was missing
     from the chart entirely. This puts both in, once each: the Plan item
     carries the amount, its log stays excluded, so nothing double-counts. */
  function incomeBreakdown(cycleKey) {
    var r = C.getCycleRangeForKey(cycleKey);
    var items = [], total = 0, received = 0;

    planItems('income').forEach(function (it) {
      var amt = planAmount(it, cycleKey);       /* 0 when inactive this cycle */
      if (!amt) return;
      var log = planItemLog(cycleKey, it.id);
      items.push({
        id: it.id, name: it.name, kind: 'plan', amount: amt,
        received: !!log, accountId: it.accountId
      });
      total += amt;
      if (log) received += amt;
    });

    /* Anything logged by hand is money that actually arrived, so it counts
       as received whether or not it was ever planned. */
    categoryTotals(r.startIso, r.endIso, 'income').items.forEach(function (c) {
      items.push({
        id: 'cat:' + c.id, name: c.name, kind: 'logged', amount: c.amount,
        received: true, count: c.count
      });
      total += c.amount;
      received += c.amount;
    });

    items.forEach(function (i) { i.share = total ? i.amount / total : 0; });
    items.sort(function (a, b) { return b.amount - a.amount; });
    return {
      total: R(total),
      received: R(received),
      due: R(total - received),
      items: items,
      planned: planTotal('income', cycleKey),
      unplanned: R(categoryTotals(r.startIso, r.endIso, 'income').total)
    };
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

  /* ---------- carry-over policy ------------------------------------------
     'on'      a surplus or shortfall follows you across cycle boundaries
               (the original behaviour, and still the default)
     'surplus' a surplus follows you, a shortfall is forgiven at each new
               cycle. Generous by design: nothing ever absorbs overspending,
               so the daily figure can only ever be flattering.
     'off'     every cycle starts from zero; only within-cycle carry counts */
  function carryMode() {
    var m = (S().settings || {}).carryOver;
    return (m === 'surplus' || m === 'off') ? m : 'on';
  }

  /* ---------- daily spending budget (spec 3.3) --------------------------- */

  /* Walks every day from the day budgeting began up to (not including) the
     given day, accumulating allowance minus actual drain. That single walk is
     what produces both within-cycle and across-cycle carry-over. */
  function carryInto(iso) {
    var k = 'carry:' + iso;
    if (cache[k] != null) return cache[k];
    var start = firstActivityIso();
    /* Pre-join spending is already deducted inside the figure the user typed,
       so re-charging it from the logs would double-count it. The floor is a
       max(), so a backdated log can no longer pull the walk behind the day
       budgeting began, and it only ever shortens the walk. */
    var m = midCycle();
    if (m && m.joinIso > start) start = m.joinIso;
    if (start >= iso) { cache[k] = 0; return 0; }
    var days = C.daysBetween(start, iso);
    if (days > 1500) { start = C.iso(C.addDays(iso, -1500)); days = 1500; }
    var mode = carryMode();
    var running = 0, cur = start, prevKey = null;

    /* Crossing into a new cycle is where the policy bites. Compare keys
       rather than re-deriving the range: this runs up to 1500 times and
       getMonthKey() is needed for the allowance anyway. */
    function boundary(key) {
      if (mode !== 'on' && prevKey && key !== prevKey && (mode === 'off' || running < 0)) running = 0;
      prevKey = key;
    }

    for (var i = 0; i < days; i++) {
      var key = C.getMonthKey(cur);
      boundary(key);
      running += dailyAllowance(key) - budgetDrainOnDay(cur);
      cur = C.iso(C.addDays(cur, 1));
    }
    /* The walk stops the day BEFORE iso, so the handoff into iso's own cycle
       has not happened yet — and for a carry that lands on a cycle's first
       day that is the only crossing there is. */
    boundary(C.getMonthKey(iso));
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
    var m = midCycle();
    var mid = (m && m.cycleKey === cycleKey) ? m : null;
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
      pool: cyclePool(cycleKey),
      /* null on every ordinary cycle — the single test the UI needs */
      midCycleJoinIso: mid ? mid.joinIso : null,
      midCycleDays: mid ? mid.days : null,
      effectivePool: mid ? mid.remaining : cyclePool(cycleKey),
      poolBasis: mid ? 'stated' : 'plan'
    };
  }

  /* ---------- the next few days ------------------------------------------
     Today plus the days after it, each broken into the two parts it is made
     of: what rolled over from the day before, and that day's own share.

     Future days assume nothing more is spent today — there is no honest way
     to guess otherwise, so the UI has to say so. carryInto() already handles
     it: for tomorrow the walk includes today, so today's unspent remainder
     becomes tomorrow's roll-over on its own. */
  function forecastDays(count, fromIso) {
    var start = fromIso || C.iso(C.today());
    var out = [];
    for (var i = 0; i < (count || 3); i++) {
      var iso = C.iso(C.addDays(start, i));
      var db = dailyBudget(iso);
      out.push({
        iso: iso,
        offset: i,
        rollover: db.carry,          /* left over from the day before */
        allowance: db.allowance,     /* this day's own share */
        budget: db.budget,           /* rollover + allowance */
        spent: i === 0 ? db.spentToday : 0,
        left: i === 0 ? db.left : db.budget,
        projected: i > 0
      });
    }
    return out;
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
    netWorth: netWorth,
    netWorthSummary: netWorthSummary,
    planSections: planSections,
    planItems: planItems,
    planItemsSorted: planItemsSorted,
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
    midCycle: midCycle,
    planOutstanding: planOutstanding,
    planItemLog: planItemLog,
    planBreakdown: planBreakdown,
    incomeBreakdown: incomeBreakdown,
    suggestMidCycleRemaining: suggestMidCycleRemaining,
    carryMode: carryMode,
    carryInto: carryInto,
    dailyBudget: dailyBudget,
    forecastDays: forecastDays,
    cycleSummary: cycleSummary,
    logsInRange: logsInRange,
    categoryTotals: categoryTotals,
    balanceSeries: balanceSeries,
    savingsForecast: savingsForecast
  };
})(typeof self !== 'undefined' ? self : globalThis);
