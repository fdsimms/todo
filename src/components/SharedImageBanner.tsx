import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';

interface Props {
  /** How many images are waiting. A read takes up to the first five, as one source. */
  count: number;
  onRead: () => void;
  onDiscard: () => void;
}

/**
 * Shown on Today while a screenshot or photo saved from another app's share
 * sheet is waiting to be read for tasks (see `useSharedTaskImages`).
 *
 * The same shape as `SharedLinkBanner`, and it waits for a tap for the same
 * reason: reading the image is an Anthropic call billed to the person, so it
 * isn't run for something shared hours ago without being asked. Tapping Read
 * opens `TaskImportSheet` on the image, and the review step in it is what stands
 * between the picture and any task.
 */
export function SharedImageBanner({ count, onRead, onDiscard }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <Ionicons name="image-outline" size={iconSize.sm} color={colors.accent} />
        <Text style={styles.text} numberOfLines={1}>
          {count === 1 ? 'Image shared with dundundun' : `${count} images shared with dundundun`}
        </Text>
      </View>

      <View style={styles.actionRow}>
        <PressableScale
          style={styles.dismissButton}
          onPress={() => { haptics.tap(); onDiscard(); }}
          accessibilityLabel={count === 1 ? 'Discard the shared image' : 'Discard the shared images'}
        >
          <Text style={styles.dismissText}>Discard</Text>
        </PressableScale>
        <PressableScale
          style={styles.readButton}
          onPress={() => { haptics.tap(); onRead(); }}
          accessibilityLabel={count === 1 ? 'Read tasks from the shared image' : 'Read tasks from the shared images'}
        >
          <Ionicons name="sparkles" size={iconSize.sm} color={colors.onAccent} />
          <Text style={styles.readText}>Read tasks</Text>
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
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // `bgSecondary` on a `bgSunken` banner, for the reason SharedLinkBanner gives.
  dismissButton: {
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  dismissText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.bold },
  readButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentFill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minHeight: 32,
    borderRadius: radius.full,
  },
  readText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
});
