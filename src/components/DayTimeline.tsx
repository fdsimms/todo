import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { formatTimeOfDay } from '../utils/dateUtils';
import type { DayTimeline as DayTimelineData } from '../utils/dayTimeline';
import { MEAL_SLOT_LABELS, type MealPlanEntry } from '../types';

/** How tall one hour of the axis is. */
const HOUR_HEIGHT = 56;
/** A block never draws shorter than this, however few minutes it covers. */
const MIN_BLOCK_HEIGHT = 22;
const GUTTER_WIDTH = 52;

interface Props {
  /** Start of the logical day, the origin every offset is measured from. */
  dayStart: Date;
  timeline: DayTimelineData;
  /** The day's planned meals. They have no clock time, so they ride the band. */
  meals: readonly MealPlanEntry[];
  /**
   * False when the calendar could not be read for this day at all — past the
   * store's rolling window, or with the read switched off. An empty axis would
   * then be a confident lie, so the band says so instead.
   */
  busyKnown: boolean;
  use24Hour: boolean;
  /** Minutes from `dayStart` to draw the now line at, or null when not today. */
  nowMinutes: number | null;
  onPressTask: (taskId: string) => void;
  /**
   * Tapping a calendar event's block. Omit to leave events inert, the way they
   * were before an event had anything to open.
   */
  onPressEvent?: (eventId: string) => void;
}

/**
 * One day drawn against a clock (#2680).
 *
 * The layout rules are all in `src/utils/dayTimeline.ts`, which is pure and
 * tested; this places what that returns and nothing more. Anything the module
 * declined to position (a task with no time, an all-day event, a planned meal)
 * is shown *off* the axis rather than given an invented slot, which is the
 * distinction the whole feature rests on.
 */
