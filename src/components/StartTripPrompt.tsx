import React, { useMemo } from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';
import type { Shop } from '../types';

interface Props {
  /** Non-excluded shops on file. Empty means there's nothing to start. */
  suggestable: readonly Shop[];
  /** Opens `ShoppingTripSheet`, which is where the store is chosen. */
  onOpenSheet: () => void;
  /** How many rows are already ticked into the trolley, with no trip running. */
  checkedCount: number;
  /** Opens `FinishShoppingSheet`. Only called with something in the trolley. */
  onFinish: () => void;
}

/**
 * The Groceries list's one "start a trip" entry point — one line, no
 * ranking, no history required, for every household regardless of how much
 * purchase data is on file.
 *
 * **It never names a store, and the tap always opens the sheet.** It used to
 * read "Start shopping at Safeway" whenever exactly one store was on file, and
 * start that trip in one tap. Sitting on the list before anything has been
 * said, that sentence reads as the app asserting where you are rather than
 * offering somewhere to go — and it's the wrong store as often as a household
 * has a second one. The store is a choice, so it belongs where the choice is
 * made: `ShoppingTripSheet` opens with one preselected (best coverage, else
 * wherever the last trip ended), names it, and lets you change it before
 * Start. That costs the one-store household a tap and buys everyone a card
 * that only ever claims what it knows.
 *
 * It used to race with a data-backed `TripSuggestionCard` that rendered
 * whenever it had a coverage suggestion to make ("Likely has 2/3 items on
 * your list"), falling back to this only when that card had nothing to say
 * — fewer than two suggestable stores, or no purchase history yet. #1662
 * asked for the opposite: that card was permanent screen furniture on every
 * visit to Groceries, most of which are checking off items or browsing
 * recipes, not deciding where to shop, and it announced a coverage score
 * nobody asked for before there was any indication a trip was even being
 * planned. This is now the only thing `GroceryScreen` renders in that slot.
 * The coverage reasoning didn't go away — it's what `ShoppingTripSheet`
 * opens into and pre-selects with (`summarizeTrip`, `describeShopCoverage`
 * in shoppingTrip.ts), once you've actually said you're about to shop.
 *
 * **Ticking rows without starting a trip is shopping, and the card says so.**
 * Nothing infers a trip from a tick (see `docs/arch/groceries.md` — the mode
 * is explicit, because a wrongly-assumed store is what marks the list up with
 * claims about the wrong shelves). But a cart with something in it still has
 * to be finishable, and finishing used to live only on `bag-check-outline` in
 * the header, which is gone: a small target with a non-obvious glyph, offering
 * the action every shop ends in from the row of icons you scroll past. So the
 * first ticked row grows a Finish button here, ranked and worded exactly as
 * `ActiveTripBanner` ranks its own — filled, sized for a walking thumb, with
 * the store line kept above it as the quiet half. The two cards are the same
 * shape on purpose: the only difference is whether the app knows where you are.
 *
 * With no suggestable stores on file there is no store line to keep, and the
 * card is the Finish button alone. That case is why the whole thing can't stay
 * gated on `suggestable` being non-empty — someone with no stores recorded can
 * still tick a list off, and they'd have no way to finish it at all.
 */
export function StartTripPrompt({ suggestable, onOpenSheet, checkedCount, onFinish }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const shopping = checkedCount > 0;
  if (suggestable.length === 0 && !shopping) return null;

  const handleFinish = () => {
    haptics.tap();
    onFinish();
  };

  const startRow = suggestable.length > 0 && (
    <TouchableOpacity
      style={styles.summary}
      activeOpacity={interaction.activeOpacity}
      onPress={onOpenSheet}
      accessibilityRole="button"
      accessibilityLabel="Start shopping"
      accessibilityHint="Pick the store on the next screen"
    >
      <Ionicons name="storefront-outline" size={iconSize.sm} color={colors.accent} />
      <Text style={styles.title} numberOfLines={1}>
        Start shopping
      </Text>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.card}>
      {startRow}
      {shopping && (
        <PressableScale
          style={styles.finishButton}
          onPress={handleFinish}
          accessibilityLabel={`Finish shopping, ${checkedCount} in cart`}
        >
          <Ionicons name="bag-check-outline" size={iconSize.sm} color={colors.onAccent} />
          <Text style={styles.finishText}>Finish · {checkedCount} in cart</Text>
        </PressableScale>
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // Tinted rather than the list's own card surface: this is a starting
    // action sitting above the list, not the first row of it. The tint stays
    // when the Finish button appears, rather than switching to
    // `ActiveTripBanner`'s `bgSunken` — sunken is two or three percent off the
    // screen background in both themes, which is legible for a banner carrying
    // a neutral pill and not for one whose whole content is a filled accent
    // button floating in an invisible box. Checked in mock, both themes.
    card: {
      gap: spacing.sm,
      backgroundColor: colors.accent + '1A',
      borderRadius: radius.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    summary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    title: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    finishButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      backgroundColor: colors.accent,
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
      minHeight: 32,
      borderRadius: radius.full,
    },
    finishText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
  });
}
