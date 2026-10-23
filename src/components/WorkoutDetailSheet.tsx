import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import { isSameYear } from 'date-fns/isSameYear';
import { SheetModal } from './SheetModal';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CountStepper } from './CountStepper';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { WorkoutTimesSheet, type TimeEnd } from './WorkoutTimesSheet';
import { WorkoutRecordsCard } from './WorkoutRecordsCard';
import { WorkoutStatTiles } from './WorkoutStatTiles';
import { WorkoutHeartRateCard } from './WorkoutHeartRateCard';
import { ExerciseDetailSheet } from './ExerciseDetailSheet';
import type { WorkoutSet } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGymStore } from '../store/useGymStore';
import { useDemoStore } from '../store/useDemoStore';
import { useTaskStore } from '../store/useTaskStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useWorkoutHeartRate } from '../hooks/useWorkoutHeartRate';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useTextScale } from '../hooks/useTextScale';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { disclosureValue } from '../theme/textStyles';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { formatTimeOfDay } from '../utils/dateUtils';
import { catalogExercise } from '../utils/exerciseCatalog';
import { liftVolumeKg, sessionRecordSummary } from '../utils/workoutRecords';
import { routineItemsFromSets } from '../utils/workoutRoutine';
import { startWorkout } from '../utils/startWorkout';
import { formatSetLine, sessionExercises, sessionMinutes, setBadge, setLabels, setName } from '../utils/workoutSession';
import { sameMinute } from '../utils/workoutTimes';
import { WORKOUT_EFFORT } from '../utils/workoutData';
import { workoutSpanWritable } from '../utils/healthWorkoutSync';
import { resolveMaxHeartRate } from '../utils/heartRateZones';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** Kept by the host through the close, so the page doesn't empty while it slides away. */
  sessionId: string;
  onClose: () => void;
}

const NO_SETS: WorkoutSet[] = [];

