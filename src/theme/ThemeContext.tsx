import React, { createContext, useContext, useDeferredValue, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, nightColors, lightColors, getShadows, type Colors, type ThemeMode } from './index';
import { useSettingsStore } from '../store/useSettingsStore';
import { AppFontProvider } from './AppFont';

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
  // Deferred so a switch is two renders: the picker's own highlight commits
  // at once (it reads the store directly), and the app-wide re-render that
  // rebuilds every `makeStyles(colors)` follows at low priority instead of
  // holding the tap until it finishes. Only the resolved colors lag behind.
  const themeMode = useDeferredValue(useSettingsStore(s => s.themeMode));
  const systemScheme = useDeferredValue(useColorScheme());

  const isDark =
    themeMode === 'dark' ||
    themeMode === 'darkPurple' ||
    (themeMode === 'system' && systemScheme !== 'light');

  // 'dark' is the Black theme (the stored name predates it, see `ThemeMode`);
  // every other dark resolution, the system's included, is the brand's Dark.
  const resolvedColors =
    !isDark ? lightColors : themeMode === 'dark' ? darkColors : nightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: resolvedColors, isDark, shadows: getShadows(isDark) }),
    [resolvedColors, isDark]
  );

  return (
    <ThemeContext.Provider value={value}>
      {/* Sits here rather than in App.tsx so anything under the theme is also
          under the font — the two are one "appearance" layer. */}
      <AppFontProvider>{children}</AppFontProvider>
    </ThemeContext.Provider>
  );
}

export function useColors(): Colors {
  return useContext(ThemeContext).colors;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
