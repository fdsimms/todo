import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NamedIcon } from './CoinIcon';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, interaction, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { tabPickerGroups, MIN_TAB_COUNT } from '../utils/navHubs';
import { useNavMenuOptions } from '../hooks/useNavMenuOptions';
import { PickerSheet, PICKER_SHEET_LIST_MAX_HEIGHT } from './CategoryPicker';

/** Ordinal names for the slots, for the title and for the tag on a row already in use. */
export const TAB_SLOT_NAMES = ['First tab', 'Second tab', 'Third tab', 'Fourth tab', 'Fifth tab'] as const;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Which slot is being set, 0-based. */
  slot: number;
  /** Every slot's current route, so a row already in use can say which tab it is. */
  tabRoutes: readonly string[];
  onSelect: (route: string) => void;
  /** Empties the slot. Only the optional fourth and fifth can be emptied. */
  onClear: () => void;
}

/**
 * Pick the screen for one tab slot, from every screen the side menu reaches,
 * grouped the way the menu groups them. A screen that's already another tab
 * says so, and picking it swaps the two (`setTabSlot`), which the hint says
 * up front rather than leaving it to be discovered.
 *
 * Commits on tap, so there is nothing staged to lose and no unsaved-changes
 * guard: the other valid answer to the pageSheet rule in CLAUDE.md.
 */
export function TabSlotPickerSheet({ visible, onClose, slot, tabRoutes, onSelect, onClear }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const menuOptions = useNavMenuOptions();
  const groups = useMemo(() => tabPickerGroups(menuOptions), [menuOptions]);
  const current = tabRoutes[slot];
  const empty = slot >= tabRoutes.length;
  const optional = slot >= MIN_TAB_COUNT;

  return (
    <PickerSheet visible={visible} onClose={onClose} title={TAB_SLOT_NAMES[slot] ?? 'Tab'}>
      {choose => (
        <ScrollView style={{ maxHeight: PICKER_SHEET_LIST_MAX_HEIGHT }}>
          <Text style={styles.hint}>
            {empty
              ? 'Screens that are already a tab can be changed from their own slot.'
              : "Picking a screen that's already a tab swaps the two."}
          </Text>
          {optional && (
            <TouchableOpacity
              style={styles.row}
              onPress={() => { haptics.tap(); choose(onClear); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityState={{ selected: empty }}
              accessibilityLabel={`No ${TAB_SLOT_NAMES[slot]?.toLowerCase() ?? "tab"}`}
            >
              <Ionicons name="ellipse-outline" size={iconSize.sm} color={empty ? colors.accent : colors.textSecondary} />
              <Text style={[styles.rowText, empty && styles.rowTextOn]} numberOfLines={1}>None</Text>
              {empty && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />}
            </TouchableOpacity>
          )}
          {groups.map(group => (
            <View key={group.label ?? '__screens__'}>
              {group.label !== null && <Text style={styles.groupLabel}>{group.label}</Text>}
              {group.destinations.map(destination => {
                const on = destination.route === current;
                const otherSlot = on ? -1 : tabRoutes.indexOf(destination.route);
                const tag = otherSlot >= 0 ? TAB_SLOT_NAMES[otherSlot] : null;
                // An empty slot has nothing to swap with, so a screen already in the bar is unavailable.
                const unavailable = empty && tag !== null;
                return (
                  <TouchableOpacity
                    key={destination.route}
                    style={[styles.row, unavailable && styles.rowUnavailable]}
                    disabled={unavailable}
                    onPress={() => { haptics.tap(); choose(() => onSelect(destination.route)); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on, disabled: unavailable }}
                    accessibilityLabel={tag ? `${destination.label}, now the ${tag.toLowerCase()}` : destination.label}
                  >
                    <NamedIcon
                      name={destination.icon}
                      size={iconSize.sm}
                      color={on ? colors.accent : colors.textSecondary}
                    />
                    <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={1}>
                      {destination.label}
                    </Text>
                    {tag !== null && (
                      <View style={styles.tag}>
                        <Text style={styles.tagText}>{tag}</Text>
                      </View>
                    )}
                    {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </PickerSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  hint: { color: colors.textSecondary, fontSize: font.xs, paddingBottom: spacing.sm },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    minHeight: 44,
  },
  rowUnavailable: { opacity: 0.5 },
  rowText: { flex: 1, color: colors.text, fontSize: font.md },
  rowTextOn: { color: colors.accent, fontWeight: fontWeight.semibold },
  tag: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  tagText: { color: colors.textSecondary, fontSize: font.xs },
});
