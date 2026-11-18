import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';

/** The width `SettingsRow` gives its icon. */
const ICON_SIZE = 18;

interface Props {
  children: React.ReactNode;
}

/**
 * The rows that only mean something because of the toggle row above them
 * (the agenda's time, quiet hours' From and Until), drawn as that row's
 * children: indented to line up under its label, with a rule down the
 * parent's icon column and no icons of their own.
 *
 * Without it they read as peers of the row above and below, and a label like
 * "Send it at" has nothing visible to say what "it" is. Render it only while
 * the parent is on, so nothing in it ever looks live while it does nothing.
 * Rows inside are `SettingsRow`s without an `icon`, and an inline time picker
 * can sit between them without breaking the rule.
 */
export function SettingsNested({ children }: Props) {
  const colors = useColors();
  return (
    <View style={nestedStyles.wrap}>
      <View style={[nestedStyles.rule, { backgroundColor: colors.separator }]} />
      {children}
    </View>
  );
}

const nestedStyles = StyleSheet.create({
  // Row padding plus the icon, so a child's label starts where the parent's does.
  wrap: { paddingLeft: spacing.md + ICON_SIZE },
  // Centered under the parent's icon.
  rule: {
    position: 'absolute', top: 0, bottom: 0,
    left: spacing.md + ICON_SIZE / 2 - 1, width: 2,
  },
});
