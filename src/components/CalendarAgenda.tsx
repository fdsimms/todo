import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  describeGap,
  isAgendaItemPast,
  type AgendaItem,
  type DayAgenda,
} from '../utils/calendarAgenda';
import { formatTimeOfDay } from '../utils/dateUtils';
import { useColors } from '../theme/ThemeContext';
import { useTextScale } from '../hooks/useTextScale';
import { checkboxRadius, flattenOverlay, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { CheckPop } from './CheckPop';

/** The way into a day's tasks that have no time, under its agenda. */
export interface UntimedLink {
  /** "3 tasks without a time". */
  label: string;
  /** "Open Today" / "Open in Later". */
  action: string;
  onPress: () => void;
}

interface Props {
  agenda: DayAgenda;
  /** The logical day's start, which every line's minutes count from. */
  dayStart: Date;
  /** A calendar's color, or undefined when it has none. */
  colorFor: (calendarId: string) => string | undefined;
  use24Hour: boolean;
  /** Minutes into the day now, on today only: dims what's over. */
  nowMinutes: number | null;
  onPressEvent: (event: BusyEvent) => void;
  onPressTask: (task: Task) => void;
  onToggleTask: (task: Task) => void;
  untimed: UntimedLink | null;
  /** Said in place of the card when nothing on the day has a time. */
  emptyText: string;
}

const CHECKBOX = 20;
const BAR_WIDTH = 4;

/**
 * One day of the calendar as a list: all-day events as chips, then every
 * event and timed task in start order in one card, then a single line leading
 * to the day's other tasks. See `calendarAgenda.ts` for what earns a line.
 *
 * An event's line is its calendar's color, the way every calendar app marks
 * whose it is; a task's is its checkbox, so the two kinds read apart at a
 * glance without a legend.
 */
export function CalendarAgenda({
  agenda, dayStart, colorFor, use24Hour, nowMinutes, onPressEvent, onPressTask, onToggleTask, untimed, emptyText,
}: Props) {
  const colors = useColors();
  const textScale = useTextScale();
  const styles = useMemo(() => makeStyles(colors, textScale), [colors, textScale]);
  const at = (minutes: number) => new Date(dayStart.getTime() + minutes * 60000);

  const renderNowLine = () => (
    <View key="now" style={styles.nowRow} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={styles.nowDot} />
      <View style={styles.nowLine} />
    </View>
  );

  const renderItem = (item: AgendaItem, index: number) => {
    const past = nowMinutes !== null && isAgendaItemPast(item, nowMinutes);
    const start = formatTimeOfDay(at(item.startMinutes), use24Hour);
    const end = item.instant ? null : formatTimeOfDay(at(item.endMinutes), use24Hour);
    const task = item.task;
    const event = item.event;
    const isTask = item.kind === 'task' && task !== null;
    const meta = isTask
      ? ['Task', task.category ?? null].filter(Boolean).join(' · ')
      : [event?.videoCall ? 'Video call' : null, event?.location || null].filter(Boolean).join(' · ');
    const barColor = event ? colorFor(event.calendarId) ?? colors.accent : colors.accent;
    const done = isTask && task.completed;
    const onPress = () => {
      if (isTask) onPressTask(task);
      else if (event) onPressEvent(event);
    };
    return (
      <React.Fragment key={item.key}>
        {item.gapBefore !== null && (
          <View style={[styles.gapRow, styles.divided]}>
            <Text style={styles.gapText}>{describeGap(item.gapBefore)}</Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.row, (index > 0 || item.gapBefore !== null) && styles.divided, past && styles.rowPast]}
          activeOpacity={interaction.activeOpacity}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${item.title || 'Event'}, ${end ? `${start} to ${end}` : start}${meta ? `, ${meta}` : ''}`}
        >
          <View style={styles.timeColumn}>
            <Text style={styles.timeStart}>{start}</Text>
            {end !== null && <Text style={styles.timeEnd}>{end}</Text>}
          </View>
          {isTask ? (
            <TouchableOpacity
              hitSlop={spacing.sm}
              activeOpacity={interaction.activeOpacity}
              onPress={() => onToggleTask(task)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              accessibilityLabel={`Complete ${task.title}`}
            >
              <CheckPop checked={done} style={styles.checkbox} checkedStyle={styles.checkboxDone}>
                <Ionicons name="checkmark" size={iconSize.sm - 2} color={colors.onDone} />
              </CheckPop>
            </TouchableOpacity>
          ) : (
            <View style={[styles.bar, { backgroundColor: barColor }]} />
          )}
          <View style={styles.body}>
            <Text style={[styles.title, isTask && styles.titleTask, done && styles.titleDone]} numberOfLines={2}>
              {item.title || 'Event'}
            </Text>
            {meta !== '' && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
          </View>
        </TouchableOpacity>
      </React.Fragment>
    );
  };

  const lines: React.ReactNode[] = [];
  agenda.items.forEach((item, i) => {
    if (agenda.nowIndex === i) lines.push(renderNowLine());
    lines.push(renderItem(item, i));
  });
  if (agenda.nowIndex !== null && agenda.nowIndex === agenda.items.length && agenda.items.length > 0) {
    lines.push(renderNowLine());
  }

  return (
    <View style={styles.container}>
      {agenda.allDay.length > 0 && (
        <View style={styles.chips}>
          {agenda.allDay.map(event => {
            const color = colorFor(event.calendarId) ?? colors.accent;
            return (
              <TouchableOpacity
                key={`${event.id}:${event.start}`}
                style={[styles.chip, { backgroundColor: tintOf(color, colors) }]}
                activeOpacity={interaction.activeOpacity}
                onPress={() => onPressEvent(event)}
                accessibilityRole="button"
                accessibilityLabel={`${event.title || 'Event'}, all day`}
              >
                <View style={[styles.chipDot, { backgroundColor: color }]} />
                <Text style={styles.chipText} numberOfLines={1}>{event.title || 'Event'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {agenda.items.length > 0 ? (
        <View style={styles.card}>{lines}</View>
      ) : (
        agenda.allDay.length === 0 && <Text style={styles.empty}>{emptyText}</Text>
      )}
      {untimed && <UntimedRow link={untimed} />}
    </View>
  );
}

/**
 * The one line standing in for every task on a day that has no time: how
 * many, and the list that owns them. Exported for the Day view, which draws
 * the timed half on its clock instead of as a list.
 */
export function UntimedRow({ link }: { link: UntimedLink }) {
  const colors = useColors();
  const textScale = useTextScale();
  const styles = useMemo(() => makeStyles(colors, textScale), [colors, textScale]);
  return (
    <TouchableOpacity
      style={styles.untimed}
      activeOpacity={interaction.activeOpacity}
      onPress={link.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${link.label}. ${link.action}.`}
    >
      <Ionicons name="checkbox-outline" size={iconSize.sm} color={colors.textSecondary} />
      <Text style={styles.untimedLabel} numberOfLines={1}>{link.label}</Text>
      <Text style={styles.untimedAction}>{link.action}</Text>
      <Ionicons name="chevron-forward" size={14} color={colors.accentText} />
    </TouchableOpacity>
  );
}

/**
 * A calendar's color as a chip's fill: a fifth of it over the card, made
 * opaque so the chip doesn't change with whatever is behind the list. A color
 * that isn't a plain hex (EventKit has handed back an empty string) falls back
 * to the accent's own tint.
 */
function tintOf(color: string, colors: Colors): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return flattenOverlay(colors.accentSubtle, colors.bgSecondary);
  return flattenOverlay(`${color}33`, colors.bgSecondary);
}

