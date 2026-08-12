import React, { useEffect, useMemo, useRef } from 'react';
import { Text, View, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { useReduceMotion } from '../utils/useReduceMotion';
import { haptics } from '../utils/haptics';

interface Props {
  /** The dish just marked cooked — named, so the offer says what it's about. */
  recipeName: string;
  /** How many lines `restockRows` will defend. Never rendered at 0; see below. */
  count: number;
  onReview: () => void;
  onDismiss: () => void;
}

/**
 * Shown on the meal plan after a meal is marked cooked, when the app can name
 * items you buy that aren't on your list.
 *
 * This replaced opening `RecipeToListSheet` outright on the mark-cooked tap.
 * The sheet is a full-screen modal with a Cancel and an Add, and firing one at
 * a tick that had nothing to do with shopping made the app read as assuming
 * you wanted to re-buy a meal the moment you finished eating it. Three things
 * about that were wrong and only one of them was the timing: it also fired
 * with no idea whether anything needed buying (see `restockRows`), and it
 * arrived pre-ticked. So the offer is now a banner — the same shape
 * `ProjectNudgeBanner` uses for the other "here's something you might want to
 * look at" on Today — and the sheet opens only if you ask for it.
 *
 * **The caller computes `count` live and renders nothing at 0.** That's what
 * takes the place of a dismissal stamp: adding the items empties the set and
 * the banner goes on its own, the way `TripSuggestionCard` returns null rather
 * than hedging. The × is for "not now" — nothing is wrong with the offer, it
 * just isn't wanted, and it doesn't have to persist to be honest since the
 * same shop is always available from the recipe itself.
 */
export function CookedRestockBanner({ recipeName, count, onReview, onDismiss }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: animation.duration.normal,
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion]);

  const label = `${count} ingredient${count === 1 ? '' : 's'}`;

  const handleReview = () => {
    haptics.tap();
    onReview();
  };

  const handleDismiss = () => {
    haptics.tap();
    onDismiss();
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        },
      ]}
      accessibilityRole="summary"
      accessibilityLabel={`${label} from ${recipeName} are not on your shopping list`}
    >
      <Text style={styles.text} numberOfLines={2}>
        <Text style={styles.count}>{label}</Text>
        {` from ${recipeName} aren't on your list`}
      </Text>
      <PressableScale
        style={styles.button}
        onPress={handleReview}
        accessibilityLabel={`Review ${label} from ${recipeName} to add to your shopping list`}
      >
        <Text style={styles.buttonText}>Review</Text>
      </PressableScale>
      <PressableScale
        style={styles.dismiss}
        onPress={handleDismiss}
        accessibilityLabel="Dismiss restock notice"
      >
        <Ionicons name="close" size={iconSize.sm} color={colors.textSecondary} />
      </PressableScale>
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    // Same accentSubtle as ProjectNudgeBanner, and for the same reason given
    // there: this is an offer, not an alert.
    backgroundColor: colors.accentSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
  },
  text: { flex: 1, color: colors.text, fontSize: font.sm, lineHeight: font.sm * 1.35 },
  count: { fontWeight: fontWeight.bold },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  buttonText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
  dismiss: { padding: spacing.xs },
});
