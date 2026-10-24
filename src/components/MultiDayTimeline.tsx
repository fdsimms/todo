import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { border, flattenOverlay, font, fontWeight, interaction, radius, spacing, textScale, type Colors } from '../theme';
import { formatTimeOfDay } from '../utils/dateUtils';
import { slotMinutesAt, type DayTimeline as DayTimelineData } from '../utils/dayTimeline';
import type { BusyEvent } from '../utils/calendarBusy';

/** One hour of the axis: a little shorter than the Day view's, so more of the day fits three across. */
const HOUR_HEIGHT = 48;
const MIN_BLOCK_HEIGHT = 18;
const BLOCK_GAP = 2;
const GUTTER_WIDTH = 44;
/** How many all-day events a column shows before the rest are a count. */
const MAX_ALL_DAY = 2;

export interface MultiDayColumn {
  key: string;
  date: Date;
  /** The logical day's start, which the column's minutes count from. */
  dayStart: Date;
  timeline: DayTimelineData;
  isToday: boolean;
  /** Minutes into the day now, on today's column only. */
  nowMinutes: number | null;
  /** The day's open tasks with no time, shown as a count. */
  untimed: number;
}

interface Props {
  columns: readonly MultiDayColumn[];
  use24Hour: boolean;
  eventColor: (eventId: string) => string | undefined;
  onPressDay: (dayKey: string) => void;
  onPressEvent: (dayKey: string, eventId: string) => void;
  onPressAllDay: (dayKey: string, event: BusyEvent) => void;
  onPressTask: (taskId: string) => void;
  onPressUntimed: (dayKey: string) => void;
  /** An empty stretch of a column tapped, with the minute it snaps to and the touch's page position. */
  onPressSlot?: (dayKey: string, minutes: number, pageX: number, pageY: number) => void;
}

/**
 * A few days side by side against one clock: the phone-sized week. The same
 * layout `buildDayTimeline` gives the Day view, one column per day, sharing an
 * hour gutter and a span wide enough for all of them, with what has no time
 * (all-day events, untimed tasks) above the axis rather than on it.
 *
 * Read and tap only: dragging an event is the Day view's, where a column is
 * wide enough to aim at.
 */
