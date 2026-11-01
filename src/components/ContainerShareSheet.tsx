import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { TextField } from './TextField';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { CONTAINER_SHARES, shareFromGrams, type ContainerShare } from '../utils/containerShare';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The container's name, which the question is about. */
  title: string;
  /** What the whole container weighs. The typed amount is offered only when this is known. */
  totalGrams: number | null;
  /** Called once the card has left, with the share chosen. */
  onPick: (share: ContainerShare) => void;
  onClose: () => void;
}

/**
 * "How much of this did you eat?" for a container in the fridge: the shares in
 * one tap, and a weight in grams when the container's weight is known.
 */
export function ContainerShareSheet({ visible, title, totalGrams, onPick, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (visible) setTyped('');
  }, [visible]);

  const typedShare = shareFromGrams(typed, totalGrams);

  const pick = (share: ContainerShare) => {
    haptics.success();
    card.close(() => { onPick(share); onClose(); });
  };

  return (
    <CardSheet
      name="ContainerShareSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => card.close(onClose)}
    >
      <View style={styles.card}>
        <Text style={styles.heading}>{`How much of the ${title} did you eat?`}</Text>
        <View style={styles.grid}>
          {CONTAINER_SHARES.map(s => (
            <TouchableOpacity
              key={s.label}
              style={styles.share}
              activeOpacity={interaction.activeOpacity}
              onPress={() => pick(s)}
              accessibilityRole="button"
              accessibilityLabel={s.spoken}
            >
              <Text style={[styles.shareText, s.factor === 1 && styles.shareWhole]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {totalGrams !== null && (
          <>
            <Text style={styles.label}>OR AN AMOUNT</Text>
            <View style={styles.amountRow}>
              <TextField
                style={styles.amountInput}
                value={typed}
                onChangeText={setTyped}
                placeholder={`e.g. ${Math.max(1, Math.round(totalGrams / 4))} g`}
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
                returnKeyType="done"
                onSubmitEditing={() => { if (typedShare) pick(typedShare); }}
                accessibilityLabel="Grams eaten"
              />
              <TouchableOpacity
                style={[styles.log, !typedShare && styles.logOff]}
                activeOpacity={interaction.activeOpacity}
                disabled={!typedShare}
                onPress={() => { if (typedShare) pick(typedShare); }}
                accessibilityRole="button"
                accessibilityLabel="Log this amount"
                accessibilityState={{ disabled: !typedShare }}
              >
                <Text style={styles.logText}>Log</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        <TouchableOpacity
          style={styles.cancel}
          activeOpacity={interaction.activeOpacity}
          onPress={() => card.close(onClose)}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>{BUTTON_LABEL.cancel}</Text>
        </TouchableOpacity>
      </View>
      {totalGrams !== null && <NumberPadAccessory />}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { padding: spacing.md },
  heading: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  share: {
    width: '31.5%',
    flexGrow: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareText: { color: colors.text, fontSize: font.xl },
  shareWhole: { fontSize: font.lg, fontWeight: fontWeight.semibold },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amountInput: {
    flex: 1,
    minHeight: 44,
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.smd,
  },
  log: {
    minHeight: 44,
    paddingHorizontal: spacing.lg - spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logOff: { opacity: 0.4 },
  logText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  cancel: { alignItems: 'center', paddingTop: spacing.md, minHeight: 44, justifyContent: 'center' },
  cancelText: { color: colors.accent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
