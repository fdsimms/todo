import React, { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useTemplateStore } from '../store/useTemplateStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { questionLabel, toggleItemCondition } from '../utils/templateQuestions';
import type { TemplateItemCondition, TemplateQuestion } from '../types';
import { EmptyState } from './EmptyState';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  templateId: string;
  question: TemplateQuestion;
  onClose: () => void;
}

/**
 * Every item in a template, one row apiece, with a pill per answer of one
 * question — set which items are checked by default for which answers
 * without opening them one at a time.
 *
 * Opened from `TemplateQuestionSheet` for a question that already has an id
 * to condition on. Autosaves each tap straight to the item, the same as the
 * "Only when" pills in `TemplateItemEditor` this mirrors — there's no draft
 * to lose, so no Cancel/dirty check like a staged sheet needs.
 *
 * Reference items are left out: they answer to their own nested template's
 * questions, not this one's (see `initialLeafSelection`), so a pill here
 * would never be consulted.
 */
export function TemplateQuestionItemsSheet({ visible, templateId, question, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useTemplateStore(useShallow(s => s.templates.find(t => t.id === templateId)?.items ?? []));
  const updateItem = useTemplateStore(s => s.updateItem);

  const leafItems = items.filter(i => i.refTemplateId === null);

  const toggle = (itemId: string, conditions: readonly TemplateItemCondition[], option: string) => {
    haptics.tap();
    updateItem(templateId, itemId, { conditions: toggleItemCondition(conditions, question.id, option) });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle} numberOfLines={1}>{questionLabel(question)}</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />
        </View>

        {leafItems.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="checkbox-outline"
              title="No items yet"
              subtitle="Add items to the template first, then come back here to set which ones include each answer."
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.caption}>
              A ticked answer checks that item by default when the run answers it. Every item
              stays on the list either way, so it can still be checked or unchecked when the
              template is applied.
            </Text>
            <View style={styles.card}>
              {leafItems.map((item, i) => {
                const existing = item.conditions.find(c => c.questionId === question.id);
                return (
                  <View key={item.id}>
                    {i > 0 && <View style={styles.sep} />}
                    <View style={styles.row}>
                      <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                      <View style={styles.pillRow}>
                        {question.options.map(option => {
                          const on = existing?.values.includes(option) ?? false;
                          return (
                            <TouchableOpacity
                              key={option}
                              style={[styles.pill, on && styles.pillOn]}
                              onPress={() => toggle(item.id, item.conditions, option)}
                              activeOpacity={interaction.activeOpacity}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: on }}
                              accessibilityLabel={`${item.title}, ${option}`}
                            >
                              <Text style={[styles.pillText, on && styles.pillTextOn]} numberOfLines={1}>{option}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  // Matches Done's own minWidth, so the title stays optically centred.
  headerSpacer: { width: 56 },
  emptyWrap: { flex: 1, paddingHorizontal: spacing.md },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  caption: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.md },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
  sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  itemTitle: { color: colors.text, fontSize: font.md },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: 12, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  pillOn: { backgroundColor: colors.accentFill },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextOn: { color: colors.onAccent, fontWeight: '600' },
});
