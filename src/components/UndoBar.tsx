import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTaskStore } from '../store/useTaskStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { InlineAction } from './InlineAction';
import { TAB_BAR_HEIGHT } from './DemoBanner';
import { FAB_SIZE } from './Fab';
import { TRIP_BAR_HEIGHT } from './PersistentTripBar';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

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
 * **One bar for three independent queues.** Mirrors `useShakeToUndo`:
 * offers whichever of the three stores' `lastAction` is freshest, so a
 * grocery clear and a task delete can't both want the slot at once.
 *
 * **Mounted once at the navigator root**, a sibling of `DemoBanner` and
 * `PersistentTripBar` — same reasoning as both: this isn't a place you
 * navigate to, it's a state the whole app can be in for a few seconds after
 * any screen's destructive action.
 *
 * **Positioning tracks `PersistentTripBar`, deliberately loosely.** That bar
 * already owns the band directly above the FAB whenever a trip is running,
 * so this one stacks one slot higher in that case and drops into the same
 * band otherwise. The trip check here is `tripShopId !== null` rather than
 * the full `resolveActiveTrip` staleness/liveness walk that bar does — the
 * only cost of being wrong is a slightly taller gap above the FAB in the
 * rare case a trip has silently expired, never an overlap, so the cheaper
 * check is worth not re-deriving trip liveness a third time.
 */
export function UndoBar() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  const taskAction = useTaskStore(s => s.lastAction);
  const undoTask = useTaskStore(s => s.undoLastAction);
  const groceryAction = useGroceryStore(s => s.lastAction);
  const undoGrocery = useGroceryStore(s => s.undoLastAction);
  const mealPlanAction = useMealPlanStore(s => s.lastAction);
  const undoMealPlan = useMealPlanStore(s => s.undoLastAction);
  const tripActive = useGroceryStore(s => s.tripShopId !== null);

  const candidates = [
    { action: taskAction, undo: undoTask },
    { action: groceryAction, undo: undoGrocery },
    { action: mealPlanAction, undo: undoMealPlan },
  ];
  const freshest = candidates.reduce<typeof candidates[number] | null>((best, c) => {
    if (!c.action?.destructive) return best;
    if (!best || (c.action.at ?? 0) > (best.action!.at ?? 0)) return c;
    return best;
  }, null);
  const freshestAt = freshest?.action?.at ?? 0;

  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<{ label: string; undo: () => void } | null>(null);
  const shownAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!freshest || freshestAt <= shownAtRef.current) return;
    shownAtRef.current = freshestAt;
    setShown({ label: freshest.action!.label, undo: freshest.undo });
    setVisible(true);
    haptics.warning();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), VISIBLE_MS);
  }, [freshestAt]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  if (!visible || !shown) return null;

  const handleUndo = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    haptics.success();
    shown.undo();
  };

  const bottom = tripActive
    ? insets.bottom + TAB_BAR_HEIGHT + FAB_SIZE + spacing.lg + TRIP_BAR_HEIGHT + spacing.sm
    : insets.bottom + TAB_BAR_HEIGHT + FAB_SIZE + spacing.lg;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={[styles.bar, shadows.fab]}>
        <Text style={styles.label} numberOfLines={1}>
          {shown.label}
        </Text>
        <InlineAction label="Undo" onPress={handleUndo} accessibilityLabel={`Undo "${shown.label}"`} />
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
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
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
