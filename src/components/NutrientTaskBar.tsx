import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { radius, spacing, type Colors } from '../theme';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { foodLogTotals } from '../utils/foodLog';
import { getLogicalDayKey } from '../utils/dateUtils';
import { nutrientTaskBar } from '../utils/nutrientTaskBar';
import type { Task } from '../types';

const BAR_HEIGHT = 6;

/**
 * The progress bar under a Stay under or Aim for task's title: the one its
 * Today info row used to draw, now that the row steps aside while the task is
 * there (`nutrientsCoveredByTasks`). Reads the food log itself so `TaskItem`'s
 * memo needs no new prop, and renders nothing for any other task.
 */
export function NutrientTaskBar({ task }: { task: Pick<Task, 'generatedKind' | 'generatedSourceId'> }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const relevant = task.generatedKind === 'limitWarning' || task.generatedKind === 'goalTarget';
  const recentEntries = useFoodLogStore(s => s.recentEntries);
  // Subscribed so the bar follows a log or a delete, as the Today rows do.
  useFoodLogStore(s => s.totalCount);
  useFoodLogStore(s => s.entries);
  const targets = useSettingsStore(s => s.nutritionTargets);
  const warnPercent = useSettingsStore(s => s.limitWarnPercent);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  if (!relevant) return null;
  const dayKey = getLogicalDayKey(new Date(), dayResetTime);
  const bar = nutrientTaskBar(task, foodLogTotals(recentEntries(dayKey, dayKey)).total, targets, warnPercent);
  if (!bar) return null;
  const fill = bar.tone === 'over' ? colors.red : bar.tone === 'near' ? colors.orange : colors.accent;
  return (
    <View style={styles.track} importantForAccessibility="no-hide-descendants">
      <View style={[styles.fill, { width: `${Math.round(bar.fraction * 100)}%`, backgroundColor: fill }]} />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
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
