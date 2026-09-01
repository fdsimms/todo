// Jest runs in `node` with no React Native present, and `src/theme` reaches
// for `StyleSheet.hairlineWidth` to size a border. The palettes themselves are
// plain data, so stubbing that one field is enough to get at them.
jest.mock('react-native', () => ({ StyleSheet: { hairlineWidth: 1 } }));

import { darkColors, darkPurpleColors, lightColors, type Colors } from '../theme';

/**
 * The palettes' own contrast guarantees, so a future colour edit can't quietly
 * undo the pass that established them.
 *
 * The rule these assert is the one the app settled on: `text` is what an
 * unselected control's label is, `textSecondary` is what information about a
 * row is, and `textTertiary` says a thing is *absent* or *done* — which is why
 * it's the one colour with no floor here. It measures 2.84:1 on a card in dark,
 * so anything it says can't be read; that's fine for "None" beside a field, and
 * was the bug everywhere it was carrying a due date, a category or a hint.
 */

const AA = 4.5;

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const parse = (color: string): [number, number, number, number] => {
  const rgba = color.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map(part => part.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  const hex = color.replace('#', '');
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(1) as
    [number, number, number, number];
};

/** What a translucent colour actually becomes once it's painted on a surface. */
const over = (color: string, surface: string): string => {
  const [r, g, b, a] = parse(color);
  const [sr, sg, sb] = parse(surface);
  const mix = (f: number, s: number) => Math.round(f * a + s * (1 - a));
  return `rgb(${mix(r, sr)}, ${mix(g, sg)}, ${mix(b, sb)})`;
};

const luminance = (color: string) => {
  const [r, g, b] = parse(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Both colours must already be opaque — composite a tint with `over` first. */
const contrast = (fg: string, bg: string) => {
  const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

const PALETTES: [string, Colors][] = [
  ['dark', darkColors],
  ['darkPurple', darkPurpleColors],
  ['light', lightColors],
];

describe.each(PALETTES)('%s palette', (_name, colors) => {
  const SURFACES = ['bg', 'bgSecondary', 'bgTertiary', 'bgQuaternary'] as const;

  it.each(SURFACES)('reads a control label (`text`) on %s', surface => {
    expect(contrast(colors.text, colors[surface])).toBeGreaterThanOrEqual(AA);
  });

  // The two surfaces a row's own metadata sits on: the page and a card. It
  // deliberately isn't asserted on bgTertiary/bgQuaternary — those are control
  // surfaces, and a control's label is `text`, not this.
  it.each(['bg', 'bgSecondary'] as const)('reads row metadata (`textSecondary`) on %s', surface => {
    expect(contrast(colors.textSecondary, colors[surface])).toBeGreaterThanOrEqual(AA);
  });

  it('reads a disclosure value / sheet header button on a card', () => {
    expect(contrast(colors.accentText, colors.bgSecondary)).toBeGreaterThanOrEqual(AA);
  });

  // An accent `InlineAction` puts that same text on an accentSubtle pill, which
  // is translucent — the tint has to be composited before it's measured, or the
  // check passes against a surface nobody sees.
  it('reads an accent InlineAction on its own pill', () => {
    const pill = over(colors.accentSubtle, colors.bgSecondary);
    expect(contrast(colors.accentText, pill)).toBeGreaterThanOrEqual(AA);
  });

  // `accentText` is a text colour only — a fill stays `accent`. If the two ever
  // drift far apart, a filled button and the label beside it stop matching.
  it('keeps accentText within reach of accent', () => {
    expect(contrast(colors.accentText, colors.accent)).toBeLessThan(2);
  });

  // `accentFill` exists because plain `accent` fails AA under `onAccent` white
  // text/icons (3.65:1 dark, 4.02:1 light) — see its doc comment in
  // `src/theme/index.ts`. This is the guarantee that fix rests on.
  it('reads onAccent on an accentFill button', () => {
    expect(contrast(colors.onAccent, colors.accentFill)).toBeGreaterThanOrEqual(AA);
  });
});
