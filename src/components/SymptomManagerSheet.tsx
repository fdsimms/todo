import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { symptomEntryCount, symptomKey, symptomVocabulary } from '../utils/moodLog';
import { useMoodStore } from '../store/useMoodStore';
import { EditorSheet } from './EditorSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Every symptom you have ever logged, and the one thing you can do to it.
 *
 * The correction path a freeform vocabulary needs. Symptom names are whatever
 * you typed, and `symptomVocabulary` derives the list from the entries rather
 * than from a registry (see `moodLog.ts`), so a typo has nowhere to be fixed:
 * "headche" stays in your suggestions and stays its own series in every
 * contrast on the Mood screen until the entries themselves are rewritten.
 *
 * **Rename and merge are one control, not two.** Typing a name that already
 * exists is precisely the statement "these two are the same complaint", which
 * is the thing `symptomKey` deliberately refuses to guess: it matches on case
 * and space only, because folding "head ache" into "headache" on the app's own
 * initiative would merge two things in a chart somebody may show a doctor. The
 * user is allowed to say it; the app is not allowed to assume it.
 *
 * Counts are entries, not days, because that is the number of rows the rename
 * is about to rewrite and the confirm says so.
 */
export function SymptomManagerSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMoodStore(s => s.logs);
  const renameSymptom = useMoodStore(s => s.renameSymptom);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const names = useMemo(() => symptomVocabulary(logs), [logs]);

  const startEdit = (name: string) => {
    haptics.tap();
    animateLayout();
    setEditingKey(symptomKey(name));
    setDraft(name);
  };

  const cancelEdit = () => {
    animateLayout();
    setEditingKey(null);
    setDraft('');
  };

  const commit = (from: string) => {
    const to = draft.trim();
    if (!to || to === from) { cancelEdit(); return; }

    const count = symptomEntryCount(logs, from);
    const merging = names.some(n => symptomKey(n) === symptomKey(to) && symptomKey(n) !== symptomKey(from));
    const entries = `${count} ${count === 1 ? 'entry' : 'entries'}`;

    Alert.alert(
      merging ? `Merge into "${to}"?` : `Rename to "${to}"?`,
      merging
        // Says the direction plainly: a merge is not reversible by renaming
        // back, since the entries that were already "to" are indistinguishable
        // afterward.
        ? `"${from}" will be renamed on ${entries} and counted as "${to}" from now on. The two can't be separated again afterward.`
        : `"${from}" will be renamed on ${entries}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: merging ? 'Merge' : 'Rename',
          onPress: () => {
            haptics.success();
            animateLayout();
            renameSymptom(from, to);
            setEditingKey(null);
            setDraft('');
          },
        },
      ],
    );
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
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Symptoms</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />
        </>
      }
    >
      {names.length === 0 ? (
        <EmptyState
          icon="pricetag-outline"
          title="No symptoms yet"
          subtitle="Anything you log alongside a mood shows up here, so you can rename it or merge two spellings into one."
        />
      ) : (
        <View style={styles.card}>
          <Text style={styles.hint}>
            Tap one to rename it. Give it a name you already use and the two are counted as one from then on.
          </Text>
          {names.map(name => {
            const key = symptomKey(name);
            const count = symptomEntryCount(logs, name);
            if (editingKey === key) {
              return (
                <View key={key} style={styles.editRow}>
                  <TextInput
                    style={styles.input}
                    value={draft}
                    onChangeText={setDraft}
                    autoFocus
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={() => commit(name)}
                    accessibilityLabel={`New name for ${name}`}
                  />
                  <TouchableOpacity
                    onPress={cancelEdit}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel renaming"
                  >
                    <Text style={styles.cancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => commit(name)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Save the new name for ${name}`}
                  >
                    <Text style={styles.save}>Save</Text>
                  </TouchableOpacity>
                </View>
              );
            }
            return (
              <TouchableOpacity
                key={key}
                style={styles.row}
                onPress={() => startEdit(name)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${name}, on ${count} ${count === 1 ? 'entry' : 'entries'}. Rename`}
              >
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                <Text style={styles.count}>{count}</Text>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}
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
  headerSpacer: { minWidth: 56 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  hint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  name: { flex: 1, fontSize: font.md, color: colors.text },
  count: { fontSize: font.sm, color: colors.textSecondary },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: font.md,
    color: colors.text,
    // height rather than lineHeight: RN maps lineHeight onto the iOS paragraph
    // style with no baseline compensation, which sits the text low in the box.
    height: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  cancel: { fontSize: font.sm, color: colors.accent },
  save: { fontSize: font.sm, color: colors.accent, fontWeight: fontWeight.semibold },
});
