import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CollapsibleField } from './CollapsibleField';
import { CategoryPickerList } from './CategoryPicker';
import { PillGroup } from './PillGroup';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { DeliverableKindPicker } from './DeliverableKindPicker';
import { TaskFieldDefaultsFields } from './TaskFieldDefaultsFields';
import { TextField } from './TextField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, checkboxRadius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { categoryLabel } from '../utils/categoryLabel';
import { deliverableMeta, parseDeliverableOptions } from '../utils/deliverables';
import { describeTaskFieldDefaults } from '../utils/taskFieldDefaults';
import {
  NO_GENERATED_TASK_EXTRAS,
  describeTimeSegments,
  hasGeneratedTaskExtras,
  type TaskSettingsSpec,
} from '../utils/generatedTaskSettings';
import type { GeneratedKind, GeneratedTaskExtras, TaskFieldDefaults, TimeOfDay } from '../types';

interface Props {
  visible: boolean;
  kind: GeneratedKind;
  /** The kind's entry in `TASK_SETTINGS_SPECS`: its owned fields and names. */
  spec: TaskSettingsSpec;
  /** The generator's Settings label, shown under the title. */
  generatorLabel: string;
  /** The kind's own category setting, read and written by the caller. */
  category: string | null;
  onSetCategory: (category: string | null) => void;
  onClose: () => void;
}

type FieldKey = 'category' | 'tags' | 'time' | 'priority' | 'deliverable';

