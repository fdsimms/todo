import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Alert } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import { addDays } from 'date-fns/addDays';
import type { Fast } from '../types';
import { CardSheet } from './CardSheet';
import { CountStepper } from './CountStepper';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors, useTheme } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import { formatTimeOfDay } from '../utils/dateUtils';
import { sameMinute, shiftDays, withClock } from '../utils/workoutTimes';
import {
  DEFAULT_FAST_GOAL_HOURS,
  MAX_FAST_GOAL_HOURS,
  MIN_FAST_GOAL_HOURS,
  fastStartProblem,
} from '../utils/fasting';
import { useFastStore } from '../store/useFastStore';
import { askForReminderPermissionIfNeeded } from '../utils/reminderPermission';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The fast being edited, or null to start one. */
  fast: Fast | null;
  /** When the last meal was logged, offered as a start (`lastMealLoggedAt`). */
  lastMealAt: Date | null;
  onClose: () => void;
}

/** "today", "yesterday", else "Mon, Oct 19", to follow "Started". */
function dayName(date: Date, now: Date): string {
  if (isSameDay(date, now)) return 'today';
  if (isSameDay(date, addDays(now, -1))) return 'yesterday';
  return format(date, 'EEE, MMM d');
}

/**
 * Starting a fast, or changing one: when it started and the goal in hours.
 *
 * The `WorkoutTimesSheet` shape: a day stepper over one time wheel, staged edits
 * written on Done, and Done withheld with the reason under it while the start
 * can't be saved (`fastStartProblem`). Starting offers two quick answers
 * first, now and the last meal logged, since those are almost always the one
 * wanted, and the last meal is only ever an offer (see `src/utils/fasting.ts`).
 */
