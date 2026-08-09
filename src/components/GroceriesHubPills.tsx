import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useGroceryStore } from '../store/useGroceryStore';

type HubTab = 'Groceries' | 'Recipes' | 'MealPlan';

const HUB_TABS: { name: HubTab; label: string }[] = [
  { name: 'Groceries', label: 'Groceries' },
  { name: 'Recipes', label: 'Recipes' },
  { name: 'MealPlan', label: 'Meal plan' },
];

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

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.pills}
    >
      {HUB_TABS.map(tab => {
        const isActive = tab.name === active;
        const badge = tab.name === 'Groceries' ? groceryCount : 0;
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
            accessibilityLabel={badge > 0 ? `${tab.label}, ${badge}` : tab.label}
          >
            <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{tab.label}</Text>
            {badge > 0 && (
              <View style={styles.pillBadge}>
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
