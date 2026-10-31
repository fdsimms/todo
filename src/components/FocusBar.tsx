import React, { useEffect, useMemo, useState } from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useBottomBarHeight } from '../hooks/useBottomBarHeight';
import { FAB_SIZE } from './Fab';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';
import { formatStopwatch } from '../utils/effort';
import { displayTitleFor, isQuotaTask } from '../utils/visibilityUtils';
import { formatQuotaProgress } from '../utils/quotaUnit';
import {
  currentFocusStep,
  isFocusRunning,
  isFocusSessionFinished,
  isFocusStepDone,
  focusStepRemaining,
} from '../utils/focusPlan';
import { useFocusSession } from '../hooks/useFocusSession';
import { useFocusStore } from '../store/useFocusStore';
import { useTaskStore } from '../store/useTaskStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useBulkBarPresenceStore } from '../store/useBulkBarPresenceStore';
import { useFabPresenceStore } from '../store/useFabPresenceStore';
import { useFloatingBarStore } from '../store/useFloatingBarStore';
import { isCookTimerRunning } from '../utils/recipeTimer';
import { resetToFocusSession } from '../navigation/navigationRef';

interface Props {
  /** Reopens the session sheet. */
  onOpen: () => void;
  /**
   * Floats above the tab bar instead of sitting in the page's flow, for every
   * screen that isn't Today (see `FocusFloatingBar`). `lifted` raises it one
   * bar's height so it clears `CookingBar` when both are showing.
   */
  floating?: boolean;
  lifted?: boolean;
}

/**
 * The strip on Today saying a focus session is running, and how far into the
 * current stretch it is.
 *
 * Same job `ActiveTripBanner` does for its mode: a session that's been closed
 * back to the task list has no other affordance on screen, and without this
 * the only evidence it exists is a chime some minutes later. Tapping anywhere
 * along it reopens the session.
 *
 * Renders nothing when there's no session, so Today pays no height for it the
 * rest of the time. The pause control is here as well as inside the sheet
 * because pausing is the one thing you want without going back in: the phone
 * rang, and reopening a full-screen countdown to stop the clock is two taps
 * where one will do.
 */
/**
 * The same strip, on every screen but Today, so a session that's been
 * minimized still says it's running wherever you are. Today keeps its inline
 * strip; tapping this one lands on Today with the sheet open
 * (`resetToFocusSession`), since that's where the sheet is mounted.
 */
export function FocusFloatingBar({ hidden }: { hidden: boolean }) {
  const session = useFocusStore(s => s.session);
  const cooking = useRecipeStore(s => s.recipes.some(isCookTimerRunning));
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  // Same reason as CookingBar: its band is where a bulk bar's count and close
  // button land.
  const bulkSelecting = useBulkBarPresenceStore(s => s.count > 0);
  if (hidden || !session || bulkSelecting) return null;
  return (
    <View style={floatingWrap} pointerEvents="box-none">
      <FocusBar floating lifted={cooking && kitchenEnabled} onOpen={resetToFocusSession} />
    </View>
  );
}

const floatingWrap = { position: 'absolute' as const, left: spacing.md, right: spacing.md, top: 0, bottom: 0 };

