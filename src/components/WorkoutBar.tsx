import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useFocusStore } from '../store/useFocusStore';
import { useBulkBarPresenceStore } from '../store/useBulkBarPresenceStore';
import { useFabPresenceStore } from '../store/useFabPresenceStore';
import { useFloatingBarStore } from '../store/useFloatingBarStore';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { useBottomBarHeight } from '../hooks/useBottomBarHeight';
import { useRestTimer } from '../hooks/useRestTimer';
import { FAB_SIZE, useFabBottom } from './Fab';
import { isCookTimerRunning } from '../utils/recipeTimer';
import { isStepTimerRunning, stepTimerRemaining } from '../utils/stepTimers';
import { formatStopwatch } from '../utils/effort';
import { confirmDiscardWorkout } from '../utils/confirmDiscardWorkout';
import { haptics } from '../utils/haptics';
import { GlassLayer, glassSupported } from './GlassLayer';

/**
 * "Workout Full Body · Rest 0:58 · 36:20", floating just above the tab bar on
 * every screen while a workout is running and workout mode is closed: the way
 * back in once its sheet has been minimized, the way `CookingBar` is for Cook
 * Mode. Tapping it reopens workout mode; the trash can discards the workout
 * (`confirmDiscardWorkout`, the same ask as the sheet's own).
 *
 * App-wide for the same reason as `CookingBar`: someone mid-workout goes to
 * check a task or a recipe, and there is no screen that is "the workout's".
 * Gated on `workoutsEnabled`, so switching the area off leaves no bar pointing
 * at it. It steps aside while a bulk bar is up, whose count and close button
 * sit in its band, and sits one bar higher for each of `CookingBar` and the
 * focus bar that is showing.
 */
export function WorkoutBar() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const barHeight = useBottomBarHeight();
  const fabBottom = useFabBottom();
  const styles = makeStyles(colors);
  const enabled = useSettingsStore(s => s.workoutsEnabled);
  const live = useWorkoutStore(s => s.sessions.find(x => x.endedAt === null) ?? null);
  const modeOpen = useWorkoutModeStore(s => s.open);
  const bulkSelecting = useBulkBarPresenceStore(s => s.count > 0);
  const cookTimerRunning = useRecipeStore(s => s.recipes.some(isCookTimerRunning));
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const cooking = cookTimerRunning && kitchenEnabled;
  const focusing = useFocusStore(s => !!s.session);
  const fabShown = useFabPresenceStore(s => s.count > 0);
  const fabHand = useSettingsStore(s => s.fabHand);
  const shown = enabled && !!live && !modeOpen && !bulkSelecting;

  const { rest, now: restNow } = useRestTimer(shown ? live?.id : undefined);
  const resting = rest !== null && isStepTimerRunning(rest);

  // Once a second while it is on screen: the elapsed time moves with it.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!shown) return;
    setNowTick(Date.now());
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [shown, live?.id]);

  // Same placement as `CookingBar`: above the tab bar, short of the add
  // button's corner when the screen has one. The step and the rise are the
  // ones `FocusBar` uses to stack under the same two bars.
  const step = 52 + (fabShown ? 14 : 0);
  const lift = ((cooking ? 1 : 0) + (focusing ? 1 : 0)) * step;
  const bottom = insets.bottom + barHeight + spacing.smd + lift;
  const clearance = spacing.lg + FAB_SIZE + spacing.sm;
  const sideInset = fabShown ? { [fabHand === 'left' ? 'left' : 'right']: clearance } : null;

  // Its top edge, for the scroll-to-top button in the opposite corner to rest above.
  const [ownHeight, setOwnHeight] = useState(0);
  const reportBar = useFloatingBarStore(s => s.report);
  const top = fabShown && lift === 0 ? fabBottom + (FAB_SIZE + ownHeight) / 2 : bottom + ownHeight;
  useEffect(() => {
    if (!shown || ownHeight === 0) return;
    reportBar('workout', top);
    return () => reportBar('workout', null);
  }, [shown, ownHeight, top, reportBar]);

  if (!shown || !live) return null;

  const elapsed = formatStopwatch((nowTick - new Date(live.startedAt).getTime()) / 1000);
  const restLeft = resting && rest ? Math.max(0, Math.ceil(stepTimerRemaining(rest, restNow))) : 0;

  return (
    <View
      style={[styles.wrap, fabShown && lift === 0 ? { bottom: fabBottom, height: FAB_SIZE, justifyContent: 'center' } : { bottom }, sideInset]}
      pointerEvents="box-none"
    >
      <View
        style={[styles.bar, glassSupported() ? styles.barGlass : shadows.fab]}
        onLayout={e => setOwnHeight(e.nativeEvent.layout.height)}
      >
        <GlassLayer interactive style={styles.glassRadius} />
        <TouchableOpacity
          style={styles.open}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); useWorkoutModeStore.getState().show(); }}
          accessibilityRole="button"
          accessibilityLabel={`${live.title} in progress, ${elapsed} elapsed${restLeft > 0 ? `, rest ${formatStopwatch(restLeft)} left` : ''}. Return to workout`}
        >
          <Ionicons name="barbell" size={iconSize.sm} color={colors.accentText} />
          <Text style={styles.name} numberOfLines={1}>{live.title}</Text>
          {restLeft > 0 && <Text style={styles.rest}>{`Rest ${formatStopwatch(restLeft)}`}</Text>}
          <Text style={styles.elapsed}>{elapsed}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.trash}
          activeOpacity={interaction.activeOpacity}
          onPress={() => confirmDiscardWorkout()}
          accessibilityRole="button"
          accessibilityLabel="Discard workout"
        >
          <Ionicons name="trash-outline" size={iconSize.md} color={colors.redText} />
        </TouchableOpacity>
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
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  // The glass supplies its own fill, edge and depth, so the solid card's come off together.
  barGlass: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  glassRadius: { borderRadius: radius.lg },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.smd },
  trash: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: fontWeight.bold },
  rest: { color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  elapsed: { color: colors.textSecondary, fontSize: font.sm, fontVariant: ['tabular-nums'] },
});
