import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { TitleRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { categoryLabel } from '../utils/categoryLabel';
import { describeTitleRuleTargets, describeTitleRuleTrigger, titleRuleBacklog } from '../utils/titleRules';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TitleRuleSheet } from './TitleRuleSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The one-time "these already match" offer, and the confirmation it turns into
 * once taken. Session state, like Today's `othersHidden`: it belongs to the
 * rule that was just written, not to the rule list.
 *
 * `action` is the undo entry the fill registered, held by identity so the Undo
 * button disappears the moment anything else claims the slot — offering to undo
 * whatever happened to be last is worse than offering nothing.
 */
interface BacklogOffer {
  rule: TitleRule;
  count: number;
  filed: boolean;
  action: object | null;
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
  const hideHelpText = useSettingsStore(s => s.hideHelpText);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const projects = useProjectStore(useShallow(s => s.projects));
  const applyTitleRuleToExisting = useTaskStore(s => s.applyTitleRuleToExisting);
  const lastAction = useTaskStore(s => s.lastAction);
  const undoLastAction = useTaskStore(s => s.undoLastAction);

  // Null id = a new rule; undefined = the editor is closed. Held as an id
  // rather than the rule itself so an edit committed underneath can't leave
  // the sheet holding a stale copy.
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [backlog, setBacklog] = useState<BacklogOffer | null>(null);
  const editing = editingId ? titleRules.find(r => r.id === editingId) ?? null : null;

  // The offer belongs to the visit it was made in. Handing someone back a
  // "12 tasks match" card next time they open the sheet, with no memory of the
  // rule it was about, is a prompt with no context left around it.
  useEffect(() => {
    if (!visible) setBacklog(null);
  }, [visible]);

  const save = (rule: TitleRule) => {
    const exists = titleRules.some(r => r.id === rule.id);
    setTitleRules(exists ? titleRules.map(r => (r.id === rule.id ? rule : r)) : [...titleRules, rule]);
    if (exists) return;
    // A rule is written the moment the pattern is noticed, which is also the
    // moment a dozen tasks matching it are already sitting unfiled — the work
    // the rule was written to stop doing. So the backlog is offered once, here,
    // rather than as a standing behaviour: a rule still never fires on a task
    // that already exists, and the caption below still says so.
    //
    // **New rules only.** A rule that has been running for months has already
    // filed everything it was going to, so re-offering on every edit would
    // attach a bulk-write prompt to fixing a typo.
    //
    // Read from `getState()` rather than a subscription: the question is what
    // matches at the moment the rule is saved, and a settings sheet has no
    // business re-rendering on every task change.
    const count = titleRuleBacklog(useTaskStore.getState().tasks, rule).length;
    if (count > 0) {
      animateLayout();
      setBacklog({ rule, count, filed: false, action: null });
    }
  };

  const fileBacklog = () => {
    if (!backlog) return;
    haptics.success();
    // Recomputed inside the store, so a task edited between the offer and the
    // tap is filed as it stands now rather than as it was when counted.
    const filed = applyTitleRuleToExisting(backlog.rule);
    animateLayout();
    setBacklog(filed > 0
      ? { ...backlog, count: filed, filed: true, action: useTaskStore.getState().lastAction }
      : null);
  };

  const dismissBacklog = () => {
    haptics.tap();
    animateLayout();
    setBacklog(null);
  };

  const remove = (id: string) => {
    animateLayout();
    setTitleRules(titleRules.filter(r => r.id !== id));
  };

  const toggle = (rule: TitleRule) => {
    haptics.tap();
    setTitleRules(titleRules.map(r => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
  };

  // "Starts with “expense”, filed as Work · #admin" — the whole rule in one
  // line. A rule whose only category or project has since been deleted has
  // nothing left to name, so it falls back to the trigger alone rather than
  // trailing off after "filed as".
  const describeBacklogRule = (rule: TitleRule) => {
    const targets = targetsOf(rule);
    const trigger = describeTitleRuleTrigger(rule);
    return targets ? `${trigger}, filed as ${targets}` : trigger;
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
              subtitle="Pick a word, and anything you add starting with it files itself. A rule for “expense” can set the category, tags and priority every time, so you don’t have to."
              actionLabel="New rule"
              onAction={() => setEditingId(null)}
            />
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {!hideHelpText && (
              <Text style={styles.caption}>
                A rule fills in a task as you type it. It never overrides something you picked
                yourself, and it only applies as a task is created. Renaming a task later doesn't
                refile it. A new rule offers to file the tasks you already have that match it.
              </Text>
            )}
            {backlog && (
              <View style={styles.backlogCard}>
                <View style={styles.backlogHead}>
                  <Ionicons
                    name={backlog.filed ? 'checkmark-circle' : 'sparkles-outline'}
                    size={iconSize.sm}
                    color={colors.accent}
                  />
                  <Text style={styles.backlogTitle}>
                    {backlog.filed
                      ? `${backlog.count} ${backlog.count === 1 ? 'task' : 'tasks'} filed`
                      : `${backlog.count} ${backlog.count === 1 ? 'task' : 'tasks'} already ${backlog.count === 1 ? 'matches' : 'match'}`}
                  </Text>
                </View>
                {/* Names what the rule sets, not just the word it fires on: the
                    fill is about to be written to rows the person can't see
                    from here, and a project in particular moves a task off
                    Today (see applyTitleRulesToDraft's note on projectId). */}
                <Text style={styles.backlogBody}>
                  {backlog.filed
                    ? 'Only the fields left blank were filled in. From here on the rule applies as you add a task, not to tasks you rename.'
                    : `${describeBacklogRule(backlog.rule)}. File them the same way? Only the fields you left blank get filled in. Completed and archived tasks are left alone.`}
                </Text>
                <View style={styles.backlogActions}>
                  {!backlog.filed && (
                    <InlineAction
                      icon="funnel-outline"
                      label={backlog.count === 1 ? 'File it' : 'File them'}
                      onPress={fileBacklog}
                    />
                  )}
                  {backlog.filed && backlog.action !== null && lastAction === backlog.action && (
                    <InlineAction
                      icon="arrow-undo-outline"
                      label="Undo"
                      onPress={() => { haptics.tap(); undoLastAction(); setBacklog(null); }}
                    />
                  )}
                  <InlineAction
                    icon="close"
                    label={backlog.filed ? 'Done' : 'Not now'}
                    variant="neutral"
                    onPress={dismissBacklog}
                  />
                </View>
              </View>
            )}
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
    backlogCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.accent + '55',
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    backlogHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    backlogTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    backlogBody: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs, lineHeight: 18 },
    backlogActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
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
