import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';

interface Props {
  title: string;
  onBack: () => void;
  /**
   * `back` is the pushed-screen chevron; `close` is the downward one a sheet
   * uses, since it dismisses rather than pops.
   */
  backIcon?: 'back' | 'close';
  backAccessibilityLabel?: string;
  /**
   * An icon tile rendered to the left of the title. Supplying one also
   * left-aligns the title beside it — a tile plus a centered title would leave
   * the two floating apart.
   */
  leading?: React.ReactNode;
  /** Right-side controls. Without any, a spacer balances the back button. */
  actions?: React.ReactNode;
}

/**
 * The small back-chevron bar at the top of a pushed screen — Settings, a
 * project, a category, a template — and of the tag sheet, which closes instead
 * of popping.
 *
 * Deliberately *not* `ScreenHeader`: tab and drawer destinations get the large
 * left-aligned title, and screens you pushed into get this. Both idioms existed
 * already; what didn't exist was one copy of either. This bar had been written
 * out five times, identically, and its back button four.
 */
export function DetailHeader({
  title,
  onBack,
  backIcon = 'back',
  backAccessibilityLabel,
  leading,
  actions,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The title shares its row with the back chevron and (on a screen like
  // Recipe with several icons) up to half a dozen fixed-width actions, which
  // squeezes it to whatever's left over — for its whole height, not just its
  // first line. A short title never notices; a long recipe/project/template
  // name wrapped to a handful of narrow, cramped lines. Once a title is seen
  // wrapping in that squeezed row, it's promoted to its own full-width row
  // below instead. `wrapped` only ever turns on — flipping it back off on a
  // re-measure at the wider width would just bounce the layout between the
  // two states.
  const [wrapped, setWrapped] = useState(false);
  const handleTitleLayout = useCallback((e: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (e.nativeEvent.lines.length > 1) setWrapped(true);
  }, []);

  const backButton = (
    <PressableScale
      onPress={onBack}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={backAccessibilityLabel ?? (backIcon === 'close' ? 'Close' : 'Back')}
    >
      <Ionicons
        name={backIcon === 'close' ? 'chevron-down' : 'chevron-back'}
        size={24}
        color={colors.textSecondary}
      />
    </PressableScale>
  );

  const titleText = (
    <Text
      style={[styles.title, !leading && !wrapped && styles.titleCentered]}
      onTextLayout={handleTitleLayout}
    >
      {title}
    </Text>
  );
  const titleContent = leading ? (
    <View style={styles.titleBlock}>
      {leading}
      {titleText}
    </View>
  ) : titleText;

  return (
    <View style={styles.container}>
      <View style={[styles.header, wrapped && styles.headerWrapped]}>
        {backButton}
        {!wrapped && titleContent}
        {actions ?? <View style={styles.spacer} />}
      </View>
      {wrapped && <View style={styles.wrappedTitleRow}>{titleContent}</View>}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  headerWrapped: { paddingBottom: spacing.sm },
  wrappedTitleRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  titleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  title: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  // Without a leading tile the title takes the slack between the two edge
  // controls, so it lands optically centered.
  titleCentered: { flex: 1, textAlign: 'center' },
  // Matches the back chevron's width so a header with no actions still centers.
  spacer: { width: 24 },
});
