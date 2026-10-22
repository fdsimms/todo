import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import type { FactorLevel, LoggedFactor, LoggedSymptom, MoodLevel, MoodLog, SymptomSeverity } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';
import {
  DEFAULT_CONTEXT_TAGS,
  DEFAULT_FACTORS,
  FACTOR_LEVELS,
  MOOD_LEVELS,
  SYMPTOM_SEVERITIES,
  contextTagVocabulary,
  contextTagKey,
  factorKey,
  factorLabel,
  factorVocabulary,
  moodLabel,
  renamedContextTags,
  seededContextTags,
  symptomKey,
  symptomVocabulary,
  withContextTag,
  withFactor,
  withSymptom,
  withoutContextTag,
  withoutFactor,
  withoutSymptom,
} from '../utils/moodLog';
import { useMoodStore } from '../store/useMoodStore';
import { useTaskStore } from '../store/useTaskStore';
import { dayKeyOf, getCurrentDayStart, getLogicalToday } from '../utils/dateUtils';
import { isAwayOn } from '../utils/awayDates';
import { moodPlaceTagNow } from '../utils/moodPlaceNow';
import { moodDayOffersFor } from '../utils/moodDayOffers';
import { useSettingsStore } from '../store/useSettingsStore';
import { EditorSheet } from './EditorSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { MoodFace } from './MoodFace';
import { PillGroup } from './PillGroup';
import { EditorRow } from './EditorRow';
import { WhenPicker } from './WhenPicker';
import { TextField } from './TextField';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { BUTTON_LABEL } from '../copy/shared';

const NOTE_MAX_LENGTH = 500;

/** Noon on a picked day — see the note at the call site. */
function noonOn(day: Date): Date {
  const at = new Date(day);
  at.setHours(12, 0, 0, 0);
  return at;
}

/** Whether two tag lists are the same picks in the same order. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/** "Today" for the common case, an actual date once you have moved off it. */
function dayLabel(day: Date): string {
  return isSameDay(day, getLogicalToday()) ? 'Today' : format(day, 'EEE, MMM d');
}

