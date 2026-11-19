import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { useOnCallStore } from '../store/useOnCallStore';
import { onCallStripLines } from '../utils/onCall';

interface Props {
  /**
   * Anything that changes when Today re-reads its day (its minute tick), so a
   * shift that starts or ends while the screen is open is drawn as it happens:
   * the lines depend on the clock, which no subscription can see.
   */
  refreshKey?: unknown;
}

/**
 * "On call", at the top of Today on the days the user is. One line per stretch,
 * worked out by `onCallStripLines`. It is not a task: nothing to check off or
 * defer, and it is gone again the moment the shift ends. Nothing at all on a day
 * that isn't on call, or while no calendar or word is set.
 *
 * Sits in the list header, ahead of the meal strip, and scrolls with the rows.
 */
export function OnCallStrip({ refreshKey }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const spans = useOnCallStore(s => s.spans);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  // `refreshKey` is read through the dependency list: it is the clock.
  const lines = useMemo(
    () => onCallStripLines(spans, new Date(), dayResetTime, use24Hour),
    [spans, dayResetTime, use24Hour, refreshKey],
  );
  if (lines.length === 0) return null;
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`On call. ${lines.join('. ')}`}
    >
      <View style={styles.icon}>
        <Ionicons name="call" size={16} color={colors.onAccent} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>On call</Text>
        {lines.map(line => (
          <Text key={line} style={styles.line}>{line}</Text>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.smd,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSubtle,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  title: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.text },
  line: { fontSize: font.sm, color: colors.textSecondary },
});
