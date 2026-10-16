/**
 * Nothing in `src/` may spell out one of the shared button labels itself.
 *
 * `BUTTON_LABEL` (`src/copy/shared.ts`) is the one place "Cancel", "Delete",
 * "Done" and "Save" are written. A hand-typed copy typechecks and reads right,
 * but it is a second place to edit the next time the wording changes, and
 * "Cancel" alone had been typed out in 141 files. This reads the source, as
 * `noHandWrittenDiscard.test.ts` does, because there are no component tests to
 * catch it any other way.
 *
 * It parses rather than greps, because comments quote these words constantly
 * ("the same job as "Done" does") and a comment is not copy. A word in a type
 * position, an object key, a comparison or a `case` is not copy either, so it
 * is left alone. To share another word, add it to `BUTTON_LABEL` and every
 * hand-written use of it fails here until it is replaced.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseSync, traverse, types as t } from '@babel/core';
import { BUTTON_LABEL } from '../copy/shared';

const SRC = join(__dirname, '..');
const LABELS = new Set<string>(Object.values(BUTTON_LABEL));
const MENTIONS_A_LABEL = new RegExp([...LABELS].join('|'));

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suites are skipped: they quote a label as a literal to assert it.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

const files = sourceFiles(SRC)
  .map(f => ({ rel: f.slice(SRC.length + 1), path: f }))
  // The module that owns the words, and the generated patch notes, which are prose.
  .filter(f => !f.rel.startsWith('copy') && f.rel !== join('utils', 'patchNotesData.ts'));

/** `file:line` of every place `code` writes a shared label as copy. */
function handWritten(rel: string, code: string): string[] {
  // Most files never mention any of the four, and parsing is the slow part.
  if (!MENTIONS_A_LABEL.test(code)) return [];
  const ast = parseSync(code, {
    filename: rel,
    configFile: false,
    babelrc: false,
    sourceType: 'module',
    parserOpts: { plugins: rel.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] },
  });
  const found: string[] = [];
  if (!ast) return found;
  traverse(ast, {
    StringLiteral(p) {
      if (!LABELS.has(p.node.value)) return;
      const parent = p.parent;
      if (
        t.isImportDeclaration(parent) ||
        t.isExportNamedDeclaration(parent) ||
        t.isExportAllDeclaration(parent) ||
        t.isTSLiteralType(parent) ||
        t.isTSEnumMember(parent) ||
        t.isSwitchCase(parent) ||
        (t.isBinaryExpression(parent) && parent.operator !== '+') ||
        ((t.isObjectProperty(parent) || t.isObjectMethod(parent) || t.isClassProperty(parent)) &&
          parent.key === p.node &&
          !parent.computed)
      ) {
        return;
      }
      found.push(`${rel}:${p.node.loc?.start.line}`);
    },
    JSXText(p) {
      if (!LABELS.has(p.node.value.trim())) return;
      // "Delete {name}" is a sentence that happens to open with the word, so
      // only text that is the whole content of its element counts.
      const parent = p.parent as t.JSXElement | t.JSXFragment;
      const content = parent.children.filter(c => !(t.isJSXText(c) && c.value.trim() === ''));
      if (content.length === 1) found.push(`${rel}:${p.node.loc?.start.line}`);
    },
  });
  return found;
}

describe('hand-written shared button labels', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('are only ever written in src/copy/shared.ts', () => {
    const offenders = files.flatMap(f => handWritten(f.rel, readFileSync(f.path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('are found when they are there, and not when they only look like copy', () => {
    const code = [
      `export const a = { text: 'Cancel', style: 'cancel' };`,
      `export const b = <X label="Save">Done</X>;`,
      `export const quiet = { Delete: 1 } as { Delete: number }; // "Cancel" in a comment`,
      `export const sentence = <Y>Delete {name}</Y>;`,
      `export const kind = (x: 'Done' | 'Save') => (x === 'Done' ? 1 : 2);`,
    ].join('\n');
    expect(handWritten('probe.tsx', code)).toEqual(['probe.tsx:1', 'probe.tsx:2', 'probe.tsx:2']);
  });
});
