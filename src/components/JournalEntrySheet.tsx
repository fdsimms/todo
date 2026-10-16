import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import type { JournalEntry, JournalKind } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getLogicalToday } from '../utils/dateUtils';
import {
  JOURNAL_KIND_COPY,
  JOURNAL_TAGS_PER_ENTRY,
  JOURNAL_TAG_MAX_LENGTH,
  countWords,
  entriesOnDay,
  journalEntryLink,
  formatWordCount,
  journalPromptAt,
  journalPromptList,
  journalTagKey,
  journalTagsIn,
  normalizeJournalTag,
  openEntries,
  sealShortcuts,
  wordsOnDay,
} from '../utils/journal';
import {
  JOURNAL_DRAFT_DELAY_MS,
  clearJournalDraft,
  readJournalDraft,
  writeJournalDraft,
} from '../utils/journalDraft';
import { addSealedNoteReminder, dropSealedNoteReminder } from '../utils/sealedNoteTasks';
import {
  JOURNAL_HISTORY_OPTIONS,
  canOfferJournalHistory,
  journalHistoryAt,
  journalHistoryTitle,
  type JournalHistoryKind,
} from '../utils/journalHistory';
import { getEditorMentionSuggestions, type MentionSuggestionCandidate } from '../utils/parseTaskInput';
import { groupMentionTokens } from '../utils/peopleRegistry';
import { animateLayout } from '../utils/layoutAnimation';
import { joinNames } from '../utils/shoppingTrip';
import { journalPlainText, toggleLinePrefix, toggleWrap } from '../utils/journalMarkdown';
import { confirmDiscard } from '../utils/confirmDiscard';
import { useJournalStore } from '../store/useJournalStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { EditorSheet } from './EditorSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorRow } from './EditorRow';
import { WhenPicker } from './WhenPicker';
import { TextField } from './TextField';
import { InlineAction } from './InlineAction';
import { CollapsibleField } from './CollapsibleField';
import { PillGroup } from './PillGroup';
import { PressableScale } from './PressableScale';
import { SegmentedControl } from './SegmentedControl';
import { JournalText } from './JournalText';
import { JOURNAL_FORMAT_BAR_HEIGHT, JournalFormatBar, type FormatAction } from './JournalFormatBar';
import { useTitleSelection } from '../hooks/useTitleSelection';

const TEXT_MAX_LENGTH = 5000;

