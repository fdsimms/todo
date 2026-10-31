/**
 * No `<TextInput>` in JSX outside `TextField` itself.
 *
 * `TextField` is where a field's Done above the keyboard is decided
 * (`src/utils/keyboardDone.ts`): the shared accessory for a single-line field,
 * a floating button for a multiline one. A bare `TextInput` has neither, so it
 * is a keyboard with no way to put it away short of finding a safe place to tap.
 * A field that doesn't want one passes `dismissBar={false}`.
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

function bareTextInputs(src: string): number[] {
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const hits: number[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Node;
    if (n.type === 'JSXOpeningElement') {
      const name = n.name as Node & { name?: string };
      if (name.type === 'JSXIdentifier' && name.name === 'TextInput') {
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

const files = sourceFiles(SRC)
  .filter(f => !f.endsWith(join('components', 'TextField.tsx')))
  .map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

it('scans the components and screens', () => {
  expect(files.length).toBeGreaterThan(100);
});

it('catches a bare TextInput', () => {
  expect(bareTextInputs('const a = <TextInput placeholder="x" />;')).toEqual([1]);
  expect(bareTextInputs('const a = <TextField placeholder="x" />;')).toEqual([]);
});

it('has no bare TextInput; use TextField so the field gets a Done above its keyboard', () => {
  const offenders = files.flatMap(f => bareTextInputs(f.src).map(line => `${f.rel}:${line}`));
  expect(offenders).toEqual([]);
});