export function DayTimeline({
  dayStart, timeline, meals, busyKnown, use24Hour, nowMinutes, onPressTask, onPressEvent,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { entries, allDay, firstMinute, lastMinute } = timeline;
  const spanMinutes = Math.max(60, lastMinute - firstMinute);
  const axisHeight = (spanMinutes / 60) * HOUR_HEIGHT;
  const offsetFor = (minutes: number) => ((minutes - firstMinute) / 60) * HOUR_HEIGHT;

  const hourMarks = useMemo(() => {
    const marks: { minutes: number; label: string }[] = [];
    for (let m = firstMinute; m <= lastMinute; m += 60) {
      const clock = new Date(dayStart.getTime() + m * 60000);
      marks.push({ minutes: m, label: formatTimeOfDay(clock, use24Hour) });
    }
    return marks;
  }, [dayStart, firstMinute, lastMinute, use24Hour]);

  const bandItems = [
    ...(busyKnown ? [] : [{ key: 'unknown', icon: 'help-circle-outline' as const, text: 'Calendar not read for this day' }]),
    ...allDay.map(e => ({ key: `ad-${e.id}`, icon: 'calendar-outline' as const, text: e.title })),
    ...meals.map(m => ({
      key: `meal-${m.id}`,
      icon: 'restaurant-outline' as const,
      text: `${MEAL_SLOT_LABELS[m.slot]}: ${m.title}`,
    })),
  ];

  return (
    <View>
      {bandItems.length > 0 && (
        // Above the axis, never on it: none of these carries a clock time, and
        // a meal slot especially is a day and a slot by construction.
        <View style={styles.band}>
          {bandItems.map(item => (
            <View key={item.key} style={styles.bandRow}>
              <Ionicons name={item.icon} size={14} color={colors.textSecondary} />
              <Text style={styles.bandText} numberOfLines={1}>{item.text}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.axis, { height: axisHeight }]}>
        {hourMarks.map(mark => (
          <View key={mark.minutes} style={[styles.hourRow, { top: offsetFor(mark.minutes) }]}>
            <Text style={styles.hourLabel}>{mark.label}</Text>
            <View style={styles.hourRule} />
          </View>
        ))}

        <View style={styles.track}>
        {entries.map(entry => {
          const top = offsetFor(entry.startMinutes);
          const rawHeight = ((entry.endMinutes - entry.startMinutes) / 60) * HOUR_HEIGHT;
          const isTask = entry.kind === 'task';
          const pressable = isTask || (!!onPressEvent && !!entry.eventId);
          const press = () => {
            if (isTask) { if (entry.taskId) onPressTask(entry.taskId); }
            else if (entry.eventId) onPressEvent?.(entry.eventId);
          };
          const startClock = new Date(dayStart.getTime() + entry.startMinutes * 60000);
          const timeLabel = formatTimeOfDay(startClock, use24Hour);
          const laneWidth = 100 / entry.laneCount;
          const position = {
            top,
            left: `${entry.lane * laneWidth}%` as const,
            width: `${laneWidth}%` as const,
          };

          if (entry.instant) {
            // No length to draw, so it is a mark rather than a block. The rule
            // and the reason are in dayTimeline.ts.
            return (
              <TouchableOpacity
                key={entry.key}
                style={[styles.entry, styles.instant, position]}
                activeOpacity={interaction.activeOpacity}
                disabled={!pressable}
                onPress={press}
                accessibilityRole={pressable ? 'button' : undefined}
                accessibilityLabel={`${entry.title} at ${timeLabel}, no time estimate`}
              >
                <View style={styles.instantDot} />
                <Text style={styles.instantText} numberOfLines={1}>
                  {timeLabel}  {entry.title}
                </Text>
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity
              key={entry.key}
              style={[
                styles.entry,
                styles.block,
                isTask ? styles.blockTask : styles.blockEvent,
                { ...position, height: Math.max(MIN_BLOCK_HEIGHT, rawHeight) },
              ]}
              activeOpacity={interaction.activeOpacity}
              disabled={!pressable}
              onPress={press}
              accessibilityRole={pressable ? 'button' : undefined}
              accessibilityLabel={`${entry.title}, ${timeLabel}`}
            >
              <Text
                style={[styles.blockTitle, isTask ? styles.blockTitleTask : styles.blockTitleEvent]}
                numberOfLines={rawHeight > MIN_BLOCK_HEIGHT * 1.6 ? 2 : 1}
              >
                {entry.title}
              </Text>
              {rawHeight > MIN_BLOCK_HEIGHT * 1.6 && (
                <Text style={styles.blockTime} numberOfLines={1}>{timeLabel}</Text>
              )}
            </TouchableOpacity>
          );
        })}
        </View>

        {/* After the entries so it draws over them: a now line hidden behind a
            block is the one line on the axis you always want to find. */}
        {nowMinutes !== null && nowMinutes >= firstMinute && nowMinutes <= lastMinute && (
          <View
            style={[styles.nowLine, { top: offsetFor(nowMinutes) }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
            pointerEvents="none"
          >
            <View style={styles.nowDot} />
            <View style={styles.nowRule} />
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  band: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.smd,
  },
  bandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
  },
  bandText: {
    flex: 1,
    fontSize: font.sm,
    color: colors.textSecondary,
  },
  axis: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  hourRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hourLabel: {
    width: GUTTER_WIDTH - spacing.sm,
    textAlign: 'right',
    fontSize: font.xxs,
    color: colors.textTertiary,
  },
  hourRule: {
    flex: 1,
    height: border.hairline,
    backgroundColor: colors.separator,
  },
  nowLine: {
    position: 'absolute',
    left: GUTTER_WIDTH,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nowDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.red,
  },
  nowRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.red,
  },
  // The entries sit in their own track, already inset past the hour gutter, so
  // a lane's percentage is a share of the width it actually has. Insetting each
  // entry instead (a margin on top of a percentage left) compounds the two and
  // pushes the last lane off the right edge.
  track: {
    position: 'absolute',
    left: GUTTER_WIDTH,
    right: 0,
    top: 0,
    bottom: 0,
  },
  entry: {
    position: 'absolute',
    paddingRight: spacing.xs,
  },
  block: {
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.xsm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  blockTask: {
    backgroundColor: colors.accentSubtle,
    borderLeftColor: colors.accent,
  },
  blockEvent: {
    backgroundColor: colors.bgTertiary,
    borderLeftColor: colors.textSecondary,
  },
  blockTitle: {
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  blockTitleTask: { color: colors.text },
  blockTitleEvent: { color: colors.textSecondary },
  blockTime: {
    fontSize: font.xxs,
    color: colors.textTertiary,
    marginTop: 1,
  },
  instant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  instantDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  instantText: {
    flex: 1,
    fontSize: font.xxs,
    color: colors.textSecondary,
  },
});
