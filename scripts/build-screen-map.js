#!/usr/bin/env node
// Writes docs/screen-map.md — which screen renders which component, and which
// screens a given component can appear on.
//
// docs/module-map.md deliberately stops at the logic layer, on the reasoning
// that a component is named after what it renders. That is true of the name
// and not of the *placement*: "which screen shows this row" and "what is on
// the Recipes screen" are both answers you cannot get from a name, and with
// 206 components against 35 screens, getting them by grep costs several round
// trips per UI task. CLAUDE.md's routing table names about twenty components
// by hand; this is the rest of them, generated so it cannot go stale.
//
// Committed rather than gitignored, and checked in CI, for the same reasons
// docs/module-map.md is: an agent has to be able to read it without running a
// build, and a hand-maintained index is one that drifts.
//
// The edge it draws is *rendering*, not importing. A file counts as rendering
// a component when it imports it from src/components or src/screens AND the
// identifier appears as `<Name` somewhere in the file — importing a type, a
// hook or a constant out of a component file is not placement, and counting it
// would put half the tree under every screen.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const outFile = path.join(root, 'docs', 'screen-map.md');
const MAX_LISTED = 12;

// Roots are the things a user can actually arrive at: the app shell, the
// navigator, and every screen. Reachability is measured from these, so a
// component reached from none of them is genuinely unplaced rather than merely
// deep in the tree.
const SHELL = ['App.tsx'];
const SCREEN_DIR = 'src/screens';
const COMPONENT_DIR = 'src/components';
const NAV_DIR = 'src/navigation';

// Only files git tracks, same rule as build-module-map.js: an untracked scratch
// component is invisible to CI's checkout, so indexing it here would produce a
// map that only matches on the machine that wrote it.
const ls = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tracked = new Set((ls.stdout || '').split('\0').filter(Boolean));

const isIndexed = rel =>
  tracked.has(rel) &&
  // .tsx only: a .ts file in these folders is a stylesheet or a helper, and
  // nothing that cannot hold JSX can render anything.
  /\.tsx$/.test(rel) &&
  !/\.test\.tsx$/.test(rel) &&
  (SHELL.includes(rel) ||
    rel.startsWith(`${SCREEN_DIR}/`) ||
    rel.startsWith(`${COMPONENT_DIR}/`) ||
    rel.startsWith(`${NAV_DIR}/`));

const files = [...tracked].filter(isIndexed).sort();

const IMPORT_RE = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

// Resolve a specifier to a repo-relative path, or null if it leaves the tree
// we index (node_modules, utils, hooks, …).
function resolve(fromRel, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join('src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.join(path.dirname(fromRel), spec);
  else return null;
  base = base.split(path.sep).join('/');
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
    if (tracked.has(base + ext)) return base + ext;
  }
  return tracked.has(base) ? base : null;
}

// Identifiers a clause brings into scope: `Foo`, `{ Foo, Bar as Baz }`, both.
function bindingsOf(clause) {
  const names = [];
  const braced = clause.match(/\{([\s\S]*)\}/);
  const bare = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
  if (bare && /^[A-Za-z0-9_$]+$/.test(bare)) names.push(bare);
  if (braced) {
    for (const part of braced[1].split(',')) {
      const m = part.trim().match(/(?:[A-Za-z0-9_$]+\s+as\s+)?([A-Za-z0-9_$]+)$/);
      if (m) names.push(m[1]);
    }
  }
  return names;
}

// rel -> Set of rels it renders.
const renders = new Map();
for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const out = new Set();
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = resolve(rel, m[2]);
    if (!target || target === rel) continue;
    if (!target.startsWith(`${COMPONENT_DIR}/`) && !target.startsWith(`${SCREEN_DIR}/`)) continue;
    // `<Name` or `<Name.Member`, which is how a namespaced component is used.
    const used = bindingsOf(m[1]).some(n => new RegExp(`<${n}\\b`).test(src));
    if (used) out.add(target);
  }
  renders.set(rel, out);
}

