import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { addProximityListener, isProximitySupported } from 'todo-proximity-bridge';
import type { Task } from '../types';
import { useColors } from '../theme/ThemeContext';
import { type Colors, font, fontWeight, iconSize, interaction, lineHeight, radius, spacing } from '../theme';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { AnimatedNumber } from './AnimatedNumber';
import { BUTTON_LABEL } from '../copy/shared';
import { haptics } from '../utils/haptics';
import { displayTitleFor } from '../utils/visibilityUtils';
import {
  feedProximity,
  initialPushupState,
  normalizePushupChallenge,
  tapRep,
  type PushupCounterState,
} from '../utils/pushupCounter';

interface Props {
  visible: boolean;
  task: Task;
  /**
   * The count was reached. The caller closes the sheet and checks the task
   * off (`completeTask` with `pushupsDone`), or asks its question first if it
   * has one. Called once per opening. The done state below is what shows
   * while the sheet slides away.
   */
  onCounted: () => void;
  /** Cancel: closes the sheet with the task left as it was. */
  onClose: () => void;
}

const RING_SIZE = 240;
const RING_STROKE = 14;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Counts a task's pushups (`Task.pushupChallenge`) and hands the completion
 * back once they're done. The rules for what counts as a rep are in
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
export function PushupCounterSheet({ visible, task, onCounted, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const target = normalizePushupChallenge(task.pushupChallenge) ?? 1;

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
  }, [visible, task.id]);

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
  const title = displayTitleFor(task);
  const ringsAgain = task.reminderKind === 'persistent' || task.reminderKind === 'alarm';

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
            <Text style={styles.doneNote}>
              {ringsAgain ? `${title} is checked off, and its alarm won’t ring again.` : `${title} is checked off.`}
            </Text>
          ) : sensor === null ? null : (
            <>
              <View style={styles.card}>
                <View style={styles.cardIcon}>
                  <Ionicons name={sensor ? 'phone-portrait-outline' : 'hand-left-outline'} size={iconSize.sm} color={colors.accentText} />
                </View>
                <Text style={styles.cardText}>
                  {sensor
                    ? 'Lay the phone face up on the floor under your chest. Each time you go down, it counts.'
                    : 'This device has no proximity sensor. Tap the circle after each pushup.'}
                </Text>
              </View>
              {sensor && (
                <Text style={styles.note}>
                  The screen goes dark while you’re down, and the count shows when you come back up.
                </Text>
              )}
            </>
          )}
        </View>
      </View>
    </SheetModal>
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
  note: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.smd,
  },
  doneNote: {
    color: colors.textSecondary,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
