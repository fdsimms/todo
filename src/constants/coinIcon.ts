/**
 * The `icon` value that means "draw a `CoinIcon`" wherever a screen is named by
 * an Ionicons glyph (a menu destination, `EmptyState`, `EmptyNote`, a settings
 * row). Not a real Ionicons glyph, which is why it needs naming; the same
 * arrangement as `TARGET_ICON`.
 *
 * Its own file, not exported from `CoinIcon.tsx`, because `navHubs.ts` names
 * the Rewards screen's icon with it and a logic module can't import a component
 * (it would pull `react-native-svg` into the node-only test run).
 */
export const COIN_ICON = 'coin' as const;
