import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import { isSameYear } from 'date-fns/isSameYear';
import { addDays } from 'date-fns/addDays';
import { CardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors, useTheme } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import { formatTimeOfDay } from '../utils/dateUtils';
import { describeEventLength } from '../utils/eventLength';
import { sameMinute, shiftDays, spanMinutes, withClock, workoutTimesProblem } from '../utils/workoutTimes';
import { BUTTON_LABEL } from '../copy/shared';

/** Which of the two times is being changed. */
export type TimeEnd = 'start' | 'end';

interface Props {
  visible: boolean;
  /** The workout's saved start and finish; the sheet stages its edits and hands both back on Done. */
  start: Date;
  end: Date;
  /** Which time opens selected: the row that was tapped. */
  initial: TimeEnd;
  /** Whether the new times would be written to Health, which holds a workout to a day. */
  healthLimited: boolean;
  onConfirm: (start: Date, end: Date) => void;
  onClose: () => void;
}

/** "Today, Oct 21", "Yesterday, Oct 20", else "Mon, Oct 19" (with the year once it isn't this one). */
function dayName(date: Date, now: Date): string {
  const base = format(date, isSameYear(date, now) ? 'MMM d' : 'MMM d, yyyy');
  if (isSameDay(date, now)) return `Today, ${base}`;
  if (isSameDay(date, addDays(now, -1))) return `Yesterday, ${base}`;
  return `${format(date, 'EEE')}, ${base}`;
}

/**
 * Both times of a finished workout in one short card: the day as a ‹ › stepper
 * for whichever time is selected, the two times side by side with the length
 * between them, and one wheel for the selected one. Replaces a month grid for
 * a pair of times that are almost always the same day.
 *
 * - **Edits are staged and written together on Done**, so moving the start
 *   past the old finish and then the finish after it never trips the order
 *   rule halfway. A card holding staged edits asks before a tap outside throws
 *   them away (`confirmDiscard`).
 * - **Done is withheld, with the reason under the length, while the pair can't
 *   be saved** (`workoutTimesProblem`), rather than refusing in an alert after
 *   the card has closed.
 * - **The wheel is mounted once the card is on screen** (`onShow`), like
 *   `CalendarPicker`'s: a native picker mounting mid-scale glitches.
 */
export function WorkoutTimesSheet({ visible, start, end, initial, healthLimited, onConfirm, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const [which, setWhich] = useState<TimeEnd>(initial);
  const [wheelReady, setWheelReady] = useState(false);

  useEffect(() => {
    if (visible) {
      setDraftStart(start);
      setDraftEnd(end);
      setWhich(initial);
    } else {
      setWheelReady(false);
    }
    // Seeded on open only: a workout changed elsewhere mid-edit shouldn't move the wheel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const now = new Date();
  const active = which === 'start' ? draftStart : draftEnd;
  const setActive = (next: Date) => (which === 'start' ? setDraftStart(next) : setDraftEnd(next));
  const problem = workoutTimesProblem(draftStart, draftEnd, { now, healthLimited });
  const dirty = !sameMinute(draftStart, start) || !sameMinute(draftEnd, end);
  const minutes = spanMinutes(draftStart, draftEnd);

  const handleCancel = (close: (after?: () => void) => void) => {
    if (!dirty) { close(); return; }
    confirmDiscard(() => close());
  };

  const stepDay = (days: number) => {
    haptics.tap();
    setActive(shiftDays(active, days));
  };

  const tile = (end_: TimeEnd, label: string, date: Date) => {
    const on = which === end_;
    // A time on another day than the start says so, since the stepper only names the selected one's.
    const otherDay = !isSameDay(date, draftStart);
    return (
      <TouchableOpacity
        style={[styles.tile, on && styles.tileOn]}
        onPress={() => { if (!on) { haptics.tap(); setWhich(end_); } }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatTimeOfDay(date)}${otherDay ? `, ${format(date, 'MMM d')}` : ''}`}
        accessibilityState={{ selected: on }}
      >
        <Text style={styles.tileLabel}>{label}</Text>
        <Text style={styles.tileTime} numberOfLines={1} adjustsFontSizeToFit>{formatTimeOfDay(date)}</Text>
        {otherDay && <Text style={styles.tileDay}>{format(date, 'MMM d')}</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <CardSheet
      visible={visible}
      onClose={onClose}
      onRequestClose={handleCancel}
      onShow={() => setWheelReady(true)}
      name="WorkoutTimesSheet"
      cardStyle={styles.card}
    >
      {close => (
        <>
          <View style={styles.header}>
            <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => handleCancel(close)} minWidth={64} />
            <Text style={styles.title}>Workout times</Text>
            <View style={styles.headerEnd}>
              <SheetHeaderButton
                label={BUTTON_LABEL.done}
                onPress={() => close(() => onConfirm(draftStart, draftEnd))}
                disabled={problem !== null}
                minWidth={64}
              />
            </View>
          </View>

          <View style={styles.day}>
            <TouchableOpacity
              onPress={() => stepDay(-1)}
              hitSlop={8}
              style={styles.dayButton}
              accessibilityRole="button"
              accessibilityLabel="Previous day"
            >
              <Ionicons name="chevron-back" size={18} color={colors.accentText} />
            </TouchableOpacity>
            <Text style={styles.dayText} accessibilityLiveRegion="polite">{dayName(active, now)}</Text>
            <TouchableOpacity
              onPress={() => stepDay(1)}
              hitSlop={8}
              style={styles.dayButton}
              accessibilityRole="button"
              accessibilityLabel="Next day"
            >
              <Ionicons name="chevron-forward" size={18} color={colors.accentText} />
            </TouchableOpacity>
          </View>

          <View style={styles.tiles}>
            {tile('start', 'Started', draftStart)}
            {tile('end', 'Finished', draftEnd)}
          </View>

          <Text style={[styles.length, problem !== null && styles.problem]} accessibilityLiveRegion="polite">
            {problem ?? describeEventLength(minutes)}
          </Text>

          <View style={styles.wheel}>
            {wheelReady && (
              <DateTimePicker
                value={active}
                mode="time"
                display="spinner"
                onChange={(_e, d) => { if (d) setActive(withClock(active, d)); }}
                themeVariant={isDark ? 'dark' : 'light'}
                style={styles.wheelWidget}
              />
            )}
          </View>
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
  day: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgTertiary, borderRadius: radius.md, paddingHorizontal: spacing.xs, minHeight: 44,
  },
  dayButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dayText: { color: colors.text, fontSize: font.md },
  tiles: { flexDirection: 'row', gap: spacing.smd, marginTop: spacing.smd },
  tile: {
    flex: 1, backgroundColor: colors.bgTertiary, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent',
    paddingHorizontal: spacing.smd, paddingVertical: spacing.sm,
  },
  tileOn: { borderColor: colors.accent },
  tileLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  tileTime: { color: colors.text, fontSize: font.xl, marginTop: spacing.xxs, fontVariant: ['tabular-nums'] },
  tileDay: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  length: { color: colors.textSecondary, fontSize: font.sm, textAlign: 'center', marginTop: spacing.smd },
  problem: { color: colors.redText },
  wheel: { marginTop: spacing.xs, minHeight: 150, justifyContent: 'center' },
  wheelWidget: { height: 150 },
});
