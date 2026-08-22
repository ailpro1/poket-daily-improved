/* Node harness — runs the spec's "Before you finish" scenario against the
   real calc.js/cycles.js/format.js. Not shipped with the app. */
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis; globalThis.self = globalThis;
['js/format.js', 'js/cycles.js', 'js/calc.js'].forEach(f =>
  vm.runInThisContext(fs.readFileSync(__dirname + '/../' + f, 'utf8'), { filename: f }));

const { Calc, Cycles, Fmt } = globalThis;
const today = Cycles.iso(new Date());
const cycle = Cycles.getMonthKey(today);
const range = Cycles.getCycleRangeForKey(cycle);
const day3 = Cycles.iso(Cycles.addDays(range.start, 2));

globalThis.S = {
  settings: { currency: 'RM', cycleStartDay: 1, budgetStartDate: range.startIso },
  accounts: [
    { id: 'a1', name: 'Maybank', type: 'general', startBalance: 2000, order: 0, createdAt: range.startIso },
    { id: 'a2', name: 'TnG eWallet', type: 'general', startBalance: 500, order: 1, createdAt: range.startIso },
    { id: 's1', name: 'ASB', type: 'saving', startBalance: 10000, order: 0, createdAt: range.startIso }
  ],
  plan: {
    income: [{ id: 'i1', name: 'Salary', amount: 5000, accountId: 'a1' }],
    commitments: [{ id: 'c1', name: 'Rent', amount: 1200, accountId: 'a1' }],
    savings: [{ id: 'v1', name: 'ASB monthly', amount: 800, accountId: 's1' }]
  },
  logs: [],
  checklist: {}
};

const log = o => { S.logs.push(Object.assign({ id: Fmt.uid('t'), spreadType: 'onetime', createdAt: new Date().toISOString() }, o)); Calc.invalidate(); };

let fails = 0;
const eq = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.005;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got.toFixed(2) + ' want=' + want.toFixed(2));
};

// 3. check off commitment + saving -> real logs
log({ name: 'Rent', amount: 1200, type: 'expense', date: day3, accountId: 'a1', sourceChecklistId: 'c1', sourceCycle: cycle, sourceSection: 'commitments' });
log({ name: 'ASB monthly', amount: 800, type: 'expense', date: day3, accountId: 's1', sourceChecklistId: 'v1', sourceCycle: cycle, sourceSection: 'savings' });

// 4. one spread + one one-time
log({ name: 'Groceries', amount: 300, type: 'expense', spreadType: 'spread', date: day3, accountId: 'a1', categoryId: 'food', categoryName: 'Food' });
log({ name: 'Phone case', amount: 60, type: 'expense', date: day3, accountId: 'a2', categoryId: 'shop', categoryName: 'Shopping' });

eq('a1 balance', Calc.accountBalance('a1'), 2000 - 1200 - 300);
eq('a2 balance', Calc.accountBalance('a2'), 500 - 60);
eq('s1 balance', Calc.accountBalance('s1'), 10000 - 800);
eq('Monthly Balance = sum(general)', Calc.monthlyBalance(), Calc.accountBalance('a1') + Calc.accountBalance('a2'));
eq('Savings Balance = sum(saving)', Calc.savingsBalance(), Calc.accountBalance('s1'));

// 5. transfer between two general accounts
const mbBefore = Calc.monthlyBalance(), sbBefore = Calc.savingsBalance();
const pair = Fmt.uid('p');
log({ name: 'Top up TnG', amount: 100, type: 'transfer_out', date: day3, accountId: 'a1', transferPairId: pair, transferCounterpartAccountId: 'a2' });
log({ name: 'Top up TnG', amount: 100, type: 'transfer_in', date: day3, accountId: 'a2', transferPairId: pair, transferCounterpartAccountId: 'a1' });
eq('general->general leaves Monthly Balance flat', Calc.monthlyBalance(), mbBefore);
eq('general->general leaves Savings Balance flat', Calc.savingsBalance(), sbBefore);

// 6. transfer general -> saving
const pair2 = Fmt.uid('p');
log({ name: 'To ASB', amount: 250, type: 'transfer_out', date: day3, accountId: 'a1', transferPairId: pair2, transferCounterpartAccountId: 's1' });
log({ name: 'To ASB', amount: 250, type: 'transfer_in', date: day3, accountId: 's1', transferPairId: pair2, transferCounterpartAccountId: 'a1' });
eq('general->saving drops Monthly Balance by 250', Calc.monthlyBalance(), mbBefore - 250);
eq('general->saving lifts Savings Balance by 250', Calc.savingsBalance(), sbBefore + 250);

// 7. cross-checks
const sum = t => Calc.accountsOfType(t).reduce((s, a) => s + Calc.accountBalance(a.id), 0);
eq('Home MB === sum of general account cards', Calc.monthlyBalance(), sum('general'));
eq('Home SB === sum of saving account cards', Calc.savingsBalance(), sum('saving'));
const series = Calc.balanceSeries('general', range.startIso, today, 'day');
eq('graph endpoint === Monthly Balance card', series[series.length - 1].value, Calc.monthlyBalance());
const sSeries = Calc.balanceSeries('saving', range.startIso, today, 'day');
eq('savings graph endpoint === Savings Balance card', sSeries[sSeries.length - 1].value, Calc.savingsBalance());

// budget pool & double-count check
const pool = 5000 - 1200 - 800;
eq('cycle pool', Calc.cyclePool(cycle), pool);
eq('allowance/day', Calc.dailyAllowance(cycle), pool / range.totalDays);
const cs = Calc.cycleSummary(cycle);
eq('actual spent (all real expenses)', cs.actualSpent, 1200 + 800 + 300 + 60);
const spreadDays = Cycles.daysBetween(day3, range.end) + 1;
eq('budget-affecting spend (no checklist, no transfers)', cs.discretionarySpent, 300 + 60);
eq('spread lands per-day, not as a spike', Calc.budgetDrainOnDay(day3), 300 / spreadDays + 60);

// breakdown must foot to the same discretionary total
const bd = Calc.categoryTotals(range.startIso, range.endIso, 'expense');
eq('breakdown total === budget-affecting spend', bd.total, cs.discretionarySpent);

// carry-over sanity: day-1 of cycle has no carry when budgeting starts then
const d1 = Calc.dailyBudget(range.startIso);
eq('day 1 carry is zero', d1.carry, 0);
eq('day 1 budget === allowance', d1.budget, Calc.dailyAllowance(cycle));

console.log(fails ? '\n' + fails + ' FAILING' : '\nAll self-checks agree.');
process.exit(fails ? 1 : 0);
