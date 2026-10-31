import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet, type GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useBrandFace } from '../theme/AppFont';
import { spacing, font, fontWeight, lineHeight, iconSize, interaction, radius, textScale, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { PointerView } from './PointerView';
import { TargetIcon, TARGET_ICON } from './TargetIcon';
import { AnimatedNumber } from './AnimatedNumber';

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
  /** Badge fill color; defaults to colors.redFill. Use for badges that aren't reporting something dire. */
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
   * Makes the subtitle a button, with a chevron after it saying so: Today's
   * workload line opens Lighten today, the thing to do about a total that
   * reads too high. Plain `TouchableOpacity` for the reason `onTitlePress` is.
   */
  onSubtitlePress?: () => void;
  /** Spoken label for the subtitle button. Falls back to the subtitle itself. */
  subtitleAccessibilityLabel?: string;
  /**
   * The subtitle is a short count that changes while the screen is open
   * (Groceries' "4 left · 2 in cart"), so its changed characters roll through
   * `AnimatedNumber` rather than swapping in one frame. Only for a line that
   * fits on one row: while it rolls, each character is its own `Text` in a row
   * that can't wrap.
   */
  subtitleRolls?: boolean;
  /**
   * Small content rendered inline right after the title text, baseline-aligned
   * — e.g. Today's concise weather reading ("68° Sunny"). Not supported
   * alongside `onTitlePress`; nothing needs both today.
   */
  titleAdornment?: React.ReactNode;
  /**
   * Small content pinned to the screen's right edge on the overline's line,
   * above the action buttons — e.g. Today's coin balance. It sits outside the
   * title row so it can't take width from the title or its adornment.
   */
  topRight?: React.ReactNode;
  /**
   * Two fixed rows instead of a title block with the actions stacked beside it:
   * the overline and `topRight` share the top row, the title (with its
   * adornment) and the actions share the second. Both sides of the header then
   * sit on the same lines, with no reserved empty subtitle line, so every
   * screen using it has the same height and the title never moves. Takes a
   * plain title plus `titleAdornment` only (no `onTitlePress`, no subtitle),
   * which is all Today's four lenses need. Without an overline or `topRight`
   * the top row stays empty, so the lenses without one match Today's height.
   */
  gridLayout?: boolean;
}

/**
 * The standard large-title header used at the top of every screen, so
 * titles, counts and 34pt icon buttons render identically app-wide.
 */
export function ScreenHeader({ title, subtitle, overline, actions, right, onTitlePress, titleAccessibilityLabel, onSubtitlePress, subtitleAccessibilityLabel, subtitleRolls = false, titleAdornment, topRight, gridLayout = false }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const brandFace = useBrandFace('heavy');

  const actionButtons = (
      <View style={[styles.actions, gridLayout && styles.actionsGrid]}>
        {actions?.map((action, i) => {
          const tintColor = action.tint === 'orange' ? colors.orangeFill : colors.accentFill;
          const iconColor = action.disabled
            ? colors.textTertiary
            : !action.active ? colors.textSecondary
            : action.tint === 'orange' ? colors.onFill : colors.onAccent;
          const label = action.accessibilityLabel ?? labelFromIcon(action.icon);
          return (
            // A tooltip on a Mac, where an icon with no words is otherwise a
            // guess: the same words VoiceOver reads. A plain View elsewhere.
            <PointerView key={`${action.icon}-${i}`} toolTip={label}>
            <PressableScale
              style={[styles.iconBtn, action.active && { backgroundColor: tintColor }]}
              onPress={action.onPress}
              disabled={action.disabled}
              haptic
              hitSlop={4}
              accessibilityRole="button"
              accessibilityState={{ selected: action.active, disabled: action.disabled, busy: action.loading }}
              accessibilityLabel={label}
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
                    <AnimatedNumber
                      text={String(action.badge)}
                      value={action.badge}
                      style={styles.badgeText}
                      maxFontSizeMultiplier={textScale.badge}
                    />
                  </View>
                )
              )}
            </PressableScale>
            </PointerView>
          );
        })}
        {right}
      </View>
  );

  if (gridLayout) {
    return (
      <View style={styles.gridHeader}>
        <View style={styles.gridTop}>
          {overline != null ? (
            <Text style={styles.gridOverline} numberOfLines={1}>{overline}</Text>
          ) : <View />}
          {topRight}
        </View>
        <View style={styles.gridMain}>
          <View style={styles.gridTitleRow}>
            <Text style={[styles.title, brandFace, styles.titleHolds]}>{title}</Text>
            {titleAdornment != null && <View style={styles.adornment}>{titleAdornment}</View>}
          </View>
          {actionButtons}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        {overline != null ? (
          <Text style={styles.overline} numberOfLines={1}>{overline}</Text>
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
            <Text style={[styles.title, brandFace]} numberOfLines={1}>{title}</Text>
            <Ionicons name="chevron-down" size={iconSize.sm} color={colors.textSecondary} style={styles.titleChevron} />
          </TouchableOpacity>
        ) : titleAdornment != null ? (
          <View style={styles.titleRow}>
            <Text style={[styles.title, brandFace, styles.titleHolds]}>{title}</Text>
            <View style={styles.adornment}>{titleAdornment}</View>
          </View>
        ) : (
          <Text style={[styles.title, brandFace]}>{title}</Text>
        )}
        {subtitle != null && onSubtitlePress ? (
          <TouchableOpacity
            style={styles.subtitleRow}
            onPress={onSubtitlePress}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={subtitleAccessibilityLabel ?? subtitle}
          >
            {subtitleRolls
              ? <AnimatedNumber text={subtitle} style={styles.subtitle} containerStyle={styles.subtitleShrinks} />
              : <Text style={[styles.subtitle, styles.subtitleShrinks]}>{subtitle}</Text>}
            <Ionicons name="chevron-forward" size={iconSize.xs} color={colors.textSecondary} style={styles.subtitleChevron} />
          </TouchableOpacity>
        ) : subtitle != null ? (
          subtitleRolls
            ? <AnimatedNumber text={subtitle} style={styles.subtitle} />
            : <Text style={styles.subtitle}>{subtitle}</Text>
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
      {actionButtons}
      {topRight != null && <View style={styles.topRight}>{topRight}</View>}
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
  // gridLayout: the top row is as tall as the coin pill so the date centers on
  // it; the main row is as tall as the title's line and the 34pt buttons.
  gridHeader: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  gridTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 },
  gridOverline: { flexShrink: 1, color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium, marginRight: spacing.md },
  gridMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xsm },
  gridTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm, flexShrink: 1, marginRight: spacing.md },
  titleBlock: { flexShrink: 1, marginRight: spacing.md },
  topRight: { position: 'absolute', top: spacing.xs, right: spacing.md },
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
  // workload total), and textTertiary is the dimmest grey, kept for what's
  // absent — the same reason the section-label rule moved off it.
  subtitle: {
    color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium,
    marginTop: spacing.xxs,
  },
  // The pressable subtitle: the text keeps its own top margin, so the chevron
  // is nudged down by the same amount to sit on its line.
  subtitleRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.xxs },
  subtitleShrinks: { flexShrink: 1 },
  subtitleChevron: { marginTop: spacing.xxs },
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingBottom: spacing.xxs },
  actionsGrid: { paddingBottom: 0 },
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
    backgroundColor: colors.redFill, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.onFill, fontSize: font.xxs, fontWeight: fontWeight.bold },
  badgeDot: {
    position: 'absolute', top: 1, right: 1,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.textTertiary,
  },
});
