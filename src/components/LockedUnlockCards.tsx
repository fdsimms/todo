import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { useLockedUnlockProgress } from '../hooks/useLockedUnlockProgress';
import { useClockTimeToken } from '../hooks/useClockTimeToken';
import { navigateToTab } from '../navigation/navigationRef';
import { haptics } from '../utils/haptics';
import { lockedProgressLine } from '../utils/rewardUnlocks';
import { LockedProgress, UnlockHead, unlockSubtitle } from './UnlockProgress';

/**
 * The Screen Time page's "Unlocks today": one card for each locked unlock that
 * is holding apps shut, under the status card that says it is. It is the
 * Rewards screen's progress, read only, since an unlock is edited there: a tap
 * opens Rewards. Renders nothing when no unlock is blocking, so an open unlock
 * (whose code and timer stay on Rewards) leaves with its block.
 */
export function LockedUnlockCards() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const timeToken = useClockTimeToken();
  const progress = useLockedUnlockProgress();
  if (progress.length === 0) return null;
  return (
    <>
      <Text style={styles.sectionHeader}>Unlocks today</Text>
      <View style={styles.list}>
        {progress.map(({ unlock, share, coinsShort, pendingTitles }) => (
          <TouchableOpacity
            key={unlock.id}
            style={styles.card}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); navigateToTab('Rewards'); }}
            accessibilityRole="button"
            accessibilityLabel={[
              unlock.title,
              lockedProgressLine(share, coinsShort),
              pendingTitles.length > 0 ? `Still needs ${pendingTitles.join(', ')}` : null,
            ].filter(Boolean).join('. ')}
            accessibilityHint="Opens Rewards"
          >
            <UnlockHead
              unlock={unlock}
              subtitle={unlockSubtitle(unlock, { kind: 'locked', share, coinsShort, pending: [] }, false, timeToken)}
              trailing={<Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />}
            />
            <LockedProgress sharePct={unlock.sharePct} share={share} coinsShort={coinsShort} pendingTitles={pendingTitles} />
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    sectionHeader: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    list: { gap: spacing.smd },
    card: {
      marginHorizontal: spacing.md,
      padding: spacing.smd,
      borderRadius: radius.md,
      backgroundColor: colors.bgSecondary,
      gap: spacing.sm,
    },
  });
}
