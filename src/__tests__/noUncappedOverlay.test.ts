/**
 * A transparent `SheetModal` has to cap its own card's width.
 *
 * `SheetModal` puts a full-screen sheet in the app's column (`AppFrame`), but a
 * transparent one is a backdrop that has to cover the whole window with a card
 * on top, so it is never framed. Written without a cap, the card is the window
 * less a gutter: quick add was 1,550pt wide on a Mac with its chips stretched to
 * fill it, and the same shape was repeated across forty sheets before anyone
 * saw it, because on a phone nothing is wider than the card.
 *
 * The caps are in `frameWidth.ts` (`overlayCard`, `overlayDock` and the rest) and
 * a picker's own `pickerCardWidthFor`. Source text rather than the module graph,
 * as `noRawModal.test.ts` does: there are no component tests, so a file is only
 * ever text to this suite.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

/**
 * What counts as having a cap: one of the shared helpers. A bare `maxWidth` does
 * not, since a sheet is full of unrelated ones (a chip, a label) and one of those
 * said nothing about the card.
 */
const CAPPED = /\boverlay(Card|SearchCard|Dock|Docked)\b|\bpickerCardWidthFor\b|\bdrawerWidthFor\b/;

/** Transparent sheets that are not a card to cap, or cap themselves, with the reason each is exempt. */
const EXEMPT: Record<string, string> = {
  [join('components', 'Fab.tsx')]: 'the menu is a stack of pills as wide as their labels, anchored to the button',
  [join('components', 'LogMealPrompt.tsx')]: 'a small prompt, capped at 360 on its own card',
  [join('components', 'TripBudgetPrompt.tsx')]: 'a small prompt, capped at 340 on its own card',
};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Whether a `<SheetModal` opening tag carries the `transparent` prop. A tag is short, so a window of lines is enough. */
function hasTransparentSheet(src: string): boolean {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/<SheetModal\b/.test(lines[i])) continue;
    const tag = lines.slice(i, i + 14).join('\n');
    const end = tag.search(/\n\s*>\s*(\n|$)|[^=]>\s*\n/);
    const opening = end === -1 ? tag : tag.slice(0, end);
    if (/(^|\s)transparent(\s|\/|=|$)/m.test(opening)) return true;
  }
  return false;
}

describe('transparent SheetModal width', () => {
  const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));
  const sheets = files.filter(f => hasTransparentSheet(f.src));

  it('finds the transparent sheets it is meant to police', () => {
    expect(sheets.length).toBeGreaterThan(25);
    expect(sheets.map(f => f.rel)).toEqual(expect.arrayContaining([
      join('components', 'QuickAddModal.tsx'),
      join('components', 'CardSheet.tsx'),
      join('components', 'CategoryPicker.tsx'),
    ]));
  });

  it('caps every one that is a card', () => {
    const uncapped = sheets
      .filter(f => !EXEMPT[f.rel] && !CAPPED.test(f.src))
      .map(f => f.rel);
    expect(uncapped).toEqual([]);
  });

  it('keeps the exemptions honest', () => {
    for (const rel of Object.keys(EXEMPT)) {
      expect(sheets.some(f => f.rel === rel)).toBe(true);
    }
  });
});
