/**
 * A `TextInput`/`TextField` on a number, decimal or phone pad must name an
 * `inputAccessoryViewID`.
 *
 * iOS's number pads have no return key, so `returnKeyType="done"` does nothing
 * there and the only way to put the keyboard away is the bar `NumberPadAccessory`
 * draws above it. A field that doesn't name one has no way to say it is finished
 * short of tapping outside it. Several sheets shipped this way (the rewards
 * price fields, the medication amount, the max heart rate card).
 *
 * Checked on the JSX like `noControlledTextInput`: the prop typechecks without
 * the id, and the gap only shows on a device.
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
type Attr = Node & { name?: { name?: string }; value?: Node & { value?: string } };

const NUMERIC_PADS = new Set(['number-pad', 'decimal-pad', 'phone-pad', 'numeric']);

/** Line numbers of every field on a numeric keyboard that names no accessory bar. */
function padsWithoutAccessory(src: string): number[] {
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const hits: number[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Node;
    if (n.type === 'JSXOpeningElement') {
      const name = n.name as Node & { name?: string };
      const attrs = n.attributes as Attr[];
      const isField = name.type === 'JSXIdentifier' && (name.name === 'TextInput' || name.name === 'TextField');
      const keyboard = attrs.find(a => a.type === 'JSXAttribute' && a.name?.name === 'keyboardType');
      const numeric = !!keyboard && NUMERIC_PADS.has(String(keyboard.value?.value ?? ''));
      // A spread may carry the id, so it gets the benefit of the doubt.
      const named = attrs.some(a =>
        a.type === 'JSXSpreadAttribute' || (a.type === 'JSXAttribute' && a.name?.name === 'inputAccessoryViewID'));
      if (isField && numeric && !named) hits.push((n.loc as { start: { line: number } }).start.line);
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

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

it('scans the components and screens', () => {
  expect(files.length).toBeGreaterThan(100);
});

it('catches a number pad with no accessory id', () => {
  expect(padsWithoutAccessory('const a = <TextField keyboardType="decimal-pad" value={v} />;')).toEqual([1]);
  expect(padsWithoutAccessory('const a = <TextInput keyboardType="number-pad" inputAccessoryViewID={ID} />;')).toEqual([]);
  expect(padsWithoutAccessory('const a = <TextField keyboardType="url" value={v} />;')).toEqual([]);
  expect(padsWithoutAccessory('const a = <TextField {...input} keyboardType="phone-pad" />;')).toEqual([]);
});

it('has no number pad without an accessory bar; pass inputAccessoryViewID and mount NumberPadAccessory', () => {
  const offenders = files.flatMap(f => padsWithoutAccessory(f.src).map(line => `${f.rel}:${line}`));
  expect(offenders).toEqual([]);
});