export function FastSheet({ visible, fast, lastMealAt, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const startFast = useFastStore(s => s.startFast);
  const updateFast = useFastStore(s => s.updateFast);
  const deleteFast = useFastStore(s => s.deleteFast);

  const [start, setStart] = useState(() => new Date());
  const [goal, setGoal] = useState(DEFAULT_FAST_GOAL_HOURS);
  const [wheelReady, setWheelReady] = useState(false);

  // The goal a new fast opens with: the last one's, so somebody doing 18:6
  // isn't moving 16 to 18 every time.
  const lastGoal = useFastStore(s => s.fasts[s.fasts.length - 1]?.goalHours ?? DEFAULT_FAST_GOAL_HOURS);

  useEffect(() => {
    if (visible) {
      setStart(fast ? new Date(fast.startedAt) : new Date());
      setGoal(fast ? fast.goalHours : lastGoal);
    } else {
      setWheelReady(false);
    }
    // Seeded on open only, like WorkoutTimesSheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const now = new Date();
  const startDay = dayName(start, now);
  const problem = fastStartProblem(start, now, fast?.endedAt ? new Date(fast.endedAt) : null);
  const dirty = fast
    ? !sameMinute(start, new Date(fast.startedAt)) || goal !== fast.goalHours
    : false;

  const handleCancel = (close: (after?: () => void) => void) => {
    if (!dirty) { close(); return; }
    confirmDiscard(() => close());
  };

  const save = (close: (after?: () => void) => void) => {
    haptics.success();
    if (fast) {
      close(() => { updateFast(fast.id, { startedAt: start, goalHours: goal }); });
    } else {
      close(() => {
        if (startFast(start, goal)) void askForReminderPermissionIfNeeded();
      });
    }
  };

  const confirmDelete = (close: (after?: () => void) => void) => {
    if (!fast) return;
    Alert.alert('Delete this fast?', 'It is removed from your history.', [
      { text: BUTTON_LABEL.cancel, style: 'cancel' },
      { text: BUTTON_LABEL.delete, style: 'destructive', onPress: () => close(() => deleteFast(fast.id)) },
    ]);
  };

  const quick = (label: string, at: Date) => {
    const on = sameMinute(start, at);
    return (
      <TouchableOpacity
        key={label}
        style={[styles.quick, on && styles.quickOn]}
        onPress={() => { haptics.tap(); setStart(at); }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
      >
        <Text style={[styles.quickText, on && styles.quickTextOn]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <CardSheet
      visible={visible}
      onClose={onClose}
      onRequestClose={handleCancel}
      onShow={() => setWheelReady(true)}
      name="FastSheet"
      cardStyle={styles.card}
    >
      {close => (
        <>
          <View style={styles.header}>
            <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => handleCancel(close)} minWidth={64} />
            <Text style={styles.title}>{fast ? 'Edit fast' : 'Start a fast'}</Text>
            <View style={styles.headerEnd}>
              <SheetHeaderButton
                label={fast ? BUTTON_LABEL.save : 'Start'}
                onPress={() => save(close)}
                disabled={problem !== null}
                minWidth={64}
              />
            </View>
          </View>

          {!fast && (
            <View style={styles.quickRow}>
              {quick('Now', now)}
              {lastMealAt && quick(`From last meal, ${formatTimeOfDay(lastMealAt)}`, lastMealAt)}
            </View>
          )}

          <View style={styles.day}>
            <TouchableOpacity
              onPress={() => { haptics.tap(); setStart(shiftDays(start, -1)); }}
              hitSlop={8}
              style={styles.dayButton}
              accessibilityRole="button"
              accessibilityLabel="Previous day"
            >
              <Ionicons name="chevron-back" size={18} color={colors.accentText} />
            </TouchableOpacity>
            <Text style={styles.dayText} accessibilityLiveRegion="polite">
              {`Started ${startDay}, ${formatTimeOfDay(start)}`}
            </Text>
            <TouchableOpacity
              onPress={() => { haptics.tap(); setStart(shiftDays(start, 1)); }}
              hitSlop={8}
              style={styles.dayButton}
              accessibilityRole="button"
              accessibilityLabel="Next day"
            >
              <Ionicons name="chevron-forward" size={18} color={colors.accentText} />
            </TouchableOpacity>
          </View>

          <View style={styles.wheel}>
            {wheelReady && (
              <DateTimePicker
                value={start}
                mode="time"
                display="spinner"
                onChange={(_e, d) => { if (d) setStart(withClock(start, d)); }}
                themeVariant={isDark ? 'dark' : 'light'}
                style={styles.wheelWidget}
              />
            )}
          </View>

          <View style={styles.goalRow}>
            <Text style={styles.goalLabel}>Goal</Text>
            <CountStepper
              value={goal}
              onChange={n => { if (n !== null) setGoal(n); }}
              min={MIN_FAST_GOAL_HOURS}
              max={MAX_FAST_GOAL_HOURS}
              format={n => `${n} h`}
              label="fasting goal"
              describeValue={n => `${n ?? goal} hours`}
            />
          </View>

          {problem !== null && (
            <Text style={styles.problem} accessibilityLiveRegion="polite">{problem}</Text>
          )}

          {fast && (
            <TouchableOpacity
              style={styles.delete}
              onPress={() => confirmDelete(close)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
            >
              <Text style={styles.deleteText}>Delete this fast</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { padding: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.smd },
  headerEnd: { minWidth: 64, alignItems: 'flex-end' },
  title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.smd },
  quick: {
    paddingHorizontal: spacing.smd, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  quickOn: { backgroundColor: colors.accentFill },
  quickText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  quickTextOn: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  day: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgTertiary, borderRadius: radius.md, paddingHorizontal: spacing.xs, minHeight: 44,
  },
  dayButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dayText: { color: colors.text, fontSize: font.md, flexShrink: 1, textAlign: 'center' },
  wheel: { marginTop: spacing.xs, minHeight: 150, justifyContent: 'center' },
  wheelWidget: { height: 150 },
  goalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm, gap: spacing.md,
  },
  goalLabel: { color: colors.text, fontSize: font.md },
  problem: { color: colors.redText, fontSize: font.sm, textAlign: 'center', marginTop: spacing.smd },
  delete: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: spacing.xs },
  deleteText: { color: colors.redText, fontSize: font.md },
});