interface Props {
  visible: boolean;
  /** The entry being edited, or null to record a new one. */
  editing?: MoodLog | null;
  /**
   * A new entry's mood or symptom, picked before the sheet opens (search's
   * "feeling tired"). Offered exactly as a tap would be, so it comes back off
   * with one more. Ignored when editing.
   */
  prefill?: MoodLogPrefill | null;
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
export interface MoodLogPrefill {
  mood: MoodLevel | null;
  symptom: string | null;
}

export function MoodLogSheet({ visible, editing = null, prefill = null, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMoodStore(s => s.logs);
  const addLog = useMoodStore(s => s.addLog);
  const updateLog = useMoodStore(s => s.updateLog);
  const removeLog = useMoodStore(s => s.removeLog);
  const renameContextTag = useMoodStore(s => s.renameContextTag);
  // What this offers a suggestion from — see docs/arch/mood-log.md. Other data
  // the app already has (a missed-heavy day, and so on) can follow the same
  // offer-don't-decide shape later without redesigning this.
  const vacationMode = useSettingsStore(s => s.vacationMode);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);

  const [mood, setMood] = useState<MoodLevel | null>(null);
  const [symptoms, setSymptoms] = useState<LoggedSymptom[]>([]);
  const [contextTags, setContextTags] = useState<string[]>([]);
  // Rated factors, and the names picked but not yet rated. A picked factor
  // starts unrated rather than at a middle value: a number nobody chose would
  // be an invented rating in every comparison, so only a rated one is saved.
  const [factors, setFactors] = useState<LoggedFactor[]>([]);
  const [unratedFactors, setUnratedFactors] = useState<string[]>([]);
  const [draftedFactors, setDraftedFactors] = useState<string[]>([]);
  const [openedFactors, setOpenedFactors] = useState<string[]>([]);
  const [note, setNote] = useState('');
  // Whether the note field is showing. Folded away behind "Add a note" on a new
  // entry so the sheet leads with the mood; open from the start when the entry
  // being edited already has one.
  const [noteOpen, setNoteOpen] = useState(false);
  // Names typed into the pill grid this session. Held apart from the derived
  // vocabulary so a symptom you have just invented shows in the grid before it
  // has ever been saved — the vocabulary is read off saved entries, and
  // without this the pill you just created would vanish on the next render.
  const [drafted, setDrafted] = useState<string[]>([]);
  const [draftedContext, setDraftedContext] = useState<string[]>([]);
  // The context tags the sheet opened with (an entry's saved ones, or the
  // seed). They lead the grid so what was already picked is on screen without
  // scrolling, and they are a snapshot rather than the live selection so a tap
  // never moves a pill.
  const [openedContext, setOpenedContext] = useState<string[]>([]);
  // Same for symptoms: the names the sheet opened with lead the grid.
  const [openedSymptoms, setOpenedSymptoms] = useState<string[]>([]);
  // Which day is being recorded. Today unless you say otherwise — the common
  // case by a mile, and the only one before this row existed.
  const [day, setDay] = useState<Date>(() => getLogicalToday());
  const [pickerOpen, setPickerOpen] = useState(false);
  // What a new entry's context tags were seeded with, or null when editing.
  const seedRef = useRef<string[] | null>(null);
  // Where the phone was when the sheet opened, once that read lands. It arrives
  // after the sheet is up, so it is kept for a Day row moved back to today, and
  // `sheetSession` is what lets a read that outlives its sheet be dropped.
  const placeTagRef = useRef<string | null>(null);
  const sheetSession = useRef(0);
  const dayRef = useRef(day);
  dayRef.current = day;
  const contextTagsRef = useRef(contextTags);
  contextTagsRef.current = contextTags;

  // Reseeds on every open, including a reopen with the same props — a sheet
  // that handed back last night's half-filled form would be recording the
  // wrong day's feelings.
  useEffect(() => {
    if (!visible) return;
    const offered = editing ? null : prefill;
    setMood(editing?.mood ?? offered?.mood ?? null);
    const openingSymptoms = editing?.symptoms ?? (offered?.symptom ? withSymptom([], offered.symptom, 1) : []);
    setSymptoms(openingSymptoms);
    setFactors(editing?.factors ?? []);
    setOpenedFactors((editing?.factors ?? []).map(f => f.name));
    setUnratedFactors([]);
    setDraftedFactors([]);
    setOpenedSymptoms(openingSymptoms.map(s => s.name));
    // Offered, not decided: a new entry opens with "Vacation" pre-picked
    // while vacation mode is on, exactly as if you had tapped the pill
    // yourself, and it comes right back off with one more tap. Only for a
    // fresh entry — editing an old one must not silently add a tag to it (see
    // docs/arch/mood-log.md). Same offer for whatever context you already
    // gave an earlier check-in that day: a second entry the same day is usually
    // still under the same circumstances, so those tags start picked too,
    // rather than asking you to re-tap "Sick" for the fourth entry of a day
    // you're unwell.
    //
    // The seed is kept so moving the Day row can redo it for that day (see
    // pickDay): vacation mode is a fact about today, and an earlier entry's
    // tags are a fact about its own day.
    const seed = editing
      ? null
      : seededContextTags(logs, dayKeyOf(getCurrentDayStart()), {
        isToday: true, vacationMode, away: isAwayOn(getCurrentDayStart(), dayResetTime),
        offered: moodDayOffersFor(getCurrentDayStart(), true),
      });
    seedRef.current = seed;
    placeTagRef.current = null;
    const session = ++sheetSession.current;
    const openingTags = editing?.contextTags ?? seed ?? [];
    setContextTags(openingTags);
    setOpenedContext(openingTags);
    setNote(editing?.note ?? '');
    setNoteOpen(!!editing?.note);
    setDrafted([]);
    setDraftedContext([]);
    setDay(getLogicalToday());
    setPickerOpen(false);
    // The place is read after the sheet is up and joins the seed when it lands:
    // a fix takes a moment and the sheet must not wait on it. Only a new entry
    // for today (a Day row moved elsewhere has no use for it), and dropped if
    // the sheet closed or reopened meanwhile.
    if (!editing) {
      void moodPlaceTagNow().then(tag => {
        if (!tag || sheetSession.current !== session) return;
        placeTagRef.current = tag;
        if (!isSameDay(dayRef.current, getLogicalToday())) return;
        const untouched = seedRef.current !== null && sameTags(contextTagsRef.current, seedRef.current);
        if (untouched) seedRef.current = withContextTag(seedRef.current!, tag);
        animateLayout();
        setContextTags(current => withContextTag(current, tag));
      });
    }
    // logs is deliberately not a dependency: it's read once, at the moment
    // the sheet opens, for the seed above. Depending on it would re-run this
    // reset on every store write while the sheet is open — including the
    // one this same save produces — and wipe out whatever you were mid-way
    // through entering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing, prefill, vacationMode]);

  // Picking another day re-seeds the context tags for that day, but only while
  // they are still exactly the seed: once the user has tapped a tag on or off,
  // the set is theirs and moving the day leaves it alone.
  const pickDay = (picked: Date) => {
    setDay(picked);
    const seed = seedRef.current;
    if (!seed || !sameTags(contextTags, seed)) return;
    const isToday = isSameDay(picked, getLogicalToday());
    const next = seededContextTags(logs, dayKeyOf(picked), {
      isToday,
      vacationMode,
      away: isAwayOn(picked, dayResetTime),
      placeTag: placeTagRef.current,
      offered: moodDayOffersFor(picked, isToday),
    });
    seedRef.current = next;
    setContextTags(next);
  };

  const vocabulary = useMemo(() => symptomVocabulary(logs), [logs]);
  const pillNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    // What the sheet opened with, then what you have logged before, then what you have just typed, then
    // anything picked that is in neither (so a one-off can still be
    // un-picked). Picking must not reorder the grid: this used to put the
    // picked names first, so every tap moved the pill out from under the
    // finger and shuffled the rest. Nothing here changes while the sheet is
    // open except by adding to the end.
    for (const source of [openedSymptoms, vocabulary, drafted, symptoms.map(s => s.name)]) {
      for (const name of source) {
        const key = symptomKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
    }
    return names;
  }, [symptoms, vocabulary, drafted, openedSymptoms]);

  const factorVocab = useMemo(() => factorVocabulary(logs), [logs]);
  const factorPillNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    // Same no-reorder rule as the grids above: what the sheet opened with, then
    // what you have rated before, the starters, what you typed this session,
    // and finally anything picked that is in none of them.
    for (const source of [openedFactors, factorVocab, DEFAULT_FACTORS, draftedFactors, factors.map(f => f.name), unratedFactors]) {
      for (const name of source) {
        const key = factorKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
    }
    return names;
  }, [openedFactors, factorVocab, draftedFactors, factors, unratedFactors]);

  const isFactorPicked = (name: string) =>
    factors.some(f => factorKey(f.name) === factorKey(name))
    || unratedFactors.some(n => factorKey(n) === factorKey(name));

  const toggleFactor = (name: string) => {
    haptics.tap();
    animateLayout();
    if (isFactorPicked(name)) {
      setFactors(current => withoutFactor(current, name));
      setUnratedFactors(current => current.filter(n => factorKey(n) !== factorKey(name)));
    } else {
      setUnratedFactors(current => [...current, name]);
    }
  };

  const rateFactor = (name: string, value: FactorLevel) => {
    setFactors(current => withFactor(current, name, value));
    setUnratedFactors(current => current.filter(n => factorKey(n) !== factorKey(name)));
  };

  const clearFactorRating = (name: string) => {
    haptics.tap();
    setFactors(current => withoutFactor(current, name));
    setUnratedFactors(current => [...current, name]);
  };

  const createFactor = (name: string): string | null | void => {
    const trimmed = name.trim();
    if (!trimmed) return 'Give it a name.';
    if (factorPillNames.some(n => factorKey(n) === factorKey(trimmed))) {
      return 'You already have that one.';
    }
    setDraftedFactors(current => [...current, trimmed]);
    animateLayout();
    setUnratedFactors(current => [...current, trimmed]);
  };

  const contextVocabulary = useMemo(() => contextTagVocabulary(logs), [logs]);
  const contextPillNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    // The tags the sheet opened with come first (see openedContext), then the
    // same order as pillNames above, with the starter suggestions slotted in
    // ahead of what you type this session and behind everything real: what
    // you have actually used before should always outrank a generic prompt.
    // Picked tags come last and only matter when they are in none of these,
    // for the same no-reorder reason.
    for (const source of [openedContext, contextVocabulary, DEFAULT_CONTEXT_TAGS, draftedContext, contextTags]) {
      for (const name of source) {
        const key = contextTagKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
    }
    return names;
  }, [contextTags, contextVocabulary, draftedContext, openedContext]);

