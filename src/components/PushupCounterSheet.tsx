import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { addProximityListener, isProximitySupported } from 'todo-proximity-bridge';
import { useColors } from '../theme/ThemeContext';
import { type Colors, font, fontWeight, iconSize, interaction, lineHeight, radius, spacing } from '../theme';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { AnimatedNumber } from './AnimatedNumber';
import { BUTTON_LABEL } from '../copy/shared';
import { haptics } from '../utils/haptics';
import { MISSION_GIVE_UP_HOLD_MS } from '../utils/missions';
import {
  feedProximity,
  initialPushupState,
  pushupSensorStatus,
  tapRep,
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
  /** The alarm's wake-up song while it plays ("Mr. Blue Sky · ELO"), shown under the title. */
  nowPlaying?: string | null;
}

const RING_SIZE = 240;
const RING_STROKE = 14;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Counts a pushup mission (`AlarmMission`, on a task or an alarm) and hands
 * the completion back once they're done. The rules for what counts as a rep are in
 * `src/utils/pushupCounter.ts`; this is the screen around them.
 *
 * Full screen rather than a page sheet: the phone is face up on the floor for
 * the whole of it, and a swipe that brushed the screen on the way down would
 * otherwise dismiss the sheet and lose the count.
 *
 * On a device with no proximity sensor (an iPad, a Mac) the ring is a button
 * and each tap counts, held to the same pace floor as the sensor. It's the
 * honest fallback for a task synced from a phone: without it, the task could
 * never be checked off there at all.
 */
export function PushupCounterSheet({
  visible, title, count, subjectKey, doneNote, onCounted, onClose, onGiveUp, nowPlaying,
}: PushupCounterProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const target = Math.max(1, count);

  const [counter, setCounter] = useState<PushupCounterState>(initialPushupState);
  // null while the sensor is being looked for.
  const [sensor, setSensor] = useState<boolean | null>(null);
  const counted = counter.count >= target;
  const countedRef = useRef(false);

  // A fresh count every time it opens, so a cancelled attempt isn't resumed,
  // and when the answer queue moves it on to the next task while it's up.
  useEffect(() => {
    if (!visible) return;
    setCounter(initialPushupState());
    countedRef.current = false;
    let live = true;
    isProximitySupported().then(supported => {
      if (live) setSensor(supported);
    });
    return () => {
      live = false;
    };
  }, [visible, subjectKey]);

  // Listening turns the sensor on, and with it iOS's habit of switching the
  // screen off while it's covered, so only while there is something to count.
  useEffect(() => {
    if (!visible || sensor !== true || counted) return;
    return addProximityListener(change => {
      setCounter(prev => feedProximity(prev, change.near, change.at));
    });
  }, [visible, sensor, counted]);

  // A rep is felt as well as seen: the screen is dark for the part of the rep
  // where it happens.
  const lastCount = useRef(0);
  useEffect(() => {
    if (counter.count === lastCount.current) return;
    lastCount.current = counter.count;
    if (counter.count === 0) return;
    if (counter.count >= target) {
      if (!countedRef.current) {
        countedRef.current = true;
        haptics.success();
        onCounted();
      }
    } else {
      haptics.impactLight();
    }
  }, [counter.count, target]);

  const progress = Math.min(1, counter.count / target);
  const status = pushupSensorStatus(counter);
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
              text={String(counter.count)}
              value={counter.count}
              style={styles.hero}
              accessibilityLabel={`${counter.count} of ${target} pushups`}
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
          {nowPlaying ? (
            <View style={styles.nowPlaying} accessibilityLabel={`Playing ${nowPlaying}`}>
              <Ionicons name="musical-notes" size={iconSize.xs} color={colors.accentText} />
              <Text style={styles.nowPlayingText} numberOfLines={1}>{nowPlaying}</Text>
            </View>
          ) : null}
          {sensor === false && !counted ? (
            <TouchableOpacity
              activeOpacity={interaction.activeOpacity}
              onPress={() => setCounter(prev => tapRep(prev, Date.now()))}
              accessibilityRole="button"
              accessibilityLabel={`Count a pushup, ${counter.count} of ${target}`}
            >
              {ring}
            </TouchableOpacity>
          ) : ring}

          {counted ? (
            <Text style={styles.doneNote}>{doneNote}</Text>
          ) : sensor === null ? null : (
            <>
              {sensor && (
                <View style={styles.status} accessible accessibilityLabel={`${status.line}. ${status.detail}`}>
                  <View style={[styles.statusDot, { backgroundColor: statusDot }]} />
                  <View style={styles.statusText}>
                    <Text style={styles.statusLine}>{status.line}</Text>
                    <Text style={styles.statusDetail}>{status.detail}</Text>
                  </View>
                </View>
              )}
              <View style={[styles.card, sensor && styles.cardUnderStatus]}>
                <View style={styles.cardIcon}>
                  <Ionicons name={sensor ? 'phone-portrait-outline' : 'hand-left-outline'} size={iconSize.sm} color={colors.accentText} />
                </View>
                <Text style={styles.cardText}>
                  {sensor
                    ? 'Lay the phone face up on the floor under your chest. Each time you go down, it counts.'
                    : 'This device has no proximity sensor. Tap the circle after each pushup.'}
                </Text>
              </View>
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
  nowPlaying: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsm,
    maxWidth: '100%',
    marginTop: spacing.smd,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
  },
  nowPlayingText: { flexShrink: 1, color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold },
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
