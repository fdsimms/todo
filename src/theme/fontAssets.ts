import type { AppFont } from './fonts';

/**
 * Face name -> bundled `.ttf`, in the shape `Font.loadAsync` wants.
 *
 * Split out from `fonts.ts` so that module stays pure and importable by the
 * tests — Jest doesn't transform assets or `react-native`, and one `require` of
 * a `.ttf` in there would take the whole font table down with it.
 *
 * The keys must match the face names in `fonts.ts` exactly: they're what
 * `Font.loadAsync` registers the face under and therefore what `fontFamily` has
 * to say later. `fonts.test.ts` checks the two agree.
 *
 * Required per-file rather than from each package's index: the index re-exports
 * every weight the family publishes (eight for some), and Metro bundles what's
 * reachable, so importing it would ship four faces we don't use per family.
 */
export const FONT_ASSETS: Record<Exclude<AppFont, 'system'>, Record<string, number>> = {
  bricolage: {
    BricolageGrotesque_400Regular: require('@expo-google-fonts/bricolage-grotesque/400Regular/BricolageGrotesque_400Regular.ttf'),
    BricolageGrotesque_500Medium: require('@expo-google-fonts/bricolage-grotesque/500Medium/BricolageGrotesque_500Medium.ttf'),
    BricolageGrotesque_600SemiBold: require('@expo-google-fonts/bricolage-grotesque/600SemiBold/BricolageGrotesque_600SemiBold.ttf'),
    BricolageGrotesque_700Bold: require('@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf'),
  },
  fraunces: {
    Fraunces_400Regular: require('@expo-google-fonts/fraunces/400Regular/Fraunces_400Regular.ttf'),
    Fraunces_500Medium: require('@expo-google-fonts/fraunces/500Medium/Fraunces_500Medium.ttf'),
    Fraunces_600SemiBold: require('@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf'),
    Fraunces_700Bold: require('@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf'),
  },
  spaceGrotesk: {
    SpaceGrotesk_400Regular: require('@expo-google-fonts/space-grotesk/400Regular/SpaceGrotesk_400Regular.ttf'),
    SpaceGrotesk_500Medium: require('@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf'),
    SpaceGrotesk_600SemiBold: require('@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.ttf'),
    SpaceGrotesk_700Bold: require('@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf'),
  },
  nunito: {
    Nunito_400Regular: require('@expo-google-fonts/nunito/400Regular/Nunito_400Regular.ttf'),
    Nunito_500Medium: require('@expo-google-fonts/nunito/500Medium/Nunito_500Medium.ttf'),
    Nunito_600SemiBold: require('@expo-google-fonts/nunito/600SemiBold/Nunito_600SemiBold.ttf'),
    Nunito_700Bold: require('@expo-google-fonts/nunito/700Bold/Nunito_700Bold.ttf'),
  },
  outfit: {
    Outfit_400Regular: require('@expo-google-fonts/outfit/400Regular/Outfit_400Regular.ttf'),
    Outfit_500Medium: require('@expo-google-fonts/outfit/500Medium/Outfit_500Medium.ttf'),
    Outfit_600SemiBold: require('@expo-google-fonts/outfit/600SemiBold/Outfit_600SemiBold.ttf'),
    Outfit_700Bold: require('@expo-google-fonts/outfit/700Bold/Outfit_700Bold.ttf'),
  },
};

/**
 * The regular face of each bundled font, for previewing all the options at once.
 *
 * Derived rather than listed so adding a font can't half-land: a hand-kept copy
 * of this map would leave the new option previewing in the *selected* font,
 * which looks like a working row rather than a missing one.
 */
export const PREVIEW_FONT_ASSETS: Record<string, number> = Object.fromEntries(
  Object.values(FONT_ASSETS).flatMap(faces =>
    Object.entries(faces).filter(([face]) => face.endsWith('_400Regular'))
  )
);
