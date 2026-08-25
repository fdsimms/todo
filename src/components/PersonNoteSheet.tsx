import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { PersonNote, PersonNoteKind } from '../types';
import { PERSON_NOTE_KINDS } from '../types';
import { usePersonNoteStore } from '../store/usePersonNoteStore';
import { EditorSheet } from './EditorSheet';
import { EditorRow } from './EditorRow';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { WhenPicker } from './WhenPicker';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  PERSON_NOTE_HINTS,
  PERSON_NOTE_LABELS,
  describeNoteDay,
} from '../utils/personNotes';
import { getCurrentDayStart } from '../utils/dateUtils';

const NOTE_MAX_LENGTH = 240;

interface Props {
  visible: boolean;
  personId: string;
  /** Who it's about, for the sheet's own title. */
  personName: string;
  /** The note being edited, or null to write a new one. */
  note: PersonNote | null;
  /** Which kind a new note starts as — the section its "Add" was tapped in. */
  initialKind?: PersonNoteKind;
  onClose: () => void;
}

/**
 * Writing one thing down about somebody — see `docs/arch/people.md` and
 * `utils/personNotes.ts`.
 *
 * Three fields and no more: what it says, which kind it is, and the day it is
 * about. **The kind is a `SegmentedControl` rather than three separate add
 * buttons** because it is exactly what that control is for — one of a small
 * closed set — and because the three read as one question ("what sort of thing
 * is this?") rather than as three places to go.
 *
 * The date is optional and null by default, which is the common case rather
 * than a skipped step: "no shellfish" is not about a day. `allowPast` stays on,
 * unlike a chain step's answer, because a note can perfectly well be about
 * something that already happened and it is the *staleness* that follows from
 * the date rather than the other way round.
 */
export function PersonNoteSheet({ visible, personId, personName, note, initialKind = 'note', onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const addNote = usePersonNoteStore(s => s.addNote);
  const updateNote = usePersonNoteStore(s => s.updateNote);
  const removeNote = usePersonNoteStore(s => s.removeNote);

  const [text, setText] = useState('');
  const [kind, setKind] = useState<PersonNoteKind>(initialKind);
  const [relevantOn, setRelevantOn] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setText(note?.text ?? '');
    setKind(note?.kind ?? initialKind);
    setRelevantOn(note?.relevantOn ?? null);
    setShowDatePicker(false);
  }, [visible, note, initialKind]);

  const saveAndClose = () => {
    const trimmed = text.trim();
    if (note) {
      // An emptied note is a deleted one rather than a blank row: the field is
      // the whole content, so clearing it is the only thing it could mean.
      if (!trimmed) removeNote(note.id);
      else updateNote(note.id, { text: trimmed, kind, relevantOn });
    } else if (trimmed) {
      addNote(personId, kind, trimmed, relevantOn);
    }
    onClose();
  };

  const handleDelete = () => {
    if (!note) { onClose(); return; }
    Alert.alert('Delete this note?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { removeNote(note.id); onClose(); } },
    ]);
  };

  const today = getCurrentDayStart();

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {note ? 'Edit note' : `About ${personName}`}
          </Text>
          {note ? (
            <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete note">
              <Ionicons name="trash-outline" size={20} color={colors.red} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </>
      }
      footer={
        <WhenPicker
          visible={showDatePicker}
          value={relevantOn ? new Date(relevantOn) : null}
          title="Date"
          showTimeOfDay={false}
          showSuggest={false}
          onConfirm={date => { setRelevantOn(date ? date.toISOString() : null); setShowDatePicker(false); }}
          onClear={() => { setRelevantOn(null); setShowDatePicker(false); }}
          onCancel={() => setShowDatePicker(false)}
        />
      }
    >
      <TextInput
        style={styles.textInput}
        value={text}
        onChangeText={setText}
        placeholder="e.g. Starts the new job in September"
        placeholderTextColor={colors.textTertiary}
        maxLength={NOTE_MAX_LENGTH}
        multiline
        autoFocus={!note}
        accessibilityLabel="Note"
      />

      <SegmentedControl
        label="Kind"
        options={PERSON_NOTE_KINDS.map(k => ({ value: k, label: PERSON_NOTE_LABELS[k] }))}
        value={kind}
        onChange={next => { haptics.tap(); setKind(next); }}
      />
      <Text style={styles.hint}>{PERSON_NOTE_HINTS[kind]}</Text>

      <EditorRow
        icon="calendar-outline"
        label="Date"
        value={relevantOn ? describeNoteDay(relevantOn, today) : 'Any time'}
        onPress={() => { haptics.tap(); setShowDatePicker(true); }}
      />
      <Text style={styles.hint}>
        The day this note is about. It's shown quieter once that day has passed, and never deleted.
      </Text>
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // `flex: 1` is load-bearing, not decoration: EditorSheet's root is a plain
  // View, so without it the root sizes to its content, the scroll's own
  // `flex: 1` resolves against an auto height and collapses to nothing, and the
  // sheet opens as a header over an empty screen. Same reason the header needs
  // `flexDirection: 'row'` — a title with `flex: 1` in a column measures zero.
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: {
    flex: 1, textAlign: 'center', color: colors.text,
    fontSize: font.md, fontWeight: fontWeight.semibold,
  },
  // Matches the trash button's width so the title stays optically centred, the
  // same job SheetHeaderButton's own minWidth does on the other side.
  headerSpacer: { width: 20 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  textInput: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: font.md,
    minHeight: 88,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  // Between a control and the next one, not jammed under it: spacing.md above
  // as well as below, so the row beneath has a gap of its own.
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: 17,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
});
