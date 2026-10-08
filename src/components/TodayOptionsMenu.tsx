import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { CardSheet, type CardAnchor } from './CardSheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  hideCategories: boolean;
  onHideCategoriesChange: (v: boolean) => void;
  /** Opens the "lighten today" sheet. Omitted when there's nothing on the day to move. */
  onLightenDay?: () => void;
  /** Summary of the day's planned time, shown as the action's hint. */
  plannedLabel?: string;
  /**
   * One extra line under "Lighten today" while a low run is going — see
   * lowMoodDeloadNote. Absent is the normal case and renders exactly as before.
   */
  lightenNote?: string | null;
  /**
   * Opens the "look ahead" sheet — everything landing before a date, and
   * whether it fits. Passed whenever it exists, like onPullFromProjects: an
   * empty today says nothing about the two weeks ahead, which is the whole
   * point of looking past it. Omitted only by simplified mode, which takes the
   * sheet away entirely.
   */
  onLookAhead?: () => void;
  /**
   * Opens the "pull from projects" sheet. Passed unconditionally, unlike
   * onLightenDay — it's how you go looking for a quiet project rather than
   * waiting to be offered one, and it explains itself when nothing is quiet.
   */
  onPullFromProjects: () => void;
  /**
   * Jumps into Settings at Today's first setting, with `settingsHint` naming
   * the ones beside it. Omitted when none are on show, and the row goes with it.
   */
  onOpenSettings?: () => void;
  settingsHint?: string;
  /**
   * Opens the focus session setup sheet, seeded from the people you have a
   * reach-out nudge for right now (#2091). Omitted rather than shown-and-
   * explained like `onPullFromProjects`, since a project going quiet is
   * always eventually true and this isn't — most of the time nobody is due,
   * and a row that only sometimes does anything is worse than no row.
   */
  onBatchReachOuts?: () => void;
  /** How many people it would start with, shown as the action's hint. */
  reachOutCount?: number;
  /**
   * Opens the sheet that orders Today's category sections. This is the only way
   * to reorder them — dragging a section header on the list itself is gone.
   */
  onReorderCategories: () => void;
  /** How many categories there are to order, shown as the action's hint. */
  categoryCount: number;
  /**
   * Opens today's events sheet — the same sheet an event row on Today opens,
   * reachable here too since hiding every event leaves no row left to tap.
   * Omitted when the calendar read is off, still loading, or demo mode is
   * active (see TodayScreen's own gate on `todayCalendarEvents`).
   */
  onManageEvents?: () => void;
  /** How many events are on today, shown as the action's hint. */
  eventCount?: number;
  /** Where the "…" was tapped, so the menu opens from it. See `CardSheet`. */
  anchor?: CardAnchor | null;
}

/**
 * Bottom action sheet for the Today screen's overflow ("...") menu, separate
 * from the Sort & Filter sheet since it holds display options rather than
 * filters.
 */
