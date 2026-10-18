import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { PROGRAM_LIBRARY, type LibraryProgram } from '../utils/workoutProgramLibrary';
import { PROGRESSION_LABELS } from '../utils/workoutRoutine';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the program just added; the host closes this sheet and opens the program's editor. */
  onAdded: (programId: string) => void;
}

/** "4 routines · % of max · 4 weeks". */
function metaLine(p: LibraryProgram): string {
  const n = p.routines.length;
  return [
    `${n} ${n === 1 ? 'routine' : 'routines'}`,
    PROGRESSION_LABELS[p.scheme],
    p.weeks !== null ? `${p.weeks} ${p.weeks === 1 ? 'week' : 'weeks'}` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * The built-in programs (`PROGRAM_LIBRARY`), one card each with an Add. Adding
 * writes the routines and the program at once (`addLibraryProgram`), so the
 * sheet stages nothing and has nothing for Cancel or the swipe to guard; the
 * host then opens the new program's editor, closing this one in the same
 * commit (one sheet at a time, see "Two sibling Modals").
 */
export function ProgramLibrarySheet({ visible, onClose, onAdded }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const add = (key: string) => {
    const result = useWorkoutStore.getState().addLibraryProgram(key);
    if (typeof result === 'string') return;
    haptics.success();
    onAdded(result.program.id);
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} name="ProgramLibrarySheet">
      <View style={styles.root}>
        <SheetHeader
          title="Program library"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={onClose} minWidth={64} />}
          right={<View style={styles.spacer} />}
        />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <HelpText style={styles.intro}>Adding one makes its routines and the program yours, to change like any other.</HelpText>
          {PROGRAM_LIBRARY.map(p => (
            <View key={p.key} style={styles.card}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.summary}>{p.summary}</Text>
              <Text style={styles.meta}>{metaLine(p)}</Text>
              <View style={styles.actions}>
                <InlineAction icon="add" label="Add" onPress={() => add(p.key)} accessibilityLabel={`Add ${p.name}`} />
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  spacer: { minWidth: 64 },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  intro: { color: colors.textSecondary, fontSize: font.sm, marginHorizontal: spacing.xs, marginBottom: spacing.xs },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  summary: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  meta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.smd },
});
