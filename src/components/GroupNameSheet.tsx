import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { cleanWorkoutName, WORKOUT_NAME_MAX_LENGTH } from '../utils/workoutData';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The group being renamed, or null to make a new one. */
  renaming: string | null;
  onClose: () => void;
}

/**
 * The name of a routine group: a new one from the Workouts menu, or a rename
 * from a heading's menu. See `routineGroups.ts`.
 */
export function GroupNameSheet({ visible, renaming, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const routines = useWorkoutStore(s => s.routines);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [name, setName] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setName(renaming ?? ''); setRefusal(null); }
  }, [visible, renaming]);

  const count = renaming === null
    ? 0
    : routines.filter(r => r.groupName?.trim().toLowerCase() === renaming.trim().toLowerCase()).length;
  const clean = cleanWorkoutName(name);
  const unchanged = renaming !== null && clean === renaming;

  const save = () => {
    if (!clean) return;
    if (unchanged) { dismiss(); return; }
    const store = useWorkoutStore.getState();
    const result = renaming === null ? store.addRoutineGroup(clean) : store.renameRoutineGroup(renaming, clean);
    if (result === 'taken') { haptics.warning(); setRefusal('A group with that name already exists.'); return; }
    if (result === 'blank') { haptics.warning(); setRefusal('Give the group a name.'); return; }
    haptics.success();
    dismiss();
  };

  return (
    <CardSheet name="GroupNameSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title={renaming === null ? 'New group' : 'Rename group'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} disabled={!clean} onPress={save} />}
        />
        <View style={styles.body}>
          <TextField
            style={styles.input}
            value={name}
            onChangeText={t => { setName(t); setRefusal(null); }}
            placeholder="Group name"
            placeholderTextColor={colors.textTertiary}
            maxLength={WORKOUT_NAME_MAX_LENGTH}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
            accessibilityLabel="Group name"
          />
          {refusal ? <Text style={styles.refusal}>{refusal}</Text> : null}
          {renaming !== null && (
            <HelpText style={styles.hint}>
              {`Renames it for ${count === 1 ? '1 routine' : `all ${count} routines`}. A name another group already has joins the two.`}
            </HelpText>
          )}
        </View>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    body: { padding: spacing.md },
    input: {
      color: colors.text, fontSize: font.md, backgroundColor: colors.bgTertiary,
      borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44,
    },
    refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm },
    hint: { marginTop: spacing.md, color: colors.textSecondary, fontSize: font.sm },
  });
}
