// Describe a routine, or a workout you did, in words (one or the other, by `mode`). Landmarks:
//
//   ==== staged state ====     what the sheet holds while it is open
//   ==== drafting ====         the request, and what comes back
//   ==== matching ====         the step that settles exercise names
//   ==== render ====           the two steps, `write` then `match`
//
// Two steps, and the second is skipped when every name already matches. The
// model answers with names (`draftWorkoutFromText`), and a name that isn't
// plainly one of the person's exercises is theirs to settle before anything is
// built: the closest match is preselected rather than applied, because a
// near-miss is often a different lift (`matchExerciseName`).
//
// It hands the result to its caller rather than saving: a routine goes to the
// routine editor (`RoutineDraft`), a past workout to the import review
// (`ImportedSession`), and both of those write only on their own Save. It is
// With `into` it describes into something that already has content instead
// (workout mode's "Describe", or a routine being edited that isn't empty), and
// the result goes to `into.onAdd`. It is opened from inside the editor it fills (`RoutineEditorSheet`, mode `routine`)
// and from the past-workout sheet (`LogPastWorkoutSheet`, mode `log`), so the
// person never has to say in advance that they will describe. Mock:
// docs/arch/workouts-mocks/describe-routine.png.
//
// It is a `pageSheet` holding typed text, so a swipe-down and Cancel both go
// through `handleCancel` (`confirmDiscard`). The exercise picker is rendered
// inside this sheet's own Modal rather than beside it: two sibling sheets can't
// both present (CLAUDE.md, "Two sibling Modals").
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { PressableScale } from './PressableScale';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import { buildCatalog, catalogExercise } from '../utils/exerciseCatalog';
import { getLogicalToday, dayKeyOf } from '../utils/dateUtils';
import { isAutoMatch, matchExerciseName, type ImportedSession, type NameResolution } from '../utils/workoutCsv';
import {
  DESCRIBE_MAX_LENGTH,
  draftNames,
  routineFromDraft,
  sessionFromDraft,
  type DescribeMode,
  type RoutineDraft,
  type WorkoutDraft,
} from '../utils/workoutDraft';
import { describeAIError, draftWorkoutFromText } from '../services/aiSuggestions';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** What is being described. Fixed for the life of the sheet: the opener already knows which it is. */
  mode: DescribeMode;
  onClose: () => void;
  /** A routine was described and its names are settled. The caller opens the editor on it and closes this sheet. */
  onRoutine?: (draft: RoutineDraft) => void;
  /** A past workout was described. The caller opens the import review on it and closes this sheet. */
  onWorkout?: (session: ImportedSession) => void;
  /**
   * Describing into something that already has content (with `mode`
   * `routine`): the running workout from workout mode, or a routine that is
   * being edited and isn't empty. The settled exercises come back as a
   * `RoutineDraft` for the caller to add (to the session as sets to do, or to
   * the end of the editor's list) and to close this sheet.
   */
  into?: { target: 'workout' | 'routine'; onAdd: (draft: RoutineDraft) => void };
}

const INTO_COPY = {
  workout: {
    placeholder: 'e.g. Bench press 3x5 at 185, then rows 3x8-12 supersetted with curls',
    hint: 'These are added to this workout after what is already here, as sets still to do. Check them off as you go.',
    button: 'Add to workout',
  },
  routine: {
    placeholder: 'e.g. Bench press 3x5 at 185, then rows 3x8-12 supersetted with curls',
    hint: 'These are added to this routine after what is already here. Weights, rest and supersets are optional.',
    button: 'Add to routine',
  },
};

const COPY: Record<DescribeMode, { placeholder: string; hint: string; button: string }> = {
  routine: {
    placeholder: 'e.g. Push day: bench press 3x5 at 185, then incline dumbbell press 3x8-12 supersetted with cable fly',
    hint: 'A routine is a plan you can start later. Name the lifts, sets and reps. Weights, rest and supersets are optional.',
    button: 'Draft routine',
  },
  log: {
    placeholder: 'e.g. Yesterday: squat 5x5 at 225, then 20 minutes on the bike',
    hint: 'This is added to your history as a workout you already did. Say when it was if it wasn’t today.',
    button: 'Draft workout',
  },
};

type Step = 'write' | 'match';

/** A name the person has to settle: what they wrote, and the library's closest exercise if there is one. */
interface Pending {
  key: string;
  name: string;
  suggestedId: string | null;
}

type Choice = { kind: 'exercise'; exerciseId: string } | { kind: 'create' };

