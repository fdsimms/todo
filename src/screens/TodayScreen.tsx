import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
  Animated,
  AppState,
  type GestureResponderEvent,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns';
import type { Task, TaskGroup, SortOption, Priority, Effort } from '../types';
import { formatGroupHeader, formatHHMM } from '../utils/dateUtils';
import { getVisibleAt, isTaskNew } from '../utils/visibilityUtils';
import {
  makeCategoryGroups,
  resolveDrop,
  resolveCategoryReorder,
  categoryHeaderRange,
  flattenLaterSections,
  isLaterHeader,
  laterTaskOrder,
  LATER_TODAY_LABEL,
  type LaterListItem,
} from '../utils/taskGrouping';
import { dragRange } from '../utils/reorder';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useCategoryStore } from '../store/useCategoryStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useShallow } from 'zustand/react/shallow';
import { suggestFocusTasks } from '../services/aiSuggestions';
import { TaskItem } from '../components/TaskItem';
import { TaskGroupHeader } from '../components/TaskGroupHeader';
import { AnimatedCollapsible } from '../components/AnimatedCollapsible';
import { TaskGroupEditor } from '../components/TaskGroupEditor';
import { ReorderableList } from '../components/ReorderableList';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import { SortFilterSheet } from '../components/SortFilterSheet';
import { SpotlightOverlay, useSpotlightElevation } from '../components/SpotlightOverlay';
import { BulkActionBar } from '../components/BulkActionBar';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { NewTasksBanner } from '../components/NewTasksBanner';
import { PressableScale } from '../components/PressableScale';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';

type ViewMode = 'today' | 'later';

