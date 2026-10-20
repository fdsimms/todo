import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { CollapsibleField } from './CollapsibleField';
import { CategoryPickerList } from './CategoryPicker';
import { PillGroup } from './PillGroup';
import { InlineAction } from './InlineAction';
import { PressableScale } from './PressableScale';
import { EmptyState } from './EmptyState';
import type { Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { getLogicalToday } from '../utils/dateUtils';
import { scheduleMoveUpdates } from '../utils/taskMoves';
import { projectMoveTargets } from '../utils/projectList';
import { confirmDeleteTask } from '../utils/confirmDeleteTask';
import { inboxSortDay, inboxSortQueue, type InboxSortWhen } from '../utils/inboxSort';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The Inbox as the screen lists it, so the cards follow the same filter. */
  inbox: readonly Task[];
  onClose: () => void;
}

const WHEN_OPTIONS: { value: InboxSortWhen; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'weekend', label: 'Weekend' },
  { value: 'none', label: 'No date' },
];

/**
 * Sorting the Inbox one task at a time: when it's for, its category and its
 * project, answered together and applied with Next, which is the next card.
 * Filing a task is a decision per task, and done row by row it took a swipe
 * and a sheet per field, with the task leaving the Inbox after the first.
 *
 * The queue is the live Inbox less what was skipped (`inboxSortQueue`), so an
 * answered task drops out by leaving the Inbox and needs no index. Answers
 * are written in one `updateTask` with one undo entry. Nothing is written for
 * a card with no answer: Next on it is a skip.
 */
export function InboxSortSheet({ visible, inbox, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const projects = useProjectStore(useShallow(s => s.projects));
  const projectTargets = useMemo(() => projectMoveTargets(projects), [projects]);

  // Every card dealt with this session (answered, skipped or deleted), and
  // which of those were skipped, for what the last card says is left.
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const [skipped, setSkipped] = useState(0);
  const [when, setWhen] = useState<InboxSortWhen>('none');
  // undefined: not answered on this card, which leaves the field alone.
  const [category, setCategory] = useState<string | null | undefined>(undefined);
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState<'category' | 'project' | null>(null);

  const queue = useMemo(() => inboxSortQueue(inbox, handled), [inbox, handled]);
  const current = queue[0] ?? null;
  const total = handled.size + queue.length;
  const position = handled.size + 1;
  const markHandled = (id: string) => setHandled(prev => new Set(prev).add(id));

  // A fresh session each open.
  useEffect(() => {
    if (!visible) return;
    setHandled(new Set());
    setSkipped(0);
  }, [visible]);

  // A fresh card each task.
  useEffect(() => {
    setWhen('none');
    setCategory(undefined);
    setProjectId(undefined);
    setOpen(null);
  }, [current?.id]);

  const skip = () => {
    if (!current) return;
    haptics.tap();
    animateLayout();
    markHandled(current.id);
    setSkipped(n => n + 1);
  };

  const next = () => {
    if (!current) return;
    const day = inboxSortDay(when, getLogicalToday(useSettingsStore.getState().dayResetTime));
    const patch: Partial<Task> = {
      ...(day ? scheduleMoveUpdates(current, day) : {}),
      ...(category !== undefined ? { category } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
    };
    if (Object.keys(patch).length === 0) { skip(); return; }
    const store = useTaskStore.getState();
    const snapshot = { ...current };
    haptics.success();
    animateLayout();
    store.updateTask(current.id, patch, { markSeenOnBecomeVisible: true });
    store.setLastAction({
      label: `Sorted “${current.title}”`,
      undo: () => useTaskStore.getState().updateTask(snapshot.id, snapshot),
    });
    markHandled(current.id);
  };

  const remove = () => {
    if (!current) return;
    haptics.tap();
    const id = current.id;
    confirmDeleteTask(current, () => markHandled(id));
  };

  const categorySummary = category === undefined ? undefined : category ?? 'None';
  const projectName = projectId ? projects.find(p => p.id === projectId)?.title : null;
  const projectSummary = projectId === undefined ? undefined : projectName ?? 'None';

  return (
    <SheetModal name="InboxSortSheet" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title="Sort the Inbox"
          left={<SheetHeaderButton label={BUTTON_LABEL.done} role="cancel" onPress={onClose} minWidth={56} />}
          right={current
            ? <SheetHeaderButton label="Skip" onPress={skip} minWidth={56} />
            : <View style={styles.headerSpacer} />}
        />
        {current ? (
          <>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text style={styles.progress}>{position} of {total}</Text>
              <View style={styles.card}>
                <Text style={styles.title}>{current.title}</Text>
                {!!current.notes.trim() && <Text style={styles.notes} numberOfLines={3}>{current.notes.trim()}</Text>}
              </View>

              <Text style={styles.sectionTitle}>WHEN</Text>
              <SegmentedControl options={WHEN_OPTIONS} value={when} onChange={setWhen} />

              <View style={styles.fields}>
                <CollapsibleField
                  label="Category"
                  icon="folder-outline"
                  summary={categorySummary}
                  emptySummary="Not set"
                  expanded={open === 'category'}
                  onToggle={() => setOpen(o => (o === 'category' ? null : 'category'))}
                >
                  <CategoryPickerList
                    value={category ?? null}
                    onSelect={name => { setCategory(name); setOpen(null); }}
                    maxHeight={260}
                  />
                </CollapsibleField>
                <CollapsibleField
                  label="Project"
                  icon="briefcase-outline"
                  summary={projectSummary}
                  emptySummary="Not set"
                  expanded={open === 'project'}
                  onToggle={() => setOpen(o => (o === 'project' ? null : 'project'))}
                >
                  <PillGroup
                    noun="project"
                    options={[
                      {
                        key: '__none__',
                        label: 'None',
                        pinned: true,
                        selected: projectId === null,
                        onPress: () => { haptics.tap(); setProjectId(null); setOpen(null); },
                      },
                      ...projectTargets.map(p => ({
                        key: p.id,
                        label: p.title,
                        selected: p.id === projectId,
                        onPress: () => { haptics.tap(); setProjectId(p.id); setOpen(null); },
                      })),
                    ]}
                  />
                </CollapsibleField>
              </View>

              <View style={styles.deleteRow}>
                <InlineAction label={BUTTON_LABEL.delete} icon="trash-outline" variant="neutral" onPress={remove} />
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <PressableScale style={styles.primaryBtn} onPress={next} accessibilityRole="button">
                <Text style={styles.primaryBtnText}>{queue.length > 1 ? 'Next' : BUTTON_LABEL.done}</Text>
                {queue.length > 1 && <Ionicons name="arrow-forward" size={18} color={colors.onAccent} />}
              </PressableScale>
            </View>
          </>
        ) : (
          <EmptyState
            icon="checkmark-done-outline"
            title={handled.size > 0 ? 'Inbox sorted' : 'Nothing left to sort'}
            subtitle={skipped > 0
              ? `${skipped === 1 ? 'The task you skipped is' : `The ${skipped} tasks you skipped are`} still in the Inbox.`
              : 'Everything in the Inbox has a place.'}
            actionLabel={BUTTON_LABEL.done}
            onAction={onClose}
          />
        )}
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { minWidth: 56 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  progress: { fontSize: font.xs, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  title: { fontSize: font.lg, fontWeight: fontWeight.semibold, color: colors.text },
  notes: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xs },
  sectionTitle: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  fields: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, marginTop: spacing.lg, overflow: 'hidden' },
  deleteRow: { flexDirection: 'row', marginTop: spacing.lg },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  primaryBtn: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  primaryBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