export function MultiDayTimeline({
  columns, use24Hour, eventColor, onPressDay, onPressEvent, onPressAllDay, onPressTask, onPressUntimed, onPressSlot,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const firstMinute = Math.min(...columns.map(c => c.timeline.firstMinute));
  const lastMinute = Math.max(...columns.map(c => c.timeline.lastMinute));
  const spanMinutes = Math.max(60, lastMinute - firstMinute);
  const axisHeight = (spanMinutes / 60) * HOUR_HEIGHT;
  const offsetFor = (minutes: number) => ((minutes - firstMinute) / 60) * HOUR_HEIGHT;
  const origin = columns[0]?.dayStart ?? new Date();

  const hourMarks: { minutes: number; label: string }[] = [];
  for (let m = firstMinute; m <= lastMinute; m += 60) {
    hourMarks.push({ minutes: m, label: formatTimeOfDay(new Date(origin.getTime() + m * 60000), use24Hour) });
  }

  const tintFor = (color: string | undefined): string | null =>
    color && /^#[0-9a-fA-F]{6}$/.test(color) ? flattenOverlay(`${color}33`, colors.bg) : null;

  return (
    <View>
      {/* The days' names, each a way into that day on its own. */}
      <View style={styles.headerRow}>
        <View style={styles.gutter} />
        {columns.map(column => (
          <TouchableOpacity
            key={column.key}
            style={styles.headerCell}
            activeOpacity={interaction.activeOpacity}
            onPress={() => onPressDay(column.key)}
            accessibilityRole="button"
            accessibilityLabel={`${format(column.date, 'EEEE, MMMM d')}. Opens the day.`}
          >
            <Text maxFontSizeMultiplier={textScale.badge} style={[styles.weekday, column.isToday && styles.weekdayToday]}>
              {format(column.date, 'EEE').toUpperCase()}
            </Text>
            <View style={[styles.dateCircle, column.isToday && styles.dateCircleToday]}>
              <Text maxFontSizeMultiplier={textScale.badge} style={[styles.dateText, column.isToday && styles.dateTextToday]}>
                {column.date.getDate()}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* What has no time: all-day events, then the count of untimed tasks. */}
      <View style={styles.offAxisRow}>
        <View style={styles.gutter} />
        {columns.map(column => {
          const allDay = column.timeline.allDay;
          const more = allDay.length - MAX_ALL_DAY;
          return (
            <View key={column.key} style={styles.offAxisCell}>
              {allDay.slice(0, MAX_ALL_DAY).map(event => {
                const color = eventColor(event.id);
                return (
                  <TouchableOpacity
                    key={`${event.id}:${event.start}`}
                    style={[styles.allDayChip, { backgroundColor: tintFor(color) ?? flattenOverlay(colors.accentSubtle, colors.bg) }]}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => onPressAllDay(column.key, event)}
                    accessibilityRole="button"
                    accessibilityLabel={`${event.title || 'Event'}, all day`}
                  >
                    <Text style={styles.allDayText} numberOfLines={1}>{event.title || 'Event'}</Text>
                  </TouchableOpacity>
                );
              })}
              {more > 0 && <Text style={styles.moreText}>+{more} more</Text>}
              {column.untimed > 0 && (
                <TouchableOpacity
                  style={styles.untimedChip}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => onPressUntimed(column.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${column.untimed} ${column.untimed === 1 ? 'task' : 'tasks'} without a time on ${format(column.date, 'EEEE')}`}
                >
                  <Text style={styles.untimedText} numberOfLines={1}>
                    {column.untimed} {column.untimed === 1 ? 'task' : 'tasks'} ›
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      <View style={[styles.axis, { height: axisHeight }]}>
        {hourMarks.map(mark => (
          <View key={mark.minutes} pointerEvents="none" style={[styles.hourRow, { top: offsetFor(mark.minutes) }]}>
            <Text style={styles.hourLabel}>{mark.label}</Text>
            <View style={styles.hourRule} />
          </View>
        ))}
        <View style={styles.columns} pointerEvents="box-none">
          {columns.map((column, index) => {
            // Every column's minutes count from its own day's start, which is
            // the same clock time each day (the reset time), so one axis
            // serves them all.
            const at = offsetFor;
            return (
              <View key={column.key} style={[styles.column, index > 0 && styles.columnDivided]}>
                {onPressSlot && (
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={e => onPressSlot(
                      column.key,
                      slotMinutesAt(e.nativeEvent.locationY, firstMinute, lastMinute, HOUR_HEIGHT),
                      e.nativeEvent.pageX,
                      e.nativeEvent.pageY,
                    )}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a task or event on ${format(column.date, 'EEEE')}`}
                  />
                )}
                {column.timeline.entries.map(entry => {
                  const isTask = entry.kind === 'task';
                  const color = !isTask && entry.eventId ? eventColor(entry.eventId) : undefined;
                  const tint = tintFor(color);
                  const laneWidth = 100 / entry.laneCount;
                  const rawHeight = ((entry.endMinutes - entry.startMinutes) / 60) * HOUR_HEIGHT;
                  const timeLabel = formatTimeOfDay(new Date(column.dayStart.getTime() + entry.startMinutes * 60000), use24Hour);
                  return (
                    <TouchableOpacity
                      key={entry.key}
                      style={[
                        styles.block,
                        isTask ? styles.blockTask : styles.blockEvent,
                        tint !== null && { backgroundColor: tint, borderLeftColor: color },
                        {
                          top: at(entry.startMinutes),
                          height: Math.max(MIN_BLOCK_HEIGHT, rawHeight - BLOCK_GAP),
                          left: `${entry.lane * laneWidth}%`,
                          width: `${laneWidth}%`,
                        },
                      ]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => {
                        if (isTask && entry.taskId) onPressTask(entry.taskId);
                        else if (entry.eventId) onPressEvent(column.key, entry.eventId);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${entry.title}, ${timeLabel}${isTask ? ', task' : ''}`}
                    >
                      <Text style={styles.blockTitle} numberOfLines={rawHeight > MIN_BLOCK_HEIGHT * 2 ? 3 : 1}>
                        {entry.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {column.nowMinutes !== null && column.nowMinutes >= firstMinute && column.nowMinutes <= lastMinute && (
                  <View
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    style={[styles.nowLine, { top: at(column.nowMinutes) }]}
                  >
                    <View style={styles.nowDot} />
                    <View style={styles.nowRule} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  gutter: {
    width: GUTTER_WIDTH,
  },
  headerCell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xxs,
    minHeight: 44,
    justifyContent: 'center',
  },
  weekday: {
    fontSize: font.xxs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },
  weekdayToday: {
    color: colors.accentText,
  },
  dateCircle: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCircleToday: {
    backgroundColor: colors.accentFill,
  },
  dateText: {
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  dateTextToday: {
    color: colors.onAccent,
  },
  offAxisRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  offAxisCell: {
    flex: 1,
    gap: 3,
    paddingHorizontal: 2,
  },
  allDayChip: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xsm,
    paddingVertical: 3,
  },
  allDayText: {
    fontSize: font.xxs,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  moreText: {
    fontSize: font.xxs,
    color: colors.textSecondary,
    paddingHorizontal: spacing.xsm,
  },
  untimedChip: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xsm,
    paddingVertical: 3,
    backgroundColor: colors.bgSecondary,
  },
  untimedText: {
    fontSize: font.xxs,
    fontWeight: fontWeight.semibold,
    color: colors.accentText,
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
    gap: spacing.xs,
  },
  hourLabel: {
    width: GUTTER_WIDTH - spacing.xs,
    textAlign: 'right',
    fontSize: font.xxs,
    color: colors.textTertiary,
  },
  hourRule: {
    flex: 1,
    height: border.hairline,
    backgroundColor: colors.separator,
  },
  // Inset past the gutter, so a lane's percentage is a share of the column alone.
  columns: {
    position: 'absolute',
    left: GUTTER_WIDTH,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  column: {
    flex: 1,
  },
  columnDivided: {
    borderLeftWidth: border.hairline,
    borderLeftColor: colors.separator,
  },
  block: {
    position: 'absolute',
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
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
    fontSize: font.xxs,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  nowLine: {
    position: 'absolute',
    left: 0,
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
});
