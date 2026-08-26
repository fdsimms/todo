import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useShallow } from 'zustand/react/shallow';
import { useTemplateStore } from '../store/useTemplateStore';
import {
  resolveOffsetDate,
  formatOffsetLabel,
  anchorLabel,
  buildApplyTree,
  flattenApplyTree,
  leafIdsUnder,
  expandSelectionWithAncestors,
  extractPlaceholders,
  substitutePlaceholders,
  declaresRunPlaceholder,
  resolveApplyContainer,
  RUN_PLACEHOLDER,
  type TemplateAnchors,
  type ApplyTreeNode,
} from '../utils/templateUtils';
import { formatScheduledDate } from '../utils/dateUtils';
import { TITLE_MAX_LENGTH } from '../types';
import {
  questionsForTree,
  resolveAnswers,
  placeholderValuesFor,
  initialLeafSelection,
  reselectForAnswers,
  questionLabel,
  personIdsFromAnswer,
  personIdsToAnswer,
  personIdsForAnswers,
} from '../utils/templateQuestions';
import { WhenPicker } from './WhenPicker';
import { EditorRow } from './EditorRow';
import { PillGroup } from './PillGroup';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import type { Task, TaskTemplate, TemplateContainer, TemplateItem, TemplateQuestion, Person } from '../types';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  template: TaskTemplate | null;
  onClose: () => void;
  /** Land every created task in this existing project instead of the template's own container — see ApplyTemplateOptions.targetProjectId. */
  projectId?: string;
  /** Fires once the sheet has finished dismissing, with every task the apply created (empty if the run had nothing selected). Lets a caller jump straight to the first one rather than leaving it to be found. */
  onApplied?: (tasks: Task[]) => void;
}

