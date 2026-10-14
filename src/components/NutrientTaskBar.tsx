import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { foodLogTotals } from '../utils/foodLog';
import { getLogicalDayKey } from '../utils/dateUtils';
import { nutrientTaskBar, nutrientTaskLine } from '../utils/nutrientTaskBar';
import type { Task } from '../types';

const BAR_HEIGHT = 4;

interface Props {
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>;
  /** The days the task has stayed within its limit; null hides the flame. */
  streak: number | null;
  streakColor: string;
  /** A met Aim for goal: a check takes the flame's place. */
  done: boolean;
}

/**
 * What a Stay under or Aim for row draws in place of its title and checkbox:
 * the nutrient and "24.9 / 16g" on one line, the progress bar under it. The
 * title keeps the full sentence for the accessibility label and Search; the
 * row only needs where the day stands. Reads the food log itself so
 * `TaskItem`'s memo needs no new prop, and renders nothing for any other task.
 */
export function NutrientTaskBar({ task, streak, streakColor, done }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const relevant = task.generatedKind === 'limitWarning' || task.generatedKind === 'goalTarget';
  const recentEntries = useFoodLogStore(s => s.recentEntries);
  // Subscribed so the row follows a log or a delete, as the Today rows do.
  useFoodLogStore(s => s.totalCount);
  useFoodLogStore(s => s.entries);
  const targets = useSettingsStore(s => s.nutritionTargets);
  const warnPercent = useSettingsStore(s => s.limitWarnPercent);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  if (!relevant) return null;
  const dayKey = getLogicalDayKey(new Date(), dayResetTime);
  const totals = foodLogTotals(recentEntries(dayKey, dayKey)).total;
  const line = nutrientTaskLine(task, totals, targets);
  const bar = nutrientTaskBar(task, totals, targets, warnPercent);
  if (!line || !bar) return null;
  const fill = bar.tone === 'over' ? colors.red : bar.tone === 'near' ? colors.orange : colors.accent;
  return (
    <View importantForAccessibility="no-hide-descendants">
      <View style={styles.line}>
        <Text style={styles.name} numberOfLines={1}>{line.name}</Text>
        {done ? (
          <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.done} />
        ) : streak !== null ? (
          <View style={styles.streak}>
            <Ionicons name={streak > 0 ? 'flame' : 'flame-outline'} size={iconSize.xs} color={streak > 0 ? streakColor : colors.textSecondary} />
            <Text style={[styles.streakText, streak > 0 && { color: streakColor }]}>{streak}</Text>
          </View>
        ) : null}
        <Text style={[styles.figure, bar.tone === 'over' && styles.figureOver]} numberOfLines={1}>{line.figure}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(bar.fraction * 100)}%`, backgroundColor: fill }]} />
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // The name takes the row's flexible width and the figure, flame and check
    // are the short fixed things beside it, so a long nutrient name is what
    // truncates and the figure never does.
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { flex: 1, fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    figure: { fontSize: font.sm, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    figureOver: { color: colors.redText, fontWeight: fontWeight.semibold },
    streak: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
    streakText: { fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.textSecondary },
    track: {
      height: BAR_HEIGHT,
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
      overflow: 'hidden',
      marginTop: spacing.xsm,
    },
    fill: { height: BAR_HEIGHT, borderRadius: radius.full },
  });
}
