// Jest runs in `node` with no React Native present, and `src/theme` reaches
// for `StyleSheet.hairlineWidth` to size a border. The palettes themselves are
// plain data, so stubbing that one field is enough to get at them.
jest.mock('react-native', () => ({ StyleSheet: { hairlineWidth: 1 } }));

import { darkColors, nightColors, lightColors, type Colors } from '../theme';

/**
 * The palettes' own contrast guarantees, so a future colour edit can't quietly
 * undo the pass that established them.
 *
 * Text greys are a ladder, each with a floor on the page and on a card:
 * `text` (a control's label), `textSecondary` at 7:1 (information about a row,
 * every section header) and `textTertiary` at 4.5:1 (a placeholder, an empty
 * value). The gap between the last two is what keeps three greys telling
 * apart: put `textTertiary` at the AA line and `textSecondary` has to sit well
 * clear of it, or the two read as one colour.
 *
 * Every colour used as both text and a filled surface comes in three roles
 * (see the note on `green` in `Colors`): the hue, `…Text` and `…Fill`. Each
 * role gets its floor below, so a call site that picks by role can't miss it.
 */

const AA = 4.5;
/** WCAG AAA, which `textSecondary` meets so `textTertiary` can sit at AA below it. */
const AAA = 7;
/** WCAG 1.4.11: a control's boundary, an icon, a chart mark. */
const NON_TEXT = 3;

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

/** An opaque hex at a given alpha, in the `rgba()` form `parse` reads. */
const hexWithAlpha = (hex: string, alpha: number) => {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Both colours must already be opaque — composite a tint with `over` first. */
const contrast = (fg: string, bg: string) => {
  const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

const PALETTES: [string, Colors][] = [
  ['black', darkColors],
  ['night', nightColors],
  ['light', lightColors],
];

describe.each(PALETTES)('%s palette', (_name, colors) => {
  const SURFACES = ['bg', 'bgSecondary', 'bgTertiary', 'bgQuaternary'] as const;

  it.each(SURFACES)('reads a control label (`text`) on %s', surface => {
    expect(contrast(colors.text, colors[surface])).toBeGreaterThanOrEqual(AA);
  });

  it.each(['bg', 'bgSecondary'] as const)('reads row metadata (`textSecondary`) on %s', surface => {
    expect(contrast(colors.textSecondary, colors[surface])).toBeGreaterThanOrEqual(AAA);
  });

  // A control's label is `text`, but a hint or count still lands on a raised
  // control now and then (a stepper's unit, a segment's caption).
  it('reads `textSecondary` on bgTertiary', () => {
    expect(contrast(colors.textSecondary, colors.bgTertiary)).toBeGreaterThanOrEqual(AA);
  });

  it.each(['bg', 'bgSecondary', 'bgTertiary'] as const)('reads a placeholder (`textTertiary`) on %s', surface => {
    expect(contrast(colors.textTertiary, colors[surface])).toBeGreaterThanOrEqual(AA);
  });

  it('keeps `textSecondary` a clear step above `textTertiary`', () => {
    expect(contrast(colors.textSecondary, colors.bgSecondary))
      .toBeGreaterThan(contrast(colors.textTertiary, colors.bgSecondary) * 1.25);
  });

  // An unchecked checkbox sits on a card, and on the pressed row's bgTertiary.
  it.each(['bgSecondary', 'bgTertiary'] as const)('outlines an empty control (`controlBorder`) on %s', surface => {
    expect(contrast(colors.controlBorder, colors[surface])).toBeGreaterThanOrEqual(NON_TEXT);
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

  // The status hues, each by role. The tint is the pill an `InlineAction` or a
  // negative chip draws its label on: the label's own colour at the alpha
  // `InlineAction` uses, composited onto a card before it's measured.
  const tintAlpha = colors.bg === lightColors.bg ? 0.12 : 0.15;
  const tinted = (hex: string) => over(hexWithAlpha(hex, tintAlpha), colors.bgSecondary);

  describe.each(['red', 'orange', 'green', 'purple'] as const)('%s', hue => {
    const text = colors[`${hue}Text`];
    const fill = colors[`${hue}Fill`];

    it.each(['bg', 'bgSecondary', 'bgTertiary'] as const)('reads as text on %s', surface => {
      expect(contrast(text, colors[surface])).toBeGreaterThanOrEqual(AA);
    });

    it('reads as text on its own tinted pill', () => {
      expect(contrast(text, tinted(text))).toBeGreaterThanOrEqual(AA);
      expect(contrast(text, tinted(colors[hue]))).toBeGreaterThanOrEqual(AA);
    });

    it('carries onFill on its fill', () => {
      expect(contrast(colors.onFill, fill)).toBeGreaterThanOrEqual(AA);
    });
  });

  // The plain hue is allowed as an icon for these three; orange isn't, which
  // is why an orange glyph is `orangeText`.
  describe.each(['red', 'green', 'purple', 'accent'] as const)('%s as an icon', hue => {
    it.each(['bg', 'bgSecondary', 'bgTertiary'] as const)('reads on %s', surface => {
      expect(contrast(colors[hue], colors[surface])).toBeGreaterThanOrEqual(NON_TEXT);
    });
  });

  it.each(['bg', 'bgSecondary', 'bgTertiary'] as const)('reads `warningText` on %s', surface => {
    expect(contrast(colors.warningText, colors[surface])).toBeGreaterThanOrEqual(AA);
  });

  // A checked box is a control in the checked state: the fill holds 3:1 on the
  // card it sits on, and the check drawn on it reads as text would.
  it('outlines a checked control (`done`) on a card', () => {
    expect(contrast(colors.done, colors.bgSecondary)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it('reads onDone on a done fill', () => {
    expect(contrast(colors.onDone, colors.done)).toBeGreaterThanOrEqual(AA);
  });

  it('reads onWarning on a warning fill', () => {
    expect(contrast(colors.onWarning, colors.warning)).toBeGreaterThanOrEqual(AA);
  });
});
