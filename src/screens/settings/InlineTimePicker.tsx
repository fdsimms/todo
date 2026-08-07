import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useColors, useTheme } from '../../theme/ThemeContext';
import { makeSettingsStyles } from './settingsStyles';

interface Props {
  value: Date;
  onChange: (date: Date) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The time spinner that unfolds inside a card, under whichever row opened it.
 * Confirming is explicit because the spinner emits on every tick — writing
 * each one straight through would reschedule the daily agenda a dozen times
 * per drag.
 */
export function InlineTimePicker({ value, onChange, onCancel, onConfirm }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  return (
    <>
      <View style={styles.sep} />
      <DateTimePicker
        value={value}
        mode="time"
        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
        onChange={(_e, d) => d && onChange(d)}
        themeVariant={isDark ? 'dark' : 'light'}
        style={styles.picker}
      />
      <View style={styles.pickerButtons}>
        <TouchableOpacity
          style={styles.pickerBtn}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pickerBtn, styles.pickerBtnPrimary]}
          onPress={onConfirm}
          accessibilityRole="button"
          accessibilityLabel="Set time"
        >
          <Text style={[styles.pickerBtnText, { color: colors.onAccent }]}>Set</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
