import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CollapsibleField } from './CollapsibleField';
import { PillGroup, type PillGroupOption } from './PillGroup';
import { SegmentedControl } from './SegmentedControl';
import { CountStepper } from './CountStepper';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSavedViewStore } from '../store/useSavedViewStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import {
  clauseOfKind,
  describeSavedViewClause,
  savedViewClauseLabel,
  savedViewTriClause,
  savedViewTriState,
  withClause,
  type SavedViewTriKind,
  SAVED_VIEW_ICONS,
  DEFAULT_SAVED_VIEW_ICON,
} from '../utils/savedViews';
import {
  EFFORT_HINTS,
  EFFORT_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  TITLE_MAX_LENGTH,
  type Effort,
  type Priority,
  type SavedView,
  type SavedViewClause,
  type SavedViewClauseKind,
} from '../types';

interface Props {
  visible: boolean;
  /** The view being edited, or null to create one. */
  view: SavedView | null;
  onClose: () => void;
  /** Called with the new view's id after a create, so a caller can open it. */
  onCreated?: (id: string) => void;
  /** Called after the view is deleted, so a screen showing it can leave. */
  onDeleted?: () => void;
  /**
   * Clauses to start a *new* view from, so "save as view" in the filter sheet
   * opens a form that already says what was on screen. Ignored when editing.
   */
  initialClauses?: SavedViewClause[];
}

/**
 * Building or editing a saved view (#2679).
 *
 * Progressive disclosure, same as the task editor: one `CollapsibleField` per
 * clause kind, each reading as its own summary until it is opened. Ten
 * collapsed one-line rows is a form somebody can take in; ten expanded pickers
 * is not, which is the whole reason the editors are built this way.
 *
 * Every clause control reaches for the primitive its shape calls for rather
 * than a bespoke one — `PillGroup` for the multi-select sets, a tri-state
 * `SegmentedControl` for the two-position clauses (the third position is "not
 * part of this view at all"), and `CountStepper` for the one open-ended number.
 *
 * It stages its edits, so it owes the pageSheet swipe-down a dirty check:
 * `handleCancel` is wired to both `onRequestClose` and the header's Cancel, or
 * a swipe would drop what was typed with nothing said.
 */
