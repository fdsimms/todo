import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { sharedLinkLabel } from '../utils/sharedRecipeLinks';
import { haptics } from '../utils/haptics';

interface Props {
  /** The page at the front of the queue — the one Import would read. */
  url: string;
  /** How many more are queued behind it. */
  remaining: number;
  onImport: () => void;
  onDismiss: () => void;
}

/**
 * Shown on Recipes while a page saved from another app's share sheet is waiting
 * to be imported (see `src/hooks/useSharedRecipeLinks.ts`).
 *
 * **It waits for a tap rather than importing on arrival**, which is the whole
 * reason it exists as a banner and not as a recipe that's already there. The
 * import is a page fetch plus an Anthropic call billed to the user's own key,
 * and running that unasked — for something shared in a supermarket aisle three
 * days ago, possibly several of them at once — spends money on a decision nobody
 * made. Tapping Import opens the same `RecipeCreateSheet` a typed link opens,
 * on the link tab with the address already in the field, so what happens next is
 * the review step every other import gets rather than a second, quieter path
 * into the recipe box.
 *
 * Built like `ActiveTripBanner` and placed the same way — a fixed sibling above
 * the list rather than its header, so it doesn't scroll out of reach, and above
 * the empty state too, since a first recipe arriving by share is exactly the
 * case where the list below is empty. One page at a time, oldest first: the
 * queue is worked front to back and a stack of banners would bury the screen
 * it's sitting on.
 */
export function SharedLinkBanner({ url, remaining, onImport, onDismiss }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const label = sharedLinkLabel(url);

  const handleImport = () => {
    haptics.tap();
    onImport();
  };

  const handleDismiss = () => {
    haptics.tap();
    onDismiss();
  };

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <Ionicons name="link-outline" size={iconSize.sm} color={colors.accent} />
        <Text style={styles.text} numberOfLines={1}>
          Shared from <Text style={styles.host}>{label}</Text>
        </Text>
        {remaining > 0 && <Text style={styles.count}>+{remaining}</Text>}
      </View>

      <View style={styles.actionRow}>
        <PressableScale
          style={styles.dismissButton}
          onPress={handleDismiss}
          accessibilityLabel={`Discard the link shared from ${label}`}
        >
          <Text style={styles.dismissText}>Discard</Text>
        </PressableScale>
        <PressableScale
          style={styles.importButton}
          onPress={handleImport}
          accessibilityLabel={`Import a recipe from ${label}`}
        >
          <Ionicons name="download-outline" size={iconSize.sm} color={colors.onAccent} />
          <Text style={styles.importText}>Import recipe</Text>
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
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  host: { fontWeight: fontWeight.bold },
  // The queue's depth, not a badge on an action — same quiet treatment the
  // "N more" counters elsewhere get, so it reads as context for the line it
  // sits on rather than as a second thing to press.
  count: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.bold,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // `bgSecondary` rather than `bgTertiary` for the same reason ActiveTripBanner's
  // Stop button takes it: this pill sits on `bgSunken`, and tertiary is a few
  // percent off sunken in the light theme, which all but erases it.
  dismissButton: {
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  dismissText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.bold },
  importButton: {
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
  importText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
});
