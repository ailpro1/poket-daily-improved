/* Node harness — refunds and reimbursements against the real calc.js.
   The interesting case is a refund of a PLANNED commitment. The original
   expense carries sourceChecklistId, so affectsBudget() excludes it and it
   never charged the daily budget. The refund must NOT inherit that field, or
   the money never comes back; and it must not double-credit either.
   Not shipped with the app. */
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis; globalThis.self = globalThis;
['js/format.js', 'js/cycles.js', 'js/calc.js'].forEach(f =>
  vm.runInThisContext(fs.readFileSync(__dirname + '/../' + f, 'utf8'), { filename: f }));

const { Calc, Cycles, Fmt } = globalThis;
let fails = 0;
const eq = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.02;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got.toFixed(2) + ' want=' + want.toFixed(2));
};
const check = (label, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? '  ' + extra : ''));
};

const CY = '2026-06';
const r = Cycles.getCycleRangeForKey(CY);
const day = n => Cycles.iso(Cycles.addDays(r.start, n - 1));
const POOL = 5000 - 1200 - 800;          /* income - commitments - savings */

function build() {
  globalThis.S = {
    settings: {
      currency: 'RM', cycleStartDay: 1, budgetStartDate: r.startIso,
      carryOver: 'on', midCycleMode: 'prorate',
      categories: { income: [{ id: 'cat_refund', name: 'Refund' }], expense: [] }
    },
    accounts: [{ id: 'a1', name: 'Bank', type: 'general', startBalance: 4000, order: 0, createdAt: r.startIso }],
    plan: {
      income: [{ id: 'i1', name: 'Gaji', amount: 5000, accountId: 'a1' }],
      commitments: [{ id: 'c1', name: 'Sewa', amount: 1200, accountId: 'a1' }],
      savings: [{ id: 'v1', name: 'ASB', amount: 800, accountId: 'a1' }]
    },
    logs: [], checklist: {}
  };
  Calc.invalidate();
}
const push = o => {
  S.logs.push(Object.assign({ id: Fmt.uid('t'), spreadType: 'onetime', type: 'expense', createdAt: new Date().toISOString() }, o));
  Calc.invalidate();
  return S.logs[S.logs.length - 1];
};
/* Mirrors Actions.addRefund: a plain income log, no sourceChecklistId. */
const refund = (original, amount, date) => push({
  name: 'Refund · ' + original.name, amount: amount, type: 'income',
  date: date || original.date, accountId: original.accountId,
  categoryId: 'cat_refund', categoryName: 'Refund', refundOfLogId: original.id
});

/* ---- refunding ordinary, spendable spending -------------------------- */
console.log('an ordinary expense, refunded in full');
build();
const coffee = push({ name: 'Kopi', amount: 60, date: day(3), accountId: 'a1', categoryId: 'cat_food', categoryName: 'Food' });
eq('the spend drains the day', Calc.budgetDrainOnDay(day(3)), 60);
eq('and comes off the account', Calc.monthlyBalance(), 4000 - 60);
refund(coffee, 60, day(3));
eq('a same-day refund cancels the drain', Calc.budgetDrainOnDay(day(3)), 0);
eq('and the account is whole again', Calc.monthlyBalance(), 4000);
check('the refund is budget-affecting', Calc.affectsBudget(S.logs[1]) === true);
check('and it is not a transfer', Calc.isTransfer(S.logs[1]) === false);

console.log('\na partial refund, and one that arrives later');
build();
const shop = push({ name: 'Baju', amount: 100, date: day(3), accountId: 'a1', categoryId: 'cat_shopping', categoryName: 'Shopping' });
refund(shop, 40, day(8));
eq('the original day still shows the whole spend', Calc.budgetDrainOnDay(day(3)), 100);
eq('the refund lands on the day it arrived, as a credit', Calc.budgetDrainOnDay(day(8)), -40);
eq('across the cycle only the net remains', Calc.budgetDrainInRange(r.startIso, r.endIso), 60);
eq('account balance reflects the net too', Calc.monthlyBalance(), 4000 - 60);

/* ---- refunding a PLANNED commitment ---------------------------------- */
console.log('\na planned commitment, reimbursed');
build();
const rent = push({
  name: 'Sewa', amount: 1200, date: day(1), accountId: 'a1',
  categoryId: 'commitment', categoryName: 'Commitment',
  sourceChecklistId: 'c1', sourceCycle: CY, sourceSection: 'commitments'
});
check('the ticked commitment is excluded from the budget', Calc.affectsBudget(rent) === false);
eq('so it drains nothing', Calc.budgetDrainOnDay(day(1)), 0);
eq('though it did leave the account', Calc.monthlyBalance(), 4000 - 1200);
const before = Calc.dailyBudget(day(10)).budget;
refund(rent, 300, day(5));
eq('the reimbursement credits the budget', Calc.budgetDrainOnDay(day(5)), -300);
eq('and returns to the account', Calc.monthlyBalance(), 4000 - 1200 + 300);
eq('so today has 300 more to spend', Calc.dailyBudget(day(10)).budget, before + 300);
eq('the pool itself is untouched — the Plan still commits 1200', Calc.cyclePool(CY), POOL);

/* This is the double-count trap: had the refund inherited sourceChecklistId,
   affectsBudget() would have excluded it and nothing would come back. */
const bad = push({
  name: 'Bad refund', amount: 300, type: 'income', date: day(6), accountId: 'a1',
  sourceChecklistId: 'c1', sourceCycle: CY, refundOfLogId: rent.id
});
check('a refund carrying sourceChecklistId would be silently ignored',
  Calc.affectsBudget(bad) === false && Calc.budgetDrainOnDay(day(6)) === 0,
  'drain=' + Calc.budgetDrainOnDay(day(6)));
S.logs.pop(); Calc.invalidate();

/* ---- how the refund shows up in the breakdowns ----------------------- */
console.log('\nwhere a refund shows up');
build();
const petrol = push({ name: 'Petrol', amount: 120, date: day(3), accountId: 'a1', categoryId: 'cat_transport', categoryName: 'Transport' });
refund(petrol, 120, day(4));
const spend = Calc.categoryTotals(r.startIso, r.endIso, 'expense');
const income = Calc.categoryTotals(r.startIso, r.endIso, 'income');
eq('the expense still shows its full amount under Spendable', spend.total, 120);
eq('and the refund shows as money in', income.total, 120);
check('under its own Refund category', income.items.some(i => i.name === 'Refund'),
  income.items.map(i => i.name).join(','));
const ib = Calc.incomeBreakdown(CY);
check('so Money in lists it alongside the Plan income',
  ib.items.some(i => i.name === 'Refund' && i.kind === 'logged'),
  ib.items.map(i => i.name + ':' + i.kind).join(', '));
eq('the two cancel in the cycle net', Calc.budgetDrainInRange(r.startIso, r.endIso), 0);

/* A refund is real money in, so the Transaction tab's totals must show it. */
const cs = Calc.cycleSummary(CY);
eq('cycle actual income includes the refund', cs.actualIncome, 120);
eq('cycle actual spend still shows the original', cs.actualSpent, 120);

console.log(fails ? '\n' + fails + ' FAILING' : '\nRefunds behave.');
process.exit(fails ? 1 : 0);
