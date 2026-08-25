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
   * The bold half of the sentence, e.g. "3 ingredients". A count where there is
   * one to give; otherwise the opening of the question itself, which is what
   * the pantry's "Finished the" leads with — there is nothing to count when the
   * offer is about a single item.
   */
  lead: string;
  /** The rest of it, read straight on from `lead`. */
  rest: string;
  actionLabel: string;
  onAction: () => void;
  /**
   * A second answer, for an offer that asks *which* rather than *whether* —
   * the pantry's "Used it up" / "Went bad" (`ItemDisposalOffer`). Supplying it
   * moves the buttons onto their own row under the sentence: two of them plus
   * the ✕ do not fit beside a line of text at 390pt, and shrinking the text to
   * make them fit is how a banner turns into something nobody reads.
   *
   * Left off, the layout is the single-button one every other caller uses.
   */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  secondaryActionAccessibilityLabel?: string;
  /**
   * Put the buttons on their own row without a second one. For an offer whose
   * sentence needs the full width: the single-button layout caps its text at
   * two lines, and a question that doesn't fit is a question that gets
   * truncated rather than wrapped.
   */
  stacked?: boolean;
  /**
   * Fill colors for the two buttons, when accent-and-quiet is the wrong ranking.
   * `ItemDisposalOffer` tints them green and orange, which is how `LeftoverSheet`
   * already draws this exact question on the fridge side ("Finished it" /
   * "Threw it out"): neither answer is the recommended one, so the color carries
   * the meaning where a filled-versus-grey pair would nominate a winner.
   *
   * Text on a tinted button is always `colors.onAccent` — that's what the token
   * is for.
   */
  actionTint?: string;
  secondaryActionTint?: string;
  onDismiss: () => void;
  /** The whole sentence, said once, since the two halves are one thought. */
  accessibilityLabel: string;
  actionAccessibilityLabel: string;
  dismissAccessibilityLabel: string;
}

/**
 * The passive offer, wherever the app has something to ask that the user is
 * free to ignore.
 *
 * **One caller now, and it's worth saying why the other three went.** This was
 * `CookedOfferBanner` when all of it was about a cook: "you might be out of
 * these", "these aren't on your list", "anything left over?". Those three were
 * raised by one tap — marking a meal cooked — and ranked against each other so
 * they'd arrive one at a time, which meant a tick about eating dinner produced
 * a banner, and then another banner that looked exactly like it, and (on a
 * first cooking) a native alert in front of both. They are one moment and they
 * are one sheet now: `CookRecapSheet`. What's left here is the pantry's "how
 * did that go?" (`ItemDisposalOffer`), which is genuinely passive — nothing
 * just happened, the app noticed something on its own.
 *
 * That is not a reversal of the note this component was written around, which
 * is still the rule: **marking a meal cooked must not open `RecipeToListSheet`
 * outright**. Three things about that were wrong and only one of them was the
 * timing. It also fired with no idea whether anything needed buying (see
 * `restockRows`), and it arrived pre-ticked — the app answering a question
 * about shopping on your behalf off a tap about eating. A sheet that asks, with
 * nothing ticked and a Skip in the corner, is a different object.
 *
 * **A caller computes its count live and renders nothing at 0.** That's what
 * takes the place of a dismissal stamp: answering empties the set and the
 * banner goes on its own, the way `StartTripPrompt` returns null rather than
 * hedging. The × is for "not now" — nothing is wrong with the offer, it just
 * isn't wanted, and it doesn't have to persist to be honest since both the shop
 * and the pantry stay reachable by hand.
 *
 * If a second caller ever arrives, keep the one-at-a-time rule the cook offers
 * had: two of these side by side is the noise the passive treatment exists to
 * avoid.
 */
export function OfferBanner({
  lead,
  rest,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  secondaryActionAccessibilityLabel,
  stacked: stackedProp = false,
  actionTint,
  secondaryActionTint,
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

  const handleSecondary = () => {
    haptics.tap();
    onSecondaryAction?.();
  };

  const handleDismiss = () => {
    haptics.tap();
    onDismiss();
  };

  // Two answers never fit beside a line of text at 390pt, so a second button
  // always stacks; a single-button caller opts in when its sentence needs the
  // width.
  const stacked = stackedProp || secondaryActionLabel !== undefined;

  const dismissButton = (
    <PressableScale
      style={styles.dismiss}
      onPress={handleDismiss}
      accessibilityLabel={dismissAccessibilityLabel}
    >
      <Ionicons name="close" size={iconSize.sm} color={colors.textSecondary} />
    </PressableScale>
  );

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
      <View style={styles.row}>
        <Text style={styles.text} numberOfLines={2}>
          <Text style={styles.lead}>{lead}</Text>
          {` ${rest}`}
        </Text>
        {!stacked && (
          <PressableScale
            style={[styles.button, actionTint ? { backgroundColor: actionTint } : null]}
            onPress={handleAction}
            accessibilityLabel={actionAccessibilityLabel}
          >
            <Text style={styles.buttonText}>{actionLabel}</Text>
          </PressableScale>
        )}
        {dismissButton}
      </View>
      {stacked && (
        <View style={styles.answers}>
          <PressableScale
            style={[styles.button, actionTint ? { backgroundColor: actionTint } : null]}
            onPress={handleAction}
            accessibilityLabel={actionAccessibilityLabel}
          >
            <Text style={styles.buttonText}>{actionLabel}</Text>
          </PressableScale>
          {secondaryActionLabel !== undefined && (
            <PressableScale
              style={[
                styles.button,
                secondaryActionTint ? { backgroundColor: secondaryActionTint } : styles.secondaryButton,
              ]}
              onPress={handleSecondary}
              accessibilityLabel={secondaryActionAccessibilityLabel}
            >
              <Text style={[styles.buttonText, !secondaryActionTint && styles.secondaryButtonText]}>
                {secondaryActionLabel}
              </Text>
            </PressableScale>
          )}
        </View>
      )}
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    // Same accentSubtle as ProjectNudgeBanner, and for the same reason given
    // there: this is an offer, not an alert.
    backgroundColor: colors.accentSubtle,
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
  },
  // The row the container used to be. Split out so the stacked variant can put
  // a second row under it without the sentence and the answers sharing a line.
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Indented to the text's own left edge rather than the container's, so the
  // answers read as belonging to the question rather than to the card.
  answers: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.xs },
  text: { flex: 1, color: colors.text, fontSize: font.sm, lineHeight: font.sm * 1.35 },
  lead: { fontWeight: fontWeight.bold },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  buttonText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
  // The quieter half of a pair, the call InlineAction's `variant="neutral"`
  // makes. Only for an untinted pair — a caller answering a two-way question
  // passes its own tints instead, see the prop.
  secondaryButton: { backgroundColor: colors.bgSecondary },
  secondaryButtonText: { color: colors.text },
  dismiss: { padding: spacing.xs },
});
