import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import type { LoggedSymptom, MoodLevel, MoodLog, SymptomSeverity } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  MOOD_LEVELS,
  SYMPTOM_SEVERITIES,
  moodLabel,
  symptomKey,
  symptomVocabulary,
  withSymptom,
  withoutSymptom,
} from '../utils/moodLog';
import { useMoodStore } from '../store/useMoodStore';
import { getLogicalToday } from '../utils/dateUtils';
import { useTaskStore } from '../store/useTaskStore';
import { EditorSheet } from './EditorSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { PillGroup } from './PillGroup';
import { EditorRow } from './EditorRow';
import { WhenPicker } from './WhenPicker';

const NOTE_MAX_LENGTH = 500;

/** Noon on a picked day — see the note at the call site. */
function noonOn(day: Date): Date {
  const at = new Date(day);
  at.setHours(12, 0, 0, 0);
  return at;
}

/** "Today" for the common case, an actual date once you have moved off it. */
function dayLabel(day: Date): string {
  return isSameDay(day, getLogicalToday()) ? 'Today' : format(day, 'EEE d MMM');
}

interface Props {
  visible: boolean;
  /** The entry being edited, or null to record a new one. */
  editing?: MoodLog | null;
  onClose: () => void;
}

/**
 * Writing down how you're doing — the one way into the mood log.
 *
 * An `EditorSheet` rather than a page sheet of its own, which also settles the
 * unsaved-changes question CLAUDE.md raises: `EditorSheet` is `fullScreen`, so
 * there is no swipe-down gesture to bypass Save with, and Cancel is the only
 * way out that discards.
 *
 * **Everything on it is optional, and that is the design.** Mood alone is a
 * complete entry, so is a symptom on a day you have no opinion about your
 * mood, and so is a bare note. A required field on a form somebody is asked to
 * fill in daily is how a daily form stops being filled in — and a mood the app
 * insisted on would be an invented number in every average on the Mood screen.
 * The only thing refused is an entry with nothing in it at all (see
 * `useMoodStore.addLog`), which is why Save is disabled rather than failing.
 *
 * The severity control appears per symptom only once that symptom is picked.
 * Asking for a severity up front would be a second question about a thing you
 * have not yet said you have.
 */
