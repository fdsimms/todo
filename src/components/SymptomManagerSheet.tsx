import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { renameSymptomInLogs, symptomCounts, symptomKey } from '../utils/moodLog';
import { useMoodStore } from '../store/useMoodStore';
import { EditorSheet } from './EditorSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';

const NAME_MAX_LENGTH = 60;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The symptoms you have logged, and the one way to correct one.
 *
 * The vocabulary is derived from the entries rather than stored (see
 * `symptomVocabulary`), which is the right call and has one honest cost: there
 * is no registry row to edit, so a typo is permanent. Log "headche" once and it
 * is in your suggestions forever, and it is its own series in every contrast on
 * the Mood screen. This is where that gets fixed.
 *
 * **A rename rewrites history, so it confirms with a count.** That is the one
 * thing the store otherwise refuses to do casually — `updateLog` cannot move
 * `dayKey` or `loggedAt` — and the line between them is worth stating: a rename
 * changes what you called something, not which day it happened on, so every
 * correlation re-reads the same days afterwards. Close enough to deserve a
 * prompt, not close enough to refuse.
 *
 * **Merging is the feature, not a side effect.** `symptomKey` matches on case
 * and space only and must keep refusing to guess that "head ache" and
 * "headache" are one complaint, because being wrong there folds two things
 * together in a chart somebody may be about to show a doctor. The honest
 * consequence of refusing to guess is that the user needs a way to say so, and
 * renaming one onto the other is it.
 *
 * An `EditorSheet` rather than a page sheet, which settles the unsaved-changes
 * question CLAUDE.md raises the same way `MoodLogSheet` does: it is
 * `fullScreen`, so there is no swipe-down to bypass the confirm with.
 */
export function SymptomManagerSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMoodStore(s => s.logs);
  const renameSymptom = useMoodStore(s => s.renameSymptom);

  const entries = useMemo(() => symptomCounts(logs), [logs]);

  // Which row is open for editing, by match key, and what has been typed into
  // it. One at a time: two open fields would be two half-finished renames with
  // nothing saying which one Save belongs to.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const openRow = (key: string, name: string) => {
    haptics.tap();
    animateLayout();
    setEditingKey(key);
    setDraft(name);
  };

  const closeRow = () => {
    animateLayout();
    setEditingKey(null);
    setDraft('');
  };

  const commit = (fromKey: string, currentName: string) => {
    const next = draft.trim();
    if (!next || next === currentName) { closeRow(); return; }

    // Decided before anything is written, so the confirmation can say how many
    // entries it is about to rewrite and whether it folds two names into one.
    const { changes, merges } = renameSymptomInLogs(logs, fromKey, next);
    if (changes.length === 0) { closeRow(); return; }

    const count = changes.length;
    const noun = count === 1 ? 'entry' : 'entries';
    haptics.warning();
    Alert.alert(
      merges ? `Merge into "${next}"?` : `Rename to "${next}"?`,
      merges
        ? `${count} ${noun} will be rewritten, and "${currentName}" will be counted as "${next}" everywhere on the Mood screen. This can't be undone.`
        : `${count} ${noun} will be rewritten. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: merges ? 'Merge' : 'Rename',
          onPress: () => {
            animateLayout();
            renameSymptom(fromKey, next);
            haptics.success();
            closeRow();
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
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>Symptoms</Text>
          <View style={styles.headerSpacer} />
        </>
      }
    >
      {entries.length === 0 ? (
        <EmptyState
          icon="pricetag-outline"
          title="No symptoms yet"
          subtitle="Anything you name while logging how you're feeling shows up here, and can be renamed or merged from this list."
        />
      ) : (
        <>
          <Text style={styles.hint}>
            Renaming one rewrites every entry that used it. Rename it to a name you already
            use to merge the two.
          </Text>
          <View style={styles.card}>
            {entries.map((entry, index) => (
              <View key={entry.key}>
                {index > 0 && <View style={styles.sep} />}
                {editingKey === entry.key ? (
                  <View style={styles.editRow}>
                    <TextInput
                      style={styles.input}
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="Symptom name"
                      placeholderTextColor={colors.textTertiary}
                      maxLength={NAME_MAX_LENGTH}
                      autoFocus
                      autoCapitalize="none"
                      returnKeyType="done"
                      onSubmitEditing={() => commit(entry.key, entry.name)}
                      accessibilityLabel={`Rename ${entry.name}`}
                    />
                    <SheetHeaderButton label="Cancel" role="cancel" onPress={closeRow} />
                    <SheetHeaderButton
                      label="Save"
                      onPress={() => commit(entry.key, entry.name)}
                      // Recasing is a real rename ("Headache" to "headache"),
                      // so only an empty name or the name it already has is
                      // nothing to do.
                      disabled={!draft.trim() || draft.trim() === entry.name}
                    />
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => openRow(entry.key, entry.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`${entry.name}, ${entry.count} ${entry.count === 1 ? 'entry' : 'entries'}. Rename`}
                  >
                    <Text style={styles.rowLabel} numberOfLines={1}>{entry.name}</Text>
                    <Text style={styles.rowCount}>{entry.count}</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
          <Text style={styles.footnote}>
            The number is how many entries name it.
          </Text>
        </>
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
  // Balances the Done button so the title stays optically centered, the same
  // job SheetHeaderButton's own minWidth does on a two-button header.
  headerSpacer: { minWidth: 64 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 },
  hint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  rowLabel: { flex: 1, fontSize: font.md, color: colors.text },
  rowCount: { fontSize: font.sm, color: colors.textSecondary, fontWeight: fontWeight.medium },
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
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    // Height rather than lineHeight: RN maps lineHeight onto the iOS paragraph
    // style with no baseline compensation, which sits the glyphs low in the
    // field while the caret stays centered.
    height: 38,
  },
  footnote: {
    fontSize: font.xs,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
});
