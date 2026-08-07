import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

  return (
    <View style={styles.header}>
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

      {leading ? (
        <View style={styles.titleBlock}>
          {leading}
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
        </View>
      ) : (
        <Text style={[styles.title, styles.titleCentered]} numberOfLines={1}>{title}</Text>
      )}

      {actions ?? <View style={styles.spacer} />}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
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
