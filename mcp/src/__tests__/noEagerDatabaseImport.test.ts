/**
 * No static value import under `mcp/src` may reach `src/db/database.ts`.
 *
 * `database.ts` opens its database at module scope, so the server has to put
 * the expo-sqlite shim in Node's module cache before that module is evaluated
 * (the rule at the top of `replica.ts`). A static import is hoisted above the
 * shim: the real expo-sqlite loads, pulls in react-native, and the server
 * crashes on boot. Jest can't see it, because every test here mocks
 * expo-sqlite, and the deploy's esbuild guard can't either, because it only
 * checks that imports resolve. So it shipped once and took the server down
 * until it was traced by hand; this walk is the check that was missing.
 *
 * Reads source text on purpose, the same shape as `noRawModal.test.ts`. Only
 * static `import`/`export ... from` count: a `require` inside a function is
 * the sanctioned way to reach the app's modules, and `import type` is erased.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const MCP_SRC = join(ROOT, 'mcp', 'src');
const DATABASE = join(ROOT, 'src', 'db', 'database.ts');

const FROM = /^\s*(?:import|export)\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/gms;
const BARE = /^\s*import\s+['"]([^'"]+)['"]/gm;

/** The specifiers a file imports for their values. */
function valueImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(FROM)) {
    const clause = m[1].trim();
    if (/^type\b/.test(clause)) continue;
    const named = clause.match(/^\{([^}]*)\}$/);
    if (named && named[1].split(',').map(s => s.trim()).filter(Boolean).every(n => n.startsWith('type '))) continue;
    out.push(m[2]);
  }
  for (const m of src.matchAll(BARE)) out.push(m[1]);
  return out;
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null; // a package: none of them reach the app's db layer
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** The import chain from an mcp/src module to database.ts, or null when none exists. */
function chainToDatabase(): string[] | null {
  const starts = readdirSync(MCP_SRC).filter(f => /\.tsx?$/.test(f)).map(f => join(MCP_SRC, f));
  const prev = new Map<string, string | null>(starts.map(s => [s, null]));
  const queue = [...starts];
  while (queue.length) {
    const file = queue.shift()!;
    if (file === DATABASE) break;
    for (const spec of valueImports(readFileSync(file, 'utf8'))) {
      const next = resolveSpec(file, spec);
      if (!next || prev.has(next)) continue;
      prev.set(next, file);
      queue.push(next);
    }
  }
  if (!prev.has(DATABASE)) return null;
  const chain: string[] = [];
  for (let at: string | null | undefined = DATABASE; at; at = prev.get(at)) chain.unshift(relative(ROOT, at));
  return chain;
}

describe('mcp/src keeps database.ts out of its static imports', () => {
  it('reads value imports and skips type-only ones', () => {
    const src = [
      "import type { Task } from '../../src/types';",
      "import { type Task, type Category } from '../../src/types';",
      "import { addDays } from 'date-fns/addDays';",
      "import { a, type B } from '../../src/utils/a';",
      "export { c } from './c';",
      "import './side';",
    ].join('\n');
    expect(valueImports(src)).toEqual(['date-fns/addDays', '../../src/utils/a', './c', './side']);
  });

  it('would find database.ts if a module imported it', () => {
    // The walk's own target is there and spelled as the resolver spells it.
    expect(resolveSpec(join(MCP_SRC, 'replica.ts'), '../../src/db/database')).toBe(DATABASE);
  });

  it('finds no chain from an mcp/src module to database.ts', () => {
    expect(chainToDatabase()).toBeNull();
  });
});
