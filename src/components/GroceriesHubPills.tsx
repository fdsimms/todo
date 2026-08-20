import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { attentionLeftovers, freshnessOf } from '../utils/leftovers';
// The colour ladder lives with the card that established it — same import
// RecipePickerSheet makes, and for the reason given there.
import { freshnessColor } from './LeftoversCard';

type HubTab = 'Groceries' | 'Recipes' | 'MealPlan';

const HUB_TABS: { name: HubTab; label: string }[] = [
  { name: 'Groceries', label: 'Groceries' },
  { name: 'Recipes', label: 'Recipes' },
  { name: 'MealPlan', label: 'Meal plan' },
];

// Not a fourth hub screen — Kitchen is a sheet over Groceries (KitchenSheet),
// reached the same way the "Use up X" task link and the persistent trip
// bar's Finish button already reach sheets on other screens: navigate to the
// screen that owns it with a stamped param it's watching for
// (`GroceryScreen`'s `route.params?.openKitchen` effect). So it never gets
// an active/selected state like the three real tabs above it — it's an
// action pill, not a destination.

interface Props {
  active: HubTab;
}

/**
 * The Groceries/Recipes/Meal plan switcher, shown under each of the three
 * screens' headers now that they share one "Groceries & Meals" menu entry.
 * These are sibling tabs in the same navigator (not a stack push), and the
 * app runs with `enableScreens(false)`, so a blurred tab stays mounted
 * rather than unmounting — `navigate` between them is effectively instant,
 * unlike the stale-frame problem a route-param-driven sub-view once had.
 */
export function GroceriesHubPills({ active }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const groceryCount = useGroceryStore(s => s.items.filter(i => i.onList && !i.checked).length);
  // The leftovers nudge, and the whole reason it's here rather than only on the
  // meal plan itself: a container going off tomorrow is worth knowing about
  // while you're standing in the shop about to buy more food. Counted rather
  // than derived through attentionLeftovers so this selector returns a number —
  // an array would be a new reference on every store change and re-render all
  // three pills for nothing.
  const leftoverCount = useLeftoverStore(s => attentionLeftovers(s.leftovers).length);
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
      {HUB_TABS.map(tab => {
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
      <TouchableOpacity
        style={styles.pill}
        onPress={() => {
          haptics.tap();
          navigation.navigate('Groceries', { openKitchen: Date.now() });
        }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel="Kitchen — what you have and what to use up"
      >
        <Text style={styles.pillText}>Kitchen</Text>
      </TouchableOpacity>
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
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: colors.bgSecondary,
  },
  pillActive: { backgroundColor: colors.accent },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  pillBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
    backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center',
  },
  pillBadgeText: { color: colors.onAccent, fontSize: 9, fontWeight: fontWeight.bold },
});
