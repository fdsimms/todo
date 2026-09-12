import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, border, iconSize, type Colors } from '../theme';

interface Props {
  title: string;
  /**
   * A small glyph before the title — the sparkle every AI-generated sheet
   * ("Suggested tasks", "Import a recipe") puts beside its title, so the
   * feature is marked before the title is even read. Defaults to
   * `colors.purple`, the app's AI tint, via `iconColor`; pass a different
   * one if this ever grows a non-AI use.
   */
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  /**
   * Rendered on the leading side — usually a `SheetHeaderButton` (Cancel/Back),
   * or a plain `<View style={{ width: N }} />` spacer when this side has no
   * button but the title still needs to sit centered against whatever's on
   * the other side. Omit entirely for a header with nothing on the left.
   */
  left?: React.ReactNode;
  /** Rendered on the trailing side — usually a `SheetHeaderButton` (Save/Done). */
  right?: React.ReactNode;
  /** `md` (the common case) or `lg`, for the handful of sheets whose title reads larger. */
  size?: 'md' | 'lg';
  numberOfLines?: number;
  /**
   * Renders just the row's three children with no outer container — for a
   * caller whose Modal shell already supplies the row (`EditorSheet`'s
   * `headerStyle`). Pass `sheetHeaderRowStyle(colors)` as that `headerStyle`
   * so the two line up. Every other caller leaves this off and gets the
   * outer row (padding, border, layout) from this component instead.
   */
  bare?: boolean;
}

/**
 * The title + button row at the top of a bottom sheet — Cancel/Back on the
 * left, Save/Done/an icon action on the right, the title centered between
 * them.
 *
 * This was hand-written in every sheet in the app: `SheetHeaderButton`
 * unified the buttons themselves, but the row around them — its padding, its
 * border, whether the title used `flex: 1` to center or just happened to
 * look centered between two equal-width spacers — was still copied out
 * roughly thirty different ways, in roughly fifteen different title styles.
 * This is that row, written once.
 *
 * The title always centers itself (`flex: 1, textAlign: 'center'`, or the
 * `icon` group as a whole when `icon` is set) regardless of what
 * `left`/`right` hold, which is a small correctness fix over some of what it
 * replaces: a title that merely sat between two same-width buttons drifted
 * off-center the moment either button's label changed length.
 *
 * See `sheetHeaderRowStyle` for the one case that doesn't render this
 * component's own outer `View` — a sheet built on `EditorSheet`, whose
 * `headerStyle` prop already supplies the row.
 */
export function SheetHeader({
  title, icon, iconColor, left, right, size = 'md', numberOfLines = 1, bare,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const titleNode = (
    <Text
      style={[icon ? styles.titleWithIconText : styles.title, size === 'lg' && styles.titleLg]}
      numberOfLines={numberOfLines}
    >
      {title}
    </Text>
  );

  const content = (
    <>
      {left}
      {icon ? (
        <View style={styles.titleWithIcon}>
          <Ionicons name={icon} size={iconSize.sm} color={iconColor ?? colors.purple} />
          {titleNode}
        </View>
      ) : titleNode}
      {right}
    </>
  );

  if (bare) return <>{content}</>;
  return <View style={styles.row}>{content}</View>;
}

/**
 * The header row's own layout, exported for the one caller shape `SheetHeader`
 * itself can't cover: `EditorSheet`'s `headerStyle` prop, which wraps
 * whatever `header` renders in its own `View` — so that caller passes
 * `bare` here and this as `headerStyle`, rather than nesting two rows.
 */
export function sheetHeaderRowStyle(colors: Colors): ViewStyle {
  return {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  };
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: sheetHeaderRowStyle(colors),
  title: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  titleLg: { fontSize: font.lg },
  // The icon+title group centers itself as a whole (flex: 1 on the row, not
  // on the text inside it) — the text takes its natural width next to the
  // icon rather than re-centering within the leftover space on its own,
  // which is what put the icon off to one side in the pattern this replaces.
  titleWithIcon: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  titleWithIconText: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