function makeStyles(colors: Colors, textScale: number) {
  return StyleSheet.create({
    container: {
      marginHorizontal: spacing.md,
      gap: spacing.sm,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xsm,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xsm,
      maxWidth: '100%',
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.xsm,
      borderRadius: radius.sm,
    },
    chipDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    chipText: {
      flexShrink: 1,
      color: colors.text,
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.smd,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.smd,
    },
    divided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    rowPast: {
      opacity: 0.5,
    },
    // Fixed width so every title starts at the same x whatever the time's
    // length ("9:00 AM" against "12:30 PM").
    timeColumn: {
      width: Math.round(64 * textScale),
      alignItems: 'flex-end',
    },
    timeStart: {
      color: colors.text,
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      fontVariant: ['tabular-nums'],
    },
    timeEnd: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontVariant: ['tabular-nums'],
      marginTop: spacing.xxs,
    },
    bar: {
      width: BAR_WIDTH,
      alignSelf: 'stretch',
      borderRadius: BAR_WIDTH / 2,
    },
    checkbox: {
      width: CHECKBOX,
      height: CHECKBOX,
      borderRadius: checkboxRadius(CHECKBOX),
      borderWidth: 2,
      borderColor: colors.controlBorder,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxDone: {
      backgroundColor: colors.done,
      borderColor: colors.done,
    },
    body: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    titleTask: {
      fontWeight: fontWeight.medium,
    },
    titleDone: {
      color: colors.textSecondary,
      textDecorationLine: 'line-through',
    },
    meta: {
      color: colors.textSecondary,
      fontSize: font.sm,
      marginTop: spacing.xxs,
    },
    gapRow: {
      paddingVertical: spacing.xsm,
      // Lines up with the titles: the card's padding, the time column, the
      // bar or box and the gaps between them.
      paddingLeft: spacing.smd + Math.round(64 * textScale) + spacing.smd + BAR_WIDTH + spacing.smd,
    },
    gapText: {
      color: colors.textSecondary,
      fontSize: font.xs,
    },
    nowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: spacing.smd + Math.round(64 * textScale) + spacing.xs,
      paddingRight: spacing.smd,
      height: 2,
      zIndex: 1,
    },
    nowDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.red,
    },
    nowLine: {
      flex: 1,
      height: 2,
      backgroundColor: colors.red,
    },
    // Dim on purpose: on a day with nothing, the dimness is what says so.
    empty: {
      color: colors.textTertiary,
      fontSize: font.sm,
      paddingVertical: spacing.xs,
    },
    untimed: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 44,
      paddingHorizontal: spacing.smd,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
    },
    untimedLabel: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
    },
    untimedAction: {
      color: colors.accentText,
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
    },
  });
}
