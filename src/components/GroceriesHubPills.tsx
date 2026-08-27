import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { listRemainingCount } from '../utils/groceryLists';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { featureHidden } from '../utils/simpleMode';
import { attentionLeftovers, freshnessOf } from '../utils/leftovers';
// The colour ladder lives with the card that established it — same import
// RecipePickerSheet makes, and for the reason given there.
import { freshnessColor } from './LeftoversCard';

type HubTab = 'Groceries' | 'Recipes' | 'MealPlan' | 'Kitchen';

const HUB_TABS: { name: HubTab; label: string }[] = [
  { name: 'Groceries', label: 'Groceries' },
  { name: 'Recipes', label: 'Recipes' },
  { name: 'MealPlan', label: 'Meal plan' },
  { name: 'Kitchen', label: 'Pantry' },
];

interface Props {
  active: HubTab;
}

/**
 * The Groceries/Recipes/Meal plan/Pantry switcher, shown under each of the
 * four screens' headers now that they share one "Groceries & Meals" menu
 * entry. These are sibling tabs in the same navigator (not a stack push), and
 * the app runs with `enableScreens(false)`, so a blurred tab stays mounted
 * rather than unmounting — `navigate` between them is effectively instant,
 * unlike the stale-frame problem a route-param-driven sub-view once had.
 *
 * **"Pantry" is the display label; the route and every file/type/function
 * behind it are still named `Kitchen`/`kitchen*`**, the same split as "Stack"
 * over `TaskGroup`. The internal name predates this label and still says what
 * the screen actually covers — pantry *and* fridge, read as one thing (see
 * `kitchenInventory.ts`) — where "Pantry" alone doesn't quite fit a container
 * of leftover chili. Renaming the code to match would be routing-table
 * churn for a label some sibling menu might rename again; the display string
 * is the only thing that needed to change.
 *
 * This tab used to be a sheet popped over Groceries rather than a destination
 * here, reached by stamping a param on a `navigate('Groceries', ...)` call.
 * That meant it never got this row's active/selected state, and every other
 * "open the kitchen" call site (a use-up task's link, Today's kitchen context
 * row) had to carry its own copy of the sheet. It's a screen now, like its
 * three siblings, so all of that collapses onto one navigation target.
 */
export function GroceriesHubPills({ active }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  // The list you're actually looking at, not every trolley you have going —
  // a pill reading 22 while the Airbnb list holds four is counting shopping
  // this tab won't show you. Off the entries, because a row can be in two
  // trolleys with a different tick in each: see GroceryListEntry.
  const groceryCount = useGroceryStore(s => listRemainingCount(s.listEntries, s.activeListId));
  // The leftovers nudge, and the whole reason it's here rather than only on the
  // meal plan itself: a container going off tomorrow is worth knowing about
  // while you're standing in the shop about to buy more food. Counted rather
  // than derived through attentionLeftovers so this selector returns a number —
  // an array would be a new reference on every store change and re-render all
  // three pills for nothing.
  const leftoverCount = useLeftoverStore(s => attentionLeftovers(s.leftovers).length);
  // Pantry goes with simplified mode: it is the screen for the per-item pantry,
  // freezer and use-by state that mode also takes off the item sheet, so with
  // nothing left to fill it there is nothing left for it to show. The pill
  // stays while you're standing on it, so the mode can't be flipped out from
  // under an open screen.
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const tabs = useMemo(
    () => HUB_TABS.filter(t =>
      t.name === active || t.name !== 'Kitchen' || !featureHidden('pantryTracking', simpleMode)),
    [simpleMode, active]
  );
  // Red for something already past its day, orange while there's still an
  // evening to use it — the ladder LeftoversCard sets out and gives its
  // reasoning for. This badge used to be red whatever it was counting, so a
  // container with a day left read orange on the card and red on the pill
  // directly above it (#1381). The count is `needsAttention`, which spans
  // both states, so the badge takes the colour of the worst one in it.
  const worstFreshness = useLeftoverStore(s =>
    attentionLeftovers(s.leftovers).some(l => freshnessOf(l) === 'over') ? 'over' : 'due'
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.pills}
    >
      {tabs.map(tab => {
        const isActive = tab.name === active;
        const badge = tab.name === 'Groceries' ? groceryCount
          : tab.name === 'MealPlan' ? leftoverCount
          : 0;
        // Two badges on one row counting different things, so each says what it
        // counts rather than reading out as a bare number.
        const badgeLabel = tab.name === 'Groceries'
          ? `${badge} to buy`
          : `${badge} to use up`;
        return (
          <TouchableOpacity
            key={tab.name}
            style={[styles.pill, isActive && styles.pillActive]}
            onPress={() => {
              if (isActive) return;
              haptics.tap();
              navigation.navigate(tab.name);
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={badge > 0 ? `${tab.label}, ${badgeLabel}` : tab.label}
          >
            <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{tab.label}</Text>
            {badge > 0 && (
              <View
                style={[
                  styles.pillBadge,
                  tab.name === 'MealPlan' && { backgroundColor: freshnessColor(worstFreshness, colors) },
                ]}
              >
                <Text style={styles.pillBadgeText}>{badge}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  pills: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: 6, paddingBottom: 4,
  },
  pill: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.bgSecondary,
  },
  pillActive: { backgroundColor: colors.accent },
  pillText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  pillBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
    // Accent, not red: the Groceries badge is a plain "N to buy" count, not
    // something urgent — the MealPlan pill overrides this per-row with
    // freshnessColor since that one *is* reporting something time-sensitive.
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  pillBadgeText: { color: colors.onAccent, fontSize: 9, fontWeight: fontWeight.bold },
});
