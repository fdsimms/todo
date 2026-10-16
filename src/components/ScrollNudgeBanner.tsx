import React, { useMemo } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';
import { describeScrollNudgeSpan } from '../utils/scrollNudge';

interface Props {
  /** The configured threshold, so the sentence matches what was waited. */
  seconds: number;
  onStart: () => void;
  onDismiss: () => void;
}

/**
 * Offered on Today after the lists have been scrolled for a while with no tap
 * (see src/utils/scrollNudge.ts). The Start button opens the usual focus setup
 * sheet, so nothing begins until the person confirms there. It is a banner
 * above the list rather than an alert or a sheet, so ignoring it costs
 * nothing and a scroll or tap carries on as before.
 */
export function ScrollNudgeBanner({ seconds, onStart, onDismiss }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.text}>You’ve been scrolling for {describeScrollNudgeSpan(seconds)}. Start a focus session?</Text>
      <View style={styles.actions}>
        <PressableScale
          style={styles.button}
          onPress={() => {
            haptics.tap();
            onStart();
          }}
          accessibilityLabel="Start a focus session"
        >
          <Text style={styles.buttonText}>Start</Text>
        </PressableScale>
        <PressableScale
          style={styles.close}
          onPress={() => {
            haptics.tap();
            onDismiss();
          }}
          hitSlop={8}
          accessibilityLabel="Dismiss focus suggestion"
        >
          <Ionicons name="close" size={iconSize.md} color={colors.textSecondary} />
        </PressableScale>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    backgroundColor: colors.accentSubtle,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  text: { flex: 1, color: colors.text, fontSize: font.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  button: {
    backgroundColor: colors.accentFill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  buttonText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
  close: { padding: spacing.xs },
});
