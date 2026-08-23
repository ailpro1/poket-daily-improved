/* release.js — the CACHE bump that actually ships new code.

     node tools/release.js           bump CACHE in sw.js
     node tools/release.js --check   fail if a shipped asset changed since the
                                     last bump (for CI or a pre-push hook)

   sw.js serves everything but navigations cache first, so until CACHE changes
   a returning user keeps being handed the old js/ and css/ out of the old
   cache and new code never reaches them. check-cache.js verifies the asset
   LIST; this verifies the VERSION. Nothing else can: only git knows whether
   the files moved since the name did.

   Development-only, like the rest of tools/. Nothing here ships. */
const fs = require('fs'), path = require('path'), cp = require('child_process');

const root = path.join(__dirname, '..');
const SW = path.join(root, 'sw.js');
/* var CACHE = 'poket-daily-v4';  ->  prefix 'poket-daily-v', number 4 */
const CACHE_RE = /(var CACHE = ')([A-Za-z0-9-]*?)(\d+)(';)/;

function read() { return fs.readFileSync(SW, 'utf8'); }

function parse(src) {
  const m = src.match(CACHE_RE);
  if (!m) {
    console.log("No \"var CACHE = 'name-vN';\" line in sw.js — cannot tell what to bump.");
    process.exit(1);
  }
  return { prefix: m[2], n: parseInt(m[3], 10), name: m[2] + m[3] };
}

function git(args) {
  try { return cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  catch (e) { return null; }
}

/* Everything a browser fetches, so everything the cache name has to cover.
   Union of the ASSETS list and what is actually on disk, so a file added to
   one but not the other still counts. sw.js is excluded: changing it IS the bump. */
function shippedAssets(src) {
  const listed = [...src.matchAll(/'([^']+\.(?:js|css|html|png|webmanifest))'/g)].map(m => m[1]);
  const disk = [];
  for (const dir of ['js', 'css', 'icons']) {
    fs.readdirSync(path.join(root, dir)).forEach(f => disk.push(dir + '/' + f));
  }
  return [...new Set([...listed, ...disk, 'index.html', 'manifest.webmanifest'])]
    .filter(f => f !== 'sw.js' && fs.existsSync(path.join(root, f)));
}

/* Which shipped files have moved since the current CACHE name was set?
   Returns null when git cannot answer, which is not the same as "none". */
function changedSinceBump(src, name) {
  if (!git(['rev-parse', '--git-dir'])) return { skip: 'this is not a git checkout' };
  const head = git(['show', 'HEAD:sw.js']);
  if (head === null) return { skip: 'sw.js is not committed yet' };
  if (head.indexOf("'" + name + "';") === -1) return { pending: true };

  /* First commit to introduce this string is the release it was bumped in. */
  const log = git(['log', '--format=%H', '--reverse', '-S' + name, '--', 'sw.js']);
  if (!log) return { skip: 'the commit that set ' + name + ' is not in this history (shallow clone?)' };
  const since = log.split('\n')[0];

  /* No ".." range, so this compares that commit against the WORKING TREE —
     uncommitted edits count, which is the point of a pre-push check. */
  const diff = git(['diff', '--name-only', since, '--'].concat(shippedAssets(src)));
  return { since: since.slice(0, 7), files: diff ? diff.split('\n') : [] };
}

function check(quiet) {
  const src = read();
  const { name } = parse(src);
  const res = changedSinceBump(src, name);

  if (res.skip) {
    if (!quiet) console.log('Cannot verify the bump: ' + res.skip + '. Skipping.');
    return 0;
  }
  if (res.pending) {
    if (!quiet) console.log('CACHE is ' + name + ', a bump not committed yet. Good to ship.');
    return 0;
  }
  if (!res.files.length) {
    if (!quiet) console.log('CACHE ' + name + ' covers every shipped asset as of ' + res.since + '. Nothing to bump.');
    return 0;
  }
  console.log('CACHE is still ' + name + ', but these shipped files changed since ' + res.since + ':');
  res.files.forEach(f => console.log('  ' + f));
  console.log('\nReturning users are served the old copies out of the old cache, so none');
  console.log('of this reaches them. Fix it with:  node tools/release.js');
  return 1;
}

function bump(force) {
  const src = read();
  const cur = parse(src);
  const res = changedSinceBump(src, cur.name);

  if (!force && res.pending) {
    console.log('CACHE is already ' + cur.name + ' and that bump is not committed yet.');
    console.log('Bumping again would just skip a number. Use --force if you mean it.');
    return 1;
  }
  if (!force && res.files && !res.files.length) {
    console.log('No shipped asset has changed since ' + cur.name + ' was set.');
    console.log('Bumping now would make every user re-download the whole app for');
    console.log('nothing. Use --force if you mean it.');
    return 1;
  }

  const next = cur.prefix + (cur.n + 1);
  fs.writeFileSync(SW, src.replace(CACHE_RE, (m, a, b, c, d) => a + next + d));
  console.log('CACHE  ' + cur.name + '  ->  ' + next);
  if (res.files && res.files.length) {
    console.log('Covers ' + res.files.length + ' changed file' + (res.files.length === 1 ? '' : 's') + ':');
    res.files.slice(0, 12).forEach(f => console.log('  ' + f));
    if (res.files.length > 12) console.log('  …and ' + (res.files.length - 12) + ' more');
  }
  console.log('\nCommit sw.js with the release, or returning users keep the old build.');
  return 0;
}

const args = process.argv.slice(2);
const force = args.indexOf('--force') > -1;
process.exit(args.indexOf('--check') > -1 ? check(false) : bump(force));
