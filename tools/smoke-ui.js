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
w.scrollTo = () => { };
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
  byText('.btn', 'Add account').click(); await wait(120);
  check('account saved from the form', w.S.accounts.length === 1 && w.S.accounts[0].startBalance === 2500);
  check('Monthly Balance picks it up immediately', w.Calc.monthlyBalance() === 2500);

  // the mid-cycle step — reached because the cycle start day above guarantees it
  byText('.btn', 'Next: savings').click(); await wait();
  byText('.btn', 'Next: this cycle').click(); await wait();
  check('guide asks about starting part-way through the cycle',
    /starting part-way through/.test(sheet().textContent));
  const midAmount = q('.input-amount');
  check('mid-cycle amount is prefilled from the account just entered',
    w.CentInput.value(midAmount) === 2500, w.CentInput.value(midAmount));
  const midDays = w.Cycles.daysToCycleEnd(w.Cycles.iso(w.Cycles.today()));
  check('mid-cycle step shows the resulting daily rate',
    sheet().textContent.indexOf(w.Fmt.money(2500 / midDays) + ' a day') > -1,
    w.Fmt.money(2500 / midDays) + ' a day over ' + midDays + ' days');
  byText('.btn', 'Use this for the rest of the cycle').click(); await wait(200);
  check('stated figure saved as the rule for this cycle',
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
  check('account detail shows its balance', /Balance now/.test(sheet().textContent));
  w.Settings.open(); await wait();
  check('settings offers backup and restore', /Download full backup/.test(sheet().textContent) && /Restore from backup/.test(sheet().textContent));
  check('settings can reorder the tabs', !!sheet().querySelector('.order-list'));
  // the mid-cycle rule set during onboarding must be correctable here
  check('settings exposes the This cycle controls', /This cycle/.test(sheet().textContent) &&
    /Spread what I had left/.test(sheet().textContent));
  check('and shows the current spread rate', /a day across \d+ day/.test(sheet().textContent),
    (sheet().textContent.match(/[^.]*a day across[^.]*\./) || [''])[0].trim());
  byText('.seg', 'Normal monthly rate').click(); await wait();
  byText('.btn', 'Save settings').click(); await wait(200);
  check('switching back to the monthly rate clears the spread',
    w.S.settings.midCycleMode === 'prorate', w.S.settings.midCycleMode);
  check('and the allowance reverts to the Plan pool over the whole cycle',
    Math.abs(w.Calc.dailyAllowance(w.Cycles.currentCycleKey()) -
      w.Calc.cyclePool(w.Cycles.currentCycleKey()) /
      w.Cycles.getCycleRangeForKey(w.Cycles.currentCycleKey()).totalDays) < 0.01,
    w.Calc.dailyAllowance(w.Cycles.currentCycleKey()));

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
  check('plan CSV exports a header and a row', /"Section","Name"/.test(captured) && /"income","Gaji"/.test(captured));
  w.Blob = RealBlob;

  check('no uncaught errors during the run', errors.length === 0, errors.join(' | '));
  console.log(fails ? '\n' + fails + ' FAILING' : '\nEvery sheet opens and every form saves.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
