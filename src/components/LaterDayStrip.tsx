import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { format } from 'date-fns/format';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import type { LaterStripDay } from '../utils/taskGrouping';

interface Props {
  days: readonly LaterStripDay[];
  onSelect: (day: LaterStripDay) => void;
}

/**
 * The next seven days as a row of chips under Later's pills. Tapping one
 * scrolls the list to that day (the screen's `jumpToLaterTask`). A day with no
 * tasks is dimmed and does nothing, since there is no header to land on, and
 * a day with tasks says so with the count in its accessibility label.
 */
export function LaterDayStrip({ days, onSelect }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      {days.map(day => {
        const empty = day.count === 0;
        const weekday = format(day.date, 'EEE');
        return (
          <PressableScale
            key={day.dayKey}
            style={[styles.chip, empty && styles.chipEmpty]}
            disabled={empty}
            onPress={() => onSelect(day)}
            accessibilityLabel={
              empty
                ? `${format(day.date, 'EEEE, MMMM d')}, no tasks`
                : `Scroll to ${format(day.date, 'EEEE, MMMM d')}, ${day.count} ${day.count === 1 ? 'task' : 'tasks'}`
            }
            accessibilityState={{ disabled: empty }}
          >
            <Text style={[styles.weekday, empty && styles.dim]} numberOfLines={1}>
              {day.isToday ? 'Today' : weekday}
            </Text>
            <Text style={[styles.number, empty && styles.dim]}>{format(day.date, 'd')}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs,
  },
  chip: {
    flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: spacing.xsm,
    borderRadius: radius.md, backgroundColor: colors.bgSecondary,
  },
  chipEmpty: { backgroundColor: 'transparent' },
  weekday: { color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.medium },
  number: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  dim: { color: colors.textTertiary },
});
