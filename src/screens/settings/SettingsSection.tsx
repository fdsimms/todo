import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useColors } from '../../theme/ThemeContext';
import { makeSettingsStyles } from './settingsStyles';

interface Props {
  /** Uppercase header above the card. */
  label: string;
  /**
   * The paragraph under the card. These are the screen's only real
   * documentation, so they stay — a group holds two or three sections rather
   * than eighteen, which is the room they needed.
   */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingsSection({ label, footer, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.card}>{children}</View>
      {footer != null && <Text style={styles.sectionFooter}>{footer}</Text>}
    </View>
  );
}
