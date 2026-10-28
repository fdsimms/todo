/**
 * A dashboard route and its screen's `WideScroll` have to agree.
 *
 * `columnCapFor` lifts the app's column to 1040pt for a route in
 * `DASHBOARD_ROUTES`, and `WideScroll` is what deals that width into two columns
 * of cards. One without the other is a layout nobody drew: a listed route whose
 * screen has no `WideScroll` is one card stretched across 1040pt, and a screen
 * with a `WideScroll` that is not listed deals two columns into the 720pt cap,
 * about 350pt a card.
 *
 * Source text rather than the module graph, as `noUncappedOverlay.test.ts` does:
 * there are no component tests, so a file is only ever text to this suite.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { DASHBOARD_ROUTES } from '../utils/columnCap';

const SRC = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

/** The file a tab route's screen is imported from, read off the navigator's own imports. */
function screenFileFor(route: string): string {
  const navigator = read(join('navigation', 'AppNavigator.tsx'));
  const registered = navigator.match(new RegExp(`^\\s*${route}: freezeWhenBlurred\\((\\w+)\\)`, 'm'));
  if (!registered) throw new Error(`${route} is not a tab screen in AppNavigator`);
  const imported = navigator.match(new RegExp(`import \\{[^}]*\\b${registered[1]}\\b[^}]*\\} from '\\.\\./screens/(\\w+)'`));
  if (!imported) throw new Error(`could not find where ${registered[1]} is imported from`);
  return join('screens', `${imported[1]}.tsx`);
}

describe('dashboard routes', () => {
  it('each render a WideScroll', () => {
    for (const route of DASHBOARD_ROUTES) {
      expect(read(screenFileFor(route))).toMatch(/<WideScroll\b/);
    }
  });

  it('are the only screens that do', () => {
    const navigator = read(join('navigation', 'AppNavigator.tsx'));
    const registered = [...navigator.matchAll(/^\s*(\w+): freezeWhenBlurred\(\w+\)/gm)].map(m => m[1]);
    const using = registered.filter(route => /<WideScroll\b/.test(read(screenFileFor(route))));
    expect(new Set(using)).toEqual(new Set(DASHBOARD_ROUTES));
  });
});
