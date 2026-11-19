import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, type Colors } from '../theme';

interface Props {
  /** The warning (`onCallWarningFor…` in `utils/onCall.ts`), or null to draw nothing. */
  text: string | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * The line under a date, time or event that runs into an on-call stretch. The same
 * alert row the quick event sheet's overlap warning uses, drawn once so a task, an
 * event and a trip all say it the same way. It only warns: saving still works, as
 * it does for an overlap, since being on call is a reason to look twice and not
 * a rule. The icon carries the orange and the text stays `colors.text`, because
 * orange text on a light card is too faint to read.
 */
export function OnCallWarning({ text, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (text === null) return null;
  return (
    <View style={[styles.row, style]} accessible accessibilityRole="alert" accessibilityLabel={text}>
      <Ionicons name="alert-circle-outline" size={13} color={colors.orangeText} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  text: { flex: 1, color: colors.text, fontSize: font.xs },
});
