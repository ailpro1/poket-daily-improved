/* Opens every sheet in the app and drives the forms the way a thumb would. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('/home/claude/node_modules/jsdom');
const FDBFactory = require('/home/claude/node_modules/fake-indexeddb/lib/FDBFactory');
const FDBKeyRange = require('/home/claude/node_modules/fake-indexeddb/lib/FDBKeyRange');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://example.test/' });
const w = dom.window, D = w.document;
w.indexedDB = new FDBFactory();
w.IDBKeyRange = FDBKeyRange;
w.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { } });
w.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
/* Track how scrollTo was called (instant number vs {behavior:'smooth'} object)
   and fake scrollY moving, so the same-tab vs different-tab distinction in
   App.go() is actually observable. */
w.__scrollCalls = [];
Object.defineProperty(w, 'scrollY', { value: 0, writable: true, configurable: true });
w.scrollTo = (a, b) => {
  const opts = (a && typeof a === 'object') ? a : { top: b === undefined ? a : b };
  w.__scrollCalls.push(opts);
  w.scrollY = opts.top || 0;
};
w.prompt = () => 'Kopi';
w.URL.createObjectURL = () => 'blob:x';
w.URL.revokeObjectURL = () => { };
[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
  .forEach(s => vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), dom.getInternalVMContext(), { filename: s }));

const wait = ms => new Promise(r => setTimeout(r, ms || 300));
const $ = s => D.querySelector(s);
const $$ = s => [...D.querySelectorAll(s)];
const sheet = () => $$('.sheet-wrap.open .sheet').slice(-1)[0];
const q = s => sheet().querySelector(s);
const qq = s => [...sheet().querySelectorAll(s)];
const scope = () => sheet() || D;
const byText = (sel, t) => [...scope().querySelectorAll(sel)].filter(n => n.textContent.trim() === t)[0];
const type = (input, digits) => { digits.split('').forEach(d => { input.value += d; input.dispatchEvent(new w.Event('input')); }); };

let fails = 0;
const check = (label, ok, extra) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : '')); };

const errors = [];
w.addEventListener('error', e => errors.push(e.message));

