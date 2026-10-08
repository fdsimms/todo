/**
 * A screen that asks `useScreenSettings` for its gear must render the sheet the
 * gear opens, as a real element.
 *
 * A merge once replaced `<ScreenSettingsSheet … />` on two screens with a line
 * of text (`const actions = useMemo<ScreenSettingsSheet … />`). That is valid
 * JSX, so it typechecked and no test noticed: it renders a bare string inside a
 * `View`, which React Native rejects, and both screens failed on open. There is
 * no component test to catch it (Jest runs in `node` with no renderer), so this
 * reads the source, the way `noRawModal.test.ts` does.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SCREENS = join(__dirname, '..', 'screens');

/** The element as JSX: a tag opening at the start of a line or after whitespace or `>`. */
const SHEET_ELEMENT = /(^|[\s>(])<ScreenSettingsSheet[\s/>]/m;
/** The same name glued to an identifier, as in `useMemo<ScreenSettingsSheet`: a generic or a mangled merge, never an element. */
const GLUED = /\w<ScreenSettingsSheet\b/;

const screens = readdirSync(SCREENS)
  .filter(name => name.endsWith('.tsx'))
  .map(name => ({ name, source: readFileSync(join(SCREENS, name), 'utf8') }));

describe('screens with a settings gear', () => {
  // A screen that opens the popover: it hands the gear to its header, or calls
  // `open`, or spreads `.sheet`. One that only reads `.link` (Today and Projects
  // jump straight to Settings from their "…" menu) renders no sheet by design.
  // A merge that eats the element leaves the header's gear behind, so this
  // still names exactly the screens the failure would break.
  const OPENS_SHEET = /screenSettings\.(action|open|sheet)\b|withScreenSettings\(/;
  const withGear = screens.filter(s => /\buseScreenSettings\(/.test(s.source) && OPENS_SHEET.test(s.source));

  it('finds the screens that use the gear', () => {
    // Guards the filter itself: an empty list would make every check below pass.
    expect(withGear.length).toBeGreaterThan(10);
    expect(withGear.map(s => s.name)).not.toContain('TodayScreen.tsx');
  });

  it.each(withGear.map(s => [s.name, s.source] as const))('%s renders the sheet as an element', (_name, source) => {
    expect(SHEET_ELEMENT.test(source)).toBe(true);
  });

  it('has no screen where the sheet name is glued to an identifier', () => {
    expect(screens.filter(s => GLUED.test(s.source)).map(s => s.name)).toEqual([]);
  });
});
