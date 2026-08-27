import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, useTheme } from '../theme/ThemeContext';
import {
  animation,
  border,
  font,
  fontWeight,
  iconSize,
  interaction,
  radius,
  spacing,
  type Colors,
} from '../theme';
import type { GroceryItem, GroceryListEntry } from '../types';
import { entryFor } from '../utils/groceryLists';
import { useGroceryStore } from '../store/useGroceryStore';
import {
  buildPantryReviewDeck,
  describeLastPurchase,
  describePantryDoubt,
  describePantryReviewDone,
  type PantryReviewAnswer,
  type PantryReviewCard,
  type PantryReviewDeck,
} from '../utils/pantryReview';
import { haptics } from '../utils/haptics';
import { EmptyState } from './EmptyState';
import { PressableScale } from './PressableScale';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The pantry review deck — one card per doubtful thing, answered by swiping.
 *
 * **It is `fullScreen`, and that is not a style choice** (#1182). The cards run
 * on a `PanResponder`, and a `presentationStyle="pageSheet"` modal is presented
 * by a `UISheetPresentationController` whose pull-down pan lives on an ancestor
 * of this content — RN's own touch handler destroys its in-flight touches the
 * moment it has to arbitrate with a recognizer from outside its view. The
 * symptom is a card that follows the finger for a moment and then snaps back,
 * in both directions, with nothing else moving. `EditorSheet` and
 * `CategoryOrderSheet` are `fullScreen` for exactly this, with the same
 * `insets.top` standing in for the page sheet's own inset.
 *
 * **The deck is seeded once per open, not derived from the store.** Every
 * answer writes to `items`, so a deck recomputed on each render would reorder
 * and resize itself under the finger mid-session — the card you were about to
 * swipe becoming a different card. Same call `CategoryOrderSheet` makes about
 * its own local order, and for the same reason.
 *
 * **Three gestures, and three buttons that do the same three things.** A
 * swipe-only surface is unreachable for anyone not swiping and invisible to
 * anyone who hasn't been told, so the buttons are the real control and the
 * gesture is the accelerator. They are also where the accessibility labels
 * live, which a bare pan gesture has nowhere to put.
 */
export function PantryReviewSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const { shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const answerPantryReview = useGroceryStore(s => s.answerPantryReview);
  const revertPantryAnswer = useGroceryStore(s => s.revertPantryAnswer);

  const [deck, setDeck] = useState<PantryReviewDeck>(EMPTY_DECK);
  const [index, setIndex] = useState(0);
  /**
   * One row snapshot per answered card, newest last — what Undo writes back.
   *
   * Snapshots rather than a list of answers: the three answers aren't each
   * other's opposites, so undoing "Running low" means restoring the
   * `lastAddedAt` it may have changed and the trolley it may have put the row
   * in, which only the row and its membership as they stood can say. Both, and
   * not just the row: membership is a table now (see `GroceryListEntry`), so
   * the item alone can't say whether it was already on this list.
   */
  const [history, setHistory] = useState<Array<{
    item: GroceryItem;
    entry: GroceryListEntry | null;
  }>>([]);

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  // Read by the responder callbacks, which are built once and would otherwise
  // close over the first render's values for the life of the sheet.
  const deckRef = useRef(deck);
  const indexRef = useRef(index);
  deckRef.current = deck;
  indexRef.current = index;

  useEffect(() => {
    if (!visible) return;
    const grocery = useGroceryStore.getState();
    // Bare `new Date()` for the reason every pantry read takes it: the windows
    // here are real elapsed days from a till receipt rather than logical days.
    setDeck(buildPantryReviewDeck(grocery.items, new Date(), grocery.itemProducts));
    setIndex(0);
    setHistory([]);
    pan.setValue({ x: 0, y: 0 });
  }, [visible, pan]);

  const commit = useCallback(
    (answer: PantryReviewAnswer) => {
      const card = deckRef.current.cards[indexRef.current];
      if (!card) return;
      // Snapshotted from the store rather than from the card, so the row put
      // back by Undo is the one that was actually written over — the card holds
      // the item as the deck was built, which may be a few answers old by now.
      const state = useGroceryStore.getState();
      const live = state.items.find(i => i.id === card.item.id);
      const entry = entryFor(state.listEntries, card.item.id, state.activeListId);
      haptics.tap();
      answerPantryReview(card.item.id, answer);
      setHistory(h => [...h, { item: live ?? card.item, entry }]);
      setIndex(i => i + 1);
      pan.setValue({ x: 0, y: 0 });
    },
    [answerPantryReview, pan]
  );

  /**
   * Fling the card out the way it was answered, then commit.
   *
   * The write happens in the animation's completion rather than up front so the
   * row underneath doesn't change while the card that named it is still on
   * screen — the deck is local, so nothing re-renders on the write, but the
   * finished state's counts would tick over a beat early.
   */
  const flingOut = useCallback(
    (answer: PantryReviewAnswer) => {
      const toValue =
        answer === 'low'
          ? { x: 0, y: -SCREEN_HEIGHT }
          : { x: answer === 'have' ? SCREEN_WIDTH * 1.4 : -SCREEN_WIDTH * 1.4, y: 0 };
      Animated.timing(pan, {
        toValue,
        duration: animation.duration.fast,
        useNativeDriver: true,
      }).start(() => commit(answer));
    },
    [commit, pan]
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    haptics.tap();
    const previous = history[history.length - 1];
    revertPantryAnswer(previous.item, previous.entry);
    setHistory(h => h.slice(0, -1));
    setIndex(i => Math.max(0, i - 1));
    pan.setValue({ x: 0, y: 0 });
  }, [history, pan, revertPantryAnswer]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claimed on movement rather than on touch-down, so a tap that lands on
        // the card (rather than on a button) still reads as a tap.
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > interaction.tapMoveThreshold ||
          Math.abs(g.dy) > interaction.tapMoveThreshold,
        onPanResponderMove: (_e, g) => {
          // Upward drags track vertically and horizontal ones horizontally,
          // never both: a card that follows the finger diagonally reads as
          // being dragged towards two answers at once, and the release then
          // picks one of them without having shown which.
          if (isVertical(g.dx, g.dy)) pan.setValue({ x: 0, y: Math.min(0, g.dy) });
          else pan.setValue({ x: g.dx, y: 0 });
        },
        onPanResponderRelease: (_e, g) => {
          const answer = answerFor(g.dx, g.dy);
          if (answer) flingOut(answer);
          else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, ...animation.spring.snappy }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, ...animation.spring.snappy }).start();
        },
      }),
    [flingOut, pan]
  );

  const cards = deck.cards;
  const card = cards[index];
  const answered = index;
  const finished = !card;

  const rotate = pan.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-12deg', '0deg', '12deg'],
    extrapolate: 'clamp',
  });
  const stampOpacity = (kind: PantryReviewAnswer) => {
    if (kind === 'low') {
      return pan.y.interpolate({ inputRange: [-SWIPE_THRESHOLD, -8, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' });
    }
    const range = kind === 'have' ? [0, 8, SWIPE_THRESHOLD] : [-SWIPE_THRESHOLD, -8, 0];
    const out = kind === 'have' ? [0, 0, 1] : [1, 0, 0];
    return pan.x.interpolate({ inputRange: range, outputRange: out, extrapolate: 'clamp' });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.overline}>Pantry</Text>
            <Text style={styles.title}>Still have it?</Text>
          </View>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

        {cards.length > 0 && (
          <View style={styles.progress}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${(answered / cards.length) * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>
              {answered} of {cards.length} checked
            </Text>
          </View>
        )}

        {cards.length === 0 ? (
          <EmptyState
            icon="checkmark-done-outline"
            title="Nothing to check"
            subtitle="The app isn't in any doubt about what's in the pantry right now."
          />
        ) : finished ? (
          <EmptyState
            icon="checkmark-done-outline"
            title="All done"
            subtitle={describePantryReviewDone(answered, deck.omitted)}
          />
        ) : (
          <View style={styles.stage}>
            <View style={styles.deck}>
              {cards
                .slice(index, index + 3)
                .map((entry, offset) => ({ entry, offset }))
                .reverse()
                .map(({ entry, offset }) =>
                  offset === 0 ? (
                    <Animated.View
                      key={entry.item.id}
                      {...responder.panHandlers}
                      style={[
                        styles.card,
                        shadows.card,
                        { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] },
                      ]}
                    >
                      <Animated.View style={[styles.stamp, styles.stampOut, { opacity: stampOpacity('out') }]}>
                        <Text style={[styles.stampText, { color: colors.red }]}>Out of it</Text>
                      </Animated.View>
                      <Animated.View style={[styles.stamp, styles.stampHave, { opacity: stampOpacity('have') }]}>
                        <Text style={[styles.stampText, { color: colors.green }]}>Still have it</Text>
                      </Animated.View>
                      <Animated.View style={[styles.stamp, styles.stampLow, { opacity: stampOpacity('low') }]}>
                        <Text style={[styles.stampText, { color: colors.orange }]}>Running low</Text>
                      </Animated.View>
                      <CardBody card={entry} styles={styles} />
                    </Animated.View>
                  ) : (
                    <View
                      key={entry.item.id}
                      style={[
                        styles.card,
                        shadows.card,
                        {
                          transform: [{ scale: 1 - offset * 0.05 }, { translateY: -offset * 10 }],
                          opacity: 1 - offset * 0.3,
                        },
                      ]}
                    />
                  )
                )}
            </View>
          </View>
        )}

        {!finished && cards.length > 0 && (
          <>
            <View style={styles.actions}>
              <Action
                icon="arrow-undo-outline"
                label="Undo"
                small
                tint={colors.textSecondary}
                background={colors.bgTertiary}
                disabled={history.length === 0}
                onPress={undo}
                styles={styles}
              />
              <Action
                icon="close"
                label="Out of it"
                tint={colors.red}
                background={colors.red + '26'}
                onPress={() => flingOut('out')}
                styles={styles}
              />
              <Action
                icon="contrast-outline"
                label="Running low"
                tint={colors.orange}
                background={colors.orange + '26'}
                onPress={() => flingOut('low')}
                styles={styles}
              />
              <Action
                icon="checkmark"
                label="Still have it"
                tint={colors.green}
                background={colors.green + '2E'}
                onPress={() => flingOut('have')}
                styles={styles}
              />
            </View>
            <Text style={[styles.foot, { paddingBottom: insets.bottom + spacing.lg }]}>
              Swipe left, right or up
            </Text>
          </>
        )}
      </View>
    </Modal>
  );
}

function CardBody({ card, styles }: { card: PantryReviewCard; styles: Styles }) {
  // `probablyHaveReason`'s own words while there are any. A lapsed card has
  // none by definition — the guess it would have quoted is what ran out — so it
  // falls back to the bare purchase date rather than showing a naked name.
  const line = card.reason ?? describeLastPurchase(card.item);
  const doubt = describePantryDoubt(card);
  return (
    <>
      <Text style={styles.aisle} numberOfLines={1}>
        {card.item.aisle || 'Pantry'}
      </Text>
      <Text style={styles.name} numberOfLines={3}>
        {card.item.name}
      </Text>
      {!!line && <Text style={styles.reason}>{line}</Text>}
      {!!doubt && (
        <View style={styles.doubt}>
          <Text style={styles.doubtText}>{doubt}</Text>
        </View>
      )}
    </>
  );
}

function Action({
  icon,
  label,
  tint,
  background,
  onPress,
  disabled,
  small,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  background: string;
  onPress: () => void;
  disabled?: boolean;
  small?: boolean;
  styles: Styles;
}) {
  return (
    <View style={styles.action}>
      <PressableScale
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        style={[
          small ? styles.buttonSmall : styles.button,
          { backgroundColor: background },
          disabled && styles.buttonDisabled,
        ]}
      >
        <Ionicons name={icon} size={small ? iconSize.md : iconSize.xl} color={tint} />
      </PressableScale>
      <Text style={styles.actionLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const EMPTY_DECK: PantryReviewDeck = { cards: [], omitted: 0 };
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
/**
 * How far a card has to travel before the release counts as an answer.
 *
 * A quarter of the screen: far enough that a scroll-ish flick doesn't write to
 * the pantry, short enough that eleven of them in a row isn't work.
 */
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;

/** Whether a drag reads as the upward "running low" one rather than a sideways answer. */
function isVertical(dx: number, dy: number): boolean {
  return dy < 0 && Math.abs(dy) > Math.abs(dx);
}

/** Which answer a release means, or null when the card didn't travel far enough. */
function answerFor(dx: number, dy: number): PantryReviewAnswer | null {
  if (isVertical(dx, dy)) return dy < -SWIPE_THRESHOLD ? 'low' : null;
  if (dx > SWIPE_THRESHOLD) return 'have';
  if (dx < -SWIPE_THRESHOLD) return 'out';
  return null;
}

/**
 * Fixed so the stack behind the top card has something to sit against, and so
 * a long name can't resize the card mid-swipe. Tall enough for three lines of
 * name plus the reason and the doubt pill.
 */
const CARD_HEIGHT = 260;

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    overline: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    title: { fontSize: font.xxl, fontWeight: fontWeight.bold, color: colors.text },
    progress: { paddingHorizontal: spacing.md, marginTop: spacing.md },
    track: { height: 4, borderRadius: radius.full, backgroundColor: colors.bgTertiary, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.accent },
    progressText: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.sm },

    stage: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.md },
    deck: { height: CARD_HEIGHT },
    card: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      height: CARD_HEIGHT,
      borderRadius: radius.lg,
      backgroundColor: colors.bgSecondary,
      padding: spacing.lg,
    },
    aisle: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    name: { fontSize: font.xxl, fontWeight: fontWeight.bold, color: colors.text, marginTop: spacing.md },
    reason: { fontSize: font.md, color: colors.textSecondary, marginTop: spacing.sm },
    doubt: {
      alignSelf: 'flex-start',
      marginTop: spacing.md,
      paddingVertical: spacing.xs + 3,
      paddingHorizontal: spacing.sm + 4,
      borderRadius: radius.full,
      backgroundColor: colors.warningBg,
    },
    doubtText: { fontSize: font.sm, fontWeight: fontWeight.medium, color: colors.orange },

    stamp: {
      position: 'absolute',
      top: spacing.lg,
      zIndex: 2,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md - 2,
      borderRadius: radius.sm,
      borderWidth: border.md + 0.5,
    },
    stampOut: { right: spacing.lg, transform: [{ rotate: '11deg' }], borderColor: colors.red },
    stampHave: { left: spacing.lg, transform: [{ rotate: '-11deg' }], borderColor: colors.green },
    stampLow: { alignSelf: 'center', left: 0, right: 0, borderColor: colors.orange, alignItems: 'center' },
    stampText: {
      fontSize: font.md,
      fontWeight: fontWeight.bold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },

    actions: {
      flexDirection: 'row',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      gap: spacing.lg - 4,
    },
    action: { alignItems: 'center', width: 62, gap: spacing.sm },
    button: {
      width: 60,
      height: 60,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonSmall: {
      width: interaction.minTouchTarget,
      height: interaction.minTouchTarget,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: spacing.sm,
    },
    buttonDisabled: { opacity: 0.4 },
    actionLabel: {
      fontSize: font.xs,
      fontWeight: fontWeight.medium,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    foot: {
      fontSize: font.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingTop: spacing.lg,
    },
  });

