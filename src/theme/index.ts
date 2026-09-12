import { StyleSheet } from 'react-native';

export type Colors = {
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  bgQuaternary: string;
  /**
   * A region *behind* the cards — currently the tray a stack's header and
   * tasks share (`TaskGroupTray`). It sits below `bgSecondary` in the stack of
   * surfaces, not above it, which is why it isn't `bgTertiary`: in dark themes
   * that means a shade nearer the page than the card, and in light themes a
   * shade darker than the page, since white cards are already the top.
   */
  bgSunken: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentSubtle: string;
  /**
   * Accent as *text*, for the three places bare accent text is sanctioned:
   * a sheet header button, a disclosure value, and an `InlineAction`'s accent
   * label. `accent` is tuned as a fill — under text it measures 4.02:1 on a
   * light card and 3.90:1 on an `accentSubtle` pill in dark, both under AA,
   * so this is the same blue moved far enough for the text to be readable.
   * Never use it as a background: a fill stays `accent`, or the two stop
   * matching each other.
   */
  accentText: string;
  /**
   * Accent as a *fill carrying `onAccent` (white) text* — the opposite
   * problem `accentText` solves, and the mirror-image token for it. `onAccent`
   * on `accent` measures 3.65:1 in dark and 4.02:1 in light, both under the
   * 4.5:1 AA bar for normal text, and it's the selected state of every chip,
   * pill and segment plus the "Add"/"Save" filled buttons (#2196). `accent`
   * itself stays iOS system blue on purpose — this is a second, slightly
   * darker blue for exactly the surfaces that carry white text, so the
   * identity color used for glyphs, borders and bars is untouched. Use this
   * wherever `onAccent` sits on a filled surface; use `accent` everywhere
   * else a fill is called for.
   */
  accentFill: string;
  green: string;
  orange: string;
  red: string;
  purple: string;
  separator: string;
  /** Text/icon color on filled accent/colored surfaces (always white, iOS-style). */
  onAccent: string;
  /** Bright yellow used for "new item" banners/alerts. */
  warning: string;
  /** Subtle tinted background behind warning banners. */
  warningBg: string;
  /** Text/icon color on filled warning surfaces (always dark, for contrast against yellow). */
  onWarning: string;
  backdrop: string;
  blurFallback: string;
  timeMorning: string;
  timeAfternoon: string;
  timeEvening: string;
  timeNight: string;
  tagPalette: string[];
};

export type ThemeMode = 'dark' | 'light' | 'system' | 'darkPurple';

export const darkColors: Colors = {
  bg: '#000000',
  bgSecondary: '#1C1C1E',
  bgTertiary: '#2C2C2E',
  bgQuaternary: '#3A3A3C',
  bgSunken: '#0E0E10',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#636366',
  accent: '#0A84FF',
  accentSubtle: 'rgba(10, 132, 255, 0.15)',
  accentText: '#3D9BFF',
  accentFill: '#0970D9',
  green: '#4C9A76',
  orange: '#FF9F0A',
  red: '#FF453A',
  purple: '#BF5AF2',
  separator: '#38383A',
  onAccent: '#FFFFFF',
  warning: '#FFD60A',
  warningBg: 'rgba(255, 214, 10, 0.16)',
  onWarning: '#000000',
  backdrop: 'rgba(0, 0, 0, 0.45)',
  blurFallback: 'rgba(28, 28, 30, 0.85)',
  timeMorning: '#FF9F0A',
  timeAfternoon: '#0A84FF',
  timeEvening: '#BF5AF2',
  timeNight: '#5E5CE6',
  tagPalette: [
    '#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2',
    '#5E5CE6', '#FF375F', '#64D2FF', '#FFD60A', '#AC8E68',
  ],
};

// A softer alternative to the near-black default dark theme — same
// semantic colors, base surfaces tinted with a subdued purple instead of pure black.
export const darkPurpleColors: Colors = {
  bg: '#16121F',
  bgSecondary: '#1F1A2C',
  bgTertiary: '#2A2338',
  bgQuaternary: '#3A324A',
  bgSunken: '#1A1526',
  text: '#FFFFFF',
  textSecondary: '#9D93AD',
  textTertiary: '#6E6480',
  accent: '#0A84FF',
  accentSubtle: 'rgba(10, 132, 255, 0.15)',
  accentText: '#3D9BFF',
  accentFill: '#0970D9',
  green: '#4C9A76',
  orange: '#FF9F0A',
  red: '#FF453A',
  purple: '#BF5AF2',
  separator: '#3D3550',
  onAccent: '#FFFFFF',
  warning: '#FFD60A',
  warningBg: 'rgba(255, 214, 10, 0.16)',
  onWarning: '#000000',
  backdrop: 'rgba(10, 6, 20, 0.5)',
  blurFallback: 'rgba(31, 26, 44, 0.85)',
  timeMorning: '#FF9F0A',
  timeAfternoon: '#0A84FF',
  timeEvening: '#BF5AF2',
  timeNight: '#5E5CE6',
  tagPalette: [
    '#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2',
    '#5E5CE6', '#FF375F', '#64D2FF', '#FFD60A', '#AC8E68',
  ],
};

