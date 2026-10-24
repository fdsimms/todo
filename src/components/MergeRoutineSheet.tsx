import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { format } from 'date-fns/format';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { HelpText } from './HelpText';
import { EmptyNote } from './EmptyNote';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { routineSessionsByVersion, routineVersionsOf, workoutCountText } from '../utils/routineVersions';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The routine the other one's history joins. */
  intoId: string | null;
  onClose: () => void;
}

/**
 * Picks a routine to fold into this one as its earlier history (the "v2"
 * copy made by hand before versions were kept). A tap asks once, saying what
 * moves and that the other routine goes, and the merge is done on the answer:
 * nothing is staged, so there is nothing for a swipe down to lose. The alert
 * is asked whatever "Confirm before deleting" says, since a routine leaving
 * the list is the smaller part of what it does.
 */
export function MergeRoutineSheet({ visible, intoId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const routines = useWorkoutStore(s => s.routines);
  const versions = useWorkoutStore(s => s.routineVersions);
  const sessions = useWorkoutStore(s => s.sessions);
  const into = intoId ? routines.find(r => r.id === intoId) ?? null : null;

  const rows = useMemo(() => routines
    .filter(r => r.id !== intoId)
    .map(r => {
      const own = routineVersionsOf(r, versions);
      const done = [...routineSessionsByVersion(r, own, sessions).values()].flat();
      const last = done.reduce<string | null>((max, s) => (max === null || s.startedAt > max ? s.startedAt : max), null);
      return { routine: r, versions: own.length, workouts: done.length, last };
    }), [routines, versions, sessions, intoId]);

  const ask = (row: (typeof rows)[number]) => {
    if (!into) return;
    haptics.tap();
    const { routine, workouts } = row;
    Alert.alert(
      `Merge ${routine.name} into this routine?`,
      `Its versions and ${workoutCountText(workouts).toLowerCase()} become the earlier history of ${into.name}, and its tasks and place in any program move here. ${routine.name} is then removed from your list.`,
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: 'Merge',
          style: 'destructive',
          onPress: () => {
            const result = useWorkoutStore.getState().mergeRoutines(routine.id, into.id);
            if (result === 'live') {
              haptics.warning();
              Alert.alert('Couldn’t merge', `A workout from ${routine.name} is in progress. Finish it or end it, then merge.`);
              return;
            }
            if (typeof result === 'string') { haptics.warning(); return; }
            haptics.success();
            onClose();
          },
        },
      ],
    );
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} name="MergeRoutineSheet">
      <View style={styles.root}>
        <SheetHeader
          title="Merge history"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={onClose} minWidth={64} />}
          right={<View style={styles.spacer} />}
        />
        <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
          <HelpText style={styles.intro}>
            {`Pick the routine that came before ${into?.name ?? 'this one'}. Its versions and workouts become this routine’s earlier history.`}
          </HelpText>
          {rows.length === 0 ? (
            <EmptyNote icon="barbell-outline" style={{ marginTop: 0 }}>There are no other routines to merge in.</EmptyNote>
          ) : (
            <View style={styles.card}>
              {rows.map((row, i) => (
                <TouchableOpacity
                  key={row.routine.id}
                  style={[styles.row, i > 0 && styles.rowSep]}
                  onPress={() => ask(row)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Merge ${row.routine.name}`}
                >
                  <Text style={styles.name}>{row.routine.name}</Text>
                  <Text style={styles.sub}>
                    {[
                      row.versions === 1 ? '1 version' : `${row.versions} versions`,
                      workoutCountText(row.workouts),
                      ...(row.last ? [`last ${format(new Date(row.last), 'MMM d')}`] : []),
                    ].join(' · ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  spacer: { minWidth: 64 },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  intro: { color: colors.textSecondary, fontSize: font.sm, marginHorizontal: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.md },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  sub: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
});
