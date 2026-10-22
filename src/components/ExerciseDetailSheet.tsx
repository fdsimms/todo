import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { ExerciseProgressChart, type ExerciseChartPoint } from './ExerciseProgressChart';
import { ExerciseEditorSheet } from './ExerciseEditorSheet';
import { GymExerciseSheet, type GymExerciseSubject } from './GymExerciseSheet';
import { PillGroup } from './PillGroup';
import { useGymStore } from '../store/useGymStore';
import { describeGymSetting, gymSettingFor, gymsUsedBy, setsAtGym } from '../utils/gyms';
import { ExercisePhotos } from './ExercisePhotos';
import { RecordBadge } from './RecordBadge';
import { haptics } from '../utils/haptics';
import { chartPoints as toChartPoints, chartSegments } from '../utils/exerciseChart';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { BUTTON_LABEL } from '../copy/shared';
import { getLogicalDayKey } from '../utils/dateUtils';
import { catalogExercise, describeExercise } from '../utils/exerciseCatalog';
import {
  analyzeExercise, countsForRecords, isNewRecordRow, metricsFor, recordSessions, type RecordMetric,
} from '../utils/workoutRecords';
import {
  formatAxisValue, formatMetricPoint, formatRecordValue, metricCaption, metricLabel, metricNote, metricNumber,
  recordLabel,
} from '../utils/workoutRecordText';
import { formatSetLine, setLabels, setName } from '../utils/workoutSession';
import { weightScale } from '../utils/dumbbellLoad';
import type { WorkoutSet } from '../types';

/**
 * One exercise: how it has gone over time, the personal records, and every
 * session that did it. Built to docs/arch/workouts-mocks/exercise-detail.png.
 *
 * **A sheet, not a pushed screen.** It is opened from the Workouts exercise
 * list and from the exercise's name in workout mode, and workout mode is a
 * full-screen modal: a route pushed under it would be behind it. A sheet nests
 * inside that modal the way the exercise picker does, and closing it leaves the
 * workout exactly where it was.
 *
 * Everything on it is derived from the sets each time (`analyzeExercise`):
 * nothing about a record is stored, so deleting a session moves the records.
 * Nothing is relative to a body weight, and the estimated 1RM says
 * "estimated" wherever it shows (docs/arch/workouts.md).
 *
 * **Full screen, not a page sheet.** The chart is scrubbed by dragging a
 * finger across it, and a page sheet's pull-down pan makes RN's modal touch
 * handler cancel a JS touch in flight (CLAUDE.md, "A drag cannot live inside a
 * pageSheet"). With no swipe-down to dismiss it, the Done button is the way
 * out, and nothing on it is staged, so `onRequestClose` is the plain close.
 *
 * Its Edit opens `ExerciseEditorSheet`, rendered inside this sheet's Modal
 * (a sibling sheet would never appear), so editing from inside workout mode
 * comes back to the exercise page and then to the workout.
 */

interface Props {
  visible: boolean;
  /** Kept by the host through the close, so the sheet doesn't retitle itself while it slides away. */
  exerciseId: string | null;
  onClose: () => void;
}

const HISTORY_STEP = 10;

