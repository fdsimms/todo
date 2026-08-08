import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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
  /** Plain neutral dot instead of a numbered red badge — for a low-key "there's something here" signal. */
  badgeDot?: boolean;
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
  /**
   * A second caption on the overline's line, after a "·" — for a stat that
   * belongs with the screen's context rather than under its title (Today's
   * planned total). It lives up here because the overline's line is reserved
   * on every screen, so anything hung off it can't move what sits below the
   * header; a subtitle can. It never shrinks — a long overline truncates
   * first, since the day is the part the reader can supply themselves.
   */
  overlineTrailing?: string;
  actions?: ScreenHeaderAction[];
  /** Custom right-side content; rendered after icon actions. */
  right?: React.ReactNode;
}

/**
 * The standard large-title header used at the top of every screen, so
 * titles, counts and 34pt icon buttons render identically app-wide.
 */
export function ScreenHeader({ title, subtitle, overline, overlineTrailing, actions, right }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        {/* Always one line high, whether or not anything is on it: reserves the
            overline's line height when unused, so the title sits at the same
            vertical position on every screen as it does on Today (where the
            date overline pushes it down). */}
        <View style={styles.overlineRow}>
          {overline == null && overlineTrailing == null ? (
            <Text style={styles.overline} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"> </Text>
          ) : (
            <>
              {overline != null && (
                <Text style={[styles.overline, styles.overlineShrink]} numberOfLines={1}>{overline}</Text>
              )}
              {overlineTrailing != null && (
                <Text style={styles.overline} numberOfLines={1}>
                  {overline != null ? '· ' : ''}{overlineTrailing}
                </Text>
              )}
            </>
          )}
        </View>
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
              {action.badgeDot ? (
                (action.badge ?? 0) > 0 && <View style={styles.badgeDot} />
              ) : (
                action.badge != null && action.badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{action.badge}</Text>
                  </View>
                )
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
  overlineRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 2 },
  overline: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.medium,
    letterSpacing: 0.3,
  },
  overlineShrink: { flexShrink: 1 },
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
  badgeDot: {
    position: 'absolute', top: 1, right: 1,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.textTertiary,
  },
});
