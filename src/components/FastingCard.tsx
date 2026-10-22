import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Fast } from '../types';
import { InlineAction } from './InlineAction';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { formatTimeOfDay } from '../utils/dateUtils';
import {
  activeFast,
  describeFastLength,
  describeFastMoment,
  fastElapsedMs,
  fastGoalAt,
  fastProgress,
  formatFastElapsed,
  lastEndedFast,
} from '../utils/fasting';

interface Props {
  fasts: readonly Fast[];
  onStart: () => void;
  onEdit: (fast: Fast) => void;
  onEnd: () => void;
  /** Opens the past fasts sheet; shown once any fast has ended. */
  onHistory: () => void;
}

/**
 * The fast on the Food log: a running one's time against its goal, or the one
 * that ended today with a way to start the next. The screen shows it only while
 * either is true (`showsFastingCard`), so somebody who never fasts never sees it.
 *
 * One colour for the bar whether under or past the goal, and the goal reached
 * changes only the line under it: see the header of `src/utils/fasting.ts` for
 * why nothing here grades a fast.
 */
export function FastingCard({ fasts, onStart, onEdit, onEnd, onHistory }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const running = activeFast(fasts);
  const last = running ? null : lastEndedFast(fasts);
  const anyEnded = fasts.some(f => f.endedAt !== null);

  // Ticks while a fast runs. Every 30 seconds is enough for a clock that reads
  // in minutes, and nothing ticks once it has ended.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!running) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [running]);

  const time = (d: Date) => formatTimeOfDay(d);

  if (running) {
    const elapsed = fastElapsedMs(running, now);
    const goalAt = fastGoalAt(running);
    const reached = goalAt.getTime() <= now.getTime();
    return (
      <View style={styles.card}>
        <Text style={styles.label}>FASTING</Text>
        <View
          style={styles.clockRow}
          accessible
          accessibilityLabel={`Fasting for ${describeFastLength(elapsed)}, of a ${running.goalHours} hour goal`}
        >
          <Text style={styles.clock}>{formatFastElapsed(elapsed)}</Text>
          <Text style={styles.of}>{`of ${running.goalHours} ${running.goalHours === 1 ? 'hour' : 'hours'}`}</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(fastProgress(running, now) * 100)}%` }]} />
        </View>
        <Text style={styles.line}>
          {`Started ${describeFastMoment(new Date(running.startedAt), now, time)} · `}
          {reached
            ? `${running.goalHours} hours reached at ${describeFastMoment(goalAt, now, time)}`
            : `${running.goalHours} hours at ${describeFastMoment(goalAt, now, time)}`}
        </Text>
        <View style={styles.actions}>
          <InlineAction label="End fast" onPress={onEnd} />
          <InlineAction label="Edit" variant="neutral" onPress={() => onEdit(running)} />
          {anyEnded && <InlineAction label="Past fasts" variant="neutral" onPress={onHistory} />}
        </View>
      </View>
    );
  }

  if (!last) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.label}>FASTING</Text>
      <Text style={styles.line}>
        {`Last fast: ${describeFastLength(fastElapsedMs(last, now))}, ended ${describeFastMoment(new Date(last.endedAt!), now, time)}.`}
      </Text>
      <View style={styles.actions}>
        <InlineAction label="Start a fast" onPress={onStart} />
        <InlineAction label="Edit" variant="neutral" onPress={() => onEdit(last)} />
        <InlineAction label="Past fasts" variant="neutral" onPress={onHistory} />
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, letterSpacing: 0.8,
  },
  clockRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  clock: { color: colors.text, fontSize: 34, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  of: { color: colors.textSecondary, fontSize: font.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.bgTertiary, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.accent },
  line: { color: colors.textSecondary, fontSize: font.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