export function MoodLogSheet({ visible, editing = null, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMoodStore(s => s.logs);
  const addLog = useMoodStore(s => s.addLog);
  const updateLog = useMoodStore(s => s.updateLog);
  const completeMoodLogTaskForToday = useTaskStore(s => s.completeMoodLogTaskForToday);

  const [mood, setMood] = useState<MoodLevel | null>(null);
  const [symptoms, setSymptoms] = useState<LoggedSymptom[]>([]);
  const [note, setNote] = useState('');
  // Names typed into the pill grid this session. Held apart from the derived
  // vocabulary so a symptom you have just invented shows in the grid before it
  // has ever been saved — the vocabulary is read off saved entries, and
  // without this the pill you just created would vanish on the next render.
  const [drafted, setDrafted] = useState<string[]>([]);
  // Which day is being recorded. Today unless you say otherwise — the common
  // case by a mile, and the only one before this row existed.
  const [day, setDay] = useState<Date>(() => getLogicalToday());
  const [pickerOpen, setPickerOpen] = useState(false);

  // Reseeds on every open, including a reopen with the same props — a sheet
  // that handed back last night's half-filled form would be recording the
  // wrong day's feelings.
  useEffect(() => {
    if (!visible) return;
    setMood(editing?.mood ?? null);
    setSymptoms(editing?.symptoms ?? []);
    setNote(editing?.note ?? '');
    setDrafted([]);
    setDay(getLogicalToday());
    setPickerOpen(false);
  }, [visible, editing]);

  const vocabulary = useMemo(() => symptomVocabulary(logs), [logs]);
  const pillNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    // Picked first, then what you have logged before, then what you have just
    // typed. Anything already selected is in the list whatever its history, so
    // a one-off symptom can still be un-picked.
    for (const source of [symptoms.map(s => s.name), vocabulary, drafted]) {
      for (const name of source) {
        const key = symptomKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
    }
    return names;
  }, [symptoms, vocabulary, drafted]);

  const toggleSymptom = (name: string) => {
    haptics.tap();
    animateLayout();
    setSymptoms(current =>
      current.some(s => symptomKey(s.name) === symptomKey(name))
        ? withoutSymptom(current, name)
        // Mild is the floor rather than the middle: it is the least a logged
        // symptom can mean, so an untouched severity never overstates one.
        : withSymptom(current, name, 1)
    );
  };

  const setSeverity = (name: string, severity: SymptomSeverity) => {
    setSymptoms(current => withSymptom(current, name, severity));
  };

  const createSymptom = (name: string): string | null | void => {
    const trimmed = name.trim();
    if (!trimmed) return 'Give it a name.';
    if (pillNames.some(n => symptomKey(n) === symptomKey(trimmed))) {
      return 'You already have that one.';
    }
    setDrafted(current => [...current, trimmed]);
    animateLayout();
    setSymptoms(current => withSymptom(current, trimmed, 1));
  };

  const canSave = mood !== null || symptoms.length > 0 || note.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    haptics.success();
    if (editing) {
      updateLog(editing.id, { mood, symptoms, note });
    } else {
      // Today records the actual moment; a backdated day records noon on it.
      // Noon rather than midnight for the reason DriftScreen parks its dates
      // there: a date on a day boundary can be dragged across it by a timezone
      // or a DST hour, and the one thing this entry must get right is which
      // day it belongs to.
      const isToday = isSameDay(day, getLogicalToday());
      const at = isToday ? undefined : noonOn(day);
      addLog(mood, symptoms, note, at);
      // Logging is what the daily task asks for, so answering it ticks it off.
      // Only on a new entry for today: editing last Tuesday's note is not
      // today's check-in, and neither is filling in the day you missed —
      // completing today's task off either would be a lie about a day nobody
      // logged.
      if (isToday) completeMoodLogTaskForToday();
    }
    onClose();
  };

  const moodOptions = MOOD_LEVELS.map(level => ({
    value: level.value as MoodLevel,
    // The emoji alone: five words across a phone width truncates to "Very…"
    // twice over, and the faces are the half anybody actually reads. The word
    // is spoken to screen readers and printed under the track once picked, so
    // it is never the only thing carrying the meaning.
    label: level.emoji,
    accessibilityLabel: level.label,
  }));

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>{editing ? 'Edit entry' : 'How are you doing?'}</Text>
          <SheetHeaderButton label="Save" onPress={save} disabled={!canSave} minWidth={64} />
        </>
      }
    >
      {/* Only for a new entry: an existing one's day is fixed by design (see
          useMoodStore.updateLog), so offering to change it here would be a
          control that silently does nothing. */}
      {!editing && (
        <View style={styles.card}>
          <EditorRow
            icon="calendar-outline"
            label="Day"
            value={dayLabel(day)}
            onPress={() => { haptics.tap(); setPickerOpen(true); }}
          />
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.groupLabel}>MOOD</Text>
        <SegmentedControl
          options={moodOptions}
          value={mood as MoodLevel}
          onChange={value => { haptics.tap(); setMood(value); }}
          label="Mood"
        />
        <Text style={styles.moodCaption}>
          {mood === null ? 'Optional. Leave it blank if you\'d rather not say.' : moodLabel(mood)}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.groupLabel}>SYMPTOMS</Text>
        <Text style={styles.hint}>
          Whatever you want to keep track of. Add your own names for them.
        </Text>
        <PillGroup
          noun="symptom"
          surface="card"
          onCreate={createSymptom}
          filterPlaceholder="Find or add a symptom…"
          options={pillNames.map(name => {
            const picked = symptoms.find(s => symptomKey(s.name) === symptomKey(name));
            return {
              key: symptomKey(name),
              label: name,
              selected: !!picked,
              accessibilityLabel: picked ? `${name}, logged` : name,
              onPress: () => toggleSymptom(name),
            };
          })}
        />
        {symptoms.map(symptom => (
          <View key={symptomKey(symptom.name)} style={styles.severityRow}>
            <Text style={styles.severityLabel} numberOfLines={1}>{symptom.name}</Text>
            <SegmentedControl
              options={SYMPTOM_SEVERITIES.map(s => ({ value: s.value, label: s.label }))}
              value={symptom.severity}
              onChange={value => { haptics.tap(); setSeverity(symptom.name, value); }}
              label={`How bad was ${symptom.name}`}
            />
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.groupLabel}>NOTES</Text>
        <TextInput
          style={styles.noteInput}
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Slept badly, busy afternoon"
          placeholderTextColor={colors.textTertiary}
          maxLength={NOTE_MAX_LENGTH}
          multiline
          accessibilityLabel="Notes about how you're doing"
        />
      </View>

      {/* allowFuture={false}: an entry records how a day went, and Thursday
          has not gone yet. showTimeOfDay/showSuggest off because this is not a
          task's schedule — there is nothing to place and nothing to suggest. */}
      <WhenPicker
        visible={pickerOpen}
        value={day}
        title="Which day?"
        allowFuture={false}
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={picked => { if (picked) setDay(picked); setPickerOpen(false); }}
        onCancel={() => setPickerOpen(false)}
      />
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  groupLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  moodCaption: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  // marginTop clears the pill grid above; marginBottom is its own, so the next
  // severity row isn't jammed against it. Both sides, per the spacing note in
  // CLAUDE.md.
  severityRow: { marginTop: spacing.md },
  severityLabel: {
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  noteInput: {
    fontSize: font.md,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
