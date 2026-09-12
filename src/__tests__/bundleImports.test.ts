/**
 * Nothing imports a package's barrel when a deep import exists.
 *
 * Metro bundles what a module graph reaches, and a barrel index reaches
 * everything the package publishes — so one `import { Ionicons } from
 * '@expo/vector-icons'` pulls all nineteen icon fonts into the app, not just
 * the one font the icon needs. `@expo/vector-icons`' own entry point is named
 * `IconsLazy.js` and looks like it would help; the laziness is in the export
 * getters, and the `require` of every family sits at the top of the file,
 * eagerly. That single import was costing 3.7 MB of bundled `.ttf`, alongside
 * 1.6 MB of glyphmap JSON compiled into the Hermes bytecode.
 *
 * `date-fns` is the same shape and cheaper per offence: its index re-exports
 * 245 modules, about 1 MB of source, and eight files were reaching for it.
 *
 * Neither mistake shows up in typecheck, in the tests, or in the app — the
 * import works perfectly, it just brings company. The only signal is the size
 * of a bundle nobody measures per PR, so it is checked here instead.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

/** Packages whose barrel index drags in far more than the symbol being asked for. */
const BARRELS = ['@expo/vector-icons', 'date-fns'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * `import type` is erased by the compiler, so it emits no `require` and costs
 * the bundle nothing. `parseTaskInput` and `parseNaturalDate` both take
 * `date-fns`' `Day` that way, and shouldn't have to route a type through a
 * deep path to satisfy this.
 */
function valueImportsFrom(source: string, pkg: string): boolean {
  const pattern = new RegExp(`^\\s*import\\s+(?!type\\s)[^;]*?from\\s+'${pkg.replace('/', '\\/')}'`, 'm');
  return pattern.test(source);
}

describe('bundle-size import discipline', () => {
  const files = sourceFiles(SRC);

  it('finds the source tree to check', () => {
    // Guards the walk itself: a rename that stopped this finding anything
    // would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some(f => f.endsWith('QuickSearchModal.tsx'))).toBe(true);
  });

  for (const pkg of BARRELS) {
    it(`imports from '${pkg}' by deep path, never the barrel`, () => {
      const offenders = files
        .filter(f => valueImportsFrom(readFileSync(f, 'utf8'), pkg))
        .map(f => f.slice(SRC.length + 1));
      expect(offenders).toEqual([]);
    });
  }

  it('still uses the deep paths it is protecting', () => {
    // The rule above is satisfiable by not importing either package at all,
    // which would mean this file had quietly stopped guarding anything.
    const sources = files.map(f => readFileSync(f, 'utf8'));
    expect(sources.filter(s => s.includes("'@expo/vector-icons/Ionicons'")).length).toBeGreaterThan(50);
    expect(sources.filter(s => s.includes("'date-fns/")).length).toBeGreaterThan(50);
  });
});
