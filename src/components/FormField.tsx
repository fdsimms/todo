import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing } from '../theme';
import { HelpText } from './HelpText';

/**
 * One labelled field in a form card: an uppercase label, the control, and an
 * optional line explaining it. The three sit `spacing.sm` apart, and the field
 * keeps `spacing.md` above itself, so in a card with `gap: spacing.sm` two
 * fields are `spacing.lg` apart. That is the point of having one: the gap
 * between a field and the next one has to be clearly bigger than the gap
 * inside a field, or a hint reads as belonging to the label below it.
 *
 * `hint` is help text, so it goes away under Settings › Hide help text. A
 * line that is content (an error, a preview, a count) goes in `children`.
 * Put the field in a card whose own `gap` is `spacing.sm`; the first field in
 * a card passes `first` to drop the top margin.
 */
export function FormField({
  label,
  hint,
  first,
  children,
  style,
}: {
  label: string;
  hint?: string;
  first?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <View style={[styles.field, !first && styles.spaced, style]}>
      <Text
        style={{
          color: colors.textSecondary,
          fontSize: font.xs,
          fontWeight: fontWeight.semibold,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      {children}
      {hint ? (
        <HelpText style={{ color: colors.textSecondary, fontSize: font.xs }}>{hint}</HelpText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  spaced: { marginTop: spacing.md },
});
