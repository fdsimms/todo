import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { format } from 'date-fns/format';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { InlineAction } from './InlineAction';
import { PressableScale } from './PressableScale';
import { Toggle } from './Toggle';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { PENDING_WORKOUT_WRITE_MAX_AGE_DAYS, describedWorkoutHealthOffer } from '../utils/healthWorkoutSync';
import { confirmDiscard } from '../utils/confirmDiscard';
import { catalogExercise } from '../utils/exerciseCatalog';
import { cleanWorkoutName, exerciseNameKey } from '../utils/workoutData';
import type { WeightUnit } from '../utils/weightLog';
import { DUMBBELL_ENTRY_LABELS, type DumbbellEntry } from '../utils/dumbbellLoad';
import {
  buildImportPlan,
  describeSkipped,
  distinctExerciseNames,
  guessEquipment,
  heldInTwoDumbbells,
  importSummary,
  inferExerciseKind,
  isAutoMatch,
  matchAll,
  parseWorkoutCsv,
  splitDuplicates,
  type ImportedSession,
  type CsvParseResult,
  type ExerciseNameUse,
  type NameResolution,
} from '../utils/workoutCsv';
import type { ExerciseInput } from '../store/useWorkoutStore';
import { BUTTON_LABEL } from '../copy/shared';
import { HelpText } from './HelpText';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The text of the file the person picked. Already known to parse (the screen checks first). */
  fileText?: string;
  /**
   * One workout the person described in words (`sessionFromDraft`), reviewed
   * here in place of a file: the same names to match, the same duplicate check,
   * the same single write. Wins over `fileText` when both are given.
   */
  described?: ImportedSession | null;
}

const NO_SKIPPED = { restTimers: 0, emptySets: 0, badDates: 0, noExercise: 0, looseNotes: 0 };

type Choice = 'match' | 'create' | 'skip';

const UNIT_OPTIONS = [
  { value: 'kg' as const, label: 'Kilograms, km' },
  { value: 'lb' as const, label: 'Pounds, miles' },
];

const DUMBBELL_OPTIONS = (['each', 'pair'] as const).map(value => ({ value, label: DUMBBELL_ENTRY_LABELS[value] }));

const CHOICE_OPTIONS = [
  { value: 'match' as const, label: 'Match' },
  { value: 'create' as const, label: 'Create' },
  { value: 'skip' as const, label: 'Skip' },
];

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Review before an import writes anything: what the file holds, and a decision
 * for every exercise name that isn't plainly one of the person's. See the
 * mock at docs/arch/workouts-mocks/csv-import-review.png and
 * docs/arch/workouts.md (phase 7).
 *
 * **Nothing is remembered.** What is staged here (a unit, a choice per name)
 * lives in this sheet and is written once, by Import. The names the app matched
 * on its own are listed too, with a way to change each, because a near match
 * is a guess and the person should see it before it becomes their history.
 *
 * It is a `pageSheet` holding staged choices, so a swipe-down and Cancel both
 * go through `handleCancel` (`confirmDiscard`). The exercise picker is rendered
 * inside this sheet's own Modal rather than beside it: two sibling sheets can't
 * both present (CLAUDE.md, "Two sibling Modals").
 */
