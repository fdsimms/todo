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

export const spacing = {
  xs: 4,
  sm: 8,
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

export const font = {
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
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.55 : 0.30,
    shadowRadius: 10,
    elevation: 8,
  },
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: isDark ? 0.45 : 0.12,
    shadowRadius: 12,
    elevation: 10,
  },
});
