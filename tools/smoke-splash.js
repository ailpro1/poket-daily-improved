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

/* The figure is spun up digit by digit, so .splash-num holds a reel per digit
   rather than plain text. Rebuild the number the way a reader sees it: each
   reel's last cell is the digit it lands on, and commas and the dot are
   plain spans in between. */
function readFigure(w) {
  const host = w.document.querySelector('.splash-num');
  if (!host) return '';
  if (!host.querySelector('.roll-reel')) return host.textContent;
  return [...host.children].map(node => node.classList.contains('roll-reel')
    ? node.querySelector('.roll-strip').lastElementChild.textContent
    : node.textContent).join('');
}

function makeWindow(reduceMotion) {
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window;
  w.indexedDB = db; w.IDBKeyRange = FDBKeyRange;
  w.matchMedia = q => ({ matches: !!reduceMotion && /reduced-motion/.test(q), addEventListener() { }, removeEventListener() { } });
  w.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
  w.scrollTo = () => { };
  [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
    .forEach(s => vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), dom.getInternalVMContext(), { filename: s }));
  return w;
}

(async () => {
  /* Every boot waits out Splash.ART_HOLD (3s), or the greeting and the figure
     have not painted yet and the splash never marks itself as seen. */
  const w1 = makeWindow();
  await w1.App.boot(); await wait(3400);
  const hours = { 3: 'Still up?', 9: 'Good morning!', 14: 'Good afternoon!', 20: 'Good evening!', 23: 'Good night!' };
  Object.keys(hours).forEach(h => check('hour ' + h + ' greets correctly', w1.Splash.greeting(+h).text === hours[h], w1.Splash.greeting(+h).text));

  // give it a plan so the splash shows a real figure
  await w1.Actions.saveSettings({ onboarded: true, lastSplashDate: null, cycleStartDay: 1 });
  await w1.Actions.saveAccount({ id: 'a1', name: 'Bank', icon: '🏦', type: 'general', startBalance: 1000, order: 0, createdAt: new Date().toISOString() });
  await w1.Actions.savePlanItem('income', { id: 'i1', name: 'Gaji', amount: 3100, accountId: 'a1', dueType: 'day', dueDay: 1, cycleOverrides: {} });

  const w2 = makeWindow();
  await w2.App.boot(); await wait(3400);
  const shown = w2.document.querySelector('#splash');
  const expected = w2.Fmt.group(Math.abs(w2.Calc.dailyBudget().left));
  check('splash shows today\'s budget figure', readFigure(w2) === expected,
    readFigure(w2) + ' vs ' + expected);
  check('splash shows the currency symbol', shown.querySelector('.splash-cur').textContent === 'RM');
  /* Arcade roll: one reel per digit, punctuation left alone. */
  const reels = shown.querySelectorAll('.roll-reel').length;
  check('each digit spins up on its own reel', reels === expected.replace(/[^0-9]/g, '').length,
    reels + ' reels for ' + expected);
  check('commas and the dot do not spin',
    shown.querySelectorAll('.roll-fixed').length === expected.replace(/[0-9]/g, '').length);
  shown.querySelector('.splash-go').click();
  await wait(400);

  const w3 = makeWindow();
  await w3.App.boot(); await wait(3400);
  check('second open the same day skips the splash', !w3.document.querySelector('#splash'));

  await w3.Actions.saveSettings({ lastSplashDate: '2020-01-01' });
  const w4 = makeWindow();
  await w4.App.boot(); await wait(3400);
  check('a new day brings the splash back', !!w4.document.querySelector('#splash.ready'));

  /* Anyone who asked for less motion just gets the number. */
  await w3.Actions.saveSettings({ lastSplashDate: '2020-01-02' });
  const w5 = makeWindow(true);
  await w5.App.boot(); await wait(3400);
  check('reduced motion skips the reels', w5.document.querySelectorAll('.roll-reel').length === 0);
  check('and still shows the figure', /\d/.test(readFigure(w5)), readFigure(w5));

  console.log(fails ? '\n' + fails + ' FAILING' : '\nSplash behaves.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
