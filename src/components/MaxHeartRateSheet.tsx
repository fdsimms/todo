import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { AGE_ESTIMATE_BASE, MAX_HEART_RATE_RANGE, resolveMaxHeartRate } from '../utils/heartRateZones';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The maximum heart rate a workout's zones are shares of, typed in. One
 * number, so a `CardSheet`, staged and written on Save, so Cancel leaves it as
 * it was. An empty field goes back to the estimate, 220 minus the age from the
 * year of birth set in Settings › Apple Health, and the line under the field says so with
 * the figure it would be. Nothing here suggests a number or says whether one
 * is right: the bounds are an absurdity check, and a number outside them is
 * refused in the card with the reason, never quietly replaced.
 */
export function MaxHeartRateSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const saved = useSettingsStore(s => s.maxHeartRate);
  const birthYear = useSettingsStore(s => s.bodyProfile.birthYear);
  const setMaxHeartRate = useSettingsStore(s => s.setMaxHeartRate);
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText(saved === null ? '' : String(saved));
  }, [visible, saved]);

  // The estimate an empty field goes back to, from the year of birth alone.
  const estimate = resolveMaxHeartRate(null, birthYear, new Date());
  const trimmed = text.trim();
  const typed = trimmed === '' ? null : Number(trimmed);
  const valid = typed === null
    || (Number.isInteger(typed) && typed >= MAX_HEART_RATE_RANGE.min && typed <= MAX_HEART_RATE_RANGE.max);

  const dismiss = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const save = () => {
    if (!valid) return;
    haptics.success();
    dismiss(() => setMaxHeartRate(typed));
  };

  return (
    <CardSheet
      name="MaxHeartRateSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss()}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => dismiss()} minWidth={56} />
          <Text style={styles.heading} numberOfLines={1}>Maximum heart rate</Text>
          <SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} disabled={!valid} minWidth={56} style={styles.headerRight} />
        </View>
        <View style={styles.body}>
          <TextField
            style={styles.field}
            value={text}
            onChangeText={setText}
            placeholder="Beats per minute"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
            accessibilityLabel="Maximum heart rate, in beats per minute"
          />
          {!valid && (
            <Text style={styles.refusal}>
              {`Enter a whole number from ${MAX_HEART_RATE_RANGE.min} to ${MAX_HEART_RATE_RANGE.max}.`}
            </Text>
          )}
          <HelpText style={styles.hint}>
            {estimate
              ? `Leave it empty to use ${AGE_ESTIMATE_BASE} minus your age, ${estimate.bpm} bpm, estimated from your year of birth in Settings › Apple Health.`
              : `Leave it empty for no zones. With a year of birth in Settings › Apple Health, it uses ${AGE_ESTIMATE_BASE} minus your age instead.`}
          </HelpText>
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
  },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.smd },
  field: {
    color: colors.text, fontSize: font.lg,
    backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
    paddingHorizontal: spacing.smd,
    minHeight: 44,
  },
  refusal: { color: colors.redText, fontSize: font.sm },
  hint: { color: colors.textSecondary, fontSize: font.sm },
});
