import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { EditorSheet } from './EditorSheet';
import { EditorRow } from './EditorRow';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CalendarPicker } from './CalendarPicker';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';

/** The fields of a `HistoryEntry` this sheet actually needs. */
export interface EditableHistoryEntry {
  taskId: string;
  title: string;
  /** ISO. */
  at: string;
}

interface Props {
  visible: boolean;
  /** Who the entry is about, for the default title and the delete prompt. */
  personName: string;
  /** The entry being edited, or null while adding a new one. */
  entry: EditableHistoryEntry | null;
  onSave: (title: string, at: Date) => void;
  onDelete: (taskId: string) => void;
  onClose: () => void;
}

/**
 * What you did together, and when — the sheet behind both "Add to history"
 * and tapping an existing row on `PersonDetailScreen`.
 *
 * **Adding one used to write "Time with {name}" at the current instant with
 * no confirmation at all** — a single tap, nothing shown first. That is what
 * made the entry it left behind both generic and a surprise: there was no
 * step where the title or the date were visible before they were saved. This
 * sheet is that step. The title field opens pre-filled with the same default
 * text the silent version used to write, so a tap on Save with nothing
 * touched reproduces the old behavior exactly — the only change is that it is
 * now something you see and can edit rather than something that already
 * happened by the time you'd know what it said.
 *
 * **Editing reuses the same sheet** rather than a second component, because
 * an existing history entry and a new one are the same two fields (what, and
 * when) on the same kind of row — an ordinary completed task naming this
 * person, per `docs/arch/people.md`. Delete lives in the body, not the
 * header, because the header is already spent on Cancel/Save: a sheet that
 * stages a title and a date before an explicit commit needs a real way to
 * back out, the same as any other sheet holding unsaved typed state.
 */
export function PersonHistorySheet({ visible, personName, entry, onSave, onDelete, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [title, setTitle] = useState('');
  const [at, setAt] = useState(() => new Date());
  const [showCalendar, setShowCalendar] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(entry ? entry.title : `Time with ${personName}`);
    setAt(entry ? new Date(entry.at) : new Date());
    setShowCalendar(false);
  }, [visible, entry, personName]);

  const trimmed = title.trim();

  const save = () => {
    if (!trimmed) return;
    haptics.success();
    onSave(trimmed, at);
  };

  const handleDelete = () => {
    if (!entry) return;
    confirmDelete({
      title: 'Delete Entry',
      message: `Delete "${entry.title}" from ${personName}'s history? You can undo this by shaking your phone right after.`,
      onConfirm: () => onDelete(entry.taskId),
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
        <>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={56} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {entry ? 'Edit entry' : 'Add to history'}
          </Text>
          <SheetHeaderButton label="Save" onPress={save} disabled={!trimmed} minWidth={56} />
        </>
      }
      footer={
        <CalendarPicker
          visible={showCalendar}
          value={at}
          mode="datetime"
          title="When"
          onConfirm={date => { setAt(date); setShowCalendar(false); }}
          onCancel={() => setShowCalendar(false)}
        />
      }
    >
      <TextInput
        style={styles.textInput}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Coffee downtown"
        placeholderTextColor={colors.textTertiary}
        autoFocus={!entry}
        accessibilityLabel="What you did together"
      />

      <EditorRow
        icon="calendar-outline"
        label="When"
        value={format(at, 'MMM d, h:mm a')}
        onPress={() => setShowCalendar(true)}
      />
      {!entry && (
        <Text style={styles.hint}>
          Saved to your history with {personName} right away — check the title and date first.
        </Text>
      )}

      {entry && (
        <TouchableOpacity
          style={styles.deleteRow}
          onPress={handleDelete}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel="Delete entry"
        >
          <Ionicons name="trash-outline" size={18} color={colors.red} />
          <Text style={styles.deleteLabel}>Delete Entry</Text>
        </TouchableOpacity>
      )}
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
  headerTitle: {
    flex: 1, textAlign: 'center', color: colors.text,
    fontSize: font.md, fontWeight: fontWeight.semibold,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  textInput: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: font.md,
    marginBottom: spacing.md,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: 17,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing.lg,
  },
  deleteLabel: { color: colors.red, fontSize: font.md, fontWeight: fontWeight.medium },
});
