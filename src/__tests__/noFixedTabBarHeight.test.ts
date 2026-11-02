/**
 * Nothing in `src/` may position itself against `TAB_BAR_HEIGHT` directly.
 *
 * On a wide window the sidebar replaces the tab bar and nothing is drawn at the
 * bottom edge, so anything floated a bar's height above it hangs in the air.
 * `useBottomBarHeight` is the same number that is zero while the sidebar shows;
 * the constant is for it, and for the one place that sizes the bar's own glass
 * capsule (`AppNavigator`). Inside the tab navigator `useBottomTabBarHeight` is
 * already right, since `HiddenTabBar` reports the real footprint.
 *
 * Source text rather than the module graph, as `noRawModal.test.ts` does: there
 * are no component tests, so a file is only ever text to this suite.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { sourceFiles } from '../testSupport/sourceFiles';

const SRC = join(__dirname, '..');

/** Where the constant is defined, read, or sizes the bar itself. */
const ALLOWED = new Set([
  join('utils', 'frameWidth.ts'),
  join('hooks', 'useBottomBarHeight.ts'),
  join('navigation', 'AppNavigator.tsx'),
]);

describe('TAB_BAR_HEIGHT', () => {
  const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('is read only through useBottomBarHeight', () => {
    const offenders = files.filter(f => /\bTAB_BAR_HEIGHT\b/.test(f.src) && !ALLOWED.has(f.rel)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    for (const rel of ALLOWED) {
      const file = files.find(f => f.rel === rel);
      expect(file && /\bTAB_BAR_HEIGHT\b/.test(file.src)).toBe(true);
    }
  });
});
