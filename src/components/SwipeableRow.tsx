import React, { useMemo, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Swipeable } from 'react-native-gesture-handler';
import { useColors } from '../theme/ThemeContext';
import { radius, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

/** Every revealed panel is this wide, on every screen. */
const ACTION_WIDTH = 80;

interface WhenAction {
  /** Ionicon for the panel. Defaults to the clock used for rescheduling. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Panel background. Defaults to colors.orange — the app's "when" color. */
  tint?: string;
  onAction: () => void;
  /** Spoken label, e.g. `Reschedule ${task.title}`. */
  accessibilityLabel: string;
}

interface SelectAction {
  onSelect: () => void;
  accessibilityLabel: string;
}

interface Props {
  /**
   * Swipe left. Always "enter bulk editing with this row selected" — omit it
   * on a list that has no bulk mode rather than revealing a panel that no-ops.
   */
  selectAction?: SelectAction;
  /**
   * Swipe right. The row's one non-destructive "when" action — rescheduling a
   * task, deferring a stack, moving a Logbook entry's completion date. Omit it
   * for item types with nothing time-shaped to offer.
   */
  whenAction?: WhenAction;
  /** Turns the gesture off without unmounting it — see the note below. */
  enabled?: boolean;
  /** Applied to the clipping view wrapping the row. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * The one swipe treatment every list row in the app uses.
 *
 * The contract it exists to enforce, since it used to be re-derived per screen
 * and drifted every time: **swipe left enters bulk editing, swipe right is the
 * row's "when" action, and nothing destructive lives on a swipe at all.**
 * Deleting belongs in an editor or the bulk bar, where it can be confirmed and
 * undone in context — a full-swipe commit is far too easy to trigger by
 * accident for an action that can't be taken back.
 *
 * Two implementation details are load-bearing:
 *
 * - **The Swipeable stays mounted when `enabled` is false.** Swapping it for a
 *   plain View to disable the gesture changes the element type at this position
 *   in the tree, which remounts the entire row — it reads as the row flashing
 *   every time some unrelated row is tapped. Pass `enabled` instead.
 * - **The action panel is clipped by this component, not the row.** A row that
 *   carries its own `marginHorizontal` and `borderRadius` leaves the panel
 *   rendered full-bleed behind it, so the color runs to the screen edge with
 *   square corners while the card slides over it. Put the card's margins on
 *   this component's `style` and let the row inside be flush.
 * - **The row handed in must not round its own corners either**, for the same
 *   reason one step in: it slides over the panel, so its leading and trailing
 *   edges are interior seams against that panel while one is open, not card
 *   corners. A radius there opens a notch of backing between the panel and the
 *   card, and slices whatever sits on that edge — TaskItem's priority bar is
 *   3pt wide, so a 12pt radius tapered it into a spike that looked torn out of
 *   the orange. `style` is the only place the card's radius belongs; it rounds
 *   the row and its panels together as one silhouette.
 */
export function SwipeableRow({ selectAction, whenAction, enabled = true, style, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ref = useRef<Swipeable>(null);

  // No haptic here: both routes to an action (a full swipe, or swiping the
  // panel open and tapping it) pass through onSwipeableWillOpen, which already
  // ticked. Firing again on commit stacks two impacts a few frames apart.
  const fire = (action: () => void) => {
    ref.current?.close();
    action();
  };

  // Right-hand panel, revealed by swiping left.
  const renderRightActions = selectAction
    ? () => (
        <TouchableOpacity
          style={styles.selectAction}
          onPress={() => fire(selectAction.onSelect)}
          accessibilityRole="button"
          accessibilityLabel={selectAction.accessibilityLabel}
        >
          <Ionicons name="ellipsis-horizontal-circle-outline" size={iconSize.md} color={colors.onAccent} />
        </TouchableOpacity>
      )
    : undefined;

  // Left-hand panel, revealed by swiping right.
  const renderLeftActions = whenAction
    ? () => (
        <TouchableOpacity
          style={[styles.whenAction, whenAction.tint ? { backgroundColor: whenAction.tint } : null]}
          onPress={() => fire(whenAction.onAction)}
          accessibilityRole="button"
          accessibilityLabel={whenAction.accessibilityLabel}
        >
          <Ionicons name={whenAction.icon ?? 'time'} size={iconSize.md} color={colors.onAccent} />
        </TouchableOpacity>
      )
    : undefined;

  return (
    <View style={[styles.clip, style]}>
      <Swipeable
        ref={ref}
        renderRightActions={renderRightActions}
        renderLeftActions={renderLeftActions}
        overshootRight={false}
        overshootLeft={false}
        enabled={enabled}
        onSwipeableWillOpen={() => haptics.impactMedium()}
        // A full swipe commits, rather than parking the panel open and waiting
        // for a tap on it. `direction` names the side that opened, so 'right'
        // is the right-hand panel — i.e. the user swiped left.
        onSwipeableOpen={direction => {
          if (direction === 'right') { if (selectAction) fire(selectAction.onSelect); }
          else if (whenAction) fire(whenAction.onAction);
        }}
      >
        {children}
      </Swipeable>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  clip: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  selectAction: {
    width: ACTION_WIDTH,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whenAction: {
    width: ACTION_WIDTH,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
