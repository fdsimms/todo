import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

/** Diameter of the standard list-screen FAB — also the room a list must leave below its last row. */
export const FAB_SIZE = 56;

interface Props {
  onPress: () => void;
  /** Spoken label — these buttons are icon-only. */
  accessibilityLabel: string;
  /** Distance from the bottom of the screen; callers add their own tab bar / inset math. */
  bottom: number;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** 48 for FABs inside detail screens, which sit closer to the content. */
  size?: number;
  disabled?: boolean;
}

/**
 * The single-action floating button every list screen adds from.
 *
 * Adding lives in the same corner app-wide — Today, Projects, Templates,
 * Categories, Tags — rather than being a header "+" on some screens and a FAB
 * on others. The position, shadow, press scale and impact haptic all live here
 * so the copies can't drift.
 */
export function Fab({ onPress, accessibilityLabel, bottom, icon = 'add', size = FAB_SIZE, disabled }: Props) {
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.container, { bottom }]} pointerEvents="box-none">
      <PressableScale
        style={[
          styles.fab,
          { width: size, height: size, borderRadius: size / 2 },
          shadows.fab,
          disabled && styles.fabDisabled,
        ]}
        pressScale={0.9}
        disabled={disabled}
        onPress={() => { haptics.impactLight(); onPress(); }}
        accessibilityLabel={accessibilityLabel}
      >
        <Ionicons name={icon} size={size >= FAB_SIZE ? 28 : 24} color={colors.onAccent} />
      </PressableScale>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 20,
  },
  fab: {
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
  },
  fabDisabled: {
    backgroundColor: colors.bgQuaternary,
    shadowColor: 'transparent',
  },
});
