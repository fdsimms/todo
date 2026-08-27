import type { TextStyle } from 'react-native';
import { font, fontWeight, type Colors } from './index';

/**
 * The right-aligned "here's what this is currently set to" text — `EditorRow`'s
 * value, `CollapsibleField`'s collapsed summary, a Settings row's value.
 *
 * This is one of the two jobs bare accent text still has (the other is a sheet
 * header button, see `SheetHeaderButton`); an *action* gets a shape instead,
 * see `InlineAction`. It lives here because the same style had been written out
 * under four different names — `value`, `summary`, `rowValue`, `anchorValue` —
 * in three sizes and two weights, which is what made a value and a button
 * indistinguishable in the first place.
 *
 * Spread it into a `StyleSheet.create` entry and add layout on top:
 * `value: { ...disclosureValue(colors), flexShrink: 1 }`.
 */
export const disclosureValue = (colors: Colors): TextStyle => ({
  color: colors.accentText,
  fontSize: font.sm,
  fontWeight: fontWeight.medium,
});