export const lightColors: Colors = {
  bg: '#F2F2F7',
  bgSecondary: '#FFFFFF',
  bgTertiary: '#EFEFF4',
  bgQuaternary: '#D1D1D6',
  bgSunken: '#E7E7EC',
  text: '#000000',
  textSecondary: '#6C6C70',
  textTertiary: '#8A8A8E',
  accent: '#007AFF',
  accentSubtle: 'rgba(0, 122, 255, 0.12)',
  accentText: '#0B69D0',
  accentFill: '#0068D9',
  green: '#3D8563',
  orange: '#FF9500',
  red: '#FF3B30',
  purple: '#AF52DE',
  separator: '#C6C6C8',
  onAccent: '#FFFFFF',
  warning: '#FFCC00',
  warningBg: 'rgba(255, 204, 0, 0.16)',
  onWarning: '#000000',
  backdrop: 'rgba(0, 0, 0, 0.35)',
  blurFallback: 'rgba(255, 255, 255, 0.85)',
  timeMorning: '#FF9500',
  timeAfternoon: '#007AFF',
  timeEvening: '#AF52DE',
  timeNight: '#5856D6',
  tagPalette: [
    '#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE',
    '#5856D6', '#FF2D55', '#32ADE6', '#FFCC00', '#A2845E',
  ],
};

// Keep for backward compat — static references that don't need theming
export const colors = darkColors;

/**
 * Flattens a translucent overlay color — `rgba(r, g, b, a)`, or a hex color
 * with a trailing alpha byte such as `colors.accent + '1A'` — against an
 * opaque hex background, returning a solid hex that looks identical to the
 * two simply stacked. Reach for this wherever a translucent token
 * (`accentSubtle`, a tag's `+ '33'` tint, …) would otherwise sit on a surface
 * it doesn't fully occlude — a `SwipeableRow` panel or a `ReorderableList`
 * drag overlay behind it, say — since a translucent background there lets
 * *that* surface's color bleed through instead of the row's own, which reads
 * as a transparency glitch rather than the intended tint. See the note on
 * `SwipeableRow` for the full failure mode this exists to avoid; if you're
 * about to reach for a translucent background on anything that can sit atop
 * a swipe panel or a drag overlay, flatten it here instead.
 */
export function flattenOverlay(overlay: string, baseHex: string): string {
  const base = baseHex.replace('#', '');
  const baseR = parseInt(base.substring(0, 2), 16);
  const baseG = parseInt(base.substring(2, 4), 16);
  const baseB = parseInt(base.substring(4, 6), 16);
  const mix = (fg: number, bg: number, alpha: number) => Math.round(fg * alpha + bg * (1 - alpha));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');

  const rgbaMatch = overlay.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (rgbaMatch) {
    const [, rStr, gStr, bStr, aStr] = rgbaMatch;
    const alpha = aStr !== undefined ? parseFloat(aStr) : 1;
    return `#${toHex(mix(parseInt(rStr, 10), baseR, alpha))}${toHex(mix(parseInt(gStr, 10), baseG, alpha))}${toHex(mix(parseInt(bStr, 10), baseB, alpha))}`;
  }

  const hexMatch = overlay.match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/);
  if (hexMatch) {
    const [, rgbHex, alphaHex] = hexMatch;
    const alpha = parseInt(alphaHex, 16) / 255;
    const r = parseInt(rgbHex.substring(0, 2), 16);
    const g = parseInt(rgbHex.substring(2, 4), 16);
    const b = parseInt(rgbHex.substring(4, 6), 16);
    return `#${toHex(mix(r, baseR, alpha))}${toHex(mix(g, baseG, alpha))}${toHex(mix(b, baseB, alpha))}`;
  }

  return overlay;
}

/**
 * The spacing scale. `xs` through `xl` double at each step, which is the
 * backbone; `xxs`, `xsm` and `smd` fill the three gaps that step over the
 * values real layouts kept needing.
 *
 * Those three were added after a sweep found ~980 raw numbers across 183
 * files, four fifths of everything written, clustered almost entirely on 2,
 * 6 and 12 — the gaps between 4 and 8, and between 8 and 16. A scale nobody
 * can hit is a scale nobody uses, so the fix was to widen it rather than to
 * keep converting call sites to the nearest wrong value.
 *
 * The values *between* these steps (1, 3, 5, 7, 10, 14) are deliberately not
 * tokens and deliberately not rounded onto one: they're optical nudges
 * (a chevron aligned against a cap height, a border's width taken back out
 * of a padding) where the exact number is the point, and snapping them to a
 * token would move pixels for the sake of tidiness.
 */
export const spacing = {
  xxs: 2,
  xs: 4,
  xsm: 6,
  sm: 8,
  smd: 12,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
};

