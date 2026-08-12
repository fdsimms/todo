import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, type AccessibilityRole } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../../theme/ThemeContext';
import { interaction } from '../../theme';
import { makeSettingsStyles } from './settingsStyles';

interface Props {
  icon: string;
  /** Defaults to secondary; pass accent for an active row, red for a destructive one. */
  iconColor?: string;
  label: string;
  labelColor?: string;
  /**
   * The line under the label. Give one only where the control doesn't already
   * say what it does — a toggle labelled "24-hour time" doesn't need a hint
   * reading "Times read as 5:30 PM".
   */
  hint?: string;
  /** Right-aligned accent value. */
  value?: string;
  /** Renders the standard switch, and makes the row announce itself as one. */
  toggle?: boolean;
  chevron?: boolean;
  /**
   * Set for rows whose choices unfold in place rather than opening a screen:
   * shows an up/down chevron instead of the disclosure one, so the row says it
   * is a disclosure at all. Same semantic as `EditorRow`'s `expanded`.
   */
  expanded?: boolean;
  busy?: boolean;
  /** Anything else on the right — a clear button, a second control. */
  trailing?: React.ReactNode;
  /** Extra content below the label, inside the row: the API key field. */
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** For a row that sits directly above its own pill row. */
  tight?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * Every row in Settings.
 *
 * Deliberately not `EditorRow`, near-identical though it looks: that one shows
 * its hint only while the row has *no* value, which is right for an editor
 * ("what this does" until it's set, then the value speaks) and wrong here,
 * where "Morning" wants its explanation *and* its 6:00 AM. Changing that
 * semantic would reach into all five editors.
 */
export function SettingsRow({
  icon, iconColor, label, labelColor, hint, value, toggle, chevron, expanded, busy,
  trailing, children, onPress, disabled, tight,
  accessibilityLabel, accessibilityHint,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  const role: AccessibilityRole | undefined =
    toggle !== undefined ? 'switch' : onPress && !disabled ? 'button' : undefined;

  const body = (
    <>
      <Ionicons
        name={icon as never}
        size={18}
        color={iconColor ?? colors.textSecondary}
        style={children != null ? { marginTop: 2 } : undefined}
      />
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, !!labelColor && { color: labelColor }]}>{label}</Text>
        {!!hint && <Text style={[styles.rowHint, !!children && styles.rowHintSpaced]}>{hint}</Text>}
        {children}
      </View>
      {!!value && <Text style={styles.rowValue}>{value}</Text>}
      {trailing}
      {busy && <ActivityIndicator size="small" color={colors.textSecondary} />}
      {toggle !== undefined && (
        <View style={[styles.toggle, toggle && styles.toggleOn]}>
          <View style={[styles.toggleKnob, toggle && styles.toggleKnobOn]} />
        </View>
      )}
      {chevron && <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />}
      {expanded !== undefined && (
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textTertiary}
        />
      )}
    </>
  );

  // `tight` hands the bottom padding to the pill row below, which is right for
  // a bare label — but a hint needs separating from those pills, and the pill
  // row is a sibling, so it can't do it from there.
  const style = [
    styles.row,
    !!tight && styles.rowTight,
    !!tight && !!hint && styles.rowTightHinted,
    !!children && styles.rowStacked,
  ];

  // A row with nothing to press is a status line, not a control — it must not
  // announce itself as a button.
  if (!onPress) return <View style={style}>{body}</View>;

  return (
    <TouchableOpacity
      style={style}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole={role}
      accessibilityState={{
        checked: toggle,
        expanded,
        disabled: disabled || undefined,
      }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
    >
      {body}
    </TouchableOpacity>
  );
}
