import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import type { JournalEntry, JournalKind } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { getLogicalToday } from '../utils/dateUtils';
import { JOURNAL_KIND_COPY, journalPromptAt } from '../utils/journal';
import { toggleLinePrefix, toggleWrap } from '../utils/journalMarkdown';
import { useJournalStore } from '../store/useJournalStore';
import { useTaskStore } from '../store/useTaskStore';
import { EditorSheet } from './EditorSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorRow } from './EditorRow';
import { WhenPicker } from './WhenPicker';
import { TextField } from './TextField';
import { InlineAction } from './InlineAction';
import { JOURNAL_FORMAT_BAR_HEIGHT, JournalFormatBar, type FormatAction } from './JournalFormatBar';
import { useTitleSelection } from '../hooks/useTitleSelection';

const TEXT_MAX_LENGTH = 5000;

/** Noon on a picked day, the anchor a backdated mood entry uses. */
function noonOn(day: Date): Date {
  const at = new Date(day);
  at.setHours(12, 0, 0, 0);
  return at;
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
 */
export function JournalEntrySheet({ visible, kind, editing = null, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const copy = JOURNAL_KIND_COPY[kind];
  const addEntry = useJournalStore(s => s.addEntry);
  const updateEntry = useJournalStore(s => s.updateEntry);
  const removeEntry = useJournalStore(s => s.removeEntry);
  const completeJournalTaskForToday = useTaskStore(s => s.completeJournalTaskForToday);

  const [text, setText] = useState('');
  const [day, setDay] = useState<Date>(() => getLogicalToday());
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which writing prompt is showing, or null for none. Only ever set by a tap:
  // a prompt is offered, never put in front of you or written into the entry.
  const [promptIndex, setPromptIndex] = useState<number | null>(null);
  // The selection is tracked for the formatting bar (see useTitleSelection for
  // why it is never fed back except on the one render an edit places it), and
  // focus is tracked because a floating bar has no native tie to the field.
  const caret = useTitleSelection(text);
  const [focused, setFocused] = useState(false);

  // Reseeds on every open, so a reopened sheet never hands back a half-written page.
  useEffect(() => {
    if (!visible) return;
    setText(editing?.text ?? '');
    caret.resetCaret(editing?.text ?? '');
    setDay(getLogicalToday());
    setPickerOpen(false);
    setPromptIndex(null);
    // caret's functions are stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing]);

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

  const canSave = text.trim().length > 0 && (!editing || text.trim() !== editing.text);

  const save = () => {
    if (!canSave) return;
    haptics.success();
    if (editing) {
      updateEntry(editing.id, text);
    } else {
      const isToday = isSameDay(day, getLogicalToday());
      addEntry(kind, text, isToday ? undefined : noonOn(day));
      // Writing is what the reminder asks for. Only a new entry for today: the
      // day you missed filled in later is not today's entry.
      if (isToday) completeJournalTaskForToday(kind);
    }
    onClose();
  };

  // A journal page can be long, so Cancel asks before throwing words away.
  // The copy is TaskEditor's own handleCancel's.
  const handleCancel = () => {
    const dirty = text.trim() !== (editing?.text ?? '');
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const confirmDelete = () => {
    if (!editing) return;
    const id = editing.id;
    Alert.alert(`Delete this ${copy.one}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => { haptics.warning(); removeEntry(id); onClose(); },
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
          placeholder={copy.placeholder}
          placeholderTextColor={colors.textTertiary}
          maxLength={TEXT_MAX_LENGTH}
          multiline
          autoFocus={!editing}
          accessibilityLabel={kind === 'dream' ? 'A dream you remember' : 'Journal entry'}
        />
        {kind === 'journal' && promptIndex !== null && (
          <Text style={styles.prompt}>{journalPromptAt(promptIndex)}</Text>
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
