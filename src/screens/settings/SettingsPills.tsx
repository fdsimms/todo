import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../../theme/ThemeContext';
import { makeSettingsStyles } from './settingsStyles';

export interface PillOption<T> {
  value: T;
  label: string;
  /** Ionicons glyph, for the option sets that carry one (theme, add button). */
  icon?: string;
}

interface Props<T> {
  options: PillOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  /** Spoken label per option; without it a screen reader gets the bare word. */
  accessibilityLabelFor?: (option: PillOption<T>) => string;
  /**
   * Set when the pills sit directly under their own label row, so the two read
   * as one control rather than as a row and a separate strip.
   */
  attached?: boolean;
}

/** The full-width segmented control: theme, add-button corner, week start, grace, retention. */
export function SettingsPills<T extends string | number | null>({
  options, selected, onSelect, accessibilityLabelFor, attached,
}: Props<T>) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  return (
    <View style={[styles.pillRow, attached && styles.pillRowAttached]}>
      {options.map(opt => {
        const active = opt.value === selected;
        return (
          <TouchableOpacity
            key={String(opt.value)}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onSelect(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={accessibilityLabelFor?.(opt) ?? opt.label}
          >
            {!!opt.icon && (
              <Ionicons
                name={opt.icon as never}
                size={18}
                color={active ? colors.accent : colors.textSecondary}
              />
            )}
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