/** Noon on a picked day, the anchor a backdated mood entry uses. */
function noonOn(day: Date): Date {
  const at = new Date(day);
  at.setHours(12, 0, 0, 0);
  return at;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function dayLabel(day: Date): string {
  return isSameDay(day, getLogicalToday()) ? 'Today' : format(day, 'EEE, MMM d');
}

interface Props {
  visible: boolean;
  kind: JournalKind;
  /** The entry being edited, or null to write a new one. */
  editing?: JournalEntry | null;
  onClose: () => void;
}

/**
 * Writing a journal entry or a dream — see `docs/arch/journal.md`.
 *
 * An `EditorSheet`, as `MoodLogSheet` is, so there is no swipe to bypass Save
 * with, and Cancel asks before discarding changed text. The Day row shows only
 * for a new entry, for the mood sheet's reason: an entry's day is fixed once
 * written. Saving a new entry for today ticks off that kind's reminder task.
 *
 * A new entry on a day that already has some shows them above the field, read
 * only, so a snippet written at 3pm carries on from the morning's rather than
 * starting a blank page. The screen draws the day's snippets as one page.
 */
export function JournalEntrySheet({ visible, kind, editing = null, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const copy = JOURNAL_KIND_COPY[kind];
  const addEntry = useJournalStore(s => s.addEntry);
  const updateEntry = useJournalStore(s => s.updateEntry);
  const removeEntry = useJournalStore(s => s.removeEntry);
  const allEntries = useJournalStore(s => s.entries);
  const completeJournalTaskForToday = useTaskStore(s => s.completeJournalTaskForToday);
  const setEntryMeta = useJournalStore(s => s.setEntryMeta);
  const wordGoal = useSettingsStore(s => s.journalWordGoal);
  const customPrompts = useSettingsStore(s => s.journalCustomPrompts);
  const allPeople = usePersonStore(s => s.people);

  const [text, setText] = useState('');
  const [day, setDay] = useState<Date>(() => getLogicalToday());
  const [pickerOpen, setPickerOpen] = useState(false);
  // A note to your future self: the day it opens, or null for an ordinary
  // entry (JournalEntry.openOn). Offered on a new journal entry for today only.
  const [openOn, setOpenOn] = useState<Date | null>(null);
  const [openOnPickerOpen, setOpenOnPickerOpen] = useState(false);
  // Which writing prompt is showing, or null for none. Only ever set by a tap:
  // a prompt is offered, never put in front of you or written into the entry.
  const [promptIndex, setPromptIndex] = useState<number | null>(null);
  // Labels and people the person attaches (JournalEntry.tags / personIds).
  const [tags, setTags] = useState<string[]>([]);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  // Whether to also write this page into the named people's history, and as
  // what. Null until picked: it is offered, never decided for the person.
  const [historyKind, setHistoryKind] = useState<JournalHistoryKind | null>(null);
  // Whether the text on the page came back from a kept draft, said once.
  const [restoredDraft, setRestoredDraft] = useState(false);
  // The selection is tracked for the formatting bar (see useTitleSelection for
  // why it is never fed back except on the one render an edit places it), and
  // focus is tracked because a floating bar has no native tie to the field.
  const caret = useTitleSelection(text);
  const [focused, setFocused] = useState(false);

  // Reseeds on every open, so a reopened sheet never hands back a half-written page.
  useEffect(() => {
    if (!visible) return;
    // A new entry picks up the draft left by an interrupted one; an edit has
    // its saved words and no draft.
    const draft = editing ? null : readJournalDraft(kind);
    const seed = editing?.text ?? draft ?? '';
    setText(seed);
    caret.resetCaret(seed);
    setRestoredDraft(draft !== null);
    setTags(editing?.tags ?? []);
    setPersonIds(editing?.personIds ?? []);
    setTagsOpen(false);
    setPeopleOpen(false);
    setHideOpen(false);
    setHistoryKind(null);
    setDay(getLogicalToday());
    setPickerOpen(false);
    setOpenOn(null);
    setOpenOnPickerOpen(false);
    setPromptIndex(null);
    // caret's functions are stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing]);

  // Keeps a new entry's words as a draft while they are typed. The first run
  // after a reopen carries the stale blank text, but the seed above changes
  // `text` before the delay passes, which cancels that write.
  useEffect(() => {
    if (!visible || editing) return;
    const timer = setTimeout(() => writeJournalDraft(kind, text), JOURNAL_DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, editing, kind, text]);

  // A formatting button: rewrite the text round the selection, then put the
  // selection back over the same words (or the caret between an empty pair).
  const applyFormat = (action: FormatAction) => {
    const selection = caret.getSelection();
    const edit = 'wrap' in action
      ? toggleWrap(text, selection, action.wrap)
      : toggleLinePrefix(text, selection, action.line);
    if (edit.text.length > TEXT_MAX_LENGTH) return;
    setText(edit.text);
    caret.selectRange(edit.selection, edit.text);
  };

  // The day's page so far, for a new entry only: an edit is one snippet of it.
  const soFar = useMemo(
    // Never a sealed note: its words don't show anywhere before its day.
    () => (editing ? [] : entriesOnDay(openEntries(allEntries, dayKeyOf(getLogicalToday())), kind, dayKeyOf(day))),
    [editing, allEntries, kind, day],
  );
  const soFarLabel = isSameDay(day, getLogicalToday())
    ? 'SO FAR TODAY'
    : `ALREADY WRITTEN ON ${format(day, 'EEE, MMM d').toUpperCase()}`;

  // The day's words, this entry's included as it is typed: the goal is a day's,
  // so the other snippets on the page count toward it. Never a sealed note.
  const wordsDay = editing ? editing.dayKey : dayKeyOf(day);
  const otherWords = useMemo(() => {
    const open = openEntries(allEntries, dayKeyOf(getLogicalToday())).filter(e => e.id !== editing?.id);
    return wordsOnDay(open, kind, wordsDay);
  }, [allEntries, editing, kind, wordsDay]);
  const dayWords = otherWords + countWords(text);
  const entryWords = countWords(text);
  const goal = kind === 'journal' ? wordGoal : null;
  const wordsLine = goal === null
    ? formatWordCount(entryWords)
    : `${dayWords.toLocaleString('en-US')} of ${goal.toLocaleString('en-US')} words${dayWords >= goal ? ' · Goal reached' : ''}`;

  const prompts = useMemo(() => journalPromptList(customPrompts), [customPrompts]);
  const metaChanged = !!editing && (
    !sameList(tags, editing.tags ?? []) || !sameList(personIds, editing.personIds ?? [])
  );
  const canSave = text.trim().length > 0 && (!editing || text.trim() !== editing.text || metaChanged);

  // Tags already in use on this kind (open entries only, so a sealed note's
  // labels aren't shown early), then any picked in this sheet.
  const tagChoices = useMemo(() => {
    const used = journalTagsIn(openEntries(allEntries, dayKeyOf(getLogicalToday())), kind);
    const keys = new Set(used.map(journalTagKey));
    return [...used, ...tags.filter(t => !keys.has(journalTagKey(t)))];
  }, [allEntries, kind, tags]);
  const pickablePeople = useMemo(
    () => allPeople.filter(p => !p.archived || personIds.includes(p.id)),
    [allPeople, personIds],
  );
  const shortcuts = useMemo(() => sealShortcuts(dayKeyOf(getLogicalToday())), [visible]);
  // Sealing is for a page written now: a backdated entry is filling in a day
  // that has gone, not leaving a note for one to come.
  const canSeal = kind === 'journal' && !editing && isSameDay(day, getLogicalToday());

  // An "@name" at the end of the page offers the matching people to link, the
  // task editor's rule: the text alone never links anybody, the tap does. Only
  // the token being typed at the very end is read, so a mention edited into the
  // middle of a page is linked from the About row instead.
  const mentionSuggestion = useMemo(
    () => (visible && text.includes('@')
      ? getEditorMentionSuggestions(text, allPeople.filter(p => !p.archived), personIds, groupMentionTokens())
      : null),
    [visible, text, allPeople, personIds],
  );
  const applyMentionSuggestion = (candidate: MentionSuggestionCandidate) => {
    if (!mentionSuggestion) return;
    haptics.success();
    animateLayout();
    const next = `${text.slice(0, mentionSuggestion.start)}@${candidate.resolveKey} `;
    if (next.length > TEXT_MAX_LENGTH) return;
    setText(next);
    caret.moveCaret(next);
    const newIds = candidate.memberIds ?? [candidate.id];
    setPersonIds(list => [...new Set([...list, ...newIds])]);
  };

  // Offered once somebody is named on a new page, and written only when one of
  // the choices is picked and the entry is saved.
  const namedPeople = useMemo(
    () => personIds.map(id => allPeople.find(p => p.id === id)).filter(p => !!p).map(p => displayNameOf(p!)),
    [personIds, allPeople],
  );
  const offerHistory = canOfferJournalHistory({
    kind,
    editing: !!editing,
    sealed: canSeal && !!openOn,
    personCount: namedPeople.length,
  });

  const save = () => {
    if (!canSave) return;
    haptics.success();
    if (editing) {
      updateEntry(editing.id, text);
      if (metaChanged) setEntryMeta(editing.id, { tags, personIds });
    } else {
      const isToday = isSameDay(day, getLogicalToday());
      const sealUntil = canSeal && openOn ? dayKeyOf(openOn) : null;
      const entry = addEntry(kind, text, isToday ? undefined : noonOn(day), sealUntil, { tags, personIds });
      if (entry?.openOn) addSealedNoteReminder(entry);
      // Writing is what the reminder asks for. Only a new entry for today: the
      // day you missed filled in later is not today's entry.
      if (isToday) completeJournalTaskForToday(kind);
      // The same record the person's own "Add to history" row writes, for
      // everybody the page names, only when it was asked for here.
      if (offerHistory && historyKind) {
        useTaskStore.getState().addCompletedTask(
          journalHistoryTitle(historyKind, namedPeople),
          journalHistoryAt(day, isToday, new Date()),
          personIds,
          entry ? journalEntryLink(entry.id) : undefined,
        );
      }
      clearJournalDraft(kind);
    }
    onClose();
  };

  // A journal page can be long, so Cancel asks before throwing words away.
  // The copy is TaskEditor's own handleCancel's.
  const handleCancel = () => {
    const dirty = text.trim() !== (editing?.text ?? '') || metaChanged || (!editing && (tags.length > 0 || personIds.length > 0));
    if (!dirty) { if (!editing) clearJournalDraft(kind); onClose(); return; }
    confirmDiscard(() => { if (!editing) clearJournalDraft(kind); onClose(); });
  };

  const confirmDelete = () => {
    if (!editing) return;
    const id = editing.id;
    Alert.alert(`Delete this ${copy.one}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => { haptics.warning(); removeEntry(id); dropSealedNoteReminder(id); onClose(); },
      },
    ]);
  };

  const title = editing
    ? (kind === 'dream' ? 'Edit dream' : 'Edit entry')
    : (kind === 'dream' ? 'Write down a dream' : 'Journal');

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={handleCancel}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      footer={<JournalFormatBar focused={visible && focused} onFormat={applyFormat} />}
      keyboardAccessoryHeight={JOURNAL_FORMAT_BAR_HEIGHT}
      header={
        <SheetHeader
          bare
          title={title}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label="Save" onPress={save} disabled={!canSave} minWidth={64} />}
        />
      }
    >
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

      {soFar.length > 0 && (
        <>
          <Text style={styles.soFarLabel}>{soFarLabel}</Text>
          <View style={styles.card}>
            {soFar.map((entry, index) => (
              <View
                key={entry.id}
                style={index > 0 && styles.soFarGap}
                accessible
                accessibilityLabel={`${format(new Date(entry.loggedAt), 'h:mm a')}. ${journalPlainText(entry.text)}`}
              >
                <Text style={styles.soFarTime}>{format(new Date(entry.loggedAt), 'h:mm a')}</Text>
                <JournalText text={entry.text} textStyle={styles.soFarText} />
              </View>
            ))}
          </View>
        </>
      )}

      <View style={styles.card}>
        {copy.hint && <Text style={styles.hint}>{copy.hint}</Text>}
        <TextField
          style={styles.input}
          value={text}
          onChangeText={setText}
          selection={caret.selection}
          onSelectionChange={caret.onSelectionChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={canSeal && openOn ? 'e.g. What you want to tell yourself then' : soFar.length > 0 ? copy.continuePlaceholder : copy.placeholder}
          placeholderTextColor={colors.textTertiary}
          maxLength={TEXT_MAX_LENGTH}
          multiline
          autoFocus={!editing}
          accessibilityLabel={kind === 'dream' ? 'A dream you remember' : 'Journal entry'}
        />
        <Text style={styles.wordCount}>{wordsLine}</Text>
        {restoredDraft && <Text style={styles.wordCount}>Restored the draft you hadn’t saved.</Text>}
        {mentionSuggestion && (
          <View style={styles.mentionRow}>
            {mentionSuggestion.candidates.map(candidate => (
              <PressableScale
                key={candidate.id}
                style={styles.mentionButton}
                haptic
                onPress={() => applyMentionSuggestion(candidate)}
                accessibilityLabel={`Link ${candidate.name} to this entry`}
              >
                <Ionicons name="person-add-outline" size={iconSize.sm} color={colors.onAccent} />
                <Text style={styles.mentionText} numberOfLines={1}>{candidate.name}</Text>
              </PressableScale>
            ))}
          </View>
        )}
        {kind === 'journal' && promptIndex !== null && (
          <Text style={styles.prompt}>{journalPromptAt(promptIndex, prompts)}</Text>
        )}
        {/* Only on a blank page: once there are words, a prompt is in the way. */}
        {kind === 'journal' && !editing && text.trim().length === 0 && (
          <InlineAction
            label={promptIndex === null ? 'Suggest a prompt' : 'Another prompt'}
            icon="bulb-outline"
            variant="neutral"
            surface="card"
            style={{ alignSelf: 'flex-start', marginTop: promptIndex === null ? spacing.sm : 0 }}
            // Seeded from the day so the first prompt differs from one day to
            // the next; tapping again steps through the rest in order.
            onPress={() => setPromptIndex(i => (i === null ? Math.floor(day.getTime() / 86400000) : i + 1))}
          />
        )}
      </View>

      {/* What the light formatting is, said once where it's typed. */}
      <Text style={styles.formatHint}>
        Use the buttons above the keyboard, or type **bold**, *italics*, # for a heading, - for a list item and &gt; for a quote.
      </Text>

      <View style={styles.card}>
        <CollapsibleField
          label="Tags"
          summary={tags.length > 0 ? tags.join(', ') : undefined}
          hint="Labels you choose, to find entries by later. Nothing is added for you."
          expanded={tagsOpen}
          onToggle={() => { haptics.tap(); setTagsOpen(o => !o); }}
        >
          <PillGroup
            noun="tag"
            surface="card"
            createMaxLength={JOURNAL_TAG_MAX_LENGTH}
            options={tagChoices.map(tag => {
              const on = tags.some(t => journalTagKey(t) === journalTagKey(tag));
              return {
                key: journalTagKey(tag),
                label: tag,
                selected: on,
                onPress: () => {
                  haptics.tap();
                  setTags(list => on ? list.filter(t => journalTagKey(t) !== journalTagKey(tag)) : [...list, tag]);
                },
              };
            })}
            onCreate={name => {
              const tag = normalizeJournalTag(name);
              if (!tag) return 'Enter a tag.';
              if (tags.some(t => journalTagKey(t) === journalTagKey(tag))) return 'That tag is already on this entry.';
              if (tags.length >= JOURNAL_TAGS_PER_ENTRY) return `An entry can have up to ${JOURNAL_TAGS_PER_ENTRY} tags.`;
              setTags(list => [...list, tag]);
            }}
          />
        </CollapsibleField>
        <CollapsibleField
          label="About"
          summary={personIds.length > 0
            ? personIds.map(id => allPeople.find(p => p.id === id)).filter(p => !!p).map(p => displayNameOf(p!)).join(', ')
            : undefined}
          hint="People this is about. The entry is listed on their page."
          expanded={peopleOpen}
          onToggle={() => { haptics.tap(); setPeopleOpen(o => !o); }}
        >
          <PillGroup
            noun="person"
            pluralNoun="people"
            surface="card"
            options={pickablePeople.map(p => {
              const on = personIds.includes(p.id);
              return {
                key: p.id,
                label: displayNameOf(p),
                selected: on,
                onPress: () => {
                  haptics.tap();
                  setPersonIds(list => on ? list.filter(id => id !== p.id) : [...list, p.id]);
                },
              };
            })}
            onCreate={name => {
              const person = usePersonStore.getState().createPerson(name);
              setPersonIds(list => [...list, person.id]);
            }}
          />
        </CollapsibleField>
        {canSeal && (
          <CollapsibleField
            label="Hide until"
            summary={openOn ? format(openOn, 'EEE, MMM d, yyyy') : undefined}
            emptySummary="Not hidden"
            hint="Save this as a note to your future self."
            expanded={hideOpen}
            onToggle={() => { haptics.tap(); setHideOpen(o => !o); }}
          >
            <View style={styles.shortcuts}>
              {shortcuts.map(shortcut => (
                <InlineAction
                  key={shortcut.label}
                  label={shortcut.label}
                  variant="neutral"
                  surface="card"
                  onPress={() => { haptics.tap(); setOpenOn(new Date(`${shortcut.dayKey}T12:00:00`)); }}
                />
              ))}
              <InlineAction
                label="Pick a date"
                variant="neutral"
                surface="card"
                onPress={() => { haptics.tap(); setOpenOnPickerOpen(true); }}
              />
            </View>
            {openOn && (
              <Text style={styles.sealHint}>
                You won’t be able to read this until that day. A task will remind you to open it. You can also open it early from the Journal.
              </Text>
            )}
          </CollapsibleField>
        )}
      </View>

      {offerHistory && (
        <View style={styles.card}>
          <Text style={styles.historyLabel}>Count this as time with {joinNames(namedPeople)}?</Text>
          <SegmentedControl<JournalHistoryKind | 'none'>
            label="Add to their history"
            options={[
              { value: 'none', label: 'Don’t add' },
              ...JOURNAL_HISTORY_OPTIONS.map(o => ({ value: o.kind, label: o.label })),
            ]}
            value={historyKind ?? 'none'}
            onChange={value => { haptics.tap(); setHistoryKind(value === 'none' ? null : value); }}
          />
          <Text style={styles.historyHint}>
            Adds an entry to their history when you save. Nothing is added unless you pick one.
          </Text>
        </View>
      )}

      {editing && (
        <TouchableOpacity
          style={[styles.card, styles.deleteRow]}
          onPress={confirmDelete}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${copy.one}`}
        >
          <Ionicons name="trash-outline" size={iconSize.md} color={colors.red} />
          <Text style={styles.deleteText}>Delete {copy.one}</Text>
        </TouchableOpacity>
      )}

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
      <WhenPicker
        visible={openOnPickerOpen}
        value={openOn}
        title="Hide until which day?"
        allowPast={false}
        showTimeOfDay={false}
        showSuggest={false}
        // Today is no later at all, so picking it (or clearing) leaves the
        // entry open as soon as it's saved.
        onConfirm={picked => {
          setOpenOn(picked && !isSameDay(picked, getLogicalToday()) ? picked : null);
          setOpenOnPickerOpen(false);
        }}
        onCancel={() => setOpenOnPickerOpen(false)}
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
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  soFarLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  soFarGap: { marginTop: spacing.smd },
  soFarTime: {
    fontSize: font.xs,
    color: colors.textSecondary,
    marginBottom: spacing.xxs,
  },
  soFarText: {
    fontSize: font.sm,
    color: colors.textSecondary,
  },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.sm },
  mentionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xsm, marginTop: spacing.sm },
  mentionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsm,
    maxWidth: '100%',
    paddingHorizontal: spacing.smd,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
  },
  mentionText: {
    color: colors.onAccent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  historyLabel: {
    fontSize: font.md,
    color: colors.text,
    marginBottom: spacing.smd,
  },
  historyHint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  sealHint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  hint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    fontSize: font.md,
    color: colors.text,
    minHeight: 220,
    textAlignVertical: 'top',
  },
  wordCount: {
    fontSize: font.xs,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  prompt: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  formatHint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
  },
  deleteText: {
    color: colors.redText,
    fontSize: font.md,
  },
});
