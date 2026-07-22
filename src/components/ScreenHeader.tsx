import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, lineHeight, type Colors } from '../theme';
import { PressableScale } from './PressableScale';

export interface ScreenHeaderAction {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Filled accent/orange background for an engaged state. */
  active?: boolean;
  tint?: 'accent' | 'orange';
  badge?: number;
  disabled?: boolean;
  loading?: boolean;
  /**
   * Spoken label for screen readers. These buttons are icon-only, so without
   * this a screen reader just announces "button". Falls back to a readable
   * form of the icon name when omitted.
   */
  accessibilityLabel?: string;
}

// "settings-outline" -> "settings", "time-outline" -> "time". A last-resort
// label when a call site doesn't provide an explicit one.
function labelFromIcon(icon: string): string {
  return icon.replace(/-(outline|sharp)$/, '').replace(/-/g, ' ');
}

interface Props {
  title: string;
  subtitle?: string;
  /** Small caption rendered above the title (e.g. today's date). */
  overline?: string;
  actions?: ScreenHeaderAction[];
  /** Custom right-side content; rendered after icon actions. */
  right?: React.ReactNode;
}

/**
 * The standard large-title header used at the top of every screen, so
 * titles, counts and 34pt icon buttons render identically app-wide.
 */
export function ScreenHeader({ title, subtitle, overline, actions, right }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        {overline != null && <Text style={styles.overline}>{overline}</Text>}
        <Text style={styles.title}>{title}</Text>
        {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      <View style={styles.actions}>
        {actions?.map((action, i) => {
          const tintColor = action.tint === 'orange' ? colors.orange : colors.accent;
          const iconColor = action.active ? colors.onAccent : colors.textSecondary;
          return (
            <PressableScale
              key={`${action.icon}-${i}`}
              style={[styles.iconBtn, action.active && { backgroundColor: tintColor }]}
              onPress={action.onPress}
              disabled={action.disabled}
              haptic
              hitSlop={4}
              accessibilityRole="button"
              accessibilityState={{ selected: action.active, disabled: action.disabled, busy: action.loading }}
              accessibilityLabel={action.accessibilityLabel ?? labelFromIcon(action.icon)}
            >
              {action.loading ? (
                <ActivityIndicator size="small" color={iconColor} />
              ) : (
                <Ionicons name={action.icon} size={18} color={iconColor} />
              )}
              {action.badge != null && action.badge > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{action.badge}</Text>
                </View>
              )}
            </PressableScale>
          );
        })}
        {right}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, paddingTop: spacing.xs,
  },
  titleBlock: { flexShrink: 1 },
  overline: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.medium,
    letterSpacing: 0.3, marginBottom: 2,
  },
  title: {
    color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold,
    lineHeight: lineHeight.xxl, letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textTertiary, fontSize: font.sm, fontWeight: fontWeight.medium,
    marginTop: 2,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingBottom: 2 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    position: 'absolute', top: -3, right: -3,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.onAccent, fontSize: 9, fontWeight: fontWeight.bold },
});