// A screen is a file directly in src/screens. src/screens/settings/ holds the
// sections SettingsGroupScreen composes, which are components sitting in the
// screens folder — listing them as screens would both invent twenty-odd
// destinations and stop the walk one step short of the screen they are on.
const SCREEN_RE = new RegExp(`^${SCREEN_DIR}/[^/]+\\.tsx$`);
const screens = files.filter(f => SCREEN_RE.test(f));
const components = files.filter(f => !SCREEN_RE.test(f) && !SHELL.includes(f) && !f.startsWith(`${NAV_DIR}/`));
const shellRoots = [...SHELL, ...files.filter(f => f.startsWith(`${NAV_DIR}/`))].filter(f => files.includes(f));

// Which screens can reach a component, following the render edges. Direct
// imports are not enough on their own: a row is three components down from the
// screen that shows it, and "which screen is this on" is the question being
// asked.
const reachedFrom = new Map(components.map(c => [c, new Set()]));
function walk(from, label) {
  const seen = new Set();
  const queue = [...(renders.get(from) || [])];
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    if (reachedFrom.has(next)) reachedFrom.get(next).add(label);
    for (const child of renders.get(next) || []) queue.push(child);
  }
}
for (const s of screens) walk(s, name(s));
// The shell mounts screens too, so walking it would credit every screen's
// subtree to "App". Only components it renders outside a screen matter.
for (const r of shellRoots) {
  for (const direct of renders.get(r) || []) {
    if (SCREEN_RE.test(direct)) continue;
    if (reachedFrom.has(direct)) reachedFrom.get(direct).add('app shell');
    walk(direct, 'app shell');
  }
}

function name(rel) {
  return path.basename(rel).replace(/\.tsx?$/, '');
}

function listed(names) {
  const sorted = [...names].sort();
  const shown = sorted.slice(0, MAX_LISTED).join(', ');
  const more = sorted.length > MAX_LISTED ? `, +${sorted.length - MAX_LISTED} more` : '';
  return { shown, more, count: sorted.length };
}

function render() {
  const lines = [
    '<!-- AUTO-GENERATED by scripts/build-screen-map.js — do not edit by hand. -->',
    '',
    '# Screen map',
    '',
    'Which screen renders which component, and which screens a component can',
    'appear on. Regenerated by `node scripts/build-screen-map.js`; CI fails if it',
    'is out of date.',
    '',
    'This is an index, not documentation. `docs/module-map.md` is its counterpart',
    "for the logic layer, and CLAUDE.md's routing table is the authority wherever",
    'it names a file.',
    '',
    'An entry means one file imports another from `src/components` or',
    '`src/screens` **and** uses it as a JSX tag. Importing a type or a helper out',
    'of a component file is not placement and is not counted. "On" in the second',
    'section follows those edges all the way down, so a row three components deep',
    'still names the screens it shows up on.',
    '',
    '## Screens',
    '',
    'What each screen puts on the page, directly. `src/screens/settings/` holds',
    'the sections SettingsGroupScreen composes, so those are listed as',
    'components below.',
    '',
  ];

  for (const s of screens) {
    const { shown, more } = listed([...(renders.get(s) || [])].map(name));
    lines.push(`- \`${s}\` — ${shown || '(no project components)'}${more}`);
  }

  lines.push('', '## Components', '', 'Where each component can appear.', '');

  for (const c of components) {
    const { shown, more, count } = listed(reachedFrom.get(c));
    lines.push(`- \`${c}\` — ${count ? `on ${shown}${more}` : 'not reached from any screen'}`);
  }

  lines.push('');
  return lines.join('\n');
}

const next = render();

if (process.argv.includes('--check')) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (current !== next) {
    console.error(
      'build-screen-map: docs/screen-map.md is out of date.\n' +
        'Run `node scripts/build-screen-map.js` and commit the result.'
    );
    process.exit(1);
  }
  console.log('build-screen-map: docs/screen-map.md is up to date.');
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, next);
  console.log(`build-screen-map: wrote ${path.relative(process.cwd(), outFile)}`);
}
