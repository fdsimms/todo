import React from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';

type Variant = 'accent' | 'neutral';

interface Props {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /**
   * `accent` is the default and marks the action you'd expect someone to take.
   * `neutral` is the quieter sibling — the second action in a pair ("Add
   * existing" next to "New task"), or an add button that sits at the end of a
   * row of *already tinted* chips, where an accent fill would read as one more
   * chip rather than as a control.
   */
  variant?: Variant;
  /** Overrides the accent tint — `colors.purple` for AI actions, `colors.warning` for repairs. */
  tint?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The small tinted-pill button that adds a thing to the list or grid it sits
 * under — "New task", "Add subtask", "Add tag".
 *
 * It replaces the bare accent-coloured text these used to be. Accent text was
 * doing three unrelated jobs across the app (this is a link / this is a button
 * / this is the selected value), so a card holding two of them read as a stack
 * of links floating under the content. A filled shape says "control" without
 * the colour having to, which frees accent text to keep meaning *value* in
 * `EditorRow` and `CollapsibleField`.
 *
 * The tint is built from the colour with an alpha suffix rather than a second
 * token per hue, matching how tag chips already tint themselves.
 */
export function InlineAction({
  label,
  onPress,
  icon,
  variant = 'accent',
  tint,
  disabled = false,
  accessibilityLabel,
  haptic = false,
  style,
}: Props) {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);

  const neutral = variant === 'neutral';
  const fg = neutral ? colors.textSecondary : tint ?? colors.accent;
  const bg = neutral
    ? colors.bgTertiary
    : tint
      ? tint + (isDark ? '26' : '1F')
      : colors.accentSubtle;

  return (
    <PressableScale
      style={[styles.pill, { backgroundColor: bg }, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
    >
      {icon && <Ionicons name={icon} size={14} color={fg} />}
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </PressableScale>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: 12, paddingVertical: 7, minHeight: 32,
    borderRadius: radius.full,
  },
  disabled: { opacity: 0.4 },
  label: { fontSize: font.sm, fontWeight: fontWeight.semibold },
});
