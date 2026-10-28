import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { EmptyNote } from './EmptyNote';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import { PillGroup } from './PillGroup';
import { RoutinePickerList } from './RoutinePicker';
import { SheetHeaderButton } from './SheetHeaderButton';
import type { RotationItem } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The member being edited; its name is the sheet's subject. */
  member: RotationItem | null;
  /** The new link, or `{}` for none. `onClose` follows it. */
  onSave: (link: { routineId?: string | null; programId?: string | null }) => void;
  /**
   * Make a routine for this member. The card closes first, and the host opens
   * the routine editor and links what it saves; a sheet raised from this card
   * would otherwise have to go in its `overlays`.
   */
  onNewRoutine?: () => void;
  onClose: () => void;
}

/**
 * The workout one rotation member stands for: a routine, or a program whose next
 * routine it starts. A sheet rather than controls unfolding on the member's row,
 * for the reason `ChainStepLinkSheet` gives: the row lives in a `SortableList`
 * and can't change height mid-drag.
 */
export function RotationWorkoutSheet({ visible, member, onSave, onNewRoutine, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const routines = useWorkoutStore(s => s.routines);
  const programs = useWorkoutStore(s => s.programs);

  const choose = (link: { routineId?: string | null; programId?: string | null }) => {
    haptics.tap();
    card.close(() => { onSave(link); onClose(); });
  };

  const livePrograms = programs.filter(p => !p.archived && p.rotation.length > 0);
  const none = {
    key: '__none__',
    label: 'None',
    pinned: true,
    selected: !member?.workoutRoutineId && !member?.workoutProgramId,
    onPress: () => choose({}),
  };

  return (
    <CardSheet
      name="RotationWorkoutSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => card.close(onClose)}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.side} />
          <Text style={styles.heading} numberOfLines={2}>{member?.title || 'Workout'}</Text>
          <SheetHeaderButton label={BUTTON_LABEL.done} onPress={() => card.close(onClose)} minWidth={56} />
        </View>
        <Text style={styles.label}>Workout</Text>
        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          {routines.length === 0 ? (
            <EmptyNote icon="barbell-outline">
              {onNewRoutine ? 'No routines yet. Make one here, and it’s linked to this workout.' : 'No routines yet. Make one on the Workouts screen, then link it here.'}
            </EmptyNote>
          ) : (
            <>
              {livePrograms.length > 0 && (
                <>
                  <Text style={styles.group}>Programs</Text>
                  <PillGroup
                    noun="program"
                    options={[
                      none,
                      ...livePrograms.map(p => ({
                        key: p.id,
                        label: p.name,
                        selected: p.id === member?.workoutProgramId,
                        onPress: () => choose({ programId: p.id }),
                      })),
                    ]}
                  />
                  <HelpText style={styles.hint}>A program starts its next routine each time.</HelpText>
                  <Text style={styles.group}>Routines</Text>
                </>
              )}
              <RoutinePickerList
                routines={routines.filter(r => !r.archived || r.id === member?.workoutRoutineId)}
                selectedId={member?.workoutRoutineId ?? null}
                onSelect={id => choose({ routineId: id })}
                none={livePrograms.length > 0 ? undefined : { selected: none.selected, onPress: none.onPress }}
              />
            </>
          )}
          {onNewRoutine && (
            <View style={styles.newRow}>
              <InlineAction
                label="New routine"
                variant={routines.length === 0 ? 'accent' : 'neutral'}
                onPress={() => { haptics.tap(); card.close(() => { onClose(); onNewRoutine(); }); }}
              />
            </View>
          )}
        </ScrollView>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  side: { minWidth: 56 },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  body: { paddingHorizontal: spacing.md, maxHeight: 360 },
  newRow: { flexDirection: 'row', marginTop: spacing.md },
  group: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  hint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.xs },
});