export function FocusBar({ onOpen, floating = false, lifted = false }: Props) {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const barHeight = useBottomBarHeight();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { session, now } = useFocusSession();
  // Only the step's own task, so a write to any other task doesn't re-render
  // the bar (it is mounted app-wide and already ticks every second).
  const stepTaskId = session ? currentFocusStep(session)?.taskId : undefined;
  const task = useTaskStore(s => (stepTaskId ? s.tasks.find(t => t.id === stepTaskId) : undefined));
  const pause = useFocusStore(s => s.pause);
  const resume = useFocusStore(s => s.resume);

  // Just above the tab bar like CookingBar, stopping short of the add button's
  // corner when the screen has one, and one bar higher while CookingBar shows.
  const fabShown = useFabPresenceStore(s => s.count > 0);
  const fabHand = useSettingsStore(s => s.fabHand);
  // CookingBar centers on the add button when there is one, which sits higher.
  const liftStep = FLOATING_BAR_STEP + (fabShown ? FAB_CENTERED_RISE : 0);
  const bottom = insets.bottom + barHeight + spacing.smd + (lifted ? liftStep : 0);
  const clearance = spacing.lg + FAB_SIZE + spacing.sm - spacing.md;
  const sideInset = fabShown ? { [fabHand === 'left' ? 'marginLeft' : 'marginRight']: clearance } : null;

  // Its top edge, for the scroll-to-top button in the opposite corner to rest above.
  const [ownHeight, setOwnHeight] = useState(0);
  const reportBar = useFloatingBarStore(s => s.report);
  const reporting = floating && !!session;
  const top = bottom + ownHeight;
  useEffect(() => {
    if (!reporting || ownHeight === 0) return;
    reportBar('focus', top);
    return () => reportBar('focus', null);
  }, [reporting, ownHeight, top, reportBar]);

  if (!session) return null;

  // Stamped on the session at start — see FocusSessionSheet's own note.
  const hideTimers = session.hideTimers;
  const finished = isFocusSessionFinished(session);
  const step = currentFocusStep(session);
  const running = isFocusRunning(session);
  const stepDone = isFocusStepDone(session, now);
  const remaining = focusStepRemaining(session, now);

  const label = finished
    ? 'Session done'
    : step?.kind === 'rest'
      ? (step.long ? 'Long break' : 'Break')
      : task
        ? displayTitleFor(task)
        : 'Focusing';

  // A daily target's count, so the strip says which of the ten glasses the
  // session is on. Bare "4/10" without the unit: the title is right beside it
  // and the strip is one line that a long title already competes for.
  const quotaCount = !finished && task && isQuotaTask(task) && !task.completed
    ? formatQuotaProgress(task.progressCount, task.targetCount!, null)
    : null;

  // An over-run step counts up rather than sitting at 0:00, so the strip says
  // how long it's been waiting on you rather than just that it is. Hidden by
  // focusHideTimers, same as the session sheet's own clock — the pause
  // control and the task title still work with no number in the strip.
  const clock = finished || hideTimers
    ? null
    : stepDone
      ? `+${formatStopwatch(-remaining)}`
      : formatStopwatch(remaining);

  return (
    <View
      style={floating ? [styles.container, styles.floating, shadows.fab, { bottom }, sideInset] : styles.container}
      onLayout={e => setOwnHeight(e.nativeEvent.layout.height)}
    >
      <TouchableOpacity
        style={styles.summary}
        onPress={() => {
          haptics.tap();
          onOpen();
        }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={
          finished
            ? 'Focus session finished. Open it'
            : `Focusing on ${label}${quotaCount ? `, ${quotaCount} logged` : ''}${clock ? `, ${clock} ${stepDone ? 'over' : 'left'}` : ''}. Open the session`
        }
      >
        <Ionicons
          name={finished ? 'checkmark-done' : step?.kind === 'rest' ? 'cafe' : 'hourglass'}
          size={iconSize.sm}
          color={stepDone && !finished ? colors.orangeText : colors.accent}
        />
        <Text style={styles.text} numberOfLines={1}>{label}</Text>
        {quotaCount !== null && <Text style={styles.count}>{quotaCount}</Text>}
        {clock !== null && (
          <Text style={[styles.clock, stepDone && styles.clockDone]}>{clock}</Text>
        )}
      </TouchableOpacity>

      {!finished && (
        <PressableScale hitSlop={8}
          style={styles.button}
          onPress={() => {
            haptics.tap();
            if (running) pause();
            else resume();
          }}
          accessibilityLabel={running ? 'Pause focus session' : 'Resume focus session'}
        >
          <Ionicons name={running ? 'pause' : 'play'} size={iconSize.sm} color={colors.onAccent} />
        </PressableScale>
      )}
    </View>
  );
}

/** One bar's height plus a gap, the room `lifted` leaves for CookingBar. */
const FLOATING_BAR_STEP = 52;
/** How much higher CookingBar sits when centered on the add button than when resting above the tab bar. */
const FAB_CENTERED_RISE = 14;

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bgSunken,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
  },
  floating: {
    position: 'absolute',
    left: 0,
    right: 0,
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
    borderWidth: border.md,
    borderColor: colors.separator,
    backgroundColor: colors.bgSecondary,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  count: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  clock: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  clockDone: { color: colors.orangeText },
  button: {
    backgroundColor: colors.accentFill,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
});
