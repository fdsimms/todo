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
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { NAV_HUBS, visibleHubMembers, type NavHubId } from '../utils/navHubs';
import { attentionLeftovers, freshnessOf } from '../utils/leftovers';
// The colour ladder lives with the card that established it — same import
// RecipePickerSheet makes, and for the reason given there.
import { freshnessColor } from './LeftoversCard';

interface Props {
  hub: NavHubId;
  /** The route this screen is, so its own pill reads as selected. */
  active: string;
}

/**
 * The pill row under a hub screen's header, and the only way between the
 * screens sharing one side-menu row.
 *
 * This was `GroceriesHubPills`, hard-coded to the four kitchen routes. Three
 * more hubs now exist (see `navHubs.ts`), and three more copies of this file
 * is exactly the drift `SheetHeaderButton` and `InlineAction` were created to
 * undo — so the tab set moved into data and the component kept only the
 * layout. What a caller says is which hub it belongs to and which route it is.
 *
 * These are sibling routes in the same navigator (not a stack push), and the
 * app runs with `enableScreens(false)`, so a blurred tab stays mounted rather
 * than unmounting: `navigate` between them is effectively instant.
 *
 * **The active pill is never filtered out.** Simplified mode can hide a hub
 * member, but hiding the one you are standing on would take away the row that
 * says where you are — and the mode can be flipped from Settings while a
 * screen sits behind it.
 */
export function HubPills({ hub, active }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const simpleMode = useSettingsStore(s => s.simpleMode);
  // Scalars, so each selector is referentially stable and the row doesn't
  // re-render every time a stack or template is edited.
  const stacks = useTaskGroupStore(s => s.groups.length);
  const templates = useTemplateStore(s => s.templates.length);
  const people = usePersonStore(s => s.people.length);

  // The list you're actually looking at, not every trolley you have going — a
  // pill reading 22 while the Airbnb list holds four is counting shopping this
  // tab won't show you. Off the entries, because a row can be in two trolleys
  // with a different tick in each: see GroceryListEntry.
  //
  // Both kitchen counts are computed inside the selector and short-circuit to
  // 0 for the other hubs. Subscribing is cheap; what would cost is a *changing*
  // value, and a constant 0 never re-renders an Organize or History screen.
  const groceryCount = useGroceryStore(s =>
    hub === 'kitchen' ? listRemainingCount(s.listEntries, s.activeListId) : 0);
  // The leftovers nudge, and the whole reason it's here rather than only on the
  // meal plan itself: a container going off tomorrow is worth knowing about
  // while you're standing in the shop about to buy more food. Counted rather
  // than derived through attentionLeftovers so this selector returns a number —
  // an array would be a new reference on every store change.
  const leftoverCount = useLeftoverStore(s =>
    hub === 'kitchen' ? attentionLeftovers(s.leftovers).length : 0);
  // Red for something already past its day, orange while there's still an
  // evening to use it — the ladder LeftoversCard sets out and gives its
  // reasoning for. This badge used to be red whatever it was counting, so a
  // container with a day left read orange on the card and red on the pill
  // directly above it (#1381). The count is `needsAttention`, which spans both
  // states, so the badge takes the colour of the worst one in it.
  const worstFreshness = useLeftoverStore(s =>
    attentionLeftovers(s.leftovers).some(l => freshnessOf(l) === 'over') ? 'over' : 'due');

  const tabs = useMemo(() => {
    const definition = NAV_HUBS.find(h => h.id === hub);
    if (!definition) return [];
    const shown = visibleHubMembers(definition, simpleMode, { stacks, templates, people });
    if (shown.some(m => m.route === active)) return shown;
    // Standing on a hidden member: put it back, in its own place.
    return definition.members.filter(m => m.route === active || shown.includes(m));
  }, [hub, active, simpleMode, stacks, templates, people]);

  if (tabs.length < 2) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.pills}
    >
      {tabs.map(tab => {
        const isActive = tab.route === active;
        const badge = tab.route === 'Groceries' ? groceryCount
          : tab.route === 'MealPlan' ? leftoverCount
          : 0;
        // Two badges on one row counting different things, so each says what it
        // counts rather than reading out as a bare number.
        const badgeLabel = tab.route === 'Groceries'
          ? `${badge} to buy`
          : `${badge} to use up`;
        return (
          <TouchableOpacity
            key={tab.route}
            style={[styles.pill, isActive && styles.pillActive]}
            onPress={() => {
              if (isActive) return;
              haptics.tap();
              navigation.navigate(tab.route);
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
                  isActive && styles.pillBadgeActive,
                  tab.route === 'MealPlan' && !isActive && { backgroundColor: freshnessColor(worstFreshness, colors) },
                ]}
              >
                <Text style={[styles.pillBadgeText, isActive && styles.pillBadgeTextActive]}>{badge}</Text>
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
  pillActive: { backgroundColor: colors.accentFill },
  pillText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  pillBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
    // Accent, not red: the Groceries badge is a plain "N to buy" count, not
    // something urgent — the MealPlan pill overrides this per-row with
    // freshnessColor since that one *is* reporting something time-sensitive.
    backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center',
  },
  pillBadgeActive: {
    backgroundColor: colors.orange,
  },
  pillBadgeText: { color: colors.onAccent, fontSize: 9, fontWeight: fontWeight.bold },
  pillBadgeTextActive: { color: colors.onAccent },
});
