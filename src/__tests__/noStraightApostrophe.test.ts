/**
 * Copy the app shows uses a curly apostrophe (’), never a straight one (').
 *
 * Nearly a thousand strings already do, and the straight ones were never a
 * decision: they crept in one at a time, from a double-quoted string or a
 * template literal where typing ' is easier, until fourteen sat in hints,
 * accessibility labels and an alert. `npm run copy` reports them, but nobody
 * runs it before every PR, so the check has to fail the build instead.
 *
 * It reads every string literal, template literal and JSX text in `src/` and
 * flags a ' between two letters ("isn't", "today's"). Left alone, because
 * nobody reads them on screen: text sent to the model and the demo seed's
 * brand names (the same two files `npm run copy` leaves out), error and
 * console messages, SQL, and the few words matched against what a person
 * types rather than shown to them (`MATCHED_AGAINST_INPUT`).
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse } from '@babel/parser';
import * as t from '@babel/types';

const SRC = join(__dirname, '..');

/** Not the app's own voice: prompts for the model, and the demo seed. */
const NOT_OWN_VOICE = new Set([join('services', 'aiSuggestions.ts'), join('utils', 'demoSeed.ts')]);

/**
 * Words compared with typed input, never displayed. A person types a straight
 * apostrophe as often as a curly one, so these keep the straight spelling.
 */
const MATCHED_AGAINST_INPUT = new Set([
  "it's", // parseTaskInput's WAITING_STOPWORDS
  "don't do", // a settings search keyword (settingsIndex.ts)
]);

const STRAIGHT = /[A-Za-z]'[a-z]/;
const SQL_START = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WITH|BEGIN|COMMIT|REPLACE)\b/;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !['__tests__', '__bench__', 'patchNotes'].includes(entry.name)) sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && entry.name !== 'patchNotesData.ts') {
      found.push(full);
    }
  }
  return found;
}

/** `new Error(...)`, `throw ...` or `console.x(...)`: a message for a developer. */
function isDeveloperMessage(node: t.Node): boolean {
  if (t.isThrowStatement(node)) return true;
  if (t.isNewExpression(node) && t.isIdentifier(node.callee) && /Error$/.test(node.callee.name)) return true;
  return t.isCallExpression(node) && t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.object, { name: 'console' });
}

function textOf(node: t.Node): string | null {
  if (t.isStringLiteral(node) || t.isJSXText(node)) return node.value;
  // A template literal is read whole, each `${…}` standing in as a letter, so
  // the ' in `${name}'s birthday` is between two letters the way the screen
  // shows it. Read piece by piece, that piece starts with the ' and slipped by.
  if (t.isTemplateLiteral(node)) return node.quasis.map(q => q.value.cooked ?? '').join('x');
  return null;
}

/** Every string in `code` that shows a straight apostrophe, as `line: text`. */
function straightApostrophes(code: string, tsx: boolean): string[] {
  // Most files have no ' between letters anywhere, comments included.
  if (!STRAIGHT.test(code)) return [];
  const ast = parse(code, { sourceType: 'module', plugins: tsx ? ['typescript', 'jsx'] : ['typescript'] });
  const found: string[] = [];
  // A plain walk rather than @babel/traverse, which is several times slower
  // over the whole tree and offers nothing this needs.
  const walk = (node: t.Node, quiet: boolean): void => {
    const text = textOf(node);
    if (text && STRAIGHT.test(text) && !quiet && !MATCHED_AGAINST_INPUT.has(text) && !SQL_START.test(text.trim())) {
      found.push(`${node.loc?.start.line}: ${text.trim().slice(0, 80)}`);
    }
    const childQuiet = quiet || isDeveloperMessage(node);
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(c => c && typeof c === 'object' && walk(c as t.Node, childQuiet));
      else if (child && typeof child === 'object' && 'type' in child) walk(child as t.Node, childQuiet);
    }
  };
  walk(ast.program, false);
  return found;
}

describe('straight apostrophes in copy', () => {
  const files = sourceFiles(SRC);

  it('scans a realistic number of files', () => {
    // A broken walk would make the real check below pass against nothing.
    expect(files.length).toBeGreaterThan(500);
  });

  it('finds one in each kind of string, and leaves the exempt ones alone', () => {
    // Guards the detector itself, so the real check can't go quietly vacuous.
    const sample = [
      'const a = "Isn\'t it";',
      'const b = `Today\'s ${x}`;',
      'const g = `${name}\'s birthday`;',
      'const c = <Text>Don\'t</Text>;',
      'const d = "Isn’t it";',
      'throw new Error("isn\'t synced");',
      'console.error(`can\'t present`);',
      'const e = new Set(["it\'s"]);',
      'const f = `PRAGMA x; -- it\'s fine`;',
    ].join('\n');
    expect(straightApostrophes(sample, true)).toEqual(["1: Isn't it", "2: Today's x", "3: x's birthday", "4: Don't"]);
  });

  it('has none in src/', () => {
    const offenders = files
      .filter(f => !NOT_OWN_VOICE.has(f.slice(SRC.length + 1)))
      .flatMap(f => straightApostrophes(readFileSync(f, 'utf8'), f.endsWith('.tsx')).map(hit => `${f.slice(SRC.length + 1)}:${hit}`));
    // Write ’ instead (Option-Shift-] on a Mac). A word matched against typed
    // input rather than shown goes in MATCHED_AGAINST_INPUT.
    expect(offenders).toEqual([]);
  });
});
