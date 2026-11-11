import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { addDays } from 'date-fns/addDays';
import type { Experiment } from '../types';
import { useExperimentStore } from '../store/useExperimentStore';
import { useMoodStore } from '../store/useMoodStore';
import { EditorSheet } from './EditorSheet';
import { EditorRow } from './EditorRow';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { WhenPicker } from './WhenPicker';
import { SegmentedControl } from './SegmentedControl';
import { PillGroup } from './PillGroup';
import { FieldError } from './FieldError';
import { InlineAction } from './InlineAction';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getLogicalToday } from '../utils/dateUtils';
import { symptomKey, symptomVocabulary } from '../utils/moodLog';
import {
  DEFAULT_EXPERIMENT_DAYS,
  EXPERIMENT_LABEL_MAX_LENGTH,
  EXPERIMENT_LENGTH_PRESETS,
  canEndToday,
  cleanExperimentSymptoms,
  describeLength,
  experimentRefusal,
  experimentSpan,
} from '../utils/experiments';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { BUTTON_LABEL } from '../copy/shared';
import { confirmDelete } from '../utils/confirmDelete';
import { confirmDiscard } from '../utils/confirmDiscard';

const NOTE_MAX_LENGTH = 300;

/** Noon on today's logical day, the anchor `WhenPicker` gives a picked date. */
function noonOfToday(): Date {
  const d = getLogicalToday();
  d.setHours(12, 0, 0, 0);
  return d;
}

/** The last day of an experiment `days` long starting on `start`. */
function endFor(start: Date, days: number): Date {
  return addDays(start, days - 1);
}

interface Props {
  visible: boolean;
  /** The experiment being edited, or null to start a new one. */
  experiment: Experiment | null;
  onClose: () => void;
}

/**
 * Starting or changing an experiment — see `docs/arch/mood-log.md`,
 * "Experiments".
 *
 * Name, first day, length, the symptoms it is meant to change, and what you
 * expect. The length is a preset or a picked last day, stored as the last day:
 * the baseline it is read against is always the same number of days just
 * before it, so there is nothing else to choose.
 *
 * Saves on Done like `MilestoneSheet`, and a new one left without a name is
 * simply not made. A refusal the store would make (no name, an end before the
 * start) shows under its field from `experimentRefusal`, the same function the
 * store refuses on.
 */