export function TodayOptionsMenu({
  visible,
  onClose,
  hideCategories,
  onHideCategoriesChange,
  onLightenDay,
  plannedLabel,
  lightenNote,
  onLookAhead,
  onPullFromProjects,
  onBatchReachOuts,
  reachOutCount,
  onReorderCategories,
  categoryCount,
  onManageEvents,
  eventCount,
  anchor,
  onOpenSettings,
  settingsHint,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <CardSheet
      name="TodayOptionsMenu"
      visible={visible}
      onClose={onClose}
      anchor={anchor}
      popoverWidth={340}
      scrimLabel="Close menu"
    >
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        <View style={styles.optionsCard}>
          {onLightenDay && (
            <>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => {
                  haptics.tap();
                  onLightenDay();
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Lighten today"
              >
                <Ionicons name="leaf-outline" size={18} color={colors.accent} />
                <View style={styles.optionContent}>
                  <Text style={[styles.optionLabel, styles.optionLabelActive]}>Lighten today</Text>
                  <Text style={styles.optionHint}>
                    {plannedLabel
                      ? `${plannedLabel} planned. Move some of it to a better day`
                      : 'Move some of today to a better day'}
                  </Text>
                  {!!lightenNote && (
                    <Text style={styles.optionNote}>{lightenNote}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
              <View style={styles.optionSep} />
            </>
          )}
          {onLookAhead && (
            <>
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                haptics.tap();
                onLookAhead();
              }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Look ahead"
            >
              <Ionicons name="telescope-outline" size={18} color={colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Look ahead</Text>
                <Text style={styles.optionHint}>
                  See what lands before a date, and whether it fits
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            <View style={styles.optionSep} />
            </>
          )}
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => {
              haptics.tap();
              onPullFromProjects();
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Pull from projects"
          >
            {/* No accent tint or count any more: a quiet project announces
                itself with a task on the list now, so a second, quieter claim
                buried in a menu would be the app saying it twice. This row is
                the way *in* when you go looking. */}
            <Ionicons name="albums-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Pull from projects</Text>
              <Text style={styles.optionHint}>
                Bring the next thing from a quiet project into today
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.optionSep} />
          {onBatchReachOuts && (
            <>
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                haptics.tap();
                onBatchReachOuts();
              }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Batch your reach-outs into a focus session"
            >
              <Ionicons name="people-outline" size={18} color={colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Reach out to people</Text>
                <Text style={styles.optionHint}>
                  {(reachOutCount ?? 0) === 1
                    ? 'One person, in a focus session'
                    : `${reachOutCount ?? 0} people, in one focus session`}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            <View style={styles.optionSep} />
            </>
          )}
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => {
              haptics.tap();
              onReorderCategories();
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Category order"
          >
            <Ionicons name="swap-vertical-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Category order</Text>
              <Text style={styles.optionHint}>
                {categoryCount > 0
                  ? `Choose what order your ${categoryCount} ${categoryCount === 1 ? 'category comes' : 'categories come'} in`
                  : 'Add a category to break today into sections'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          {onManageEvents && (
            <>
            <View style={styles.optionSep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                haptics.tap();
                onManageEvents();
              }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Today's events"
            >
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Today’s events</Text>
                <Text style={styles.optionHint}>
                  {(eventCount ?? 0) > 0
                    ? `See and hide any of today’s ${eventCount} calendar ${eventCount === 1 ? 'event' : 'events'}`
                    : 'Nothing on the calendar today'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            </>
          )}
          <View style={styles.optionSep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => {
              haptics.tap();
              onHideCategoriesChange(!hideCategories);
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityState={{ checked: hideCategories }}
            accessibilityLabel="Hide category headers"
          >
            <Ionicons
              name="eye-off-outline"
              size={18}
              color={hideCategories ? colors.accent : colors.textSecondary}
            />
            <View style={styles.optionContent}>
              <Text style={[styles.optionLabel, hideCategories && styles.optionLabelActive]}>
                Hide categories
              </Text>
              <Text style={styles.optionHint}>
                {hideCategories ? 'Showing one flat list of tasks' : 'Group tasks under category headers'}
              </Text>
            </View>
            <View style={[styles.toggle, hideCategories && styles.toggleOn]}>
              <View style={[styles.toggleKnob, hideCategories && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
          {/* Last, the way a settings entry sits at the foot of a menu: the
              rows above act on today, this one changes how Today behaves. */}
          {onOpenSettings && (
            <>
            <View style={styles.optionSep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                haptics.tap();
                onOpenSettings();
              }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Today settings"
            >
              <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Today settings</Text>
                {!!settingsHint && <Text style={styles.optionHint}>{settingsHint}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  optionsCard: {},
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  optionSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  optionContent: { flex: 1 },
  optionLabel: {
    fontSize: font.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  optionLabelActive: { color: colors.text, fontWeight: fontWeight.semibold },
  optionHint: { color: colors.textTertiary, fontSize: font.sm, marginTop: spacing.xxs },
  // Its own style rather than a second optionHint: this line is the reason the
  // row is worth tapping today, and running it into the hint above would read
  // as one long sentence about the workload.
  optionNote: {
    fontSize: font.xs,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  toggle: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: colors.bgTertiary,
    justifyContent: 'center', padding: spacing.xxs,
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.textSecondary,
  },
  toggleKnobOn: { backgroundColor: colors.onAccent, alignSelf: 'flex-end' },
});
