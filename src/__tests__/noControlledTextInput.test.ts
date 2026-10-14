/**
 * No `TextInput` may be given `value=`; a field that takes a value is a
 * `TextField` (`src/components/TextField.tsx`).
 *
 * A controlled `TextInput` echoes every keystroke back into the native field,
 * and on iOS that echo can land the caret somewhere else mid-word ("rutabaga"
 * typed into quick add came out "utabagar"). `TextField` takes the same props
 * and writes into the field only when `value` says something the field didn't.
 * `src/utils/textFieldSync.ts` has the mechanism.
 *
 * Checked mechanically for the reason `noRawModal` is: `<TextInput value=…>`
 * is what anyone reaches for, it typechecks, and the bug only shows on a
 * device, intermittently. This parses the JSX rather than pattern-matching it,
 * because an attribute holding an arrow function has a `>` in it.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse } from '@babel/parser';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx$/.test(entry.name)) found.push(full);
  }
  return found;
}

type Node = { type?: string; [key: string]: unknown };

/**
 * Line numbers of every `<element>` whose `value` attribute is present
 * (`wantValue`) or missing. A spread counts as possibly carrying one.
 */
function elementsByValue(src: string, element: string, wantValue: boolean): number[] {
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const hits: number[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Node;
    if (n.type === 'JSXOpeningElement') {
      const name = n.name as Node & { name?: string };
      const attrs = n.attributes as (Node & { name?: { name?: string } })[];
      const hasValue = attrs.some(a =>
        a.type === 'JSXSpreadAttribute'
        || (a.type === 'JSXAttribute' && (a.name?.name === 'value' || a.name?.name === 'defaultValue')));
      const hasPlainValue = attrs.some(a => a.type === 'JSXAttribute' && a.name?.name === 'value');
      if (name.type === 'JSXIdentifier' && name.name === element
        && (wantValue ? hasPlainValue : !hasValue)) {
        hits.push((n.loc as { start: { line: number } }).start.line);
      }
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === 'loc' || key.endsWith('Comments')) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && 'type' in value) visit(value);
    }
  };
  visit(ast.program);
  return hits;
}

const controlledTextInputs = (src: string) => elementsByValue(src, 'TextInput', true);
const textFieldsWithoutValue = (src: string) => elementsByValue(src, 'TextField', false);

const files = sourceFiles(SRC)
  .filter(f => !f.endsWith(join('components', 'TextField.tsx')))
  .map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

it('scans the components and screens', () => {
  expect(files.length).toBeGreaterThan(100);
});

it('catches a controlled TextInput, including one with an arrow function before value', () => {
  expect(controlledTextInputs('const a = <TextInput onChangeText={t => set(t)} value={v} />;')).toEqual([1]);
  expect(controlledTextInputs('const a = <TextInput defaultValue={v} />;')).toEqual([]);
  expect(controlledTextInputs('const a = <TextField value={v} />;')).toEqual([]);
});

it('has no TextInput given a value; use TextField', () => {
  const offenders = files.flatMap(f => controlledTextInputs(f.src).map(line => `${f.rel}:${line}`));
  expect(offenders).toEqual([]);
});

it('catches a TextField with no value', () => {
  expect(textFieldsWithoutValue('const a = <TextField onChangeText={t => set(t)} />;')).toEqual([1]);
  expect(textFieldsWithoutValue('const a = <TextField value={v} />;')).toEqual([]);
  expect(textFieldsWithoutValue('const a = <TextField {...input} />;')).toEqual([]);
});

/**
 * `TextField` reads a missing `value` as `''`, so after the first keystroke the
 * field differs from what React says it holds and the next render writes `''`
 * back: the field can't be typed into. The scan sheet's Brand and Flavor boxes
 * shipped this way. A field that wants no initial text passes `value=""`-style
 * state like any other; `defaultValue` is the uncontrolled form.
 */
it('has no TextField without a value or defaultValue', () => {
  const offenders = files.flatMap(f => textFieldsWithoutValue(f.src).map(line => `${f.rel}:${line}`));
  expect(offenders).toEqual([]);
});