/** Sub-label for a checklist row: live dates when its anchor is set, offset labels otherwise. */
function itemSublabel(item: TemplateItem, anchors: TemplateAnchors): string | null {
  const parts: string[] = [];
  const anchor = item.anchor === 'end' ? anchors.end : anchors.start;
  const due = resolveOffsetDate(anchor, item.dueOffsetDays);
  const defer = resolveOffsetDate(anchor, item.deferOffsetDays);
  if (due) {
    parts.push(`Due ${formatScheduledDate(due)}`);
  } else if (item.dueOffsetDays !== null) {
    parts.push(`Due ${formatOffsetLabel(item.dueOffsetDays).toLowerCase()}`);
  }
  if (defer) {
    parts.push(`Hidden until ${formatScheduledDate(defer)}`);
  } else if (item.deferOffsetDays !== null) {
    parts.push(`Hidden until ${formatOffsetLabel(item.deferOffsetDays).toLowerCase()}`);
  }
  if (item.timeSegments.length > 0) {
    parts.push(item.timeSegments.join(', '));
  }
  if ((item.dueOffsetDays !== null || item.deferOffsetDays !== null) && !anchor) {
    parts.push(`from ${anchorLabel(item.anchor).toLowerCase()}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** What the run name will do, given the container this apply resolves to. Doubles as the field's only in-app documentation. */
function runNameHint(container: TemplateContainer, upgraded: boolean, hasPlaceholders: boolean): string {
  const fills = hasPlaceholders ? ', and fills in the blanks below' : '';
  if (container === 'project') {
    return upgraded
      ? `Names the project these tasks land in. This template's groups become stacks inside it${fills}`
      : `Names the project these tasks land in, dated by the start and end dates above${fills}`;
  }
  if (container === 'stack') return `Names the stack these tasks land in${fills}`;
  if (container === 'task') return `Names the task these become subtasks of${fills}`;
  return `Fills in the blanks below${fills ? '' : ''}`;
}

/**
 * Bottom sheet for applying a template: answer whatever it asks, pick an
 * optional anchor date, toggle which items to include (optional items start
 * unchecked, including whole nested-template blocks; a conditioned one starts
 * on what the answers say), then create them all as real tasks.
 */
export function ApplyTemplateSheet({ visible, template, onClose, projectId, onApplied }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const templates = useTemplateStore(useShallow(s => s.templates));
  const applyTemplate = useTemplateStore(s => s.applyTemplate);

  const templatesById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates]);
  const tree = useMemo(
    () => (template ? buildApplyTree(template.items, template.id, templatesById) : []),
    [template, templatesById]
  );

  // Leaf item ids the user has checked — the only ids the checklist UI
  // itself needs to track; ref-item ids are derived at apply time.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedRefIds, setCollapsedRefIds] = useState<Set<string>>(new Set());
  const [startAnchor, setStartAnchor] = useState<Date | null>(null);
  const [endAnchor, setEndAnchor] = useState<Date | null>(null);
  const [calendarTarget, setCalendarTarget] = useState<'start' | 'end' | null>(null);
  // What this run of the template is about ("Camping w/ Dan"), and values for
  // any `{name}` blanks its items declare. Both empty = the original behavior.
  const [runName, setRunName] = useState('');
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  // Only what's been answered by hand, keyed by question id — an untouched
  // number question keeps following the anchor dates as they're picked, which
  // is the whole point of asking a trip's length by asking its dates.
  const [typedAnswers, setTypedAnswers] = useState<Record<string, string>>({});
  const anchors: TemplateAnchors = { start: startAnchor, end: endAnchor };

  const questions = useMemo(() => questionsForTree(tree, templatesById), [tree, templatesById]);
  const answers = resolveAnswers(questions, typedAnswers, anchors);
  const people = usePersonStore(useShallow(s => s.people.filter(p => !p.archived)));
  // A 'people' question with nobody on the People screen yet would render an
  // empty picker — exactly the "prompt to start filing your friends" rule 3
  // (docs/arch/people.md) rules out — so it doesn't render at all, the same
  // way MealEntrySheet's guest picker omits itself rather than showing empty.
  const visibleQuestions = questions.filter(q => q.kind !== 'people' || people.length > 0);

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && template) {
      // Non-optional leaves start checked; optional ones (and everything under
      // an optional nested-template block) start unchecked — and a conditioned
      // one starts on whatever its question's default answer says.
      const freshTree = buildApplyTree(template.items, template.id, templatesById);
      const freshQuestions = questionsForTree(freshTree, templatesById);
      setSelectedIds(initialLeafSelection(
        freshTree,
        freshQuestions,
        resolveAnswers(freshQuestions, {}, { start: null, end: null }),
      ));
      setCollapsedRefIds(new Set());
      setStartAnchor(null);
      setEndAnchor(null);
      setCalendarTarget(null);
      setRunName('');
      setPlaceholderValues({});
      setTypedAnswers({});
      translateY.setValue(hiddenY);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          ...animation.spring.smooth,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, template]);

  // Re-decide the conditioned items whenever an answer moves — including when
  // it moves because the dates did. Items with no conditions are left exactly
  // as ticked (see reselectForAnswers), so answering a question late never
  // undoes the extra thing you added by hand.
  const answersKey = JSON.stringify(answers);
  useEffect(() => {
    if (!visible || !template) return;
    // Keyed on the serialization rather than on `answers` itself, which is a
    // fresh object every render and would re-run this on every keystroke.
    setSelectedIds(prev => reselectForAnswers(tree, questions, answers, prev));
  }, [answersKey, visible, tree]);

  const dismiss = (onDismissed?: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: hiddenY,
        ...animation.spring.sheetDismiss,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
      onDismissed?.();
    });
  };

  // Slide the sheet away before showing the calendar — rendering both at once
  // causes touch conflicts (same choreography as DeferModal).
  const openCalendar = (target: 'start' | 'end') => {
    Animated.spring(translateY, {
      toValue: hiddenY,
      ...animation.spring.sheetDismiss,
      useNativeDriver: true,
    }).start(() => {
      setCalendarTarget(target);
    });
  };

  const restoreSheet = () => {
    setCalendarTarget(null);
    Animated.spring(translateY, {
      toValue: 0,
      ...animation.spring.smooth,
      useNativeDriver: true,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            ...animation.spring.snappy,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  if (!template) return null;

  const toggleItem = (id: string) => {
    haptics.tap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Toggle every leaf under a ref node together: all-select if any are unchecked, else deselect all. */
  const toggleNode = (node: ApplyTreeNode) => {
    haptics.tap();
    const leafIds = leafIdsUnder(node);
    setSelectedIds(prev => {
      const allChecked = leafIds.every(id => prev.has(id));
      const next = new Set(prev);
      leafIds.forEach(id => (allChecked ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const toggleCollapsed = (id: string) => {
    haptics.tap();
    setCollapsedRefIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const flatLeaves = flattenApplyTree(tree);
  const selectedCount = flatLeaves.filter(l => selectedIds.has(l.item.id)).length;
  const anchorless = flatLeaves.some(({ item: i }) => {
    if (!selectedIds.has(i.id)) return false;
    if (i.dueOffsetDays === null && i.deferOffsetDays === null) return false;
    return i.anchor === 'end' ? endAnchor === null : startAnchor === null;
  });

  // Derived off the whole tree rather than the current selection, so the field
  // and its hint don't appear and disappear as items are ticked.
  const selectedLeafItems = flatLeaves.map(l => l.item);
  // Answers fill the blanks of their own name, so a declared one is asked for
  // once — up in Questions, where it comes with the prompt its author wrote —
  // rather than a second time as an unlabelled box.
  const answerValues = placeholderValuesFor(questions, answers);
  const placeholderNames = extractPlaceholders(selectedLeafItems).filter(name => !(name in answerValues));
  const resolvedContainer = resolveApplyContainer(template.applyContainer, flatLeaves, templatesById);
  // Mirrors useTemplateStore.applyTemplate's downgrade: a project already
  // exists here, so a resolved 'project' container becomes a stack inside it
  // instead of a second project.
  const container = projectId && resolvedContainer === 'project' ? 'stack' : resolvedContainer;
  const containerUpgraded = container !== template.applyContainer;
  // Nothing to name when the run has no container and no `{run}` to fill.
  const showRunField = container !== 'none' || declaresRunPlaceholder(selectedLeafItems);

  const values = { ...placeholderValues, ...answerValues, [RUN_PLACEHOLDER]: runName.trim() };

  const handleApply = () => {
    if (selectedCount === 0) return;
    haptics.success();
    const flatSelection = expandSelectionWithAncestors(tree, selectedIds);
    const created = applyTemplate(template.id, flatSelection, anchors, {
      runName,
      placeholders: { ...placeholderValues, ...answerValues },
      targetProjectId: projectId,
      personIds: personIdsForAnswers(questions, answers),
    });
    // Waits for the sheet to be fully gone — a caller opening the task editor
    // straight off this callback would stack two Modals mid-animation, the
    // same touch-conflict openCalendar above avoids by sliding away first.
    dismiss(() => onApplied?.(created));
  };

  const renderApplyTreeNodes = (nodes: ApplyTreeNode[], depth: number) =>
    nodes.map((node, idx) => {
      const isLast = idx === nodes.length - 1;
      const row = renderApplyTreeNode(node, depth);
      return (
        <React.Fragment key={node.item.id}>
          {row}
          {!isLast && <View style={styles.inlineSep} />}
        </React.Fragment>
      );
    });

  const renderApplyTreeNode = (node: ApplyTreeNode, depth: number) => {
    const indent = { paddingLeft: spacing.md + depth * spacing.lg };

    if (node.broken) {
      return (
        <View style={[styles.itemRow, indent]}>
          <Ionicons name="alert-circle" size={20} color={colors.warning} />
          <View style={styles.itemContent}>
            <Text style={[styles.itemTitle, { color: colors.warning }]} numberOfLines={1}>
              {node.item.refTemplateName || 'Nested template'} was deleted, so it was skipped
            </Text>
          </View>
        </View>
      );
    }

    if (node.item.refTemplateId !== null) {
      const resolved = templatesById.get(node.item.refTemplateId);
      const name = resolved?.name ?? node.item.refTemplateName;
      const leafIds = leafIdsUnder(node);
      const allChecked = leafIds.length > 0 && leafIds.every(id => selectedIds.has(id));
      const collapsed = collapsedRefIds.has(node.item.id);
      return (
        <View>
          <View style={[styles.itemRow, indent]}>
            <TouchableOpacity
              onPress={() => toggleNode(node)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="checkbox"
              accessibilityLabel={name}
              accessibilityState={{ checked: allChecked }}
            >
              <Ionicons
                name={allChecked ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={allChecked ? colors.accent : colors.textTertiary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.itemContent}
              onPress={() => toggleCollapsed(node.item.id)}
              activeOpacity={interaction.activeOpacity}
            >
              <View style={styles.nestedTitleRow}>
                <Ionicons name="git-branch-outline" size={13} color={colors.textSecondary} />
                <Text style={[styles.itemTitle, !allChecked && styles.itemTitleUnchecked]} numberOfLines={1}>
                  {name}
                </Text>
              </View>
              <Text style={styles.itemSub} numberOfLines={1}>
                {leafIds.length} item{leafIds.length === 1 ? '' : 's'}
              </Text>
            </TouchableOpacity>
            <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={14} color={colors.textTertiary} />
          </View>
          {!collapsed && renderApplyTreeNodes(node.children, depth + 1)}
        </View>
      );
    }

    const checked = selectedIds.has(node.item.id);
    const sublabel = itemSublabel(node.item, anchors);
    // Shown substituted so the checklist is a live preview of the titles that
    // will actually be created, blanks and all.
    const title = substitutePlaceholders(node.item.title, values);
    return (
      <TouchableOpacity
        style={[styles.itemRow, indent]}
        onPress={() => toggleItem(node.item.id)}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="checkbox"
        accessibilityLabel={title}
        accessibilityState={{ checked }}
      >
        <Ionicons
          name={checked ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={checked ? colors.accent : colors.textTertiary}
        />
        <View style={styles.itemContent}>
          <Text style={[styles.itemTitle, !checked && styles.itemTitleUnchecked]} numberOfLines={1}>
            {title}
          </Text>
          {sublabel && <Text style={styles.itemSub} numberOfLines={1}>{sublabel}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={() => dismiss()}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView
          intensity={isDark ? 20 : 15}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sheetTitle}>{template.name}</Text>

          {/* What this run is about — the one field that carries the context
              the item titles leave out. Optional: blank means loose, unnamed
              tasks, exactly as before it existed. */}
          {showRunField && (
            <View style={styles.runBlock}>
              <TextInput
                style={styles.runInput}
                value={runName}
                onChangeText={setRunName}
                placeholder={`What's this ${template.name.toLowerCase()} for?`}
                placeholderTextColor={colors.textTertiary}
                maxLength={TITLE_MAX_LENGTH}
                returnKeyType="done"
              />
              <Text style={styles.runHint}>
                {runNameHint(container, containerUpgraded, placeholderNames.length > 0)}
              </Text>
            </View>
          )}

          {/* What the template asks about this run. Above the blanks and above
              the checklist both: the answers decide what's ticked below, so a
              question sitting under the list it changes would read as an
              afterthought. */}
          {visibleQuestions.length > 0 && (
            <View style={styles.runBlock}>
              <Text style={styles.blanksLabel}>Questions</Text>
              {visibleQuestions.map(question => (
                <QuestionRow
                  key={question.id}
                  question={question}
                  value={answers[question.id] ?? ''}
                  onChange={value => setTypedAnswers(prev => ({ ...prev, [question.id]: value }))}
                  people={people}
                  colors={colors}
                  styles={styles}
                />
              ))}
            </View>
          )}

          {/* The name stays visible beside the field rather than living in its
              placeholder text — with two or three blanks, a filled-in box with
              no label is unidentifiable. */}
          {placeholderNames.length > 0 && (
            <View style={styles.runBlock}>
              {/* Named, because "blanks" is what the item editor calls them —
                  a labelled group is also what tells someone who has never
                  written one where these boxes came from. */}
              <Text style={styles.blanksLabel}>Blanks</Text>
              {placeholderNames.map(name => (
                <View key={name} style={styles.blankRow}>
                  <Text style={styles.blankLabel} numberOfLines={1}>{name}</Text>
                  <TextInput
                    style={styles.blankInput}
                    value={placeholderValues[name] ?? ''}
                    onChangeText={text => setPlaceholderValues(prev => ({ ...prev, [name]: text }))}
                    maxLength={TITLE_MAX_LENGTH}
                    returnKeyType="done"
                    accessibilityLabel={`Value for ${name}`}
                  />
                </View>
              ))}
            </View>
          )}

          {(showRunField || placeholderNames.length > 0 || visibleQuestions.length > 0) && <View style={styles.inlineSep} />}

          {/* Anchor dates */}
          <AnchorRow
            icon="play-outline"
            label="Start date"
            hint="Items that count days from the start are dated from this day"
            value={startAnchor}
            onPress={() => openCalendar('start')}
            onClear={() => setStartAnchor(null)}
          />
          <View style={styles.inlineSep} />
          <AnchorRow
            icon="flag-outline"
            label="End date"
            hint="Items that count days from the end are dated from this day"
            value={endAnchor}
            onPress={() => openCalendar('end')}
            onClear={() => setEndAnchor(null)}
          />

          <View style={styles.inlineSep} />

          {/* Item checklist, including any nested templates' items indented beneath their ref row */}
          <ScrollView style={styles.itemList} bounces={false}>
            {renderApplyTreeNodes(tree, 0)}
          </ScrollView>

          {anchorless && (
            <Text style={styles.anchorlessHint}>
              Some items count days from a date you haven't set, so they'll be added without dates
            </Text>
          )}

          <TouchableOpacity
            style={[styles.applyBtn, selectedCount === 0 && styles.applyBtnDisabled]}
            onPress={handleApply}
            disabled={selectedCount === 0}
            activeOpacity={interaction.activeOpacity}
          >
            <Text style={[styles.applyBtnText, selectedCount === 0 && styles.applyBtnTextDisabled]}>
              {selectedCount === 0
                ? 'No tasks selected'
                : `Add ${selectedCount} task${selectedCount === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>

      <WhenPicker
        visible={calendarTarget !== null}
        value={calendarTarget === 'end' ? endAnchor : startAnchor}
        title={calendarTarget === 'end' ? 'End date' : 'Start date'}
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={date => {
          if (calendarTarget === 'end') setEndAnchor(date);
          else setStartAnchor(date);
          restoreSheet();
        }}
        onClear={() => {
          if (calendarTarget === 'end') setEndAnchor(null);
          else setStartAnchor(null);
          restoreSheet();
        }}
        onCancel={restoreSheet}
      />
    </Modal>
  );
}

/**
 * One of the two anchor date pickers (start / end) shown atop the sheet.
 * A thin wrapper over `EditorRow` — the row this sheet needs is the same
 * "icon — label — value ›" one every editor uses; it only has to format the
 * Date into the value string first.
 */
/**
 * One question, asked. A choice is pills rather than a `SegmentedControl`
 * because the answers are the author's own words and there's no ceiling on how
 * many or how long they are — a track would either squeeze five answers into
 * one line or wrap ragged, which is a row of pills again inside a box.
 */
function QuestionRow({
  question, value, onChange, people, colors, styles,
}: {
  question: TemplateQuestion;
  value: string;
  onChange: (value: string) => void;
  /** Only read for a `'people'` question — guaranteed non-empty when one reaches this row, see visibleQuestions above. */
  people: Person[];
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.questionBlock}>
      <Text style={styles.questionPrompt} numberOfLines={2}>{questionLabel(question)}</Text>
      {question.kind === 'choice' ? (
        <View style={styles.answerRow}>
          {question.options.map(option => {
            const on = option === value;
            return (
              <TouchableOpacity
                key={option}
                style={[styles.answerPill, on && styles.answerPillOn]}
                onPress={() => { haptics.tap(); onChange(option); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={option}
              >
                <Text style={[styles.answerPillText, on && styles.answerPillTextOn]}>{option}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : question.kind === 'people' ? (
        // No onCreate: someone can be picked here but never invented here,
        // same as MealEntrySheet's guest picker.
        <PillGroup
          noun="person"
          pluralNoun="people"
          surface="card"
          options={people.map(p => {
            const picked = personIdsFromAnswer(value).includes(p.id);
            return {
              key: p.id,
              label: displayNameOf(p),
              selected: picked,
              onPress: () => {
                haptics.tap();
                const ids = personIdsFromAnswer(value);
                onChange(personIdsToAnswer(
                  picked ? ids.filter(id => id !== p.id) : [...ids, p.id]
                ));
              },
            };
          })}
        />
      ) : (
        <TextInput
          style={styles.blankInput}
          value={value}
          onChangeText={onChange}
          placeholder="Answer"
          placeholderTextColor={colors.textTertiary}
          keyboardType={question.kind === 'number' ? 'number-pad' : 'default'}
          maxLength={TITLE_MAX_LENGTH}
          returnKeyType="done"
          accessibilityLabel={questionLabel(question)}
        />
      )}
    </View>
  );
}

function AnchorRow({
  icon, label, hint, value, onPress, onClear,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  value: Date | null;
  onPress: () => void;
  onClear: () => void;
}) {
  return (
    <EditorRow
      icon={icon}
      label={label}
      hint={hint}
      value={value
        ? value.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : undefined}
      onPress={onPress}
      onClear={onClear}
    />
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: {
    backgroundColor: colors.backdrop,
  },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  runBlock: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  // No lineHeight on either input — RN maps it onto the iOS paragraph style
  // with no baseline compensation, dropping the glyphs low in the box. Height
  // does the sizing instead.
  runInput: {
    color: colors.text,
    fontSize: font.md,
    height: 42,
    paddingHorizontal: 11,
    borderRadius: radius.sm,
    borderWidth: border.sm,
    borderColor: colors.accent,
    backgroundColor: colors.bgTertiary,
  },
  runHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  blanksLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  blankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  questionBlock: {
    gap: spacing.xs,
  },
  questionPrompt: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  answerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  answerPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  answerPillOn: {
    backgroundColor: colors.accent,
  },
  answerPillText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  answerPillTextOn: {
    color: colors.onAccent,
    fontWeight: fontWeight.semibold,
  },
  blankLabel: {
    width: 76,
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  blankInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    height: 38,
    paddingHorizontal: 11,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  itemList: {
    maxHeight: 320,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  itemContent: { flex: 1, gap: 1 },
  nestedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  itemTitle: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
  },
  itemTitleUnchecked: {
    color: colors.textSecondary,
  },
  itemSub: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  anchorlessHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    textAlign: 'center',
  },
  applyBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    margin: spacing.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  applyBtnDisabled: {
    backgroundColor: colors.bgTertiary,
  },
  applyBtnText: {
    color: colors.onAccent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  applyBtnTextDisabled: {
    color: colors.textTertiary,
  },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