/** "Oct 14", with the year once it isn't this one. */
function shortDate(dayKey: string, todayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00`);
  return format(date, dayKey.slice(0, 4) === todayKey.slice(0, 4) ? 'MMM d' : 'MMM d, yyyy');
}

export function ExerciseDetailSheet({ visible, exerciseId, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const exercises = useWorkoutStore(s => s.exercises);
  const sessions = useWorkoutStore(s => s.sessions);
  const gyms = useGymStore(s => s.gyms);
  const gymSettings = useGymStore(s => s.settings);
  const unit = useSettingsStore(s => s.workoutUnit);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const dumbbellEntry = useSettingsStore(s => s.dumbbellEntry);

  const info = exerciseId ? catalogExercise(exercises, exerciseId) : null;
  // A pair total reads every stored one-dumbbell weight doubled (`dumbbellLoad.ts`).
  const scale = weightScale(info, dumbbellEntry);
  const kind = info?.kind ?? 'weight_reps';
  const metrics = metricsFor(kind);
  const [chosen, setChosen] = useState<RecordMetric>('e1rm');
  const metric = metrics.includes(chosen) ? chosen : metrics[0];
  const [shown, setShown] = useState(HISTORY_STEP);
  const [editing, setEditing] = useState(false);
  // A gym the history and records are narrowed to, or null for all of them.
  const [gymFilter, setGymFilter] = useState<string | null>(null);
  const [gymEdit, setGymEdit] = useState<GymExerciseSubject | null>(null);
  const [gymEditOpen, setGymEditOpen] = useState(false);

  useEffect(() => {
    if (visible) { setChosen(metricsFor(kind)[0]); setShown(HISTORY_STEP); setEditing(false); setGymFilter(null); setGymEditOpen(false); }
    // On open only: the kind is the opened exercise's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, exerciseId]);

  const todayKey = useMemo(() => getLogicalDayKey(new Date(), dayResetTime), [dayResetTime, visible]);
  const allSets = useMemo(
    // Not gated on `visible`: the host keeps `exerciseId` through the close, and an
    // empty array while the sheet slides away would flash "No history yet".
    // `visible` is only a dependency, so each open re-reads the history.
    // `sessions`: a session finished or deleted elsewhere changes what the history holds.
    () => (exerciseId ? useWorkoutStore.getState().exerciseHistory(exerciseId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, exerciseId, sessions],
  );
  // Narrowed to one gym when the person picks one: records then mean "at this
  // gym", worked out by the same rules over only those sets, so a first time
  // there sets no record, as a first time anywhere doesn't.
  const sets = useMemo(() => setsAtGym(allSets, sessions, gymFilter), [allSets, sessions, gymFilter]);
  const usedGyms = useMemo(() => gymsUsedBy(allSets, sessions, gyms), [allSets, sessions, gyms]);
  // Worth offering once the sets aren't all from one place: two gyms, or one gym and some elsewhere.
  const filterable = usedGyms.length >= 2
    || (usedGyms.length === 1 && setsAtGym(allSets, sessions, usedGyms[0].id).length < allSets.length);
  const recSessions = useMemo(() => recordSessions(sessions, dayResetTime), [sessions, dayResetTime]);
  const analysis = useMemo(
    () => (exerciseId ? analyzeExercise(exerciseId, kind, sets, recSessions) : null),
    [exerciseId, kind, sets, recSessions],
  );

  const titleOf = useMemo(() => new Map(sessions.map(s => [s.id, s.title])), [sessions]);
  const setsBySession = useMemo(() => {
    const out = new Map<string, WorkoutSet[]>();
    for (const s of sets) {
      if (!countsForRecords(s)) continue;
      if (!out.has(s.sessionId)) out.set(s.sessionId, []);
      out.get(s.sessionId)!.push(s);
    }
    return out;
  }, [sets]);
  // Every set done, warm-ups included, for the notes: a note written on a
  // warm-up is as much the person's as one on a working set.
  const doneBySession = useMemo(() => {
    const out = new Map<string, WorkoutSet[]>();
    for (const s of sets) {
      if (s.completedAt === null) continue;
      if (!out.has(s.sessionId)) out.set(s.sessionId, []);
      out.get(s.sessionId)!.push(s);
    }
    // In the plan's order, which is how the workout page numbers them; the
    // query returns them in the order they were ticked.
    for (const list of out.values()) list.sort((a, b) => a.setIndex - b.setIndex);
    return out;
  }, [sets]);

  const options = useMemo<SegmentOption<RecordMetric>[]>(
    () => metrics.map(m => ({ value: m, label: metricLabel(m) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind],
  );

  const plotted = useMemo<ExerciseChartPoint[]>(() => {
    if (!analysis) return [];
    const out: ExerciseChartPoint[] = [];
    for (const p of analysis.points) {
      const value = metricNumber(p, metric, kind, unit, scale);
      const text = formatMetricPoint(p, metric, kind, unit, scale);
      if (value !== null && text !== null) out.push({ dayKey: p.dayKey, value, text });
    }
    return out;
  }, [analysis, metric, kind, unit, scale]);

  // The page scroll is off while a finger is scrubbing the chart.
  const [scrubbing, setScrubbing] = useState(false);

  const latest = analysis && plotted.length > 0 ? plotted[plotted.length - 1] : null;
  // The caption names a break only when the line has one.
  const hasGap = useMemo(() => chartSegments(toChartPoints(plotted)).length > 1, [plotted]);

  const name = info?.name ?? 'Exercise';
  const subtitle = info ? describeExercise(info) : '';
  const about = info ? info.notes || info.cue : null;
  const history = analysis ? [...analysis.points].reverse() : [];
  const noHistory = !analysis || analysis.points.length === 0;

  const nameBlock = (
    <View style={styles.nameBlock}>
      <Text style={styles.name}>{name}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {!!about && <Text style={styles.about}>{about}</Text>}
      {!!info && !!exerciseId && <ExercisePhotos exerciseId={exerciseId} name={name} />}
      {!!info && !!exerciseId && gyms.some(g => !g.archived) && (
        <View style={styles.gymBlock}>
          <Text style={styles.groupLabel}>At your gyms</Text>
          <View style={styles.gymCard}>
            {gyms.filter(g => !g.archived).map((g, i) => {
              const kept = describeGymSetting(gymSettingFor(gymSettings, g.id, exerciseId), unit);
              return (
                <TouchableOpacity
                  key={g.id}
                  style={[styles.gymRow, i > 0 && styles.rowSep]}
                  onPress={() => { haptics.tap(); setGymEdit({ gymId: g.id, exerciseId }); setGymEditOpen(true); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`${kept ? 'Edit' : 'Add'} what is kept for ${name} at ${g.name}`}
                >
                  <Text style={styles.gymName}>{g.name}</Text>
                  <Text style={[styles.gymValue, !kept && styles.gymValueEmpty]} numberOfLines={1}>{kept ?? 'Add a note'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
      {!!info && filterable && (
        <View style={styles.gymBlock}>
          <Text style={styles.groupLabel}>Show history from</Text>
          <PillGroup
            noun="gym"
            surface="page"
            limit={usedGyms.length + 1}
            options={[
              { key: 'all', label: 'All gyms', selected: gymFilter === null, onPress: () => { haptics.tap(); setGymFilter(null); setShown(HISTORY_STEP); }, pinned: true },
              ...usedGyms.map(g => ({
                key: g.id, label: g.name, selected: gymFilter === g.id,
                onPress: () => { haptics.tap(); setGymFilter(g.id); setShown(HISTORY_STEP); },
              })),
            ]}
          />
        </View>
      )}
    </View>
  );

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} name="ExerciseDetailSheet">
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SheetHeader
          title="Exercise"
          left={info ? (
            // In the header, not under the gym list: that list is a different
            // thing (per-gym notes), and a button below it read as editing it.
            <SheetHeaderButton
              label="Edit"
              role="cancel"
              onPress={() => { haptics.tap(); setEditing(true); }}
              accessibilityLabel={`Edit ${name}`}
              minWidth={64}
            />
          ) : <View style={styles.spacer} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={64} />}
        />
        {noHistory ? (
          <View style={styles.flex}>
            {nameBlock}
          </View>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} scrollEnabled={!scrubbing}>
            {nameBlock}
            <View style={styles.card}>
              <SegmentedControl options={options} value={metric} onChange={setChosen} label="Show" />
              {latest ? (
                <>
                  <View style={styles.headline}>
                    <Text style={styles.headlineValue}>{latest.text}</Text>
                    <Text style={styles.headlineCaption}>
                      {[metricCaption(metric), shortDate(latest.dayKey, todayKey)].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                  <HelpText style={styles.note}>{metricNote(metric, kind)}</HelpText>
                  <View style={styles.chart}>
                    <ExerciseProgressChart
                      points={plotted}
                      formatAxis={v => formatAxisValue(v, metric, kind)}
                      onScrubChange={setScrubbing}
                      summary={`${metricLabel(metric)} chart, ${plotted.length} ${plotted.length === 1 ? 'session' : 'sessions'}, latest ${latest.text}${metric === 'e1rm' ? ', estimated' : ''}`}
                    />
                  </View>
                  <HelpText style={styles.note}>
                    {hasGap ? 'A break in the line is a stretch with no sessions.' : 'Each dot is a session.'}
                  </HelpText>
                </>
              ) : (
                <Text style={styles.none}>
                  {metric === 'e1rm'
                    ? 'No set of 10 reps or fewer yet, so there is nothing to estimate from.'
                    : 'No working sets with this figure yet.'}
                </Text>
              )}
            </View>

            {analysis!.records.length > 0 && (
              <>
                <Text style={styles.groupLabel}>Personal records</Text>
                <View style={styles.card}>
                  {analysis!.records.map((r, i) => (
                    <View key={`${r.type}-${r.reps ?? 0}`} style={[styles.recordRow, i > 0 && styles.rowSep]}>
                      <View style={styles.recordLabelWrap}>
                        {isNewRecordRow(r, analysis!.events, todayKey) && <RecordBadge accessibilityLabel="New record" />}
                        <Text style={styles.recordLabel}>{recordLabel(r.type, kind, r.reps)}</Text>
                      </View>
                      <View style={styles.recordValueWrap}>
                        <Text style={styles.recordValue}>{formatRecordValue(r, kind, unit, scale)}</Text>
                        <Text style={styles.recordDate}>{shortDate(r.dayKey, todayKey)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.groupLabel}>History</Text>
            <View style={styles.card}>
              {history.slice(0, shown).map((p, i) => {
                const list = setsBySession.get(p.sessionId) ?? [];
                const line = list.map(s => formatSetLine(s, kind, unit, false, scale)).filter(Boolean).join(', ');
                // A set's note, filed under the set it was written on, so
                // "left shoulder twinged" outlives the workout it was said in.
                const done = doneBySession.get(p.sessionId) ?? [];
                const labels = setLabels(done);
                const notes = done.filter(s => !!s.note);
                return (
                  <View key={p.sessionId} style={[styles.historyRow, i > 0 && styles.rowSep]}>
                    <Text style={styles.historyTitle}>
                      {`${format(new Date(`${p.dayKey}T12:00:00`), 'EEE, MMM d')} · ${titleOf.get(p.sessionId) ?? 'Workout'}`}
                    </Text>
                    {!!line && <Text style={styles.historySets}>{line}</Text>}
                    {notes.map(s => (
                      <Text key={s.id} style={styles.historyNote}>
                        <Text style={styles.historyNoteSet}>{`${setName(s.kind, labels.get(s.id) ?? '')}: `}</Text>
                        {s.note}
                      </Text>
                    ))}
                  </View>
                );
              })}
            </View>
            {history.length > shown && (
              <View style={styles.more}>
                <InlineAction
                  label="Show older"
                  variant="neutral"
                  surface="page"
                  onPress={() => setShown(n => n + HISTORY_STEP)}
                  accessibilityLabel={`Show ${Math.min(HISTORY_STEP, history.length - shown)} older sessions`}
                />
              </View>
            )}
          </ScrollView>
        )}
        {noHistory && (
          // Laid over the whole sheet, header included, so the empty state
          // centers on the screen rather than in the space beneath the name
          // block. Touches pass through to the header and the Edit button.
          <View style={styles.emptyLayer} pointerEvents="box-none">
            <EmptyState
              icon="stats-chart-outline"
              title="No history yet"
              subtitle={gymFilter ? 'No sets logged at this gym yet. Choose All gyms to see the rest.' : "Sets you log for this exercise show up here, with a chart of how it’s going and your personal records."}
            />
          </View>
        )}
      </View>
      <ExerciseEditorSheet visible={visible && editing} exerciseId={exerciseId} onClose={() => setEditing(false)} />
      <GymExerciseSheet visible={visible && gymEditOpen} subject={gymEdit} onClose={() => setGymEditOpen(false)} />
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  emptyLayer: { ...StyleSheet.absoluteFill, justifyContent: 'center' },
  spacer: { minWidth: 64 },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  nameBlock: { paddingHorizontal: spacing.xs, paddingTop: spacing.xs, paddingBottom: spacing.xs, gap: spacing.xs },
  name: { color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold, letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontSize: font.sm },
  about: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs },
  gymBlock: { marginTop: spacing.xs },
  gymCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.sm },
  gymRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd,
    paddingHorizontal: spacing.md, minHeight: 52,
  },
  gymName: { color: colors.text, fontSize: font.md, flexShrink: 0 },
  gymValue: { color: colors.textSecondary, fontSize: font.sm, flex: 1, textAlign: 'right' },
  gymValueEmpty: { color: colors.textTertiary },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.md },
  headline: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md, marginHorizontal: spacing.md },
  headlineValue: { color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  headlineCaption: { color: colors.textSecondary, fontSize: font.sm },
  note: { color: colors.textTertiary, fontSize: font.xs, marginHorizontal: spacing.md, marginTop: spacing.xxs },
  none: { color: colors.textSecondary, fontSize: font.sm, margin: spacing.md },
  chart: { marginHorizontal: spacing.md, marginTop: spacing.smd, marginBottom: spacing.xs },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginHorizontal: spacing.xs,
  },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  recordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 56 },
  recordLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xsm },
  recordLabel: { color: colors.text, fontSize: font.md },
  recordValueWrap: { alignItems: 'flex-end', flexShrink: 0 },
  recordValue: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  recordDate: { color: colors.textSecondary, fontSize: font.xs },
  historyRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  historyTitle: { color: colors.text, fontSize: font.md },
  historySets: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs, fontVariant: ['tabular-nums'] },
  historyNote: { color: colors.text, fontSize: font.sm, marginTop: spacing.xs },
  historyNoteSet: { color: colors.textSecondary },
  more: { flexDirection: 'row', marginTop: spacing.smd },
});
