import React from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';

type Variant = 'accent' | 'neutral';

interface Props {
  /**
   * Omit for an icon-only pill (see `icon`) — a control dense enough rows
   * need, once its meaning is explained somewhere the row itself doesn't have
   * to repeat (a section hint, say). `accessibilityLabel` is doing the labeling
   * job instead, so pass one that says what the tap does, not just its icon's name.
   */
  label?: string;
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
  /**
   * Which surface the pill sits on, for the `neutral` variant only. `card` (the
   * default) is inside a `bgSecondary` card, where `bgTertiary` reads as a step
   * down. `page` is straight onto `colors.bg`, where `bgTertiary` is nearly
   * invisible against it — same distinction `PillGroup`'s `surface` prop makes.
   */
  surface?: 'page' | 'card';
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
  surface = 'card',
  disabled = false,
  accessibilityLabel,
  haptic = false,
  style,
}: Props) {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);

  const neutral = variant === 'neutral';
  // `text`, not a grey: a neutral pill's label sits on bgTertiary/bgSecondary,
  // where textSecondary measures 4.3:1 — the same reason every other
  // unselected control's label was raised. The accent variant is what
  // ranks the pair; dimming the quieter one's text isn't.
  const fg = neutral ? colors.text : tint ?? colors.accentText;
  const bg = neutral
    ? (surface === 'page' ? colors.bgSecondary : colors.bgTertiary)
    : tint
      ? tint + (isDark ? '26' : '1F')
      : colors.accentSubtle;

  return (
    <PressableScale
      style={[
        styles.pill,
        // Tighter, even padding without a label — closer to a circle around
        // the icon alone, rather than the wider pill a run of text needs.
        { backgroundColor: bg, paddingHorizontal: label ? 12 : spacing.sm },
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
    >
      {icon && <Ionicons name={icon} size={14} color={fg} />}
      {!!label && <Text style={[styles.label, { color: fg }]}>{label}</Text>}
    </PressableScale>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingVertical: 7, minHeight: 32,
    borderRadius: radius.full,
  },
  disabled: { opacity: 0.4 },
  label: { fontSize: font.sm, fontWeight: fontWeight.semibold },
});