export function SavedViewEditorSheet({ visible, view, onClose, onCreated, onDeleted, initialClauses }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const categories = useCategoryStore(useShallow(s => s.categories));
  const projects = useProjectStore(useShallow(s => s.projects));
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const createView = useSavedViewStore(s => s.createView);
  const updateView = useSavedViewStore(s => s.updateView);
  const removeView = useSavedViewStore(s => s.removeView);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(DEFAULT_SAVED_VIEW_ICON);
  const [clauses, setClauses] = useState<SavedViewClause[]>([]);
  const [openField, setOpenField] = useState<SavedViewClauseKind | null>(null);

  // Reseeded whenever the sheet opens, so an edit that was cancelled doesn't
  // come back on the next open, and a create always starts empty.
  useEffect(() => {
    if (!visible) return;
    setName(view?.name ?? '');
    setIcon(view?.icon ?? DEFAULT_SAVED_VIEW_ICON);
    setClauses(view?.clauses ?? initialClauses ?? []);
    setOpenField(null);
  }, [visible, view, initialClauses]);

  const dirty =
    name !== (view?.name ?? '')
    || icon !== (view?.icon ?? DEFAULT_SAVED_VIEW_ICON)
    || JSON.stringify(clauses) !== JSON.stringify(view?.clauses ?? initialClauses ?? []);

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
    const trimmed = name.trim();
    if (!trimmed) return;
    if (view) {
      updateView(view.id, { name: trimmed, icon, clauses });
    } else {
      const created = createView(trimmed, icon, clauses);
      onClose();
      onCreated?.(created.id);
      return;
    }
    onClose();
  };

  const handleDelete = () => {
    if (!view) return;
    confirmDelete({
      title: 'Delete view?',
      message: `"${view.name}" will be removed. The tasks it matched are not touched.`,
      onConfirm: () => {
        removeView(view.id);
        onClose();
        onDeleted?.();
      },
    });
  };

  const setClause = (kind: SavedViewClauseKind, clause: SavedViewClause | null) => {
    setClauses(prev => withClause(prev, kind, clause));
  };

  /** Toggling one value of a multi-select clause, dropping the clause at zero. */
  const toggleValue = <T extends string | number>(
    kind: 'category' | 'tag' | 'project' | 'priority' | 'effort',
    current: readonly T[],
    value: T,
  ) => {
    haptics.tap();
    const next = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    // An empty list is inert anyway (see matchesClause), but dropping the
    // clause entirely is what keeps the description honest: a view showing
    // "Category" with nothing in it claims a filter it isn't applying.
    setClause(kind, next.length === 0 ? null : ({ kind, values: next } as SavedViewClause));
  };

  const pillOptions = <T extends string | number>(
    kind: 'category' | 'tag' | 'project' | 'priority' | 'effort',
    current: readonly T[],
    entries: { value: T; label: string; suffix?: string }[],
  ): PillGroupOption[] => entries.map(entry => ({
    key: String(entry.value),
    label: entry.label,
    suffix: entry.suffix,
    selected: current.includes(entry.value),
    onPress: () => toggleValue(kind, current, entry.value),
  }));

  const categoryClause = clauseOfKind(clauses, 'category');
  const tagClause = clauseOfKind(clauses, 'tag');
  const projectClause = clauseOfKind(clauses, 'project');
  const priorityClause = clauseOfKind(clauses, 'priority');
  const effortClause = clauseOfKind(clauses, 'effort');
  const minutesClause = clauseOfKind(clauses, 'maxMinutes');

  const projectNames = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects],
  );

  const summaryFor = (kind: SavedViewClauseKind): string | undefined => {
    const clause = clauses.find(c => c.kind === kind);
    if (!clause) return undefined;
    return describeSavedViewClause(clause, { projectNames }) ?? undefined;
  };

  const renderTriState = (
    kind: SavedViewTriKind,
    yesLabel: string,
    noLabel: string,
  ) => {
    const value = savedViewTriState(clauses.find(c => c.kind === kind));
    return (
      <SegmentedControl
        label={savedViewClauseLabel(kind)}
        value={value}
        options={[
          { value: 'any' as const, label: 'Any' },
          { value: 'yes' as const, label: yesLabel },
          { value: 'no' as const, label: noLabel },
        ]}
        onChange={next => {
          haptics.tap();
          if (next === 'any') { setClause(kind, null); return; }
          setClause(kind, savedViewTriClause(kind, next === 'yes'));
        }}
      />
    );
  };

  // `CollapsibleField` draws no divider of its own — in the task editor those
  // come from `EditorGroup`'s `divider="full"`. This card can't use that one,
  // because the AND rule above needs a group-level hint EditorGroup has no
  // slot for, so it supplies the same hairline itself. `last` drops it on the
  // final row, where a rule would sit against the card's own edge.
  const field = (
    kind: SavedViewClauseKind,
    hint: string,
    children: React.ReactNode,
    last = false,
  ) => (
    <View key={kind} style={last ? undefined : styles.fieldDivider}>
      <CollapsibleField
        label={savedViewClauseLabel(kind)}
        summary={summaryFor(kind)}
        emptySummary="Any"
        hint={hint}
        expanded={openField === kind}
        onToggle={() => setOpenField(prev => (prev === kind ? null : kind))}
      >
        {children}
      </CollapsibleField>
    </View>
  );

  return (
    <SheetModal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
      name="SavedViewEditorSheet"
    >
      <View style={styles.root}>
        <SheetHeader
          title={view ? 'Edit view' : 'New view'}
          left={<SheetHeaderButton role="cancel" label="Cancel" onPress={handleCancel} />}
          right={
            <SheetHeaderButton
              label="Save"
              onPress={handleSave}
              disabled={name.trim().length === 0}
            />
          }
        />

        <ScrollView
          ref={keyboardScroll.ref}
          {...keyboardScroll.props}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.groupLabel}>NAME</Text>
          <View style={styles.card}>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Quick wins"
              placeholderTextColor={colors.textTertiary}
              maxLength={TITLE_MAX_LENGTH}
              returnKeyType="done"
            />
          </View>

          <Text style={styles.groupLabel}>ICON</Text>
          <View style={[styles.card, styles.iconRow]}>
            {SAVED_VIEW_ICONS.map(glyph => {
              const active = glyph === icon;
              return (
                <TouchableOpacity
                  key={glyph}
                  onPress={() => { haptics.tap(); setIcon(glyph); }}
                  style={[
                    styles.iconChoice,
                    { backgroundColor: active ? colors.accent : colors.bgTertiary },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Icon ${glyph.replace('-outline', '')}`}
                >
                  <Ionicons
                    name={glyph as never}
                    size={18}
                    color={active ? colors.onAccent : colors.textSecondary}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.groupLabel}>MATCHES</Text>
          <Text style={styles.groupHint}>
            A task has to pass every one of these. Anything left on Any is not part of the view.
          </Text>
          <View style={styles.card}>
            {field('category', 'Only tasks filed under one of these categories.', (
              <PillGroup
                options={pillOptions('category', categoryClause?.values ?? [], categories.map(c => ({ value: c.name, label: c.name })))}
                noun="category"
                pluralNoun="categories"
                filterPlaceholder="Find a category…"
              />
            ))}
            {field('tag', 'Tasks carrying any one of these tags.', (
              <PillGroup
                options={pillOptions('tag', tagClause?.values ?? [], allTags.map(t => ({ value: t, label: `#${t}` })))}
                noun="tag"
                filterPlaceholder="Find a tag…"
              />
            ))}
            {field('project', 'Tasks belonging to one of these projects.', (
              <PillGroup
                options={pillOptions('project', projectClause?.values ?? [], projects.map(p => ({ value: p.id, label: p.title })))}
                noun="project"
                filterPlaceholder="Find a project…"
              />
            ))}
            {field('priority', 'Tasks set to one of these priorities.', (
              <PillGroup
                options={pillOptions(
                  'priority',
                  priorityClause?.values ?? [],
                  ([1, 2, 3, 4] as Priority[]).map(p => ({ value: p, label: PRIORITY_LABELS[p] })),
                )}
                noun="priority"
                pluralNoun="priorities"
              />
            ))}
            {field('effort', 'Tasks set to one of these effort sizes.', (
              <PillGroup
                options={pillOptions(
                  'effort',
                  effortClause?.values ?? [],
                  ([1, 2, 3, 4, 5, 6] as Effort[]).map(e => ({
                    value: e,
                    label: EFFORT_LABELS[e],
                    suffix: EFFORT_HINTS[e],
                  })),
                )}
                noun="effort"
                pluralNoun="effort sizes"
              />
            ))}
            {field('maxMinutes', 'Tasks estimated at this long or less. A task with no estimate and no effort is left out, since nothing says it is quick.', (
              <CountStepper
                value={minutesClause?.minutes ?? null}
                onChange={next => setClause('maxMinutes', next === null ? null : { kind: 'maxMinutes', minutes: next })}
                min={5}
                max={240}
                step={5}
                allowNull
                emptyLabel="Any"
                format={n => `${n} min`}
                label="Time estimate"
              />
            ))}
            {field('overdue', 'Whether the task is past its due date.', renderTriState('overdue', 'Overdue', 'Not overdue'))}
            {field('hasReminder', 'Whether a reminder is set on the task.', renderTriState('hasReminder', 'Set', 'None'))}
            {field('heldBack', 'Whether the task is waiting on another task or on a person.', renderTriState('heldBack', 'Blocked', 'Free'))}
            {field('undated', 'Whether the task has a date at all, due or deferred.', renderTriState('undated', 'No date', 'Has a date'), true)}
          </View>

          {view !== null && (
            <TouchableOpacity
              style={[styles.card, styles.deleteRow]}
              onPress={handleDelete}
              accessibilityRole="button"
              accessibilityLabel={`Delete the ${view.name} view`}
            >
              <Ionicons name="trash-outline" size={18} color={colors.red} />
              <Text style={styles.deleteLabel}>Delete view</Text>
            </TouchableOpacity>
          )}
          {view !== null && (
            <Text style={styles.deleteHint}>
              Deleting a view leaves every task it matched exactly where it is. A view only ever filtered them.
            </Text>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
  groupLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  groupHint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.hairline,
    borderColor: colors.separator,
    paddingHorizontal: spacing.md,
  },
  nameInput: {
    fontSize: font.md,
    color: colors.text,
    paddingVertical: spacing.smd,
    // No lineHeight: RN maps it onto the iOS paragraph style with no baseline
    // compensation, which sits the glyphs low in the field.
    minHeight: 44,
  },
  iconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  fieldDivider: {
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  deleteLabel: {
    fontSize: font.md,
    color: colors.red,
  },
  deleteHint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  iconChoice: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
