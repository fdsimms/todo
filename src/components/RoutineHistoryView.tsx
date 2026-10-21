import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { catalogExercise } from '../utils/exerciseCatalog';
import { weightScale } from '../utils/dumbbellLoad';
import {
  diffRoutines, routineHistory, summarizeDiff, versionSpanText, workoutCountText,
  type RoutineVersionEntry,
} from '../utils/routineVersions';

/**
 * A routine's History tab: every version, newest first, each with when it was
 * in use, how many workouts were done on it and what it changed from the one
 * before. A row opens the version's page (`RoutineVersionSheet`), which the
 * host renders inside its own sheet, as it does the exercise page. Reads the
 * routine as saved, like the Progress tab.
 */
interface Props {
  routineId: string;
  onOpenVersion: (versionId: string) => void;
  /** Offered when there is another routine to merge in. */
  onMerge: () => void;
}

export function RoutineHistoryView({ routineId, onOpenVersion, onMerge }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const routines = useWorkoutStore(s => s.routines);
  const versions = useWorkoutStore(s => s.routineVersions);
  const sessions = useWorkoutStore(s => s.sessions);
  const exercises = useWorkoutStore(s => s.exercises);
  const unit = useSettingsStore(s => s.workoutUnit);
  const defaultRest = useSettingsStore(s => s.defaultRestSeconds);
  const dumbbellEntry = useSettingsStore(s => s.dumbbellEntry);
  const routine = routines.find(r => r.id === routineId) ?? null;

  const entries = useMemo(
    () => (routine ? routineHistory(routine, versions, sessions) : []),
    [routine, versions, sessions],
  );
  if (!routine) return null;

  const nameOf = (id: string) => catalogExercise(exercises, id)?.name ?? 'Unknown exercise';
  const scaleOf = (id: string) => weightScale(catalogExercise(exercises, id), dumbbellEntry);
  const changeLine = (e: RoutineVersionEntry): string => {
    if (e.previous) {
      return summarizeDiff(diffRoutines(e.previous, e.version, defaultRest), nameOf, unit, scaleOf)
        ?? (e.previous.name !== e.version.name ? `Renamed from ${e.previous.name}` : 'No changes to the plan');
    }
    // The first version says where it came from, and the name it had when
    // that isn't the routine's now (one merged in from another routine).
    const origin = e.version.source === 'initial' ? 'Before history was kept'
      : e.version.source === 'copy' ? 'Copied from another routine'
      : 'First version';
    return e.version.name !== routine.name ? `${origin}, as ${e.version.name}` : origin;
  };
  const canMerge = routines.some(r => r.id !== routine.id);

  return (
    <View>
      <View style={styles.card}>
        {entries.map((e, i) => (
          <TouchableOpacity
            key={e.version.id}
            style={[styles.row, i > 0 && styles.rowSep]}
            onPress={() => onOpenVersion(e.version.id)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Version ${e.number}${e.current ? ', current' : ''}${e.version.label ? `, ${e.version.label}` : ''}`}
            accessibilityHint="Opens this version to compare or restore it"
          >
            <View style={styles.flex}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{`Version ${e.number}`}</Text>
                {e.current && <Text style={[styles.chip, styles.chipCurrent]}>Current</Text>}
                {e.version.label && <Text style={[styles.chip, styles.chipLabel]} numberOfLines={1}>{e.version.label}</Text>}
              </View>
              <Text style={styles.sub}>{`${versionSpanText(e.from, e.until)} · ${workoutCountText(e.sessions.length)}`}</Text>
              <Text style={styles.change} numberOfLines={2}>{changeLine(e)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </View>
      <HelpText style={styles.foot}>
        A version is what you trained on. Changes saved between two workouts count as one version.
      </HelpText>
      {canMerge && (
        <View style={styles.actions}>
          <InlineAction icon="git-merge-outline" label="Merge in another routine" variant="neutral" surface="page" onPress={onMerge} />
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  flex: { flex: 1 },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xsm },
  title: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  chip: {
    fontSize: font.xxs, fontWeight: fontWeight.semibold, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
    borderRadius: radius.full, overflow: 'hidden', maxWidth: 180,
  },
  chipCurrent: { color: colors.accentText, backgroundColor: colors.accentSubtle },
  chipLabel: { color: colors.textSecondary, backgroundColor: colors.bgTertiary },
  sub: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  change: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  foot: { color: colors.textTertiary, fontSize: font.xs, marginHorizontal: spacing.xs, marginTop: spacing.smd },
  actions: { flexDirection: 'row', marginTop: spacing.md },
});
