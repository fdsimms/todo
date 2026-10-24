import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { border, flattenOverlay, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { formatTimeOfDay } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import {
  draggedRange,
  MINUTES_IN_DAY,
  slotMinutesAt,
  type DayTimeline as DayTimelineData,
  type TimelineDragKind,
} from '../utils/dayTimeline';
import { MEAL_SLOT_LABELS, type MealPlanEntry } from '../types';

/** How tall one hour of the axis is. */
const HOUR_HEIGHT = 56;
/** A block never draws shorter than this, however few minutes it covers. */
const MIN_BLOCK_HEIGHT = 22;
/** Trimmed off the bottom of every block so two that abut (one ends as the
 *  next starts) read as two cards instead of one merged shape. */
const BLOCK_GAP = 2;
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
  /**
   * Past the fortnight read, only events spanning several days were read for
   * this day (the trip read). The notice says that rather than "not read",
   * since the band may well be showing one of them.
   */
  tripOnly?: boolean;
  use24Hour: boolean;
  /** Minutes from `dayStart` to draw the now line at, or null when not today. */
  nowMinutes: number | null;
  onPressTask: (taskId: string) => void;
  /**
   * Tapping a calendar event's block. Omit to leave events inert, the way they
   * were before an event had anything to open.
   */
  onPressEvent?: (eventId: string) => void;
  /**
   * Tapping an empty stretch of the axis, with the minute it snaps to
   * (`slotMinutesAt`) and the touch's page position for a popover. Blocks sit
   * above it and keep their own taps.
   */
  onPressSlot?: (minutes: number, pageX: number, pageY: number) => void;
  /**
   * Minutes from `dayStart` to draw a dashed placeholder at, for the slot a
   * tap is choosing between a task and an event for. Drawn an hour long, the
   * default length of a new event. Null when nothing is being placed.
   */
  placeholderMinutes?: number | null;
  /** An event's calendar color, by event id. A block with none is drawn grey. */
  eventColor?: (eventId: string) => string | undefined;
  /**
   * Whether an event's block can be dragged: one that starts and ends on this
   * day, so the block is the whole event rather than the part of it the day
   * clipped. Omit to make no event movable.
   */
  canMoveEvent?: (eventId: string) => boolean;
  /** A long-press on an empty stretch, dragged down to where it should end: a new event. */
  onCreateRange?: (startMinutes: number, endMinutes: number) => void;
  /** An event's block moved, or stretched by its grip, to new minutes. */
  onRescheduleEvent?: (eventId: string, startMinutes: number, endMinutes: number) => void;
  /**
   * True while a drag holds the finger. The screen switches its scroll view
   * off for that long, or the scroll takes the touch on the first move (see
   * the SortableList note in CLAUDE.md: this responder is a descendant).
   */
  onDragStateChange?: (dragging: boolean) => void;
}

/** How long the placeholder block is, in minutes, and a new event made by a long-press that never moved. */
const PLACEHOLDER_MINUTES = 60;
/** A block this short has no room for a grip to stretch it by. */
const MIN_GRIP_BLOCK_HEIGHT = 30;

/** A drag in progress: what it does, to which event, from where, and where it is now. */
interface DragState {
  kind: TimelineDragKind;
  eventId: string | null;
  origin: { start: number; end: number };
  range: { start: number; end: number };
}

/**
 * A calendar's color as a block's fill: a fifth of it over the page, made
 * opaque. A color that isn't a plain hex is no color.
 */