const TIME_OPTIONS: SegmentOption<TimeOfDay | null>[] = [
  { value: null, label: 'Any' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
];

/**
 * One kind of generated task, laid out field by field like a task: the fields
 * its generator writes shown locked with where they come from, and the rest
 * editable. See `src/utils/generatedTaskSettings.ts` for what is stored where
 * and the "fills, never overrides" rule.
 *
 * Staged and saved on Save, so it carries the `handleCancel` discard guard a
 * pageSheet holding uncommitted state needs (the swipe-down calls
 * `onRequestClose`, not Cancel).
 */
export function GeneratedTaskSettingsSheet({ visible, kind, spec, generatorLabel, category, onSetCategory, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const storedDefaults = useSettingsStore(s => s.generatedTaskDefaults[kind]);
  const storedExtras = useSettingsStore(s => s.generatedTaskExtras[kind]);
  const groceryUseUpLeadDays = useSettingsStore(s => s.groceryUseUpLeadDays);
  const birthdayLeadDays = useSettingsStore(s => s.birthdayLeadDays);
  const birthdayGiftLeadDays = useSettingsStore(s => s.birthdayGiftLeadDays);
  const mealShortfallLeadDays = useSettingsStore(s => s.mealShortfallLeadDays);
  const rewardsEnabled = useSettingsStore(s => s.rewardsEnabled);
  const setGeneratedTaskDefaults = useSettingsStore(s => s.setGeneratedTaskDefaults);
  const setGeneratedTaskExtras = useSettingsStore(s => s.setGeneratedTaskExtras);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const categories = useCategoryStore(useShallow(s => s.categories));

  const [draftCategory, setDraftCategory] = useState<string | null>(category);
  const [defaults, setDefaults] = useState<TaskFieldDefaults | null>(storedDefaults ?? null);
  const [extras, setExtras] = useState<GeneratedTaskExtras>(storedExtras ?? NO_GENERATED_TASK_EXTRAS);
  const [optionsText, setOptionsText] = useState('');
  const [open, setOpen] = useState<FieldKey | null>(null);
  // What the sheet opened with, so Cancel only asks when something changed.
  const opened = useRef('');

  const snapshot = (c: string | null, d: TaskFieldDefaults | null, e: GeneratedTaskExtras, o: string) =>
    JSON.stringify([c, d, e.tags, e.timeSegments, e.deliverableKind, e.deliverableKind === 'choice' ? o : '']);

  useEffect(() => {
    if (!visible) return;
    const e = storedExtras ?? NO_GENERATED_TASK_EXTRAS;
    const o = e.deliverableOptions.join(', ');
    setDraftCategory(category);
    setDefaults(storedDefaults ?? null);
    setExtras(e);
    setOptionsText(o);
    setOpen(null);
    opened.current = snapshot(category, storedDefaults ?? null, e, o);
    // Seeded on the open only, so a sync landing mid-edit doesn't stomp it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, kind]);

  const dirty = snapshot(draftCategory, defaults, extras, optionsText) !== opened.current;

  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const handleSave = () => {
    // A locked row's field is the generator's, so nothing stays stored for it.
    const askLocked = (spec.locks ?? []).includes('ask');
    const deliverableKind = askLocked ? null : extras.deliverableKind;
    const finalExtras: GeneratedTaskExtras = {
      ...extras,
      timeSegments: (spec.locks ?? []).includes('time') ? [] : extras.timeSegments,
      deliverableKind,
      deliverableOptions: deliverableKind === 'choice' ? parseDeliverableOptions(optionsText) : [],
    };
    if (draftCategory !== category) onSetCategory(draftCategory);
    setGeneratedTaskDefaults(kind, defaults);
    setGeneratedTaskExtras(kind, hasGeneratedTaskExtras(finalExtras) ? finalExtras : null);
    haptics.success();
    onClose();
  };

  const toggle = (key: FieldKey) => setOpen(prev => (prev === key ? null : key));
  const locks = spec.locks ?? [];
  const owned = spec.owned({ groceryUseUpLeadDays, birthdayLeadDays, birthdayGiftLeadDays, mealShortfallLeadDays });
  const categoryName = draftCategory ? categoryLabel(draftCategory, categories) : null;
  const timeSummary = describeTimeSegments(extras.timeSegments);
  const defaultsSummary = describeTaskFieldDefaults(defaults);
  const tagOptions = [...extras.tags, ...allTags.filter(t => !extras.tags.includes(t))];
  const toggleTag = (tag: string) => setExtras(prev => ({
    ...prev,
    tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
  }));
  const exampleMeta = [
    categoryName,
    ...extras.tags.map(t => `#${t}`),
    timeSummary,
    defaultsSummary,
  ].filter((p): p is string => !!p).join(' · ');

  return (
    <SheetModal
      name="GeneratedTaskSettingsSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={[styles.root, { paddingTop: spacing.md }]}>
        <SheetHeader
          title={spec.noun}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} />}
          right={<SheetHeaderButton label="Save" onPress={handleSave} />}
        />
        <Text style={styles.headerSubtitle} numberOfLines={1}>{generatorLabel}</Text>
        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.scroll}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <Text style={styles.intro}>
            Every task this setting adds starts like this. The fields under Set by the app come from
            what the task is about, and the rest are yours. Changes apply to tasks added from now on.
          </Text>

          <Text style={styles.groupLabel}>Example</Text>
          <View style={styles.card}>
            <View style={styles.example}>
              <View style={styles.exampleBox} />
              <View style={styles.exampleText}>
                <Text style={styles.exampleTitle}>{spec.example}</Text>
                {!!exampleMeta && <Text style={styles.exampleMeta}>{exampleMeta}</Text>}
              </View>
            </View>
          </View>

          <Text style={styles.groupLabel}>Set by the app</Text>
          <View style={styles.card}>
            {owned.map((field, i) => (
              <React.Fragment key={field.key}>
                {i > 0 && <View style={styles.sep} />}
                <CollapsibleField
                  label={field.label}
                  summary={field.summary}
                  lockedHint={field.hint}
                  locked
                  expanded={false}
                  onToggle={() => {}}
                >
                  {null}
                </CollapsibleField>
              </React.Fragment>
            ))}
          </View>

          <Text style={styles.groupLabel}>Organize</Text>
          <View style={styles.card}>
            <CollapsibleField
              label="Category"
              summary={categoryName ?? undefined}
              hint={spec.categoryHint ?? 'With none, these tasks appear at the top of Today, above your categories.'}
              expanded={open === 'category'}
              onToggle={() => toggle('category')}
            >
              <CategoryPickerList
                value={draftCategory}
                onSelect={name => { setDraftCategory(name); setOpen(null); }}
              />
            </CollapsibleField>
            <View style={styles.sep} />
            <CollapsibleField
              label="Tags"
              summary={extras.tags.length > 0 ? extras.tags.join(', ') : undefined}
              hint="Added to every task of this kind, alongside any the app adds."
              expanded={open === 'tags'}
              onToggle={() => toggle('tags')}
            >
              <PillGroup
                noun="tag"
                surface="card"
                options={tagOptions.map(tag => ({
                  key: tag,
                  label: tag,
                  selected: extras.tags.includes(tag),
                  onPress: () => { haptics.tap(); toggleTag(tag); },
                  accessibilityLabel: `Tag ${tag}`,
                }))}
                onCreate={name => {
                  const tag = name.trim();
                  if (!tag) return 'Name the tag.';
                  if (!extras.tags.includes(tag)) toggleTag(tag);
                }}
              />
            </CollapsibleField>
          </View>

          {!locks.includes('time') && <Text style={styles.groupLabel}>Schedule</Text>}
          {!locks.includes('time') && <View style={styles.card}>
            <CollapsibleField
              label="Time of day"
              summary={timeSummary ?? undefined}
              emptySummary="Any"
              hint="Keeps these tasks off Today until that part of the day. The date is still set by the app."
              expanded={open === 'time'}
              onToggle={() => toggle('time')}
            >
              <SegmentedControl<TimeOfDay | null>
                label="Time of day"
                value={extras.timeSegments[0] ?? null}
                onChange={tod => { setExtras(prev => ({ ...prev, timeSegments: tod ? [tod] : [] })); setOpen(null); }}
                columns={3}
                options={TIME_OPTIONS}
              />
            </CollapsibleField>
          </View>}

          <Text style={styles.groupLabel}>Priority & effort</Text>
          <View style={styles.card}>
            <CollapsibleField
              label="Priority & effort"
              summary={defaultsSummary ?? undefined}
              emptySummary="Not set"
              hint="Not set uses your app-wide default, and anything still unanswered shows up in Backfill."
              expanded={open === 'priority'}
              onToggle={() => toggle('priority')}
            >
              <TaskFieldDefaultsFields
                value={defaults}
                onChange={setDefaults}
                showDifficulty={rewardsEnabled}
                oneOffOnly
              />
            </CollapsibleField>
          </View>

          {!locks.includes('ask') && <Text style={styles.groupLabel}>More</Text>}
          {!locks.includes('ask') && <View style={styles.card}>
            <CollapsibleField
              label="Ask on completion"
              summary={extras.deliverableKind ? deliverableMeta(extras.deliverableKind).label : undefined}
              emptySummary="Nothing"
              hint={
                extras.deliverableKind
                  ? deliverableMeta(extras.deliverableKind).hint
                  : 'Asks for an answer when the task is completed and keeps it in the Logbook.'
              }
              expanded={open === 'deliverable'}
              onToggle={() => toggle('deliverable')}
            >
              <DeliverableKindPicker
                value={extras.deliverableKind}
                onChange={deliverableKind => { setExtras(prev => ({ ...prev, deliverableKind })); setOpen(null); }}
              />
            </CollapsibleField>
            {extras.deliverableKind === 'choice' && (
              <>
                <TextField
                  style={styles.input}
                  value={optionsText}
                  onChangeText={setOptionsText}
                  placeholder="e.g. Yes, No, Maybe"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  accessibilityLabel="Options to pick from, separated by commas"
                />
                {parseDeliverableOptions(optionsText).length < 2 && (
                  <Text style={styles.inputHint}>
                    Add at least two options, separated by commas. With fewer, completing the task asks nothing.
                  </Text>
                )}
              </>
            )}
          </View>}

          <View style={styles.footnote}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.footnoteText}>
              Repeat, chains, targets and waiting on another task aren’t offered here, because the app
              decides when each of these tasks appears.
            </Text>
          </View>
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: font.xs,
    textAlign: 'center',
    marginTop: spacing.xxs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  scroll: { flex: 1 },
  body: { padding: spacing.md },
  intro: {
    color: colors.text,
    fontSize: font.sm,
    lineHeight: 19,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.md,
    padding: spacing.smd,
  },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  example: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.smd, paddingVertical: spacing.smd },
  exampleBox: {
    width: 22, height: 22, borderRadius: checkboxRadius(22),
    borderWidth: 1.5, borderColor: colors.controlBorder, marginTop: 1,
  },
  exampleText: { flex: 1 },
  exampleTitle: { color: colors.text, fontSize: font.md },
  exampleMeta: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  input: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
    marginBottom: spacing.smd,
  },
  inputHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: -spacing.xs, marginBottom: spacing.smd },
  footnote: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  footnoteText: { flex: 1, color: colors.textSecondary, fontSize: font.xs, lineHeight: 17 },
});
