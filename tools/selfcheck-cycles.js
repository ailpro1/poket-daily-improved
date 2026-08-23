/* Node harness — the cycle date maths for EVERY start day, 1 to 31.
   selfcheck.js only ever exercises day 1, which is what let the old 28 cap
   look load-bearing when clampDay() had it covered all along. Days 29-31 are
   the interesting ones: February has to fall back to its last day without
   tearing a gap or an overlap into the seam between two cycles.
   Not shipped with the app. */
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis; globalThis.self = globalThis;
['js/format.js', 'js/cycles.js'].forEach(f =>
  vm.runInThisContext(fs.readFileSync(__dirname + '/../' + f, 'utf8'), { filename: f }));

const C = globalThis.Cycles;
let fails = 0;
const check = (label, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? '  ' + extra : ''));
};

/* 2024 and 2028 are leap years, so February 29 is covered both ways. */
const KEYS = [];
for (let y = 2023; y <= 2028; y++) for (let m = 1; m <= 12; m++) KEYS.push(y + '-' + String(m).padStart(2, '0'));

const setDay = sd => { globalThis.S = { settings: { cycleStartDay: sd } }; };

/* ---- the cap really is gone -------------------------------------------- */
setDay(31);
check('start day 31 is accepted, not clamped to 28', C.startDay() === 31, C.startDay());
setDay(30);
check('start day 30 is accepted', C.startDay() === 30, C.startDay());
setDay(99);
check('nonsense above 31 still clamps to 31', C.startDay() === 31, C.startDay());
setDay(0);
check('zero still clamps to 1', C.startDay() === 1, C.startDay());

/* ---- the properties that must hold for every start day ----------------- */
const bad = { length: [], seam: [], mapping: [], leap: [] };
const lengths = {};

for (let sd = 1; sd <= 31; sd++) {
  setDay(sd);
  let prevEnd = null;
  for (const k of KEYS) {
    const r = C.getCycleRangeForKey(k);

    /* a cycle is a real, plausible span */
    if (!(r.totalDays >= 28 && r.totalDays <= 31)) bad.length.push(`sd=${sd} ${k}=${r.totalDays}d`);
    lengths[r.totalDays] = (lengths[r.totalDays] || 0) + 1;

    /* consecutive cycles touch exactly once: no gap, no overlap */
    if (prevEnd) {
      const step = C.daysBetween(prevEnd, r.start);
      if (step !== 1) bad.seam.push(`sd=${sd} ${k}: ${C.iso(prevEnd)}->${r.startIso} step ${step}`);
    }
    prevEnd = r.end;

    /* every date in the range agrees it belongs to this cycle, and the days
       either side of the range agree they do not */
    for (let i = 0; i < r.totalDays; i++) {
      const d = C.addDays(r.start, i);
      if (C.getMonthKey(d) !== k) { bad.mapping.push(`sd=${sd} ${k}: ${C.iso(d)}->${C.getMonthKey(d)}`); break; }
    }
    if (C.getMonthKey(C.addDays(r.start, -1)) === k) bad.mapping.push(`sd=${sd} ${k}: day before is inside`);
    if (C.getMonthKey(C.addDays(r.end, 1)) === k) bad.mapping.push(`sd=${sd} ${k}: day after is inside`);

    /* the start is the chosen day, or the month's last day when it is short */
    const lastOfMonth = new Date(r.start.getFullYear(), r.start.getMonth() + 1, 0).getDate();
    const wantStart = Math.min(sd, lastOfMonth);
    if (r.start.getDate() !== wantStart) {
      bad.leap.push(`sd=${sd} ${k}: starts ${r.start.getDate()}, expected ${wantStart}`);
    }
  }
}

check('every cycle is 28-31 days', !bad.length.length, bad.length.slice(0, 3).join(' | '));
check('consecutive cycles have no gap and no overlap', !bad.seam.length, bad.seam.slice(0, 3).join(' | '));
check('every date maps to exactly its own cycle', !bad.mapping.length, bad.mapping.slice(0, 3).join(' | '));
check('a short month starts on its last day', !bad.leap.length, bad.leap.slice(0, 3).join(' | '));
console.log('     cycle lengths seen: ' + Object.keys(lengths).sort((a, b) => a - b).join(', ') + ' days');

/* ---- the payday-on-the-30th case, spelled out ------------------------- */
setDay(30);
const feb = C.getCycleRangeForKey('2026-01');       /* 30 Jan -> Feb */
check('payday 30: January cycle starts on the 30th', feb.startIso === '2026-01-30', feb.startIso);
check('payday 30: it ends the day before February pays', feb.endIso === '2026-02-27', feb.endIso);
const febCycle = C.getCycleRangeForKey('2026-02');
check('payday 30: February falls back to the 28th', febCycle.startIso === '2026-02-28', febCycle.startIso);
check('payday 30: and March is back on the 30th',
  C.getCycleRangeForKey('2026-03').startIso === '2026-03-30', C.getCycleRangeForKey('2026-03').startIso);
check('payday 30: 27 Feb still belongs to the January cycle',
  C.getMonthKey('2026-02-27') === '2026-01', C.getMonthKey('2026-02-27'));
check('payday 30: 28 Feb starts the February cycle',
  C.getMonthKey('2026-02-28') === '2026-02', C.getMonthKey('2026-02-28'));

/* leap year: February has a 29th, so a 30th payday uses it */
const leap = C.getCycleRangeForKey('2028-02');
check('payday 30: a leap February uses the 29th', leap.startIso === '2028-02-29', leap.startIso);

/* ---- and the 31st, the tightest case ---------------------------------- */
setDay(31);
check('payday 31: January starts on the 31st',
  C.getCycleRangeForKey('2026-01').startIso === '2026-01-31');
check('payday 31: April falls back to the 30th',
  C.getCycleRangeForKey('2026-04').startIso === '2026-04-30', C.getCycleRangeForKey('2026-04').startIso);
check('payday 31: the shortest cycle is still a sane length',
  C.getCycleRangeForKey('2026-01').totalDays === 28, C.getCycleRangeForKey('2026-01').totalDays);

/* ---- the mid-cycle helpers inherit all of it -------------------------- */
setDay(30);
check('daysToCycleEnd counts to the clamped end',
  C.daysToCycleEnd('2026-02-20') === C.daysBetween('2026-02-20', '2026-02-27') + 1,
  C.daysToCycleEnd('2026-02-20'));
check('isMidCycle is false on a clamped start day', C.isMidCycle('2026-02-28') === false);
check('isMidCycle is true the day after one', C.isMidCycle('2026-03-01') === true);

console.log(fails ? '\n' + fails + ' FAILING' : '\nCycle maths holds for every start day.');
process.exit(fails ? 1 : 0);