function blockTint(color: string | undefined, colors: Colors): string | null {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  return flattenOverlay(`${color}33`, colors.bg);
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
  dayStart, timeline, meals, busyKnown, tripOnly = false, use24Hour, nowMinutes, onPressTask, onPressEvent, onPressSlot,
  placeholderMinutes = null, eventColor, canMoveEvent, onCreateRange, onRescheduleEvent, onDragStateChange,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ==== dragging: making, moving and stretching events ====
  // Lifted by a long-press (on an empty stretch, an event's block, or its
  // grip), then followed by a responder on the axis that claims the touch on
  // its first move: SortableList's shape, with the screen's scroll view
  // switched off for the drag's length (onDragStateChange). The drag's state
  // re-renders this component only, never the screen.
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // Where the finger was when the responder took the touch, null until then.
  const grantYRef = useRef<number | null>(null);
  const callbacks = useRef({ onCreateRange, onRescheduleEvent, onDragStateChange });
  callbacks.current = { onCreateRange, onRescheduleEvent, onDragStateChange };

  const beginDrag = (kind: TimelineDragKind, eventId: string | null, origin: { start: number; end: number }) => {
    if (dragRef.current) return;
    const state: DragState = { kind, eventId, origin, range: origin };
    dragRef.current = state;
    grantYRef.current = null;
    setDrag(state);
    haptics.impactMedium();
    callbacks.current.onDragStateChange?.(true);
  };

  /**
   * Lands the drag, or drops it. Reachable from the raw touch as well as from
   * the responder, because the responder is only granted on a move: a
   * long-press let go without moving would otherwise leave the drag (and the
   * screen's scroll) stuck on. A new event made that way gets the hour a tap
   * would give it; a move that went nowhere writes nothing.
   */
  const endDrag = (commit: boolean) => {
    const state = dragRef.current;
    if (!state) return;
    dragRef.current = null;
    grantYRef.current = null;
    setDrag(null);
    callbacks.current.onDragStateChange?.(false);
    if (!commit) return;
    const { range, origin } = state;
    if (state.kind === 'create') {
      callbacks.current.onCreateRange?.(range.start, range.end);
    } else if (state.eventId && (range.start !== origin.start || range.end !== origin.end)) {
      haptics.success();
      callbacks.current.onRescheduleEvent?.(state.eventId, range.start, range.end);
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
      onPanResponderGrant: e => { grantYRef.current = e.nativeEvent.pageY; },
      onPanResponderMove: e => {
        const state = dragRef.current;
        if (!state || grantYRef.current === null) return;
        const delta = ((e.nativeEvent.pageY - grantYRef.current) / HOUR_HEIGHT) * 60;
        const range = draggedRange(state.kind, state.origin, delta);
        if (range.start === state.range.start && range.end === state.range.end) return;
        // A tick per quarter hour crossed, so the snap can be felt.
        haptics.tap();
        const next = { ...state, range };
        dragRef.current = next;
        setDrag(next);
      },
      onPanResponderRelease: () => endDragRef.current(true),
      onPanResponderTerminate: () => endDragRef.current(false),
    }),
  ).current;
  const onAxisTouchEnd = () => {
    if (dragRef.current && grantYRef.current === null) endDragRef.current(true);
  };
  const onAxisTouchCancel = () => {
    if (dragRef.current && grantYRef.current === null) endDragRef.current(false);
  };
  const clock = (minutes: number) => formatTimeOfDay(new Date(dayStart.getTime() + minutes * 60000), use24Hour);

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
    ...(busyKnown ? [] : [{
      key: 'unknown',
      icon: 'help-circle-outline' as const,
      text: tripOnly ? 'Only events lasting several days are read this far ahead' : 'Calendar not read for this day',
    }]),
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

      <View
        style={[styles.axis, { height: axisHeight }]}
        {...responder.panHandlers}
        onTouchEnd={onAxisTouchEnd}
        onTouchCancel={onAxisTouchCancel}
      >
        {/* Under everything: the hour rules and the empty track let a tap
            through to it, and a block's own tap wins over it. */}
        {(onPressSlot || onCreateRange) && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onPressSlot ? e => onPressSlot(
              slotMinutesAt(e.nativeEvent.locationY, firstMinute, lastMinute, HOUR_HEIGHT),
              e.nativeEvent.pageX,
              e.nativeEvent.pageY,
            ) : undefined}
            onLongPress={onCreateRange ? e => {
              const start = slotMinutesAt(e.nativeEvent.locationY, firstMinute, lastMinute, HOUR_HEIGHT);
              beginDrag('create', null, { start, end: Math.min(MINUTES_IN_DAY, start + PLACEHOLDER_MINUTES) });
            } : undefined}
            delayLongPress={interaction.delayLongPress}
            accessibilityRole="button"
            accessibilityLabel="Add a task or event at a time"
            accessibilityHint={onCreateRange
              ? 'Tap a time to add something there, or touch and hold, then drag down, to make an event that long.'
              : 'Tap a time on the timeline to add something there.'}
          />
        )}
        {hourMarks.map(mark => (
          <View key={mark.minutes} pointerEvents="none" style={[styles.hourRow, { top: offsetFor(mark.minutes) }]}>
            <Text style={styles.hourLabel}>{mark.label}</Text>
            <View style={styles.hourRule} />
          </View>
        ))}

        <View style={styles.track} pointerEvents="box-none">
        {placeholderMinutes !== null && placeholderMinutes >= firstMinute && placeholderMinutes < lastMinute && (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[
              styles.placeholder,
              {
                top: offsetFor(placeholderMinutes),
                height: Math.max(
                  MIN_BLOCK_HEIGHT,
                  (Math.min(PLACEHOLDER_MINUTES, lastMinute - placeholderMinutes) / 60) * HOUR_HEIGHT - BLOCK_GAP,
                ),
              },
            ]}
          >
            <Text style={styles.placeholderTime} numberOfLines={1}>
              {formatTimeOfDay(new Date(dayStart.getTime() + placeholderMinutes * 60000), use24Hour)}
            </Text>
          </View>
        )}
        {entries.map(entry => {
          const top = offsetFor(entry.startMinutes);
          const rawHeight = ((entry.endMinutes - entry.startMinutes) / 60) * HOUR_HEIGHT;
          const isTask = entry.kind === 'task';
          const pressable = isTask || (!!onPressEvent && !!entry.eventId);
          const color = !isTask && entry.eventId ? eventColor?.(entry.eventId) : undefined;
          const tint = blockTint(color, colors);
          const movable = !isTask && !entry.instant && !!entry.eventId && !!onRescheduleEvent
            && (canMoveEvent?.(entry.eventId) ?? false);
          const beingDragged = drag !== null && drag.eventId !== null && drag.eventId === entry.eventId;
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
                <Text style={styles.instantText} numberOfLines={2}>
                  {timeLabel}  {entry.title}
                </Text>
              </TouchableOpacity>
            );
          }

          const blockHeight = Math.max(MIN_BLOCK_HEIGHT, rawHeight - BLOCK_GAP);
          return (
            <TouchableOpacity
              key={entry.key}
              style={[
                styles.entry,
                styles.block,
                isTask ? styles.blockTask : styles.blockEvent,
                tint !== null && { backgroundColor: tint, borderLeftColor: color },
                { ...position, height: blockHeight },
                beingDragged && styles.blockLifted,
              ]}
              activeOpacity={interaction.activeOpacity}
              disabled={!pressable && !movable}
              onPress={press}
              onLongPress={movable ? () => beginDrag('move', entry.eventId, { start: entry.startMinutes, end: entry.endMinutes }) : undefined}
              delayLongPress={interaction.delayLongPress}
              accessibilityRole={pressable ? 'button' : undefined}
              accessibilityLabel={`${entry.title}, ${timeLabel}`}
              accessibilityHint={movable ? 'Touch and hold, then drag, to move it.' : undefined}
            >
              <Text
                style={[styles.blockTitle, isTask ? styles.blockTitleTask : styles.blockTitleEvent, tint !== null && styles.blockTitleTask]}
                numberOfLines={rawHeight > MIN_BLOCK_HEIGHT * 1.6 ? 2 : 1}
              >
                {entry.title}
              </Text>
              {rawHeight > MIN_BLOCK_HEIGHT * 1.6 && (
                <Text style={styles.blockTime} numberOfLines={1}>{timeLabel}</Text>
              )}
              {/* The grip at the foot of a movable event: hold and drag it to
                  change when the event ends. Its own press target, so a hold
                  on it stretches rather than moves. */}
              {movable && blockHeight >= MIN_GRIP_BLOCK_HEIGHT && (
                <Pressable
                  style={styles.gripArea}
                  onLongPress={() => beginDrag('resize', entry.eventId, { start: entry.startMinutes, end: entry.endMinutes })}
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

        {/* The block being made, moved or stretched, where it would land now.
            Drawn full width over whatever lanes it crosses, with its times,
            so where it lands is never a guess. */}
        {drag !== null && (() => {
          const draggedColor = drag.eventId ? eventColor?.(drag.eventId) : undefined;
          const draggedTint = blockTint(draggedColor, colors);
          const height = Math.max(MIN_BLOCK_HEIGHT, ((drag.range.end - drag.range.start) / 60) * HOUR_HEIGHT - BLOCK_GAP);
          return (
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[
                drag.kind === 'create' ? styles.placeholder : [styles.block, styles.blockEvent, styles.ghost],
                drag.kind !== 'create' && draggedTint !== null && { backgroundColor: draggedTint, borderLeftColor: draggedColor },
                { top: offsetFor(drag.range.start), height },
              ]}
            >
              <Text style={drag.kind === 'create' ? styles.placeholderTime : styles.ghostTime} numberOfLines={1}>
                {clock(drag.range.start)} – {clock(drag.range.end)}
              </Text>
            </View>
          );
        })()}
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
  // A dashed outline rather than a fill, so it reads as "something goes here"
  // and not as a task or event that already exists.
  placeholder: {
    position: 'absolute',
    left: 0,
    right: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: colors.accentSubtle,
    paddingHorizontal: spacing.xsm,
    paddingVertical: 3,
  },
  placeholderTime: {
    fontSize: font.xxs,
    fontWeight: fontWeight.medium,
    color: colors.accentText,
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
  // The block a drag has lifted, left in place faded so it's clear what moved.
  blockLifted: {
    opacity: 0.35,
  },
  // Where the dragged block would land: the full track's width, raised.
  ghost: {
    position: 'absolute',
    left: 0,
    right: spacing.xs,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  ghostTime: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text,
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
    width: 20,
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.textTertiary,
  },
  instant: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  instantDot: {
    width: 6,
    height: 6,
    // Sits on the first line's centre when the title wraps to a second.
    marginTop: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  instantText: {
    flex: 1,
    fontSize: font.xxs,
    color: colors.textSecondary,
  },
});
