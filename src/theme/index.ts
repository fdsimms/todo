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
  /**
   * The outline of an unchecked control that has no fill of its own: a task's
   * completion checkbox and the `SelectionDot` ring. 3:1 on the card and on a
   * pressed row (`bgSecondary`, `bgTertiary`), the WCAG floor for a control's
   * boundary. It used to be `bgQuaternary`, which is a *surface* and measured
   * 1.5:1 as an outline, so an empty checkbox was close to invisible.
   */
  controlBorder: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  /**
   * The interactive colour: violet. Deep in Light, a pale lavender in Dark and
   * Black. It is the selected state of every chip, pill and segment, the
   * filled "Add"/"Save" buttons, the tab bar's current tab and every glyph,
   * border and bar that marks a control. It is the only hue the app owns for
   * interaction, so the
   * colours left on screen (`done` gold, red, the time-of-day and tag hues)
   * each mean something.
   */
  accent: string;
  accentSubtle: string;
  /**
   * Accent as *text*, for the three places bare accent text is sanctioned:
   * a sheet header button, a disclosure value, and an `InlineAction`'s accent
   * label. In Dark and Black this is the same value as `accent`; in Light it is
   * a touch deeper. It stays a separate token so the text role keeps its own contrast floor in
   * `themeContrast.test.ts`. Never use it as a background: a fill stays
   * `accent`/`accentFill`, or the two stop matching each other.
   */
  accentText: string;
  /**
   * Accent as a *fill carrying `onAccent`*: the selected state of every chip,
   * pill and segment plus the "Add"/"Save" filled buttons. The same value as
   * `accent`, kept separate for the same reason as
   * `accentText`. Wherever `onAccent` sits on a filled surface, the surface is
   * this; use `accent` everywhere else a fill is called for.
   */
  accentFill: string;
  /**
   * The four status hues, each in three roles — the `accent` / `accentText` /
   * `accentFill` split above, applied to every colour that is used both as
   * text and as a filled surface:
   *
   * - The plain hue (`red`) is the identity colour: a dot, a bar, a border, a
   *   tint, a chart mark, and (red, green, purple only) an icon.
   * - `…Text` is the hue as **text**, and as an **icon** for orange, whose
   *   plain value can't carry a glyph on a light surface. 4.5:1 on `bg`,
   *   `bgSecondary` and `bgTertiary`, and on its own translucent pill.
   * - `…Fill` is the hue as a **surface carrying `onAccent`** white text or
   *   icons (a destructive button, a swipe panel, a badge). 4.5:1 under white.
   *
   * No single value can do both jobs: in dark a red that reads as text on a
   * card is too light to hold white text, and in light an orange that reads as
   * text is brown. `themeContrast.test.ts` holds each role to its floor.
   */
  green: string;
  greenText: string;
  greenFill: string;
  orange: string;
  orangeText: string;
  orangeFill: string;
  red: string;
  redText: string;
  redFill: string;
  purple: string;
  purpleText: string;
  purpleFill: string;
  separator: string;
  /**
   * Text/icon colour on an `accent` or `accentFill` surface. It follows the
   * accent, so it is white in Light and ink in Dark and Black, where the
   * accent fill is near-white. A status fill (`redFill`, a swipe panel, a
   * badge), a tag or category colour, a photo or the camera carries `onFill`
   * instead, which is white in every theme.
   */
  onAccent: string;
  /**
   * Text/icon colour on a coloured fill that isn't the accent: the four status
   * `…Fill`s, a tag, category or priority colour, a photo or the camera. Always
   * white. Before the accent became ink this was `onAccent`'s second job.
   */
  onFill: string;
  /**
   * The colour of finishing: a checked completion checkbox (task, subtask,
   * chain step, a met daily target, a checked grocery row), and the coin and
   * streak marks. Marigold, darker in Light so the filled box still holds the
   * 3:1 a control needs against a white card. Its glyph is `onDone`.
   */
  done: string;
  /** The check drawn on a `done` fill: ink in every theme. */
  onDone: string;
  /**
   * The mark's own gold, Marigold 500 in every theme, so the mark drawn in the
   * app (Today's All clear) matches the app icon. Not a state colour: a
   * checked box is `done`, which goes darker in Light to hold 3:1 on a card.
   * The mark on it is `onBrand`.
   */
  brand: string;
  onBrand: string;
  /**
   * Orange used for "new item" banners and alerts. It was yellow until gold
   * became the colour of finishing, and moved so the two don't read as one.
   */
  warning: string;
  /**
   * `warning` as text or an icon on an ordinary surface. The same orange in
   * the dark themes, and a brown in light, where `warning` itself is too pale
   * on the page. A filled warning surface carries `onWarning`, so there is no
   * fill.
   */
  warningText: string;
  /** Subtle tinted background behind warning banners. */
  warningBg: string;
  /** Text/icon color on filled warning surfaces (always dark, for contrast against orange). */
  onWarning: string;
  backdrop: string;
  blurFallback: string;
  timeMorning: string;
  timeAfternoon: string;
  timeEvening: string;
  timeNight: string;
  tagPalette: string[];
};

