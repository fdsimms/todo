import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, darkPurpleColors, lightColors, getShadows, type Colors, type ThemeMode } from './index';
import { useSettingsStore } from '../store/useSettingsStore';

type Shadows = ReturnType<typeof getShadows>;

interface ThemeContextValue {
  colors: Colors;
  isDark: boolean;
  shadows: Shadows;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: darkColors,
  isDark: true,
  shadows: getShadows(true),
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useSettingsStore(s => s.themeMode);
  const systemScheme = useColorScheme();

  const isDark =
    themeMode === 'dark' ||
    themeMode === 'darkPurple' ||
    (themeMode === 'system' && systemScheme !== 'light');

  const resolvedColors =
    themeMode === 'darkPurple' ? darkPurpleColors : isDark ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: resolvedColors, isDark, shadows: getShadows(isDark) }),
    [resolvedColors, isDark]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useColors(): Colors {
  return useContext(ThemeContext).colors;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