  const toggleContextTag = (name: string) => {
    haptics.tap();
    animateLayout();
    setContextTags(current =>
      current.some(t => contextTagKey(t) === contextTagKey(name))
        ? withoutContextTag(current, name)
        : withContextTag(current, name)
    );
  };

  /**
   * Fix a tag's spelling everywhere it was logged, not just here — the
   * vocabulary is derived from every entry (see `moodLog.ts`), so a typo
   * typed once otherwise sits in this grid forever with nothing to correct
   * it. If this entry (or a draft not yet saved) had the old text selected,
   * the corrected name stays selected in its place.
   */
  const renameTag = (name: string) => {
    Alert.prompt(
      'Rename tag',
      `Changes every entry that has “${name}”.`,
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: BUTTON_LABEL.save,
          onPress: (text?: string) => {
            const trimmed = (text ?? '').trim();
            if (!trimmed || trimmed === name) return;
            haptics.success();
            renameContextTag(name, trimmed);
            setDraftedContext(current => current.map(t => (contextTagKey(t) === contextTagKey(name) ? trimmed : t)));
            setContextTags(current => renamedContextTags(current, name, trimmed));
          },
        },
      ],
      'plain-text',
      name,
    );
  };

  const createContextTag = (name: string): string | null | void => {
    const trimmed = name.trim();
    if (!trimmed) return 'Give it a name.';
    if (contextPillNames.some(n => contextTagKey(n) === contextTagKey(trimmed))) {
      return 'You already have that one.';
    }
    setDraftedContext(current => [...current, trimmed]);
    animateLayout();
    setContextTags(current => withContextTag(current, trimmed));
  };

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

  const canSave = mood !== null || factors.length > 0 || symptoms.length > 0 || contextTags.length > 0
    || note.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    haptics.success();
    if (editing) {
      updateLog(editing.id, { mood, factors, symptoms, contextTags, note });
    } else {
      // Today records the actual moment; a backdated day records noon on it.
      // Noon rather than midnight for the reason StuckScreen parks its dates
      // there: a date on a day boundary can be dragged across it by a timezone
      // or a DST hour, and the one thing this entry must get right is which
      // day it belongs to.
      const isToday = isSameDay(day, getLogicalToday());
      const at = isToday ? undefined : noonOn(day);
      addLog(mood, symptoms, note, at, contextTags, factors);
      // The saved entry answers the check-in task (recordTasks.ts), so its row
      // plays the tick and leaves. A backdated entry answers nothing, and the
      // request skips any task the entry doesn't answer.
      useTaskStore.getState().autoCompleteRecordTasks('moodLog');
    }
    onClose();
  };

  const moodOptions = MOOD_LEVELS.map(level => ({
    value: level.value as MoodLevel,
    // The face alone: five words across a phone width truncates to "Very…"
    // twice over, and the faces are the half anybody actually reads. The word
    // is spoken to screen readers and printed under the track once picked, so
    // it is never the only thing carrying the meaning. Faces fade only once
    // one is picked, so an empty choice reads as five open options.
    label: level.label,
    accessibilityLabel: level.label,
    node: (selected: boolean) => (
      <MoodFace level={level.value} size={iconSize.xl + 2} dimmed={mood !== null && !selected} />
    ),
  }));

  const requestDelete = () => {
    if (!editing) return;
    const id = editing.id;
    confirmDelete({
      title: 'Delete this entry?',
      message: 'It will be removed from your history and from every number on the Mood screen.',
      onConfirm: () => { haptics.warning(); removeLog(id); onClose(); },
    });
  };

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title={editing ? 'Edit entry' : 'How are you doing?'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={onClose} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} disabled={!canSave} minWidth={64} />}
        />
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

      {/* Mood first: this sheet is the mood log, and longer writing has its own
          place in the Journal (docs/arch/journal.md). */}
      <View style={styles.card}>
        <Text style={styles.groupLabel}>MOOD</Text>
        <SegmentedControl
          options={moodOptions}
          value={mood as MoodLevel}
          onChange={value => setMood(value)}
          onDeselect={() => { haptics.tap(); setMood(null); }}
          label="Mood"
        />
        <Text style={styles.moodCaption}>
          {mood === null ? 'Optional. Leave blank to skip.' : moodLabel(mood)}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.groupLabel}>RATINGS</Text>
        <PillGroup
          noun="rating"
          surface="card"
          onCreate={createFactor}
          filterPlaceholder="Find or add something to rate…"
          options={factorPillNames.map(name => ({
            key: factorKey(name),
            label: name,
            selected: isFactorPicked(name),
            accessibilityLabel: isFactorPicked(name) ? `${name}, picked` : name,
            onPress: () => toggleFactor(name),
          }))}
        />
        {factorPillNames.filter(isFactorPicked).map(name => {
          const rated = factors.find(f => factorKey(f.name) === factorKey(name));
          return (
            <View key={factorKey(name)} style={styles.severityRow}>
              <Text style={styles.severityLabel} numberOfLines={1}>
                {name}{rated ? `: ${factorLabel(rated.value).toLowerCase()}` : ''}
              </Text>
              <SegmentedControl
                options={FACTOR_LEVELS.map(f => ({
                  value: f.value as FactorLevel,
                  label: String(f.value),
                  accessibilityLabel: `${f.value}, ${f.label.toLowerCase()}`,
                }))}
                value={rated?.value as FactorLevel}
                onChange={value => rateFactor(name, value)}
                onDeselect={() => clearFactorRating(name)}
                label={`How high was ${name}`}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.groupLabel}>SYMPTOMS</Text>
        <HelpText style={styles.hint}>
          Whatever you want to keep track of. Add your own names for them.
        </HelpText>
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
              onChange={value => setSeverity(symptom.name, value)}
              label={`How bad was ${symptom.name}`}
            />
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.groupLabel}>CONTEXT</Text>
        <HelpText style={styles.hint}>
          Anything else going on today that might explain how you feel.
        </HelpText>
        <PillGroup
          noun="tag"
          surface="card"
          onCreate={createContextTag}
          filterPlaceholder="Find or add a tag…"
          options={contextPillNames.map(name => ({
            key: contextTagKey(name),
            label: name,
            selected: contextTags.some(t => contextTagKey(t) === contextTagKey(name)),
            onPress: () => toggleContextTag(name),
            onLongPress: () => renameTag(name),
            accessibilityHint: 'Long press to rename.',
          }))}
        />
      </View>

      {/* A short line on why, folded away until asked for. canSave accepts a
          bare note, so it is never required. */}
      <View style={styles.card}>
        {noteOpen ? (
          <>
            <Text style={styles.groupLabel}>NOTE</Text>
            <TextField
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. What’s behind how you feel"
              placeholderTextColor={colors.textTertiary}
              maxLength={NOTE_MAX_LENGTH}
              multiline
              autoFocus={!editing?.note}
              accessibilityLabel="Note about how you’re doing"
            />
          </>
        ) : (
          <InlineAction
            label="Add a note"
            icon="create-outline"
            style={{ alignSelf: 'flex-start' }}
            onPress={() => { haptics.tap(); animateLayout(); setNoteOpen(true); }}
          />
        )}
      </View>

      {/* Where an entry is deleted: a row you can see, in the sheet that's
          about that entry. It used to be a long press on the entry's row in
          three lists, which nothing on screen mentioned and which a held
          scroll could set off. */}
      {editing && (
        <TouchableOpacity
          style={[styles.card, styles.deleteRow]}
          onPress={requestDelete}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel="Delete entry"
        >
          <Ionicons name="trash-outline" size={iconSize.md} color={colors.red} />
          <Text style={styles.deleteText}>Delete entry</Text>
        </TouchableOpacity>
      )}

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
        onConfirm={picked => { if (picked) pickDay(picked); setPickerOpen(false); }}
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
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
  },
  deleteText: {
    color: colors.redText,
    fontSize: font.md,
  },
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
    minHeight: 72,
    textAlignVertical: 'top',
  },
});