export function ExperimentSheet({ visible, experiment, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const addExperiment = useExperimentStore(s => s.addExperiment);
  const updateExperiment = useExperimentStore(s => s.updateExperiment);
  const removeExperiment = useExperimentStore(s => s.removeExperiment);
  const logs = useMoodStore(s => s.logs);

  const [label, setLabel] = useState('');
  const [start, setStart] = useState<Date>(() => noonOfToday());
  const [end, setEnd] = useState<Date>(() => endFor(noonOfToday(), DEFAULT_EXPERIMENT_DAYS));
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const labelInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    if (experiment) {
      setLabel(experiment.label);
      setStart(new Date(experiment.startDate));
      setEnd(new Date(experiment.endDate));
      setSymptoms(experiment.symptoms);
      setNote(experiment.note ?? '');
    } else {
      const today = noonOfToday();
      setLabel('');
      setStart(today);
      setEnd(endFor(today, DEFAULT_EXPERIMENT_DAYS));
      setSymptoms([]);
      setNote('');
    }
    setPicker(null);
  }, [visible, experiment]);

  const lengthDays = experimentSpan({ startDate: start.toISOString(), endDate: end.toISOString() }).lengthDays;
  // Only for one already running, and only while its last day is still ahead:
  // a new one ending today is a length, not an early end.
  const showEndToday = experiment !== null
    && canEndToday({ startDate: start.toISOString(), endDate: end.toISOString() }, dayKeyOf(getLogicalToday()));
  const refusal = experimentRefusal({ label, startDate: start, endDate: end });
  // A new experiment nobody named is not one to warn about: closing just
  // doesn't make it, the way an unnamed milestone isn't made.
  const blankNew = !experiment && !label.trim();
  const nameRefused = !label.trim() && !blankNew;
  const datesRefused = refusal !== null && label.trim() !== '';

  const draft = () => ({
    label,
    startDate: start,
    endDate: end,
    symptoms: cleanExperimentSymptoms(symptoms),
    note: note.trim() ? note : null,
  });

  const save = () => {
    if (experiment) {
      updateExperiment(experiment.id, draft());
    } else {
      addExperiment(draft());
    }
    onClose();
  };

  const handleDone = () => {
    if (blankNew) { onClose(); return; }
    if (refusal) return;
    save();
  };

  // EditorSheet is full screen, so this is only the hardware back. A change
  // the store would refuse can't be saved, so it is offered for discarding
  // rather than lost without a word.
  const handleRequestClose = () => {
    if (blankNew) { onClose(); return; }
    if (refusal) { confirmDiscard(onClose); return; }
    save();
  };

  const handleDelete = () => {
    if (!experiment) { onClose(); return; }
    confirmDelete({
      title: 'Delete this experiment?',
      message: 'Your mood and symptom entries stay as they are.',
      onConfirm: () => { removeExperiment(experiment.id); onClose(); },
    });
  };

  // Moving the first day keeps the length, so a 4-week experiment pushed back
  // a week is still 4 weeks rather than suddenly 3.
  const pickStart = (picked: Date) => {
    setStart(picked);
    setEnd(endFor(picked, lengthDays));
  };

  // Every symptom ever logged, plus any picked that hasn't been logged yet
  // (one added here, or one whose entries have since been deleted).
  const symptomOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const name of symptomVocabulary(logs)) names.set(symptomKey(name), name);
    for (const name of symptoms) if (!names.has(symptomKey(name))) names.set(symptomKey(name), name);
    const picked = new Set(symptoms.map(symptomKey));
    return [...names].map(([key, name]) => ({
      key,
      label: name,
      selected: picked.has(key),
      onPress: () => {
        haptics.tap();
        setSymptoms(current => (current.some(s => symptomKey(s) === key)
          ? current.filter(s => symptomKey(s) !== key)
          : [...current, name]));
      },
    }));
  }, [logs, symptoms]);

  const presetValue = EXPERIMENT_LENGTH_PRESETS.some(p => p.days === lengthDays) ? lengthDays : -1;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={handleRequestClose}
      // Only for a new one: the sheet stays mounted across opens, so a bare
      // `autoFocus` on the field would only ever fire once.
      onShow={() => { if (!experiment) labelInputRef.current?.focus(); }}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title={experiment ? 'Edit experiment' : 'New experiment'}
          left={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={handleDone} disabled={refusal !== null && !blankNew} />}
          right={experiment ? (
            <TouchableOpacity activeOpacity={interaction.activeOpacity} onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete experiment">
              <Ionicons name="trash-outline" size={20} color={colors.red} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        />
      }
      footer={
        <WhenPicker
          visible={picker !== null}
          value={picker === 'end' ? end : start}
          title={picker === 'end' ? 'Last day' : 'First day'}
          showTimeOfDay={false}
          showSuggest={false}
          onConfirm={picked => {
            if (picked) {
              if (picker === 'end') setEnd(picked);
              else pickStart(picked);
            }
            setPicker(null);
          }}
          onCancel={() => setPicker(null)}
        />
      }
    >
      <TextField
        ref={labelInputRef}
        style={styles.textInput}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. No caffeine after noon"
        placeholderTextColor={colors.textTertiary}
        maxLength={EXPERIMENT_LABEL_MAX_LENGTH}
        multiline
        accessibilityLabel="What you’re trying"
      />
      {nameRefused && <FieldError style={styles.error}>{refusal}</FieldError>}

      <Text style={styles.groupLabel}>WHEN</Text>
      <View style={styles.card}>
        <EditorRow
          icon="calendar-outline"
          label="Starts"
          value={format(start, 'EEE, MMM d, yyyy')}
          onPress={() => { haptics.tap(); setPicker('start'); }}
        />
        <View style={styles.separator} />
        <EditorRow
          icon="flag-outline"
          label="Ends"
          value={`${format(end, 'EEE, MMM d')} · ${describeLength(lengthDays)}`}
          onPress={() => { haptics.tap(); setPicker('end'); }}
        />
        <View style={styles.lengths}>
          <SegmentedControl
            label="Length"
            options={EXPERIMENT_LENGTH_PRESETS.map(p => ({ value: p.days, label: p.label }))}
            value={presetValue}
            onChange={days => setEnd(endFor(start, days))}
          />
        </View>
      </View>
      {showEndToday && (
        <View style={styles.endToday}>
          <InlineAction
            label="End it today"
            icon="stop-circle-outline"
            variant="neutral"
            onPress={() => { haptics.tap(); setEnd(noonOfToday()); }}
          />
        </View>
      )}
      {datesRefused && <FieldError style={styles.error}>{refusal}</FieldError>}
      <HelpText style={styles.hint}>
        Compared with the same number of days just before it starts.
      </HelpText>

      <Text style={styles.groupLabel}>SYMPTOMS TO WATCH</Text>
      <View style={[styles.card, styles.pillCard]}>
        <PillGroup
          options={symptomOptions}
          noun="symptom"
          createMaxLength={40}
          onCreate={name => {
            const key = symptomKey(name);
            if (!key) return 'Type a symptom.';
            setSymptoms(current => (current.some(s => symptomKey(s) === key) ? current : [...current, name.trim()]));
            return null;
          }}
        />
      </View>
      <HelpText style={styles.hint}>
        Your mood is always compared. Pick the symptoms you expect this to change. Other
        symptoms are still shown, apart from these.
      </HelpText>

      <Text style={styles.groupLabel}>WHAT YOU EXPECT</Text>
      <TextField
        style={styles.textInput}
        value={note}
        onChangeText={setNote}
        placeholder="e.g. Fewer headaches"
        placeholderTextColor={colors.textTertiary}
        maxLength={NOTE_MAX_LENGTH}
        multiline
        accessibilityLabel="What you expect"
      />
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerSpacer: { width: 20 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  textInput: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  groupLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  pillCard: { padding: spacing.md },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  lengths: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  endToday: { marginTop: spacing.sm, alignItems: 'flex-start' },
  error: { marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: 17,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
});
