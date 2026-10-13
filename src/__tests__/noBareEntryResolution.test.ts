/**
 * A planned meal becomes a `ChoiceResolution` through `entryResolution`, never
 * by hand.
 *
 * `{ chosen: entry.recipeChoices, onHand }` compiles, passes every test that
 * does not carry an override, and silently drops `MealPlanEntry.recipeOverrides`:
 * the meal then shops for, prices and cooks the very line it replaced. The bug
 * is invisible in review (the line reads exactly like its neighbours), so the
 * check that catches it has to be mechanical, the same shape as
 * `noRawModal.test.ts`.
 *
 * Reads source text on purpose: there is no renderer here, and a hand-built
 * object literal is only ever text as far as the suite is concerned.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const DIRS = [join(ROOT, 'src'), join(ROOT, 'mcp', 'src')];
/** The helper itself reads the entry's picks to build the resolution. */
const HELPER = join('src', 'utils', 'recipeComponents.ts');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // Tests quote the pattern as a literal and build fixtures by hand.
    if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'node_modules') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** `chosen: something.recipeChoices` / `chosen: something?.recipeChoices`: a resolution built from an entry's picks alone. */
const HAND_BUILT = /\bchosen:\s*[\w.?]*recipeChoices\b/;

const files = DIRS.flatMap(d => sourceFiles(d)).map(f => ({
  rel: f.slice(ROOT.length + 1),
  src: readFileSync(f, 'utf8'),
}));

describe('entry resolutions', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('still finds the hand-built form inside the helper, so the pattern has not gone stale', () => {
    const helper = files.find(f => f.rel === HELPER);
    expect(helper).toBeDefined();
    expect(HAND_BUILT.test(helper!.src)).toBe(true);
  });

  it('builds no resolution from an entry\'s picks outside entryResolution', () => {
    const offenders = files
      .filter(f => f.rel !== HELPER)
      .filter(f => HAND_BUILT.test(f.src))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });
});
