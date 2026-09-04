import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskEditor } from '../components/TaskEditor';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { SearchField } from '../components/SearchField';
import { SelectionDot } from '../components/SelectionDot';
import { SimpleBulkBar } from '../components/SimpleBulkBar';
import { PaintSelectionProvider, usePaintSelectionRow } from '../components/PaintSelection';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, lineHeight, fontWeight, iconSize, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { displayTitleFor } from '../utils/visibilityUtils';
import { describeTaskRecurrence } from '../utils/recurrenceLabels';
import { useRowSelection } from '../hooks/useRowSelection';
import type { Task } from '../types';

// A quiet, out-of-the-way home for recurring tasks paused indefinitely (see
// archiveTask/unarchiveTask in useTaskStore) — reached only via the side
// drawer, same as Logbook/Stats, so it stays out of the way until sought out.
//
// Out of the way is not the same as thin, and this list is the one in the app
// with no ceiling on it: archived rows are deliberately exempt from the
// completed-task retention window (see retention.ts), so whatever lands here
// stays until it's dealt with by hand. That's what the search field, the
// selection mode and the per-row context are for — a hundred rows of title and
// archive date is a list you can't answer any question about.
export function ArchivedScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const archivedTasks = useTaskStore(useShallow(s => s.archivedTasks()));
  const unarchiveTask = useTaskStore(s => s.unarchiveTask);
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);
  const projects = useProjectStore(useShallow(s => s.projects));
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [bulkBarHeight, setBulkBarHeight] = useState(0);

  const {
    selectionMode, selectedIds, enterSelectionMode, toggleSelection,
    exitSelection, selectAll, deselectAll, painting, paintProps,
  } = useRowSelection();

  const projectNamesById = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects],
  );

  const sorted = useMemo(
    () => [...archivedTasks].sort((a, b) => new Date(b.archivedAt ?? 0).getTime() - new Date(a.archivedAt ?? 0).getTime()),
    [archivedTasks]
  );

  // A plain substring match rather than fuzzySearch, and undebounced: what
  // someone types here is a name they already know is in the list, and the
  // list is short enough that the filter costs nothing per keystroke. Notes
  // are searched too — the reason a task was paused is usually written there
  // rather than in its title.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(t =>
      displayTitleFor(t).toLowerCase().includes(q)
      || t.notes.toLowerCase().includes(q)
      || (t.category?.toLowerCase().includes(q) ?? false)
    );
  }, [sorted, query]);

  const restore = (id: string) => {
    haptics.tap();
    animateLayout();
    unarchiveTask(id);
  };

  const handleBulkRestore = () => {
    const ids = Array.from(selectedIds);
    animateLayout();
    // One call per row: unarchiveTask restores the streak fields each task had
    // when it was archived, so there is nothing a single bulk write could do
    // that this doesn't. The last one's undo is the one that arms, which is
    // the same trade every other per-row loop in the app makes.
    ids.forEach(id => unarchiveTask(id));
    haptics.success();
    exitSelection();
  };

  // Deliberately not useTaskSelection's delete: that one asks whether a live
  // recurring task should have just this occurrence marked missed, and an
  // archived task has no live occurrence to miss — answering "This Task(s)"
  // there would quietly bring the task back rather than delete it.
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const plural = ids.length === 1 ? 'task' : 'tasks';
    haptics.warning();
    Alert.alert(
      `Delete ${ids.length} ${plural}?`,
      `This removes ${ids.length === 1 ? 'it' : 'them'} for good, along with the history. You can undo by shaking your phone right after.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            bulkDeleteTasks(ids);
            exitSelection();
          },
        },
      ],
    );
  };

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const listBottomPadding = selectionMode
    ? tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm
    : 40;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Archived"
        // Suppressed at zero rather than reading "0 paused" over the empty
        // state that already says so, matching what Drift does with its own.
        subtitle={
          archivedTasks.length === 0
            ? undefined
            : `${archivedTasks.length} ${archivedTasks.length === 1 ? 'task' : 'tasks'} paused`
        }
        actions={archivedTasks.length > 0 && !selectionMode ? [
          {
            icon: 'checkmark-circle-outline',
            onPress: () => enterSelectionMode(),
            accessibilityLabel: 'Select tasks',
          },
        ] : undefined}
      />
      <HubPills hub="history" active="Archived" />

      {archivedTasks.length > 0 && (
        <SearchField
          style={styles.searchBar}
          placeholder="Search archived"
          value={query}
          onChangeText={setQuery}
        />
      )}

      <PaintSelectionProvider {...paintProps}>
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          // A paint gesture owns the touch for its duration — see the note in
          // PaintSelectionProvider on why the list can't scroll out from under it.
          scrollEnabled={!painting}
          // The rows close over the selection, so the list has to be told what
          // changed besides its data.
          extraData={paintProps}
          contentContainerStyle={
            filtered.length === 0
              ? styles.emptyContainer
              : [styles.listContent, { paddingBottom: listBottomPadding }]
          }
          renderItem={({ item }) => (
            <ArchivedRow
              task={item}
              categoryLabel={labelForCategory(item.category, getCategoryByName)}
              projectTitle={item.projectId ? projectNamesById.get(item.projectId) ?? null : null}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onPress={() => (selectionMode ? toggleSelection(item.id) : openEditor(item))}
              onLongPress={() => !selectionMode && enterSelectionMode(item.id)}
              onToggleSelect={() => toggleSelection(item.id)}
              onRestore={() => restore(item.id)}
              styles={styles}
              colors={colors}
              cardShadow={shadows.card}
            />
          )}
          ListEmptyComponent={
            query.trim().length > 0 ? (
              <EmptyState
                icon="search-outline"
                title="No matches"
                subtitle={`Nothing archived matches "${query.trim()}".`}
                bottomOffset={tabBarHeight}
              />
            ) : (
              <EmptyState
                icon="archive-outline"
                title="No archived tasks"
                subtitle="Pause a recurring task without losing its history. Archive it from the task editor and pick back up any time."
                bottomOffset={tabBarHeight}
              />
            )
          }
        />
      </PaintSelectionProvider>

      {selectionMode && (
        <SimpleBulkBar
          selectedCount={selectedIds.size}
          // Counted against what's on screen: with a search applied, "Select
          // All" can only mean the rows it left.
          totalCount={filtered.length}
          primary={{
            icon: 'arrow-undo',
            label: 'Restore',
            onPress: handleBulkRestore,
            accessibilityLabel: 'Restore selected tasks',
          }}
          onDelete={handleBulkDelete}
          deleteAccessibilityLabel="Delete selected tasks"
          onSelectAll={() => selectAll(filtered.map(t => t.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

/** The category chip's text — emoji-prefixed where the category has one, as everywhere else. */
function labelForCategory(
  category: string | null,
  getCategoryByName: (name: string) => { emoji?: string | null } | undefined | null,
): string | null {
  if (!category) return null;
  const emoji = getCategoryByName(category)?.emoji;
  return emoji ? `${emoji} ${category}` : category;
}

interface RowProps {
  task: Task;
  categoryLabel: string | null;
  projectTitle: string | null;
  selectionMode: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onToggleSelect: () => void;
  onRestore: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  cardShadow: object;
}

function ArchivedRow({
  task, categoryLabel, projectTitle, selectionMode, selected,
  onPress, onLongPress, onToggleSelect, onRestore, styles, colors, cardShadow,
}: RowProps) {
  const paintRef = usePaintSelectionRow(task.id);
  const title = displayTitleFor(task);
  // The whole reason this screen exists is paused *recurring* tasks, and until
  // now the one thing it never said was what the schedule had been — so
  // deciding whether to bring something back meant opening it.
  const repeat = task.recurrenceType !== 'none' ? describeTaskRecurrence(task) : null;
  const pausedOn = task.archivedAt ? format(new Date(task.archivedAt), 'MMM d') : null;

  return (
    <View ref={paintRef} style={[styles.card, cardShadow, selected && styles.cardSelected]}>
      <TouchableOpacity
        style={styles.cardBody}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={interaction.delayLongPress}
        activeOpacity={interaction.activeOpacity}
        accessible
        accessibilityRole="button"
        accessibilityLabel={[
          title,
          repeat,
          categoryLabel,
          projectTitle,
          pausedOn ? `paused ${pausedOn}` : null,
        ].filter(Boolean).join(', ')}
        accessibilityHint={selectionMode ? undefined : 'Double tap to open task'}
      >
        <Text style={styles.taskTitle} numberOfLines={2}>{title}</Text>
        <View style={styles.metaRow}>
          {/* Schedule first: it's the thing this screen was missing and the
              one you're deciding against. Category and project are context
              for it, and a long rule ("Every month on the 2nd Tuesday") wraps
              them onto a second line rather than truncating them both. */}
          {repeat && (
            <View style={styles.metaChip}>
              <Ionicons name="repeat" size={iconSize.xs} color={colors.textSecondary} />
              <Text style={styles.metaText} numberOfLines={1}>{repeat}</Text>
            </View>
          )}
          {categoryLabel && (
            <View style={styles.metaChip}>
              <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textSecondary} />
              <Text style={styles.metaText} numberOfLines={1}>{categoryLabel}</Text>
            </View>
          )}
          {projectTitle && (
            <View style={styles.metaChip}>
              <Ionicons name="briefcase-outline" size={iconSize.xs} color={colors.textSecondary} />
              <Text style={styles.metaText} numberOfLines={1}>{projectTitle}</Text>
            </View>
          )}
          {pausedOn && <Text style={styles.metaDim}>· Paused {pausedOn}</Text>}
        </View>
      </TouchableOpacity>

      {selectionMode ? (
        <SelectionDot selected={selected} onPress={onToggleSelect} />
      ) : (
        <TouchableOpacity
          style={styles.restoreButton}
          onPress={onRestore}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Restore ${title}`}
        >
          <Ionicons name="arrow-undo" size={iconSize.sm} color={colors.accent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchBar: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  listContent: { paddingTop: 2 },
  emptyContainer: { flexGrow: 1 },
  // The same inset-grouped card footprint as TaskItem rows. These rows open
  // the editor on tap, which is the interaction that treatment stands for —
  // the Logbook's flat rows are flat precisely because its entries don't.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    paddingVertical: spacing.sm + 3,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  cardSelected: { backgroundColor: colors.accentSubtle },
  cardBody: { flex: 1, minWidth: 0 },
  taskTitle: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.regular,
  },
  // Wraps rather than squeezing, the same call TaskItem's own meta row makes:
  // a row carrying a schedule, a category and a project has more than fits at
  // 390pt, and three half-truncated chips say less than two whole ones and a
  // second line. Nothing here is measured by a getItemLayout, so a taller row
  // costs nothing.
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  metaText: { color: colors.textSecondary, fontSize: font.xs },
  metaDim: { color: colors.textTertiary, fontSize: font.xs, flexShrink: 0 },
  restoreButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
