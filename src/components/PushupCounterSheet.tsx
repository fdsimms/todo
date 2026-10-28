import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { Camera } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import {
  addDepthListener,
  addProximityListener,
  isDepthSupported,
  isProximitySupported,
} from 'todo-proximity-bridge';
import { useColors } from '../theme/ThemeContext';
import { type Colors, font, fontWeight, iconSize, interaction, lineHeight, radius, spacing } from '../theme';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { AnimatedNumber } from './AnimatedNumber';
import { InlineAction } from './InlineAction';
import { BUTTON_LABEL } from '../copy/shared';
import { haptics } from '../utils/haptics';
import { MISSION_GIVE_UP_HOLD_MS } from '../utils/missions';
import {
  DEPTH_SILENCE_MS,
  depthSensorStatus,
  feedDepth,
  feedMotion,
  feedProximity,
  initialDepthState,
  initialPushupState,
  pushupSensorStatus,
  tapRep,
  type DepthCounterState,
  type PushupCounterState,
} from '../utils/pushupCounter';

export interface PushupCounterProps {
  visible: boolean;
  /** What the pushups are for: the task's or the alarm's title. */
  title: string;
  count: number;
  /** Starts a fresh count when it changes while the sheet is up (the answer queue moving on). */
  subjectKey: string;
  /** What the done state says while the sheet slides away ("Get up is checked off."). */
  doneNote: string;
  /**
   * The count was reached. The caller closes the sheet and finishes what the
   * mission was for (`completeTask` with `missionDone`, or the alarm's
   * `completeMission`). Called once per opening.
   */
  onCounted: () => void;
  /** Cancel: closes the sheet with nothing done. */
  onClose: () => void;
  /**
   * Shown only while an alarm is ringing for this mission: the way out that
   * isn't the mission, behind a hold of `MISSION_GIVE_UP_HOLD_MS`.
   */
  onGiveUp?: () => void;
}

/** How the reps are counted: see pushupCounter.ts for each. */
type CountMode = 'depth' | 'proximity' | 'tap';

/** What this device can count with, worked out once per opening. */
interface CountModes {
  /** The best of them, which the count starts in. */
  start: CountMode;
  /** What depth falls back to: the proximity sensor, or taps where there's none. */
  fallback: 'proximity' | 'tap';
  /** There is a Face ID camera, but no camera permission to read it with. */
  depthBlocked: boolean;
}

/**
 * Asks for the camera the first time it's needed, here rather than up front,
 * so the prompt arrives with the screen that explains it. A refusal isn't asked
 * again (iOS wouldn't show it): the count goes to the proximity sensor, and
 * the card says how to turn the camera back on.
 */