/** "Tue, Oct 14", with the year once it isn't this one. */
function dayLabel(date: Date): string {
  return format(date, isSameYear(date, new Date()) ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
}

/** "6:12 PM", or "Oct 15, 12:40 AM" for a time on another day than `day`. */
function timeLabel(date: Date, day: Date): string {
  return isSameDay(date, day) ? formatTimeOfDay(date) : `${format(date, 'MMM d')}, ${formatTimeOfDay(date)}`;
}

/**
 * One finished workout: how long it was, its times, the records it set, every
 * set logged, how it went, and the way to delete it. Opened from a workout in
 * the History view of the Workouts screen, and built to the mock approved for it.
 *
 * - **Every edit commits as it is made**, through `updateSession`: effort on
 *   each step, notes on blur and on close, a time on the picker's Done, the
 *   name on the title's prompt Save. So
 *   nothing is staged and there is no discard guard (CLAUDE.md's "commit
 *   immediately" answer), and a swipe down commits the notes the way Done
 *   does, since both are `close`.
 * - **The sets are read-only.** What was lifted is corrected over MCP or not
 *   at all for now; a planned set never ticked has no place in the record, so
 *   only done sets are listed (a finished session rarely has any other).
 * - **Health is the store's business.** Changing a time rewrites the workout
 *   in Health while writing is on (`updateSession`), and deleting retracts it
 *   (`deleteSession`); this page only says so, and only when it is true. For a
 *   workout the Apple Watch measured, the line under the times also says the
 *   rewrite loses its heart rate and energy, before the change rather than after.
 * - **Heart rate is read back, shown, and never interpreted** (phase 9): the
 *   card shows only when Health returns heart rate for a workout the watch
 *   measured (`useWorkoutHeartRate`), with the zones of a maximum the person
 *   typed or 220 minus their age, labeled as the estimate it is.
 * - **A workout that goes away while the page is open closes it**: deleted on
 *   another device, over MCP, or here. The last copy is drawn while it slides
 *   away (`useSheetSubject`), never a half-empty page.
 *
 * A page sheet, since nothing on it is dragged. The time picker is raised from
 * inside this sheet's Modal: a sibling sheet would never appear.
 */
export function WorkoutDetailSheet({ visible, sessionId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const textScale = useTextScale();
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  // ==== the workout, held through the close ====
  const current = useWorkoutStore(s => s.sessions.find(x => x.id === sessionId) ?? null);
  const session = useSheetSubject(current);
  const cachedSets = useWorkoutStore(s => s.setsBySession[sessionId]);
  // Keyed by session, so a page opened on another workout never draws the
  // last one's sets for the frame before its own load.
  const heldSets = useSheetSubject(cachedSets ? { id: sessionId, sets: cachedSets } : null);
  const sets = heldSets && heldSets.id === session?.id ? heldSets.sets : NO_SETS;
  const exerciseRows = useWorkoutStore(s => s.exercises);
  const sessions = useWorkoutStore(s => s.sessions);
  const unit = useSettingsStore(s => s.workoutUnit);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  // `workoutHealthWriteOn`, read reactively, and never in demo mode: the
  // condition `updateSession` rewrites a moved workout under.
  const healthWriteOn = useSettingsStore(s => s.healthWriteEnabled && s.workoutHealthWrite && s.workoutsEnabled);
  const demoActive = useDemoStore(s => s.active);
  const inHealth = session?.healthWorkoutId != null;
  // Measured on the watch, finished, and still waiting for the watch's copy
  // (the pending flag; a save made with the watch locked, which has no id
  // either, carries no flag). A retime now still reaches Health: the copy
  // arrives at the old times and the phone writes the new ones in its place
  // (`recordWatchHealthWorkout`), so the same line and the same one-day limit apply.
  const awaitingWatch = !inHealth && session?.measuredOnWatch === true && session.healthWritePending;
  const timesReachHealth = (inHealth || awaitingWatch) && healthWriteOn && !demoActive;
  // The watch's own workout, with what it measured: a retime rewrites it as
  // the phone's, which carries neither.
  const measuredOnWatch = (inHealth || awaitingWatch) && session?.measuredOnWatch === true;

  // ==== heart rate, read back from Health (phase 9) ====
  const heartRate = useWorkoutHeartRate(session, visible);
  const typedMaxHeartRate = useSettingsStore(s => s.maxHeartRate);
  const birthYear = useSettingsStore(s => s.bodyProfile.birthYear);

  // The host loads the sets as it opens the page; a sync or a restore drops
  // the cache, so they are read again here. Never for a workout that's gone,
  // which would cache an empty list for it.
  useEffect(() => {
    if (visible && current && !cachedSets) useWorkoutStore.getState().loadSets(current.id);
  }, [visible, current, cachedSets]);

  // Gone while open: deleted here, on another device or over MCP.
  useEffect(() => {
    if (visible && !current) onClose();
  }, [visible, current, onClose]);

  // ==== what the page shows ====
  // Done sets only: a plan nobody carried out records nothing.
  const exercises = useMemo(
    () => sessionExercises(sets.filter(s => s.completedAt !== null)),
    [sets],
  );
  const records = useMemo(() => {
    if (!session) return [];
    return sessionRecordSummary(
      session.id,
      exercises.map(e => e.exerciseId),
      id => catalogExercise(exerciseRows, id)?.kind ?? 'weight_reps',
      id => useWorkoutStore.getState().exerciseHistory(id),
      sessions,
      dayResetTime,
    );
    // `sets`: a set corrected over MCP changes what the records are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, exercises, exerciseRows, sessions, dayResetTime, sets]);

  // ==== how it went: effort and notes, committed as they change ====
  const [notes, setNotes] = useState('');
  // Which time the picker is choosing; declared here so the open effect below can put it away.
  const [picking, setPicking] = useState<TimeEnd | null>(null);
  // The exercise page a row opened; put away with the picker below.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // The saved text the field last took in. A close writes the field back only
  // when it differs from this, so a page left untouched never writes the text
  // it opened with over notes an agent or another device changed meanwhile.
  const notesBaseline = useRef('');
  useEffect(() => {
    // On open only, and when another workout is opened. A picker left open
    // when the page last closed under it (the workout deleted elsewhere) is
    // put away here too, or it would rise over the next workout's page.
    if (visible) {
      notesBaseline.current = current?.notes ?? '';
      setNotes(notesBaseline.current);
    }
    setPicking(null);
    setDetailOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sessionId]);
  // Notes changed elsewhere while the page is open reach an untouched field.
  const savedNotes = current?.notes;
  useEffect(() => {
    if (savedNotes === undefined || savedNotes === notesBaseline.current) return;
    setNotes(prev => (prev === notesBaseline.current ? savedNotes : prev));
    notesBaseline.current = savedNotes;
  }, [savedNotes]);

  const commitNotes = () => {
    if (!current || notes === notesBaseline.current) return;
    notesBaseline.current = notes;
    useWorkoutStore.getState().updateSession(current.id, { notes });
  };

  const close = () => {
    commitNotes();
    onClose();
  };

  const changeEffort = (effort: number | null) => {
    // 'notFound' is the only refusal for an effort, and the effect above
    // closes the page when the workout has gone.
    if (current) useWorkoutStore.getState().updateSession(current.id, { effort });
  };

  // ==== the name ====
  const renameWorkout = () => {
    if (!current) return;
    haptics.tap();
    Alert.prompt(
      'Workout name',
      undefined,
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: BUTTON_LABEL.save,
          onPress: (text?: string) => {
            const name = (text ?? '').trim();
            if (name === current.title) return;
            const result = useWorkoutStore.getState().updateSession(current.id, { title: name });
            if (result === 'blank') {
              haptics.warning();
              Alert.alert('Couldn’t rename the workout', 'Give it a name and try again.');
              return;
            }
            if (typeof result !== 'string') haptics.success();
          },
        },
      ],
      'plain-text',
      current.title,
    );
  };

  // ==== the times ====
  /**
   * Both times from the card, written in one patch. The card withholds Done
   * while the pair can't be saved (`workoutTimesProblem`), so what arrives is
   * valid; the store's own order check stays the backstop.
   */
  const confirmTimes = (nextStart: Date, nextEnd: Date) => {
    if (!current || current.endedAt === null) return;
    // The picker works in whole minutes, so a minute already there, picked
    // again, is no change: writing it would drop the seconds, move the
    // workout and rewrite it in Health for nothing.
    const patch: { startedAt?: string; endedAt?: string } = {};
    if (!sameMinute(nextStart, new Date(current.startedAt))) patch.startedAt = nextStart.toISOString();
    if (!sameMinute(nextEnd, new Date(current.endedAt))) patch.endedAt = nextEnd.toISOString();
    if (!patch.startedAt && !patch.endedAt) return;
    const result = useWorkoutStore.getState().updateSession(current.id, patch);
    if (result === 'order') {
      haptics.warning();
      Alert.alert('Couldn’t change the times', 'A workout has to finish after it starts.');
      return;
    }
    // Otherwise saved, or 'notFound' (the only other refusal for a patch with
    // no title): the workout has gone, and the effect above closes the page.
    if (typeof result !== 'string') haptics.success();
  };

  // ==== saving as a routine ====
  // What the routine would hold, from the done sets. Empty (no row offered)
  // when the workout has no working set to build on.
  const routineItems = useMemo(() => routineItemsFromSets(sets), [sets]);

  const saveAsRoutine = () => {
    if (!current || routineItems.length === 0) return;
    Alert.prompt(
      'Save as routine',
      'Warm-up sets are left out. The weights and reps are the ones from this workout.',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: BUTTON_LABEL.save,
          onPress: (text?: string) => {
            const result = useWorkoutStore.getState().addRoutine((text ?? '').trim(), routineItems);
            if (typeof result === 'string') {
              haptics.warning();
              Alert.alert('Couldn’t save the routine', 'Give it a name and try again.');
              return;
            }
            haptics.success();
            Alert.alert('Saved as a routine', `“${result.name}” is in the Routines tab.`);
          },
        },
      ],
      'plain-text',
      current.title,
    );
  };

  // ==== doing it again ====
  // Its routine when it still has one, so the numbers come from the routine
  // and last time the way any start does; otherwise the sets it did, laid out
  // again. Not offered while another workout is going, which a start would
  // only refuse.
  const routineLive = useWorkoutStore(s => !!session?.routineId && s.routines.some(r => r.id === session.routineId));
  const anotherLive = useWorkoutStore(s => s.sessions.some(x => x.endedAt === null));
  const canRepeat = !anotherLive && session?.endedAt != null && (routineLive || sets.some(s => s.completedAt !== null));

  const doAgain = () => {
    if (!current) return;
    const input = routineLive && current.routineId
      ? { routineId: current.routineId }
      : { repeat: { title: current.title, sets } };
    // Closed in the same commit the workout opens, which SheetModal orders.
    onClose();
    startWorkout(input);
  };

  // ==== deleting ====
  const remove = () => {
    if (!current) return;
    const { id, healthWorkoutId, taskId, measuredOnWatch: fromWatch } = current;
    // `deleteSession` never touches a task, so a task the workout completed
    // stays done. Said only when it is done: a target the workout logged one
    // unit on is still open, and "checked off" would be untrue of it.
    const task = taskId ? useTaskStore.getState().tasks.find(t => t.id === taskId) ?? null : null;
    confirmDelete({
      title: 'Delete this workout?',
      message: [
        'Its sets are deleted with it.',
        // The watch retracts what it saved (the phone may not), so it is the
        // one that takes it out, the next time it hears from this phone.
        healthWorkoutId
          ? (fromWatch ? 'Your Apple Watch, which saved it, also removes it from Apple Health.' : 'It’s also removed from Apple Health.')
          : null,
        task?.completed ? 'The task it completed stays checked off.' : null,
      ].filter(Boolean).join(' '),
      onConfirm: () => {
        useWorkoutStore.getState().deleteSession(id);
        haptics.success();
        onClose();
      },
    });
  };

  // ==== render ====
  const gymName = useGymStore(s => (session?.gymId ? s.gyms.find(g => g.id === session.gymId)?.name ?? null : null));
  const startedAt = session ? new Date(session.startedAt) : null;
  const endedAt = session?.endedAt ? new Date(session.endedAt) : null;
  const minutes = session ? sessionMinutes(session) : 0;
  // Every set row the session has, as the History row counts it (`setCounts`
  // is this array's length, written together with it), so the two agree.
  const setCount = sets.length;
  const labelWidth = Math.round(22 * textScale);

  const timeRow = (which: TimeEnd, label: string, date: Date) => {
    const value = timeLabel(date, startedAt!);
    return (
      <TouchableOpacity
        style={[styles.kv, which === 'end' && styles.rowSep]}
        onPress={() => { haptics.tap(); setPicking(which); }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityHint="Changes the time"
      >
        <Text style={styles.kvLabel}>{label}</Text>
        <View style={styles.valueRow}>
          <Text style={styles.value} numberOfLines={1}>{value}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close} name="WorkoutDetailSheet">
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerSide} />
            <View style={styles.headerTitle}>
              <TouchableOpacity
                onPress={renameWorkout}
                disabled={!current}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Workout name: ${session?.title ?? 'Workout'}`}
                accessibilityHint="Changes the name"
              >
                <Text style={styles.title} numberOfLines={2}>
                  {session?.title ?? 'Workout'}
                  {'  '}
                  <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
                </Text>
              </TouchableOpacity>
              {!!startedAt && <Text style={styles.subtitle}>{gymName ? `${dayLabel(startedAt)} · ${gymName}` : dayLabel(startedAt)}</Text>}
            </View>
            <SheetHeaderButton label={BUTTON_LABEL.done} onPress={close} minWidth={64} />
          </View>
          {inHealth && (
            <View style={styles.pillRow}>
              <Text style={styles.pill}>In Apple Health</Text>
            </View>
          )}
        </View>

        {session && startedAt && (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            {...keyboardScroll.props}
            ref={keyboardScroll.ref}
          >
            <WorkoutStatTiles
              minutes={minutes}
              exercises={exercises.length}
              sets={setCount}
              volumeKg={liftVolumeKg(sets, id => catalogExercise(exerciseRows, id)?.kind ?? 'weight_reps')}
              unit={unit}
            />

            {heartRate && (
              <>
                <Text style={styles.groupLabel}>Heart rate</Text>
                <WorkoutHeartRateCard
                  read={heartRate}
                  max={resolveMaxHeartRate(typedMaxHeartRate, birthYear, new Date())}
                />
              </>
            )}

            {endedAt && (
              <>
                <Text style={styles.groupLabel}>Times</Text>
                <View style={styles.card}>
                  {timeRow('start', 'Started', startedAt)}
                  {timeRow('end', 'Finished', endedAt)}
                </View>
                {timesReachHealth && (
                  <Text style={styles.hint}>
                    {measuredOnWatch
                      ? 'Changing the times also changes the workout in Apple Health, and it loses its heart rate and energy.'
                      : 'Changing the times also changes the workout in Apple Health.'}
                  </Text>
                )}
              </>
            )}

            {records.length > 0 && (
              <>
                <Text style={styles.groupLabel}>Personal records</Text>
                <WorkoutRecordsCard records={records} exercises={exerciseRows} unit={unit} />
              </>
            )}

            {exercises.length > 0 && (
              <>
                <Text style={styles.groupLabel}>Exercises</Text>
                <View style={styles.card}>
                  {exercises.map((e, i) => {
                    const info = catalogExercise(exerciseRows, e.exerciseId);
                    const kind = info?.kind ?? 'weight_reps';
                    const labels = setLabels(e.sets);
                    return (
                      <View key={e.exerciseId} style={[styles.exercise, i > 0 && styles.rowSep]}>
                        {info ? (
                          <TouchableOpacity
                            style={styles.exerciseHeader}
                            onPress={() => { haptics.tap(); setDetailId(e.exerciseId); setDetailOpen(true); }}
                            activeOpacity={interaction.activeOpacity}
                            accessibilityRole="button"
                            accessibilityLabel={info.name}
                            accessibilityHint="Opens this exercise’s page"
                          >
                            <Text style={styles.exerciseName}>{info.name}</Text>
                            <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                          </TouchableOpacity>
                        ) : (
                          <Text style={styles.exerciseName}>Unknown exercise</Text>
                        )}
                        <View style={styles.sets}>
                          {e.sets.map(set => {
                            const label = labels.get(set.id) ?? '';
                            const line = formatSetLine(set, kind, unit, true) ?? '–';
                            const lettered = setBadge(set.kind) !== null;
                            return (
                              <View
                                key={set.id}
                                style={styles.setLine}
                                accessible
                                accessibilityLabel={`${setName(set.kind, label)}, ${line}${set.note ? `. ${set.note}` : ''}`}
                              >
                                <Text style={[styles.setLabel, { minWidth: labelWidth }, lettered && styles.setBadge]}>{label}</Text>
                                <View style={styles.setBody}>
                                  <Text style={styles.setValue}>{line}</Text>
                                  {!!set.note && <Text style={styles.setNote}>{set.note}</Text>}
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.groupLabel}>How it went</Text>
            <View style={styles.card}>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Effort</Text>
                <CountStepper
                  value={session.effort}
                  onChange={changeEffort}
                  min={WORKOUT_EFFORT.min}
                  max={WORKOUT_EFFORT.max}
                  start={WORKOUT_EFFORT.start}
                  allowNull
                  emptyLabel="Not set"
                  label="Effort"
                  describeValue={n => (n === null ? 'not set' : `${n} out of ${WORKOUT_EFFORT.max}`)}
                />
              </View>
              <TextField
                style={[styles.notesInput, styles.rowSep]}
                value={notes}
                onChangeText={setNotes}
                onBlur={commitNotes}
                placeholder="e.g. Shoulder felt fine on the last set"
                placeholderTextColor={colors.textTertiary}
                multiline
                accessibilityLabel="Notes on this workout"
              />
            </View>

            {canRepeat && (
              <TouchableOpacity
                style={styles.actionRow}
                onPress={doAgain}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityHint={routineLive ? 'Starts this routine again' : 'Starts a new workout with these exercises and sets'}
              >
                <Text style={styles.actionText}>Do this again</Text>
              </TouchableOpacity>
            )}

            {routineItems.length > 0 && (
              <TouchableOpacity
                style={[styles.actionRow, canRepeat && styles.actionRowNext]}
                onPress={saveAsRoutine}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityHint="Makes a routine from this workout’s exercises and sets"
              >
                <Text style={styles.actionText}>Save as routine</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.deleteRow}
              onPress={remove}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
            >
              <Text style={styles.deleteText}>Delete workout</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
      {/* Inside this Modal, not beside it: a second sheet presented from the
          same view controller as this one never appears. */}
      <WorkoutTimesSheet
        visible={visible && picking !== null && !!startedAt && !!endedAt}
        start={startedAt ?? new Date(0)}
        end={endedAt ?? new Date(0)}
        initial={picking ?? 'start'}
        healthLimited={timesReachHealth}
        onConfirm={confirmTimes}
        onClose={() => setPicking(null)}
      />
      <ExerciseDetailSheet visible={visible && detailOpen} exerciseId={detailId} onClose={() => setDetailOpen(false)} />
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.smd },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  headerSide: { minWidth: 64 },
  headerTitle: { flex: 1, alignItems: 'center' },
  title: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold, textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  pillRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.sm },
  pill: {
    color: colors.textSecondary, fontSize: font.xs, backgroundColor: colors.bgTertiary, borderRadius: radius.full,
    overflow: 'hidden', paddingHorizontal: spacing.smd, paddingVertical: spacing.xxs,
  },
  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xl },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  kv: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 48,
  },
  kvLabel: { color: colors.text, fontSize: font.md },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  value: { ...disclosureValue(colors), flexShrink: 1, fontVariant: ['tabular-nums'] },
  hint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  exercise: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  exerciseName: { color: colors.text, fontSize: font.md, flexShrink: 1 },
  sets: { marginTop: spacing.xs, gap: spacing.xxs },
  setLine: { flexDirection: 'row', alignItems: 'baseline' },
  setLabel: { color: colors.textSecondary, fontSize: font.sm, fontVariant: ['tabular-nums'] },
  setBadge: { color: colors.orangeText, fontWeight: fontWeight.bold },
  setBody: { flex: 1 },
  setValue: { color: colors.textSecondary, fontSize: font.sm, fontVariant: ['tabular-nums'] },
  setNote: { color: colors.text, fontSize: font.sm, marginTop: spacing.xxs, marginBottom: spacing.xs },
  notesInput: { color: colors.text, fontSize: font.md, paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.md, minHeight: 64 },
  actionRow: {
    alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: spacing.lg,
    paddingVertical: spacing.smd, backgroundColor: colors.bgSecondary, borderRadius: radius.md,
  },
  // A second action under the first sits with it rather than a section away.
  actionRowNext: { marginTop: spacing.sm },
  actionText: { color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold },
  deleteRow: {
    alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: spacing.md,
    paddingVertical: spacing.smd, backgroundColor: colors.bgSecondary, borderRadius: radius.md,
  },
  deleteText: { color: colors.redText, fontSize: font.md, fontWeight: fontWeight.semibold },
});
