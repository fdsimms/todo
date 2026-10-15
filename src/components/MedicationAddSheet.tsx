import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { useMedicationStore } from '../store/useMedicationStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { medicationKey } from '../utils/medicationLog';

const NAME_MAX_LENGTH = 60;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after the medication is added, with its key (the page it opens at). */
  onAdded?: (key: string) => void;
}

/**
 * Add a medication to the list without recording a dose.
 *
 * The name is all it asks for. A limit, supply or schedule is set from the
 * medication's own page afterward, and the first dose can be recorded whenever
 * it is taken. A name that is already listed is refused with the reason, not
 * saved a second time under a different spelling.
 */
export function MedicationAddSheet({ visible, onClose, onAdded }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const logs = useMedicationStore(s => s.logs);
  const registered = useMedicationStore(s => s.registered);
  const archived = useMedicationStore(s => s.archived);
  const addMedication = useMedicationStore(s => s.addMedication);

  const [name, setName] = useState('');
  useEffect(() => { if (visible) setName(''); }, [visible]);

  const key = medicationKey(name);
  const listed = key.length > 0
    && (logs.some(l => medicationKey(l.name) === key) || registered.some(r => medicationKey(r) === key))
    && !archived.includes(key);
  const canSave = key.length > 0 && !listed;

  const dismiss = (after: () => void) => {
    Keyboard.dismiss();
    card.close(after);
  };

  const save = () => {
    // Refused (an empty name, or one already listed) used to be silent.
    if (!canSave || !addMedication(name)) { haptics.error(); return; }
    haptics.success();
    dismiss(() => { onAdded?.(key); onClose(); });
  };

  return (
    <CardSheet
      name="MedicationAddSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss(onClose)}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
          <Text style={styles.heading} numberOfLines={1}>Add medication</Text>
          <SheetHeaderButton label="Add" onPress={save} disabled={!canSave} minWidth={56} style={styles.headerRight} />
        </View>
        <View style={styles.body}>
          <TextField
            style={styles.fieldBox}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Sertraline"
            placeholderTextColor={colors.textTertiary}
            maxLength={NAME_MAX_LENGTH}
            autoCapitalize="words"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
            accessibilityLabel="Medication name"
          />
          <Text style={[styles.hint, listed && { color: colors.redText }]}>
            {listed
              ? 'That medication is already on your list.'
              : 'It is added to your list now. Record doses whenever you take it.'}
          </Text>
        </View>
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
    paddingBottom: spacing.sm,
  },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  body: { paddingHorizontal: spacing.md, gap: spacing.sm },
  fieldBox: {
    color: colors.text, fontSize: font.md,
    backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
    paddingHorizontal: spacing.smd,
    // Height rather than lineHeight, see the TextInput note in CLAUDE.md.
    minHeight: 36,
  },
  hint: { color: colors.textSecondary, fontSize: font.sm },
});
