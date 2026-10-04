import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet, type GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, lineHeight, iconSize, interaction, radius, textScale, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { TargetIcon, TARGET_ICON } from './TargetIcon';

export interface ScreenHeaderAction {
  icon: keyof typeof Ionicons.glyphMap | typeof TARGET_ICON;
  /**
   * Gets the press event, whose `pageX`/`pageY` is what an overflow menu opens
   * from (see `CardSheet`'s `anchor`).
   */
  onPress: (e: GestureResponderEvent) => void;
  /** Filled accent/orange background for an engaged state. */
  active?: boolean;
  tint?: 'accent' | 'orange';
  badge?: number;
  /** Badge fill color; defaults to colors.red. Use for badges that aren't reporting something dire. */
  badgeColor?: string;
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
  actions?: ScreenHeaderAction[];
  /** Custom right-side content; rendered after icon actions. */
  right?: React.ReactNode;
  /**
   * Makes the title itself a control, with a disclosure chevron after it — for
   * a screen whose title *is* the thing being picked (the Groceries tab, whose
   * title is the shopping list you're looking at).
   *
   * `TouchableOpacity` rather than `PressableScale`: a large title springing on
   * every tap reads as the whole screen moving, which is why full-width rows
   * keep the plain touchable too.
   */
  onTitlePress?: () => void;
  /** Spoken label for the title button. Falls back to the title itself. */
  titleAccessibilityLabel?: string;
  /**
   * Small content rendered inline right after the title text, baseline-aligned
   * — e.g. Today's concise weather reading ("68° Sunny"). Not supported
   * alongside `onTitlePress`; nothing needs both today.
   */
  titleAdornment?: React.ReactNode;
}

/**
 * The standard large-title header used at the top of every screen, so
 * titles, counts and 34pt icon buttons render identically app-wide.
 */
export function ScreenHeader({ title, subtitle, overline, actions, right, onTitlePress, titleAccessibilityLabel, titleAdornment }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        {overline != null ? (
          <Text style={styles.overline}>{overline}</Text>
        ) : (
          // Reserves the overline's line height even when unused, so the
          // title sits at the same vertical position on every screen as it
          // does on Today (where the date overline pushes it down).
          <Text style={styles.overline} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"> </Text>
        )}
        {onTitlePress ? (
          <TouchableOpacity
            style={styles.titleRow}
            onPress={onTitlePress}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={titleAccessibilityLabel ?? title}
          >
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Ionicons name="chevron-down" size={iconSize.sm} color={colors.textSecondary} style={styles.titleChevron} />
          </TouchableOpacity>
        ) : titleAdornment != null ? (
          <View style={styles.titleRow}>
            <Text style={[styles.title, styles.titleHolds]}>{title}</Text>
            <View style={styles.adornment}>{titleAdornment}</View>
          </View>
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}
        {subtitle != null ? (
          <Text style={styles.subtitle}>{subtitle}</Text>
        ) : (
          // Same reservation, one line down: without it, any screen whose
          // subtitle depends on data (a count that's sometimes 0, Today's
          // workload total) has two different header heights depending on
          // whether that data renders anything — and on Today specifically,
          // that's what put its view-mode pills a line below Later's/
          // Unscheduled's/Inbox's, since only the 'today' sub-view ever
          // passes one.
          <Text style={styles.subtitle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"> </Text>
        )}
      </View>
      <View style={styles.actions}>
        {actions?.map((action, i) => {
          const tintColor = action.tint === 'orange' ? colors.orange : colors.accent;
          const iconColor = action.disabled
            ? colors.textTertiary
            : action.active ? colors.onAccent : colors.textSecondary;
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
                action.icon === TARGET_ICON
                  ? <TargetIcon size={18} color={iconColor} />
                  : <Ionicons name={action.icon} size={18} color={iconColor} />
              )}
              {action.badgeDot ? (
                (action.badge ?? 0) > 0 && <View style={styles.badgeDot} />
              ) : (
                action.badge != null && action.badge > 0 && (
                  <View style={[styles.badge, action.badgeColor && { backgroundColor: action.badgeColor }]}>
                    <Text style={styles.badgeText} maxFontSizeMultiplier={textScale.badge}>{action.badge}</Text>
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
    paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.xs,
  },
  // The right margin is what keeps a wrapping subtitle (Today's workload line)
  // from running up against the action buttons: the block shrinks to the
  // space left, so without it the text ends flush with the first button.
  titleBlock: { flexShrink: 1, marginRight: spacing.md },
  overline: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.medium,
    letterSpacing: 0.3, marginBottom: spacing.xxs,
  },
  title: {
    color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold,
    lineHeight: lineHeight.xxl, letterSpacing: -0.5,
    flexShrink: 1,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // With an adornment beside it the title keeps its full width and the
  // adornment is what gives way: the title is the thing the row exists to show,
  // and five action buttons leave little room, so a shrinking title wrapped
  // "Today" onto two lines ("Toda" / "y").
  titleHolds: { flexShrink: 0 },
  adornment: { flexShrink: 1, minWidth: 0 },
  // Optically centred against the cap height rather than the line box, which
  // the xxl line height makes noticeably taller than the glyphs.
  titleChevron: { marginTop: 3 },
  // textSecondary, not textTertiary: this carries information (a task count, a
  // workload total), and textTertiary's ~3:1 contrast is under the 4.5:1 bar
  // for 13pt text — the same reason the section-label rule moved off it.
  subtitle: {
    color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium,
    marginTop: spacing.xxs,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingBottom: spacing.xxs },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  // minWidth rather than a fixed width, matching the three sibling badges that
  // already grow (HubPills, Today's view-mode pills, RecipeSourcePicker's
  // thumb order): this holds an arbitrary count, and a fixed 16pt box left a
  // two-digit one touching both edges once the text moved onto `font.xxs`.
  badge: {
    position: 'absolute', top: -3, right: -3,
    minWidth: 16, minHeight: 16, borderRadius: radius.full, paddingHorizontal: 3,
    backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.onAccent, fontSize: font.xxs, fontWeight: fontWeight.bold },
  badgeDot: {
    position: 'absolute', top: 1, right: 1,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.textTertiary,
  },
});
