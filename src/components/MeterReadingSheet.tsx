import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { useMeterReadingStore } from '../store/useMeterReadingStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { formatMeterAmount, parseMeterNumber, readingsFor } from '../utils/meters';

interface Props {
  visible: boolean;
  /** The meter, as the task names it. */
  meterName: string;
  meterUnit: string | null;
  /** The reading the task is due at, for the line under the field. */
  dueAt: number | null;
  onClose: () => void;
}

/** How many past readings the sheet lists, newest first: enough to spot and remove a typo. */
const RECENT_READINGS = 3;

/**
 * Logs one reading of a meter from a task row: "45,120" against the car.
 *
 * One number, so a `CardSheet`. The reading belongs to the meter rather than
 * the task, so logging here moves every task on that meter at once, which is
 * why the heading names the meter and not the task. The last few readings are
 * listed with a remove button each: readings are never edited (see
 * `useMeterReadingStore`), so a typo is fixed by removing it and logging again.
 */
export function MeterReadingSheet({ visible, meterName, meterUnit, dueAt, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const readings = useMeterReadingStore(s => s.readings);
  const logReading = useMeterReadingStore(s => s.logReading);
  const removeReading = useMeterReadingStore(s => s.removeReading);
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const recent = useMemo(
    () => readingsFor(readings, meterName).slice(-RECENT_READINGS).reverse(),
    [readings, meterName],
  );
  const value = parseMeterNumber(text);

  const dismiss = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const save = () => {
    if (value === null) return;
    haptics.success();
    dismiss(() => logReading(meterName, value));
  };

  return (
    <CardSheet
      name="MeterReadingSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss()}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss()} minWidth={56} />
          <Text style={styles.heading} numberOfLines={1}>{meterName}</Text>
          <SheetHeaderButton label="Log" onPress={save} disabled={value === null} minWidth={56} style={styles.headerRight} />
        </View>
        <View style={styles.body}>
          <TextField
            style={styles.field}
            value={text}
            onChangeText={setText}
            placeholder={meterUnit ? `Reading in ${meterUnit}` : 'Reading'}
            placeholderTextColor={colors.textTertiary}
            keyboardType="decimal-pad"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
            accessibilityLabel={`Current reading of ${meterName}`}
          />
          <Text style={styles.hint}>
            {dueAt !== null
              ? `Due at ${formatMeterAmount(dueAt, meterUnit)}. Every task on ${meterName} uses this reading.`
              : `Every task on ${meterName} uses this reading.`}
          </Text>
          {recent.length > 0 && (
            <View style={styles.recent}>
              {recent.map(r => (
                <View key={r.id} style={styles.recentRow}>
                  <Text style={styles.recentValue}>{formatMeterAmount(r.value, meterUnit)}</Text>
                  <Text style={styles.recentDate}>{format(new Date(r.readAt), 'MMM d')}</Text>
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); removeReading(r.id); }}
                    activeOpacity={interaction.activeOpacity}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove the reading of ${formatMeterAmount(r.value, meterUnit)} from ${format(new Date(r.readAt), 'MMMM d')}`}
                  >
                    <Ionicons name="close-circle" size={iconSize.sm} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
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
  hint: { color: colors.textSecondary, fontSize: font.sm },
  recent: { gap: spacing.xs },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  recentValue: { flex: 1, color: colors.text, fontSize: font.md },
  recentDate: { color: colors.textSecondary, fontSize: font.sm },
});
