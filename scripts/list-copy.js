#!/usr/bin/env node
// Lists the words the app shows, so copy can be found and compared without
// opening 340 files.
//
// Copy lives next to the code that shows it (a `hint` on the row it explains,
// an alert beside the action that raises it), which is the right place for a
// sentence used once and the wrong place for finding "every way we say a save
// failed". This reads the tree and answers that question instead of moving the
// strings: nothing here edits a source file.
//
// Not a generated doc and not checked in CI, on purpose. The output is several
// thousand lines, it changes with almost every PR, and a committed copy would
// be one more thing that turns a PR red. Run it when you want the answer.
//
//   npm run copy                      the report: totals, what is repeated,
//                                     what is written several ways
//   npm run copy -- --grep "taken"    every string matching a regex, with file:line
//   npm run copy -- --all             the whole inventory, grouped by text
//   npm run copy -- --json            the raw entries, for another tool
//   --kind prefix[,prefix]            limit to kinds (text, prop, alert, field,
//                                     literal, error, long)
//   --min N                           "repeated" means in N or more files (default 4)
//   --top N                           rows per report section (default 25)
//
// What it reads: JSX text, string props on JSX (`label`, `hint`, `title`,
// `accessibilityLabel` and the rest of COPY_PROPS, plus any prop holding a
// sentence), `Alert.alert` titles, messages and buttons, object fields named
// like a copy prop (`{ label: 'Today' }`), sentence-like string literals in
// the logic layer, and `new Error(...)` messages. A template literal is shown
// with `{}` where a value goes, so "3 tasks left" and "5 tasks left" are one
// row.
//
// What it cannot see: copy built by a function call at the call site, the
// Swift targets, `app.json`'s permission strings and `mcp/`. It also cannot
// tell a sentence in a model prompt from one on screen; those land in the
// `long` kind so they stay out of the way. Treat a count as "about this many".
//
// Parsed with Babel rather than the TypeScript compiler API, because the
// compiler no longer exposes one from `require('typescript')` as of TS 7.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const babel = require('@babel/core');

const t = babel.types;
const root = path.join(__dirname, '..');

// ==== options ================================================================

