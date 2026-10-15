/**
 * A `SegmentedControl` change must not fire a haptic of its own.
 *
 * The control already taps when a segment is picked (and `SettingsSegments`
 * is that same control). A caller that taps again in its `onChange` stacks
 * two selection ticks on one pick, and that was 32 screens at once before
 * this test: it looks right in review, because a haptic in a handler is
 * normally exactly what the file around it does.
 *
 * Reads the source, like `noRawModal.test.ts`. An inline handler is checked
 * whole; a handler passed by name is checked from its declaration to the end
 * of its body, in the same file.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const CONTROLS = ['SegmentedControl', 'SettingsSegments'];
/** The props each control calls on a pick. */
const HANDLER_PROPS = ['onChange', 'onSelect'];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && entry.name.endsWith('.tsx')) found.push(full);
  }
  return found;
}

/** The JSX opening element starting at `start`, braces balanced. */
function openingElement(src: string, start: number): string {
  let depth = 0;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && (c === '>' || src.startsWith('/>', i))) return src.slice(start, i);
  }
  return src.slice(start);
}

/** The expression inside `prop={…}`, braces balanced, or null. */
function propExpression(element: string, prop: string): string | null {
  const m = new RegExp(`\\b${prop}=\\{`).exec(element);
  if (!m) return null;
  let depth = 1;
  const from = m.index + m[0].length;
  for (let i = from; i < element.length; i++) {
    if (element[i] === '{') depth++;
    else if (element[i] === '}' && --depth === 0) return element.slice(from, i).trim();
  }
  return null;
}

/**
 * A named handler's body: from its declaration to the brace that closes it.
 * Stops at a `;` before any `{`, so a value that isn't a function body (a
 * store setter, `const set = useStore(s => s.set);`) reads as no body at all.
 */
function namedBody(src: string, name: string): string | null {
  const decl = new RegExp(`(?:const|function)\\s+${name}\\b[^{;]*\\{`).exec(src);
  if (!decl) return null;
  let depth = 1;
  const from = decl.index + decl[0].length;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i);
  }
  return null;
}

interface Handler { file: string; line: number; expression: string; body: string }

function handlersIn(file: string, src: string): Handler[] {
  const found: Handler[] = [];
  for (const control of CONTROLS) {
    const tag = new RegExp(`<${control}\\b`, 'g');
    for (let m = tag.exec(src); m; m = tag.exec(src)) {
      const element = openingElement(src, m.index);
      for (const prop of HANDLER_PROPS) {
        const expression = propExpression(element, prop);
        if (!expression) continue;
        const named = /^[A-Za-z_$][\w$]*$/.test(expression) ? namedBody(src, expression) : null;
        found.push({
          file,
          line: src.slice(0, m.index).split('\n').length,
          expression,
          body: named ?? expression,
        });
      }
    }
  }
  return found;
}

const handlers = sourceFiles(SRC).flatMap(f => handlersIn(f.slice(SRC.length + 1), readFileSync(f, 'utf8')));

describe('SegmentedControl handlers', () => {
  it('finds a realistic number of them', () => {
    // Guards the scan: a broken pattern would pass the check below vacuously.
    expect(handlers.length).toBeGreaterThan(60);
  });

  it('reads a named handler through to its body', () => {
    const src = 'const pick = (v: string) => {\n  haptics.tap();\n  setV(v);\n};\n<SegmentedControl value={v} onChange={pick} />';
    const [h] = handlersIn('fixture.tsx', src);
    expect(h.body).toContain('haptics.tap()');
  });

  it('fires no haptic of their own, since the control already taps', () => {
    const offenders = handlers
      .filter(h => /\bhaptics\./.test(h.body))
      .map(h => `${h.file}:${h.line} ${h.expression.slice(0, 60)}`);
    expect(offenders).toEqual([]);
  });
});
