import { StyleSheet } from 'react-native';

export type Colors = {
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  bgQuaternary: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentSubtle: string;
  green: string;
  orange: string;
  red: string;
  purple: string;
  separator: string;
  /** Text/icon color on filled accent/colored surfaces (always white, iOS-style). */
  onAccent: string;
  backdrop: string;
  blurFallback: string;
  timeMorning: string;
  timeAfternoon: string;
  timeEvening: string;
  tagPalette: string[];
};

export type ThemeMode = 'dark' | 'light' | 'system' | 'darkPurple';

export const darkColors: Colors = {
  bg: '#000000',
  bgSecondary: '#1C1C1E',
  bgTertiary: '#2C2C2E',
  bgQuaternary: '#3A3A3C',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#636366',
  accent: '#0A84FF',
  accentSubtle: 'rgba(10, 132, 255, 0.15)',
  green: '#4C9A76',
  orange: '#FF9F0A',
  red: '#FF453A',
  purple: '#BF5AF2',
  separator: '#38383A',
  onAccent: '#FFFFFF',
  backdrop: 'rgba(0, 0, 0, 0.45)',
  blurFallback: 'rgba(28, 28, 30, 0.85)',
  timeMorning: '#FF9F0A',
  timeAfternoon: '#0A84FF',
  timeEvening: '#BF5AF2',
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
  text: '#FFFFFF',
  textSecondary: '#9D93AD',
  textTertiary: '#6E6480',
  accent: '#0A84FF',
  accentSubtle: 'rgba(10, 132, 255, 0.15)',
  green: '#4C9A76',
  orange: '#FF9F0A',
  red: '#FF453A',
  purple: '#BF5AF2',
  separator: '#3D3550',
  onAccent: '#FFFFFF',
  backdrop: 'rgba(10, 6, 20, 0.5)',
  blurFallback: 'rgba(31, 26, 44, 0.85)',
  timeMorning: '#FF9F0A',
  timeAfternoon: '#0A84FF',
  timeEvening: '#BF5AF2',
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
  text: '#000000',
  textSecondary: '#6C6C70',
  textTertiary: '#8A8A8E',
  accent: '#007AFF',
  accentSubtle: 'rgba(0, 122, 255, 0.12)',
  green: '#3D8563',
  orange: '#FF9500',
  red: '#FF3B30',
  purple: '#AF52DE',
  separator: '#C6C6C8',
  onAccent: '#FFFFFF',
  backdrop: 'rgba(0, 0, 0, 0.35)',
  blurFallback: 'rgba(255, 255, 255, 0.85)',
  timeMorning: '#FF9500',
  timeAfternoon: '#007AFF',
  timeEvening: '#AF52DE',
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
  delayLongPress: 120,
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
