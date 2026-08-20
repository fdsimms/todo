import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { TitleRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { categoryLabel } from '../utils/categoryLabel';
import { describeTitleRuleTargets, describeTitleRuleTrigger } from '../utils/titleRules';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TitleRuleSheet } from './TitleRuleSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Every title rule, in one list — the answer to "why did that task go to
 * Work?", which is the question a rule that files things on its own has to be
 * answerable somewhere. Same job `StandingSwapsSheet` does for the other
 * mechanism in this app allowed to act without being asked each time.
 *
 * Unlike that one, this *is* where rules are written: a substitute has a pair
 * of grocery rows to hang off, and a title rule has nothing but itself, so its
 * only home is here.
 *
 * **The list is deliberately not hand-orderable.** Order would be a second
 * thing to maintain, and a drag list can't live inside a page sheet anyway
 * (see `EditorSheet`'s note). Two rules contesting one field are settled by
 * the more specific keyword instead — see `resolveTitleRules`.
 */
export function TitleRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const titleRules = useSettingsStore(useShallow(s => s.titleRules));
  const setTitleRules = useSettingsStore(s => s.setTitleRules);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const projects = useProjectStore(useShallow(s => s.projects));

  // Null id = a new rule; undefined = the editor is closed. Held as an id
  // rather than the rule itself so an edit committed underneath can't leave
  // the sheet holding a stale copy.
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const editing = editingId ? titleRules.find(r => r.id === editingId) ?? null : null;

  const save = (rule: TitleRule) => {
    const exists = titleRules.some(r => r.id === rule.id);
    setTitleRules(exists ? titleRules.map(r => (r.id === rule.id ? rule : r)) : [...titleRules, rule]);
  };

  const remove = (id: string) => {
    animateLayout();
    setTitleRules(titleRules.filter(r => r.id !== id));
  };

  const toggle = (rule: TitleRule) => {
    haptics.tap();
    setTitleRules(titleRules.map(r => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
  };

  const targetsOf = (rule: TitleRule) => describeTitleRuleTargets(
    rule,
    rule.category ? categoryLabel(rule.category, categories) : null,
    projects.find(p => p.id === rule.projectId)?.title ?? null,
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Title rules</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />
        </View>

        {titleRules.length === 0 ? (
          <ScrollView contentContainerStyle={styles.emptyWrap}>
            <EmptyState
              icon="funnel-outline"
              title="No title rules"
              subtitle="Pick a word, and anything you add starting with it files itself. A rule for “expense” can set the category, tags and priority every time, so you don't have to."
              actionLabel="New rule"
              onAction={() => setEditingId(null)}
            />
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.caption}>
              A rule fills in a task as you type it. It never overrides something you picked
              yourself, and it only applies as a task is created. Renaming a task later doesn't
              refile it.
            </Text>
            <View style={styles.card}>
              {titleRules.map((rule, i) => {
                const targets = targetsOf(rule);
                return (
                  <View key={rule.id}>
                    {i > 0 && <View style={styles.sep} />}
                    <View style={styles.row}>
                      <TouchableOpacity
                        style={styles.body}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => { haptics.tap(); setEditingId(rule.id); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit rule: ${describeTitleRuleTrigger(rule)}${targets ? `, files as ${targets}` : ''}`}
                      >
                        <Text style={[styles.name, !rule.enabled && styles.nameOff]} numberOfLines={1}>
                          {describeTitleRuleTrigger(rule)}
                        </Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          {targets || 'Nothing set yet. Open to finish it.'}
                          {rule.stripKeyword ? ' · word removed' : ''}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.toggle, rule.enabled && styles.toggleOn]}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => toggle(rule)}
                        accessibilityRole="switch"
                        accessibilityLabel={`${describeTitleRuleTrigger(rule)} is on`}
                        accessibilityState={{ checked: rule.enabled }}
                      >
                        <View style={[styles.toggleKnob, rule.enabled && styles.toggleKnobOn]} />
                      </TouchableOpacity>
                      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                    </View>
                  </View>
                );
              })}
            </View>
            <InlineAction
              icon="add"
              label="New rule"
              onPress={() => setEditingId(null)}
              style={styles.addBtn}
            />
            <Text style={styles.footnote}>
              When two rules want to set the same thing, the longer, more specific word wins:
              “expense report” beats “expense”. Tags from every matching rule are added
              together.
            </Text>
          </ScrollView>
        )}

        <TitleRuleSheet
          visible={editingId !== undefined}
          rule={editing}
          onSave={save}
          onDelete={editing ? () => remove(editing.id) : undefined}
          onClose={() => setEditingId(undefined)}
        />
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
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
    emptyWrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.md },
    list: { padding: spacing.md, paddingBottom: spacing.xl },
    caption: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.md },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    body: { flex: 1 },
    name: { color: colors.text, fontSize: font.md },
    nameOff: { color: colors.textSecondary },
    meta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    toggle: {
      width: 46, height: 27, borderRadius: 14,
      backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
    },
    toggleOn: { backgroundColor: colors.orange },
    toggleKnob: { width: 21, height: 21, borderRadius: 11, backgroundColor: colors.bg },
    toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
    addBtn: { marginTop: spacing.md, alignSelf: 'flex-start' },
    footnote: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.md, lineHeight: 16 },
  });
}
