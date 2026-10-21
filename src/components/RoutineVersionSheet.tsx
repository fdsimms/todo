import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { HelpText } from './HelpText';
import { VersionLabelSheet } from './VersionLabelSheet';
import type { WorkoutRoutineVersion } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { catalogExercise } from '../utils/exerciseCatalog';
import { weightScale } from '../utils/dumbbellLoad';
import { formatVolume } from '../utils/workoutRecordText';
import {
  changeParts, diffIsEmpty, diffRoutines, routineHistory, versionSpanText, versionStats, workoutCountText,
  type ItemDiff, type RoutineVersionEntry,
} from '../utils/routineVersions';

interface Props {
  visible: boolean;
  routineId: string | null;
  versionId: string | null;
  onClose: () => void;
  /** Loads the version into the editor as unsaved changes. */
  onRestore: (version: WorkoutRoutineVersion) => void;
  /** Starts a workout from this version. Without it the sheet doesn't offer to. */
  onStart?: (versionId: string) => void;
}

type Compare = 'current' | 'previous';

/**
 * One version of a routine, opened from History: how it went beside the
 * version it is compared with (the current one, or the one before it), what
 * changed between the two, and what can be done with it. Rendered inside the
 * routine editor's own Modal, as the exercise page is. It judges nothing:
 * figures side by side, an added exercise in the accent and a removed one in
 * the neutral text color, never a better or worse.
 */