const argv = process.argv.slice(2);
const has = name => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const MIN_FILES = Number(opt('min', 4));
const TOP = Number(opt('top', 25));
const KIND_FILTER = opt('kind', '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ==== what counts as copy ====================================================

// A JSX prop with one of these names is copy whatever it holds, one word
// included ("Today"). Any other prop counts only when it holds a sentence.
const COPY_PROPS = new Set([
  'title', 'label', 'subtitle', 'hint', 'placeholder', 'footer', 'header', 'caption', 'overline',
  'message', 'description', 'summary', 'heading', 'note', 'text', 'body', 'detail', 'tooltip',
  'accessibilityLabel', 'accessibilityHint', 'backAccessibilityLabel', 'dismissAccessibilityLabel',
  'filterPlaceholder', 'actionLabel', 'openLabel', 'moreLabel', 'emptyLabel', 'editorLabel',
  'emptyText', 'emptyTitle', 'emptySubtitle', 'emptySummary', 'dragHint', 'deniedHint', 'lockedHint',
]);

// Props that hold identifiers or values, never words a person reads.
const NOT_COPY_PROPS = new Set([
  'testID', 'key', 'ref', 'style', 'name', 'icon', 'color', 'source', 'uri', 'href', 'url', 'id',
  'keyboardType', 'autoCapitalize', 'returnKeyType', 'textContentType', 'accessibilityRole',
  'resizeMode', 'mode', 'size', 'variant', 'look', 'role', 'kind', 'type', 'value', 'format',
]);

// Object fields named like a copy prop: `{ label: 'Today' }` in a table of rows.
const FIELD_KEYS = new Set([
  'title', 'label', 'subtitle', 'hint', 'placeholder', 'message', 'description', 'summary',
  'heading', 'text', 'emptyText', 'emptyTitle', 'emptySubtitle', 'actionLabel',
]);

const ERROR_CTORS = new Set(['Error', 'TypeError', 'RangeError']);

const hasLetters = s => /\p{L}{2}/u.test(s);
const wordCount = s => s.split(/\s+/).filter(Boolean).length;
const SQL_START = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WITH|BEGIN|COMMIT|REPLACE)\b/;
// A date-fns pattern ('MMM d', 'EEEE, MMMM d') is made only of format letters.
const DATE_PATTERN = /^[yMdEHhmsaAQwLDoSzZ' ,:/.\-[\]]+$/;

// A string in the logic layer reads as a sentence, as opposed to an id, a key,
// a path or a format. Strict on purpose: a miss costs one row, a false hit
// costs a reader's trust in the whole report.
function isSentence(text) {
  return (
    wordCount(text) >= 2 &&
    /^[A-Z]/.test(text) &&
    /[a-z]{3,}/.test(text) &&
    !SQL_START.test(text) &&
    !DATE_PATTERN.test(text) &&
    !/:\/\//.test(text)
  );
}

// ==== reading the tree =======================================================

const ls = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const files = (ls.stdout || '')
  .split('\0')
  .filter(Boolean)
  .filter(
    rel =>
      /\.tsx?$/.test(rel) &&
      !rel.endsWith('.d.ts') &&
      (rel === 'App.tsx' || rel.startsWith('src/')) &&
      !/(^|\/)(__tests__|__bench__|patchNotes)\//.test(rel) &&
      rel !== 'src/utils/patchNotesData.ts',
  )
  .sort();

const entries = [];
const unparsed = [];

const clean = s => s.replace(/\s+/g, ' ').trim();

// The text of a string-ish expression, `{}` standing for anything computed,
// or null when it is not made of text at all.
function textOf(node) {
  if (!node) return null;
  switch (node.type) {
    case 'StringLiteral':
      return node.value;
    case 'TemplateLiteral':
      return node.quasis.reduce((acc, q, i) => acc + (i ? '{}' : '') + (q.value.cooked ?? q.value.raw), '');
    case 'BinaryExpression': {
      if (node.operator !== '+') return null;
      const l = textOf(node.left);
      const r = textOf(node.right);
      if (l === null && r === null) return null;
      return (l ?? '{}') + (r ?? '{}');
    }
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      return textOf(node.expression);
    default:
      return null;
  }
}

// Every text an expression can evaluate to: both sides of a ternary, the
// fallback of `a || 'x'`. Each comes with the node to mark as read.
function textsIn(node) {
  if (!node) return [];
  switch (node.type) {
    case 'ConditionalExpression':
      return [...textsIn(node.consequent), ...textsIn(node.alternate)];
    case 'LogicalExpression':
      return [...textsIn(node.left), ...textsIn(node.right)];
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      return textsIn(node.expression);
    default: {
      const text = textOf(node);
      return text === null ? [] : [{ text, node }];
    }
  }
}

function scan(rel) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  let ast;
  try {
    ast = babel.parseSync(code, {
      filename: rel,
      configFile: false,
      babelrc: false,
      sourceType: 'module',
      parserOpts: { plugins: rel.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] },
    });
  } catch (e) {
    unparsed.push(`${rel}: ${String(e.message).split('\n')[0]}`);
    return;
  }

  const read = new Set(); // nodes already listed under a more specific kind
  const add = (kind, raw, node) => {
    read.add(node);
    const text = clean(raw);
    if (!hasLetters(text)) return;
    const long = (kind === 'literal' || kind === 'error') && (raw.includes('\n') || text.length > 240);
    entries.push({ kind: long ? 'long' : kind, text, file: rel, line: node.loc ? node.loc.start.line : 0 });
  };

  // `Alert.alert(TITLE, ...)` where TITLE is a const in this file: follow it.
  const resolve = (path, node) => {
    if (!t.isIdentifier(node)) return node;
    const binding = path.scope.getBinding(node.name);
    const decl = binding && binding.path.node;
    return t.isVariableDeclarator(decl) && decl.init ? decl.init : node;
  };

  babel.traverse(ast, {
    JSXText(p) {
      const text = clean(p.node.value);
      if (text) add('text', text, p.node);
    },

    JSXExpressionContainer(p) {
      if (t.isJSXAttribute(p.parent)) return; // the attribute reads its own value
      for (const { text, node } of textsIn(p.node.expression)) add('text', text, node);
    },

    JSXAttribute(p) {
      if (!t.isJSXIdentifier(p.node.name)) return;
      const name = p.node.name.name;
      if (NOT_COPY_PROPS.has(name)) return;
      const value = p.node.value;
      const found = t.isJSXExpressionContainer(value) ? textsIn(value.expression) : t.isStringLiteral(value) ? [{ text: value.value, node: value }] : [];
      for (const { text, node } of found) {
        if (COPY_PROPS.has(name) || isSentence(clean(text))) add(`prop:${name}`, text, node);
      }
    },

    CallExpression(p) {
      const c = p.node.callee;
      if (!(t.isMemberExpression(c) && t.isIdentifier(c.object, { name: 'Alert' }) && t.isIdentifier(c.property))) return;
      const [title, message, buttons] = p.node.arguments;
      for (const { text, node } of textsIn(resolve(p, title))) add('alert:title', text, node);
      for (const { text, node } of textsIn(resolve(p, message))) add('alert:message', text, node);
      const list = resolve(p, buttons);
      if (t.isArrayExpression(list)) {
        for (const el of list.elements) {
          if (!t.isObjectExpression(el)) continue;
          for (const prop of el.properties) {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key, { name: 'text' })) {
              for (const { text, node } of textsIn(prop.value)) add('alert:button', text, node);
            }
          }
        }
      }
    },

    NewExpression(p) {
      if (!(t.isIdentifier(p.node.callee) && ERROR_CTORS.has(p.node.callee.name))) return;
      for (const { text, node } of textsIn(p.node.arguments[0])) {
        if (isSentence(clean(text))) add('error', text, node);
      }
    },

    ObjectProperty(p) {
      const key = p.node.key;
      const name = t.isIdentifier(key) && !p.node.computed ? key.name : t.isStringLiteral(key) ? key.value : null;
      if (!name || !FIELD_KEYS.has(name)) return;
      for (const { text, node } of textsIn(p.node.value)) add(`field:${name}`, text, node);
    },

    // Everything else: a sentence-like literal in the logic layer.
    'StringLiteral|TemplateLiteral'(p) {
      if (read.has(p.node)) return;
      const parent = p.parent;
      if (
        t.isImportDeclaration(parent) ||
        t.isExportNamedDeclaration(parent) ||
        t.isExportAllDeclaration(parent) ||
        t.isTSLiteralType(parent) ||
        t.isTSEnumMember(parent) ||
        t.isJSXAttribute(parent) ||
        t.isSwitchCase(parent) ||
        (t.isObjectProperty(parent) && parent.key === p.node && !parent.computed) ||
        (t.isBinaryExpression(parent) && parent.operator !== '+') ||
        (t.isCallExpression(parent) && t.isMemberExpression(parent.callee) && t.isIdentifier(parent.callee.object, { name: 'console' }))
      ) {
        return;
      }
      // A template inside a larger concatenation is read as a whole by textOf's
      // parent, but the parent is not visited as a literal, so read it here.
      const text = textOf(p.node);
      if (text !== null && isSentence(clean(text))) add('literal', text, p.node);
    },
  });
}

