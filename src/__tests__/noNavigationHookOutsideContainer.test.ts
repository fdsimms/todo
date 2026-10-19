/**
 * Nothing mounted outside `NavigationContainer` may reach a navigation hook.
 *
 * `useKeyboardInsetScroll` calls `useIsFocused`, so every `EditorSheet`,
 * `ScrollView` sheet and list that uses it needs a navigation object. A
 * component hosted beside the container in `AppNavigator` that renders one,
 * however deep, throws "Couldn't find a navigation object" the first time it
 * mounts, which shipped as a crash on Log as cooked (CookRecap, via
 * CookwareWeighIn, via CookwareSheet, via EditorSheet).
 *
 * This reads source rather than the module graph, like `noRawModal.test.ts`:
 * it takes each component rendered after `</NavigationContainer>` and follows
 * its relative imports looking for a hook that needs the container.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

const SRC = join(__dirname, '..');
const NAVIGATOR = join(SRC, 'navigation', 'AppNavigator.tsx');
const NEEDS_CONTAINER = /\b(useNavigation|useIsFocused|useRoute|useFocusEffect|useKeyboardInsetScroll)\s*\(/;

function resolveImport(from: string, spec: string): string | null {
  const base = join(dirname(from), spec);
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function relativeImports(file: string, source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/(?:import|export)[^;]*?from\s*'(\.[^']*)'/g)) {
    const resolved = resolveImport(file, m[1]);
    if (resolved) found.push(resolved);
  }
  return found;
}

/** The first file in `entry`'s import closure that calls a container hook, with the chain to it. */
function findOffender(entry: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const here = [...chain, file.slice(SRC.length + 1)];
    if (NEEDS_CONTAINER.test(source)) return here;
    for (const next of relativeImports(file, source)) {
      const hit = walk(next, here);
      if (hit) return hit;
    }
    return null;
  };
  return walk(entry, []);
}

const navigatorSource = readFileSync(NAVIGATOR, 'utf8');
const closeAt = navigatorSource.indexOf('</NavigationContainer>');
const outside = navigatorSource.slice(closeAt);

const hosted = [...outside.matchAll(/<([A-Z][A-Za-z]+)[\s/>]/g)].map(m => m[1]);
const imported = new Map<string, string>();
for (const m of navigatorSource.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']*)'/g)) {
  for (const name of m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean)) {
    const resolved = resolveImport(NAVIGATOR, m[2]);
    if (resolved) imported.set(name, resolved);
  }
}
/**
 * Shares a file with `freezeWhenBlurred`, which does use navigation hooks, so a
 * file-level scan flags it; the component itself reads only the module-level
 * `tabDiag` store. Drop this with the diagnostic.
 */
const EXEMPT = new Set(['BlankTabDiagnostic']);
const components = [...new Set(hosted)].filter(name => imported.has(name) && !EXEMPT.has(name));

describe('components mounted outside NavigationContainer', () => {
  it('finds the container and some components beside it', () => {
    // Guards the scan: if the marker or the tags stopped matching, every
    // assertion below would pass against nothing.
    expect(closeAt).toBeGreaterThan(0);
    expect(components.length).toBeGreaterThan(3);
  });

  it('still detects a container hook through the import chain', () => {
    const chain = findOffender(join(SRC, 'components', 'CookwareWeighIn.tsx'));
    expect(chain).not.toBeNull();
    expect(chain![chain!.length - 1]).toMatch(/EditorSheet|useKeyboardInsetScroll/);
  });

  it.each(components)('%s reaches no hook that needs a navigation object', name => {
    const chain = findOffender(imported.get(name)!);
    expect(chain && chain.join(' -> ')).toBeNull();
  });
});
