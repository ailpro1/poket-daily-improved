# Poket Daily

A personal daily-spending-budget and multi-account tracker. Plain HTML, CSS and
vanilla JavaScript — no framework, no bundler, no build step. Open `index.html`
in a browser and it runs. Storage is IndexedDB, so it works fully offline and
installs as a PWA.

## Running it

- **Locally:** open `index.html`. Everything works except the service worker,
  which browsers only register over `http(s)` or `localhost`.
- **With offline install:** serve the folder over HTTP, e.g.
  `python3 -m http.server 8000`, then open `http://localhost:8000` and use your
  browser's "Install app" / "Add to Home Screen".
- **Hosting:** upload the folder as-is to any static host. All paths are relative.

Do not open it from a `file://` URL if you want the PWA behaviour — IndexedDB
works, but service workers do not.

## How the numbers hold together

Every figure in the app comes out of `js/calc.js`. No tab, card, total or chart
does its own money maths. Every date-range question goes through
`js/cycles.js` (`getMonthKey`, `getCycleRangeForKey`). Those two files are the
only places arithmetic lives, which is what stops one tab quietly disagreeing
with another.

There are two deliberately different kinds of number:

| | Question it answers | How it is built |
|---|---|---|
| **Monthly Balance** / **Savings Balance** | "What do I actually have?" | Live sum of `accountBalance()` across general / saving accounts |
| **Daily Spending Budget** | "What can I safely spend today?" | `(planned income − commitments − savings) ÷ days`, adjusted for real activity and carry-over |

### The double-counting rule

The daily budget pool already subtracts planned commitments and savings. So the
transactions created by ticking the Checklist (`sourceChecklistId` set) are
**excluded** from the daily budget and the Breakdown tab. They are still real
money and still move account balances, and they still appear in the Log tab's
"out this cycle" total. `Calc.affectsBudget()` is the single predicate for this;
everything that needs the rule calls it.

### Starting part-way through a cycle

Install on day 20 of a 31-day cycle and neither half of the usual sum holds: there
is not a full cycle's pool left, and there are not a full cycle's days to spend it
over. So onboarding asks — after the cycle start day and the accounts, before the
Plan — how much spending money is actually left until the cycle ends. `Calc.midCycle()`
turns that answer into the rule for **that one cycle**: the stated figure divided by
the days from the join date to the cycle end. Every later cycle goes back to the Plan
pool over its own days.

`carryInto()` is floored at the join date, because pre-join spending is already
deducted inside the figure the user typed — charging it again from the logs would
double-count it. That money is still real: it moves account balances and shows in the
Log tab and the Breakdown, it just does not drain a budget that did not exist yet.

Nothing derived is stored — only the join **date**, in `settings.midCycleJoinDate`.
The cycle key and the day count are recomputed from it, so changing the cycle start
day re-derives them, and a join that lands on day 1 disables the rule by itself. All
of it is editable later under Settings → **This cycle**, and an install that was
already mid-cycle when it first booted is asked the question once.

### Carry-over

`Calc.carryInto(date)` walks every day from the day budgeting actually began up
to the given day, accumulating `allowance − real spend`. That one walk produces
both within-cycle and across-cycle carry-over, so a surplus or deficit never
resets at a cycle boundary. `Calc.firstActivityIso()` is the lower bound, so
today's plan is never applied retroactively to days before the user had one.

### Transfers

A transfer is always two linked logs sharing a `transferPairId` — one
`transfer_out`, one `transfer_in`. Deleting one deletes both. General→general
leaves Monthly Balance flat; general→saving moves both totals by the same
amount in opposite directions.

### Graphs

Charts call `Calc.accountBalance(id, upToDate)` per period rather than
approximating, so a chart's value for a date always equals the Home card's value
for that date. The x-axis lower bound is `firstActivityIso()`, never an empty
fixed window.

## File map

```
index.html              app shell, script order
css/app.css             all styling and theme tokens
sw.js                   service worker; ASSETS must list every shipped file
manifest.webmanifest    PWA manifest
js/db.js                IndexedDB access only
js/format.js            money formatting + cent-first POS-style input
js/cycles.js            all cycle/date maths
js/calc.js              all money maths — single source of truth
js/actions.js           every write to state (persist + invalidate + re-render)
js/ui.js                sheets, toasts, undo snackbar, form primitives
js/charts.js            hand-rolled SVG line, doughnut and day-strip charts
js/forms.js             transaction, transfer, account and plan-item sheets
js/checklist.js         per-cycle checklist drawer
js/tab-*.js             Home, Log, Plan, Accounts, Breakdown
js/onboarding.js        first-run guide (cycle, accounts, mid-cycle, plan)
js/settings.js          preferences, JSON backup/restore, plan CSV
js/app.js               state load, routing, header, nav, theme, SW registration
```

