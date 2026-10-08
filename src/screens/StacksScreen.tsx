import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Category, Task, TaskGroup } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { TaskGroupEditor } from '../components/TaskGroupEditor';
import { InlineNameField } from '../components/InlineNameField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { Fab, FAB_SIZE } from '../components/Fab';
import { SwipeableRow } from '../components/SwipeableRow';
import { SwipeActionButtons } from '../components/SwipeActionButtons';
import { PaintSelectionProvider, usePaintSelectionRow } from '../components/PaintSelection';
import { SelectionDot } from '../components/SelectionDot';
import { ListBulkBar } from '../components/ListBulkBar';
import { CategoryPickerSheet } from '../components/CategoryPicker';
import { useRowSelection } from '../hooks/useRowSelection';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, flattenOverlay, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { groupRoster, isRelevantToGroupToday } from '../utils/visibilityUtils';
import { categoryLabel } from '../utils/categoryLabel';

/**
 * Every stack, whether or not it has work today.
 *
 * The stack rows on Today only render for stacks with something due
 * (see visibleGroupItems in TodayScreen), which is right for that screen and
 * leaves a stack whose members are all scheduled for next week — or one with
 * no members at all — with no way in. This is that way in: the peer of
 * Categories/Tags/Templates for the one organizing entity that didn't have a
 * list of its own.
 */