export function RoutineVersionSheet({ visible, routineId, versionId, onClose, onRestore, onStart }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const routines = useWorkoutStore(s => s.routines);
  const versions = useWorkoutStore(s => s.routineVersions);
  const sessions = useWorkoutStore(s => s.sessions);
  const exercises = useWorkoutStore(s => s.exercises);
  const volumes = useWorkoutStore(s => s.volumeKgBySession);
  const unit = useSettingsStore(s => s.workoutUnit);
  const defaultRest = useSettingsStore(s => s.defaultRestSeconds);
  const dumbbellEntry = useSettingsStore(s => s.dumbbellEntry);
  const [compare, setCompare] = useState<Compare>('current');
  const [naming, setNaming] = useState(false);

  const routine = routineId ? routines.find(r => r.id === routineId) ?? null : null;
  const history = useMemo(() => (routine ? routineHistory(routine, versions, sessions) : []), [routine, versions, sessions]);
  const entry = history.find(e => e.version.id === versionId) ?? null;
  const current = history.find(e => e.current) ?? null;
  const previous = entry ? history.find(e => e.number === entry.number - 1) ?? null : null;

  useEffect(() => {
    if (visible) { setCompare(entry?.current ? 'previous' : 'current'); setNaming(false); }
    // On open only, so the choice survives the version being renamed underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, versionId]);

  const other: RoutineVersionEntry | null = !entry ? null
    : compare === 'current' && !entry.current ? current
    : previous;
  // Older on the left of the diff, whichever side this version is.
  const otherIsNewer = !!other && !!entry && other.number > entry.number;
  const diff = entry && other
    ? diffRoutines(otherIsNewer ? entry.version : other.version, otherIsNewer ? other.version : entry.version, defaultRest)
    : null;

  const options: SegmentOption<Compare>[] = [];
  if (entry && !entry.current && current) options.push({ value: 'current', label: `vs Current (v${current.number})` });
  if (previous) options.push({ value: 'previous', label: `vs Version ${previous.number}` });

  const nameOf = (id: string) => catalogExercise(exercises, id)?.name ?? 'Unknown exercise';
  const scaleOf = (id: string) => weightScale(catalogExercise(exercises, id), dumbbellEntry);
  const otherLabel = (e: RoutineVersionEntry) => (e.current ? 'Current' : `Version ${e.number}`);

  const copy = () => {
    if (!entry) return;
    const made = useWorkoutStore.getState().copyRoutineVersion(entry.version.id);
    if (typeof made === 'string') { haptics.warning(); return; }
    haptics.success();
    Alert.alert('Copied to a new routine', `“${made.name}” is on your Routines list.`);
  };

  const statsColumn = (e: RoutineVersionEntry, label: string) => {
    const st = versionStats(e.sessions, volumes);
    return (
      <View style={styles.col}>
        <Text style={styles.colLabel}>{label}</Text>
        <Text style={styles.colValue}>{workoutCountText(st.workouts)}</Text>
        {st.avgVolumeKg !== null && (
          <Text style={styles.colSub}>{`${formatVolume(st.avgVolumeKg, 'weight_reps', unit)} avg volume`}</Text>
        )}
        <Text style={styles.colSub}>{versionSpanText(e.from, e.until)}</Text>
      </View>
    );
  };

  const itemRow = (d: ItemDiff, i: number) => {
    if (d.status === 'same') return null;
    const sep = i > 0 && styles.rowSep;
    if (d.status === 'changed') {
      return (
        <View key={`${d.exerciseId}-${i}`} style={[styles.item, sep]}>
          <Text style={styles.itemName}>{nameOf(d.exerciseId)}</Text>
          <Text style={styles.itemDetail}>
            {d.changes.map((c, j) => {
              const p = changeParts(c, unit, scaleOf(d.exerciseId));
              return (
                <Text key={c.field}>
                  {j > 0 ? ' · ' : ''}{`${p.label} `}<Text style={styles.old}>{p.from}</Text>{' → '}<Text style={styles.new}>{p.to}</Text>
                </Text>
              );
            })}
          </Text>
        </View>
      );
    }
    if (d.status === 'removed') {
      return (
        <View key={`${d.exerciseId}-${i}`} style={[styles.item, sep]}>
          <Text style={[styles.itemName, styles.struck]}>{nameOf(d.exerciseId)}</Text>
          <Text style={styles.itemDetail}><Text style={styles.tagRemoved}>REMOVED</Text></Text>
        </View>
      );
    }
    return (
      <View key={`${d.exerciseId}-${i}`} style={[styles.item, sep]}>
        <Text style={styles.itemName}>{nameOf(d.exerciseId)}</Text>
        <Text style={styles.itemDetail}>
          {d.status === 'added'
            ? <><Text style={styles.tagAdded}>ADDED</Text>{` · ${d.sets === 1 ? '1 set' : `${d.sets} sets`}`}</>
            : <><Text style={styles.tagAdded}>SWAPPED</Text>{` · in place of ${nameOf(d.fromExerciseId)}`}</>}
        </Text>
      </View>
    );
  };

  const shown = diff ? diff.items.filter(d => d.status !== 'same') : [];
  const unchanged = diff ? diff.items.filter(d => d.status === 'same').length : 0;

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} name="RoutineVersionSheet">
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SheetHeader
          title={entry ? `Version ${entry.number}` : 'Version'}
          left={<SheetHeaderButton label="History" role="cancel" onPress={onClose} minWidth={64} accessibilityLabel="Back to History" />}
          right={<SheetHeaderButton label="Name" onPress={() => { haptics.tap(); setNaming(true); }} minWidth={64} accessibilityLabel="Name this version" />}
        />
        {entry && (
          <ScrollView style={styles.flex} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]} showsVerticalScrollIndicator={false}>
            {options.length > 1 && (
              <SegmentedControl options={options} value={compare} onChange={setCompare} surface="page" label="Compare with" />
            )}

            <Text style={styles.groupLabel}>How it went</Text>
            <View style={styles.card}>
              <View style={styles.cols}>
                {statsColumn(entry, `Version ${entry.number}`)}
                {other && <View style={styles.colSep} />}
                {other && statsColumn(other, otherLabel(other))}
              </View>
            </View>

            {other && diff && (
              <>
                <Text style={styles.groupLabel}>
                  {otherIsNewer ? `Changed since version ${entry.number}` : `Changed from version ${other.number}`}
                </Text>
                {diffIsEmpty(diff) ? (
                  <Text style={styles.foot}>The two plans are the same.</Text>
                ) : (
                  <>
                    <View style={styles.card}>
                      {shown.map(itemRow)}
                      {diff.orderChanged && (
                        <View style={[styles.item, shown.length > 0 && styles.rowSep]}>
                          <Text style={styles.itemName}>Order</Text>
                          <Text style={styles.itemDetail}>The exercises come in a different order.</Text>
                        </View>
                      )}
                      {diff.notesChanged && (
                        <View style={[styles.item, (shown.length > 0 || diff.orderChanged) && styles.rowSep]}>
                          <Text style={styles.itemName}>Notes</Text>
                          <Text style={styles.itemDetail} numberOfLines={3}>
                            {(otherIsNewer ? other.version.notes : entry.version.notes) || 'Notes removed'}
                          </Text>
                        </View>
                      )}
                    </View>
                    {unchanged > 0 && (
                      <Text style={styles.foot}>{unchanged === 1 ? '1 exercise unchanged' : `${unchanged} exercises unchanged`}</Text>
                    )}
                  </>
                )}
              </>
            )}
            {!other && <Text style={styles.foot}>This is the only version so far.</Text>}

            <View style={styles.actions}>
              {!entry.current && (
                <>
                  <TouchableOpacity
                    style={[styles.button, styles.primary]}
                    onPress={() => { haptics.tap(); onRestore(entry.version); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryText}>{`Restore version ${entry.number}`}</Text>
                  </TouchableOpacity>
                  {onStart && (
                    <TouchableOpacity
                      style={[styles.button, styles.secondary]}
                      onPress={() => onStart(entry.version.id)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                    >
                      <Text style={styles.secondaryText}>Start a workout from it</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
              <TouchableOpacity
                style={[styles.button, styles.secondary]}
                onPress={copy}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>Copy to a new routine</Text>
              </TouchableOpacity>
            </View>
            {!entry.current && (
              <HelpText style={styles.foot}>
                Restoring puts this plan back in the editor. Saving it makes it the newest version, and nothing in History is lost.
              </HelpText>
            )}
          </ScrollView>
        )}
      </View>
      <VersionLabelSheet
        visible={visible && naming}
        versionId={entry?.version.id ?? null}
        current={entry?.version.label ?? null}
        onClose={() => setNaming(false)}
      />
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  cols: { flexDirection: 'row' },
  col: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, gap: spacing.xxs },
  colSep: { width: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  colLabel: { color: colors.textSecondary, fontSize: font.xs },
  colValue: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  colSub: { color: colors.textSecondary, fontSize: font.sm, fontVariant: ['tabular-nums'] },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  item: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  itemName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  itemDetail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs, fontVariant: ['tabular-nums'] },
  old: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  new: { color: colors.text, fontWeight: fontWeight.semibold },
  struck: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  tagAdded: { color: colors.accentText, fontSize: font.xxs, fontWeight: fontWeight.bold, letterSpacing: 0.6 },
  tagRemoved: { color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.bold, letterSpacing: 0.6 },
  foot: { color: colors.textTertiary, fontSize: font.xs, marginHorizontal: spacing.xs, marginTop: spacing.smd },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  button: { minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  primary: { backgroundColor: colors.accentFill },
  primaryText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  secondary: { backgroundColor: colors.bgSecondary },
  secondaryText: { color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold },
});
