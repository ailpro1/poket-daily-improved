/* Drives the real app in jsdom: boots it, creates accounts, plan items,
   ticks the checklist, logs transactions, transfers, then reads the numbers
   back off the rendered DOM to confirm every surface agrees. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('/home/claude/node_modules/jsdom');
const FDBFactory = require('/home/claude/node_modules/fake-indexeddb/lib/FDBFactory');
const FDBKeyRange = require('/home/claude/node_modules/fake-indexeddb/lib/FDBKeyRange');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://example.test/' });
const w = dom.window;

w.indexedDB = new FDBFactory();
w.IDBKeyRange = FDBKeyRange;
w.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { } });
w.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
w.scrollTo = () => { };
w.URL.createObjectURL = () => 'blob:x';
w.URL.revokeObjectURL = () => { };

const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
scripts.forEach(s => vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), dom.getInternalVMContext(), { filename: s }));

const wait = ms => new Promise(r => setTimeout(r, ms || 40));
const txt = sel => (w.document.querySelector(sel) || {}).textContent || '';
const money = s => parseFloat(String(s).replace(/[^0-9.-]/g, '')) || 0;

let fails = 0;
const check = (label, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : ''));
};
const eq = (label, a, b) => check(label, Math.abs(a - b) < 0.02, 'got=' + a + ' want=' + b);

(async () => {
  await w.App.boot();
  await wait(120);
  const { Calc, Actions, Fmt, Cycles, S } = w;

  check('app booted, daily splash waiting', !!w.document.querySelector('#splash.ready'));
  w.document.querySelector('.splash-go').click();
  await wait(400);
  check('splash clears to the app', !w.document.querySelector('#splash'));
  check('nav rendered in configured order',
    [...w.document.querySelectorAll('.nav-label')].map(n => n.textContent).join(',') === 'Home,Log,Plan,Accounts,Breakdown');

  await Actions.saveSettings({ onboarded: true, cycleStartDay: 1 });
  const cycle = w.App.cycleKey();
  const range = Cycles.getCycleRangeForKey(cycle);
  const day = Cycles.iso(Cycles.addDays(range.start, 1));

  await Actions.saveAccount({ id: 'a1', name: 'Maybank Current Account', icon: '🏦', type: 'general', startBalance: 2000, order: 0, createdAt: range.startIso });
  await Actions.saveAccount({ id: 'a2', name: 'TnG', icon: '📱', type: 'general', startBalance: 500, order: 1, createdAt: range.startIso });
  await Actions.saveAccount({ id: 's1', name: 'ASB', icon: '🐖', type: 'saving', startBalance: 10000, order: 0, createdAt: range.startIso });

  await Actions.savePlanItem('income', { id: 'i1', name: 'Salary', amount: 5000, accountId: 'a1', dueType: 'day', dueDay: 1, cycleOverrides: {} });
  await Actions.savePlanItem('commitments', { id: 'c1', name: 'Rent', amount: 1200, accountId: 'a1', dueType: 'day', dueDay: 1, cycleOverrides: {} });
  await Actions.savePlanItem('savings', { id: 'v1', name: 'ASB monthly', amount: 800, accountId: 's1', dueType: 'day', dueDay: 1, cycleOverrides: {} });

  // checklist tick creates real logs
  await Actions.setChecked(cycle, 'commitments', S.plan.commitments[0], true);
  await Actions.setChecked(cycle, 'savings', S.plan.savings[0], true);
  check('ticking writes a real transaction', S.logs.filter(l => l.sourceChecklistId).length === 2);
  check('checklist reads back as ticked', Actions.isChecked(cycle, 'c1') && Actions.isChecked(cycle, 'v1'));

  await Actions.addLog({ name: 'Groceries', amount: 300, type: 'expense', spreadType: 'spread', date: day, accountId: 'a1', categoryId: 'cat_groceries', categoryName: 'Groceries' });
  await Actions.addLog({ name: 'Phone case', amount: 60, type: 'expense', date: day, accountId: 'a2', categoryId: 'cat_shopping', categoryName: 'Shopping' });

  // self-healing: delete a checklist log straight from the log store
  const cl = Actions.checklistLogFor(cycle, 'c1');
  await Actions.deleteLog(cl.id, { silent: true });
  check('checklist self-heals when its log is deleted', Actions.isChecked(cycle, 'c1') === false);
  Actions.undoDelete();
  await wait(60);
  check('undo restores the deleted record', Actions.isChecked(cycle, 'c1') === true);

  const mb0 = Calc.monthlyBalance(), sb0 = Calc.savingsBalance();
  await Actions.addTransfer('a1', 'a2', 100, day, 'Top up');
  eq('general→general leaves Monthly Balance flat', Calc.monthlyBalance(), mb0);
  eq('general→general leaves Savings Balance flat', Calc.savingsBalance(), sb0);
  await Actions.addTransfer('a1', 's1', 250, day, 'To ASB');
  eq('general→saving drops Monthly Balance 250', Calc.monthlyBalance(), mb0 - 250);
  eq('general→saving lifts Savings Balance 250', Calc.savingsBalance(), sb0 + 250);

  // ---- now read the numbers back off the DOM, tab by tab ----
  w.App.go('home');
  await wait(60);
  const homeCards = [...w.document.querySelectorAll('.bal-value')].map(n => money(n.textContent));
  eq('Home Monthly Balance card', homeCards[0], Calc.monthlyBalance());
  eq('Home Savings Balance card', homeCards[1], Calc.savingsBalance());
  check('hero renders a daily figure', /\d/.test(txt('.hero-value')));
  check('day strip drawn for every day of the cycle',
    w.document.querySelectorAll('.daystrip rect').length === range.totalDays,
    w.document.querySelectorAll('.daystrip rect').length + ' bars / ' + range.totalDays + ' days');

  w.App.go('accounts');
  await wait(60);
  const groups = [...w.document.querySelectorAll('.acc-group')];
  const genCards = [...groups[0].querySelectorAll('.acc-bal')].map(n => money(n.textContent));
  const savCards = [...groups[1].querySelectorAll('.acc-bal')].map(n => money(n.textContent));
  eq('sum of spending cards === Monthly Balance', genCards.reduce((a, b) => a + b, 0), Calc.monthlyBalance());
  eq('sum of saving cards === Savings Balance', savCards.reduce((a, b) => a + b, 0), Calc.savingsBalance());
  check('section titles carry a count',
    groups[0].querySelector('.eyebrow').textContent === 'Accounts (2)' &&
    groups[1].querySelector('.eyebrow').textContent === 'Saving Accounts (1)',
    groups.map(g => g.querySelector('.eyebrow').textContent).join(' / '));

  w.App.go('log');
  await wait(60);
  const stats = [...w.document.querySelectorAll('.stat-value')].map(n => money(n.textContent));
  const cs = Calc.cycleSummary(cycle);
  eq('Log tab: in this cycle', stats[0], cs.actualIncome);
  eq('Log tab: out this cycle', stats[1], cs.actualSpent);
  eq('Log tab: Monthly Balance matches Home', stats[2], homeCards[0]);
  eq('Log tab: Savings Balance matches Home', stats[3], homeCards[1]);
  check('transfers are listed as a pair', S.logs.filter(l => l.transferPairId).length === 4);

  w.App.go('breakdown');
  await wait(60);
  const catRows = [...w.document.querySelectorAll('.cat-row .num')].map(n => money(n.textContent));
  eq('breakdown rows foot to budget-affecting spend',
    catRows.reduce((a, b) => a + b, 0), Calc.budgetDrainInRange(range.startIso, range.endIso));

  w.App.go('plan');
  await wait(60);
  eq('Plan pool === cycle pool', money(txt('.plan-pool')), Calc.cyclePool(cycle));

  // per-cycle override must not change the permanent amount
  const item = S.plan.commitments[0];
  item.cycleOverrides[cycle] = 1500;
  await Actions.savePlanItem('commitments', item);
  eq('override applies this cycle', Calc.planAmount(item, cycle), 1500);
  eq('override leaves other cycles alone', Calc.planAmount(item, Cycles.shiftCycleKey(cycle, 1)), 1200);
  await Actions.syncChecklistLogAmount(cycle, 'c1', 1500);
  eq('ticked log follows the edited amount', Math.abs(Actions.checklistLogFor(cycle, 'c1').amount), 1500);

  // end month stops recurrence
  item.endMonth = cycle;
  await Actions.savePlanItem('commitments', item);
  eq('endMonth stops it recurring', Calc.planAmount(item, Cycles.shiftCycleKey(cycle, 1)), 0);

  // persistence: reload from IndexedDB and confirm the totals survive
  const before = { mb: Calc.monthlyBalance(), sb: Calc.savingsBalance(), n: S.logs.length };
  await w.App.reload();
  await wait(80);
  eq('Monthly Balance survives a reload', w.Calc.monthlyBalance(), before.mb);
  eq('Savings Balance survives a reload', w.Calc.savingsBalance(), before.sb);
  check('every log survives a reload', w.S.logs.length === before.n);

  // deleting an account with history is blocked
  let blocked = false;
  await w.Actions.deleteAccount('a1').catch(() => { blocked = true; });
  check('cannot delete an account that has transactions', blocked);

  console.log(fails ? '\n' + fails + ' FAILING' : '\nAll UI surfaces agree.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
