/**
 * The app's selectable typefaces.
 *
 * Every face listed here is **already installed on the device** — nothing is
 * bundled. That's the whole reason the set is platform-specific rather than one
 * font name per option: shipping our own `.ttf`s would mean font assets in the
 * bundle, an `expo-font` load gate before the first frame can draw text, and a
 * hand-written weight -> family map (iOS matches `fontWeight` against faces
 * registered under one family name, which bundled statics are not). Device
 * fonts cost none of that and iOS' bundled families are good ones.
 *
 * `undefined` means "don't set `fontFamily` at all" — the platform UI font
 * (SF Pro on iOS, Roboto on Android), i.e. exactly what every screen rendered
 * before this setting existed. That's why `system` carries no family: the
 * default option has to be a true no-op, not a re-statement of the default,
 * so a face Apple changes under us keeps being followed.
 *
 * Android gets the nearest generic alias rather than a match. The named
 * families below are iOS-bundled and don't exist there, and Android's own
 * catalogue is four generics deep (`sans-serif`, `sans-serif-condensed`,
 * `serif`, `monospace`), so "Avenir" lands back on Roboto. The app is iOS-first
 * — the widget target and CI's `expo export --platform ios` both say so — and
 * this keeps Android legible instead of falling back to a missing family.
 */

export type AppFont = 'system' | 'avenir' | 'serif' | 'mono' | 'condensed';

export type AppFontOption = {
  id: AppFont;
  label: string;
  /** One-line description of what the face does to the app — the only in-app documentation this option has. */
  hint: string;
  /** iOS family name, or undefined for "leave the platform default alone". */
  ios?: string;
  android?: string;
};

export const APP_FONT_OPTIONS: AppFontOption[] = [
  {
    id: 'system',
    label: 'System',
    hint: 'The default. SF Pro on iOS, Roboto on Android.',
  },
  {
    id: 'avenir',
    label: 'Avenir Next',
    hint: 'Rounder and wider. Friendlier, and a touch less fits on a line.',
    ios: 'Avenir Next',
    android: 'sans-serif',
  },
  {
    id: 'serif',
    label: 'Charter',
    hint: 'A serif built for screens — reads more like a notebook than an app.',
    ios: 'Charter',
    android: 'serif',
  },
  {
    id: 'mono',
    label: 'Menlo',
    hint: 'Fixed-width. Numbers and times line up in columns; long titles run wide.',
    ios: 'Menlo',
    android: 'monospace',
  },
  {
    id: 'condensed',
    label: 'Avenir Condensed',
    hint: 'Narrow. Fits noticeably more of a long task title before it truncates.',
    ios: 'Avenir Next Condensed',
    android: 'sans-serif-condensed',
  },
];

export const DEFAULT_APP_FONT: AppFont = 'system';

export function isAppFont(value: string | null | undefined): value is AppFont {
  return !!value && APP_FONT_OPTIONS.some(o => o.id === value);
}

export function getAppFontOption(id: AppFont): AppFontOption | undefined {
  return APP_FONT_OPTIONS.find(o => o.id === id);
}

/**
 * The `fontFamily` to apply app-wide for `id`, or `undefined` to leave text on
 * the platform default. `os` is `Platform.OS`, passed in rather than read here
 * so this stays a pure module the tests can import without React Native.
 */
export function resolveFontFamily(id: AppFont, os: string): string | undefined {
  const option = getAppFontOption(id);
  if (!option) return undefined;
  if (os === 'ios') return option.ios;
  if (os === 'android') return option.android;
  return undefined;
}