/**
 * The stored theme setting. The strings predate the current names and are
 * kept because the setting syncs between devices: `'dark'` is Black (true
 * black, for OLED), `'darkPurple'` is Dark (the plum-tinted `nightColors`, and
 * what `'system'` uses after dark), and `'light'` is Light.
 */
export type ThemeMode = 'dark' | 'light' | 'system' | 'darkPurple';

// Ink and paper: the text colours, and what sits on an accent or `done` fill.
const INK = '#17131C';
const PAPER = '#F6F3F8';
// The accent: violet, deep enough for white on it in Light and pale enough for
// ink on it in Dark and Black.
const VIOLET_DEEP = '#6A3FDB';
const VIOLET_TEXT = '#6032D0';
const VIOLET_PALE = '#B9A0FF';

/**
 * Black: true black for OLED, and where anyone who picked the old Dark theme
 * (stored as `'dark'`) lands, so their page stays black. The neutrals are the
 * iOS greys it always had; the accent, `done` and `warning` are the brand's.
 */
export const darkColors: Colors = {
  bg: '#000000',
  bgSecondary: '#1C1C1E',
  bgTertiary: '#2C2C2E',
  bgQuaternary: '#3A3A3C',
  bgSunken: '#0E0E10',
  controlBorder: '#757579',
  text: '#FFFFFF',
  textSecondary: '#A6A6AA',
  textTertiary: '#939396',
  accent: VIOLET_PALE,
  accentSubtle: 'rgba(185, 160, 255, 0.16)',
  accentText: VIOLET_PALE,
  accentFill: VIOLET_PALE,
  green: '#4C9A76',
  greenText: '#51A47D',
  greenFill: '#418365',
  orange: '#FF9F0A',
  orangeText: '#FF9F0A',
  orangeFill: '#AA6700',
  red: '#FF453A',
  redText: '#FF594F',
  redFill: '#ED0D00',
  purple: '#BF5AF2',
  purpleText: '#C76DF4',
  purpleFill: '#B137EF',
  separator: '#38383A',
  onAccent: INK,
  onFill: '#FFFFFF',
  done: '#FFB020',
  onDone: INK,
  brand: '#FFB020',
  onBrand: INK,
  warning: '#FF9F0A',
  warningText: '#FF9F0A',
  warningBg: 'rgba(255, 159, 10, 0.16)',
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

/**
 * Dark: the brand's dark theme, and what `'system'` uses after dark. Near-black
 * surfaces with a slight plum bias (stored as `'darkPurple'`, the theme it
 * replaced), so a grey reads as chosen rather than inherited.
 */
export const nightColors: Colors = {
  bg: '#100E13',
  bgSecondary: '#1B1820',
  bgTertiary: '#27232D',
  bgQuaternary: '#36313D',
  bgSunken: '#0B0A0E',
  controlBorder: '#7B7388',
  text: PAPER,
  textSecondary: '#B3ADBD',
  textTertiary: '#8F889A',
  accent: VIOLET_PALE,
  accentSubtle: 'rgba(185, 160, 255, 0.16)',
  accentText: VIOLET_PALE,
  accentFill: VIOLET_PALE,
  green: '#4C9A76',
  greenText: '#53A680',
  greenFill: '#418365',
  orange: '#FF9F0A',
  orangeText: '#FF9F0A',
  orangeFill: '#AA6700',
  red: '#FF453A',
  redText: '#FF594F',
  redFill: '#ED0D00',
  purple: '#BF5AF2',
  purpleText: '#C76FF4',
  purpleFill: '#B137EF',
  separator: '#3A3541',
  onAccent: INK,
  onFill: '#FFFFFF',
  done: '#FFB020',
  onDone: INK,
  brand: '#FFB020',
  onBrand: INK,
  warning: '#FF9F0A',
  warningText: '#FF9F0A',
  warningBg: 'rgba(255, 159, 10, 0.16)',
  onWarning: '#000000',
  backdrop: 'rgba(8, 6, 12, 0.5)',
  blurFallback: 'rgba(27, 24, 32, 0.85)',
  timeMorning: '#FF9F0A',
  timeAfternoon: '#0A84FF',
  timeEvening: '#BF5AF2',
  timeNight: '#5E5CE6',
  tagPalette: [
    '#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2',
    '#5E5CE6', '#FF375F', '#64D2FF', '#FFD60A', '#AC8E68',
  ],
};

/** Light: ink text on a cool, faintly plum page, with a violet accent. */
export const lightColors: Colors = {
  bg: '#F3F2F5',
  bgSecondary: '#FFFFFF',
  bgTertiary: '#EFEDF3',
  bgQuaternary: '#D3D0D9',
  bgSunken: '#E7E5EB',
  controlBorder: '#8A8496',
  text: INK,
  textSecondary: '#4F4A57',
  textTertiary: '#6B6574',
  accent: VIOLET_DEEP,
  accentSubtle: 'rgba(106, 63, 219, 0.1)',
  accentText: VIOLET_TEXT,
  accentFill: VIOLET_DEEP,
  green: '#3D8563',
  greenText: '#377759',
  greenFill: '#3C8362',
  orange: '#FF9500',
  orangeText: '#9D5B00',
  orangeFill: '#AD6500',
  red: '#FF3B30',
  redText: '#D10B00',
  redFill: '#ED0D00',
  purple: '#AF52DE',
  purpleText: '#9F30D8',
  purpleFill: '#AA47DC',
  separator: '#C9C6CF',
  onAccent: '#FFFFFF',
  onFill: '#FFFFFF',
  done: '#C98500',
  onDone: INK,
  brand: '#FFB020',
  onBrand: INK,
  warning: '#FF9500',
  warningText: '#9D5B00',
  warningBg: 'rgba(255, 149, 0, 0.16)',
  onWarning: '#000000',
  backdrop: 'rgba(23, 19, 28, 0.35)',
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

/**
 * The text/icon colour for a fill chosen at runtime, which may be the accent
 * or a status colour (`freshnessFill`, a chip in its own colour). `onAccent`
 * follows the accent and is ink in the dark themes, so it can't sit on a
 * status fill; everything that isn't the accent carries `onFill`.
 */
export function textOnFill(fill: string, colors: Colors): string {
  return fill === colors.accentFill || fill === colors.accent ? colors.onAccent : colors.onFill;
}

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

/**
 * How far text may grow with the system text size (Dynamic Type), as a
 * multiple of the `font` size it was written at.
 *
 * React Native scales every `Text` and `TextInput` by the system setting unless
 * told otherwise; `AppFont.tsx` applies `max` to all of them, so a call site
 * never has to. 1.65 is iOS's first accessibility size: every standard size
 * (up to 1.35) is honoured in full, and the accessibility sizes past it, which
 * reach 3.1, stop there. Uncapped, at 2.35 a single task row fills a third of
 * the screen and Today's pill row runs off the edge. Icons don't take part:
 * the icon sets turn scaling off themselves.
 *
 * `badge` is for a count drawn in a small pill (a tab or header badge, the
 * Later count). Those still grow, so a number doesn't read as tiny beside
 * enlarged text, but less, since the badge sits on top of something else. A
 * badge box that takes it uses `minHeight` rather than `height`, or the larger
 * number is clipped. Text in a fixed shape with room to spare (a calendar day
 * circle, a weekday letter, an emoji tile) takes it too.
 *
 * `fixed` is for text whose box is grid geometry with no room to grow at all:
 * a calendar trip band, or a numbered dot in a column whose other dots are
 * icons. It stays at the size it was drawn at.
 */
export const textScale = {
  max: 1.65,
  badge: 1.35,
  fixed: 1,
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
    /**
     * A bottom sheet's own backdrop dimming, paired with the `spring.smooth`
     * open / `sheetExit` close it runs alongside (see `useSheetMotion`) — the same drift
     * `dismiss` above stops, for a different shape of sheet. Nine of them
     * (CategoryPicker, GroceryListSheet, PatchNotesModal, the sort/filter and
     * picker sheets, SideMenuDrawer, TaskRelationPickerSheet) had this
     * written out as the same 200/180 pair, wired to nothing.
     */
    sheetBackdropIn: 200,
    sheetBackdropOut: 180,
    /**
     * A bottom sheet's card leaving, a timed curve over its own height (see
     * `useSheetMotion`). It used to be a spring over a whole window height,
     * which only reported done once settled and so held every touch behind the
     * sheet for over a second after the card was gone.
     */
    sheetExit: 220,
  },
  spring: {
    snappy: { damping: 22, stiffness: 300, mass: 0.8 },
    smooth: { damping: 26, stiffness: 220, mass: 1.0 },
    bouncy: { damping: 15, stiffness: 350, mass: 0.9 },
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
