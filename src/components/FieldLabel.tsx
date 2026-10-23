import React from 'react';
import { Text, type TextProps } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing } from '../theme';

/**
 * The name of the text field under it. A placeholder is `textTertiary`, the
 * same grey as a hint, so on its own it reads as a value already saved and it
 * is gone once someone types. Put this above any field whose placeholder is an
 * example, or a field no row label or header already names. `inCard` lines it
 * up with a field inset in a card; other layout goes in `style`.
 */
export function FieldLabel({ inCard, style, ...rest }: TextProps & { inCard?: boolean }) {
  const colors = useColors();
  return (
    <Text
      {...rest}
      style={[
        { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium, marginBottom: spacing.xs },
        inCard && { marginHorizontal: spacing.md, marginTop: spacing.sm },
        style,
      ]}
    />
  );
}
