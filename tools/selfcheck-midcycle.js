/* Node harness — the mid-cycle-start rule against the real calc.js/cycles.js.
   selfcheck.js deliberately pins the UNMODIFIED baseline, so this lives apart.
   Not shipped with the app. */
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis; globalThis.self = globalThis;
['js/format.js', 'js/cycles.js', 'js/calc.js'].forEach(f =>
  vm.runInThisContext(fs.readFileSync(__dirname + '/../' + f, 'utf8'), { filename: f }));

const { Calc, Cycles, Fmt } = globalThis;

let fails = 0;
const eq = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.005;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got.toFixed(4) + ' want=' + want.toFixed(4));
};
const is = (label, got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
};

/* A cycle of a known length, so "day 12 of 30" is not calendar-dependent:
   June runs 1–30 with cycleStartDay 1. */
const CYCLE = '2026-06';
const range = Cycles.getCycleRangeForKey(CYCLE);
const day = n => Cycles.iso(Cycles.addDays(range.start, n - 1));
const joinIso = day(12);          /* installed on the 12th */
const DAYS_LEFT = 19;             /* 12..30 inclusive */
const POOL = 5000 - 1200 - 800;

function build(settings) {
  globalThis.S = {
    settings: Object.assign({
      currency: 'RM', cycleStartDay: 1, budgetStartDate: joinIso,
      midCycleMode: 'prorate', midCycleJoinDate: null, midCycleRemaining: null
    }, settings || {}),
    accounts: [{ id: 'a1', name: 'Maybank', type: 'general', startBalance: 2000, order: 0, createdAt: joinIso }],
    plan: {
      income: [{ id: 'i1', name: 'Salary', amount: 5000, accountId: 'a1' }],
      commitments: [{ id: 'c1', name: 'Rent', amount: 1200, accountId: 'a1' }],
      savings: [{ id: 'v1', name: 'ASB monthly', amount: 800, accountId: 'a1' }]
    },
    logs: [],
    checklist: {}
  };
  Calc.invalidate();
}
const log = o => {
  S.logs.push(Object.assign({ id: Fmt.uid('t'), spreadType: 'onetime', type: 'expense', createdAt: new Date().toISOString() }, o));
  Calc.invalidate();
};

/* ---- 1. the stated figure spreads over the days that are left ----------- */
build({ midCycleMode: 'remaining', midCycleJoinDate: joinIso, midCycleRemaining: 900 });
is('cycle really is 30 days', range.totalDays, 30);
is('days from join to cycle end', Cycles.daysToCycleEnd(joinIso), DAYS_LEFT);
eq('allowance = stated / days left', Calc.dailyAllowance(CYCLE), 900 / DAYS_LEFT);
eq('no carry on the day budgeting began', Calc.dailyBudget(joinIso).carry, 0);
eq('day-one budget === allowance', Calc.dailyBudget(joinIso).budget, 900 / DAYS_LEFT);
is('dailyBudget flags the joining cycle', Calc.dailyBudget(joinIso).midCycleJoinIso, joinIso);
is('and names its basis', Calc.dailyBudget(joinIso).poolBasis, 'stated');
eq('effectivePool is the stated figure', Calc.dailyBudget(joinIso).effectivePool, 900);
eq('pool still reports the Plan', Calc.dailyBudget(joinIso).pool, POOL);

/* ---- 2. pre-join spending is real money but not a budget drain ---------- */
log({ name: 'Petrol before install', amount: 150, date: day(3), accountId: 'a1', categoryId: 'car', categoryName: 'Car' });
eq('pre-join spend leaves carry alone', Calc.dailyBudget(joinIso).carry, 0);
eq('pre-join spend still hits the account balance', Calc.monthlyBalance(), 2000 - 150);
eq('pre-join spend still counts as actual spend', Calc.cycleSummary(CYCLE).actualSpent, 150);

/* a day AFTER the join does draw down the budget as normal */
log({ name: 'Nasi lemak', amount: 20, date: day(12), accountId: 'a1', categoryId: 'food', categoryName: 'Food' });
eq('post-join spend lands on the day', Calc.budgetDrainOnDay(day(12)), 20);
eq('and one day later shows as carry', Calc.dailyBudget(day(13)).carry, 900 / DAYS_LEFT - 20);

