import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Effort, Priority, TitleRule, TitleRuleMatch } from '../types';
import { EFFORT_LABELS, PRIORITY_LABELS } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { tagColor } from '../utils/tagColor';
import { categoryLabel } from '../utils/categoryLabel';
import {
  KEYWORD_MAX_LENGTH, MIN_KEYWORD_LENGTH,
  emptyTitleRule, normalizeKeywords, resolveTitleRules, titleRuleIsUseless,
} from '../utils/titleRules';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useShallow } from 'zustand/react/shallow';
import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { CollapsibleField } from './CollapsibleField';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';

type FieldKey = 'category' | 'project' | 'tags' | 'priority' | 'effort';

const MATCH_OPTIONS: SegmentOption<TitleRuleMatch>[] = [
  { value: 'startsWith', label: 'Starts with' },
  { value: 'contains', label: 'Contains' },
];

const EFFORT_OPTIONS: SegmentOption<Effort>[] =
  EFFORT_LABELS.map((label, value) => ({ value: value as Effort, label: value === 0 ? 'None' : label }));

interface Props {
  visible: boolean;
  /** The rule being edited, or null for a new one. */
  rule: TitleRule | null;
  onSave: (rule: TitleRule) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * One title rule: the words that trigger it on the left, what it files a task
 * as on the right.
 *
 * Shaped like `ExtraTaskSheet` — the same question ("what will this task look
 * like when something else fills it in") answered from the same primitives, so
 * the two forms can't drift into two idioms for one job. What it deliberately
 * doesn't borrow is that sheet's notes and subtasks: see `TitleRule` for why a
 * rule that writes a task's contents is a template.
 *
 * **Nothing is saved until the rule can actually do something.** A rule needs
 * both a keyword to fire on and a field to fill, and the two halves fail
 * differently enough to be worth saying separately — hence the footer line,
 * which names whichever half is still missing rather than greying out Done
 * with no explanation.
 */
export function TitleRuleSheet({ visible, rule, onSave, onDelete, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const projects = useProjectStore(useShallow(s => s.projects.filter(p => !p.archived)));

  const [draft, setDraft] = useState<TitleRule>(emptyTitleRule);
  const [keywordInput, setKeywordInput] = useState('');
  const [openFields, setOpenFields] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');

  // Seeded when the sheet opens rather than on `rule` changing: the save hands
  // a fresh object back up, and re-seeding from it mid-edit would fight
  // whatever is being typed. Same call ExtraTaskSheet makes.
  useEffect(() => {
    if (!visible) return;
    setDraft(rule ?? emptyTitleRule());
    setKeywordInput('');
    setOpenFields({});
    setAddingTag(false);
    setNewTag('');
    // `rule` is deliberately not a dependency — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const patch = (fields: Partial<TitleRule>) => setDraft(prev => ({ ...prev, ...fields }));

  const fieldOpen = (key: FieldKey) => openFields[key] ?? false;
  const toggleField = (key: FieldKey) => setOpenFields(prev => ({ ...prev, [key]: !(prev[key] ?? false) }));
  const closeField = (key: FieldKey) => setOpenFields(prev => ({ ...prev, [key]: false }));

  const commitKeyword = () => {
    const next = normalizeKeywords([...draft.keywords, keywordInput]);
    if (next.length > draft.keywords.length) haptics.tap();
    patch({ keywords: next });
    setKeywordInput('');
  };

  const addTagFromInput = () => {
    const t = newTag.trim();
    if (t && !draft.tags.includes(t)) patch({ tags: [...draft.tags, t] });
    setNewTag('');
    setAddingTag(false);
  };

  // Includes whatever is still sitting in the input. Pressing Done blurs the
  // field, and the commit that blur triggers is a state update this render
  // hasn't seen — so reading only `draft.keywords` here would both grey Done
  // out under a perfectly good keyword and then drop it on save.
  const keywords = normalizeKeywords([...draft.keywords, keywordInput]);
  const blocked = titleRuleIsUseless({ ...draft, keywords })
    ? keywords.length === 0
      ? 'Add a word for this rule to look for.'
      : 'Pick at least one thing for this rule to set.'
    : null;

  // Runs the rule the user is writing against a title built from its own first
  // keyword, so "Remove the word from the title" shows what it does instead of
  // describing it. Only ever shown once the rule is savable — a preview of a
  // rule that can't fire is noise on top of the reason it can't.
  const strippedExample = useMemo(() => {
    if (blocked || !draft.stripKeyword) return null;
    const sample = `${keywords[0]} the client lunch`;
    const fill = resolveTitleRules(sample, [{ ...draft, keywords }]);
    return fill && fill.cleanTitle !== sample ? { from: sample, to: fill.cleanTitle } : null;
  }, [blocked, draft, keywords]);

  const save = () => {
    if (blocked) return;
    // A tag typed but not submitted counts, for the same reason a keyword does
    // (see `keywords` above) — Done blurs the field, and the commit that blur
    // triggers hasn't landed in `draft` yet.
    const pendingTag = newTag.trim();
    const tags = pendingTag && !draft.tags.includes(pendingTag)
      ? [...draft.tags, pendingTag]
      : draft.tags;
    onSave({ ...draft, keywords, tags });
    onClose();
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
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>{rule ? 'Edit rule' : 'New rule'}</Text>
          </View>
          <SheetHeaderButton label="Done" onPress={save} disabled={!!blocked} minWidth={64} />
        </>
      }
    >
      <Text style={styles.groupLabel}>When a title…</Text>
      <View style={styles.sectionCard}>
        <View style={styles.matchRow}>
          <SegmentedControl
            label="Match"
            value={draft.match}
            onChange={match => patch({ match })}
            options={MATCH_OPTIONS}
          />
        </View>
        <View style={styles.cardSep} />
        <View style={styles.keywordSection}>
          <View style={styles.tagRow}>
            {normalizeKeywords(draft.keywords).map(keyword => (
              <TouchableOpacity
                key={keyword}
                style={styles.keywordChip}
                onPress={() => { haptics.tap(); patch({ keywords: draft.keywords.filter(k => k !== keyword) }); }}
                accessibilityRole="button"
                accessibilityLabel={`Remove keyword ${keyword}`}
              >
                <Text style={styles.keywordChipText}>{keyword}</Text>
                <Ionicons name="close" size={12} color={colors.accent} />
              </TouchableOpacity>
            ))}
            <TextInput
              style={styles.keywordInput}
              value={keywordInput}
              onChangeText={setKeywordInput}
              onSubmitEditing={commitKeyword}
              onBlur={commitKeyword}
              placeholder={draft.keywords.length === 0 ? 'e.g. expense' : 'e.g. reimburse'}
              placeholderTextColor={colors.textTertiary}
              maxLength={KEYWORD_MAX_LENGTH}
              returnKeyType="done"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Add a word this rule looks for"
            />
          </View>
          <Text style={styles.keywordHint}>
            Matched on whole words, upper or lower case, so “expense” never fires on
            “expensive”. Plurals and other forms are separate words, so add “expenses” too if
            you type it. At least {MIN_KEYWORD_LENGTH} letters.
          </Text>
        </View>
      </View>

      <Text style={styles.groupLabel}>…file it as</Text>
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Category"
          summary={draft.category ? categoryLabel(draft.category, categories) : undefined}
          emptySummary="Says nothing"
          hint="Where a matching task is filed, unless you pick a category yourself when adding it."
          expanded={fieldOpen('category')}
          onToggle={() => toggleField('category')}
        >
          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[styles.pill, !draft.category && styles.pillActive]}
              onPress={() => { haptics.tap(); patch({ category: null }); closeField('category'); }}
            >
              <Text style={[styles.pillText, !draft.category && styles.pillTextActive]}>Says nothing</Text>
            </TouchableOpacity>
            {allCategories.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.pill, draft.category === cat && styles.pillActive]}
                onPress={() => { haptics.tap(); patch({ category: cat }); closeField('category'); }}
              >
                <Text style={[styles.pillText, draft.category === cat && styles.pillTextActive]}>
                  {categoryLabel(cat, categories)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </CollapsibleField>

        {projects.length > 0 && (
          <>
            <View style={styles.cardSep} />
            <CollapsibleField
              label="Project"
              summary={projects.find(p => p.id === draft.projectId)?.title}
              emptySummary="Says nothing"
              hint="Which project a matching task counts toward, when you add it from quick add. Quick add has no project field of its own, so a rule is the way to get one on a task as you type it. A task captured somewhere with nothing on screen to show it, like a dictated reminder, is left out of the project so it still lands in your Inbox."
              expanded={fieldOpen('project')}
              onToggle={() => toggleField('project')}
            >
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, !draft.projectId && styles.pillActive]}
                  onPress={() => { haptics.tap(); patch({ projectId: null }); closeField('project'); }}
                >
                  <Text style={[styles.pillText, !draft.projectId && styles.pillTextActive]}>Says nothing</Text>
                </TouchableOpacity>
                {projects.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.pill, draft.projectId === p.id && styles.pillActive]}
                    onPress={() => { haptics.tap(); patch({ projectId: p.id }); closeField('project'); }}
                  >
                    <Text style={[styles.pillText, draft.projectId === p.id && styles.pillTextActive]}>{p.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </CollapsibleField>
          </>
        )}

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Tags"
          summary={draft.tags.length > 0 ? draft.tags.join(', ') : undefined}
          emptySummary="Says nothing"
          hint="Added to whatever tags the task already has, rather than replacing them."
          expanded={fieldOpen('tags')}
          onToggle={() => toggleField('tags')}
        >
          <View style={styles.tagRow}>
            {draft.tags.map(tag => (
              <TouchableOpacity
                key={tag}
                style={[styles.tagChip, { backgroundColor: tagColor(tag) + '33' }]}
                onPress={() => { haptics.tap(); patch({ tags: draft.tags.filter(t => t !== tag) }); }}
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${tag}`}
              >
                <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                <Text style={[styles.tagChipText, { color: tagColor(tag) }]}>{tag}</Text>
                <Ionicons name="close" size={12} color={tagColor(tag)} />
              </TouchableOpacity>
            ))}
            {addingTag ? (
              <TextInput
                autoFocus
                style={styles.tagInput}
                value={newTag}
                onChangeText={setNewTag}
                onSubmitEditing={addTagFromInput}
                onBlur={addTagFromInput}
                placeholder="Tag name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="none"
              />
            ) : (
              <InlineAction icon="add" label="Add tag" variant="neutral" onPress={() => setAddingTag(true)} />
            )}
          </View>
          {allTags.filter(t => !draft.tags.includes(t)).length > 0 && (
            <View style={styles.tagSuggestions}>
              {allTags.filter(t => !draft.tags.includes(t)).slice(0, 6).map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={styles.tagSuggestion}
                  onPress={() => patch({ tags: [...draft.tags, tag] })}
                >
                  <Text style={styles.tagSuggestionText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Priority"
          summary={draft.priority > 0 ? PRIORITY_LABELS[draft.priority] : undefined}
          emptySummary="Says nothing"
          hint="Ranks a matching task against everything else on its day."
          expanded={fieldOpen('priority')}
          onToggle={() => toggleField('priority')}
        >
          <SegmentedControl
            label="Priority"
            value={draft.priority}
            onChange={(priority: Priority) => { patch({ priority }); closeField('priority'); }}
            columns={3}
            options={PRIORITY_SEGMENTS}
          />
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Effort"
          summary={draft.effort > 0 ? EFFORT_LABELS[draft.effort] : undefined}
          emptySummary="Says nothing"
          hint="Roughly how big a matching task is, so the day it lands on can be sized realistically."
          expanded={fieldOpen('effort')}
          onToggle={() => toggleField('effort')}
        >
          <SegmentedControl
            label="Effort"
            value={draft.effort}
            onChange={(effort: Effort) => { patch({ effort }); closeField('effort'); }}
            columns={4}
            options={EFFORT_OPTIONS}
          />
        </CollapsibleField>
      </View>

      <View style={styles.sectionCard}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); patch({ stripKeyword: !draft.stripKeyword }); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Remove the word from the title"
          accessibilityState={{ checked: draft.stripKeyword }}
        >
          <Ionicons
            name="cut-outline"
            size={18}
            color={draft.stripKeyword ? colors.accent : colors.textSecondary}
          />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Remove the word from the title</Text>
            <Text style={styles.optionHint}>
              {strippedExample
                ? `“${strippedExample.from}” is saved as “${strippedExample.to}”`
                : 'The matched word is taken out of the task name. A title left empty by this is kept as typed.'}
            </Text>
          </View>
          <View style={[styles.toggle, draft.stripKeyword && styles.toggleOn]}>
            <View style={[styles.toggleKnob, draft.stripKeyword && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
        <View style={styles.cardSep} />
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); patch({ enabled: !draft.enabled }); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Rule is on"
          accessibilityState={{ checked: draft.enabled }}
        >
          <Ionicons
            name="power-outline"
            size={18}
            color={draft.enabled ? colors.accent : colors.textSecondary}
          />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Rule is on</Text>
            <Text style={styles.optionHint}>
              {draft.enabled
                ? 'Applied to new tasks as you type them'
                : 'Kept in the list, but nothing is filed by it'}
            </Text>
          </View>
          <View style={[styles.toggle, draft.enabled && styles.toggleOn]}>
            <View style={[styles.toggleKnob, draft.enabled && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>

      {!!blocked && <Text style={styles.blockedNote}>{blocked}</Text>}

      {!!onDelete && (
        <TouchableOpacity
          style={styles.deleteRow}
          onPress={() => { haptics.warning(); onDelete(); onClose(); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel="Delete this rule"
        >
          <Text style={styles.deleteText}>Delete rule</Text>
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
  headerTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: spacing.md, paddingBottom: 120 },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: spacing.md + spacing.xs, marginBottom: spacing.xs,
  },
  sectionCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  cardSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  matchRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  keywordSection: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  keywordChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: colors.accent + '22',
  },
  keywordChipText: { color: colors.accent, fontSize: font.sm, fontWeight: '500' },
  keywordInput: {
    color: colors.text, fontSize: font.sm,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 4, paddingHorizontal: 4, minWidth: 110,
  },
  keywordHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, lineHeight: 16 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary, alignItems: 'center',
  },
  pillActive: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagChipText: { fontSize: font.sm, fontWeight: '500' },
  tagInput: {
    color: colors.text, fontSize: font.sm,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 4, paddingHorizontal: 4, minWidth: 80,
  },
  tagSuggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  tagSuggestion: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  tagSuggestionText: { color: colors.textSecondary, fontSize: font.xs },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: 1 },
  toggle: {
    width: 46, height: 27, borderRadius: 14,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: colors.orange },
  toggleKnob: { width: 21, height: 21, borderRadius: 11, backgroundColor: colors.bg },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
  blockedNote: {
    color: colors.textTertiary, fontSize: font.xs,
    marginHorizontal: spacing.md + spacing.xs, marginBottom: spacing.lg,
  },
  deleteRow: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
    paddingVertical: 13, alignItems: 'center',
  },
  deleteText: { color: colors.red, fontSize: font.md },
});
