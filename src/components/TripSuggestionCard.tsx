import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  border,
  iconSize,
  interaction,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { planTrip, summarizeTrip, describeTripSuggestion } from '../utils/shoppingTrip';

interface Props {
  /** Opens the trip sheet, where the ranking behind this line lives. */
  onPress: () => void;
}

/**
 * Where this list would take you, at the top of the list itself.
 *
 * The ranking and the greedy cover it names already existed
 * (`shoppingTrip.ts`), but the only way to see them was to start creating a
 * shopping task — so the answer to "one stop or two this week?" sat behind a
 * button labelled for something else. This is the same computation on the
 * screen you're holding while you shop.
 *
 * It names one store and what it's likely to have, and taps through to
 * `ShoppingTripSheet` for the per-store breakdown, the corrections and the
 * tasks. Deliberately not a second place to *change* anything: two controls
 * for one plan is how the two would come to disagree.
 *
 * **It's kept short, because it sits on top of the list it describes** — every
 * row it pushes off the screen is a row of the actual list. The store name is
 * clamped to one line, and the padding is `sm` rather than `md` vertically.
 *
 * **The detail gets two lines, though, and that's deliberate.** It names the
 * items rather than only counting them, because "1/4" is a score and which
 * items it means is the actual question — and at 390pt a store's worth of item
 * names doesn't fit on one line, so clamping it to one would truncate exactly
 * the half worth reading. Two lines of names beats one line ending in "coff…".
 *
 * **A second stop is an offer on its own line, under a rule, and usually there
 * isn't one.** `describeTripSuggestion` returns it only when it clears
 * `extraStopThreshold`, so the third line is the exception rather than the
 * height this card always costs. The rule stays there rather than here: what
 * the card renders and what the sheet plans have to be the same computation,
 * or the two would recommend different trips on the same list.
 *
 * **Hidden rather than hedged when there's nothing to say.** No items, one
 * suggestable store, or a suggestion with no known and no likely item, and the
 * card doesn't render — a card reading "no idea, sorry" at the top of every
 * list is worse than the silence it replaced, and a store that has nothing on
 * record is exactly the case `describeTripSuggestion` returns null for.
 *
 * Every number is a floor, same as in the sheet: the app knows where you've
 * bought things, not what a shop stocks. Nothing here asserts an absence.
 */
export function TripSuggestionCard({ onPress }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const shops = useGroceryStore(useShallow(s => s.shops));

  const plan = useMemo(() => planTrip(items, itemShops, shops), [items, itemShops, shops]);
  const nameOf = useMemo(() => new Map(items.map(i => [i.id, i.name])), [items]);
  const copy = useMemo(() => {
    // Two suggestable stores is the floor. With one, "the fewest stores that
    // cover your list" has exactly one possible answer, and the card would be
    // reading the user the name of their only shop — which is also why the
    // header action skips the sheet at that count.
    if (plan.coverage.length < 2) return null;
    // An empty selection *is* the recommendation, same call the sheet makes to
    // pick its default — one code path for "where should I go".
    return describeTripSuggestion(summarizeTrip([], plan).suggestion, plan.itemIds.length, nameOf);
  }, [plan, nameOf]);

  if (!copy) return null;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={interaction.activeOpacity}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[`Suggested trip: ${copy.store}.`, copy.detail, copy.offer]
        .filter(Boolean)
        .join(' ')}
      accessibilityHint="Opens the shopping trip planner"
    >
      <Ionicons name="storefront-outline" size={iconSize.sm} color={colors.accent} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {copy.store}
        </Text>
        <Text style={styles.detail} numberOfLines={2}>
          {copy.detail}
        </Text>
        {copy.offer !== null && (
          <Text style={styles.offer} numberOfLines={2}>
            {copy.offer}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // Tinted rather than the list's own card surface: this is a suggestion
    // sitting above the list, not the first row of it.
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.accent + '1A',
      borderRadius: radius.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    text: { flex: 1 },
    title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    detail: { color: colors.textSecondary, fontSize: font.sm, marginTop: 1, lineHeight: 17 },
    // A hairline rather than a weight or colour change: the offer is the same
    // kind of statement as the detail above it — what a store is likely to have
    // — and the only thing separating them is which store. A rule says "these
    // are two answers" where a second grey would just look like more of the
    // first, and it's what keeps the store name in it findable at a glance.
    offer: {
      color: colors.textSecondary,
      fontSize: font.sm,
      lineHeight: 17,
      marginTop: spacing.xs + 2,
      paddingTop: spacing.xs + 2,
      borderTopWidth: border.hairline,
      borderTopColor: colors.separator,
    },
  });
}
