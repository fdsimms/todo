import React, { createContext, useContext, useMemo } from 'react';
import { Platform } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveFontFamily } from './fonts';

/**
 * The resolved `fontFamily` for the current setting, or `undefined` for the
 * platform default. Read by the patched `Text`/`TextInput` below, so it has to
 * be a context rather than a module variable: a module variable wouldn't
 * re-render anything when the setting changes, and re-mounting the tree to pick
 * a font up would drop navigation and screen state (you'd get bounced out of
 * Settings the moment you tapped a font).
 */
const AppFontContext = createContext<string | undefined>(undefined);

/** The app-wide font family, for the rare spot that builds a style outside a `Text`. */
export function useAppFontFamily(): string | undefined {
  return useContext(AppFontContext);
}

type AppFontProps = { style?: unknown; [key: string]: unknown };

const PATCHED_COMPONENTS = ['Text', 'TextInput'] as const;

let patched = false;

/**
 * Replace `Text` and `TextInput` on the `react-native` module object with
 * wrappers that prepend the chosen font family.
 *
 * Patching the module is what makes this setting a ~200 line change instead of
 * a diff across all 82 files that import from `react-native`, and it keeps
 * working for files added later — nothing has to remember to use an `AppText`.
 * It works because Babel compiles `import { Text } from 'react-native'` to a
 * *member access* (`_reactNative.Text`) evaluated at render time, not to a
 * binding captured at import: redefining the property here reaches every call
 * site, including ones in `@react-navigation` and other libraries, whatever
 * order the modules loaded in. The one thing that would break it is code doing
 * `const { Text } = require('react-native')` at module scope, which captures
 * the value early — the app has none, and ESM imports can't do it.
 *
 * The injected family goes **first** in the style array so an explicit
 * `fontFamily` still wins. That's load-bearing for `@expo/vector-icons`, which
 * renders its glyphs through this same `Text` with its icon font named in
 * `style` — reverse the order and every icon in the app turns into a letter.
 */
function applyFontPatch() {
  if (patched) return;
  patched = true;

  // Deliberately `require`, not `import * as RN`: Babel's namespace interop
  // copies a CommonJS module's properties into a fresh object, so we'd patch a
  // copy nothing renders from (and touching every getter would eagerly load all
  // of React Native on the way).
  const RN = require('react-native') as Record<string, React.ComponentType<AppFontProps>>;

  for (const name of PATCHED_COMPONENTS) {
    const Base = RN[name];
    if (!Base) continue;

    const WithAppFont = (props: AppFontProps) => {
      const fontFamily = useContext(AppFontContext);
      // The default option resolves to undefined, and then this is a pass-through:
      // no extra style array allocated per text node when nobody picked a font.
      if (!fontFamily) return <Base {...props} />;
      return <Base {...props} style={[{ fontFamily }, props.style]} />;
    };

    // Statics live on these exports and callers read them off the module —
    // `TextInput.State` is the one that exists today.
    Object.assign(WithAppFont, Base);
    WithAppFont.displayName = `AppFont(${name})`;

    Object.defineProperty(RN, name, {
      configurable: true,
      enumerable: true,
      get: () => WithAppFont,
    });
  }
}

// Runs on import — ThemeContext imports this module, and App.tsx imports
// ThemeContext, so the swap is in place well before the first render.
applyFontPatch();

export function AppFontProvider({ children }: { children: React.ReactNode }) {
  const appFont = useSettingsStore(s => s.appFont);
  const fontFamily = useMemo(() => resolveFontFamily(appFont, Platform.OS), [appFont]);

  return <AppFontContext.Provider value={fontFamily}>{children}</AppFontContext.Provider>;
}
