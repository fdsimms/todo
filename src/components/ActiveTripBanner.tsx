import React, { useState } from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { itemsOnList, listCheckedCount } from '../utils/groceryLists';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { describeCartTotal, estimateCartTotal } from '../utils/groceryPrice';
import { TripBudgetPrompt } from './TripBudgetPrompt';
import { haptics } from '../utils/haptics';

interface Props {
  shopName: string;
  onChange: () => void;
  /**
   * Finish the trip — open `FinishShoppingSheet` on Groceries, or get to the
   * screen that has it from the other three. Never called while the cart is
   * empty; the button isn't rendered then.
   */
  onFinish: () => void;
  onClear: () => void;
}

/**
 * Shown on all four kitchen screens (Groceries, Recipes, Meal plan, Pantry)
 * while a trip is running — "I'm at this store" — sitting directly below
 * `HubPills` on each. There used to also be a `PersistentTripBar`
 * floating above the tab bar on every screen app-wide, kitchen or not; it's
 * gone, so a trip now shows nowhere outside these four, and this is the only
 * banner it gets on any of them.
 *
 * The same job `FocusBar` does on Today: a mode with no other visible
 * affordance needs one thing on screen saying it's on, and one way out.
 * That matters more here than there, because this mode is the reason grocery
 * rows have started carrying captions about other stores, and a caption whose
 * cause isn't on screen reads as the app having opinions.
 *
 * **Finishing the shop is the banner's job, and now only the banner's.** It
 * used to be reachable only from `bag-check-outline`, fifth in a row of header
 * icons, which is a small target with a non-obvious glyph for the one action
 * every trip ends in — while the banner spent its only button, accent-filled,
 * on *Clear*, the escape hatch. The ranking was backwards: the filled pill is
 * what the eye goes to, and it was offered to the action that throws the trip
 * away rather than the one that records it. So Finish is the filled pill,
 * sized to a walking thumb, and Clear is the quiet one beside it. The header
 * icon has since gone entirely; `StartTripPrompt` grows the same button in the
 * same shape for the other case, a cart ticked up with no trip running.
 *
 * **The count comes from the store, not a prop.** Same shape `HubPills`
 * and `SideMenuDrawer` already use for the list's own count: a derived scalar,
 * so the banner re-renders when the number changes and not on every unrelated
 * item edit. Threading it through four screens instead would be four filters
 * that can drift.
 *
 * **Finish appears with the first ticked row and not before**: a trip with an
 * empty cart has nothing to finish, and Clear is the honest way out of it.
 * (`StartTripPrompt` draws its own Finish on the same rule.) Coming and going
 * costs a layout change mid-shop, but it happens once, on the tick that makes
 * the button mean something — and `handleToggle` (GroceryScreen) already runs
 * that tick through `animateLayout`, so the banner grows with the row.
 *
 * On Groceries, `onChange` reopens the trip sheet in place and `onFinish` opens
 * the finish sheet. Elsewhere both are `resetToGroceries` (navigationRef.ts) —
 * those three screens have neither sheet of their own, so both mean going to
 * the one screen that can, `onFinish` asking it to open the sheet on arrival.
 *
 * On Groceries it is a sibling of the list rather than its
 * `ListHeaderComponent`: a mode indicator that scrolls away is one you can't
 * find when you want to turn it off, and it's the answer to "why does this row
 * say that" at the moment you're looking at the row. The two never appear
 * together — the starting card is for deciding where to go, and this says
 * you've gone — so the fixed height it costs is only ever paid during a shop.
 * `StartTripPrompt` is the list's header while it's only an invitation, and
 * moves up here beside this one once it's carrying a Finish button, for the
 * same reason this one is fixed.
 */
