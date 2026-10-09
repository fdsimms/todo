import React, { useState } from 'react';
import { Alert, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useColors } from '../../theme/ThemeContext';
import { iconSize } from '../../theme';
import { animateLayout } from '../../utils/layoutAnimation';
import { haptics } from '../../utils/haptics';
import {
  addAgentNote,
  editAgentNote,
  readAgentNotes,
  removeAgentNote,
  writeAgentNotes,
  type AgentNote,
} from '../../utils/agentNotes';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * What Claude is asked to keep in mind, in Settings › Data and reset › Sync,
 * beside the server it reads them from. Claude adds notes when told to remember
 * something; this is where they are read, edited and removed, so nothing it
 * keeps about the person is out of their sight.
 *
 * Reads the list when the screen gains focus, the `SavedPlacesRows` shape: it is
 * a plain synced setting (`agentNotes`), and a note added from a conversation
 * shows on the next visit.
 */
export function AgentNotesRows() {
  const colors = useColors();
  const styles = makeSettingsStyles(colors);
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [open, setOpen] = useState(false);

  useFocusEffect(React.useCallback(() => { setNotes(readAgentNotes()); }, []));

  const commit = (next: AgentNote[]) => {
    animateLayout();
    writeAgentNotes(next);
    setNotes(next);
  };

  const add = () => {
    Alert.prompt(
      'Add a note for Claude',
      'Something for Claude to keep in mind when it works with your list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (text?: string) => {
            const result = addAgentNote(notes, text ?? '');
            if (!result.ok) {
              Alert.alert('Not added', result.reason);
              return;
            }
            haptics.success();
            commit(result.notes);
            setOpen(true);
          },
        },
      ],
      'plain-text',
    );
  };

  const edit = (note: AgentNote) => {
    Alert.prompt(
      'Edit note',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (text?: string) => {
            if ((text ?? '').trim() === note.text) return;
            haptics.success();
            commit(editAgentNote(notes, note.id, text ?? ''));
          },
        },
      ],
      'plain-text',
      note.text,
    );
  };

  const remove = (note: AgentNote) => {
    Alert.alert(
      'Remove this note?',
      'Claude will no longer be reminded of it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { haptics.warning(); commit(removeAgentNote(notes, note.id)); } },
      ],
    );
  };

  return (
    <>
      <View style={styles.sep} />
      <SettingsRow
        entryId="agentNotes"
        icon="chatbubble-ellipses-outline"
        iconColor={notes.length > 0 ? colors.accent : undefined}
        label="Notes for Claude"
        hint={notes.length === 0
          ? 'Things for Claude to keep in mind when it works with your list through the sync server, like “errands happen on Saturdays”. Claude adds them when you ask it to remember something.'
          : 'Claude reads these every time it starts working with your list.'}
        value={notes.length > 0 ? String(notes.length) : undefined}
        expanded={notes.length > 0 ? open : undefined}
        onPress={notes.length > 0 ? () => { animateLayout(); setOpen(v => !v); } : add}
        accessibilityLabel="Notes for Claude"
      />
      {open && notes.map(note => (
        <React.Fragment key={note.id}>
          <View style={styles.sep} />
          <SettingsRow
            icon="document-text-outline"
            label={note.text}
            onPress={() => edit(note)}
            accessibilityLabel={`Edit note: ${note.text}`}
            trailing={(
              <TouchableOpacity
                onPress={() => remove(note)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove note: ${note.text}`}
              >
                <Ionicons name="trash-outline" size={iconSize.sm} color={colors.red} />
              </TouchableOpacity>
            )}
          />
        </React.Fragment>
      ))}
      {open && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="add"
            iconColor={colors.accent}
            label="Add a note"
            onPress={add}
            accessibilityLabel="Add a note for Claude"
          />
        </>
      )}
    </>
  );
}
