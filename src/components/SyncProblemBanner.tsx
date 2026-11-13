import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';

interface Props {
  /** The sync store's `problem`, in full. Settings > Sync shows the same text. */
  message: string;
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * Shown on Today while the last sync had a problem (`selectSyncBannerProblem`).
 * A problem used to appear only on Settings > Sync, so a sync that quietly
 * stopped carrying something (recipe photos, say) went unnoticed for as long as
 * nobody opened that screen. Same shape as `SharedImageBanner`.
 */
export function SyncProblemBanner({ message, onOpen, onDismiss }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <Ionicons name="warning-outline" size={iconSize.sm} color={colors.warningText} style={styles.icon} />
        <Text style={styles.text} numberOfLines={3}>
          <Text style={styles.title}>Sync problem. </Text>
          {message}
        </Text>
      </View>

      <View style={styles.actionRow}>
        <PressableScale
          style={styles.dismissButton}
          onPress={() => { haptics.tap(); onDismiss(); }}
          accessibilityLabel="Dismiss the sync problem"
        >
          <Text style={styles.dismissText}>Dismiss</Text>
        </PressableScale>
        <PressableScale
          style={styles.openButton}
          onPress={() => { haptics.tap(); onOpen(); }}
          accessibilityLabel="Open sync settings"
        >
          <Text style={styles.openText}>Open sync settings</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    backgroundColor: colors.bgSunken,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  icon: { marginTop: 2 },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  title: { fontWeight: fontWeight.bold },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dismissButton: {
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  dismissText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.bold },
  openButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minHeight: 32,
    borderRadius: radius.full,
  },
  openText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
});