export function ActiveTripBanner({ shopName, onChange, onFinish, onClear }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  // Scoped to the active list, like everything else the trip touches: the
  // Finish button this number gates on finishes that list and no other.
  const checkedCount = useGroceryStore(s => listCheckedCount(s.listEntries, s.activeListId));
  // Scoped to the active list the same way, and through `itemsOnList` rather
  // than reading `checked` off `items`: that flag answers for the home list,
  // and a trolley is per-list. See GroceryListEntry.
  const cart = useGroceryStore(
    useShallow(s => estimateCartTotal(itemsOnList(s.items, s.listEntries, s.activeListId))),
  );
  const budgetMinor = useGroceryStore(s => s.tripBudgetMinor);
  const setTripBudget = useGroceryStore(s => s.setTripBudget);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const [budgetOpen, setBudgetOpen] = useState(false);

  const totalLine = describeCartTotal(cart, budgetMinor, currencySymbol);

  const handleClear = () => {
    haptics.tap();
    onClear();
  };

  const handleChange = () => {
    haptics.tap();
    onChange();
  };

  const handleFinish = () => {
    haptics.tap();
    onFinish();
  };

  const clearButton = (
    <PressableScale
      style={styles.clearButton}
      onPress={handleClear}
      accessibilityLabel={`Stop shopping at ${shopName}`}
    >
      <Text style={styles.clearText}>Stop</Text>
    </PressableScale>
  );

  return (
    <View style={styles.container}>
      <View style={styles.summaryRow}>
        <TouchableOpacity
          style={styles.summary}
          onPress={handleChange}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Shopping at ${shopName}. Change store`}
        >
          <Ionicons name="storefront-outline" size={iconSize.sm} color={colors.accent} />
          <Text style={styles.text} numberOfLines={1}>
            Shopping at <Text style={styles.shop}>{shopName}</Text>
          </Text>
          <Ionicons name="chevron-forward" size={iconSize.xs} color={colors.textTertiary} />
        </TouchableOpacity>
        {/* With nothing in the cart the row keeps its old shape: the store, and
            the one way out of the mode. */}
        {checkedCount === 0 && clearButton}
      </View>

      {/* The running total, and the one way to set what it is measured against.
          Shown only once something priced is in the trolley: `describeCartTotal`
          returns null before that, since a total of nothing says less than
          silence. Tapping it is how a budget gets set, changed or cleared — see
          TripBudgetPrompt for why the control lives here rather than at the
          moment a trip starts. */}
      {totalLine !== null && (
        <TouchableOpacity
          style={styles.totalRow}
          onPress={() => { haptics.tap(); setBudgetOpen(true); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={
            budgetMinor === null
              ? `${totalLine}. Set a trip budget`
              : `${totalLine}. Change the trip budget`
          }
        >
          <Ionicons name="pricetag-outline" size={iconSize.xs} color={colors.textSecondary} />
          {/* Wraps rather than truncating, which is not a style preference
              here. The clause most at risk of being ellipsised off the end is
              the coverage ("3 of 9 priced"), and a total that silently drops
              how much of the trolley it covers is the exact thing this feature
              refuses to ship — a floor reading as a measurement. Two lines is
              enough for the longest form at any plausible amount, and the
              banner is a sibling of the list rather than a fixed-height row, so
              growing costs nothing. */}
          <Text style={styles.totalText} numberOfLines={2}>{totalLine}</Text>
          <Ionicons name="chevron-forward" size={iconSize.xs} color={colors.textTertiary} />
        </TouchableOpacity>
      )}

      {checkedCount > 0 && (
        <View style={styles.actionRow}>
          {clearButton}
          <PressableScale
            style={styles.finishButton}
            onPress={handleFinish}
            accessibilityLabel={`Finish shopping at ${shopName}, ${checkedCount} in cart`}
          >
            <Ionicons name="bag-check-outline" size={iconSize.sm} color={colors.onAccent} />
            <Text style={styles.finishText}>Finish · {checkedCount} in cart</Text>
          </PressableScale>
        </View>
      )}

      <TripBudgetPrompt
        visible={budgetOpen}
        budgetMinor={budgetMinor}
        currencySymbol={currencySymbol}
        onSave={setTripBudget}
        onClose={() => setBudgetOpen(false)}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    backgroundColor: colors.bgSunken,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  shop: { fontWeight: fontWeight.bold },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // Both sides, not just the top: the action row below has no top margin of
    // its own, so a bare marginTop here would jam Finish against this line.
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  // flex: 1 with only two fixed glyphs beside it, so the number wins the row.
  totalText: { flex: 1, color: colors.textSecondary, fontSize: font.sm },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  clearButton: {
    // `bgSecondary` and not `bgTertiary`, which is what a neutral pill on a
    // *card* takes (InlineAction's own `surface` rule). This one sits on
    // `bgSunken`, and tertiary is only three percent off sunken in the light
    // theme — the pill all but disappears there, while a card surface on a
    // sunken region is the pairing `TaskGroupTray` already reads as raised in
    // both themes.
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  clearText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.bold },
  finishButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentFill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minHeight: 32,
    borderRadius: radius.full,
  },
  finishText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
});
