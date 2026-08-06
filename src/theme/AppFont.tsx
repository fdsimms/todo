import React, { createContext, useContext, useEffect, useReducer, useState } from 'react';
import { StyleSheet, type TextStyle } from 'react-native';
import * as Font from 'expo-font';
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveFontFace, type AppFont } from './fonts';
import { FONT_ASSETS, PREVIEW_FONT_ASSETS } from './fontAssets';

/**
 * The font every `Text` should render in, or `'system'` for the platform font.
 *
 * A context rather than a module variable because it has to re-render the app
 * when it changes: a module variable would change nothing until each component
 * happened to re-render, and re-mounting the tree to pick it up would drop
 * navigation state — you'd get bounced out of Settings the moment you tapped a
 * font.
 */
const AppFontContext = createContext<AppFont>('system');

/**
 * Faces registered with `Font.loadAsync` so far. Module scope, not state,
 * because font registration is global to the process: once a face is loaded it
 * stays loaded for every provider and every screen, and re-loading it on a
 * remount would flash the app back to the system font for no reason.
 */
const loadedFonts = new Set<AppFont>(['system']);

type AppFontProps = { style?: unknown; [key: string]: unknown };

const PATCHED_COMPONENTS = ['Text', 'TextInput'] as const;

let patched = false;

/**
 * Replace `Text` and `TextInput` on the `react-native` module object with
 * wrappers that render in the selected font.
 *
 * Patching the module is what makes this setting a self-contained change rather
 * than a diff across all 82 files that import from `react-native`, and it keeps
 * working for files added later — nothing has to remember to use an `AppText`.
 * It works because Babel compiles `import { Text } from 'react-native'` to a
 * *member access* (`_reactNative.Text`) evaluated at render time, not to a
 * binding captured at import: redefining the property here reaches every call
 * site, including ones inside `@react-navigation`, whatever order the modules
 * loaded in. The one thing that would break it is code doing
 * `const { Text } = require('react-native')` at module scope, which captures the
 * value early — the app has none, and ESM imports can't do it.
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
      const fontId = useContext(AppFontContext);
      // Nobody picked a font (or it hasn't loaded yet): pass straight through,
      // so the default costs no flatten and no extra style array per text node.
      if (fontId === 'system') return <Base {...props} />;

      const flat = StyleSheet.flatten(props.style as TextStyle) ?? {};

      // Any opinion about the family wins and is left completely alone.
      // Load-bearing for @expo/vector-icons, which draws its glyphs through this
      // same `Text` with the icon font named in `style` — override that and
      // every icon in the app turns into a letter.
      //
      // `in` rather than a truthiness check because `fontFamily: undefined` is
      // itself an opinion — it means "the platform font", the only way to say
      // that, and it's how the picker's System row previews the real default
      // instead of whichever font is currently selected. Style flattening keeps
      // the key when the value is undefined, which is what makes it expressible.
      if ('fontFamily' in flat) return <Base {...props} />;

      const fontFamily = resolveFontFace(fontId, flat.fontWeight);
      if (!fontFamily) return <Base {...props} />;

      // fontWeight is cleared because the face already *is* the weight. Left in,
      // iOS would look for a heavier member of a one-face family and synthesise
      // a smeared fake-bold on top of an already-semibold face.
      return <Base {...props} style={[props.style, { fontFamily, fontWeight: undefined }]} />;
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
  const [, onFontLoaded] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (appFont === 'system' || loadedFonts.has(appFont)) return;

    let cancelled = false;
    Font.loadAsync(FONT_ASSETS[appFont])
      .then(() => {
        loadedFonts.add(appFont);
        if (!cancelled) onFontLoaded();
      })
      .catch((e: unknown) => {
        // Stay on the system font rather than naming a family that never
        // registered, which renders as the platform font anyway but logs on
        // every single text node.
        console.warn(`Could not load the ${appFont} font`, e);
      });

    return () => { cancelled = true; };
  }, [appFont]);

  // Until the faces are registered, `fontFamily: 'Nunito_400Regular'` names
  // nothing — so hold on the system font for the frame or two it takes rather
  // than rendering against a family that doesn't exist yet.
  const active = loadedFonts.has(appFont) ? appFont : 'system';

  return <AppFontContext.Provider value={active}>{children}</AppFontContext.Provider>;
}

/**
 * Loads the regular face of every bundled font, so the picker can show each
 * option in its own typeface instead of previewing four of them in SF Pro.
 * Only the weight the preview needs — picking a font still loads its other three.
 */
export function useFontPreviewsLoaded(): boolean {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Font.loadAsync(PREVIEW_FONT_ASSETS)
      .then(() => { if (!cancelled) setLoaded(true); })
      .catch(() => { /* previews fall back to the system font; the setting still works */ });

    return () => { cancelled = true; };
  }, []);

  return loaded;
}
