import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { border, flattenOverlay, font, fontWeight, interaction, radius, spacing, textScale, type Colors } from '../theme';
import { formatTimeOfDay } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import { layoutAllDay } from '../utils/allDaySpans';
import {
  cascadeEntries,
  draggedColumn,
  draggedRange,
  dayLengthMinutes,
  slotMinutesAt,
  type DayTimeline as DayTimelineData,
  type TimelineDragKind,
} from '../utils/dayTimeline';
import type { BusyEvent } from '../utils/calendarBusy';

/** One hour of the axis: a little shorter than the Day view's, so more of the day fits three across. */
const HOUR_HEIGHT = 48;
const MIN_BLOCK_HEIGHT = 18;
const BLOCK_GAP = 2;
/** Wide enough for "12 PM" on one line, which is what lets the hour labels be one line. */
const GUTTER_WIDTH = 36;
/** The screen's edge to the first and last column: the days are what this view is for. */
const EDGE_INSET = spacing.xs;
/** How far each step of an overlap sits in from the one beneath it. */
const CASCADE_STEP = 22;
/** What a title's lines and the block's own padding cost, for fitting lines in the part of a block left uncovered. */
const TITLE_LINE_HEIGHT = 15;
const TITLE_PADDING = 4;
/** How many all-day events a column shows before the rest are a count. */
const MAX_ALL_DAY = 2;
/** How long a new event made by a long-press that never moved is, in minutes. */
const PLACEHOLDER_MINUTES = 60;
/** A block this short has no room for a grip to stretch it by. */
const MIN_GRIP_BLOCK_HEIGHT = 30;

/**
 * A drag in progress: what it does, to which event, the column it started in
 * and the one it is over now, and its minutes then and now. Only a move
 * changes column; making and stretching stay on their day.
 */
interface DragState {
  kind: TimelineDragKind;
  eventId: string | null;
  fromIndex: number;
  toIndex: number;
  origin: { start: number; end: number };
  range: { start: number; end: number };
}

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
  /**
   * Whether an event's block can be dragged: one wholly inside its day, so
   * the block is the whole event. Omit to make no event movable.
   */
  canMoveEvent?: (dayKey: string, eventId: string) => boolean;
  /** A long-press on an empty stretch of a column, dragged down to where it should end: a new event. */
  onCreateRange?: (dayKey: string, startMinutes: number, endMinutes: number) => void;
  /**
   * An event's block moved (to the same day or another of the columns), or
   * stretched by its grip. Minutes count from the start of `toDayKey`.
   */
  onRescheduleEvent?: (eventId: string, fromDayKey: string, toDayKey: string, startMinutes: number, endMinutes: number) => void;
  /** True while a drag holds the finger, for the screen to switch its scroll off (as in DayTimeline). */
  onDragStateChange?: (dragging: boolean) => void;
}

/**
 * A few days side by side against one clock: the phone-sized week. The same
 * layout `buildDayTimeline` gives the Day view, one column per day, sharing an
 * hour gutter and a span wide enough for all of them, with what has no time
 * (all-day events, untimed tasks) above the axis rather than on it.
 *
 * Dragging works as in the Day view (hold an empty stretch to make an event,
 * hold a block to move it, hold its grip to stretch it), plus sideways: a
 * block moved across a column boundary lands on that day at the same clock
 * position. The drag snaps to whole columns, so a narrow one is still easy to
 * aim at.
 */
