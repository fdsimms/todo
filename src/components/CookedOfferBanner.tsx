import React, { useEffect, useMemo, useRef } from 'react';
import { Text, View, StyleSheet, Animated } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { useReduceMotion } from '../utils/useReduceMotion';
import { haptics } from '../utils/haptics';

interface Props {
  /**
   * The bold half of the sentence, e.g. "3 ingredients". Usually a count,
   * which is what the two consumption offers lead with; the leftovers one
   * leads with the question instead, because there is nothing to count yet.
   */
  lead: string;
  /** The rest of it, read straight on from `lead`. */
  rest: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
  /** The whole sentence, said once, since the two halves are one thought. */
  accessibilityLabel: string;
  actionAccessibilityLabel: string;
  dismissAccessibilityLabel: string;
}

/**
 * The passive offer shown on the meal plan (and on Today) after a meal is
 * marked cooked. Three of them exist and they are the same shape on purpose:
 * "you might be out of these" (CookedUseUpOffer), "these aren't on your
 * list" (MealPlanScreen's restock offer) and "anything left over?"
 * (LogLeftoversOffer).
 *
 * This replaced opening `RecipeToListSheet` outright on the mark-cooked tap.
 * The sheet is a full-screen modal with a Cancel and an Add, and firing one at
 * a tick that had nothing to do with shopping made the app read as assuming
 * you wanted to re-buy a meal the moment you finished eating it. Three things
 * about that were wrong and only one of them was the timing: it also fired
 * with no idea whether anything needed buying (see `restockRows`), and it
 * arrived pre-ticked. So the offer is a banner — the same shape
 * `ProjectNudgeBanner` uses for the other "here's something you might want to
 * look at" on Today — and the sheet opens only if you ask for it.
 *
 * **Every caller computes its count live and renders nothing at 0.** That's
 * what takes the place of a dismissal stamp: answering empties the set and the
 * banner goes on its own, the way `StartTripPrompt` returns null rather than
 * hedging. The × is for "not now" — nothing is wrong with the offer, it just
 * isn't wanted, and it doesn't have to persist to be honest since both the
 * shop and the pantry stay reachable by hand.
 *
 * One banner at a time, and they are ranked rather than stacked: the
 * consumption question is the one only this moment can answer, so both the
 * restock offer (see MealPlanScreen) and the leftovers one (which ranks itself)
 * wait behind it. Two of these side by side is the noise the passive treatment
 * exists to avoid.
 */
export function CookedOfferBanner({
  lead,
  rest,
  actionLabel,
  onAction,
  onDismiss,
  accessibilityLabel,
  actionAccessibilityLabel,
  dismissAccessibilityLabel,
}: Props) {
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

  const handleAction = () => {
    haptics.tap();
    onAction();
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
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.text} numberOfLines={2}>
        <Text style={styles.lead}>{lead}</Text>
        {` ${rest}`}
      </Text>
      <PressableScale
        style={styles.button}
        onPress={handleAction}
        accessibilityLabel={actionAccessibilityLabel}
      >
        <Text style={styles.buttonText}>{actionLabel}</Text>
      </PressableScale>
      <PressableScale
        style={styles.dismiss}
        onPress={handleDismiss}
        accessibilityLabel={dismissAccessibilityLabel}
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
  lead: { fontWeight: fontWeight.bold },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  buttonText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
  dismiss: { padding: spacing.xs },
});