/* ---- 3. the rule does not leak past its own cycle ----------------------- */
const nextKey = Cycles.shiftCycleKey(CYCLE, 1);
const nextRange = Cycles.getCycleRangeForKey(nextKey);
eq('next cycle uses the Plan pool over its own days',
  Calc.dailyAllowance(nextKey), POOL / nextRange.totalDays);
is('next cycle is not flagged mid-cycle', Calc.dailyBudget(nextRange.startIso).midCycleJoinIso, null);
/* carry still crosses the boundary: the 19 joining days minus the 20 spent.
   Built from the allowance rather than from 900, because each day's allowance
   is rounded to the cent before it is accumulated. */
eq('carry crosses the cycle boundary',
  Calc.dailyBudget(nextRange.startIso).carry, DAYS_LEFT * Calc.dailyAllowance(CYCLE) - 20);

/* ---- 4. a join that lands on day 1 disables the rule ------------------- */
build({ midCycleMode: 'remaining', midCycleJoinDate: range.startIso, midCycleRemaining: 900 });
eq('day-1 join falls back to the Plan pool', Calc.dailyAllowance(CYCLE), POOL / range.totalDays);
is('and is not flagged', Calc.dailyBudget(range.startIso).midCycleJoinIso, null);

/* the same self-disabling when cycleStartDay is edited so the join is day 1 */
build({ cycleStartDay: 12, midCycleMode: 'remaining', midCycleJoinDate: joinIso, midCycleRemaining: 900 });
const shifted = Cycles.getMonthKey(joinIso);
eq('cycleStartDay edit that makes the join day 1 disables the rule',
  Calc.dailyAllowance(shifted), Calc.cyclePool(shifted) / Cycles.getCycleRangeForKey(shifted).totalDays);

/* ---- 5. 'prorate' is inert ---------------------------------------------- */
build({ midCycleMode: 'prorate', midCycleJoinDate: joinIso, midCycleRemaining: 900 });
eq('prorate keeps pool / totalDays', Calc.dailyAllowance(CYCLE), POOL / range.totalDays);
is('prorate never flags a cycle', Calc.dailyBudget(joinIso).midCycleJoinIso, null);
is('prorate reports a plan basis', Calc.dailyBudget(joinIso).poolBasis, 'plan');
build({});
is('missing mid-cycle settings resolve to no rule', Calc.midCycle(), null);
eq('and keep pool / totalDays', Calc.dailyAllowance(CYCLE), POOL / range.totalDays);

/* ---- 6. the suggested figure ------------------------------------------- */
/* At onboarding time the Plan is still empty, so the suggestion must fall back
   to the cash actually in the spending accounts. */
build({});
S.plan = { income: [], commitments: [], savings: [] };
Calc.invalidate();
eq('with an empty plan the suggestion is cash on hand',
  Calc.suggestMidCycleRemaining(joinIso), 2000);

/* Once a Plan exists, income still to arrive counts and money still owed does not. */
build({});
eq('an unticked plan adjusts the suggestion',
  Calc.suggestMidCycleRemaining(joinIso), 2000 + 5000 - 1200 - 800);

/* Ticking a commitment off must not move the figure: the money leaves the
   account balance and stops being outstanding in the same breath. */
log({ name: 'Rent', amount: 1200, date: joinIso, accountId: 'a1', sourceChecklistId: 'c1', sourceCycle: CYCLE, sourceSection: 'commitments' });
eq('ticking a commitment off leaves the suggestion where it was',
  Calc.suggestMidCycleRemaining(joinIso), 2000 + 5000 - 1200 - 800);
eq('and the account balance did move', Calc.monthlyBalance(), 2000 - 1200);

/* An unplanned expense does reduce it. */
log({ name: 'Kopi', amount: 15, date: joinIso, accountId: 'a1', categoryId: 'food', categoryName: 'Food' });
eq('an unplanned expense reduces the suggestion',
  Calc.suggestMidCycleRemaining(joinIso), 2000 + 5000 - 1200 - 800 - 15);

console.log(fails ? '\n' + fails + ' FAILING' : '\nMid-cycle rule agrees.');
process.exit(fails ? 1 : 0);
