/* Node harness — the carry-over policy at a cycle boundary.
   Carry-over used to be unconditional; settings.carryOver now chooses what
   survives the seam. The interesting case is the HANDOFF: carryInto(iso)
   walks up to the day before iso, so a carry landing on a cycle's first day
   crosses no boundary inside the loop at all. Not shipped with the app. */
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis; globalThis.self = globalThis;
['js/format.js', 'js/cycles.js', 'js/calc.js'].forEach(f =>
  vm.runInThisContext(fs.readFileSync(__dirname + '/../' + f, 'utf8'), { filename: f }));

const { Calc, Cycles } = globalThis;
let fails = 0;
const eq = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.02;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got.toFixed(2) + ' want=' + want.toFixed(2));
};
const is = (label, got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
};

/* June 2026: 30 days, pool 3000, so exactly RM100 a day. */
const CY = '2026-06';
const r = Cycles.getCycleRangeForKey(CY);
const nr = Cycles.getCycleRangeForKey(Cycles.shiftCycleKey(CY, 1));
const day = n => Cycles.iso(Cycles.addDays(r.start, n - 1));
const POOL = 3000, PER_DAY = POOL / 30;

function build(mode, spendDay1) {
  globalThis.S = {
    settings: {
      currency: 'RM', cycleStartDay: 1, budgetStartDate: r.startIso,
      carryOver: mode, midCycleMode: 'prorate'
    },
    accounts: [{ id: 'a1', name: 'Bank', type: 'general', startBalance: 9000, order: 0, createdAt: r.startIso }],
    plan: { income: [{ id: 'i1', name: 'Gaji', amount: POOL, accountId: 'a1' }], commitments: [], savings: [] },
    logs: [], checklist: {}
  };
  if (spendDay1) {
    S.logs.push({ id: 'l1', name: 'Splurge', amount: spendDay1, type: 'expense', spreadType: 'onetime', date: day(1), accountId: 'a1', categoryId: 'c', categoryName: 'C' });
  }
  Calc.invalidate();
}

/* ---- the setting resolves safely ------------------------------------- */
build('on', 0);      is('default is the historical roll-everything', Calc.carryMode(), 'on');
build('surplus', 0); is('surplus mode resolves', Calc.carryMode(), 'surplus');
build('off', 0);     is('off mode resolves', Calc.carryMode(), 'off');
globalThis.S.settings.carryOver = 'nonsense'; Calc.invalidate();
is('an unknown value falls back to on', Calc.carryMode(), 'on');
delete globalThis.S.settings.carryOver; Calc.invalidate();
is('a missing value falls back to on', Calc.carryMode(), 'on');

/* ---- a surplus at the seam -------------------------------------------- */
console.log('\nsurplus: spend nothing, so the cycle ends +' + POOL);
build('on', 0);      eq('on keeps the surplus', Calc.dailyBudget(nr.startIso).carry, POOL);
build('surplus', 0); eq('surplus keeps the surplus', Calc.dailyBudget(nr.startIso).carry, POOL);
build('off', 0);     eq('off drops the surplus', Calc.dailyBudget(nr.startIso).carry, 0);

/* ---- a shortfall at the seam ------------------------------------------ */
console.log('\nshortfall: blow 5000 on day 1, so the cycle ends -2000');
build('on', 5000);      eq('on carries the shortfall', Calc.dailyBudget(nr.startIso).carry, POOL - 5000);
build('surplus', 5000); eq('surplus forgives the shortfall', Calc.dailyBudget(nr.startIso).carry, 0);
build('off', 5000);     eq('off forgives it too', Calc.dailyBudget(nr.startIso).carry, 0);

/* ---- within a cycle the policy must not interfere --------------------- */
console.log('\nwithin one cycle, every mode must agree');
const within = 4 * PER_DAY - 5000;
['on', 'surplus', 'off'].forEach(m => {
  build(m, 5000);
  eq(m + ': day-5 carry is untouched by the policy', Calc.dailyBudget(day(5)).carry, within);
});

/* ---- and mid-way through the NEXT cycle ------------------------------- */
console.log('\nten days into the next cycle, after a -2000 finish');
const tenIn = Cycles.iso(Cycles.addDays(nr.start, 9));
/* Built from dailyAllowance(), not POOL/totalDays: the walk accumulates the
   CENT-ROUNDED daily figure, and July's 31 days do not divide 3000 evenly. */
build('on', 0);
const nextPerDay = Calc.dailyAllowance(Cycles.shiftCycleKey(CY, 1));
build('on', 5000);      eq('on still owes the 2000', Calc.dailyBudget(tenIn).carry, (POOL - 5000) + 9 * nextPerDay);
build('surplus', 5000); eq('surplus started the cycle clean', Calc.dailyBudget(tenIn).carry, 9 * nextPerDay);
build('off', 5000);     eq('off started the cycle clean', Calc.dailyBudget(tenIn).carry, 9 * nextPerDay);

/* ---- two boundaries in a row ----------------------------------------- */
console.log('\ntwo cycles on, having never spent a thing');
const two = Cycles.getCycleRangeForKey(Cycles.shiftCycleKey(CY, 2));
build('off', 0);
eq('off never accumulates across either seam', Calc.dailyBudget(two.startIso).carry, 0);
build('surplus', 0);
eq('surplus accumulates across both', Calc.dailyBudget(two.startIso).carry, POOL + nr.totalDays * nextPerDay);

/* ---- the mid-cycle rule still composes with it ----------------------- */
console.log('\ncomposing with a mid-cycle join');
build('off', 0);
globalThis.S.settings.midCycleMode = 'remaining';
globalThis.S.settings.midCycleJoinDate = day(12);
globalThis.S.settings.midCycleRemaining = 900;
globalThis.S.settings.budgetStartDate = day(12);
Calc.invalidate();
eq('joining day 12 still has no carry on the join day', Calc.dailyBudget(day(12)).carry, 0);
eq('and the stated figure still spreads over the days left', Calc.dailyAllowance(CY), 900 / 19);
eq('off still clears the seam into the next cycle', Calc.dailyBudget(nr.startIso).carry, 0);

console.log(fails ? '\n' + fails + ' FAILING' : '\nCarry-over policy behaves.');
process.exit(fails ? 1 : 0);