export function WorkoutImportSheet({ visible, onClose, fileText = '', described = null }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const exercises = useWorkoutStore(s => s.exercises);
  const sessionsInLog = useWorkoutStore(s => s.sessions);
  const importSessions = useWorkoutStore(s => s.importSessions);
  const displayUnit = useSettingsStore(s => s.workoutUnit);
  const dumbbellSetting = useSettingsStore(s => s.dumbbellEntry);
  // An import never writes to Health (it came from another app, which most
  // likely wrote it there already), so the sheet says so while saving does.
  const writesToHealth = useSettingsStore(s => s.healthWriteEnabled && s.workoutHealthWrite);

  const [unit, setUnit] = useState<WeightUnit>(displayUnit);
  const [unitTouched, setUnitTouched] = useState(false);
  // How the file's dumbbell weights were typed; starts as the person types them in the app.
  const [dumbbellEntry, setDumbbellEntry] = useState<DumbbellEntry>(dumbbellSetting);
  const [dumbbellTouched, setDumbbellTouched] = useState(false);
  const [choices, setChoices] = useState<Record<string, NameResolution>>({});
  const [picking, setPicking] = useState<string | null>(null);
  // Only a described workout asks; on by default because the person turned on logging workouts to Health.
  const [toHealth, setToHealth] = useState(true);

  useEffect(() => {
    if (visible) {
      setUnit(displayUnit);
      setUnitTouched(false);
      setDumbbellEntry(dumbbellSetting);
      setDumbbellTouched(false);
      setChoices({});
      setPicking(null);
      setToHealth(true);
    }
    // Reset when the sheet opens on a file, not when the setting changes under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, fileText, described]);

  const parsed = useMemo((): CsvParseResult | null => {
    if (described) {
      return { ok: true, source: 'text', sessions: [described], unitAssumed: false, skippedRows: 0, skipped: NO_SKIPPED };
    }
    return fileText ? parseWorkoutCsv(fileText, { fallbackUnit: unit }) : null;
  }, [described, fileText, unit]);
  const ok = parsed && parsed.ok ? parsed : null;

  // Only the workouts the log doesn't have yet need their names decided.
  const split = useMemo(
    () => (ok ? splitDuplicates(ok.sessions, sessionsInLog) : { fresh: [], duplicates: 0 }),
    [ok, sessionsInLog],
  );
  const names = useMemo(() => distinctExerciseNames(split.fresh), [split.fresh]);
  const auto = useMemo(() => matchAll(names, exercises), [names, exercises]);

  // Only an exact name or the same words in another order is decided by the app.
  // A near match is a suggestion: it waits under "Needs a choice" for a tap.
  const autoResolution = (n: ExerciseNameUse): NameResolution | undefined => {
    const m = auto[n.key];
    return m && isAutoMatch(m) ? { kind: 'exercise', exerciseId: m.exerciseId } : undefined;
  };
  const suggestionFor = (n: ExerciseNameUse) => {
    const m = auto[n.key];
    return m && m.kind === 'suggest' ? m : null;
  };

  const effective = (n: ExerciseNameUse): NameResolution | undefined => choices[n.key] ?? autoResolution(n);

  // Split on what the app matched by itself, not on what has been chosen since,
  // so changing a match doesn't move its row into the other list.
  const matched = names.filter(n => autoResolution(n) !== undefined);
  const needing = names.filter(n => !matched.includes(n));
  const undecided = needing.filter(n => choices[n.key] === undefined);
  const undecidedSuggested = undecided.filter(n => suggestionFor(n) !== null);

  const resolutions = useMemo(() => {
    const out: Record<string, NameResolution> = {};
    for (const n of names) {
      const chosen = choices[n.key];
      const m = auto[n.key];
      if (chosen) out[n.key] = chosen;
      else if (m && isAutoMatch(m)) out[n.key] = { kind: 'exercise', exerciseId: m.exerciseId };
    }
    return out;
  }, [names, choices, auto]);

  // Asked only when the file has a weight for an exercise held in two dumbbells,
  // the one case where "each" and "pair" give different history. A described
  // workout is said the way the person types it in the app, so it never asks
  // and follows their Dumbbell weights setting instead.
  const hasTwoDumbbellSets = useMemo(() => {
    if (!ok || described) return false;
    return split.fresh.some(session => session.sets.some(s => {
      const r = resolutions[exerciseNameKey(s.exerciseName)];
      return s.weightKg !== null && !!r && heldInTwoDumbbells(r, s.exerciseName, exercises);
    }));
  }, [ok, described, split.fresh, resolutions, exercises]);
  const pairTotals = described ? dumbbellSetting === 'pair' : hasTwoDumbbellSets && dumbbellEntry === 'pair';

  const plan = useMemo(
    () => (ok ? buildImportPlan(ok.sessions, resolutions, sessionsInLog, { pairTotals, exercises }) : null),
    [ok, resolutions, sessionsInLog, pairTotals, exercises],
  );

  // A described workout is the person's own words and a paid request, so it is
  // unsaved work before anything on the review is touched.
  const dirty = !!described || Object.keys(choices).length > 0 || unitTouched || dumbbellTouched;
  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose, described
      ? { title: 'Discard this workout?', message: 'It hasn’t been logged yet. If you leave now, it will be lost.' }
      : {
        title: 'Discard this import?',
        message: 'Nothing has been imported yet. If you leave now, your choices will be lost.',
      });
  };

  const setChoice = (key: string, choice: Choice) => {
    haptics.tap();
    if (choice === 'match') { setPicking(key); return; }
    setChoices(prev => ({ ...prev, [key]: { kind: choice } }));
  };

  const setAll = (kind: 'create' | 'skip') => {
    haptics.tap();
    setChoices(prev => {
      const next = { ...prev };
      for (const n of undecided) next[n.key] = { kind };
      return next;
    });
  };

  const acceptSuggestion = (key: string, exerciseId: string) => {
    haptics.tap();
    setChoices(prev => ({ ...prev, [key]: { kind: 'exercise', exerciseId } }));
  };

  const acceptAllSuggestions = () => {
    haptics.tap();
    setChoices(prev => {
      const next = { ...prev };
      for (const n of undecidedSuggested) {
        const m = suggestionFor(n);
        if (m) next[n.key] = { kind: 'exercise', exerciseId: m.exerciseId };
      }
      return next;
    });
  };

  const choiceOf = (n: ExerciseNameUse): Choice | null => {
    const c = choices[n.key];
    if (!c) return null;
    return c.kind === 'exercise' ? 'match' : c.kind;
  };

  const exerciseLabel = (id: string) => catalogExercise(exercises, id)?.name ?? 'Unknown exercise';

  const canImport = !!plan && plan.sessions.length > 0 && undecided.length === 0;

  const runImport = () => {
    if (!ok || !plan || !canImport) return;
    // A custom exercise is made from the file's own spelling of the name, with
    // the kind its sets say it is and the equipment its words name.
    const creates: Record<string, ExerciseInput> = {};
    for (const key of plan.createKeys) {
      const use = names.find(n => n.key === key);
      if (!use) continue;
      const sets = split.fresh.flatMap(s => s.sets).filter(s => s.exerciseName === use.name);
      creates[key] = {
        name: cleanWorkoutName(use.name),
        kind: inferExerciseKind(sets),
        equipment: guessEquipment(use.name),
        primaryMuscles: [],
      };
    }
    const sendToHealth = healthOffer === 'offer' && toHealth;
    const result = importSessions(
      sendToHealth ? plan.sessions.map(s => ({ ...s, healthWritePending: true })) : plan.sessions,
      creates,
    );
    // The flag is what the pending pass writes from, and it runs when the app
    // next comes to the front; starting it here puts the workout in Health now.
    if (sendToHealth && result.sessions > 0) void useWorkoutStore.getState().writePendingHealthSessions();
    haptics.success();
    onClose();
    const parts = [described
      ? `${count(result.sets, 'set was', 'sets were')} added to your history.`
      : `${count(result.sessions, 'workout', 'workouts')} and ${count(result.sets, 'set', 'sets')} were added to your history.`];
    if (result.created > 0) parts.push(`${count(result.created, 'exercise was', 'exercises were')} added to your library.`);
    Alert.alert(described ? 'Workout logged' : 'Import finished', parts.join(' '));
  };

  // What Health can be asked, from the same limits the pending pass applies.
  const healthOffer = described && writesToHealth ? describedWorkoutHealthOffer(described) : null;
  const summary = ok ? importSummary(ok.sessions) : { sessions: 0, sets: 0, from: null, to: null };
  const sourceLabel = ok?.source === 'text' ? 'Described workout' : ok?.source === 'hevy' ? 'Hevy export' : 'Strong export';
  const range = described
    ? format(new Date(described.startedAt), 'EEE, MMM d, yyyy')
    : summary.from && summary.to
    ? `${format(new Date(summary.from), 'MMM d, yyyy')} to ${format(new Date(summary.to), 'MMM d, yyyy')}`
    : '';
  const footerNote = undecided.length > 0
    ? `${count(undecided.length, 'name still needs', 'names still need')} a choice`
    : plan && plan.sessions.length === 0
      ? described
        ? 'A workout that started at this time is already in your log, or none of its sets are left.'
        : 'Every workout in this file is already in your log, or has no sets left.'
      : plan && plan.skippedSets > 0
        ? `${count(plan.skippedSets, 'set is', 'sets are')} skipped with their exercises`
        : null;

  return (
    <SheetModal
      name="WorkoutImportSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <SheetHeader
          title={described ? 'Log workout' : 'Import workouts'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<View style={styles.headerSpacer} />}
        />

        {ok ? (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Text style={styles.badge}>{sourceLabel}</Text>
            <Text style={styles.big}>
              {described
                ? `${described.title}, ${count(summary.sets, 'set', 'sets')}`
                : `${count(summary.sessions, 'workout', 'workouts')}, ${count(summary.sets, 'set', 'sets')}`}
            </Text>
            {range ? <Text style={styles.detail}>{range}</Text> : null}
            {split.duplicates > 0 ? (
              <Text style={styles.quiet}>
                {`${count(split.duplicates, 'workout is', 'workouts are')} already in your log and will be skipped.`}
              </Text>
            ) : null}
            {ok && ok.skippedRows > 0 ? (
              <Text style={styles.quiet}>
                {`${count(ok.skippedRows, 'row was', 'rows were')} left out: ${describeSkipped(ok.skipped)}.`}
              </Text>
            ) : null}
          </View>
          {/* Said only while saved workouts go to Health, which is when somebody
              would expect these to follow them there. A consequence of the
              import to see before confirming it, so a plain Text: Hide help
              text must not remove it. Styled as workout mode's own line about
              Health on its summary. */}
          {healthOffer === 'offer' ? (
            <TouchableOpacity
              style={styles.healthRow}
              onPress={() => { haptics.tap(); setToHealth(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityState={{ checked: toHealth }}
              accessibilityLabel="Add to Apple Health"
            >
              <Text style={styles.healthLabel}>Add to Apple Health</Text>
              <Toggle value={toHealth} />
            </TouchableOpacity>
          ) : healthOffer === 'noLength' ? (
            <Text style={styles.quietBelow}>
              It isn’t added to Apple Health. To add it, include how long it took in your description.
            </Text>
          ) : healthOffer === 'tooOld' ? (
            <Text style={styles.quietBelow}>
              {`It isn’t added to Apple Health because it was more than ${PENDING_WORKOUT_WRITE_MAX_AGE_DAYS} days ago.`}
            </Text>
          ) : writesToHealth && !described ? (
            <Text style={styles.quietBelow}>
              Imported workouts aren’t written to Apple Health. The app they came from may have saved them there already.
            </Text>
          ) : null}

          {ok?.unitAssumed ? (
            <>
              <Text style={styles.groupLabel}>Units in the file</Text>
              <SegmentedControl
                label="Units used in the file"
                options={UNIT_OPTIONS}
                value={unit}
                onChange={u => { setUnit(u); setUnitTouched(true); }}
                surface="page"
              />
              <HelpText style={styles.quietBelow}>
                This file doesn’t say which units it uses. Distances are read as kilometers or miles to match.
              </HelpText>
            </>
          ) : null}

          {hasTwoDumbbellSets ? (
            <>
              <Text style={styles.groupLabel}>Dumbbell weights in the file</Text>
              <SegmentedControl
                label="How dumbbell weights are written in the file"
                options={DUMBBELL_OPTIONS}
                value={dumbbellEntry}
                onChange={e => { if (e) { setDumbbellEntry(e); setDumbbellTouched(true); } }}
                surface="page"
              />
              <HelpText style={styles.quietBelow}>
                Choose Pair total if each weight is both dumbbells added together. They are saved as one dumbbell each.
              </HelpText>
            </>
          ) : null}

          {needing.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>{`Needs a choice · ${needing.length}`}</Text>
              {undecided.length > 1 ? (
                <View style={styles.bulk}>
                  {undecidedSuggested.length > 1 ? (
                    <InlineAction label="Use all suggestions" surface="page" onPress={acceptAllSuggestions} />
                  ) : null}
                  <InlineAction label="Create all" surface="page" onPress={() => setAll('create')} />
                  <InlineAction label="Skip all" variant="neutral" surface="page" onPress={() => setAll('skip')} />
                </View>
              ) : null}
              <View style={styles.cardFlush}>
                {needing.map((n, i) => {
                  const choice = choiceOf(n);
                  const resolution = choices[n.key];
                  const suggestion = suggestionFor(n);
                  return (
                    <View key={n.key} style={[styles.opt, i > 0 && styles.optSep]}>
                      <View>
                        <Text style={styles.name}>{n.name}</Text>
                        <Text style={styles.detail}>
                          {`${count(n.sets, 'set', 'sets')} in ${count(n.sessions, 'workout', 'workouts')}`}
                        </Text>
                      </View>
                      <SegmentedControl
                        label={`What to do with ${n.name}`}
                        options={CHOICE_OPTIONS}
                        value={choice}
                        onChange={c => { if (c) setChoice(n.key, c); }}
                      />
                      {resolution?.kind === 'exercise' ? (
                        <TouchableOpacity
                          onPress={() => { haptics.tap(); setPicking(n.key); }}
                          activeOpacity={interaction.activeOpacity}
                          accessibilityRole="button"
                          accessibilityLabel={`Change the match for ${n.name}`}
                        >
                          <Text style={styles.chosen}>{`${exerciseLabel(resolution.exerciseId)} ›`}</Text>
                        </TouchableOpacity>
                      ) : resolution?.kind === 'create' ? (
                        <Text style={styles.quiet}>Added to your library as its own exercise.</Text>
                      ) : resolution?.kind === 'skip' ? (
                        <Text style={styles.quiet}>Its sets are left out of the import.</Text>
                      ) : suggestion ? (
                        <View style={styles.suggestion}>
                          <View style={styles.flex}>
                            <Text style={styles.detail}>Closest match</Text>
                            <Text style={styles.chosen}>{suggestion.exerciseName}</Text>
                          </View>
                          <InlineAction
                            label="Use this"
                            surface="card"
                            onPress={() => acceptSuggestion(n.key, suggestion.exerciseId)}
                          />
                        </View>
                      ) : (
                        <Text style={styles.warn}>Choose one to continue.</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}

          {matched.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>{`Matched · ${matched.length}`}</Text>
              <View style={styles.cardFlush}>
                {matched.map((n, i) => {
                  const r = effective(n);
                  return (
                    <TouchableOpacity
                      key={n.key}
                      style={[styles.matched, i > 0 && styles.optSep]}
                      onPress={() => { haptics.tap(); setPicking(n.key); }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`${n.name} is matched to ${r?.kind === 'exercise' ? exerciseLabel(r.exerciseId) : 'nothing'}. Change it`}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.name}>{n.name}</Text>
                        <Text style={styles.detail}>{r?.kind === 'exercise' ? exerciseLabel(r.exerciseId) : ''}</Text>
                      </View>
                      <Text style={styles.change}>Change ›</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}
        </ScrollView>
        ) : <View style={styles.body} />}

        <View style={styles.footer}>
          <PressableScale
            style={[styles.importButton, !canImport && styles.importDisabled]}
            onPress={runImport}
            disabled={!canImport}
            accessibilityLabel={described ? 'Log workout' : plan ? `Import ${count(plan.sessions.length, 'workout', 'workouts')}` : 'Import'}
          >
            <Text style={styles.importLabel}>
              {described ? 'Log workout' : plan && plan.sessions.length > 0 ? `Import ${count(plan.sessions.length, 'workout', 'workouts')}` : 'Import'}
            </Text>
          </PressableScale>
          {footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}
        </View>

        <ExercisePickerSheet
          visible={visible && picking !== null}
          onClose={() => setPicking(null)}
          onPick={id => {
            if (picking) setChoices(prev => ({ ...prev, [picking]: { kind: 'exercise', exerciseId: id } }));
            setPicking(null);
          }}
        />
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { minWidth: 64 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  flex: { flex: 1 },
  card: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, gap: spacing.xsm,
  },
  cardFlush: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, overflow: 'hidden' },
  badge: {
    color: colors.accentText, fontSize: font.xxs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  big: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  bulk: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  opt: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd, gap: spacing.sm },
  optSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  matched: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
  },
  name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  detail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  quiet: { color: colors.textSecondary, fontSize: font.sm },
  healthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    backgroundColor: colors.bgSecondary, borderRadius: radius.lg, minHeight: 48,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, marginTop: spacing.sm,
  },
  healthLabel: { flex: 1, color: colors.text, fontSize: font.md },
  quietBelow: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xsm, marginHorizontal: spacing.xs },
  warn: { color: colors.warningText, fontSize: font.sm },
  chosen: { color: colors.accentText, fontSize: font.sm },
  suggestion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd },
  change: { color: colors.textSecondary, fontSize: font.sm },
  footer: {
    paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, backgroundColor: colors.bg,
  },
  importButton: {
    backgroundColor: colors.accentFill, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: spacing.smd,
  },
  importDisabled: { opacity: 0.4 },
  importLabel: { color: colors.onAccent, fontSize: font.lg, fontWeight: fontWeight.semibold },
  footerNote: { color: colors.textSecondary, fontSize: font.xs, textAlign: 'center', marginTop: spacing.sm },
});
