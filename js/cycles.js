/* cycles.js — THE only place cycle date maths lives.
   Everything else must call getMonthKey() / getCycleRangeForKey().
   A cycle key is "YYYY-MM" of the cycle's START month.
   With cycleStartDay = 25, key "2026-01" means 25 Jan 2026 -> 24 Feb 2026. */
(function (root) {
  'use strict';

  /* 1-31. A day that a given month does not have falls back to that month's
     last day via clampDay(), which is what a bank does with a payday on the
     30th: February pays on the 28th (29th in a leap year). Cycles stay
     contiguous either way — tools/selfcheck-cycles.js proves it for every
     start day. */
  function startDay() {
    var s = root.S && root.S.settings ? root.S.settings.cycleStartDay : 1;
    return Math.min(31, Math.max(1, parseInt(s, 10) || 1));
  }

  /* Dates are handled at local noon so DST never shifts a day. */
  function d(y, m, day) { return new Date(y, m, day, 12, 0, 0, 0); }

  function toDate(v) {
    if (v instanceof Date) return d(v.getFullYear(), v.getMonth(), v.getDate());
    var p = String(v).slice(0, 10).split('-');
    return d(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }

  function iso(date) {
    var x = toDate(date);
    var m = String(x.getMonth() + 1).padStart(2, '0');
    var dd = String(x.getDate()).padStart(2, '0');
    return x.getFullYear() + '-' + m + '-' + dd;
  }

  function today() { return toDate(new Date()); }

  function addDays(date, n) {
    var x = toDate(date);
    return d(x.getFullYear(), x.getMonth(), x.getDate() + n);
  }

  function daysBetween(a, b) {
    return Math.round((toDate(b) - toDate(a)) / 86400000);
  }

  function clampDay(y, m, day) {
    var last = new Date(y, m + 1, 0).getDate();
    return Math.min(day, last);
  }

  /* Which cycle does this date belong to? */
  function getMonthKey(date) {
    var x = toDate(date);
    var sd = startDay();
    var y = x.getFullYear(), m = x.getMonth();
    if (x.getDate() < clampDay(y, m, sd)) {
      m -= 1;
      if (m < 0) { m = 11; y -= 1; }
    }
    return y + '-' + String(m + 1).padStart(2, '0');
  }

  function getCycleRangeForKey(cycleKey) {
    var p = String(cycleKey).split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1;
    var sd = startDay();
    var start = d(y, m, clampDay(y, m, sd));
    var ny = m === 11 ? y + 1 : y, nm = m === 11 ? 0 : m + 1;
    var nextStart = d(ny, nm, clampDay(ny, nm, sd));
    var end = addDays(nextStart, -1);
    return {
      key: String(cycleKey),
      start: start,
      end: end,
      startIso: iso(start),
      endIso: iso(end),
      totalDays: daysBetween(start, end) + 1
    };
  }

  function shiftCycleKey(cycleKey, n) {
    var p = String(cycleKey).split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  }

  function cycleKeysBetween(fromKey, toKey) {
    var out = [], k = fromKey, guard = 0;
    while (k <= toKey && guard++ < 600) { out.push(k); k = shiftCycleKey(k, 1); }
    return out;
  }

  function currentCycleKey() { return getMonthKey(today()); }

  /* Inclusive day count from a date to the end of its own cycle. */
  function daysToCycleEnd(dateIso) {
    var r = getCycleRangeForKey(getMonthKey(dateIso));
    return daysBetween(dateIso, r.end) + 1;
  }

  /* Is this date past the first day of its own cycle? */
  function isMidCycle(dateIso) {
    return iso(dateIso) > getCycleRangeForKey(getMonthKey(dateIso)).startIso;
  }

  function inCycle(dateIso, cycleKey) { return getMonthKey(dateIso) === String(cycleKey); }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function cycleLabel(cycleKey) {
    var r = getCycleRangeForKey(cycleKey);
    if (startDay() === 1) return MONTHS[r.start.getMonth()] + ' ' + r.start.getFullYear();
    return r.start.getDate() + ' ' + MONTHS[r.start.getMonth()] + ' – ' +
      r.end.getDate() + ' ' + MONTHS[r.end.getMonth()] + ' ' + r.end.getFullYear();
  }

  function dateLabel(dateIso) {
    var x = toDate(dateIso);
    return x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + x.getFullYear();
  }

  root.Cycles = {
    MONTHS: MONTHS,
    startDay: startDay,
    toDate: toDate,
    iso: iso,
    today: today,
    addDays: addDays,
    daysBetween: daysBetween,
    getMonthKey: getMonthKey,
    getCycleRangeForKey: getCycleRangeForKey,
    shiftCycleKey: shiftCycleKey,
    cycleKeysBetween: cycleKeysBetween,
    currentCycleKey: currentCycleKey,
    daysToCycleEnd: daysToCycleEnd,
    isMidCycle: isMidCycle,
    inCycle: inCycle,
    cycleLabel: cycleLabel,
    dateLabel: dateLabel
  };
})(typeof self !== 'undefined' ? self : globalThis);
