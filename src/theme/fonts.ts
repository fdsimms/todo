/**
 * The app's selectable typefaces.
 *
 * Apart from `system`, these are bundled — four static `.ttf` faces each, from
 * the `@expo-google-fonts/*` packages, loaded at runtime by `AppFont.tsx`. They
 * are bundled rather than picked from the OS because every face iOS ships is a
 * *neutral* one: SF Pro, Avenir, Charter and Menlo are competent and say
 * nothing. The point of this setting is to change the app's character, and that
 * needs faces the OS doesn't have.
 *
 * **Static faces don't respond to `fontWeight`.** Each `.ttf` registers under
 * its own family name (`Nunito_600SemiBold`), so iOS has no family to search
 * for a heavier member of — asking for weight 600 on `Nunito_400Regular` gets
 * you either the regular or a synthetic smear of it. So a face is chosen by
 * weight up front (`resolveFontFace`) and `fontWeight` is dropped from the
 * style, which is why every family here must ship all four weights the app
 * uses. The weight survey: 600 (56 uses), 500 (35), 700 (14), 400 (4).
 *
 * `system` is the absence of all this — no family, no loading, nothing
 * bundled, `fontWeight` handled natively by SF Pro / Roboto. It's the default
 * and it stays a true no-op, so the OS keeps deciding what the app looks like
 * for anyone who never opens this setting.
 */

export type AppFont = 'system' | 'bricolage' | 'fraunces' | 'spaceGrotesk' | 'nunito' | 'outfit';

/** The weights the app actually uses. Every bundled family ships a face for each. */
export type FontWeightKey = 400 | 500 | 600 | 700;

export const FONT_WEIGHT_KEYS: FontWeightKey[] = [400, 500, 600, 700];

export type AppFontOption = {
  id: AppFont;
  label: string;
  /** One-line description of the mood it gives the app — the only in-app documentation this option has. */
  hint: string;
  /**
   * Weight -> registered face name. The face names are the keys `AppFont.tsx`
   * hands to `Font.loadAsync`, so these two have to agree exactly; there is no
   * way to ask the OS which name a `.ttf` registered under.
   */
  faces?: Record<FontWeightKey, string>;
};

const facesFor = (family: string): Record<FontWeightKey, string> => ({
  400: `${family}_400Regular`,
  500: `${family}_500Medium`,
  600: `${family}_600SemiBold`,
  700: `${family}_700Bold`,
});

export const APP_FONT_OPTIONS: AppFontOption[] = [
  {
    id: 'system',
    label: 'System',
    hint: 'The default. SF Pro on iOS, Roboto on Android.',
  },
  {
    id: 'bricolage',
    label: 'Bricolage',
    hint: 'Editorial and a little wonky. Narrow enough that long titles still fit.',
    faces: facesFor('BricolageGrotesque'),
  },
  {
    id: 'fraunces',
    label: 'Fraunces',
    hint: 'A warm, soft-edged serif. Turns the list into something more like a journal.',
    faces: facesFor('Fraunces'),
  },
  {
    id: 'spaceGrotesk',
    label: 'Space Grotesk',
    hint: 'Precise and a bit technical. Distinctive numerals for times and counts.',
    faces: facesFor('SpaceGrotesk'),
  },
  {
    id: 'nunito',
    label: 'Nunito',
    hint: 'Rounded and soft. The friendliest of the set, and the widest.',
    faces: facesFor('Nunito'),
  },
  {
    id: 'outfit',
    label: 'Outfit',
    hint: 'Geometric and even, on near-circular shapes. The tidiest of the set.',
    faces: facesFor('Outfit'),
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
 * Snap any React Native `fontWeight` onto one of the four faces we ship.
 *
 * Anything lighter than regular rounds up and anything heavier than bold rounds
 * down, rather than failing to resolve: a face that isn't bundled would render
 * as the platform font and break the page mid-list. `undefined` is regular,
 * matching React Native's own default.
 */
export function normalizeFontWeight(weight: string | number | undefined | null): FontWeightKey {
  if (weight == null || weight === 'normal') return 400;
  if (weight === 'bold') return 700;

  const numeric = typeof weight === 'number' ? weight : parseInt(weight, 10);
  if (Number.isNaN(numeric)) return 400;
  if (numeric <= 400) return 400;
  if (numeric < 600) return 500;
  if (numeric < 700) return 600;
  return 700;
}

/**
 * The registered face name for a font at a given weight, or `undefined` to
 * leave text on the platform font (the `system` option, or an id no longer shipped).
 */
export function resolveFontFace(
  id: AppFont,
  weight: string | number | undefined | null
): string | undefined {
  const faces = getAppFontOption(id)?.faces;
  if (!faces) return undefined;
  return faces[normalizeFontWeight(weight)];
}

/** Every face name a font needs loaded before it can render. */
export function faceNamesFor(id: AppFont): string[] {
  const faces = getAppFontOption(id)?.faces;
  return faces ? FONT_WEIGHT_KEYS.map(w => faces[w]) : [];
}

/**
 * One random pick from the user's chosen pool, for the "randomize on cold
 * start" setting — `null` if the pool is empty rather than falling back to a
 * default, so the caller can leave `appFont` exactly where it was.
 *
 * `random` takes a 0..1 source rather than reading `Math.random()` directly,
 * so a test can hand it a fixed value and assert a specific pick.
 */
export function pickRandomAppFont(pool: AppFont[], random: () => number = Math.random): AppFont | null {
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)];
}
