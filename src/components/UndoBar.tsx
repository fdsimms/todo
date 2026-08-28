import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTaskStore } from '../store/useTaskStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { InlineAction } from './InlineAction';
import { TAB_BAR_HEIGHT } from './DemoBanner';
import { FAB_SIZE } from './Fab';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { freshest, redoIsCurrent, topOf } from '../utils/undoHistory';

/** What the bar is currently offering: the undo of an action, or its redo. */
type Shown = { mode: 'undo' | 'redo'; label: string; run: () => void };

// How long the bar stays up before it dismisses itself. Short enough that it
// never overstays a moment the user has already moved past, long enough to
// read a label and reach for the button — the same trade-off shake-to-undo
// avoids by asking first instead of guessing.
const VISIBLE_MS = 6000;

/**
 * Undo #1691 — the only route to `undoLastAction()` used to be shaking the
 * phone, an affordance announced nowhere except a row in Appearance settings
 * someone would have to already know about to go looking for. This is the
 * discoverable half: a transient bar naming the action and offering to
 * reverse it, for the short list of actions that genuinely warrant one.
 *
 * **Destructive actions only, per `UndoableAction.destructive`.** Every
 * store keeps registering the other kind (an add, a reschedule, a complete)
 * exactly as before — those stay shake-only, on purpose. A bar after every
 * one of them is chrome nobody asked for; a bar after a delete or a clear is
 * the rescue the issue is about. See the flag's own doc comment in each
 * store for the reasoning, and for which ones are marked.
 *
 * **One bar for four independent histories.** Mirrors `useShakeToUndo`:
 * offers whichever of the four stores' top entry is freshest, so a grocery
 * clear and a task delete can't both want the slot at once.
 *
 * **It stays up to offer the redo.** Undoing from the bar replaces it with
 * the same bar naming what was just undone and offering it back, which is
 * where redo is discoverable at all — the shake gesture announces itself
 * nowhere, which is the whole reason this component exists. The redo offer
 * follows the same rule the dialog uses (`redoIsCurrent`): it is shown while
 * it is still the next step forward, and goes as soon as anything else
 * happens.
 *
 * **Mounted once at the navigator root**, a sibling of `DemoBanner` —
 * same reasoning: this isn't a place you navigate to, it's a state the
 * whole app can be in for a few seconds after any screen's destructive
 * action.
 */
export function UndoBar() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  const taskAction = useTaskStore(s => topOf(s.undoStack));
  const taskRedo = useTaskStore(s => topOf(s.redoStack));
  const undoTask = useTaskStore(s => s.undoLastAction);
  const redoTask = useTaskStore(s => s.redoLastUndone);
  const groceryAction = useGroceryStore(s => topOf(s.undoStack));
  const groceryRedo = useGroceryStore(s => topOf(s.redoStack));
  const undoGrocery = useGroceryStore(s => s.undoLastAction);
  const redoGrocery = useGroceryStore(s => s.redoLastUndone);
  const mealPlanAction = useMealPlanStore(s => topOf(s.undoStack));
  const mealPlanRedo = useMealPlanStore(s => topOf(s.redoStack));
  const undoMealPlan = useMealPlanStore(s => s.undoLastAction);
  const redoMealPlan = useMealPlanStore(s => s.redoLastUndone);
  const leftoverAction = useLeftoverStore(s => topOf(s.undoStack));
  const leftoverRedo = useLeftoverStore(s => topOf(s.redoStack));
  const undoLeftover = useLeftoverStore(s => s.undoLastAction);
  const redoLeftover = useLeftoverStore(s => s.redoLastUndone);

  const candidates = [
    { action: taskAction, redoEntry: taskRedo, undo: undoTask, redo: redoTask },
    { action: groceryAction, redoEntry: groceryRedo, undo: undoGrocery, redo: redoGrocery },
    { action: mealPlanAction, redoEntry: mealPlanRedo, undo: undoMealPlan, redo: redoMealPlan },
    { action: leftoverAction, redoEntry: leftoverRedo, undo: undoLeftover, redo: redoLeftover },
  ];
  const freshestUndo = freshest(
    candidates.filter(c => c.action?.destructive),
    c => c.action?.at
  );
  const freshestRedo = freshest(
    candidates.filter(c => c.redoEntry?.destructive),
    c => c.redoEntry?.at
  );
  const redoCurrent = redoIsCurrent(
    freshestRedo?.redoEntry ?? null,
    candidates.map(c => c.action)
  );

  const undoAt = freshestUndo?.action?.at ?? 0;
  const redoAt = redoCurrent ? freshestRedo?.redoEntry?.at ?? 0 : 0;
  // Whichever of the two just happened is what the bar is about: a fresh
  // destructive action raises the undo offer, and undoing one raises the redo
  // offer in its place.
  const latestAt = Math.max(undoAt, redoAt);

  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const shownAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (latestAt === 0 || latestAt <= shownAtRef.current) return;
    shownAtRef.current = latestAt;
    setShown(
      redoAt > undoAt && freshestRedo
        ? { mode: 'redo', label: freshestRedo.redoEntry!.label, run: freshestRedo.redo }
        : { mode: 'undo', label: freshestUndo!.action!.label, run: freshestUndo!.undo }
    );
    setVisible(true);
    haptics.warning();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), VISIBLE_MS);
  }, [latestAt]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  if (!visible || !shown) return null;

  const handlePress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    haptics.success();
    shown.run();
  };

  const bottom = insets.bottom + TAB_BAR_HEIGHT + FAB_SIZE + spacing.lg;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={[styles.bar, shadows.fab]}>
        <Text style={styles.label} numberOfLines={1}>
          {shown.mode === 'redo' ? `Undone: ${shown.label}` : shown.label}
        </Text>
        <InlineAction
          label={shown.mode === 'redo' ? 'Redo' : 'Undo'}
          onPress={handlePress}
          accessibilityLabel={`${shown.mode === 'redo' ? 'Redo' : 'Undo'} "${shown.label}"`}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  label: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
});