/**
 * Corner radius for a completion checkbox — the Things-3-style rounded square
 * that replaced the circle. Derived from the box's size rather than picked off
 * `radius`, because these come in three sizes (24pt row, 22pt search result,
 * 18pt subtask) and a fixed radius makes the smallest one a circle while the
 * largest still reads as a square. Pair it with `borderCurve: 'continuous'` so
 * iOS draws the superellipse instead of a plain quarter-circle corner.
 */
export const checkboxRadius = (size: number) => Math.round(size / 3);

/**
 * `xxs` is the caption floor — the badge count in a 16pt circle, the weekday
 * letter under a chart bar, the hint trailing a pill, the chip labels on a task
 * row. It was added the same way `spacing`'s three in-between steps were, and
 * for the same reason: a sweep found this one job written as 9, 10 *and* 11
 * across ~26 sites, none of them reaching for a token because the smallest one
 * (`xs`, 12) was too big for a badge. Three sizes for one job is drift, and 9pt
 * is below what a caption should ever be, so the fix was to widen the scale
 * rather than keep rounding call sites onto the nearest wrong literal.
 *
 * Nothing goes below it. A container too small to hold 11pt is the container
 * that's wrong — a badge box grows with `minWidth` + `paddingHorizontal`
 * instead (see `ScreenHeader`'s badge, and the three siblings it now matches).
 */
export const font = {
  xxs: 11,
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
};

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const lineHeight = {
  xs: 16,
  sm: 18,
  md: 22,
  lg: 24,
  xl: 28,
  xxl: 34,
};

export const border = {
  hairline: StyleSheet.hairlineWidth,
  thin: 0.5,
  sm: 1,
  md: 1.5,
};

export const iconSize = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
};

// Single source of truth for press behavior across the app. Buttons and
// chips should use PressableScale; rows that keep TouchableOpacity should
// use interaction.activeOpacity rather than ad-hoc values.
export const interaction = {
  activeOpacity: 0.7,
  pressScale: 0.96,
  delayLongPress: 350,
  /**
   * Smallest a control's *touch* area may be — Apple's 44pt minimum.
   *
   * A control may be drawn smaller than this (see `pillHeight`), but then it
   * owes the user a `hitSlop` that brings the touch area back up to it.
   * Isolated controls with room around them — an add button, a stepper's
   * ± — should just be this size outright.
   */
  minTouchTarget: 44,
  /**
   * Visual height of a pill-shaped control in a dense sheet: quick add's
   * attribute chips, the editor's option pills.
   *
   * Deliberately under `minTouchTarget`. A wrapping toolbar of 44pt pills
   * stands three or four rows tall above the keyboard and pushes the field it
   * exists to serve off the screen — the pills stop being a toolbar and
   * become the form. 36 is the compromise: half again the ~25pt these used to
   * be, without the bulk.
   *
   * Set it as a `minHeight` rather than reaching for vertical padding, which
   * sizes a box off whatever's inside it — a row mixing icons, coloured dots
   * and text otherwise lands at three different heights, all of them short.
   */
  pillHeight: 36,
  // Max finger travel (px) for a raw touchEnd to still count as a tap rather
  // than a scroll/drag release.
  tapMoveThreshold: 10,
};

export const animation = {
  duration: {
    fast: 150,
    normal: 250,
    slow: 400,
    /**
     * A centered card dismissing itself — its scale and opacity, run against
     * a backdrop that fades at `fast` so the card leaves fractionally ahead
     * of the dimming behind it. The pair was written out as a literal
     * 120/120/150 triad in all seven sheets that do this (quick add, quick
     * search, the cook recap, …), which is the drift the tokens exist to
     * stop; the backdrop half was already `fast` spelled as a number.
     */
    dismiss: 120,
  },
  spring: {
    snappy: { damping: 22, stiffness: 300, mass: 0.8 },
    smooth: { damping: 26, stiffness: 220, mass: 1.0 },
    bouncy: { damping: 15, stiffness: 350, mass: 0.9 },
    sheetDismiss: { damping: 28, stiffness: 320 },
  },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  fab: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
};

export const getShadows = (isDark: boolean) => ({
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.35 : 0.10,
    shadowRadius: 3,
    elevation: 3,
  },
  fab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.55 : 0.30,
    shadowRadius: 10,
    elevation: 8,
  },
  /**
   * A centered popover card over a dimmed page — the date/time/birthday
   * pickers. Deeper and softer than `card` because it floats well clear of
   * the page rather than sitting on it. Was written out by hand in four
   * pickers at the dark opacity regardless of theme, which in light left a
   * charcoal halo round a white card.
   */
  popover: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.35 : 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  /** The side menu's trailing edge, cast sideways onto the page it covers. */
  drawer: {
    shadowColor: '#000',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: isDark ? 0.35 : 0.15,
    shadowRadius: 16,
    elevation: 20,
  },
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: isDark ? 0.45 : 0.12,
    shadowRadius: 12,
    elevation: 10,
  },
});