export function MultiDayTimeline({
  columns, use24Hour, eventColor, onPressDay, onPressEvent, onPressAllDay, onPressTask, onPressUntimed, onPressSlot,
  canMoveEvent, onCreateRange, onRescheduleEvent, onDragStateChange,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ==== dragging: making, moving and stretching events ====
  // DayTimeline's shape (lifted by a long-press, then followed by a responder
  // on the axis that claims the touch on its first move), with the finger's
  // sideways travel read as whole columns for a move.
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // Where the finger was when the responder took the touch, null until then.
  const grantRef = useRef<{ x: number; y: number } | null>(null);
  const columnWidthRef = useRef(0);
  const columnCountRef = useRef(columns.length);
  columnCountRef.current = columns.length;
  const columnKeysRef = useRef(columns.map(c => c.key));
  columnKeysRef.current = columns.map(c => c.key);
  const columnStartsRef = useRef(columns.map(c => c.dayStart));
  columnStartsRef.current = columns.map(c => c.dayStart);
  const callbacks = useRef({ onCreateRange, onRescheduleEvent, onDragStateChange });
  callbacks.current = { onCreateRange, onRescheduleEvent, onDragStateChange };

  const beginDrag = (kind: TimelineDragKind, eventId: string | null, index: number, origin: { start: number; end: number }) => {
    if (dragRef.current) return;
    const state: DragState = { kind, eventId, fromIndex: index, toIndex: index, origin, range: origin };
    dragRef.current = state;
    grantRef.current = null;
    setDrag(state);
    haptics.impactMedium();
    callbacks.current.onDragStateChange?.(true);
  };

  /** Lands the drag or drops it; reachable from the raw touch too, as in DayTimeline. */
  const endDrag = (commit: boolean) => {
    const state = dragRef.current;
    if (!state) return;
    dragRef.current = null;
    grantRef.current = null;
    setDrag(null);
    callbacks.current.onDragStateChange?.(false);
    if (!commit) return;
    const keys = columnKeysRef.current;
    const fromKey = keys[state.fromIndex];
    const toKey = keys[state.toIndex];
    if (!fromKey || !toKey) return;
    const { range, origin } = state;
    if (state.kind === 'create') {
      callbacks.current.onCreateRange?.(fromKey, range.start, range.end);
    } else if (state.eventId && (
      range.start !== origin.start || range.end !== origin.end || state.toIndex !== state.fromIndex
    )) {
      haptics.success();
      callbacks.current.onRescheduleEvent?.(state.eventId, fromKey, toKey, range.start, range.end);
    }
  };
  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => dragRef.current !== null,
      onMoveShouldSetPanResponderCapture: () => dragRef.current !== null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => { grantRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; },
      onPanResponderMove: e => {
        const state = dragRef.current;
        const grant = grantRef.current;
        if (!state || !grant) return;
        const delta = ((e.nativeEvent.pageY - grant.y) / HOUR_HEIGHT) * 60;
        const toIndex = state.kind === 'move'
          ? draggedColumn(state.fromIndex, e.nativeEvent.pageX - grant.x, columnWidthRef.current, columnCountRef.current)
          : state.fromIndex;
        // Stopped at the end of the day it is over, which is an hour short or long on a clock-change day.
        const overStart = columnStartsRef.current[toIndex];
        const range = draggedRange(state.kind, state.origin, delta, undefined, overStart ? dayLengthMinutes(overStart) : undefined);
        if (range.start === state.range.start && range.end === state.range.end && toIndex === state.toIndex) return;
        // A tick per quarter hour or day crossed, so the snap can be felt.
        haptics.tap();
        const next = { ...state, range, toIndex };
        dragRef.current = next;
        setDrag(next);
      },
      onPanResponderRelease: () => endDragRef.current(true),
      onPanResponderTerminate: () => endDragRef.current(false),
    }),
  ).current;
  const onAxisTouchEnd = () => {
    if (dragRef.current && grantRef.current === null) endDragRef.current(true);
  };
  const onAxisTouchCancel = () => {
    if (dragRef.current && grantRef.current === null) endDragRef.current(false);
  };

  const firstMinute = Math.min(...columns.map(c => c.timeline.firstMinute));
  const lastMinute = Math.max(...columns.map(c => c.timeline.lastMinute));
  const spanMinutes = Math.max(60, lastMinute - firstMinute);
  const axisHeight = (spanMinutes / 60) * HOUR_HEIGHT;
  const offsetFor = (minutes: number) => ((minutes - firstMinute) / 60) * HOUR_HEIGHT;
  const origin = columns[0]?.dayStart ?? new Date();

  const hourMarks: { minutes: number; label: string }[] = [];
  for (let m = firstMinute; m <= lastMinute; m += 60) {
    hourMarks.push({ minutes: m, label: format(new Date(origin.getTime() + m * 60000), use24Hour ? 'HH:mm' : 'h a') });
  }

  const allDayLayout = useMemo(() => layoutAllDay(columns.map(c => c.timeline.allDay), MAX_ALL_DAY), [columns]);
  const showCaptions = columns.some((c, i) => allDayLayout.hidden[i] > 0 || c.untimed > 0);

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

      {/* What has no time: all-day events, one bar across the days it covers,
          then the count of untimed tasks under each day. */}
      <View style={styles.offAxis}>
        {allDayLayout.rows.map((row, rowIndex) => {
          const segments: React.ReactNode[] = [];
          let cursor = 0;
          for (const bar of row) {
            if (bar.startColumn > cursor) {
              segments.push(<View key={`gap-${cursor}`} style={{ flex: bar.startColumn - cursor }} />);
            }
            const color = eventColor(bar.event.id);
            const day = columns[bar.startColumn];
            segments.push(
              <View key={`${bar.event.id}:${bar.event.start}:${bar.startColumn}`} style={{ flex: bar.span }}>
                <TouchableOpacity
                  style={[styles.allDayChip, { backgroundColor: tintFor(color) ?? flattenOverlay(colors.accentSubtle, colors.bg) }]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => onPressAllDay(day.key, bar.event)}
                  accessibilityRole="button"
                  accessibilityLabel={`${bar.event.title || 'Event'}, all day${bar.span > 1 ? `, ${bar.span} days` : ''}`}
                >
                  <Text style={styles.allDayText} numberOfLines={1}>{bar.event.title || 'Event'}</Text>
                </TouchableOpacity>
              </View>,
            );
            cursor = bar.startColumn + bar.span;
          }
          return (
            <View key={rowIndex} style={styles.offAxisRow}>
              <View style={styles.gutter} />
              <View style={styles.allDayTrack}>{segments}</View>
            </View>
          );
        })}
        {showCaptions && (
          <View style={styles.offAxisRow}>
            <View style={styles.gutter} />
            {columns.map((column, i) => {
              const more = allDayLayout.hidden[i];
              return (
                <View key={column.key} style={styles.offAxisCell}>
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
        )}
      </View>

      <View
        style={[styles.axis, { height: axisHeight }]}
        {...responder.panHandlers}
        onTouchEnd={onAxisTouchEnd}
        onTouchCancel={onAxisTouchCancel}
      >
        {hourMarks.map(mark => (
          <View key={mark.minutes} pointerEvents="none" style={[styles.hourRow, { top: offsetFor(mark.minutes) }]}>
            <Text style={styles.hourLabel} numberOfLines={1}>{mark.label}</Text>
            <View style={styles.hourRule} />
          </View>
        ))}
        <View
          style={styles.columns}
          pointerEvents="box-none"
          onLayout={e => {
            columnWidthRef.current = columns.length > 0 ? e.nativeEvent.layout.width / columns.length : 0;
          }}
        >
          {columns.map((column, index) => {
            // Every column's minutes count from its own day's start, which is
            // the same clock time each day (the reset time), so one axis
            // serves them all.
            const at = offsetFor;
            const cascade = cascadeEntries(column.timeline.entries);
            return (
              <View key={column.key} style={[styles.column, index > 0 && styles.columnDivided]}>
                {(onPressSlot || onCreateRange) && (
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onPressSlot ? e => onPressSlot(
                      column.key,
                      slotMinutesAt(e.nativeEvent.locationY, firstMinute, lastMinute, HOUR_HEIGHT),
                      e.nativeEvent.pageX,
                      e.nativeEvent.pageY,
                    ) : undefined}
                    onLongPress={onCreateRange ? e => {
                      const start = slotMinutesAt(e.nativeEvent.locationY, firstMinute, lastMinute, HOUR_HEIGHT);
                      beginDrag('create', null, index, { start, end: Math.min(dayLengthMinutes(column.dayStart), start + PLACEHOLDER_MINUTES) });
                    } : undefined}
                    delayLongPress={interaction.delayLongPress}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a task or event on ${format(column.date, 'EEEE')}`}
                    accessibilityHint={onCreateRange
                      ? 'Tap a time to add something there, or touch and hold, then drag down, to make an event that long.'
                      : undefined}
                  />
                )}
                {column.timeline.entries.map((entry, entryIndex) => {
                  const isTask = entry.kind === 'task';
                  const color = !isTask && entry.eventId ? eventColor(entry.eventId) : undefined;
                  const tint = tintFor(color);
                  const placement = cascade[entryIndex];
                  const rawHeight = ((entry.endMinutes - entry.startMinutes) / 60) * HOUR_HEIGHT;
                  const timeLabel = formatTimeOfDay(new Date(column.dayStart.getTime() + entry.startMinutes * 60000), use24Hour);
                  const blockHeight = Math.max(MIN_BLOCK_HEIGHT, rawHeight - BLOCK_GAP);
                  const movable = !isTask && !entry.instant && !!entry.eventId && !!onRescheduleEvent
                    && (canMoveEvent?.(column.key, entry.eventId) ?? false);
                  const beingDragged = drag !== null && drag.eventId !== null
                    && drag.eventId === entry.eventId && drag.fromIndex === index;
                  const span = { start: entry.startMinutes, end: entry.endMinutes };
                  const roomyLines = rawHeight > MIN_BLOCK_HEIGHT * 2 ? 3 : 1;
                  // Whatever starts on top of this block leaves it only the time before that.
                  const titleLines = placement.visibleMinutes === null
                    ? roomyLines
                    : Math.max(1, Math.min(
                      roomyLines,
                      Math.floor(((placement.visibleMinutes / 60) * HOUR_HEIGHT - TITLE_PADDING) / TITLE_LINE_HEIGHT),
                    ));
                  return (
                    <TouchableOpacity
                      key={entry.key}
                      style={[
                        styles.block,
                        isTask ? styles.blockTask : styles.blockEvent,
                        tint !== null && { backgroundColor: tint, borderLeftColor: color },
                        {
                          top: at(entry.startMinutes),
                          height: blockHeight,
                          left: placement.depth * CASCADE_STEP,
                          right: 0,
                          zIndex: placement.order,
                        },
                        placement.overlays && styles.blockOverlay,
                        beingDragged && styles.blockLifted,
                      ]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => {
                        if (isTask && entry.taskId) onPressTask(entry.taskId);
                        else if (entry.eventId) onPressEvent(column.key, entry.eventId);
                      }}
                      onLongPress={movable ? () => beginDrag('move', entry.eventId, index, span) : undefined}
                      delayLongPress={interaction.delayLongPress}
                      accessibilityRole="button"
                      accessibilityLabel={`${entry.title}, ${timeLabel}${isTask ? ', task' : ''}`}
                      accessibilityHint={movable ? 'Touch and hold, then drag, to move it to another time or day.' : undefined}
                    >
                      <Text style={styles.blockTitle} numberOfLines={titleLines}>
                        {entry.title}
                      </Text>
                      {/* The grip at the foot, its own press target so a hold
                          on it stretches rather than moves. */}
                      {movable && blockHeight >= MIN_GRIP_BLOCK_HEIGHT && (
                        <Pressable
                          style={styles.gripArea}
                          onLongPress={() => beginDrag('resize', entry.eventId, index, span)}
                          delayLongPress={interaction.delayLongPress}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={`Change when ${entry.title} ends`}
                          accessibilityHint="Touch and hold, then drag."
                        >
                          <View style={[styles.grip, color ? { backgroundColor: color } : null]} />
                        </Pressable>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {/* The block being made, moved or stretched, in the column it
                    would land in now, with its times. */}
                {drag !== null && drag.toIndex === index && (() => {
                  const draggedColor = drag.eventId ? eventColor(drag.eventId) : undefined;
                  const draggedTint = tintFor(draggedColor);
                  const height = Math.max(MIN_BLOCK_HEIGHT, ((drag.range.end - drag.range.start) / 60) * HOUR_HEIGHT - BLOCK_GAP);
                  const clock = (minutes: number) =>
                    formatTimeOfDay(new Date(column.dayStart.getTime() + minutes * 60000), use24Hour);
                  return (
                    <View
                      pointerEvents="none"
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      style={[
                        drag.kind === 'create' ? styles.placeholder : [styles.block, styles.blockEvent, styles.ghost],
                        drag.kind !== 'create' && draggedTint !== null && { backgroundColor: draggedTint, borderLeftColor: draggedColor },
                        { top: at(drag.range.start), height },
                      ]}
                    >
                      <Text style={drag.kind === 'create' ? styles.placeholderTime : styles.ghostTime} numberOfLines={2}>
                        {clock(drag.range.start)} – {clock(drag.range.end)}
                      </Text>
                    </View>
                  );
                })()}
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
    paddingHorizontal: EDGE_INSET,
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
  offAxis: {
    gap: 3,
    marginBottom: spacing.sm,
  },
  offAxisRow: {
    flexDirection: 'row',
    paddingHorizontal: EDGE_INSET,
  },
  allDayTrack: {
    flex: 1,
    flexDirection: 'row',
  },
  offAxisCell: {
    flex: 1,
    gap: 3,
    paddingHorizontal: 2,
  },
  allDayChip: {
    marginHorizontal: 2,
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
    marginHorizontal: EDGE_INSET,
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
    borderLeftWidth: 2,
    paddingHorizontal: 3,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  // A block that starts on top of another outlines itself in the page colour,
  // so two of the same tint still read as two blocks. The top and bottom take
  // a point of padding back so a one-line title keeps its room.
  blockOverlay: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.bg,
    borderBottomColor: colors.bg,
    paddingVertical: 1,
  },
  // Opaque, not the translucent tint: a block stacked on another must hide it.
  blockTask: {
    backgroundColor: flattenOverlay(colors.accentSubtle, colors.bg),
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
  // The block a drag has lifted, left in place faded so it's clear what moved.
  blockLifted: {
    opacity: 0.35,
  },
  // Where the dragged block would land: the column's full width, outlined.
  ghost: {
    left: 0,
    right: 0,
    zIndex: 1000,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  ghostTime: {
    fontSize: font.xxs,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  placeholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    zIndex: 1000,
    backgroundColor: colors.accentSubtle,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  placeholderTime: {
    fontSize: font.xxs,
    fontWeight: fontWeight.medium,
    color: colors.accentText,
  },
  // A touch target wider than the grip it draws, along the block's foot.
  gripArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 12,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 3,
  },
  grip: {
    width: 16,
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.textTertiary,
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1000,
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
