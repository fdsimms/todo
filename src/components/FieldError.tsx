import React, { useMemo } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, spacing, type Colors } from '../theme';

interface Props {
  /** What is wrong with what is typed, as a sentence. Nothing renders for empty or null. */
  children: string | null | undefined;
  style?: StyleProp<TextStyle>;
}

/**
 * The red sentence under a field that says why what is typed won't be saved
 * ("That name is taken."), shown while it is typed and gone as soon as it is
 * fixed.
 *
 * Plain text and never `HelpText`: this is a refusal the person has to see,
 * which `HelpText`'s own rule says is not help, and Hide help text would
 * otherwise remove the only explanation of why Done is off. It states the
 * reason and the next step in a sentence, the way an alert does, and is
 * announced to a screen reader as one.
 */
export function FieldError({ children, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, style]}>
      {children}
    </Text>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  error: {
    color: colors.redText,
    fontSize: font.sm,
    marginTop: spacing.xs,
  },
});