// Category section header. When `onToggle` is given, the header is a
// tappable collapse/expand control for its category (chevron reflects
// `collapsed`); otherwise it renders as static text (used for the
// non-category "Later Today" header).
//
// `dimmed` mirrors TaskItem's spotlight scrim: while another task is
// spotlighted, this header needs the same fixed-alpha backdrop drawn over
// it so it visually recedes with the rest of the list instead of sitting
// undimmed above the spotlight overlay (the list itself is elevated above
// that overlay, so headers must dim themselves).
function SectionHeader({
  label,
  styles,
  colors,
  collapsed,
  onToggle,
  onDrag,
  dimmed = false,
}: {
  label: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  collapsed?: boolean;
  onToggle?: () => void;
  onDrag?: () => void;
  dimmed?: boolean;
}) {
  const scrimOpacity = useRef(new Animated.Value(dimmed ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(scrimOpacity, {
      toValue: dimmed ? 1 : 0,
      duration: animation.duration.fast,
      useNativeDriver: true,
    }).start();
  }, [dimmed]);

  const scrim = (
    <Animated.View
      style={[styles.sectionHeaderScrim, { opacity: scrimOpacity, backgroundColor: colors.backdrop }]}
      pointerEvents="none"
    />
  );

  if (!onToggle) {
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{label}</Text>
        {scrim}
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={styles.categorySectionHeader}
      onPress={onToggle}
      onLongPress={onDrag}
      delayLongPress={interaction.delayLongPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
      accessibilityHint={onDrag ? 'Long press to reorder categories' : undefined}
    >
      <View style={styles.categorySectionHeaderLeft}>
        {onDrag && <Ionicons name="reorder-three" size={14} color={colors.textTertiary} />}
        <Text style={styles.sectionHeaderText}>{label}</Text>
      </View>
      <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={13} color={colors.textTertiary} />
      {scrim}
    </TouchableOpacity>
  );
}

// Collapsible reveal for tasks hidden by vacation mode (vacation-paused tasks
// and tasks in categories set to hide on vacation). Defaults to collapsed,
// always shows the hidden count, and renders the tasks inline when expanded.
function VacationHiddenSection({
  tasks,
  expanded,
  onToggle,
  renderHiddenTask,
  styles,
  colors,
}: {
  tasks: Task[];
  expanded: boolean;
  onToggle: () => void;
  renderHiddenTask: (task: Task) => React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  if (tasks.length === 0) return null;
  return (
    <View style={styles.hiddenSection}>
      <TouchableOpacity
        style={styles.hiddenToggle}
        onPress={onToggle}
        activeOpacity={interaction.activeOpacity}
      >
        <Ionicons name="airplane" size={13} color={colors.textTertiary} />
        <Text style={styles.hiddenToggleText}>
          {expanded ? 'Hide' : 'Show'} {tasks.length} hidden on vacation
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
      </TouchableOpacity>
      {expanded && tasks.map(task => (
        <React.Fragment key={task.id}>{renderHiddenTask(task)}</React.Fragment>
      ))}
    </View>
  );
}

// Collapsible reveal for tasks deferred to later today (a time segment or
// window that hasn't opened yet). Mirrors ExpiredSection below: collapsed and
// deemphasized by default, expands in place to show the tasks.
function LaterTodaySection({
  tasks,
  expanded,
  onToggle,
  renderTask,
  styles,
  colors,
}: {
  tasks: Task[];
  expanded: boolean;
  onToggle: () => void;
  renderTask: (task: Task) => React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  if (tasks.length === 0) return null;
  return (
    <View style={styles.hiddenSection}>
      <TouchableOpacity
        style={styles.hiddenToggle}
        onPress={onToggle}
        activeOpacity={interaction.activeOpacity}
      >
        <Ionicons name="time-outline" size={13} color={colors.textTertiary} />
        <Text style={styles.hiddenToggleText}>
          {expanded ? 'Hide' : 'Show'} {tasks.length} later today
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
      </TouchableOpacity>
      {expanded && tasks.map(task => (
        <React.Fragment key={task.id}>{renderTask(task)}</React.Fragment>
      ))}
    </View>
  );
}

// Collapsible reveal for tasks whose time window has closed. Stays put until
// the user deletes it (or, for a recurring task, skips it) — expiring never
// deletes automatically unless the "auto-remove" setting is on.
function ExpiredSection({
  tasks,
  expanded,
  onToggle,
  renderExpiredTask,
  styles,
  colors,
}: {
  tasks: Task[];
  expanded: boolean;
  onToggle: () => void;
  renderExpiredTask: (task: Task) => React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  if (tasks.length === 0) return null;
  return (
    <View style={styles.hiddenSection}>
      <TouchableOpacity
        style={styles.hiddenToggle}
        onPress={onToggle}
        activeOpacity={interaction.activeOpacity}
      >
        <Ionicons name="time-outline" size={13} color={colors.textTertiary} />
        <Text style={styles.hiddenToggleText}>
          {expanded ? 'Hide' : 'Show'} {tasks.length} expired
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
      </TouchableOpacity>
      {expanded && tasks.map(task => (
        <React.Fragment key={task.id}>{renderExpiredTask(task)}</React.Fragment>
      ))}
    </View>
  );
}

export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const inboxCount = useTaskStore(s => s.inboxTasks().length);
  const tabBarHeight = useBottomTabBarHeight();
  const visibleTasks = useTaskStore(useShallow(s => s.visibleTasks()));
  const focusedTasks = useTaskStore(useShallow(s => s.focusedTasks()));
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
  const deferredTasks = useTaskStore(useShallow(s => s.deferredTasks()));
  const expiredTasks = useTaskStore(useShallow(s => s.expiredTasks()));
  const vacationHiddenTasks = useTaskStore(useShallow(s => s.vacationHiddenTasks()));
  const upcomingTodayTasks = useTaskStore(useShallow(s => s.upcomingTodayTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const updateTask = useTaskStore(s => s.updateTask);
  const clearAllFocus = useTaskStore(s => s.clearAllFocus);
  const reorderTasks = useTaskStore(s => s.reorderTasks);
  const reorderWithCategoryUpdates = useTaskStore(s => s.reorderWithCategoryUpdates);
  const reorderCategories = useCategoryStore(s => s.reorderCategories);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const addCategory = useTaskStore(s => s.addCategory);
  const markTasksSeen = useTaskStore(s => s.markTasksSeen);
  const taskGroups = useTaskGroupStore(useShallow(s => s.groups));
  const setGroupCollapsed = useTaskGroupStore(s => s.setGroupCollapsed);
  const completeGroup = useTaskStore(s => s.completeGroup);
  const uncompleteGroup = useTaskStore(s => s.uncompleteGroup);
  const deferGroup = useTaskStore(s => s.deferGroup);
  const focusGroup = useTaskStore(s => s.focusGroup);
  const deleteGroup = useTaskStore(s => s.deleteGroup);
  const groupTasks = useTaskStore(s => s.groupTasks);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [pullingToAdd, setPullingToAdd] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    handleBulkDelete,
  } = useTaskSelection(allTasks);
  const [restExpanded, setRestExpanded] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  // True only while a category header is mid-drag: every category's tasks
  // hide (render-only — see categorySectionKeys below, NOT removed from the
  // underlying list) so the full run of headers is visible without
  // scrolling, without changing what onReorder hands back on drop.
  const [autoCollapseForDrag, setAutoCollapseForDrag] = useState(false);
  const [isSuggestingFocus, setIsSuggestingFocus] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [groupEditorVisible, setGroupEditorVisible] = useState(false);

  // Collapse any expanded task when navigating away from this tab so it
  // isn't still expanded when the user comes back.
  useFocusEffect(
    useCallback(() => {
      return () => setExpandedTaskId(null);
    }, [])
  );

  // visibleTasks()/expiredTasks()/upcomingTodayTasks() etc. are only
  // re-derived when a render happens; a task's visibility can flip purely
  // from time passing (a defer/time-segment threshold crossing, a window
  // expiring), with no store mutation to trigger that render. Tick while
  // focused so the list stays current on its own, matching LaterScreen.
  const [, forceRefresh] = useState(0);
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => forceRefresh(n => n + 1), 30000);
      // Also refresh the instant the app comes back to the foreground
      // (e.g. reopened the next morning), instead of waiting on the tick.
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') forceRefresh(n => n + 1);
      });
      return () => {
        clearInterval(interval);
        subscription.remove();
      };
    }, [])
  );

  const spotlightActive = expandedTaskId !== null && !selectionMode;
  const listElevated = useSpotlightElevation(spotlightActive);

  // Fade the FAB out while a task is spotlighted. The elevated list (zIndex 10)
  // otherwise renders rows on top of the FAB, which looks broken; hiding it
  // also makes it non-interactive in this state, matching the dimmed list.
  const fabOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(fabOpacity, {
      toValue: spotlightActive ? 0 : 1,
      duration: animation.duration.fast,
      useNativeDriver: true,
    }).start();
  }, [spotlightActive, fabOpacity]);

  // The spotlight overlay sits behind the elevated list (zIndex 10), so it
  // never sees taps over the list; the wrapper's onTouchEnd below catches
  // them instead. Raw touch events fire on release regardless of whether the
  // list itself claimed the gesture as a scroll, so without this distance
  // check, scrolling to browse the list (e.g. down to the bottom) would
  // dismiss the spotlight just like an intentional tap outside it.
  const listTouchStart = useRef<{ x: number; y: number } | null>(null);
  const handleListTouchStart = (e: GestureResponderEvent) => {
    const touch = e.nativeEvent.touches[0];
    listTouchStart.current = touch ? { x: touch.pageX, y: touch.pageY } : null;
  };
  const handleListTouchEnd = (e: GestureResponderEvent) => {
    const start = listTouchStart.current;
    const touch = e.nativeEvent.changedTouches[0];
    const moved = start && touch ? Math.hypot(touch.pageX - start.x, touch.pageY - start.y) : 0;
    if (moved < interaction.tapMoveThreshold) setExpandedTaskId(null);
  };

  // Focusing a task immediately reshuffles the list into Focus/Rest sections,
  // which moves everything under the finger and makes it hard to tap the
  // star on more than one task in a row. Give the user a brief grace period
  // after each focus toggle to keep tapping stars in the normal layout
  // before the view snaps into focus mode.
  const FOCUS_VIEW_GRACE_MS = 1500;
  const [focusViewGraceActive, setFocusViewGraceActive] = useState(false);
  const focusViewGraceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFocusedCount = useRef(focusedTasks.length);

  useEffect(() => {
    const grew = focusedTasks.length > prevFocusedCount.current;
    prevFocusedCount.current = focusedTasks.length;

    if (focusedTasks.length === 0) {
      if (focusViewGraceTimer.current) clearTimeout(focusViewGraceTimer.current);
      focusViewGraceTimer.current = null;
      setFocusViewGraceActive(false);
      return;
    }

    if (grew) {
      if (focusViewGraceTimer.current) clearTimeout(focusViewGraceTimer.current);
      setFocusViewGraceActive(true);
      focusViewGraceTimer.current = setTimeout(() => {
        focusViewGraceTimer.current = null;
        setFocusViewGraceActive(false);
      }, FOCUS_VIEW_GRACE_MS);
    }
  }, [focusedTasks.length]);

  useEffect(() => {
    return () => {
      if (focusViewGraceTimer.current) clearTimeout(focusViewGraceTimer.current);
    };
  }, []);

  const handleSuggestFocus = async () => {
    setIsSuggestingFocus(true);
    try {
      const ids = await suggestFocusTasks(visibleTasks, focusedTasks.length, completedTasks);
      for (const id of ids) updateTask(id, { focused: true });
    } catch (e) {
      Alert.alert('Could not suggest focus', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsSuggestingFocus(false);
    }
  };

  const toggleCategoryCollapse = (label: string) => {
    if (expandedTaskId !== null) {
      setExpandedTaskId(null);
      return;
    }
    haptics.tap();
    animateLayout();
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  // Sort & filter state
  const [sort, setSort] = useState<SortOption>('default');
  const [filterPriorities, setFilterPriorities] = useState<Priority[]>([]);
  const [filterEfforts, setFilterEfforts] = useState<Effort[]>([]);

  const activeFilterCount =
    (sort !== 'default' ? 1 : 0) + filterPriorities.length + filterEfforts.length;

  // Today stays current on its own (see the tick effect above), so pulling
  // down no longer refreshes anything — it opens quick add instead, which
  // is otherwise a reach to the FAB.
  const handlePullToAdd = useCallback(() => {
    setPullingToAdd(true);
    haptics.impactLight();
    setQuickAddVisible(true);
    setPullingToAdd(false);
  }, []);

  const openEditor = (task?: Task) => {
    setEditingTask(task ?? null);
    setEditorInitialDraft(null);
    setEditorVisible(true);
  };

  const handleQuickAddOpenFull = (draft: TaskDraft) => {
    setQuickAddVisible(false);
    setEditingTask(null);
    setEditorInitialDraft(draft);
    setEditorVisible(true);
  };

  const filtered = useMemo(() => {
    let result = visibleTasks;
    if (filterPriorities.length > 0) result = result.filter(t => filterPriorities.includes(t.priority));
    if (filterEfforts.length > 0) result = result.filter(t => filterEfforts.includes(t.effort));
    switch (sort) {
      case 'priority': return [...result].sort((a, b) => b.priority - a.priority);
      case 'effort-asc': return [...result].sort((a, b) => (a.effort || 99) - (b.effort || 99));
      case 'effort-desc': return [...result].sort((a, b) => b.effort - a.effort);
      case 'due-date': return [...result].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });
      case 'streak': return [...result].sort((a, b) => b.streakCount - a.streakCount);
      default: return result;
    }
  }, [visibleTasks, sort, filterPriorities, filterEfforts]);

  type ListItem =
    | { type: 'focus-header' }
    | { type: 'rest-header' }
    | { type: 'header'; label: string }
    | { type: 'task'; task: Task }
    | { type: 'group'; group: TaskGroup; children: Task[] };

  const upcomingTaskIds = useMemo(
    () => new Set(upcomingTodayTasks.map(t => t.id)),
    [upcomingTodayTasks],
  );

  // Every task currently assigned to a group, regardless of its own
  // visibility — TaskGroupHeader needs the full roster (not just what's
  // visible right now) to compute its "N/M done today" tally.
  const childrenByGroupId = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.groupId) continue;
      const list = map.get(t.groupId);
      if (list) list.push(t);
      else map.set(t.groupId, [t]);
    }
    return map;
  }, [allTasks]);

  // Groups with at least one currently-visible child, each paired with just
  // that visible-and-filtered subset — a group with nothing due today simply
  // doesn't render, same as an empty category would. Only the default
  // (non-focus) Today view groups/collapses; Focus mode and the "Everything
  // else" reveal intentionally stay flat so focusing a task always pulls it
  // out for individual attention.
  const visibleGroupItems = useMemo(() => {
    const filteredIds = new Set(filtered.map(t => t.id));
    return taskGroups
      .map(group => ({
        group,
        children: (childrenByGroupId.get(group.id) ?? []).filter(t => filteredIds.has(t.id)),
      }))
      .filter(g => g.children.length > 0);
  }, [taskGroups, childrenByGroupId, filtered]);

  // Hide task/group rows under a collapsed category header, leaving the
  // header itself in place so it stays tappable to re-expand. The "Later
  // Today" header is a time section, not a category, so it's never
  // collapsible.
  const applyCategoryCollapse = (items: ListItem[]): ListItem[] => {
    if (collapsedCategories.size === 0) return items;
    let currentCategory: string | null = null;
    return items.filter(item => {
      if (item.type === 'header') {
        currentCategory = item.label === LATER_TODAY_LABEL ? null : item.label;
        return true;
      }
      if (
        (item.type === 'task' || item.type === 'group') &&
        currentCategory !== null &&
        collapsedCategories.has(currentCategory)
      ) {
        return false;
      }
      return true;
    });
  };

  const data: ListItem[] = useMemo(() => {
    if (focusedTasks.length > 0 && !focusViewGraceActive) {
      const items: ListItem[] = [{ type: 'focus-header' }];
      focusedTasks.forEach(task => items.push({ type: 'task', task }));
      const restTasks = filtered.filter(t => !t.focused);
      if (restTasks.length > 0) {
        items.push({ type: 'rest-header' });
        if (restExpanded) items.push(...makeCategoryGroups(restTasks, allCategories));
      }
      return applyCategoryCollapse(items);
    }

    const ungrouped = filtered.filter(t => !t.groupId);
    const items = makeCategoryGroups(ungrouped, allCategories, visibleGroupItems);
    return applyCategoryCollapse(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, focusedTasks, focusViewGraceActive, restExpanded, allCategories, collapsedCategories, visibleGroupItems]);

  const listItemKey = (item: ListItem): string =>
    item.type === 'focus-header' ? '__focus-header__'
    : item.type === 'rest-header' ? '__rest-header__'
    : item.type === 'header' ? `h-${item.label}`
    : item.type === 'group' ? `g-${item.group.id}`
    : item.task.id;

  // Keys of task/group rows that sit under a real category header (i.e. not
  // the header-less loose group at top, and not "Later Today", which is a
  // time section rather than a category). Used by autoCollapseForDrag to
  // decide what to hide while a category header is being dragged — computed
  // the same way applyCategoryCollapse walks the list, but as a lookup
  // rather than a filter so the underlying data array (and what onReorder
  // hands back) never changes shape.
  const categorySectionKeys = useMemo(() => {
    const keys = new Set<string>();
    let currentCategory: string | null = null;
    for (const item of data) {
      if (item.type === 'header') {
        currentCategory = item.label === LATER_TODAY_LABEL ? null : item.label;
        continue;
      }
      if ((item.type === 'task' || item.type === 'group') && currentCategory !== null) {
        keys.add(listItemKey(item));
      }
    }
    return keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Local copy of data fed to ReorderableList. onReorder writes the settled
  // grouped layout here immediately so the list doesn't flash back to the
  // pre-drag order while the store write propagates; the render-time sync
  // below then reconciles to the store-derived `data` as soon as it changes.
  //
  // Both values are produced by makeCategoryGroups over the same tasks in the
  // same order, so they're structurally identical — the reconcile moves no
  // cells (no stranded drop), but it is essential: it hands the drag library a
  // fresh canonical array once the store catches up, so the library can't get
  // stuck showing its own internal drag order (e.g. a task left resting above
  // a header).
  //
  // Synced during render (comparing against a ref) rather than in a
  // useEffect, so a `data` change — including the very first store load —
  // reaches the list in the same render as everything else on screen, instead
  // of landing a frame late and popping in after the rest of the UI.
  const [draggableData, setDraggableData] = useState<ListItem[]>(data);
  const syncedDataRef = useRef(data);
  if (syncedDataRef.current !== data) {
    syncedDataRef.current = data;
    setDraggableData(data);
  }

  // Set right before a category header's drag() starts, and cleared right
  // before any other drag starts, so onReorder below can tell whether the
  // in-flight drag is reordering categories rather than moving a task.
  // Left stale after a cancelled (no-op) header drag is harmless: it's only
  // read once inside onReorder, by which point the next drag has already set
  // it correctly for whatever it actually is.
  const draggingCategoryRef = useRef<string | null>(null);
  const startCategoryDrag = (label: string, drag: () => void) => {
    draggingCategoryRef.current = label;
    haptics.tap();
    animateLayout();
    setAutoCollapseForDrag(true);
    drag();
  };

  // A fast drag can cross several rows between frames; spacing the selection
  // ticks out keeps them from piling up into one long buzz.
  const lastDragHapticRef = useRef(0);
  const dragHaptic = () => {
    const now = Date.now();
    if (now - lastDragHapticRef.current < 80) return;
    lastDragHapticRef.current = now;
    haptics.tap();
  };

  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.parentId) continue;
      const list = map.get(t.parentId);
      if (list) list.push(t);
      else map.set(t.parentId, [t]);
    }
    return map;
  }, [allTasks]);

  // Shared by the plain 'task' row case and a group's expanded children —
  // group children are full TaskItem rows with every normal capability
  // (checkbox, swipe actions, timer, expand-for-notes, individual skip), just
  // never draggable (no `drag` passed when rendered inside a group), so
  // ReorderableList itself needs no changes to support them.
  const renderTaskRow = (task: Task, opts?: { drag?: () => void; isActive?: boolean; indented?: boolean }) => {
    const subs = subtasksByParent.get(task.id) ?? [];
    return (
      <TaskItem
        task={task}
        indented={opts?.indented}
        onPress={() => {
          if (expandedTaskId !== null && expandedTaskId !== task.id) {
            setExpandedTaskId(null);
            return;
          }
          setExpandedTaskId(prev => prev === task.id ? null : task.id);
        }}
        expanded={expandedTaskId === task.id}
        spotlightDisabled={expandedTaskId !== null && expandedTaskId !== task.id && !selectionMode}
        onEdit={() => openEditor(task)}
        subtaskCount={subs.length}
        subtaskDoneCount={subs.filter(t => t.completed).length}
        subtasks={subs}
        drag={
          selectionMode || !opts?.drag || upcomingTaskIds.has(task.id)
            ? undefined
            : () => { draggingCategoryRef.current = null; opts.drag!(); }
        }
        isActive={opts?.isActive}
        selectionMode={selectionMode}
        selected={selectedIds.has(task.id)}
        onSelect={() => toggleSelection(task.id)}
        onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(task.id); }}
        hideTodayLabel
      />
    );
  };

  const renderItem = ({ item, drag, isActive }: { item: ListItem; drag?: () => void; isActive?: boolean }) => {
    // While a category drag is auto-collapsing every section (see
    // startCategoryDrag), hide task/group rows that sit under a real
    // category header — the same rows collapsedCategories would remove, but
    // render-only here so the underlying list (and onReorder's result) is
    // untouched.
    if (
      autoCollapseForDrag &&
      (item.type === 'task' || item.type === 'group') &&
      categorySectionKeys.has(listItemKey(item))
    ) {
      return null;
    }
    // Headers sit in the same elevated list as task rows, above the spotlight
    // overlay, so each one draws its own scrim to dim in step with the rows.
    const headerDimmed = expandedTaskId !== null && !selectionMode;
    if (item.type === 'focus-header') {
      return (
        <Pressable style={styles.focusSectionHeader} onPress={() => setExpandedTaskId(null)}>
          <View style={styles.focusSectionTitleRow}>
            <Ionicons name="star" size={13} color={colors.orange} />
            <Text style={styles.focusSectionTitle}>Focus</Text>
          </View>
          <TouchableOpacity onPress={clearAllFocus} hitSlop={8}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
          {headerDimmed && (
            <View style={[styles.sectionHeaderScrim, { backgroundColor: colors.backdrop }]} pointerEvents="none" />
          )}
        </Pressable>
      );
    }
    if (item.type === 'rest-header') {
      return (
        <TouchableOpacity
          style={styles.restSectionHeader}
          onPress={() => {
            if (expandedTaskId !== null) {
              setExpandedTaskId(null);
              return;
            }
            haptics.tap();
            animateLayout();
            setRestExpanded(e => !e);
          }}
          activeOpacity={interaction.activeOpacity}
        >
          <Text style={styles.sectionHeaderText}>Everything else</Text>
          <Ionicons name={restExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
          {headerDimmed && (
            <View style={[styles.sectionHeaderScrim, { backgroundColor: colors.backdrop }]} pointerEvents="none" />
          )}
        </TouchableOpacity>
      );
    }
    if (item.type === 'header') {
      // (Tapping it while a task is expanded still collapses the spotlight,
      // via the list wrapper's onTouchEnd.)
      const isCategory = item.label !== LATER_TODAY_LABEL;
      return (
        <SectionHeader
          label={item.label}
          styles={styles}
          colors={colors}
          collapsed={isCategory ? (autoCollapseForDrag || collapsedCategories.has(item.label)) : undefined}
          onToggle={isCategory ? () => toggleCategoryCollapse(item.label) : undefined}
          onDrag={isCategory && drag && !selectionMode ? () => startCategoryDrag(item.label, drag) : undefined}
          dimmed={headerDimmed}
        />
      );
    }
    if (item.type === 'group') {
      const allChildren = childrenByGroupId.get(item.group.id) ?? [];
      return (
        <View>
          <TaskGroupHeader
            group={item.group}
            allChildren={allChildren}
            onToggleCollapse={() => {
              if (expandedTaskId !== null) { setExpandedTaskId(null); return; }
              haptics.tap();
              animateLayout();
              setGroupCollapsed(item.group.id, !item.group.collapsed);
            }}
            onComplete={() => completeGroup(item.group.id)}
            onUncomplete={() => uncompleteGroup(item.group.id)}
            onDefer={date => deferGroup(item.group.id, date)}
            onFocus={() => focusGroup(item.group.id)}
            onDeleteGroupOnly={() => deleteGroup(item.group.id, { cascade: false })}
            onDeleteWithTasks={() => deleteGroup(item.group.id, { cascade: true })}
            onPressEdit={() => { setEditingGroup(item.group); setGroupEditorVisible(true); }}
            dimmed={headerDimmed}
          />
          <AnimatedCollapsible expanded={!item.group.collapsed}>
            {item.children.map(child => (
              <React.Fragment key={child.id}>{renderTaskRow(child, { indented: true })}</React.Fragment>
            ))}
          </AnimatedCollapsible>
        </View>
      );
    }

    return renderTaskRow(item.task, { drag, isActive });
  };

  // Revealed vacation-hidden tasks are peek-only: no drag, but they can still
  // be swiped into selection like any other row so they don't lose delete
  // capability now that per-row swipe-delete is gone.
  const renderHiddenTask = (task: Task) => {
    const subs = subtasksByParent.get(task.id) ?? [];
    return (
      <TaskItem
        task={task}
        onPress={() => {
          if (expandedTaskId !== null && expandedTaskId !== task.id) {
            setExpandedTaskId(null);
            return;
          }
          setExpandedTaskId(prev => prev === task.id ? null : task.id);
        }}
        expanded={expandedTaskId === task.id}
        spotlightDisabled={expandedTaskId !== null && expandedTaskId !== task.id && !selectionMode}
        onEdit={() => openEditor(task)}
        subtaskCount={subs.length}
        subtaskDoneCount={subs.filter(t => t.completed).length}
        subtasks={subs}
        selectionMode={selectionMode}
        selected={selectedIds.has(task.id)}
        onSelect={() => toggleSelection(task.id)}
        onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(task.id); }}
        hideTodayLabel
      />
    );
  };

  // Footer shared by every list variant: the vacation-hidden reveal (when any)
  // followed by the tap-to-dismiss spacer. `fixedWhenEmpty` keeps the empty
  // state centered by stopping the spacer from growing.
  const listFooter = (fixedWhenEmpty = false) => (
    <>
      {viewMode === 'today' && focusedTasks.length === 0 && (
        <LaterTodaySection
          tasks={upcomingTodayTasks}
          expanded={showUpcoming}
          onToggle={() => {
            haptics.tap();
            animateLayout();
            setExpandedTaskId(null);
            setShowUpcoming(v => !v);
          }}
          renderTask={renderHiddenTask}
          styles={styles}
          colors={colors}
        />
      )}
      {viewMode === 'today' && (
        <ExpiredSection
          tasks={expiredTasks}
          expanded={showExpired}
          onToggle={() => {
            haptics.tap();
            animateLayout();
            setExpandedTaskId(null);
            setShowExpired(v => !v);
          }}
          renderExpiredTask={renderHiddenTask}
          styles={styles}
          colors={colors}
        />
      )}
      <VacationHiddenSection
        tasks={vacationHiddenTasks}
        expanded={showHidden}
        onToggle={() => {
          haptics.tap();
          animateLayout();
          setExpandedTaskId(null);
          setShowHidden(v => !v);
        }}
        renderHiddenTask={renderHiddenTask}
        styles={styles}
        colors={colors}
      />
      <TouchableOpacity
        style={[styles.listFooter, fixedWhenEmpty && styles.listFooterFixed]}
        activeOpacity={1}
        onPress={() => setExpandedTaskId(null)}
      />
    </>
  );

  const emptyComponent = (
    <EmptyState
      icon="checkmark-circle"
      title="All clear"
      subtitle={activeFilterCount > 0 ? 'No tasks match these filters' : 'Nothing to do right now'}
      bottomOffset={tabBarHeight}
    />
  );

  const newTaskIds = useMemo(
    () => visibleTasks.filter(isTaskNew).map(t => t.id),
    [visibleTasks]
  );
  const dismissNewTasksBanner = () => {
    animateLayout();
    markTasksSeen(newTaskIds);
  };

  const today = format(new Date(), 'EEEE, MMMM d');

  const SEG_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

  const laterGroupKeys = (task: Task): string[] => {
    const visibleAt = getVisibleAt(task);
    const dayLabel = formatGroupHeader(visibleAt.toISOString());
    if (task.timeSegments.length > 0) {
      return task.timeSegments.map(seg => `${dayLabel} — ${SEG_LABELS[seg]}`);
    }
    if (task.windowStart) {
      const windowLabel = task.windowEnd
        ? `${formatHHMM(task.windowStart)}–${formatHHMM(task.windowEnd)}`
        : formatHHMM(task.windowStart);
      return [`${dayLabel} — ${windowLabel}`];
    }
    return [dayLabel];
  };

  const laterSections = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    [...deferredTasks]
      .sort((a, b) => getVisibleAt(a).getTime() - getVisibleAt(b).getTime())
      .forEach(task => {
        for (const key of laterGroupKeys(task)) {
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(task);
        }
      });
    return Array.from(grouped.entries()).map(([title, data]) => ({ title, data }));
  }, [deferredTasks]);

  const laterData = useMemo(() => flattenLaterSections(laterSections), [laterSections]);
  const [laterDraggableData, setLaterDraggableData] = useState<LaterListItem[]>(laterData);
  useEffect(() => {
    setLaterDraggableData(laterData);
  }, [laterData]);

  const headerActions: ScreenHeaderAction[] = [
    ...(viewMode === 'today'
      ? [{
          icon: 'options' as const,
          onPress: () => setFilterVisible(true),
          active: activeFilterCount > 0,
          badge: activeFilterCount,
          accessibilityLabel: 'Sort and filter',
        }]
      : []),
    ...(viewMode === 'today' && focusedTasks.length < 3 && visibleTasks.length > 0
      ? [{
          icon: 'sparkles' as const,
          onPress: handleSuggestFocus,
          active: focusedTasks.length === 0,
          tint: 'orange' as const,
          disabled: isSuggestingFocus,
          loading: isSuggestingFocus,
          accessibilityLabel: 'Suggest focus tasks',
        }]
      : []),
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title={viewMode === 'today' ? 'Today' : 'Later'}
        overline={viewMode === 'today' ? today : undefined}
        actions={headerActions}
      />

      {/* View mode switcher */}
      <View style={styles.viewModePills}>
        {(['today', 'later'] as ViewMode[]).map(mode => (
          <TouchableOpacity
            key={mode}
            style={[styles.viewModePill, viewMode === mode && styles.viewModePillActive]}
            onPress={() => {
              haptics.tap();
              setViewMode(mode);
              setExpandedTaskId(null);
              if (selectionMode) exitSelection();
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="tab"
            accessibilityState={{ selected: viewMode === mode }}
            accessibilityLabel={`${mode.charAt(0).toUpperCase() + mode.slice(1)} view`}
          >
            <Text style={[styles.viewModePillText, viewMode === mode && styles.viewModePillTextActive]}>
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.viewModePill}
          onPress={() => {
            haptics.tap();
            navigation.navigate('Inbox' as never);
          }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={inboxCount > 0 ? `Inbox, ${inboxCount} to sort` : 'Inbox'}
        >
          <Text style={styles.viewModePillText}>Inbox</Text>
          {inboxCount > 0 && (
            <View style={styles.viewModePillBadge}>
              <Text style={styles.viewModePillBadgeText}>{inboxCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {viewMode === 'today' && newTaskIds.length > 0 && (
        <NewTasksBanner count={newTaskIds.length} onDismiss={dismissNewTasksBanner} />
      )}

      <SpotlightOverlay
        visible={spotlightActive}
        onPress={() => setExpandedTaskId(null)}
      />

      <View
        style={[styles.listWrapper, listElevated && styles.listWrapperElevated]}
        // The list sits above the spotlight overlay, so the overlay can't see
        // taps here — catch any touch in the list area instead. The expanded
        // card stops propagation so its own controls keep working.
        onTouchStart={spotlightActive ? handleListTouchStart : undefined}
        onTouchEnd={spotlightActive ? handleListTouchEnd : undefined}
      >
      {viewMode === 'later' && (
        <ReorderableList
          data={laterDraggableData}
          keyExtractor={item => item.key}
          renderItem={({ item, drag, isActive }) => {
            if (item.type === 'header') {
              return (
                <Pressable style={styles.sectionHeader} onPress={() => setExpandedTaskId(null)}>
                  <Text style={styles.sectionHeaderText}>{item.label}</Text>
                  {expandedTaskId !== null && !selectionMode && (
                    <View style={[styles.sectionHeaderScrim, { backgroundColor: colors.backdrop }]} pointerEvents="none" />
                  )}
                </Pressable>
              );
            }
            const subs = subtasksByParent.get(item.task.id) ?? [];
            return (
              <TaskItem
                task={item.task}
                onPress={() => {
                  if (expandedTaskId !== null && expandedTaskId !== item.task.id) {
                    setExpandedTaskId(null);
                    return;
                  }
                  setExpandedTaskId(prev => prev === item.task.id ? null : item.task.id);
                }}
                expanded={expandedTaskId === item.task.id}
                spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.task.id && !selectionMode}
                onEdit={() => openEditor(item.task)}
                subtaskCount={subs.length}
                subtaskDoneCount={subs.filter(t => t.completed).length}
                subtasks={subs}
                drag={selectionMode || !drag ? undefined : drag}
                isActive={isActive}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.task.id)}
                onSelect={() => toggleSelection(item.task.id)}
                onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(item.task.id); }}
                hideTodayLabel
                showCategory
                showActions={false}
              />
            );
          }}
          onDragBegin={() => setExpandedTaskId(null)}
          onHoverChange={dragHaptic}
          dragRange={(data, idx) => dragRange(data, idx, isLaterHeader)}
          placeholderStyle={styles.dropSlot}
          onReorder={reordered => {
            setLaterDraggableData(reordered);
            reorderTasks(laterTaskOrder(reordered));
          }}
          contentContainerStyle={laterSections.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="moon"
              title="Nothing deferred"
              subtitle="Swipe left on a task to defer it"
              bottomOffset={tabBarHeight}
            />
          }
          ListFooterComponent={listFooter(laterSections.length === 0)}
        />
      )}

      {viewMode === 'today' && focusedTasks.length > 0 && (
        <FlatList
          data={data}
          keyExtractor={listItemKey}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => renderItem({ item })}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={pullingToAdd}
              onRefresh={handlePullToAdd}
              tintColor={colors.textSecondary}
            />
          }
          ListFooterComponent={listFooter()}
          ListFooterComponentStyle={styles.listFooterCell}
        />
      )}

      {viewMode === 'today' && focusedTasks.length === 0 && (
        <ReorderableList
          data={draggableData}
          keyExtractor={listItemKey}
          renderItem={renderItem}
          onDragBegin={() => {
            setExpandedTaskId(null);
          }}
          onDragEnd={() => {
            if (!autoCollapseForDrag) return;
            // Deferred a tick so this LayoutAnimation lands in its own
            // commit, after ReorderableList's own drop-settle render (rows
            // snapping from their transform back to plain layout) — firing
            // it in the same commit as that snap fights it (see
            // layoutAnimation.ts).
            setTimeout(() => {
              animateLayout();
              setAutoCollapseForDrag(false);
            }, 0);
          }}
          onHoverChange={dragHaptic}
          dragRange={(rangeData, activeIndex) => {
            const activeItem = rangeData[activeIndex];
            if (activeItem?.type === 'header' && activeItem.label !== LATER_TODAY_LABEL) {
              const range = categoryHeaderRange(rangeData);
              if (range) return range;
            }
            return [0, rangeData.length - 1];
          }}
          placeholderStyle={styles.dropSlot}
          onReorder={reordered => {
            // The draggable list only ever contains header + task items.
            const dropped = reordered.filter(
              (item): item is { type: 'header'; label: string } | { type: 'task'; task: Task } =>
                item.type === 'header' || item.type === 'task',
            );

            if (draggingCategoryRef.current !== null) {
              draggingCategoryRef.current = null;
              const { categoryOrder, settled } = resolveCategoryReorder(dropped, {
                isUpcoming: id => upcomingTaskIds.has(id),
                showUpcoming,
                fullCategoryOrder: allCategories,
              });
              setDraggableData(settled);
              reorderCategories(categoryOrder);
              return;
            }

            const { taskIds, categoryUpdates, settled } = resolveDrop(dropped, {
              isUpcoming: id => upcomingTaskIds.has(id),
              showUpcoming,
              categoryOrder: allCategories,
            });

            const commitDrop = (scope?: 'occurrence' | 'series') => {
              // Show the final grouped layout immediately to avoid a flash; the
              // effect then reconciles to the store-derived `data` (structurally
              // identical) once the store write lands.
              setDraggableData(settled);
              reorderWithCategoryUpdates(taskIds, categoryUpdates, scope ? { scope } : undefined);
            };

            // Dragging a recurring task into a new category is a content-field
            // edit like any other (category is a CONTENT_FIELD) and needs the
            // same "just this task or this and future occurrences" choice as
            // editing it through the editor. Leaving draggableData untouched on
            // Cancel lets the list settle back to its pre-drag order.
            const recategorizedRecurring = categoryUpdates.some(u => {
              const task = allTasks.find(t => t.id === u.id);
              return task && task.recurrenceType !== 'none';
            });
            if (recategorizedRecurring) {
              Alert.alert(
                'Update recurring task',
                'This task repeats. Apply this category change to just this task, or to this and all future occurrences?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'This Task', onPress: () => commitDrop('occurrence') },
                  { text: 'This and Future Tasks', onPress: () => commitDrop('series') },
                ],
              );
              return;
            }

            commitDrop();
          }}
          contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={pullingToAdd}
              onRefresh={handlePullToAdd}
              tintColor={colors.textSecondary}
            />
          }
          ListEmptyComponent={emptyComponent}
          ListFooterComponent={
            // Direct child of the scroll content (no cell wrapper), so the
            // spacer's own flexGrow stretches it; pinned when empty so the
            // empty state stays centered.
            listFooter(filtered.length === 0)
          }
        />
      )}
      </View>

      {viewMode === 'today' && (
        <Animated.View
          style={[styles.fabContainer, { bottom: insets.bottom + 64, opacity: fabOpacity }]}
          pointerEvents={spotlightActive ? 'none' : 'box-none'}
        >
          <PressableScale
            style={styles.fab}
            pressScale={0.9}
            onPress={() => {
              haptics.impactLight();
              setQuickAddVisible(true);
            }}
            accessibilityLabel="Add task"
          >
            <Ionicons name="add" size={28} color={colors.onAccent} />
          </PressableScale>
        </Animated.View>
      )}

      <QuickAddModal
        visible={quickAddVisible}
        onClose={() => setQuickAddVisible(false)}
        onOpenFull={handleQuickAddOpenFull}
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        initialDraft={editorInitialDraft}
        onClose={() => {
          setEditorVisible(false);
          setExpandedTaskId(null);
        }}
      />

      <SortFilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        sort={sort}
        onSortChange={setSort}
        priorities={filterPriorities}
        onPrioritiesChange={setFilterPriorities}
        efforts={filterEfforts}
        onEffortsChange={setFilterEfforts}
      />

      <TaskGroupEditor
        visible={groupEditorVisible}
        group={editingGroup}
        onClose={() => { setGroupEditorVisible(false); setEditingGroup(null); }}
      />

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalCount={viewMode === 'later' ? deferredTasks.length : filtered.length}
          existingTags={allTags}
          existingCategories={allCategories}
          onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDelete={handleBulkDelete}
          onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
          onSetCategory={category => { bulkSetCategory(Array.from(selectedIds), category); exitSelection(); }}
          onAddCategory={addCategory}
          onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
          onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
          onGroup={title => {
            const ids = Array.from(selectedIds);
            const selectedCategories = new Set(
              ids.map(id => allTasks.find(t => t.id === id)?.category ?? null)
            );
            const category = selectedCategories.size === 1 ? [...selectedCategories][0] : null;
            groupTasks(ids, title, category);
            exitSelection();
          }}
          onSelectAll={() => selectAll(
            viewMode === 'later' ? deferredTasks.map(t => t.id) : filtered.map(t => t.id)
          )}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  clearBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgSecondary,
  },
  clearText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.accent,
  },
  selectText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
  viewModePills: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: 4,
  },
  viewModePill: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: colors.bgSecondary,
  },
  viewModePillActive: { backgroundColor: colors.accent },
  viewModePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  viewModePillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  viewModePillBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
    backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center',
  },
  viewModePillBadgeText: { color: colors.onAccent, fontSize: 9, fontWeight: fontWeight.bold },
  sectionHeader: {
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderText: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  categorySectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  categorySectionHeaderLeft: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  sectionHeaderScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  },
  focusSectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  focusSectionTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  focusSectionTitle: {
    color: colors.orange, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  restSectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  emptyContainer: { flexGrow: 1 },
  listContent: { paddingTop: spacing.sm, paddingBottom: 20, flexGrow: 1 },
  hiddenSection: { paddingTop: spacing.sm },
  hiddenToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.md,
  },
  hiddenToggleText: {
    color: colors.textTertiary, fontSize: font.sm, fontWeight: fontWeight.medium,
  },
  // Subtle slot marking where a dragged task will land; mirrors the task
  // card's footprint (margin + radius).
  dropSlot: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
  listFooterFixed: { flexGrow: 0 },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
  // Sits above the spotlight-elevated list (zIndex 10) so the FAB is never
  // covered by rows; while a task is spotlighted it's faded out and
  // pointerEvents-disabled by the screen.
  fabContainer: {
    position: 'absolute', right: spacing.lg,
    zIndex: 20,
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 8,
  },
  filterBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 2, gap: spacing.sm,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  filterChipActive: { backgroundColor: colors.accent },
  filterDot: { width: 6, height: 6, borderRadius: radius.full },
  filterChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  filterChipTextActive: { color: colors.text, fontWeight: fontWeight.semibold, letterSpacing: 0.1 },
});
