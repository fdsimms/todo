import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { TaskTemplate, TemplateContainer, TemplateQuestion, TemplateSchedule, TemplateScheduleFrequency } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { useTemplateStore } from '../store/useTemplateStore';
import { useTemplateCategoryStore } from '../store/useTemplateCategoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { confirmDelete } from '../utils/confirmDelete';
import { findTemplatesReferencing } from '../utils/templateUtils';
import { describeQuestion, questionLabel } from '../utils/templateQuestions';
import { defaultTemplateSchedule, describeTemplateSchedule, ordinal } from '../utils/templateSchedule';
import { formatHHMM, hhmmToDate } from '../utils/clockTime';
import { CollapsibleField } from './CollapsibleField';
import { SegmentedControl } from './SegmentedControl';
import { CountStepper } from './CountStepper';
import { EditorRow } from './EditorRow';
import { InlineTimePicker } from '../screens/settings/InlineTimePicker';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';
import { TemplateQuestionSheet } from './TemplateQuestionSheet';

interface Props {
  visible: boolean;
  template: TaskTemplate | null;
  onClose: () => void;
}

export function TemplateEditor({ visible, template, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const renameTemplate = useTemplateStore(s => s.renameTemplate);
  const setTemplateCategory = useTemplateStore(s => s.setTemplateCategory);
  const setTemplateContainer = useTemplateStore(s => s.setTemplateContainer);
  const setSchedule = useTemplateStore(s => s.setSchedule);
  const deleteTemplate = useTaskStore(s => s.deleteTemplate);
  const templates = useTemplateStore(useShallow(s => s.templates));
  const categories = useTemplateCategoryStore(useShallow(s => s.categories));
  const addCategory = useTemplateCategoryStore(s => s.addCategory);
  const use24HourTime = useSettingsStore(s => s.use24HourTime);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [container, setContainer] = useState<TemplateContainer>('stack');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  // Collapsed to the chosen category until tapped, like every other editor.
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [containerOpen, setContainerOpen] = useState(false);
  const [schedule, setScheduleDraft] = useState<TemplateSchedule | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(() => hhmmToDate('09:00'));
  // null = closed; a question = editing it; 'new' = writing one.
  const [editingQuestion, setEditingQuestion] = useState<TemplateQuestion | 'new' | null>(null);

  useEffect(() => {
    if (!template) return;
    setName(template.name);
    setCategory(template.category);
    setContainer(template.applyContainer);
    setScheduleDraft(template.schedule);
    setCategoryOpen(false);
    setContainerOpen(false);
    setScheduleOpen(false);
    setTimePickerOpen(false);
    setEditingQuestion(null);
  }, [template]);

  const closeCategory = () => { animateLayout(); setCategoryOpen(false); };
  const closeContainer = () => { animateLayout(); setContainerOpen(false); };

  // Done can fire before the new-category field's own blur or Enter has
  // committed it — same race TaskEditor's resolveLinkUrl guards against.
  // Read the live text box instead of trusting stale `category` state.
  const resolveCategory = () => {
    const c = newCategory.trim();
    if (addingCategory && c) {
      addCategory(c);
      return c;
    }
    return category;
  };

  const saveAndClose = () => {
    if (!template) { onClose(); return; }
    const trimmed = name.trim();
    if (trimmed) renameTemplate(template.id, trimmed);
    setTemplateCategory(template.id, resolveCategory());
    setTemplateContainer(template.id, container);
    setSchedule(template.id, schedule);
    onClose();
  };

  // Deleting lives here rather than on the row's swipe, so it takes a
  // deliberate trip into the editor and can spell out what breaks — a template
  // nested inside others leaves them showing a broken-reference warning.
  const handleDelete = () => {
    if (!template) return;
    haptics.warning();
    const referencing = findTemplatesReferencing(templates, template.id);
    const base = `Delete "${template.name}"? Tasks already created from it are unaffected. This can be undone with shake-to-undo.`;
    const message = referencing.length === 0
      ? base
      : referencing.length === 1
        ? `${base} It's used inside "${referencing[0].name}", which will show a warning until you remove or replace the reference.`
        : `${base} It's used inside ${referencing.length} other templates (${referencing.map(t => t.name).join(', ')}), which will show a warning until you remove or replace the reference.`;
    confirmDelete({
      title: 'Delete Template',
      message,
      onConfirm: () => {
        animateLayout();
        deleteTemplate(template.id);
        onClose();
      },
    });
  };

  if (!template) return null;

  // Questions save as you go through their own sheet (see the comment on the
  // card below), so this list has to track the store rather than the `template`
  // prop, which is a draft snapshot that only catches up to the store on Done.
  const liveQuestions = templates.find(t => t.id === template.id)?.questions ?? template.questions;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} minWidth={40} />
          <Text style={styles.headerTitle}>Edit Template</Text>
          <TouchableOpacity
            onPress={handleDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete template ${template.name}`}
          >
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </>
      }
    >
      <TextInput
        style={styles.titleInput}
        value={name}
        onChangeText={setName}
        placeholder="Template name"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={TITLE_MAX_LENGTH}
      />

      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Category"
          summary={category ?? undefined}
          hint="Groups this template with others of the same kind."
          expanded={categoryOpen}
          onToggle={() => setCategoryOpen(v => !v)}
        >
          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[styles.pill, !category && styles.pillActiveNeutral]}
              onPress={() => { haptics.tap(); setCategory(null); closeCategory(); }}
            >
              <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
            </TouchableOpacity>
            {categories.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.pill, category === cat.name && styles.pillActiveNeutral]}
                onPress={() => { haptics.tap(); setCategory(cat.name); closeCategory(); }}
              >
                <Text style={[styles.pillText, category === cat.name && styles.pillTextActive]}>{cat.name}</Text>
              </TouchableOpacity>
            ))}
            {addingCategory ? (
              <TextInput
                autoFocus
                style={styles.tagInput}
                value={newCategory}
                onChangeText={setNewCategory}
                onSubmitEditing={() => {
                  const c = newCategory.trim();
                  if (c) { addCategory(c); setCategory(c); closeCategory(); }
                  setNewCategory(''); setAddingCategory(false);
                }}
                onBlur={() => {
                  const c = newCategory.trim();
                  if (c) { addCategory(c); setCategory(c); closeCategory(); }
                  setNewCategory(''); setAddingCategory(false);
                }}
                placeholder="category name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="words"
              />
            ) : (
              <InlineAction icon="add" label="New" accessibilityLabel="New category" onPress={() => setAddingCategory(true)} />
            )}
          </View>
        </CollapsibleField>
      </View>

      <View style={styles.sectionCard}>
        <CollapsibleField
          label="When applied"
          summary={CONTAINER_LABELS[container]}
          hint="Where a run of this template puts its tasks, once you name the run."
          expanded={containerOpen}
          onToggle={() => setContainerOpen(v => !v)}
        >
          <View style={styles.pillRow}>
            {CONTAINER_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.pill, container === opt && styles.pillActiveNeutral]}
                onPress={() => { haptics.tap(); setContainer(opt); closeContainer(); }}
              >
                <Text style={[styles.pillText, container === opt && styles.pillTextActive]}>
                  {CONTAINER_LABELS[opt]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.containerNote}>{CONTAINER_NOTES[container]}</Text>
          {container === 'stack' && template.itemGroups.length > 0 && (
            <Text style={styles.containerNote}>
              This template has item groups, which already become stacks — a named run of it
              will use a project instead, so the groups have somewhere to sit.
            </Text>
          )}
          {container === 'task' && template.itemGroups.length > 0 && (
            <Text style={styles.containerNote}>
              This template has item groups, but every item becomes a subtask here — the
              groups won't form stacks of their own.
            </Text>
          )}
        </CollapsibleField>
      </View>

      {/* Applies itself (#1781). Under "When applied" on purpose: that field
          says where a run lands, this one says whether a run can start without
          anyone asking, and reading them the other way round makes the second
          question hard to place. */}
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Applies itself"
          summary={describeTemplateSchedule(schedule, use24HourTime)}
          hint="Create this template's tasks on a schedule. Nothing runs while the app is closed, so a run starts the next time you open the app on or after its day."
          expanded={scheduleOpen}
          onToggle={() => setScheduleOpen(v => !v)}
        >
          <SegmentedControl<TemplateScheduleFrequency | 'never'>
            options={FREQUENCY_OPTIONS}
            value={schedule?.frequency ?? 'never'}
            onChange={next => {
              animateLayout();
              setTimePickerOpen(false);
              setScheduleDraft(
                next === 'never'
                  ? null
                  : { ...(schedule ?? defaultTemplateSchedule()), frequency: next }
              );
            }}
          />

          {schedule?.frequency === 'weekly' && (
            <View style={styles.scheduleControl}>
              <SegmentedControl<number>
                label="Day"
                columns={4}
                options={WEEKDAY_OPTIONS}
                value={schedule.weekday}
                onChange={weekday => setScheduleDraft({ ...schedule, weekday })}
              />
            </View>
          )}

          {schedule?.frequency === 'yearly' && (
            <View style={styles.scheduleControl}>
              <SegmentedControl<number>
                label="Month"
                columns={4}
                options={MONTH_OPTIONS}
                value={schedule.month}
                onChange={month => setScheduleDraft({ ...schedule, month })}
              />
            </View>
          )}

          {(schedule?.frequency === 'monthly' || schedule?.frequency === 'yearly') && (
            <View style={styles.scheduleControl}>
              <Text style={styles.scheduleLabel}>DAY OF THE MONTH</Text>
              <CountStepper
                value={schedule.monthDay}
                onChange={next => setScheduleDraft({ ...schedule, monthDay: next ?? 1 })}
                min={1}
                max={31}
                label="Day of the month"
                format={n => ordinal(n)}
              />
              <Text style={styles.containerNote}>
                A day later than a month has runs on that month's last day.
              </Text>
            </View>
          )}

          {schedule !== null && (
            <>
              <EditorRow
                icon="alarm-outline"
                label="From"
                value={formatHHMM(schedule.time)}
                expanded={timePickerOpen}
                onPress={() => {
                  animateLayout();
                  if (timePickerOpen) { setTimePickerOpen(false); return; }
                  setPickerDate(hhmmToDate(schedule.time));
                  setTimePickerOpen(true);
                }}
              />
              {timePickerOpen && (
                <InlineTimePicker
                  value={pickerDate}
                  onChange={setPickerDate}
                  onCancel={() => { animateLayout(); setTimePickerOpen(false); }}
                  onConfirm={() => {
                    animateLayout();
                    const hh = String(pickerDate.getHours()).padStart(2, '0');
                    const mm = String(pickerDate.getMinutes()).padStart(2, '0');
                    setScheduleDraft({ ...schedule, time: `${hh}:${mm}` });
                    setTimePickerOpen(false);
                  }}
                />
              )}

              <View style={styles.scheduleControl}>
                <Text style={styles.scheduleLabel}>RUN LENGTH</Text>
                <CountStepper
                  value={schedule.anchorSpanDays}
                  onChange={anchorSpanDays => setScheduleDraft({ ...schedule, anchorSpanDays })}
                  min={1}
                  max={365}
                  allowNull
                  emptyLabel="One day"
                  format={n => `${n} ${n === 1 ? 'night' : 'nights'}`}
                  label="Run length"
                />
                <Text style={styles.containerNote}>
                  Sets the run's end date, which items can count back from and questions can
                  read as a number of nights or days.
                </Text>
              </View>

              <Text style={styles.containerNote}>
                Questions are answered with their own defaults, and optional items stay
                unchecked — the same as opening this template and applying it without
                changing anything.
              </Text>
            </>
          )}
        </CollapsibleField>
      </View>

      {/* Questions. Their own card of rows rather than a CollapsibleField like
          the two above: those pick one value, this is a list you build — the
          same distinction the detail screen's item list makes, and the reason
          these save as you go while the fields above save on Done. */}
      <View style={[styles.sectionCard, styles.questionsCard]}>
        <Text style={styles.questionsLabel}>QUESTIONS</Text>
        <Text style={styles.containerNote}>
          Asked when you apply this template. An answer fills the blank of the same name in item
          titles, and items can be set to be included only for some answers.
        </Text>
        {liveQuestions.map(question => (
          <TouchableOpacity
            key={question.id}
            style={styles.questionRow}
            onPress={() => { haptics.tap(); setEditingQuestion(question); }}
            accessibilityRole="button"
            accessibilityLabel={`Edit question ${questionLabel(question)}`}
          >
            <View style={styles.questionText}>
              <Text style={styles.questionTitle} numberOfLines={1}>{questionLabel(question)}</Text>
              <Text style={styles.questionSub} numberOfLines={1}>{describeQuestion(question)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}
        <View style={styles.pillRow}>
          <InlineAction
            icon="add"
            label="New question"
            variant="neutral"
            onPress={() => { haptics.tap(); setEditingQuestion('new'); }}
          />
        </View>
      </View>

      {/* Nested inside this sheet rather than beside it — a sibling Modal would
          ask this screen's view controller to present a second sheet while this
          one is already up (same reason GroceryCatalogSheet nests its own). */}
      <TemplateQuestionSheet
        visible={editingQuestion !== null}
        templateId={template.id}
        question={editingQuestion === 'new' ? null : editingQuestion}
        onClose={() => setEditingQuestion(null)}
      />
    </EditorSheet>
  );
}

const FREQUENCY_OPTIONS: Array<{ value: TemplateScheduleFrequency | 'never'; label: string }> = [
  { value: 'never', label: 'Never' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

// date-fns getDay() convention, 0 = Sunday. Three letters so seven fit a
// four-column grid at 390pt without truncating.
const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sun', accessibilityLabel: 'Sunday' },
  { value: 1, label: 'Mon', accessibilityLabel: 'Monday' },
  { value: 2, label: 'Tue', accessibilityLabel: 'Tuesday' },
  { value: 3, label: 'Wed', accessibilityLabel: 'Wednesday' },
  { value: 4, label: 'Thu', accessibilityLabel: 'Thursday' },
  { value: 5, label: 'Fri', accessibilityLabel: 'Friday' },
  { value: 6, label: 'Sat', accessibilityLabel: 'Saturday' },
];

const MONTH_OPTIONS = [
  { value: 1, label: 'Jan', accessibilityLabel: 'January' },
  { value: 2, label: 'Feb', accessibilityLabel: 'February' },
  { value: 3, label: 'Mar', accessibilityLabel: 'March' },
  { value: 4, label: 'Apr', accessibilityLabel: 'April' },
  { value: 5, label: 'May', accessibilityLabel: 'May' },
  { value: 6, label: 'Jun', accessibilityLabel: 'June' },
  { value: 7, label: 'Jul', accessibilityLabel: 'July' },
  { value: 8, label: 'Aug', accessibilityLabel: 'August' },
  { value: 9, label: 'Sep', accessibilityLabel: 'September' },
  { value: 10, label: 'Oct', accessibilityLabel: 'October' },
  { value: 11, label: 'Nov', accessibilityLabel: 'November' },
  { value: 12, label: 'Dec', accessibilityLabel: 'December' },
];

const CONTAINER_OPTIONS: TemplateContainer[] = ['none', 'stack', 'project', 'task'];

const CONTAINER_LABELS: Record<TemplateContainer, string> = {
  none: 'Nothing',
  stack: 'A stack',
  project: 'A project',
  task: 'A task',
};

const CONTAINER_NOTES: Record<TemplateContainer, string> = {
  none: 'Tasks are added loose, and the run name only fills in {blanks}.',
  stack: 'Tasks are headed by a stack named after the run. Best for most templates.',
  project: 'Tasks go in a project named after the run, dated by the two anchors. Best for long, multi-week ones.',
  task: 'Tasks become subtasks of one task named after the run. Best for a routine you want a single checkbox for.',
};

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  titleInput: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: fontWeight.semibold,
    paddingVertical: spacing.sm,
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  pillActiveNeutral: {
    backgroundColor: colors.accent,
  },
  pillText: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  pillTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.medium,
  },
  tagInput: {
    color: colors.text,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    minWidth: 100,
  },
  // Stacked blocks inside the schedule field: margin on both sides, since the
  // control below has no top margin of its own (see the design-system note).
  scheduleControl: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  scheduleLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  containerNote: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: spacing.sm,
  },
  questionsCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  questionsLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    marginTop: spacing.sm,
  },
  questionText: {
    flex: 1,
    gap: 2,
  },
  questionTitle: {
    color: colors.text,
    fontSize: font.sm,
  },
  questionSub: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
});
