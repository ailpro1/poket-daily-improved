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
  /* Splash.ART_HOLD holds the artwork for 3s before the greeting paints. */
  await wait(3400);
  const { Calc, Actions, Fmt, Cycles, S } = w;

  check('app booted, daily splash waiting', !!w.document.querySelector('#splash.ready'));
  w.document.querySelector('.splash-go').click();
  await wait(400);
  check('splash clears to the app', !w.document.querySelector('#splash'));
  check('nav rendered in configured order',
    [...w.document.querySelectorAll('.nav-label')].map(n => n.textContent).join(',') === 'Home,Transaction,Plan,Accounts,Breakdown',
    [...w.document.querySelectorAll('.nav-label')].map(n => n.textContent).join(','));

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
  eq('Net Worth card === both balances added up', money(txt('.net-worth')),
    Calc.monthlyBalance() + Calc.savingsBalance());
  eq('and Calc.netWorth agrees with the card', Calc.netWorth(), money(txt('.net-worth')));
  check('Net Worth leads the Accounts tab',
    w.document.querySelector('#app-main .card .eyebrow').textContent === 'Net Worth · actual',
    txt('#app-main .card .eyebrow'));
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
  check('Log tab shows the cycle in-and-out only, no live balances',
    stats.length === 2 && !/Monthly Balance|Savings Balance/.test(txt('#app-main')),
    stats.length + ' stats');
  check('transfers are listed as a pair', S.logs.filter(l => l.transferPairId).length === 4);

  w.App.go('breakdown');
  await wait(60);
  check('breakdown offers spendable / committed / money in',
    [...w.document.querySelectorAll('.seg')].map(n => n.textContent).join(',') === 'Spendable,Committed,Money in',
    [...w.document.querySelectorAll('.seg')].map(n => n.textContent).join(','));
  const catRows = [...w.document.querySelectorAll('.cat-row .num')].map(n => money(n.textContent));
  eq('spendable rows foot to budget-affecting spend',
    catRows.reduce((a, b) => a + b, 0), Calc.budgetDrainInRange(range.startIso, range.endIso));

  /* The committed half — the money the daily budget already subtracted, which
     is exactly why none of it appears above. */
  [...w.document.querySelectorAll('.seg')].filter(b => b.textContent === 'Committed')[0].click();
  await wait(60);
  const planRows = [...w.document.querySelectorAll('.cat-row .num')].map(n => money(n.textContent));
  const pb = Calc.planBreakdown(cycle);
  eq('committed rows foot to commitments + savings', planRows.reduce((a, b) => a + b, 0),
    cs.plannedCommitments + cs.plannedSavings);
  eq('and planBreakdown agrees', pb.total, cs.plannedCommitments + cs.plannedSavings);
  eq('ticked off + still to pay === the whole committed total', pb.paid + pb.unpaid, pb.total);
  eq('both items are ticked off in this scenario', pb.paid, 1200 + 800);
  check('committed excludes planned income',
    !pb.items.some(i => i.section === 'income') && !/Salary/.test(txt('#app-main')));
  check('each committed row says which half it came from and whether it is paid',
    /Commitment · \d+% · ticked off/.test(txt('#app-main')) &&
    /Savings · \d+% · ticked off/.test(txt('#app-main')));

  /* Untick one and the paid/unpaid split must move with it. */
  await Actions.setChecked(cycle, 'commitments', S.plan.commitments[0], false);
  await wait(60);
  const pb2 = Calc.planBreakdown(cycle);
  eq('unticking moves money from paid to unpaid', pb2.unpaid, 1200);
  eq('but the committed total is unchanged', pb2.total, pb.total);
  await Actions.setChecked(cycle, 'commitments', S.plan.commitments[0], true);
  await wait(60);
  [...w.document.querySelectorAll('.seg')].filter(b => b.textContent === 'Spendable')[0].click();
  await wait(60);

  /* Plan lists are ordered biggest-first, and the same order shows up in the
     checklist drawer that opens from this tab. */
  w.App.go('plan');
  await wait(60);
  const planNames = sec =>
    [...w.document.querySelectorAll('.plan-' + sec + ' .plan-name')].map(n => n.textContent);
  await Actions.savePlanItem('commitments', { id: 'c2', name: 'Kereta', amount: 850, accountId: 'a1', dueType: 'day', dueDay: 5, cycleOverrides: {} });
  await Actions.savePlanItem('commitments', { id: 'c3', name: 'Internet', amount: 149, accountId: 'a1', dueType: 'day', dueDay: 8, cycleOverrides: {} });
  await Actions.savePlanItem('commitments', { id: 'c4', name: 'Insurans', amount: 2400, accountId: 'a1', dueType: 'day', dueDay: 9, cycleOverrides: {} });
  w.App.go('plan');
  await wait(60);
  check('commitments listed biggest first',
    planNames('commitments').join(',') === 'Insurans,Rent,Kereta,Internet', planNames('commitments').join(','));

  /* A per-cycle override must reorder with it, not just restyle the amount. */
  const kereta = S.plan.commitments.filter(i => i.id === 'c2')[0];
  await Actions.savePlanItem('commitments', Object.assign({}, kereta, { cycleOverrides: { [cycle]: 3000 } }));
  w.App.go('plan');
  await wait(60);
  check('a per-cycle override reorders the list',
    planNames('commitments')[0] === 'Kereta', planNames('commitments').join(','));
  await Actions.savePlanItem('commitments', Object.assign({}, kereta, { cycleOverrides: {} }));

  /* An item that has ended is 0 this cycle, so it sinks to the bottom. */
  await Actions.savePlanItem('commitments',
    Object.assign({}, S.plan.commitments.filter(i => i.id === 'c4')[0],
      { endMonth: Cycles.shiftCycleKey(cycle, -1) }));
  w.App.go('plan');
  await wait(60);
  check('an ended item sinks to the bottom',
    planNames('commitments').slice(-1)[0] === 'Insurans', planNames('commitments').join(','));
  await Actions.savePlanItem('commitments',
    Object.assign({}, S.plan.commitments.filter(i => i.id === 'c4')[0], { endMonth: null }));

  w.Checklist.open();
  await wait(120);
  const checkNames = [...w.document.querySelectorAll('.sheet .check-list .plan-name, .sheet .check-list .check-name')]
    .map(n => n.textContent);
  /* Sections keep their own order (income, then commitments, then savings),
     so look for the commitments run rather than the head of the whole list. */
  check('the checklist drawer uses the same order',
    checkNames.join(',').indexOf('Insurans,Rent,Kereta,Internet') > -1, checkNames.join(','));
  w.document.querySelector('.sheet-head .icon-btn').click();
  await wait(300);

  /* Totals must not care about display order. */
  eq('reordering does not change the commitments total',
    Calc.planTotal('commitments', cycle), 1200 + 850 + 149 + 2400);

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
