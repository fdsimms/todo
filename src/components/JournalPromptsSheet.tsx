import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet } from './CardSheet';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  JOURNAL_CUSTOM_PROMPTS_MAX,
  JOURNAL_CUSTOM_PROMPT_MAX_LENGTH,
  cleanJournalPrompts,
} from '../utils/journal';
import { HelpText } from './HelpText';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The person's own writing prompts, offered ahead of the built-in ones when
 * "Suggest a prompt" is tapped on a blank journal page. Every add and delete
 * is written as it is made, so there is nothing to cancel.
 */
export function JournalPromptsSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const prompts = useSettingsStore(s => s.journalCustomPrompts);
  const setPrompts = useSettingsStore(s => s.setJournalCustomPrompts);
  const [draft, setDraft] = useState('');

  const dismiss = () => card.close(() => { setDraft(''); onClose(); });

  const candidate = cleanJournalPrompts([draft])[0] ?? null;
  const duplicate = candidate !== null && prompts.some(p => p.toLowerCase() === candidate.toLowerCase());
  const full = prompts.length >= JOURNAL_CUSTOM_PROMPTS_MAX;
  const canAdd = candidate !== null && !duplicate && !full;

  const add = () => {
    if (!canAdd || !candidate) return;
    haptics.tap();
    setPrompts([...prompts, candidate]);
    setDraft('');
  };

  const remove = (index: number) => {
    haptics.tap();
    setPrompts(prompts.filter((_, i) => i !== index));
  };

  return (
    <CardSheet name="JournalPromptsSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerSide} />
          <Text style={styles.heading}>Your prompts</Text>
          <SheetHeaderButton label={BUTTON_LABEL.done} onPress={dismiss} minWidth={56} style={styles.headerRight} />
        </View>
        <View style={styles.body}>
          <HelpText style={styles.hint}>
            Questions you want offered over a blank journal page. They show before the built-in ones, and only when you tap Suggest a prompt.
          </HelpText>
          {prompts.length > 0 && (
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {prompts.map((prompt, index) => (
                <View key={prompt} style={[styles.row, index > 0 && styles.rowBorder]}>
                  <Text style={styles.rowText}>{prompt}</Text>
                  <TouchableOpacity
                    onPress={() => remove(index)}
                    activeOpacity={interaction.activeOpacity}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove prompt ${prompt}`}
                  >
                    <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
          <TextField
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="e.g. What am I avoiding this week?"
            placeholderTextColor={colors.textTertiary}
            maxLength={JOURNAL_CUSTOM_PROMPT_MAX_LENGTH}
            returnKeyType="done"
            onSubmitEditing={add}
            editable={!full}
            accessibilityLabel="New prompt"
          />
          {duplicate && <Text style={styles.note}>That prompt is already in your list.</Text>}
          {full && <Text style={styles.note}>You can keep up to {JOURNAL_CUSTOM_PROMPTS_MAX} prompts.</Text>}
          <View style={styles.addRow}>
            <InlineAction label="Add prompt" icon="add" onPress={add} disabled={!canAdd} />
          </View>
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  headerSide: { minWidth: 56 },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  hint: { color: colors.textSecondary, fontSize: font.sm },
  list: { maxHeight: 220, backgroundColor: colors.bgSecondary, borderRadius: radius.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowText: { flex: 1, color: colors.text, fontSize: font.md },
  input: {
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  note: { color: colors.textSecondary, fontSize: font.sm },
  addRow: { alignItems: 'flex-start' },
});
