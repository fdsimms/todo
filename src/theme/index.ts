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
  tagPalette: string[];
};

export type ThemeMode = 'dark' | 'light' | 'system';

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
  green: '#30D158',
  orange: '#FF9F0A',
  red: '#FF453A',
  purple: '#BF5AF2',
  separator: '#38383A',
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
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  purple: '#AF52DE',
  separator: '#C6C6C8',
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
