import type { TextStyle, ViewStyle } from 'react-native';
import { font, fontWeight, radius, spacing, type Colors } from './index';

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

/**
 * The box a text field sits in when the field is on a card: a `bgTertiary`
 * well, one step up from the card's `bgSecondary`, with no outline. Without
 * it a field on a card is bare text, and nothing says it can be typed into.
 * Put the `TextField` inside a `View` with this style (so a unit or an icon
 * can live in the box too), give the input `flex: 1` and no padding, and
 * never a `lineHeight` (see the TextInput note in CLAUDE.md).
 *
 * A field already on `bgTertiary` or on the page itself needs a different
 * step, so check what it sits on before reusing this.
 */
export const fieldWell = (colors: Colors): ViewStyle => ({
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.xs,
  backgroundColor: colors.bgTertiary,
  borderRadius: radius.md,
  paddingHorizontal: spacing.md,
  minHeight: 44,
});