async function cameraAllowed(): Promise<boolean> {
  try {
    const existing = await Camera.getCameraPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;
    return (await Camera.requestCameraPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

async function countModes(): Promise<CountModes> {
  const [depth, proximity] = await Promise.all([isDepthSupported(), isProximitySupported()]);
  const fallback = proximity ? 'proximity' : 'tap';
  if (!depth) return { start: fallback, fallback, depthBlocked: false };
  const allowed = await cameraAllowed();
  return { start: allowed ? 'depth' : fallback, fallback, depthBlocked: !allowed };
}

/** How often the phone's motion is sampled while depth counts. */
const MOTION_INTERVAL_MS = 50;

const RING_SIZE = 240;
const RING_STROKE = 14;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Counts a pushup mission (`AlarmMission`, on a task or an alarm) and hands
 * the completion back once they're done. The rules for what counts as a rep are in
 * `src/utils/pushupCounter.ts`; this is the screen around them.
 *
 * It counts with the best thing the device has (`countModes`): the Face ID
 * camera's depth, with the phone under the person's face so they can watch
 * the count; the proximity sensor, with the phone under their chest; or taps.
 * Depth hands over to the fallback, keeping the count, if its readings stop
 * (`DEPTH_SILENCE_MS`), and on a tap of the switch shown before the first rep.
 *
 * Full screen rather than a page sheet: the phone is face up on the floor for
 * the whole of it, and a swipe that brushed the screen on the way down would
 * otherwise dismiss the sheet and lose the count.
 *
 * On a device with neither sensor (most iPads, a Mac) the ring is a button
 * and each tap counts, held to the same pace floor as the sensor. It's the
 * honest fallback for a task synced from a phone: without it, the task could
 * never be checked off there at all.
 */
export function PushupCounterSheet({
  visible, title, count, subjectKey, doneNote, onCounted, onClose, onGiveUp,
}: PushupCounterProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const target = Math.max(1, count);

  // The proximity sensor's count, and the taps'.
  const [counter, setCounter] = useState<PushupCounterState>(initialPushupState);
  const [depth, setDepth] = useState<DepthCounterState>(initialDepthState);
  // null while what the device can count with is being worked out.
  const [modes, setModes] = useState<CountModes | null>(null);
  const [mode, setMode] = useState<CountMode | null>(null);
  // The camera went quiet and the count moved off it, rather than the person
  // switching: the card says so, and offers the camera again.
  const [cameraLost, setCameraLost] = useState(false);
  const reps = mode === 'depth' ? depth.count : counter.count;
  const counted = reps >= target;
  const countedRef = useRef(false);
  const depthCountRef = useRef(0);
  depthCountRef.current = depth.count;

  // A fresh count every time it opens, so a cancelled attempt isn't resumed,
  // and when the answer queue moves it on to the next task while it's up.
  useEffect(() => {
    if (!visible) return;
    setCounter(initialPushupState());
    setDepth(initialDepthState());
    setModes(null);
    setMode(null);
    setCameraLost(false);
    countedRef.current = false;
    let live = true;
    countModes().then(found => {
      if (!live) return;
      setModes(found);
      setMode(found.start);
    });
    return () => {
      live = false;
    };
  }, [visible, subjectKey]);

  // From depth to the fallback, carrying the reps counted so far.
  const fallBack = useCallback((lost: boolean) => {
    if (!modes) return;
    setCounter({ ...initialPushupState(), count: depthCountRef.current });
    setCameraLost(lost);
    setMode(modes.fallback);
  }, [modes]);

  // And back, after the camera went quiet: whatever stopped it (Face ID
  // unlocking the phone, another app) has usually let go by now.
  const retryCamera = useCallback(() => {
    setDepth({ ...initialDepthState(), count: counter.count });
    setCameraLost(false);
    setMode('depth');
  }, [counter.count]);

  // Listening starts the camera, so only while there is something to count. A
  // camera that never starts, or stops partway, sends nothing at all, which
  // no reading can report, so the silence is what's watched. Only silence
  // while the app is in front counts: opened from an alarm, the counter is up
  // while Face ID is still unlocking the phone, which holds the camera, and
  // timing that out handed every alarm's count to the proximity sensor.
  useEffect(() => {
    if (!visible || mode !== 'depth' || counted) return;
    let lastHeard = Date.now();
    const remove = addDepthListener(reading => {
      lastHeard = Date.now();
      setDepth(prev => feedDepth(prev, reading));
    });
    const watch = setInterval(() => {
      if (AppState.currentState !== 'active') {
        lastHeard = Date.now();
        return;
      }
      if (Date.now() - lastHeard >= DEPTH_SILENCE_MS) fallBack(true);
    }, 500);
    return () => {
      clearInterval(watch);
      remove();
    };
  }, [visible, mode, counted, fallBack]);

  // The phone's own motion, so moving it back and forth in front of a still
  // face doesn't count. No sensor, no samples, and nothing is flagged.
  useEffect(() => {
    if (!visible || mode !== 'depth' || counted) return;
    let subscription: { remove: () => void } | null = null;
    try {
      DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
      subscription = DeviceMotion.addListener(motion => {
        const turn = motion.rotationRate;
        const accel = motion.acceleration;
        const g = motion.accelerationIncludingGravity;
        const pull = g ? Math.hypot(g.x, g.y, g.z) : 0;
        setDepth(prev => feedMotion(prev, {
          rotation: turn ? Math.hypot(turn.alpha, turn.beta, turn.gamma) : 0,
          acceleration: accel ? Math.hypot(accel.x, accel.y, accel.z) : 0,
          flatness: g && pull > 0 ? Math.abs(g.z) / pull : undefined,
          at: Date.now(),
        }));
      });
    } catch {
      subscription = null;
    }
    return () => subscription?.remove();
  }, [visible, mode, counted]);

  // Listening turns the sensor on, and with it iOS's habit of switching the
  // screen off while it's covered, so only while there is something to count.
  useEffect(() => {
    if (!visible || mode !== 'proximity' || counted) return;
    return addProximityListener(change => {
      setCounter(prev => feedProximity(prev, change.near, change.at));
    });
  }, [visible, mode, counted]);

  // A rep is felt as well as seen: with the proximity sensor the screen is
  // dark for the part of the rep where it happens.
  const lastCount = useRef(0);
  useEffect(() => {
    if (reps === lastCount.current) return;
    lastCount.current = reps;
    if (reps === 0) return;
    if (reps >= target) {
      if (!countedRef.current) {
        countedRef.current = true;
        haptics.success();
        onCounted();
      }
    } else {
      haptics.impactLight();
    }
  }, [reps, target]);

  const progress = Math.min(1, reps / target);
  const status = mode === 'depth' ? depthSensorStatus(depth) : pushupSensorStatus(counter);
  const statusDot = status.tone === 'miss' ? colors.orange : status.tone === 'counting' ? colors.green : colors.textTertiary;

  const ring = (
    <View style={styles.ring}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
          fill="none" stroke={counted ? colors.done : colors.bgQuaternary} strokeWidth={RING_STROKE}
        />
        {!counted && progress > 0 && (
          <Circle
            cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
            fill="none" stroke={colors.accent} strokeWidth={RING_STROKE} strokeLinecap="round"
            strokeDasharray={`${RING_LENGTH * progress} ${RING_LENGTH}`}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        )}
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        {counted ? (
          <>
            <View style={styles.check}>
              <Ionicons name="checkmark" size={iconSize.xl + 12} color={colors.onDone} />
            </View>
            <Text style={styles.ringCaption}>{target} pushups</Text>
          </>
        ) : (
          <>
            <AnimatedNumber
              text={String(reps)}
              value={reps}
              style={styles.hero}
              accessibilityLabel={`${reps} of ${target} pushups`}
            />
            <Text style={styles.ringCaption}>of {target}</Text>
          </>
        )}
      </View>
    </View>
  );

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {visible && <ScreenAwake />}
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SheetHeader
          title="Pushups"
          left={counted
            ? <View style={styles.headerSpacer} />
            : <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={onClose} minWidth={64} />}
          right={counted
            ? <SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={64} />
            : <View style={styles.headerSpacer} />}
        />
        <View style={styles.body}>
          <Text style={styles.taskTitle} numberOfLines={2}>{title}</Text>
          {mode === 'tap' && !counted ? (
            <TouchableOpacity
              activeOpacity={interaction.activeOpacity}
              onPress={() => setCounter(prev => tapRep(prev, Date.now()))}
              accessibilityRole="button"
              accessibilityLabel={`Count a pushup, ${reps} of ${target}`}
            >
              {ring}
            </TouchableOpacity>
          ) : ring}

          {counted ? (
            <Text style={styles.doneNote}>{doneNote}</Text>
          ) : mode === null ? null : (
            <>
              {mode !== 'tap' && (
                <View style={styles.status} accessible accessibilityLabel={`${status.line}. ${status.detail}`}>
                  <View style={[styles.statusDot, { backgroundColor: statusDot }]} />
                  <View style={styles.statusText}>
                    <Text style={styles.statusLine}>{status.line}</Text>
                    <Text style={styles.statusDetail}>{status.detail}</Text>
                  </View>
                </View>
              )}
              <View style={[styles.card, mode !== 'tap' && styles.cardUnderStatus]}>
                <View style={styles.cardIcon}>
                  <Ionicons name={mode === 'tap' ? 'hand-left-outline' : 'phone-portrait-outline'} size={iconSize.sm} color={colors.accentText} />
                </View>
                <Text style={styles.cardText}>{cardText(mode, modes?.depthBlocked === true, cameraLost)}</Text>
              </View>
              {mode === 'depth' && reps === 0 && modes && (
                <InlineAction
                  label={modes.fallback === 'proximity' ? 'Use the proximity sensor' : 'Count by tapping'}
                  icon="swap-horizontal-outline"
                  variant="neutral"
                  surface="page"
                  onPress={() => fallBack(false)}
                  style={styles.switchMode}
                />
              )}
              {mode !== 'depth' && cameraLost && (
                <InlineAction
                  label="Try the camera again"
                  icon="refresh-outline"
                  variant="neutral"
                  surface="page"
                  onPress={retryCamera}
                  style={styles.switchMode}
                />
              )}
            </>
          )}
        </View>
        {onGiveUp && !counted && (
          <View style={[styles.giveUpWrap, { paddingBottom: insets.bottom + spacing.md }]}>
            <GiveUpButton onGiveUp={onGiveUp} colors={colors} styles={styles} />
          </View>
        )}
      </View>
    </SheetModal>
  );
}

/** The card under the status: where the phone goes, or how to count without a sensor. */
function cardText(mode: CountMode, depthBlocked: boolean, cameraLost: boolean): string {
  switch (mode) {
    case 'depth':
      return 'Lay the phone face up on the floor under your face. The front camera measures how far away you are, and a rep doesn’t count if the phone moves or isn’t lying flat. Nothing is recorded.';
    case 'proximity':
      if (cameraLost) {
        return 'The Face ID camera stopped sending readings, so the proximity sensor is counting instead. Lay the phone face up on the floor under your chest. Each time you go down, it counts.';
      }
      return depthBlocked
        ? 'Lay the phone face up on the floor under your chest. Each time you go down, it counts. Camera access is off. Turn it on in Settings to count with the Face ID camera instead.'
        : 'Lay the phone face up on the floor under your chest. Each time you go down, it counts.';
    case 'tap':
      return cameraLost
        ? 'The Face ID camera stopped sending readings. Tap the circle after each pushup.'
        : 'This device has no proximity sensor. Tap the circle after each pushup.';
  }
}

/**
 * The way out of a ringing mission that isn't the mission: held for
 * `MISSION_GIVE_UP_HOLD_MS`, filling as it goes, and nothing on a shorter
 * press. Long on purpose, so stopping the alarm this way is a decision made
 * awake rather than a tap made half asleep.
 */
function GiveUpButton({ onGiveUp, colors, styles }: {
  onGiveUp: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const fill = useRef(new Animated.Value(0)).current;
  const holding = useRef<Animated.CompositeAnimation | null>(null);
  const seconds = Math.round(MISSION_GIVE_UP_HOLD_MS / 1000);

  const start = () => {
    haptics.impactLight();
    holding.current = Animated.timing(fill, {
      toValue: 1,
      duration: MISSION_GIVE_UP_HOLD_MS,
      useNativeDriver: false,
    });
    holding.current.start(({ finished }) => {
      if (!finished) return;
      haptics.warning();
      onGiveUp();
    });
  };
  const stop = () => {
    holding.current?.stop();
    holding.current = null;
    Animated.timing(fill, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };

  return (
    <>
      <Pressable
        onPressIn={start}
        onPressOut={stop}
        style={styles.giveUp}
        accessibilityRole="button"
        accessibilityLabel={`Give up, hold for ${seconds} seconds`}
      >
        <Animated.View
          style={[
            styles.giveUpFill,
            { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
        <Text style={styles.giveUpText}>Give up</Text>
      </Pressable>
      <Text style={styles.giveUpNote}>
        Hold for {seconds} seconds. The alarm stops, and Activity records that you gave up.
      </Text>
    </>
  );
}

/**
 * Holds the screen awake while the counter is up: the phone lies untouched
 * for the whole set, and an auto-lock partway through would suspend the app
 * and stop the count. Its own component so the lock is tied to the Modal's
 * content (see CookModeSheet's ScreenAwake).
 */
function ScreenAwake() {
  useKeepAwake();
  return null;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { minWidth: 64 },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  taskTitle: {
    color: colors.textSecondary,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    marginTop: spacing.xl,
  },
  ringCenter: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A hero number: one of the literal font sizes the scale isn't for.
  hero: {
    color: colors.text,
    fontSize: 72,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  ringCaption: {
    color: colors.textSecondary,
    fontSize: font.md,
    marginTop: spacing.xsm,
  },
  check: {
    width: 72,
    height: 72,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: colors.done,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  card: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.smd,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xl,
  },
  // The status sits where the card used to start, and the card follows it.
  cardUnderStatus: { marginTop: spacing.md },
  switchMode: { marginTop: spacing.md },
  status: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.smd,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  // Centered on the first line (lineHeight.md).
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: (lineHeight.md - 10) / 2 },
  statusText: { flex: 1 },
  statusLine: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.semibold,
  },
  statusDetail: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    marginTop: spacing.xxs,
  },
  cardIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.md,
    lineHeight: lineHeight.md,
  },
  giveUpWrap: {
    paddingHorizontal: spacing.lg,
  },
  giveUp: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  giveUpFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.redFill,
  },
  giveUpText: {
    color: colors.redText,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  giveUpNote: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  doneNote: {
    color: colors.textSecondary,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