export function StacksScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const groups = useTaskGroupStore(s => s.groups);
  const createGroup = useTaskGroupStore(s => s.createGroup);
  const allTasks = useTaskStore(s => s.tasks);
  const bulkDeleteGroups = useTaskStore(s => s.bulkDeleteGroups);
  const bulkSetGroupCategory = useTaskStore(s => s.bulkSetGroupCategory);
  const categories = useCategoryStore(useShallow(s => s.categories));

  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  // The "New stack" name field, open at the end of the list.
  const [naming, setNaming] = useState(false);
  const keyboardScroll = useKeyboardInsetScroll<FlatList>();
  const listRef = keyboardScroll.ref;

  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);

  // Selection is entered by swiping a row, same as Templates/Logbook/Grocery —
  // there's no separate "Select" affordance elsewhere on this screen.
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    painting,
    paintProps,
  } = useRowSelection();

  // The roster, never the raw child rows: a recurring member leaves a
  // completed row behind on every completion and they all keep the stack's
  // groupId, so counting rows makes an 8-task stack climb without bound (see
  // groupRoster). Built once for every stack rather than per row, since each
  // pass is a scan of the full task list.
  const rostersByGroupId = useMemo(() => {
    const children = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.groupId) continue;
      const list = children.get(t.groupId);
      if (list) list.push(t);
      else children.set(t.groupId, [t]);
    }
    const rosters = new Map<string, Task[]>();
    for (const [groupId, list] of children) {
      rosters.set(groupId, groupRoster(list));
    }
    return rosters;
  }, [allTasks]);

  const openEditor = useCallback((group: TaskGroup) => {
    setEditingGroup(group);
    setEditorVisible(true);
  }, []);

  // Stable and taking the stack it acts on, so `StackRow`'s memo holds — see
  // its own note.
  const handleOpenStack = useCallback((group: TaskGroup) => {
    haptics.tap();
    openEditor(group);
  }, [openEditor]);

  // A new stack is named in place, in a field at the end of the list where
  // its row will land. The rest (category, members) is on the row's editor,
  // one tap away once it exists.
  const startNaming = () => {
    setNaming(true);
    listRef.current?.scrollToEnd({ animated: true });
  };

  const createStack = (name: string) => {
    setNaming(false);
    animateLayout();
    haptics.tap();
    createGroup(name, null);
  };

  const closeEditor = () => {
    setEditorVisible(false);
    setEditingGroup(null);
  };

  // Extra bottom padding so the last rows aren't hidden behind the floating
  // bulk bar, same as the other bulk-selecting screens.
  const selectionListPadding = tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm;

  const handleBulkSetCategory = (category: string | null) => {
    setCategoryPickerVisible(false);
    animateLayout();
    bulkSetGroupCategory(Array.from(selectedIds), category);
    exitSelection();
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Same rule as the single-stack delete in TaskGroupEditor: with no
    // members anywhere in the selection, offering a cascade choice would ask
    // the user to weigh a consequence that doesn't exist.
    const anyMembers = ids.some(id => (rostersByGroupId.get(id)?.length ?? 0) > 0);
    const stackWord = ids.length === 1 ? 'Stack' : 'Stacks';
    const possessive = ids.length === 1 ? 'Its' : 'Their';
    haptics.warning();
    const deleteThenClose = (cascade: boolean) => () => {
      animateLayout();
      bulkDeleteGroups(ids, { cascade });
      exitSelection();
    };
    Alert.alert(
      `Delete ${ids.length} ${stackWord}?`,
      `You're about to delete ${ids.length} ${ids.length === 1 ? 'stack' : 'stacks'}. You can undo this by shaking your phone right after.`,
      anyMembers
        ? [
            { text: 'Cancel', style: 'cancel' },
            { text: `Delete ${stackWord} Only`, onPress: deleteThenClose(false) },
            {
              text: `Delete ${stackWord} and All ${possessive} Tasks`,
              style: 'destructive',
              onPress: deleteThenClose(true),
            },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: deleteThenClose(false) },
          ],
    );
  };

  const renderStack = ({ item: group }: { item: TaskGroup }) => (
    <StackRow
      group={group}
      roster={rostersByGroupId.get(group.id) ?? []}
      categories={categories}
      colors={colors}
      styles={styles}
      selectionMode={selectionMode}
      selected={selectedIds.has(group.id)}
      onOpen={handleOpenStack}
      onToggleSelect={toggleSelection}
      onSwipeSelect={enterSelectionMode}
    />
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Stacks"
        subtitle={groups.length > 0
          ? `${groups.length} ${groups.length === 1 ? 'stack' : 'stacks'}`
          : undefined}
      />
      <HubPills hub="organize" active="Stacks" />

      {groups.length === 0 && !naming ? (
        <EmptyState
          icon="layers-outline"
          title="No stacks yet"
          subtitle="Group tasks that belong together, like a morning routine or a trip to pack for. Each one keeps its own schedule, but they show up together on Today."
          actionLabel="New stack"
          onAction={startNaming}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <PaintSelectionProvider {...paintProps}>
          <FlatList
            ref={keyboardScroll.ref}
            {...keyboardScroll.props}
            data={groups}
            keyExtractor={g => g.id}
            // A paint gesture owns the touch for its duration — see the note
            // in PaintSelectionProvider on why the list can't scroll out from
            // under it.
            scrollEnabled={!painting}
            // renderStack closes over the selection, and rows are otherwise
            // only keyed on the group id, so the list has to be told what
            // else changed.
            extraData={paintProps}
            renderItem={renderStack}
            contentContainerStyle={[styles.list, selectionMode && { paddingBottom: selectionListPadding }]}
            ListFooterComponent={
              selectionMode
                ? null
                : (
                  <View style={{ paddingBottom: tabBarHeight + FAB_SIZE + spacing.xl }}>
                    {naming && (
                      <InlineNameField
                        placeholder="Stack name"
                        onSubmit={createStack}
                        onCancel={() => setNaming(false)}
                        accessibilityLabel="New stack name"
                      />
                    )}
                  </View>
                )
            }
          />
        </PaintSelectionProvider>
      )}

      {!selectionMode && (
        <Fab
          onPress={startNaming}
          accessibilityLabel="Add stack"
        />
      )}

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={groups.length}
          actions={[
            { key: 'move', icon: 'folder', label: 'Move', tone: 'purple', onPress: () => setCategoryPickerVisible(true) },
            { key: 'delete', icon: 'trash', label: 'Delete', tone: 'destructive', onPress: handleBulkDelete },
          ]}
          onSelectAll={() => selectAll(groups.map(g => g.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      {/* No `value`: the selection can span categories, so there's nothing to
          tick — every row here is a destination. Setting one cascades to the
          selected stacks' rosters too (see bulkSetGroupCategory). */}
      <CategoryPickerSheet
        visible={categoryPickerVisible}
        title="Move to category"
        onSelect={handleBulkSetCategory}
        onClose={() => setCategoryPickerVisible(false)}
      />

      <TaskGroupEditor
        visible={editorVisible}
        group={editingGroup}
        onClose={closeEditor}
      />
    </View>
  );
}

/**
 * Stack list row. Swipe left enters bulk selection, same contract as every
 * other list in the app; the selection dot sits at the trailing edge in place
 * of the chevron.
 */
const StackRow = React.memo(function StackRow({
  group, roster, categories, colors, styles, selectionMode, selected, onOpen, onToggleSelect, onSwipeSelect,
}: {
  group: TaskGroup;
  roster: Task[];
  categories: Category[];
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  selectionMode: boolean;
  selected: boolean;
  // Each takes the stack it acts on rather than the screen closing over it once
  // per row, so one stable function serves every row and the memo holds.
  onOpen: (group: TaskGroup) => void;
  onToggleSelect: (groupId: string) => void;
  onSwipeSelect: (groupId: string) => void;
}) {
  const paintRef = usePaintSelectionRow(group.id);

  // Two different counts, kept labelled: the roster is membership, and
  // today's slice is the work. A member that isn't due today is still a
  // member, so a stack can honestly read "8 tasks · nothing due today".
  const dueToday = roster.filter(isRelevantToGroupToday).length;
  const memberLabel = roster.length === 0
    ? 'No tasks yet'
    : `${roster.length} ${roster.length === 1 ? 'task' : 'tasks'}`;
  const todayLabel = dueToday > 0 ? `${dueToday} due today` : 'Nothing due today';
  const catLabel = group.category ? categoryLabel(group.category, categories) : null;
  const spokenMeta = [memberLabel, todayLabel, catLabel].filter(Boolean).join('. ');
  // Shared by the swipe and the iPhone Mirroring button.
  const swipeSelect = { onSelect: () => onSwipeSelect(group.id), accessibilityLabel: `Select ${group.title}` };

  return (
    <SwipeableRow
      style={styles.card}
      enabled={!selectionMode}
      selectAction={swipeSelect}
    >
      <View ref={paintRef} style={[styles.row, selectionMode && selected && styles.rowSelected]}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => (selectionMode ? onToggleSelect(group.id) : onOpen(group))}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole={selectionMode ? 'checkbox' : 'button'}
          accessibilityState={selectionMode ? { checked: selected } : undefined}
          accessibilityLabel={`${group.title}. ${spokenMeta}`}
          accessibilityHint={selectionMode ? 'Double tap to select stack.' : 'Double tap to edit this stack.'}
        >
          <View style={[styles.icon, { backgroundColor: colors.accentSubtle }]}>
            <Ionicons name="layers-outline" size={18} color={colors.accent} />
          </View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>{group.title}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{memberLabel}</Text>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.metaText}>{todayLabel}</Text>
              {catLabel && (
                <>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={[styles.metaText, styles.metaCategory]} numberOfLines={1}>
                    {catLabel}
                  </Text>
                </>
              )}
            </View>
          </View>
        </TouchableOpacity>
        <SwipeActionButtons enabled={!selectionMode} selectAction={swipeSelect} />
        {selectionMode ? (
          <SelectionDot selected={selected} onPress={() => onToggleSelect(group.id)} />
        ) : (
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        )}
      </View>
    </SwipeableRow>
  );
});

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    paddingTop: spacing.sm,
  },
  // The card's margin and radius live here, on SwipeableRow's own `style`
  // prop, rather than on the row below — see the note on SwipeableRow for why
  // a rounded row leaves its revealed panel square-cornered behind it.
  card: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
  },
  // Same inset-grouped card footprint as TaskItem / the Categories rows,
  // flush so it slides over the swipe panel rather than beside it.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    gap: spacing.md,
  },
  // Opaque, not a translucent tint directly: this can be applied the instant
  // a swipe-select commits, while SwipeableRow's own panel is still open
  // behind this row mid-close-animation — see the note on `flattenOverlay`.
  rowSelected: {
    backgroundColor: flattenOverlay(colors.accent + '1A', colors.bgSecondary),
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  // Only the category can get long enough to need truncating.
  metaCategory: {
    flexShrink: 1,
  },
  metaDot: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
});