for (const rel of files) scan(rel);

// ==== filtering and grouping =================================================

const shown = KIND_FILTER.length ? entries.filter(e => KIND_FILTER.some(k => e.kind.startsWith(k))) : entries;

// The report is about what a person reads. A `long` string is nearly always a
// model prompt, and an `error` mostly never reaches a screen; both stay in
// --all, --grep and --json, and out of the comparisons unless asked for.
const READ = e => !['long', 'error'].includes(e.kind);
const forReport = KIND_FILTER.length ? shown : shown.filter(READ);

// Loose key: what two spellings of one string have in common.
const loose = s =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function groupBy(list, keyOf) {
  const map = new Map();
  for (const e of list) {
    const k = keyOf(e);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

const fileCount = list => new Set(list.map(e => e.file)).size;
const where = (list, max = 3) => {
  const spots = [...new Set(list.map(e => `${e.file.replace(/^src\//, '')}:${e.line}`))];
  return spots.slice(0, max).join(', ') + (spots.length > max ? `, +${spots.length - max} more` : '');
};
const kinds = list => [...new Set(list.map(e => e.kind.replace(/:.*/, '')))].join('/');
const pad = (n, w) => String(n).padStart(w, ' ');

// Output goes through a function that returns, not process.exit(): exiting
// right after a large write to a pipe cuts the output off at the pipe's
// buffer, which `npm run copy -- --all | head` or `--json | node` would hit.
function run() {
  // ==== modes ==================================================================

  if (has('json')) {
    process.stdout.write(JSON.stringify(shown, null, 1) + '\n');
    return;
  }

  const grep = opt('grep', null);
  if (grep !== null) {
    let re;
    try {
      re = new RegExp(grep, 'i');
    } catch (e) {
      console.error(`--grep: ${e.message}`);
      process.exitCode = 2;
      return;
    }
    const hits = shown.filter(e => re.test(e.text)).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    for (const e of hits) console.log(`${e.file}:${e.line}  [${e.kind}]  ${e.text}`);
    console.log(`\n${hits.length} match${hits.length === 1 ? '' : 'es'} in ${fileCount(hits)} file${fileCount(hits) === 1 ? '' : 's'}.`);
    return;
  }

  if (has('all')) {
    const groups = [...groupBy(shown, e => e.text)].sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
    for (const [text, list] of groups) console.log(`${text}\n    ${kinds(list)} · ${list.length}× · ${where(list, 4)}`);
    console.log(`\n${shown.length} strings, ${groups.length} distinct.`);
    return;
  }

  // ==== the report =============================================================

  const out = [];
  const section = title => out.push('', title, '='.repeat(title.length));

  const distinct = new Set(forReport.map(e => e.text)).size;
  out.push(`Copy inventory: ${forReport.length} strings, ${distinct} distinct, across ${fileCount(forReport)} of ${files.length} files.`);

  const unread = shown.length - forReport.length;
  section('By kind');
  const byKind = groupBy(forReport, e => e.kind.replace(/:.*/, ''));
  for (const [k, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`${pad(list.length, 6)}  ${k.padEnd(8)} ${new Set(list.map(e => e.text)).size} distinct`);
  }
  if (unread) out.push(`${pad(unread, 6)}  not counted: model prompts and long passages (long), error messages (error); see --kind long,error`);
  const byArea = groupBy(forReport, e => e.file.split('/').slice(0, 2).join('/'));
  out.push('');
  for (const [k, list] of [...byArea].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    out.push(`${pad(list.length, 6)}  ${k}`);
  }

  section(`Written out in ${MIN_FILES}+ files`);
  out.push('One word or sentence copied by hand into many files. These are the candidates for a shared constant.');
  out.push('');
  const exact = groupBy(forReport, e => e.text);
  // A lowercase string ("of", "more") is the middle of a sentence, not a label.
  const repeated = [...exact]
    .filter(([text, list]) => fileCount(list) >= MIN_FILES && /^[^a-z]/.test(text))
    .sort((a, b) => fileCount(b[1]) - fileCount(a[1]));
  for (const [text, list] of repeated.slice(0, TOP)) out.push(`${pad(fileCount(list), 4)} files  ${JSON.stringify(text)}  (${kinds(list)})`);
  if (repeated.length > TOP) out.push(`  … ${repeated.length - TOP} more (--top ${repeated.length})`);

  section('Written more than one way');
  out.push('The same words spelled differently: title case against sentence case, a straight or curly apostrophe, a trailing period.');
  out.push('');
  // A mid-sentence fragment ("done") and a section header typed in capitals
  // ("NAME") differ from the label only by role, so they are not drift. What is
  // left is spelling: title case against sentence case, an apostrophe, a period.
  const isLabelCase = text => text !== text.toLowerCase() && text !== text.toUpperCase();
  const looseGroups = [...groupBy(forReport, e => loose(e.text))]
    .map(([key, list]) => {
      const variants = groupBy(list.filter(e => isLabelCase(e.text)), e => e.text);
      return [key, [...variants.values()].flat(), variants];
    })
    .filter(([, , variants]) => variants.size > 1)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [, , variants] of looseGroups.slice(0, TOP)) {
    const rows = [...variants].sort((a, b) => b[1].length - a[1].length);
    out.push(rows.map(([text, list]) => `${JSON.stringify(text)} ×${list.length}`).join('   vs   '));
    out.push(`      e.g. ${where(rows.flatMap(r => r[1]), 3)}`);
  }
  if (looseGroups.length > TOP) out.push(`  … ${looseGroups.length - TOP} more (--top ${looseGroups.length})`);
  if (looseGroups.length === 0) out.push('None.');

  // The app writes its apostrophes curly (’). A straight one in a sentence is
  // an outlier that no spelling group catches, because nothing else is spelled
  // the same way. Brand names in the demo seed and the text sent to the model
  // are not the app's own voice, so they are left out.
  const NOT_OWN_VOICE = /^src\/(utils\/demoSeed|services\/aiSuggestions)\.ts$/;
  const straight = forReport.filter(e => /[A-Za-z]'[a-z]/.test(e.text) && !NOT_OWN_VOICE.test(e.file));
  const curly = forReport.filter(e => /[A-Za-z]\u2019[a-z]/.test(e.text)).length;
  section('Straight apostrophes');
  out.push(`The app writes \u2019 (${curly} strings). These use ' instead.`);
  out.push('');
  if (straight.length === 0) out.push('None.');
  for (const e of straight.slice(0, TOP)) out.push(`${e.file.replace(/^src\//, '')}:${e.line}  ${JSON.stringify(e.text.slice(0, 80))}`);
  if (straight.length > TOP) out.push(`  \u2026 ${straight.length - TOP} more (--top ${straight.length})`);

  // Families: different words for one idea. Each is a rule of thumb for "these
  // are all the same kind of message", bucketed by how they open, so a title
  // that starts "Couldn't" sits apart from one that starts "Failed to". Add one
  // here when a pass over --grep turns up another idea said several ways.
  const FAMILIES = [
    {
      label: 'A save or load that failed',
      test: /^(couldn['’]t|could not|can['’]t|cannot|unable to|failed to|didn['’]t|did not)\b|\b(failed|unavailable)$/i,
      bucket: s => (/\b(failed|unavailable)$/i.test(s) ? '… failed / unavailable' : s.split(/\s+/).slice(0, 2).join(' ')),
      kinds: ['alert:title', 'alert:message', 'literal', 'prop', 'field'],
    },
    {
      label: 'A name that is already used',
      test: /\b(is taken|already (used|exists|in use|taken))\b/i,
      bucket: s => s,
      kinds: ['alert', 'literal', 'prop', 'field'],
    },
    {
      label: 'A button that ends or declines something',
      test: /^(cancel|close|dismiss|discard|delete|remove|clear|not now|later|skip|no thanks|nevermind|never mind|keep editing|keep|stay|got it|ok|okay|done)$/i,
      bucket: s => s,
      kinds: ['alert:button', 'prop:label', 'prop:title', 'prop:actionLabel', 'prop:text', 'field', 'text'],
    },
    {
      label: 'Sending the person to Settings',
      test: /\b(open settings|go to settings|settings app)\b/i,
      bucket: s => s,
      kinds: ['alert', 'literal', 'prop', 'field', 'text'],
    },
    {
      label: 'An empty list (short lines opening "No" or "Nothing")',
      test: /^(no|nothing)\b.{0,40}$/i,
      // The shape, not the noun: "No tasks yet" and "No recipes yet" are one
      // wording, and "Nothing here yet" is another.
      bucket: s => {
        const words = s.split(/\s+/);
        const last = words[words.length - 1].toLowerCase().replace(/[.…]+$/, '');
        return `${words[0]} … ${['yet', 'here', 'found', 'left', 'selected', 'today', 'matches'].includes(last) ? last : ''}`.trim();
      },
      kinds: ['prop', 'field', 'text'],
    },
  ];

  for (const fam of FAMILIES) {
    const pool = forReport.filter(e => fam.kinds.some(k => e.kind.startsWith(k)) && fam.test.test(e.text));
    section(fam.label);
    if (pool.length === 0) {
      out.push('None found.');
      continue;
    }
    const buckets = [...groupBy(pool, e => loose(fam.bucket(clean(e.text))))].sort((a, b) => b[1].length - a[1].length);
    out.push(`${pool.length} strings in ${buckets.length} wordings.`);
    out.push('');
    for (const [bucket, list] of buckets.slice(0, TOP)) {
      const sample = [...new Set(list.map(e => e.text))].slice(0, 2).map(s => JSON.stringify(s)).join(', ');
      out.push(`${pad(list.length, 4)}×  ${bucket.padEnd(28)} ${sample}`);
    }
    if (buckets.length > TOP) out.push(`  … ${buckets.length - TOP} more wordings (--top ${buckets.length})`);
  }

  out.push('', 'Find one: npm run copy -- --grep "<regex>"   See all: npm run copy -- --all');
  if (unparsed.length) {
    out.push('', `Could not parse ${unparsed.length} file${unparsed.length === 1 ? '' : 's'} (their copy is missing above):`);
    for (const u of unparsed.slice(0, 10)) out.push(`  ${u}`);
  }
  console.log(out.join('\n'));
}

run();
