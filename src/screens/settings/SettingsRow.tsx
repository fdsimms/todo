import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, Animated, type AccessibilityRole,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../../theme/ThemeContext';
import { interaction } from '../../theme';
import { useSettingsStore } from '../../store/useSettingsStore';
import { makeSettingsStyles } from './settingsStyles';
import { useSettingsFocusFlash } from './SettingsFocus';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

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
  /**
   * Show `hint` even with "Hide help text" on. For a hint that explains what
   * the row *means* — the normal case — hiding it is exactly what that
   * setting promises. Reach for this only when the hint is instead the sole
   * reason a row with no visible control isn't broken (e.g. "Tag a recipe
   * first to pick from here" on an otherwise-empty row) — same reasoning as
   * `CollapsibleField`'s `lockedHint`, which is never gated on it either.
   */
  alwaysShowHint?: boolean;
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
  /**
   * The row's id in `SETTINGS_ENTRIES`, for the one row a search opened this
   * group to find — it scrolls itself into view and lights up briefly.
   *
   * Optional, and only worth giving to rows that have an index entry. A row
   * with none behaves exactly as before and costs nothing extra; a row whose id
   * doesn't match anything in the index simply never gets focused, so a typo
   * here is a search result that lands at the top of the group rather than a
   * crash.
   */
  entryId?: string;
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
  icon, iconColor, label, labelColor, hint, alwaysShowHint, value, toggle, chevron, expanded, busy,
  trailing, children, onPress, disabled, tight, entryId,
  accessibilityLabel, accessibilityHint,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);
  const showHint = !!hint && (alwaysShowHint || !hideHelpText);

  const role: AccessibilityRole | undefined =
    toggle !== undefined ? 'switch' : onPress && !disabled ? 'button' : undefined;

  // Only the focused row takes a ref or animates at all — see SettingsFocus.
  const { focused, setFocusRef, highlight } = useSettingsFocusFlash(entryId);

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
        {showHint && <Text style={[styles.rowHint, !!children && styles.rowHintSpaced]}>{hint}</Text>}
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
      {chevron && <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
      {expanded !== undefined && (
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textSecondary}
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
    !!tight && showHint && styles.rowTightHinted,
    !!children && styles.rowStacked,
    // Last, so it paints over the row's own transparent background rather than
    // under it. Static `transparent` for every row that isn't the focused one,
    // so this costs an unfocused row nothing but a style entry.
    focused && { backgroundColor: highlight },
  ];

  // A row with nothing to press is a status line, not a control — it must not
  // announce itself as a button.
  if (!onPress) return <Animated.View ref={setFocusRef} style={style}>{body}</Animated.View>;

  return (
    <AnimatedTouchable
      ref={setFocusRef}
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
    </AnimatedTouchable>
  );
}
