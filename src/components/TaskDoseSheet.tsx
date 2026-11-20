import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { TaskDoseAmount } from './TaskDoseAmount';
import { SheetHeaderButton } from './SheetHeaderButton';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The medication the task logs a dose of; it is the sheet's heading. */
  medication: string;
  amount: number | null;
  unit: string | null;
  /** The new amount and unit, or both null for "the medication's usual amount". `onClose` follows. */
  onSave: (amount: number | null, unit: string | null) => void;
  onClose: () => void;
}

/**
 * Changes how much one task logs when it is completed, from the row's own
 * "Logs 1 tablet" chip. It is the task editor's "Amount per dose"
 * (`TaskDoseAmount`) in a card of its own, so the usual-amount rule, the unit
 * list and the preview line are the editor's, not copies.
 *
 * The amount and unit are saved as a pair, like the editor's
 * `resolveMedicationAmount`: a number with no unit is dropped, because a dose
 * with no unit is unreadable.
 */
export function TaskDoseSheet({ visible, medication, amount, unit, onSave, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const [amountText, setAmountText] = useState('');
  const [unitValue, setUnitValue] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAmountText(amount != null ? String(amount) : '');
    setUnitValue(unit);
  }, [visible]);

  const dismiss = (after: () => void) => {
    Keyboard.dismiss();
    card.close(after);
  };

  const save = () => {
    haptics.success();
    const parsed = Number(amountText.trim());
    const usable = amountText.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && !!unitValue;
    dismiss(() => {
      onSave(usable ? parsed : null, usable ? unitValue : null);
      onClose();
    });
  };

  return (
    <CardSheet name="TaskDoseSheet" visible={visible} controller={card} onRequestClose={() => dismiss(onClose)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
            <Text style={styles.heading} numberOfLines={2}>{medication}</Text>
            <SheetHeaderButton label={BUTTON_LABEL.done} onPress={save} minWidth={56} style={styles.headerRight} />
          </View>
          <View style={styles.body}>
            <TaskDoseAmount
              menuName="TaskDoseSheet dose unit menu"
              medication={medication}
              amount={amountText}
              onChangeAmount={setAmountText}
              unit={unitValue}
              onChangeUnit={setUnitValue}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
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
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  body: { paddingHorizontal: spacing.md },
});