export function DescribeWorkoutSheet({ visible, mode, onClose, onRoutine, onWorkout, into }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const exercises = useWorkoutStore(s => s.exercises);
  const unit = useSettingsStore(s => s.workoutUnit);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  // ==== staged state ====
  const [text, setText] = useState('');
  const [step, setStep] = useState<Step>('write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [auto, setAuto] = useState<Record<string, NameResolution>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [picking, setPicking] = useState<string | null>(null);

  // A reply that lands after the sheet closed, or after another request was
  // made, belongs to nothing: it must not open an editor on its own.
  const ticket = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (!visible) { ticket.current++; return; }
    setText('');
    setStep('write');
    setBusy(false);
    setError(null);
    setDraft(null);
    setAuto({});
    setPending([]);
    setChoices({});
    setPicking(null);
  }, [visible]);

  const dirty = text.trim().length > 0;
  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose, {
      title: 'Discard this description?',
      message: 'Nothing has been drafted or saved yet. If you leave now, what you typed will be lost.',
    });
  };

  const exerciseLabel = (id: string) => catalogExercise(exercises, id)?.name ?? 'Unknown exercise';

  // ==== drafting ====
  const finishRoutine = (d: WorkoutDraft, resolutions: Record<string, NameResolution>) => {
    haptics.success();
    const made = routineFromDraft(
      d,
      resolutions,
      id => catalogExercise(useWorkoutStore.getState().exercises, id)?.kind ?? 'weight_reps',
      unit,
    );
    if (into) into.onAdd(made);
    else onRoutine?.(made);
  };

  const received = (d: WorkoutDraft) => {
    if (mode === 'log') {
      const made = sessionFromDraft(d, unit, dayKeyOf(getLogicalToday()), new Date());
      if (!made.ok) { haptics.warning(); setError(made.error); return; }
      haptics.success();
      onWorkout?.(made.session);
      return;
    }
    const catalog = buildCatalog(exercises);
    const resolved: Record<string, NameResolution> = {};
    const unsure: Pending[] = [];
    const defaults: Record<string, Choice> = {};
    for (const n of draftNames(d)) {
      const m = matchExerciseName(n.name, catalog);
      if (isAutoMatch(m)) { resolved[n.key] = { kind: 'exercise', exerciseId: m.exerciseId }; continue; }
      const suggestedId = m.kind === 'suggest' ? m.exerciseId : null;
      unsure.push({ key: n.key, name: n.name, suggestedId });
      defaults[n.key] = suggestedId ? { kind: 'exercise', exerciseId: suggestedId } : { kind: 'create' };
    }
    // Nothing to ask: go straight on.
    if (unsure.length === 0) { finishRoutine(d, resolved); return; }
    setDraft(d);
    setAuto(resolved);
    setPending(unsure);
    setChoices(defaults);
    setStep('match');
  };

  const run = async () => {
    const asked = text.trim();
    if (!asked || busy) return;
    const mine = ++ticket.current;
    setBusy(true);
    setError(null);
    haptics.tap();
    try {
      const d = await draftWorkoutFromText(asked, mode, {
        exerciseNames: exercises.filter(e => !e.archived).map(e => e.name),
        unit,
        today: dayKeyOf(getLogicalToday()),
      });
      if (mine !== ticket.current || !visibleRef.current) return;
      received(d);
    } catch (e) {
      if (mine !== ticket.current) return;
      haptics.warning();
      setError(describeAIError(e, 'workoutDraft'));
    } finally {
      if (mine === ticket.current) setBusy(false);
    }
  };

  // ==== matching ====
  const choose = (key: string, choice: Choice) => {
    haptics.tap();
    setChoices(prev => ({ ...prev, [key]: choice }));
  };

  const next = () => {
    if (!draft) return;
    finishRoutine(draft, { ...auto, ...choices });
  };

  /** The options a name offers: the closest match, an exercise picked by hand, and a new one. */
  const optionsFor = (p: Pending): { choice: Choice; label: string; tag?: string }[] => {
    const out: { choice: Choice; label: string; tag?: string }[] = [];
    if (p.suggestedId) out.push({ choice: { kind: 'exercise', exerciseId: p.suggestedId }, label: exerciseLabel(p.suggestedId), tag: 'Suggested' });
    const chosen = choices[p.key];
    if (chosen?.kind === 'exercise' && chosen.exerciseId !== p.suggestedId) {
      out.push({ choice: chosen, label: exerciseLabel(chosen.exerciseId) });
    }
    out.push({ choice: { kind: 'create' }, label: `New exercise: ${p.name}` });
    return out;
  };

  const sameChoice = (a: Choice | undefined, b: Choice) =>
    !!a && a.kind === b.kind && (a.kind !== 'exercise' || (b.kind === 'exercise' && a.exerciseId === b.exerciseId));

  const matchedNames = draft ? draftNames(draft).filter(n => auto[n.key]) : [];

  // ==== render ====
  const copy = into ? INTO_COPY[into.target] : COPY[mode];
  const writing = step === 'write';
  return (
    <SheetModal
      name="DescribeWorkoutSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={writing ? handleCancel : () => setStep('write')}
    >
      <View style={styles.root}>
        <SheetHeader
          title={writing ? (into ? 'Describe exercises' : mode === 'routine' ? 'Describe a routine' : 'Describe a workout') : 'Match exercises'}
          left={writing
            ? <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />
            : <SheetHeaderButton label="Back" role="cancel" onPress={() => setStep('write')} minWidth={64} />}
          right={writing
            ? <View style={styles.headerSpacer} />
            : <SheetHeaderButton label="Next" onPress={next} minWidth={64} />}
        />

        {writing ? (
          <ScrollView
            ref={keyboardScroll.ref}
            {...keyboardScroll.props}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.area}>
              <TextField
                style={styles.input}
                value={text}
                onChangeText={t => { setText(t); setError(null); }}
                placeholder={copy.placeholder}
                placeholderTextColor={colors.textTertiary}
                multiline
                maxLength={DESCRIBE_MAX_LENGTH}
                editable={!busy}
                autoFocus
                accessibilityLabel="Describe the workout"
              />
            </View>
            <HelpText style={styles.help}>{`${copy.hint} Weights are read in ${unit}.`}</HelpText>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PressableScale
              style={[styles.button, (!dirty || busy) && styles.buttonDisabled]}
              onPress={run}
              disabled={!dirty || busy}
              accessibilityLabel={copy.button}
            >
              {busy
                ? <ActivityIndicator color={colors.onAccent} />
                : <Text style={styles.buttonLabel}>{copy.button}</Text>}
            </PressableScale>
            {/* A consequence to read before tapping, so a plain Text: Hide help text must not remove it. */}
            <Text style={styles.note}>
              {`Sent to Claude along with the names of your exercises. Nothing is ${into ? 'added' : 'saved'} until you check it.`}
            </Text>
          </ScrollView>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.intro}>
              {`${pending.length === 1 ? '1 exercise needs' : `${pending.length} exercises need`} a quick check. The rest matched your library.`}
            </Text>
            {pending.map(p => (
              <View key={p.key} style={styles.item}>
                <View style={styles.wrote}>
                  <Text style={styles.cap}>You wrote</Text>
                  <Text style={styles.wroteName}>{p.name}</Text>
                </View>
                {optionsFor(p).map(o => {
                  const on = sameChoice(choices[p.key], o.choice);
                  return (
                    <TouchableOpacity
                      key={o.label}
                      style={styles.option}
                      onPress={() => choose(p.key, o.choice)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={o.label}
                    >
                      <View style={[styles.radio, on && styles.radioOn]} />
                      <Text style={styles.optionLabel}>
                        {o.label}
                        {o.tag ? <Text style={styles.tag}>{`  ${o.tag}`}</Text> : null}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => { haptics.tap(); setPicking(p.key); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose another exercise for ${p.name}`}
                >
                  <Ionicons name="search-outline" size={iconSize.sm} color={colors.accentText} />
                  <Text style={styles.chooseLabel}>Choose another exercise</Text>
                </TouchableOpacity>
              </View>
            ))}
            {matchedNames.length > 0 ? (
              <>
                <Text style={styles.groupLabel}>Matched</Text>
                <View style={styles.cardFlush}>
                  {matchedNames.map((n, i) => {
                    const r = auto[n.key];
                    return (
                      <View key={n.key} style={[styles.matched, i > 0 && styles.optSep]}>
                        <Ionicons name="checkmark" size={iconSize.sm} color={colors.greenText} />
                        <Text style={styles.optionLabel}>
                          {r.kind === 'exercise' ? exerciseLabel(r.exerciseId) : n.name}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </>
            ) : null}
          </ScrollView>
        )}

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
  area: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, marginTop: spacing.xs },
  input: {
    color: colors.text, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.smd, minHeight: 200,
    textAlignVertical: 'top',
  },
  help: { marginTop: spacing.sm, marginHorizontal: spacing.xs },
  error: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  button: {
    backgroundColor: colors.accentFill, borderRadius: radius.lg, marginTop: spacing.md,
    alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: spacing.smd,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: colors.onAccent, fontSize: font.lg, fontWeight: fontWeight.semibold },
  note: { color: colors.textSecondary, fontSize: font.sm, textAlign: 'center', marginTop: spacing.sm, marginHorizontal: spacing.xs },
  intro: { color: colors.textSecondary, fontSize: font.sm, marginHorizontal: spacing.xs, marginBottom: spacing.xs },
  item: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, marginTop: spacing.sm, overflow: 'hidden' },
  wrote: { paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.sm },
  cap: {
    color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  wroteName: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold, marginTop: spacing.xxs },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd, minHeight: 44,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  optionLabel: { flex: 1, color: colors.text, fontSize: font.md },
  tag: { color: colors.accentText, fontSize: font.xs, fontWeight: fontWeight.semibold },
  chooseLabel: { color: colors.accentText, fontSize: font.md },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.controlBorder },
  radioOn: { borderWidth: 6, borderColor: colors.accent },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  cardFlush: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, overflow: 'hidden' },
  matched: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  optSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
});