Adding a JS or CSS file means adding it to **both** `index.html` and the
`ASSETS` array in `sw.js`, or offline mode silently breaks.
`node tools/check-cache.js` catches that.

## Shipping an update

**Bump `CACHE` in `sw.js` on every release.** Non-navigation requests are served
cache first, so until that name changes a returning user keeps being handed the old
`js/` and `css/` out of the old cache — new code simply never reaches them.
`check-cache.js` verifies the asset *list*; the *version* is `tools/release.js`:

```bash
node tools/release.js           # bump CACHE, listing what the bump covers
node tools/release.js --check   # exit 1 if a shipped asset changed since the last bump
```

It answers the question by asking git: find the commit that introduced the current
`CACHE` string, then diff every shipped asset from there to the working tree. So
uncommitted edits count, which is what makes it useful before a push:

```bash
# .git/hooks/pre-push   (chmod +x)
#!/bin/sh
exec node tools/release.js --check
```

Both directions refuse to do something pointless: `--check` passes on a bump you
have not committed yet, and a plain bump stops if no asset has moved, since a
gratuitous new cache name makes every user re-download the whole app. `--force`
overrides either. When git cannot answer — no repo, a shallow clone without the
bump commit — it says so and passes rather than blocking a release on a guess.

The bump is also the signal the app watches for. A changed `sw.js` installs as a new
worker, `skipWaiting()` and `clients.claim()` put it in charge, and
`App.watchForUpdate()` in `js/app.js` shows **"App is updating. Please wait…"** along
the bottom and reloads the page once, so the running tab stops serving the build it
parsed at boot. Three rules it holds to:

- **Silent on a first install.** With no existing controller the page already loaded
  these exact files from the network, so there is nothing to announce.
- **The notice is readable.** It is held for `UPDATE_NOTICE_MS` before the reload —
  on a fast connection the install finishes in milliseconds, and without the dwell
  the app looks like it reloaded for no reason.
- **It never reloads under a form.** If a sheet is open the bar offers *Reload now*
  and otherwise waits for `UI.onIdle()`, so half-entered data is never thrown away.

## Tests

Development-only; nothing in `tools/` ships or is referenced by the app.

```bash
node tools/selfcheck.js     # the spec's 7-step scenario against calc.js directly
node tools/selfcheck-midcycle.js  # the mid-cycle-start rule, in isolation
node tools/check-cache.js   # every asset is in the service worker precache
node tools/release.js --check      # sw.js CACHE was bumped for the assets that changed
node tools/smoke.js         # boots the app in jsdom, reads numbers back off the DOM
node tools/smoke-ui.js      # opens every sheet, submits every form
node tools/smoke-splash.js  # greeting by hour, budget figure, once-per-day rule
```

`selfcheck.js` deliberately pins the *unmodified* full-cycle baseline, which is what
proves the mid-cycle default is inert; the mid-cycle cases live in their own file.

The last two need jsdom and fake-indexeddb (`npm i jsdom fake-indexeddb`) and
expect them in a `node_modules` alongside the project; adjust the require paths
at the top of each file if yours sit elsewhere.

`smoke-ui.js` drives the setup guide end to end, including the cycle step and the
mid-cycle question, and it forces a cycle start day that guarantees today is past it
so the mid-cycle step is reached whatever date the harness runs on.

`smoke.js` asserts the full self-check scenario through the rendered UI: account
cards summing to the Home balance cards, Log-tab totals, breakdown footing to
the same discretionary total, checklist self-healing, undo, per-cycle overrides,
`endMonth`, and survival across a reload from IndexedDB.

## Data and backups

Everything stays on the device. Settings → **Download full backup (JSON)**
captures every store (budget, logs, accounts, settings and categories, checklist
state); **Restore from backup** wipes and rebuilds all of it, then re-initialises
the in-memory state. There is also a human-readable CSV export of the Plan.

## Notes on a few choices

- **Cycle key** is the `YYYY-MM` of the cycle's *start* month. With a cycle start
  day of 25, `2026-01` means 25 Jan → 24 Feb 2026.
- **Cycle start day** is capped at 28 so every month has one.
- **Dates** are handled at local noon internally, so daylight saving never shifts
  a day; they are stored as `YYYY-MM-DD` strings.
- **Bottom nav** defaults to Home, Log, Plan, Accounts, Breakdown, and is
  reorderable in Settings.
- **No browser storage APIs** beyond IndexedDB — no localStorage anywhere.