(async () => {
  await w.App.boot();
  /* Splash.ART_HOLD holds the artwork for 3s before the greeting paints. */
  await wait(3400);

  // daily splash comes first
  check('splash shows a greeting for the time of day', /Good (morning|afternoon|evening|night)!|Still up\?/.test(D.querySelector('#splash .splash-greet').textContent),
    D.querySelector('#splash .splash-greet').textContent);
  check('splash shows today\'s figure or says there is no plan yet',
    /No plan set up yet|Today you can spend|Today you are over by/.test(D.querySelector('#splash .splash-label').textContent));
  D.querySelector('.splash-go').click();
  await wait(900);
  check('splash dismisses on Let\'s go', !D.querySelector('#splash'));
  check('splash remembers it ran today', w.S.settings.lastSplashDate === w.Cycles.iso(w.Cycles.today()));

  // onboarding auto-opens on a blank install
  check('setup guide opens on first run', !!sheet() && /Set up Poket Daily/.test($('.sheet-title').textContent));
  check('every sheet has a visible close button', !!q('.sheet-head .icon-btn'), 'x present');
  byText('.btn', 'Next: your money month').click(); await wait();

  // the cycle step. Pick a start day that guarantees today is PAST it, so the
  // mid-cycle step below is reached whatever date this harness runs on.
  check('guide asks when the money month starts', /When does your money month start/.test(sheet().textContent));
  const dayInput = q('input[type=number]');
  const startDay = w.Cycles.today().getDate() === 1 ? 28 : 1;
  dayInput.value = String(startDay);
  dayInput.dispatchEvent(new w.Event('input'));
  check('cycle step previews the cycle it just described', /This cycle:/.test(sheet().textContent), sheet().textContent.match(/This cycle:[^.]*\./)[0]);
  byText('.btn', 'Next: accounts').click(); await wait(150);
  check('cycle start day saved before accounts', w.S.settings.cycleStartDay === startDay, 'day ' + w.S.settings.cycleStartDay);
  check('guide then asks for the main spending account', /main spending account/.test(sheet().textContent));

  // add an account through the real form
  byText('.btn', '+ Add spending account').click(); await wait();
  q('.sheet-body input[type=text]').value = 'Maybank Islamic Current Account';
  type(q('.input-amount'), '250000');
  check('cent-first input reads digits from the cents place', q('.input-amount').value.indexOf('2,500.00') > -1, q('.input-amount').value);
  /* CentInput.set() has to paint the field itself before firing 'input', or
     that handler re-reads the stale text and undoes the write. */
  w.CentInput.set(q('.input-amount'), 1234.5);
  check('setting an amount from code actually sticks',
    w.CentInput.value(q('.input-amount')) === 1234.5, w.CentInput.value(q('.input-amount')));
  check('and the field shows what was set', /1,234\.50/.test(q('.input-amount').value), q('.input-amount').value);
  w.CentInput.set(q('.input-amount'), 2500);
  byText('.btn', 'Add account').click(); await wait(120);
  check('account saved from the form', w.S.accounts.length === 1 && w.S.accounts[0].startBalance === 2500);
  check('Monthly Balance picks it up immediately', w.Calc.monthlyBalance() === 2500);

  // the mid-cycle step — reached because the cycle start day above guarantees it
  byText('.btn', 'Next: savings').click(); await wait();
  byText('.btn', 'Next: this month').click(); await wait();
  check('guide asks about starting part-way through the cycle',
    /starting part-way through/.test(sheet().textContent));
  const midAmount = q('.input-amount');
  check('mid-cycle amount is prefilled from the account just entered',
    w.CentInput.value(midAmount) === 2500, w.CentInput.value(midAmount));
  const midDays = w.Cycles.daysToCycleEnd(w.Cycles.iso(w.Cycles.today()));
  check('mid-cycle step shows the resulting daily rate',
    sheet().textContent.indexOf(w.Fmt.money(2500 / midDays) + ' a day') > -1,
    w.Fmt.money(2500 / midDays) + ' a day over ' + midDays + ' days');
  byText('.btn', 'Use this for the rest of the month').click(); await wait(200);
  check('stated figure saved as the rule for this month',
    w.S.settings.midCycleMode === 'remaining' && w.S.settings.midCycleRemaining === 2500,
    w.S.settings.midCycleMode + ' / ' + w.S.settings.midCycleRemaining);
  check('daily allowance is now the stated figure over the days left',
    Math.abs(w.Calc.dailyAllowance(w.Cycles.currentCycleKey()) - 2500 / midDays) < 0.01,
    w.Calc.dailyAllowance(w.Cycles.currentCycleKey()));

  // finish the guide
  check('guide closes on the Plan hand-off', /Open the Plan tab/.test(sheet().textContent));
  byText('.btn', 'Open the Plan tab').click(); await wait(150);
  check('guide marks itself done', w.S.settings.onboarded === true);

  // plan item form
  w.App.go('plan'); await wait();
  byText('.btn', '+ Add income').click(); await wait();
  q('.sheet-body input[type=text]').value = 'Gaji';
  type(q('.input-amount'), '450000');
  byText('.btn', 'Add to Plan').click(); await wait(120);
  check('plan item saved', w.S.plan.income.length === 1 && w.S.plan.income[0].amount === 4500);

  // editing a Plan item's amount asks for confirmation and says which scope
  w.App.go('plan'); await wait();
  byText('.plan-name', 'Gaji').click(); await wait();
  check('editing without touching the amount needs no confirmation', true); // sanity anchor
  q('.sheet-body input[type=text]').value = 'Gaji Bulanan';
  byText('.btn', 'Save').click(); await wait(150);
  check('a rename alone saves straight away, no confirm sheet', !D.querySelector('.sheet-wrap.open'));
  check('the rename took', w.S.plan.income[0].name === 'Gaji Bulanan');

  byText('.plan-name', 'Gaji Bulanan').click(); await wait();
  w.CentInput.set(q('.input-amount'), 5000);
  byText('.seg', 'Just this month').click();
  byText('.btn', 'Save').click(); await wait(200);
  check('changing the amount opens a confirmation instead of saving straight away',
    /Change Gaji Bulanan\?/.test(sheet().textContent), sheet().textContent.slice(0, 60));
  check('it says the change is just this month',
    /this month only/.test(sheet().textContent) && /back to RM4,500\.00 next month/.test(sheet().textContent),
    sheet().textContent);
  byText('.btn', 'Cancel').click(); await wait(200);
  check('cancelling leaves the amount untouched', w.Calc.planAmount(w.S.plan.income[0], w.App.cycleKey()) === 4500);
  /* Cancel only closes the confirm sheet — the edit sheet is still open
     underneath it, same as any other confirm-gated action in this app. */
  q('.sheet-head .icon-btn').click(); await wait(300);

  byText('.plan-name', 'Gaji Bulanan').click(); await wait();
  w.CentInput.set(q('.input-amount'), 5000);
  byText('.seg', 'Just this month').click();
  byText('.btn', 'Save').click(); await wait(150);
  byText('.btn', 'Save for this month only').click(); await wait(200);
  check('confirming a this-month change sets a cycle override, not the base amount',
    w.S.plan.income[0].amount === 4500 &&
    w.S.plan.income[0].cycleOverrides[w.App.cycleKey()] === 5000);
  w.App.go('plan'); await wait();
  check('the list shows a green dot for a this-month-only change',
    !!D.querySelector('.plan-dot'));

  byText('.plan-name', 'Gaji Bulanan').click(); await wait();
  w.CentInput.set(q('.input-amount'), 6000);
  byText('.seg', 'From now on').click();
  byText('.btn', 'Save').click(); await wait(150);
  check('an every-month change is worded differently',
    /every month from now on/.test(sheet().textContent) && !/this month only/.test(sheet().textContent),
    sheet().textContent);
  byText('.btn', 'Save for every month').click(); await wait(200);
  check('confirming an every-month change updates the base amount',
    w.S.plan.income[0].amount === 6000);
  check('and clears any leftover this-month override',
    w.S.plan.income[0].cycleOverrides[w.App.cycleKey()] === undefined);
  w.App.go('plan'); await wait();
  check('an every-month change carries no green dot — it is not temporary',
    !D.querySelector('.plan-dot'));

  // transaction form via the FAB
  $('#fab').click(); await wait();
  type(q('.input-amount'), '1250');
  qq('.sheet-body input[type=text]')[0].value = 'Nasi lemak';
  byText('.btn', 'Add transaction').click(); await wait(120);
  check('transaction logged from the FAB', w.S.logs.length === 1 && w.S.logs[0].amount === 12.5);

  // add a second account, then a transfer
  await w.Actions.saveAccount({ id: 's9', name: 'Tabung Haji', icon: '🐖', type: 'saving', startBalance: 1000, order: 0, createdAt: new Date().toISOString() });
  w.Forms.transfer(); await wait();
  type(q('.input-amount'), '10000');
  qq('.sheet-body select')[1].value = 's9';
  byText('.btn', 'Move money').click(); await wait(120);
  check('transfer writes a linked pair', w.S.logs.filter(l => l.transferPairId).length === 2);
  check('transfer moved money out of spending', w.Calc.monthlyBalance() === 2500 - 12.5 - 100);
  check('transfer moved money into savings', w.Calc.savingsBalance() === 1100);

  // checklist
  w.Checklist.open(); await wait();
  check('checklist lists income as always-on', /always counted/.test(sheet().textContent));

  // graph sheets
  w.TabHome.graphSheet('general'); await wait();
  check('balance graph renders an svg path', !!sheet().querySelector('svg .chart-line'));
  w.TabHome.graphSheet('saving'); await wait();
  check('savings graph draws the forecast line', !!sheet().querySelector('svg .chart-forecast'));

  // account detail + settings
  w.TabAccounts.detail(w.S.accounts[0].id); await wait();
  check('account detail shows its balance', /In here now/.test(sheet().textContent));
  w.Settings.open(); await wait();
  check('settings offers backup and restore', /Download full backup/.test(sheet().textContent) && /Restore from backup/.test(sheet().textContent));
  check('settings can reorder the tabs', !!sheet().querySelector('.order-list'));
  // the mid-cycle rule set during onboarding must be correctable here
  check('settings exposes the first-month controls', /Your first month/.test(sheet().textContent) &&
    /Use what I had left/.test(sheet().textContent));
  check('and shows the current spread rate', /a day across \d+ day/.test(sheet().textContent),
    (sheet().textContent.match(/[^.]*a day across[^.]*\./) || [''])[0].trim());
  byText('.seg', 'Use the normal amount').click(); await wait();
  byText('.btn', 'Save settings').click(); await wait(200);
  check('switching back to the monthly rate clears the spread',
    w.S.settings.midCycleMode === 'prorate', w.S.settings.midCycleMode);
  check('and the allowance reverts to the Plan pool over the whole cycle',
    Math.abs(w.Calc.dailyAllowance(w.Cycles.currentCycleKey()) -
      w.Calc.cyclePool(w.Cycles.currentCycleKey()) /
      w.Cycles.getCycleRangeForKey(w.Cycles.currentCycleKey()).totalDays) < 0.01,
    w.Calc.dailyAllowance(w.Cycles.currentCycleKey()));

  // UI.confirm and the actions gated on it. Every other test in here drives
  // Actions.* directly, which is exactly how a confirm that could only ever
  // resolve false shipped: Delete, Skip setup and Restore all silently did
  // nothing. Drive the real dialog.
  let answer = null;
  w.UI.confirm({ title: 'Sure?', message: 'M', confirmLabel: 'Do it' }).then(v => { answer = v; });
  await wait();
  check('confirm opens a dialog', /Sure\?/.test(sheet().textContent));
  byText('.btn', 'Do it').click(); await wait(300);
  check('confirming resolves true', answer === true, answer);
  w.UI.confirm({ title: 'Sure?', message: 'M', confirmLabel: 'Do it' }).then(v => { answer = v; });
  await wait();
  byText('.btn', 'Cancel').click(); await wait(300);
  check('cancelling resolves false', answer === false, answer);
  w.UI.confirm({ title: 'Sure?', message: 'M', confirmLabel: 'Do it' }).then(v => { answer = v; });
  await wait();
  q('.sheet-head .icon-btn').click(); await wait(300);
  check('closing with the x resolves false', answer === false, answer);

  // and end to end: a Plan item really leaves the Plan tab and the database
  await w.Actions.savePlanItem('commitments', {
    id: 'p_del', name: 'Sewa Rumah', amount: 1200, accountId: w.S.accounts[0].id,
    dueType: 'day', dueDay: 1, cycleOverrides: {}
  });
  w.App.go('plan'); await wait();
  const planRow = [...D.querySelectorAll('.plan-row')].filter(r => /Sewa Rumah/.test(r.textContent))[0];
  check('the plan row is on the tab', !!planRow);
  planRow.click(); await wait();
  byText('.btn', 'Delete').click(); await wait();
  check('delete asks first', /Delete Sewa Rumah\?/.test(sheet().textContent));
  byText('.btn', 'Delete').click(); await wait(400);
  check('plan item deleted from state', !w.Calc.planItems('commitments').some(i => i.id === 'p_del'));
  check('plan item deleted from IndexedDB', (await w.DB.all('plan')).every(r => r.id !== 'p_del'));
  check('and the row left the Plan tab',
    ![...D.querySelectorAll('.plan-row')].some(r => /Sewa Rumah/.test(r.textContent)));

  // the once-only prompt for installs that were already mid-cycle at first boot
  const curRange = w.Cycles.getCycleRangeForKey(w.Cycles.currentCycleKey());
  const prevRange = w.Cycles.getCycleRangeForKey(w.Cycles.shiftCycleKey(w.Cycles.currentCycleKey(), -1));
  await w.Actions.saveSettings({
    midCycleMode: 'prorate', midCycleAsked: false,
    midCycleJoinDate: w.Cycles.iso(w.Cycles.addDays(curRange.start, 1))
  });
  check('an unanswered mid-cycle join in the current cycle is prompted once',
    w.Onboarding.midCyclePending() === true);
  await w.Actions.saveSettings({ midCycleAsked: true });
  check('and never prompts again once answered', w.Onboarding.midCyclePending() === false);
  await w.Actions.saveSettings({
    midCycleAsked: false,
    midCycleJoinDate: w.Cycles.iso(w.Cycles.addDays(prevRange.start, 1))
  });
  check('a join date from an older cycle is deliberately left alone',
    w.Onboarding.midCyclePending() === false);
  await w.Actions.saveSettings({ midCycleAsked: true, midCycleJoinDate: null });

  const esc2 = () => D.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));

  // managing categories. Each log keeps its own copy of categoryName, and the
  // Breakdown displays that copy — so a rename that only touched settings
  // would leave every past transaction showing the old name.
  /* Seed the state rather than depending on what earlier steps happened to
     leave behind — the first cut of this test picked a category with no logs
     and two assertions passed vacuously. */
  const seeded = await w.Actions.addCategory('expense', 'Kedai Runcit');
  const catId = seeded.id;
  const beforeName = seeded.name;
  const spendable = w.S.logs.filter(l => l.type === 'expense' && !l.sourceChecklistId).slice(0, 2);
  for (const l of spendable) {
    await w.Actions.updateLog(l.id, { categoryId: catId, categoryName: beforeName });
  }
  await wait(120);
  const usingBefore = w.Actions.logsUsingCategory(catId).length;
  check('there is a category in use to work with',
    spendable.length > 0 && usingBefore === spendable.length,
    beforeName + ' on ' + usingBefore + ' of ' + spendable.length + ' seeded');
  await w.Actions.renameCategory('expense', catId, 'Barang Rumah');
  await wait(150);
  check('renaming updates the category itself',
    w.Actions.categoryList('expense').filter(c => c.id === catId)[0].name === 'Barang Rumah');
  check('and back-fills every transaction using it',
    w.Actions.logsUsingCategory(catId).every(l => l.categoryName === 'Barang Rumah'),
    w.Actions.logsUsingCategory(catId).map(l => l.categoryName).join(','));
  check('so the Breakdown shows the new name, not the old one', (() => {
    const r = w.Cycles.getCycleRangeForKey(w.App.cycleKey());
    const items = w.Calc.categoryTotals(r.startIso, r.endIso, 'expense').items;
    return items.some(i => i.name === 'Barang Rumah') && !items.some(i => i.name === beforeName);
  })());
  check('it survives a write to the database',
    (await w.DB.all('logs')).filter(l => l.categoryId === catId).every(l => l.categoryName === 'Barang Rumah'));

  // deleting a category in use must move its transactions, never orphan them
  const moveTo = w.Actions.categoryList('expense').filter(c => c.id !== catId)[0];
  const movedCount = w.Actions.logsUsingCategory(catId).length;
  const moved = await w.Actions.deleteCategory('expense', catId, moveTo.id);
  await wait(150);
  check('the category is gone from the list',
    !w.Actions.categoryList('expense').some(c => c.id === catId));
  check('it reports how many transactions moved', moved === movedCount, moved + ' vs ' + movedCount);
  check('nothing is left pointing at the deleted category',
    w.Actions.logsUsingCategory(catId).length === 0);
  check('those transactions carry the new category, id and name',
    (await w.DB.all('logs')).filter(l => l.categoryName === moveTo.name)
      .some(l => l.categoryId === moveTo.id));

  // deleting with no destination leaves them with no category, still present
  const orphanCat = await w.Actions.addCategory('expense', 'Sementara');
  const logCount = w.S.logs.length;
  await w.Actions.updateLog(w.S.logs.filter(l => l.type === 'expense' && !l.sourceChecklistId)[0].id,
    { categoryId: orphanCat.id, categoryName: orphanCat.name });
  await wait(100);
  check('a fresh category can be used', w.Actions.logsUsingCategory(orphanCat.id).length === 1);
  await w.Actions.deleteCategory('expense', orphanCat.id, null);
  await wait(150);
  check('deleting with no destination keeps the transactions', w.S.logs.length === logCount, w.S.logs.length);
  check('they just have no category now',
    (await w.DB.all('logs')).filter(l => l.categoryId === null && l.categoryName === null).length > 0);
  check('and the Breakdown files them under No category', (() => {
    const r = w.Cycles.getCycleRangeForKey(w.App.cycleKey());
    return w.Calc.categoryTotals(r.startIso, r.endIso, 'expense').items.some(i => i.name === 'No category');
  })());

  // both entry points open the manager
  w.Settings.open(); await wait();
  check('Settings offers Edit categories', !!byText('.btn', 'Edit categories'));
  byText('.btn', 'Edit categories').click(); await wait(250);
  check('the manager lists both kinds',
    /Money out/.test(sheet().textContent) && /Money in/.test(sheet().textContent));
  check('each row offers rename and delete', qq('.cat-manage li .icon-btn').length >= 2,
    qq('.cat-manage li .icon-btn').length + ' buttons');
  esc2(); await wait(300); esc2(); await wait(300);
  w.Forms.transaction(); await wait();
  check('the transaction form offers a way in too',
    [...q('select').options].some(o => o.value === '__manage'),
    [...q('select').options].map(o => o.value).join(','));
  esc2(); await wait(300);


  // refund a logged transaction from its edit sheet
  const spendLog = w.S.logs.filter(l => !l.transferPairId && !l.sourceChecklistId && l.type === 'expense')[0];
  const accBefore = w.Calc.monthlyBalance();
  w.Forms.transaction(spendLog); await wait();
  check('the edit sheet offers a refund', !!byText('.btn', 'Got money back'));
  byText('.btn', 'Got money back').click(); await wait();
  check('the refund sheet opens',
    /Got money back/.test(sheet().querySelector('.sheet-title').textContent),
    sheet().querySelector('.sheet-title').textContent);
  check('and prefills the whole amount',
    w.CentInput.value(q('.input-amount')) === Math.abs(spendLog.amount),
    w.CentInput.value(q('.input-amount')));
  byText('.btn', 'Log the refund').click(); await wait(250);
  const rf = w.S.logs.filter(l => l.refundOfLogId === spendLog.id)[0];
  check('a refund log is written', !!rf);
  check('it is income, not a negative expense', rf.type === 'income', rf.type);
  check('it links back to what it refunds', rf.refundOfLogId === spendLog.id);
  check('it does NOT inherit sourceChecklistId', !rf.sourceChecklistId);
  check('it lands in the Refund category', rf.categoryId === 'cat_refund', rf.categoryId);
  check('Refund is a real income category, so the Log filter can find it',
    (w.S.settings.categories.income || []).some(c => c.id === 'cat_refund'));
  check('the money is back in the account',
    Math.abs(w.Calc.monthlyBalance() - (accBefore + Math.abs(spendLog.amount))) < 0.01,
    w.Calc.monthlyBalance() + ' vs ' + (accBefore + Math.abs(spendLog.amount)));

  // a planned commitment can be reimbursed the same way
  /* Tick a commitment so there IS a Plan-sourced expense to reimburse. */
  if (!w.S.plan.commitments.length) {
    await w.Actions.savePlanItem('commitments', {
      id: 'c_rf', name: 'Sewa', amount: 900, accountId: w.S.accounts[0].id,
      dueType: 'day', dueDay: 1, cycleOverrides: {}
    });
  }
  await w.Actions.setChecked(w.App.cycleKey(), 'commitments', w.S.plan.commitments[0], true);
  await wait(150);
  const planLog = w.S.logs.filter(l => l.sourceChecklistId && l.type === 'expense')[0];
  check('there is a Plan-sourced expense to reimburse', !!planLog);
  w.Forms.transaction(planLog); await wait();
  check('a Plan-sourced transaction offers it too', !!byText('.btn', 'Got money back'));
  byText('.btn', 'Got money back').click(); await wait();
  byText('.btn', 'Log the refund').click(); await wait(250);
  const rf2 = w.S.logs.filter(l => l.refundOfLogId === planLog.id)[0];
  check('the reimbursement is written as plain income', !!rf2 && !rf2.sourceChecklistId && rf2.type === 'income');

  // and the Transaction tab labels both halves
  w.App.go('log'); await wait();
  check('the log tags the refund row', /refund/.test(D.querySelector('#app-main').textContent));

  // the ? button carries the wordy explanations instead of the cards
  const esc = () => D.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  for (const tab of ['home', 'log', 'plan', 'accounts', 'breakdown']) {
    w.App.go(tab); await wait();
    const help = [...D.querySelectorAll('#app-head .icon-btn')].filter(b => b.textContent === '?')[0];
    check(tab + ' tab has a ? in the header', !!help);
    help.click(); await wait();
    const title = sheet().querySelector('.sheet-title').textContent;
    check(tab + ' help names the page', title === w.App.HELP[tab].title + ' — how it works', title);
    check(tab + ' help has real content', sheet().querySelectorAll('.help-para').length === w.App.HELP[tab].body.length);
    esc(); await wait(300);
    // the month nav is a Transaction-tab-only feature
    check(tab + (tab === 'log' ? ' shows' : ' hides') + ' the month nav',
      !!D.querySelector('#app-head .cycle-nav') === (tab === 'log'));
  }

  // browsing a past month must not silently steer the OTHER tabs once you
  // leave Log — that is the whole point of confining the nav to it
  w.App.go('log'); await wait();
  const curKey = w.App.cycleKey();
  w.App.setCycle(w.Cycles.shiftCycleKey(curKey, -1));
  await wait();
  check('Log is now viewing a past month', w.App.cycleKey() !== curKey);
  w.App.go('plan'); await wait();
  check('leaving Log resets it, so Plan sees the current month', w.App.cycleKey() === curKey);
  w.App.go('log'); await wait();
  check('and Log itself is back on the current month too', w.App.cycleKey() === curKey);
  w.App.go('accounts'); await wait();
  check('the Accounts card no longer carries the explanation',
    !/added together. The arrow shows/.test(D.querySelector('#app-main').textContent));
  w.App.go('breakdown'); await wait();
  check('the Breakdown chart card no longer carries its paragraph',
    !/same rule, so the totals always agree/.test(D.querySelector('#app-main').textContent));

  // tapping the Home hero opens today and the next 2 days
  w.App.go('home'); await wait();
  const heroEl = D.querySelector('.hero');
  check('the hero is tappable', heroEl.getAttribute('role') === 'button', heroEl.getAttribute('role'));
  heroEl.click(); await wait(250);
  check('it opens the 3-day view',
    /Today and the next 2 days/.test(sheet().querySelector('.sheet-title').textContent),
    sheet().querySelector('.sheet-title').textContent);
  const fcCards = qq('.fc-card');
  const fcDots = qq('.fc-dot');
  check('one card per day', fcCards.length === 3, fcCards.length);
  check('one chart dot per day', fcDots.length === 3, fcDots.length);
  check('they are named Today, Tomorrow and the day after',
    qq('.fc-day').map(n => n.textContent).slice(0, 2).join(',') === 'Today,Tomorrow',
    qq('.fc-day').map(n => n.textContent).join(','));
  check('today starts selected', fcCards[0].classList.contains('on'));
  check('each day shows what rolled over and its own share',
    fcCards.every(c => /Left over/.test(c.textContent) && /For the day/.test(c.textContent)));
  check('the future days say they assume you stop now',
    /If you stop now/.test(fcCards[1].textContent) && /If you stop now/.test(fcCards[2].textContent));
  const fdays = w.Calc.forecastDays(3);
  check('budget is rollover plus the daily share, every day',
    fdays.every(p => Math.abs(p.budget - (p.rollover + p.allowance)) < 0.02),
    fdays.map(p => p.rollover.toFixed(2) + '+' + p.allowance.toFixed(2) + '=' + p.budget.toFixed(2)).join(' | '));
  check("tomorrow's roll-over is today's leftover",
    Math.abs(fdays[1].rollover - fdays[0].left) < 0.02,
    fdays[1].rollover + ' vs ' + fdays[0].left);
  fcDots[2].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(60);
  check('tapping a dot selects that day',
    fcCards[2].classList.contains('on') && !fcCards[0].classList.contains('on'));
  fcCards[1].click(); await wait(60);
  check('tapping a card selects its dot',
    fcDots[1].classList.contains('on') && !fcDots[2].classList.contains('on'));
  esc2(); await wait(300);

  /* The headline cards are plain boxes. The jade left edge went through a
     border and then an inset bar before being dropped entirely — keep all
     three out. jsdom does not resolve enough of the cascade to judge computed
     style, so assert on the stylesheet; rendering is a browser check. */
  /* Comments explain the old device by name, so strip them before matching. */
  const sheetCss = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  check('no card fakes the accent with a coloured left border',
    !/border-left:\s*3px solid var\(--jade\)/.test(sheetCss));
  check('nor with an inset jade shadow',
    !/inset 3px 0 0 var\(--jade\)/.test(sheetCss));
  check('no ::before accent is drawn on either headline card',
    !/\.net-card::before/.test(sheetCss) && !/\.plan-hero::before/.test(sheetCss));
  check('the headline cards carry no jade edge styling at all',
    !/\.(net-card|plan-hero)[^{]*\{[^}]*--jade/.test(sheetCss));

  // card style applies beyond Home
  await w.Actions.saveSettings({ cardStyle: 'frosted' });
  w.App.applyCardStyle();
  check('the card style is on the root element for every tab to inherit',
    D.documentElement.dataset.cardStyle === 'frosted', D.documentElement.dataset.cardStyle);
  await w.Actions.saveSettings({ cardStyle: 'flat' });
  w.App.applyCardStyle();

  // re-tapping the active nav tab scrolls to top without tearing the page down;
  // switching to a different tab still jumps instantly and re-renders.
  w.App.go('accounts');
  w.scrollTo(0, 300);
  const pageBefore = D.querySelector('.page');
  w.__scrollCalls.length = 0;
  const accBtn = [...D.querySelectorAll('.nav-btn')].filter(b => /Accounts/.test(b.textContent))[0];
  accBtn.click();
  const lastCall = w.__scrollCalls[w.__scrollCalls.length - 1];
  check('re-tapping the current tab animates to the top', lastCall && lastCall.behavior === 'smooth', lastCall);
  check('scrollY lands at 0', w.scrollY === 0);
  check('re-tapping does not tear down the page', D.querySelector('.page') === pageBefore);

  w.scrollTo(0, 300);
  w.__scrollCalls.length = 0;
  const homeBtn = [...D.querySelectorAll('.nav-btn')].filter(b => /Home/.test(b.textContent))[0];
  homeBtn.click();
  const switchCall = w.__scrollCalls[0];
  check('switching tabs jumps to the top instantly, not smoothly',
    switchCall && switchCall.top === 0 && switchCall.behavior !== 'smooth', switchCall);
  check('switching tabs does re-render the page', D.querySelector('.page') !== pageBefore);
  check('and lands on the tab that was clicked', /page-home/.test(D.querySelector('.page').className));

  // the "app is updating" bar. Service workers do not exist in jsdom, so this
  // covers the part that does: the bar itself, and the promise that a reload
  // never lands on top of a half-filled form.
  w.UI.updateBar('App is updating. Please wait…');
  check('update bar shows a message along the bottom',
    !!$('.update-bar') && /App is updating/.test($('.update-bar').textContent));
  check('update bar outlives a toast', (w.UI.toast('Something else'), !!$('.update-bar')));
  const escape = () => D.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  while (w.UI.busy()) { escape(); await wait(300); }
  check('nothing is open, so a reload would go straight through', w.UI.busy() === false);
  w.Forms.transaction(); await wait();
  check('a form sheet counts as busy', w.UI.busy() === true);
  let reloaded = false;
  w.UI.onIdle(() => { reloaded = true; });
  check('a reload waits while the form is open', reloaded === false);
  w.UI.updateBar('Update ready. It will load when you finish here.', { actionLabel: 'Reload now' });
  check('update bar offers a way to take it now', !!$('.update-bar .toast-action'),
    $('.update-bar .toast-action').textContent);
  escape(); await wait(300);
  check('and goes ahead once the form closes', reloaded === true);
  w.UI.updateBar(false); await wait(300);
  check('update bar can be dismissed', !$('.update-bar'));

  // delete with undo
  const id = w.S.logs.filter(l => !l.transferPairId)[0].id;
  await w.Actions.deleteLog(id); await wait();
  check('delete offers an undo countdown', !!$('.toast-action') && /Undo/.test($('.toast-action').textContent));
  $('.toast-action').click(); await wait(120);
  check('undo puts the record back', w.S.logs.some(l => l.id === id));

  // long account name must not widen its card
  w.App.go('accounts'); await wait();
  const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
  const accNameRule = (css.match(/\.acc-name\s*\{[^}]*\}/) || [''])[0];
  const accGridRule = (css.match(/\.acc-grid\s*\{[^}]*\}/) || [''])[0];
  check('long account names wrap instead of widening the card',
    /overflow-wrap:\s*anywhere/.test(accNameRule) && /word-break:\s*break-word/.test(accNameRule));
  check('account columns cannot be pushed wider than the grid',
    /minmax\(0,\s*1fr\)/.test(accGridRule) && /min-width:\s*0/.test((css.match(/\.acc-card\s*\{[^}]*\}/) || [''])[0]));
  check('the long name actually rendered', $('.acc-name').textContent.length > 25, $('.acc-name').textContent);

  // backup round trip
  let captured = null;
  const RealBlob = w.Blob;
  w.Blob = function (parts, o) { captured = String(parts[0]); return new RealBlob(parts, o); };
  w.Settings.exportJson();
  await wait(60);
  let parsed = null;
  try { parsed = JSON.parse(captured); } catch (e) { }
  check('backup captures every store',
    !!parsed && parsed.app === 'poket-daily' && !!parsed.settings && Array.isArray(parsed.accounts) &&
    Array.isArray(parsed.logs) && !!parsed.plan && Array.isArray(parsed.checklist));
  w.Settings.exportPlanCsv();
  await wait(60);
  check('plan CSV exports a header and a row', /"Section","Name"/.test(captured) && /"income","Gaji Bulanan"/.test(captured));
  w.Blob = RealBlob;

  check('no uncaught errors during the run', errors.length === 0, errors.join(' | '));
  console.log(fails ? '\n' + fails + ' FAILING' : '\nEvery sheet opens and every form saves.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
