import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { HelpText } from './HelpText';
import { VersionLabelSheet } from './VersionLabelSheet';
import type { WorkoutProgramVersion } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  diffPrograms, programDiffIsEmpty, programHistory, programSchemeText, programWeeksText, versionSpanText, workoutCountText,
  type ProgramVersionEntry,
} from '../utils/routineVersions';

interface Props {
  visible: boolean;
  programId: string | null;
  versionId: string | null;
  onClose: () => void;
  /** Loads the version's structure into the program editor as unsaved changes. */
  onRestore: (version: WorkoutProgramVersion) => void;
}

type Compare = 'current' | 'previous';

/**
 * One version of a program, opened from the program editor's History card:
 * the routine version page's shape for a block. How it went beside the
 * version it is compared with, what changed in the rotation, length and
 * progression, and the version each routine was on through the block.
 * Rendered inside the program editor's own Modal. Like the routine page it
 * judges nothing.
 */
export function ProgramVersionSheet({ visible, programId, versionId, onClose, onRestore }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const programs = useWorkoutStore(s => s.programs);
  const programVersions = useWorkoutStore(s => s.programVersions);
  const routines = useWorkoutStore(s => s.routines);
  const routineVersions = useWorkoutStore(s => s.routineVersions);
  const sessions = useWorkoutStore(s => s.sessions);
  const [compare, setCompare] = useState<Compare>('current');
  const [naming, setNaming] = useState(false);

  const program = programId ? programs.find(p => p.id === programId) ?? null : null;
  const history = useMemo(
    () => (program ? programHistory(program, programVersions, routines, routineVersions, sessions) : []),
    [program, programVersions, routines, routineVersions, sessions],
  );
  const entry = history.find(e => e.version.id === versionId) ?? null;
  const current = history.find(e => e.current) ?? null;
  const previous = entry ? history.find(e => e.number === entry.number - 1) ?? null : null;

  useEffect(() => {
    if (visible) { setCompare(entry?.current ? 'previous' : 'current'); setNaming(false); }
    // On open only, so the choice survives the version being renamed underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, versionId]);

  const other: ProgramVersionEntry | null = !entry ? null
    : compare === 'current' && !entry.current ? current
    : previous;
  const otherIsNewer = !!other && !!entry && other.number > entry.number;
  const diff = entry && other
    ? diffPrograms(otherIsNewer ? entry.version : other.version, otherIsNewer ? other.version : entry.version)
    : null;

  const options: SegmentOption<Compare>[] = [];
  if (entry && !entry.current && current) options.push({ value: 'current', label: `vs Current (v${current.number})` });
  if (previous) options.push({ value: 'previous', label: `vs Version ${previous.number}` });

  const routineName = (id: string) => routines.find(r => r.id === id)?.name ?? 'A deleted routine';

  const statsColumn = (e: ProgramVersionEntry, label: string) => (
    <View style={styles.col}>
      <Text style={styles.colLabel}>{label}</Text>
      <Text style={styles.colValue}>{workoutCountText(e.workouts)}</Text>
      <Text style={styles.colSub}>{versionSpanText(e.from, e.until)}</Text>
      <Text style={styles.colSub}>{`${programWeeksText(e.version.weeks)} · ${programSchemeText(e.version.scheme)}`}</Text>
    </View>
  );

  const rows: { key: string; title: string; detail: React.ReactNode; struck?: boolean }[] = [];
  if (diff) {
    for (const id of diff.added) {
      rows.push({ key: `add-${id}-${rows.length}`, title: routineName(id), detail: <><Text style={styles.tagAdded}>ADDED</Text>{' · to the rotation'}</> });
    }
    for (const id of diff.removed) {
      rows.push({ key: `rem-${id}-${rows.length}`, title: routineName(id), struck: true, detail: <><Text style={styles.tagRemoved}>REMOVED</Text>{' · from the rotation'}</> });
    }
    if (diff.orderChanged) rows.push({ key: 'order', title: 'Order', detail: 'The routines come round in a different order.' });
    const change = (from: string, to: string) => (
      <><Text style={styles.old}>{from}</Text>{' → '}<Text style={styles.new}>{to}</Text></>
    );
    if (diff.weeks) rows.push({ key: 'weeks', title: 'Length', detail: change(programWeeksText(diff.weeks.from), programWeeksText(diff.weeks.to)) });
    if (diff.scheme) rows.push({ key: 'scheme', title: 'Progression', detail: change(programSchemeText(diff.scheme.from), programSchemeText(diff.scheme.to)) });
  }

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} name="ProgramVersionSheet">
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SheetHeader
          title={entry ? `Version ${entry.number}` : 'Version'}
          left={<SheetHeaderButton label="Back to program" role="cancel" onPress={onClose} minWidth={120} />}
          right={<SheetHeaderButton label="Name" onPress={() => { haptics.tap(); setNaming(true); }} minWidth={120} accessibilityLabel="Name this version" />}
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
                {other && statsColumn(other, other.current ? 'Current' : `Version ${other.number}`)}
              </View>
            </View>

            {other && diff && (
              <>
                <Text style={styles.groupLabel}>
                  {otherIsNewer ? `Changed since version ${entry.number}` : `Changed from version ${other.number}`}
                </Text>
                {programDiffIsEmpty(diff) ? (
                  <Text style={styles.foot}>The rotation, length and progression are the same.</Text>
                ) : (
                  <View style={styles.card}>
                    {rows.map((r, i) => (
                      <View key={r.key} style={[styles.item, i > 0 && styles.rowSep]}>
                        <Text style={[styles.itemName, r.struck && styles.struck]}>{r.title}</Text>
                        <Text style={styles.itemDetail}>{r.detail}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
            {!other && <Text style={styles.foot}>This is the only version so far.</Text>}

            {entry.routines.length > 0 && (
              <>
                <Text style={styles.groupLabel}>{`Routines in version ${entry.number}`}</Text>
                <View style={styles.card}>
                  {entry.routines.map((r, i) => (
                    <View key={r.routineId} style={[styles.routineRow, i > 0 && styles.rowSep]}>
                      <Text style={styles.routineName}>{routineName(r.routineId)}</Text>
                      <Text style={styles.routineVersion}>
                        {r.startNumber === null ? 'Deleted'
                          : r.endNumber !== null && r.endNumber !== r.startNumber ? `Version ${r.startNumber} to ${r.endNumber}`
                          : `Version ${r.startNumber}`}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {!entry.current && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.button, styles.primary]}
                  onPress={() => { haptics.tap(); onRestore(entry.version); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>{`Restore version ${entry.number}`}</Text>
                </TouchableOpacity>
                <HelpText style={styles.foot}>
                  Restoring puts this rotation, length and progression back in the editor. Saving makes it the newest version. Training maxes aren’t part of a version.
                </HelpText>
              </View>
            )}
          </ScrollView>
        )}
      </View>
      <VersionLabelSheet
        visible={visible && naming}
        current={entry?.version.label ?? null}
        onSave={label => { if (entry) useWorkoutStore.getState().labelProgramVersion(entry.version.id, label); }}
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
  itemDetail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  old: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  new: { color: colors.text, fontWeight: fontWeight.semibold },
  struck: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  tagAdded: { color: colors.accentText, fontSize: font.xxs, fontWeight: fontWeight.bold, letterSpacing: 0.6 },
  tagRemoved: { color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.bold, letterSpacing: 0.6 },
  routineRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 48,
  },
  routineName: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  routineVersion: { color: colors.textSecondary, fontSize: font.sm, flexShrink: 0 },
  foot: { color: colors.textTertiary, fontSize: font.xs, marginHorizontal: spacing.xs, marginTop: spacing.smd },
  actions: { marginTop: spacing.lg },
  button: { minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  primary: { backgroundColor: colors.accentFill },
  primaryText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
