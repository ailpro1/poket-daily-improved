/* Splash behaviour: greeting by hour, budget figure, once-per-day rule. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('/home/claude/node_modules/jsdom');
const FDBFactory = require('/home/claude/node_modules/fake-indexeddb/lib/FDBFactory');
const FDBKeyRange = require('/home/claude/node_modules/fake-indexeddb/lib/FDBKeyRange');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const db = new FDBFactory();
let fails = 0;
const check = (l, ok, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms || 200));

function makeWindow() {
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window;
  w.indexedDB = db; w.IDBKeyRange = FDBKeyRange;
  w.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { } });
  w.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
  w.scrollTo = () => { };
  [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
    .forEach(s => vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), dom.getInternalVMContext(), { filename: s }));
  return w;
}

(async () => {
  const w1 = makeWindow();
  await w1.App.boot(); await wait(300);
  const hours = { 3: 'Still up?', 9: 'Good morning!', 14: 'Good afternoon!', 20: 'Good evening!', 23: 'Good night!' };
  Object.keys(hours).forEach(h => check('hour ' + h + ' greets correctly', w1.Splash.greeting(+h).text === hours[h], w1.Splash.greeting(+h).text));

  // give it a plan so the splash shows a real figure
  await w1.Actions.saveSettings({ onboarded: true, lastSplashDate: null, cycleStartDay: 1 });
  await w1.Actions.saveAccount({ id: 'a1', name: 'Bank', icon: '🏦', type: 'general', startBalance: 1000, order: 0, createdAt: new Date().toISOString() });
  await w1.Actions.savePlanItem('income', { id: 'i1', name: 'Gaji', amount: 3100, accountId: 'a1', dueType: 'day', dueDay: 1, cycleOverrides: {} });

  const w2 = makeWindow();
  await w2.App.boot(); await wait(300);
  const shown = w2.document.querySelector('#splash');
  const expected = w2.Fmt.group(Math.abs(w2.Calc.dailyBudget().left));
  check('splash shows today\'s budget figure', shown.querySelector('.splash-num').textContent === expected,
    shown.querySelector('.splash-num').textContent + ' vs ' + expected);
  check('splash shows the currency symbol', shown.querySelector('.splash-cur').textContent === 'RM');
  shown.querySelector('.splash-go').click();
  await wait(400);

  const w3 = makeWindow();
  await w3.App.boot(); await wait(300);
  check('second open the same day skips the splash', !w3.document.querySelector('#splash'));

  await w3.Actions.saveSettings({ lastSplashDate: '2020-01-01' });
  const w4 = makeWindow();
  await w4.App.boot(); await wait(300);
  check('a new day brings the splash back', !!w4.document.querySelector('#splash.ready'));

  console.log(fails ? '\n' + fails + ' FAILING' : '\nSplash behaves.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
