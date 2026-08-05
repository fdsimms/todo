import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
  AppState,
  type GestureResponderEvent,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns';
import type { Task, TaskGroup, SortOption, Priority, Effort, RecurrenceType } from '../types';
import { formatGroupHeader, formatHHMM } from '../utils/dateUtils';
import { getVisibleAt, isTaskNew, isRelevantToGroupToday, isGroupHiddenToday, isTaskVisible, isUnscheduledTask, isInboxTask } from '../utils/visibilityUtils';
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
  type CategoryListItem,
} from '../utils/taskGrouping';
import { dragRange } from '../utils/reorder';
import { useTaskStore } from '../store/useTaskStore';
import { useWidgetCompletionStore } from '../store/useWidgetCompletionStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useShallow } from 'zustand/react/shallow';
import { suggestPinTasks } from '../services/aiSuggestions';
import { TaskItem } from '../components/TaskItem';
import { TaskGroupHeader } from '../components/TaskGroupHeader';
import { AnimatedCollapsible } from '../components/AnimatedCollapsible';
import { TaskGroupEditor } from '../components/TaskGroupEditor';
import { ReorderableList } from '../components/ReorderableList';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { GroupDropTarget } from '../components/GroupDropTarget';
import { SortableList } from '../components/SortableList';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import { SortFilterSheet } from '../components/SortFilterSheet';
import { TodayOptionsMenu } from '../components/TodayOptionsMenu';
import {
  SpotlightOverlay,
  SpotlightProvider,
  SpotlightScrim,
  useSpotlightElevation,
  useSpotlightProgress,
} from '../components/SpotlightOverlay';
import { BulkActionBar } from '../components/BulkActionBar';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { NewTasksBanner } from '../components/NewTasksBanner';
import { PressableScale } from '../components/PressableScale';
import { AddTaskFab, type AddTaskType } from '../components/AddTaskFab';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';

// The four lenses of the pill switcher. They're disjoint by construction —
// isUnscheduledTask() excludes inbox tasks, and isTaskVisible() excludes both —
// so every uncompleted task shows in exactly one of them. All four are sub-views
// of this screen rather than routes: the switcher is a segmented control, and a
// segmented control that navigates would flash the previous view's content for a
// frame on every tap.
type ViewMode = 'today' | 'later' | 'unscheduled' | 'inbox';

const VIEW_MODES: ViewMode[] = ['today', 'later', 'unscheduled', 'inbox'];

const VIEW_TITLES: Record<ViewMode, string> = {
  today: 'Today',
  later: 'Later',
  unscheduled: 'Unscheduled',
  inbox: 'Inbox',
};

// Shared with the Later screen's own day/segment grouping (see laterGroupKeys
// below) so "later today" sub-headers read the same way in both places.
const SEGMENT_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
const SEGMENT_ORDER = ['morning', 'afternoon', 'evening', 'night'] as const;

// Category section header. When `onToggle` is given, the header is a
// tappable collapse/expand control for its category (chevron reflects
// `collapsed`); otherwise it renders as static text (used for the
// non-category "Later Today" header).
//
// The SpotlightScrim mirrors TaskItem's: while a task is spotlighted, this
// header needs the same backdrop drawn over it so it recedes with the rest of
// the list instead of sitting bright above the spotlight overlay (the list is
// elevated above that overlay, so headers must dim themselves).
function SectionHeader({
  label,
  styles,
  colors,
  collapsed,
  onToggle,
  onDrag,
}: {
  label: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  collapsed?: boolean;
  onToggle?: () => void;
  onDrag?: () => void;
}) {
  const scrim = <SpotlightScrim />;

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
        <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={13} color={colors.textTertiary} />
      </View>
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

export type LaterTodaySectionData = {
  key: string;
  // null for tasks with no time segment (e.g. plain windowStart/deferUntil) —
  // they render without a sub-header rather than under a manufactured one.
  label: string | null;
  tasks: Task[];
  groups: { group: TaskGroup; children: Task[] }[];
};

// Collapsible reveal for tasks deferred to later today (a time segment or
// window that hasn't opened yet). Mirrors ExpiredSection below: collapsed and
// deemphasized by default, expands in place to show the tasks, sub-grouped by
// time segment (Morning/Afternoon/Evening) the same way the Later screen
// sub-groups by segment within a day.
function LaterTodaySection({
  sections,
  expanded,
  onToggle,
  renderTask,
  renderGroup,
  styles,
  colors,
}: {
  sections: LaterTodaySectionData[];
  expanded: boolean;
  onToggle: () => void;
  renderTask: (task: Task) => React.ReactNode;
  renderGroup: (group: TaskGroup, children: Task[]) => React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const totalCount = sections.reduce(
    (sum, s) => sum + s.tasks.length + s.groups.reduce((gSum, g) => gSum + g.children.length, 0),
    0,
  );
  if (totalCount === 0) return null;
  return (
    <View style={styles.hiddenSection}>
      <TouchableOpacity
        style={styles.hiddenToggle}
        onPress={onToggle}
        activeOpacity={interaction.activeOpacity}
      >
        <Ionicons name="time-outline" size={13} color={colors.textTertiary} />
        <Text style={styles.hiddenToggleText}>
          {expanded ? 'Hide' : 'Show'} {totalCount} later today
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
      </TouchableOpacity>
      {expanded && sections.map(section => (
        <View key={section.key}>
          {section.label && (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.label}</Text>
            </View>
          )}
          {section.groups.map(g => (
            <React.Fragment key={g.group.id}>{renderGroup(g.group, g.children)}</React.Fragment>
          ))}
          {section.tasks.map(task => (
            <React.Fragment key={task.id}>{renderTask(task)}</React.Fragment>
          ))}
        </View>
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
  const route = useRoute<any>();
  const inboxTasks = useTaskStore(useShallow(s => s.inboxTasks()));
  const tabBarHeight = useBottomTabBarHeight();
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const visibleTasks = useTaskStore(useShallow(s => s.visibleTasks()));
  const pinnedTasks = useTaskStore(useShallow(s => s.pinnedTasks()));
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
  const deferredTasks = useTaskStore(useShallow(s => s.deferredTasks()));
  const unscheduledTasks = useTaskStore(useShallow(s => s.unscheduledTasks()));
  const expiredTasks = useTaskStore(useShallow(s => s.expiredTasks()));
  const vacationHiddenTasks = useTaskStore(useShallow(s => s.vacationHiddenTasks()));
  const upcomingTodayTasks = useTaskStore(useShallow(s => s.upcomingTodayTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const isEmptyDatabase = allTasks.length === 0;
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const updateTask = useTaskStore(s => s.updateTask);
  const clearAllPins = useTaskStore(s => s.clearAllPins);
  const reorderTasks = useTaskStore(s => s.reorderTasks);
  const reorderWithCategoryUpdates = useTaskStore(s => s.reorderWithCategoryUpdates);
  const reorderCategories = useCategoryStore(s => s.reorderCategories);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const addCategory = useTaskStore(s => s.addCategory);
  const markTasksSeen = useTaskStore(s => s.markTasksSeen);
  const taskGroups = useTaskGroupStore(useShallow(s => s.groups));
  const setGroupCollapsed = useTaskGroupStore(s => s.setGroupCollapsed);
  const updateGroup = useTaskGroupStore(s => s.updateGroup);
  const createTaskGroup = useTaskGroupStore(s => s.createGroup);
  const removeGroupRow = useTaskGroupStore(s => s.removeGroupRow);
  const completeGroup = useTaskStore(s => s.completeGroup);
  const dismissGroup = useTaskStore(s => s.dismissGroup);
  const deferGroup = useTaskStore(s => s.deferGroup);
  const pinGroup = useTaskStore(s => s.pinGroup);
  const groupRosterOf = useTaskStore(s => s.groupRosterOf);
  const groupTasks = useTaskStore(s => s.groupTasks);
  const reorderGroupChildren = useTaskStore(s => s.reorderGroupChildren);
  const addExistingToGroup = useTaskStore(s => s.addExistingToGroup);
  const removeFromGroup = useTaskStore(s => s.removeFromGroup);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const justCreatedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoCompletingIds, setAutoCompletingIds] = useState<Set<string>>(new Set());
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [pullingToAdd, setPullingToAdd] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
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
    painting,
    paintProps,
  } = useTaskSelection(allTasks);
  // Extra bottom padding so the last rows aren't hidden behind the floating BulkActionBar.
  const selectionListPadding = selectionMode ? tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm : undefined;
  const [restExpanded, setRestExpanded] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  // True only while a category header is mid-drag: every category's tasks
  // hide (render-only — see categorySectionKeys below, NOT removed from the
  // underlying list) so the full run of headers is visible without
  // scrolling, without changing what onReorder hands back on drop.
  const [autoCollapseForDrag, setAutoCollapseForDrag] = useState(false);
  const [isSuggestingPin, setIsSuggestingPin] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [groupEditorVisible, setGroupEditorVisible] = useState(false);
  // Set while editingGroup is a stack freshly created from the add menu —
  // discarded on close if it was never given a title.
  const newStackIdRef = useRef<string | null>(null);

  // Collapse any expanded task when navigating away from this tab so it
  // isn't still expanded when the user comes back.
  useFocusEffect(
    useCallback(() => {
      return () => setExpandedTaskId(null);
    }, [])
  );

  // Tapping the Today tab in the bottom nav should always land on the Today
  // sub-view, even if the screen was left showing Later (e.g. switched to
  // Search, then back). tabPress fires whether or not the tab was already
  // focused, unlike useFocusEffect.
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as never, () => {
      setViewMode('today');
    });
    return unsubscribe;
  }, [navigation]);

  // Tapping the Today widget navigates here programmatically (resetToToday()
  // in src/navigation/navigationRef.ts), which doesn't fire tabPress. The param
  // is stamped fresh each time, so comparing against the last handled value is
  // what makes a repeat of the same destination fire again.
  //
  // Applied *during render* rather than from an effect: this screen stays
  // mounted in the tab navigator, so it re-renders with whatever sub-view it
  // was left on the moment the tab becomes visible, and an effect only runs
  // after that frame is committed — the user would see a flash of the old
  // sub-view before it swapped to Today. Adjusting state during render makes
  // React re-run this component before committing, so the stale sub-view is
  // never painted.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [handledReset, setHandledReset] = useState<number | undefined>(undefined);
  if (route.params?.resetToToday !== undefined && route.params.resetToToday !== handledReset) {
    setHandledReset(route.params.resetToToday);
    setViewMode('today');
  }

  // Claims completions queued by the Today widget's checkbox (see
  // useWidgetCompletionStore / widgetSync.ts). Handing a pending id off to a
  // TaskItem via autoComplete triggers the real tap-to-complete animation
  // there — completeTask() itself is only called once that animation
  // finishes, not here — so dequeue right away to avoid re-triggering it on
  // a later render. A task that's already gone (completed/deleted elsewhere
  // in the meantime) is just dropped.
  const widgetCompletionIds = useWidgetCompletionStore(useShallow(s => s.pendingIds));
  const dequeueWidgetCompletion = useWidgetCompletionStore(s => s.dequeue);
  useEffect(() => {
    if (widgetCompletionIds.length === 0) return;
    widgetCompletionIds.forEach(id => {
      dequeueWidgetCompletion(id);
      const task = allTasks.find(t => t.id === id);
      if (!task || task.completed) return;
      setAutoCompletingIds(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
    });
  }, [widgetCompletionIds]);

  // Briefly flags a task so its row renders the "just created" highlight, then
  // clears the flag once the animation has had time to finish.
  const showJustCreated = (taskId: string) => {
    if (justCreatedTimeoutRef.current) clearTimeout(justCreatedTimeoutRef.current);
    setJustCreatedId(taskId);
    justCreatedTimeoutRef.current = setTimeout(() => setJustCreatedId(null), 1200);
  };

  // Switch to whichever sub-view the new task actually landed in, so it's never
  // created into a view that can't show it. A quick-add with no organizing
  // metadata at all is an Inbox task, whichever view it was added from.
  const handleTaskCreated = (task: Task) => {
    const destination: ViewMode = isInboxTask(task)
      ? 'inbox'
      : isTaskVisible(task) ? 'today'
      : isUnscheduledTask(task) ? 'unscheduled'
      : 'later';
    if (destination !== viewMode) setViewMode(destination);
    showJustCreated(task.id);
  };

  useEffect(() => {
    return () => {
      if (justCreatedTimeoutRef.current) clearTimeout(justCreatedTimeoutRef.current);
    };
  }, []);

  // visibleTasks()/expiredTasks()/upcomingTodayTasks() etc. are only
  // re-derived when a render happens; a task's visibility can flip purely
  // from time passing (a defer/time-segment threshold crossing, a window
  // expiring), with no store mutation to trigger that render. Tick while
  // focused so the list stays current on its own.
  const [, forceRefresh] = useState(0);
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => forceRefresh(n => n + 1), 30000);
      // Also refresh the instant the app comes back to the foreground
      // (e.g. reopened the next morning), instead of waiting on the tick.
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') {
          useTaskStore.getState().checkVacationExpiry();
          forceRefresh(n => n + 1);
        }
      });
      return () => {
        clearInterval(interval);
        subscription.remove();
      };
    }, [])
  );

  const spotlightActive = expandedTaskId !== null && !selectionMode;
  const listElevated = useSpotlightElevation(spotlightActive);
  // One animation for the whole mask: the backdrop, every row's scrim, every
  // header's scrim and the FAB below all read this value, so they can't drift
  // apart no matter how much work the expanding row's own render costs.
  const spotlightProgress = useSpotlightProgress(spotlightActive);

  // Fade the FAB out while a task is spotlighted. The elevated list (zIndex 10)
  // otherwise renders rows on top of the FAB, which looks broken; hiding it
  // also makes it non-interactive in this state, matching the dimmed list.
  const fabOpacity = useMemo(
    () => spotlightProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    [spotlightProgress],
  );

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

  // Pinning a task immediately reshuffles the list into Pinned/Rest sections,
  // which moves everything under the finger and makes it hard to tap the
  // pin on more than one task in a row. Give the user a brief grace period
  // after each pin toggle to keep tapping pins in the normal layout
  // before the view snaps into pinned mode.
  const PIN_VIEW_GRACE_MS = 1500;
  const [pinViewGraceActive, setPinViewGraceActive] = useState(false);
  const pinViewGraceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPinnedCount = useRef(pinnedTasks.length);

  useEffect(() => {
    const grew = pinnedTasks.length > prevPinnedCount.current;
    prevPinnedCount.current = pinnedTasks.length;

    if (pinnedTasks.length === 0) {
      if (pinViewGraceTimer.current) clearTimeout(pinViewGraceTimer.current);
      pinViewGraceTimer.current = null;
      setPinViewGraceActive(false);
      return;
    }

    if (grew) {
      if (pinViewGraceTimer.current) clearTimeout(pinViewGraceTimer.current);
      setPinViewGraceActive(true);
      pinViewGraceTimer.current = setTimeout(() => {
        pinViewGraceTimer.current = null;
        setPinViewGraceActive(false);
      }, PIN_VIEW_GRACE_MS);
    }
  }, [pinnedTasks.length]);

  useEffect(() => {
    return () => {
      if (pinViewGraceTimer.current) clearTimeout(pinViewGraceTimer.current);
    };
  }, []);

  const handleSuggestPin = async () => {
    setIsSuggestingPin(true);
    try {
      const ids = await suggestPinTasks(visibleTasks, pinnedTasks.length, completedTasks);
      for (const id of ids) updateTask(id, { pinned: true });
      // AI pin picks tasks in one shot rather than one tap at a time, so the
      // grace period that protects manual multi-pin tapping doesn't apply here.
      if (pinViewGraceTimer.current) clearTimeout(pinViewGraceTimer.current);
      pinViewGraceTimer.current = null;
      setPinViewGraceActive(false);
    } catch (e) {
      Alert.alert('Could not suggest pins', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsSuggestingPin(false);
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
  const hideCategories = useSettingsStore(s => s.hideCategories);
  const setHideCategories = useSettingsStore(s => s.setHideCategories);

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

  const [quickAddInitialRecurrence, setQuickAddInitialRecurrence] = useState<RecurrenceType | undefined>(undefined);

  const handleAddMenuSelect = (type: AddTaskType) => {
    switch (type) {
      case 'task':
        setQuickAddInitialRecurrence(undefined);
        setQuickAddVisible(true);
        break;
      case 'recurring':
        setQuickAddInitialRecurrence('daily');
        setQuickAddVisible(true);
        break;
      case 'chain':
        setEditingTask(null);
        setEditorInitialDraft({ chainEnabled: true });
        setEditorVisible(true);
        break;
      case 'stack': {
        const group = createTaskGroup('', null);
        newStackIdRef.current = group.id;
        setEditingGroup(group);
        setGroupEditorVisible(true);
        break;
      }
    }
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

  // The rows the current sub-view is actually showing — what "select all" and
  // the bulk bar's tally operate on.
  const visibleForMode = useMemo(() => {
    switch (viewMode) {
      case 'later': return deferredTasks;
      case 'unscheduled': return unscheduledTasks;
      case 'inbox': return inboxTasks;
      default: return filtered;
    }
  }, [viewMode, deferredTasks, unscheduledTasks, inboxTasks, filtered]);

  type ListItem =
    | { type: 'pinned-header' }
    | { type: 'pinned-task'; task: Task }
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
  // doesn't render, same as an empty category would. A group whose children
  // are ALL completed today still renders (with an empty visible-children
  // list, since completed tasks aren't shown individually) so finishing the
  // last child doesn't make the whole stack silently vanish out from under
  // the user — it stays put, checked off, until they explicitly tap it to
  // dismiss (TaskGroupHeader's circle, dismissGroup in useTaskStore), at
  // which point it drops out here via the dismissal check. Only the
  // default (non-pinned) Today view groups/collapses; pinned mode and the
  // "Everything else" reveal intentionally stay flat so pinning a task
  // always pulls it out for individual attention.
  //
  // A dismissal only hides the stack for the logical day it was made, and
  // only while every member due today is still done — so a stack that gains
  // live work again reappears on its own, and tomorrow's occurrences always
  // come back (see isGroupHiddenToday).
  const visibleGroupItems = useMemo(() => {
    const filteredIds = new Set(filtered.map(t => t.id));
    return taskGroups
      .map(group => ({
        group,
        children: (childrenByGroupId.get(group.id) ?? []).filter(t => filteredIds.has(t.id)),
      }))
      .filter(g => {
        const dueToday = (childrenByGroupId.get(g.group.id) ?? []).filter(isRelevantToGroupToday);
        if (isGroupHiddenToday(g.group.completedAt, dueToday)) return false;
        return g.children.length > 0 || dueToday.length > 0;
      });
  }, [taskGroups, childrenByGroupId, filtered]);

  // Same pairing as visibleGroupItems, but for tasks deferred to later today
  // rather than currently visible — so a stack whose children are all still
  // waiting on a time segment/defer still renders as a collapsible group
  // header inside "Later Today" instead of each child appearing loose.
  const laterGroupItems = useMemo(() => {
    return taskGroups
      .map(group => ({
        group,
        children: (childrenByGroupId.get(group.id) ?? []).filter(t => upcomingTaskIds.has(t.id)),
      }))
      .filter(g => g.children.length > 0);
  }, [taskGroups, childrenByGroupId, upcomingTaskIds]);

  // Same pairing again, for the Inbox lens: stacks with at least one Inbox
  // member, each paired with just those members. Being in a stack isn't one
  // of the things isInboxTask() counts as filed (a stack is a label, not a
  // schedule), so a stacked-but-otherwise-bare task legitimately sits here —
  // and it should sit under its stack's header, the same as everywhere else,
  // rather than loose among the untriaged rows.
  //
  // Built from inboxTasks rather than childrenByGroupId so the children come
  // out in the Inbox's own sortOrder. No dismissal check: a dismissal means
  // "done with this stack for today", and Inbox members are undated, so they
  // still need triaging regardless.
  const inboxGroupItems = useMemo(() => {
    const byGroup = new Map<string, Task[]>();
    for (const t of inboxTasks) {
      if (!t.groupId) continue;
      const list = byGroup.get(t.groupId);
      if (list) list.push(t);
      else byGroup.set(t.groupId, [t]);
    }
    return taskGroups
      .map(group => ({ group, children: byGroup.get(group.id) ?? [] }))
      .filter(g => g.children.length > 0);
  }, [taskGroups, inboxTasks]);

  // The Inbox list itself: one row per untriaged task, with each stack's
  // header taking the slot of its first member and that member's siblings
  // pulled out of the loose run underneath it.
  const inboxData = useMemo((): ListItem[] => {
    const headerAt = new Map<string, { group: TaskGroup; children: Task[] }>();
    const inGroup = new Set<string>();
    for (const item of inboxGroupItems) {
      headerAt.set(item.children[0].id, item);
      for (const child of item.children) inGroup.add(child.id);
    }
    const items: ListItem[] = [];
    for (const task of inboxTasks) {
      const header = headerAt.get(task.id);
      if (header) items.push({ type: 'group', group: header.group, children: header.children });
      if (!inGroup.has(task.id)) items.push({ type: 'task', task });
    }
    return items;
  }, [inboxTasks, inboxGroupItems]);

  const upcomingUngroupedTasks = useMemo(
    () => upcomingTodayTasks.filter(t => !t.groupId),
    [upcomingTodayTasks],
  );

  // Sub-groups Later Today's tasks/groups by time segment, mirroring the
  // Later screen's own segment sub-headers. A task with no timeSegments falls
  // into the 'none' bucket, which renders without a header. A group is
  // assigned to every segment bucket any of its later-today children belong
  // to, but only once per bucket — with its full later-today children roster
  // underneath, not just the ones matching that segment — so a stack doesn't
  // fragment into duplicate headers when its children have mixed segments.
  const laterTodaySections = useMemo((): LaterTodaySectionData[] => {
    type Bucket = { tasks: Task[]; groups: Map<string, { group: TaskGroup; children: Task[] }> };
    const bySegment = new Map<string, Bucket>();
    const ensure = (key: string): Bucket => {
      let bucket = bySegment.get(key);
      if (!bucket) {
        bucket = { tasks: [], groups: new Map() };
        bySegment.set(key, bucket);
      }
      return bucket;
    };

    upcomingUngroupedTasks.forEach(task => {
      const segs = task.timeSegments.length > 0 ? task.timeSegments : ['none'];
      segs.forEach(seg => ensure(seg).tasks.push(task));
    });

    laterGroupItems.forEach(({ group, children }) => {
      const segs = new Set<string>();
      children.forEach(child => {
        (child.timeSegments.length > 0 ? child.timeSegments : ['none']).forEach(seg => segs.add(seg));
      });
      segs.forEach(seg => {
        const bucket = ensure(seg);
        if (!bucket.groups.has(group.id)) bucket.groups.set(group.id, { group, children });
      });
    });

    return [...SEGMENT_ORDER, 'none']
      .filter(key => bySegment.has(key))
      .map(key => ({
        key,
        label: key === 'none' ? null : SEGMENT_LABELS[key],
        tasks: bySegment.get(key)!.tasks,
        groups: Array.from(bySegment.get(key)!.groups.values()),
      }));
  }, [upcomingUngroupedTasks, laterGroupItems]);

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

  // When the "Hide categories" display option is on, drop every category
  // header (but keep the "Later Today" time-section header) so the list
  // reads as one flat run of tasks/groups instead of category sections.
  const stripCategoryHeaders = (items: ListItem[]): ListItem[] =>
    hideCategories
      ? items.filter(item => item.type !== 'header' || item.label === LATER_TODAY_LABEL)
      : items;

  const data: ListItem[] = useMemo(() => {
    if (pinnedTasks.length > 0 && !pinViewGraceActive) {
      const items: ListItem[] = [{ type: 'pinned-header' }];
      pinnedTasks.forEach(task => items.push({ type: 'pinned-task', task }));
      const restTasks = filtered.filter(t => !t.pinned);
      if (restTasks.length > 0) {
        items.push({ type: 'rest-header' });
        if (restExpanded) items.push(...makeCategoryGroups(restTasks, allCategories));
      }
      return stripCategoryHeaders(applyCategoryCollapse(items));
    }

    const ungrouped = filtered.filter(t => !t.groupId);
    const items = makeCategoryGroups(ungrouped, allCategories, visibleGroupItems);
    return stripCategoryHeaders(applyCategoryCollapse(items));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, pinnedTasks, pinViewGraceActive, restExpanded, allCategories, collapsedCategories, visibleGroupItems, hideCategories]);

  const listItemKey = (item: ListItem): string =>
    item.type === 'pinned-header' ? '__pinned-header__'
    : item.type === 'pinned-task' ? `pin-${item.task.id}`
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

  // Set while a group header's drag() is in flight, mirroring
  // draggingCategoryRef — lets the group's own children collapse for the
  // duration of the drag (rendered check further down) without touching the
  // rest of the category. Cleared in the outer ReorderableList's onDragEnd.
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  // The group whose long-press is currently calling drag(), handed to
  // onDragBegin so the state above is only ever set once the list has
  // actually taken the drag.
  //
  // Setting it here directly (as this used to) strands it: startDrag no-ops
  // when a drag is already active — most easily hit by long-pressing a stack
  // during the ~160ms drop animation of the previous drag — and then neither
  // onDragBegin nor onDragEnd ever fires, so nothing clears it. A stranded id
  // hides that stack's children for the rest of the session while the header
  // keeps reading expanded (the chevron follows group.collapsed, which is
  // still false), so collapsing and expanding again appears to lose the
  // tasks.
  const pendingGroupDragRef = useRef<string | null>(null);
  const startGroupDrag = (groupId: string, drag: () => void) => {
    draggingCategoryRef.current = null;
    haptics.tap();
    pendingGroupDragRef.current = groupId;
    drag();
    pendingGroupDragRef.current = null;
  };

  // Tracks a "drag right to join a group" gesture while a plain loose task is
  // being dragged: set from onDragMove below whenever the finger is offset
  // rightward (like a subtask indent) while the dragged card sits anywhere
  // over a group — header or children — and cleared once the offset falls
  // back under the release threshold. Read once at drop time in onDragEnd.
  const joinGroupIntentRef = useRef<string | null>(null);
  const [joinGroupIntentId, setJoinGroupIntentId] = useState<string | null>(null);
  // Task the drop just handed to a group (set in onDragEnd, which runs before
  // onReorder), so the placement pass below leaves it alone — it belongs to
  // the group now, not to whatever slot it was let go over.
  const joinedTaskIdRef = useRef<string | null>(null);
  const JOIN_GROUP_INDENT_THRESHOLD = spacing.md + spacing.lg; // matches TaskItem's subtask indent
  // Once armed it takes a much bigger leftward move to disarm than it took to
  // arm. Without that gap, the small horizontal wobble of a finger dragging
  // vertically flickered the highlight (and its haptic) on and off.
  const JOIN_GROUP_RELEASE_THRESHOLD = spacing.md;
  // Index (within draggableData) of the row currently being dragged in the
  // main list — kept up to date from dragRange (called every hover update)
  // so onDragMove can tell which row is in flight without ReorderableList
  // needing to expose that itself.
  const activeDragIndexRef = useRef<number | null>(null);

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

  // Swiping a stack header left drops into bulk editing with the whole stack
  // already selected, so "reschedule these five things" is one gesture plus
  // one picker rather than five swipes.
  //
  // Roster, not children: a completed occurrence keeps its groupId forever and
  // so does the row that replaces it, so groupChildrenOf grows by one per
  // completion. groupRosterOf collapses those back to one entry per series
  // (see the Stacks note in CLAUDE.md). Live members only — selecting finished
  // history would put it in reach of the bulk bar's delete.
  const selectGroupRoster = (groupId: string) => {
    const ids = groupRosterOf(groupId).filter(t => !t.completed).map(t => t.id);
    if (ids.length === 0) return;
    setExpandedTaskId(null);
    enterSelectionMode(ids);
  };

  // Shared by the plain 'task' row case and a group's expanded children —
  // group children are full TaskItem rows with every normal capability
  // (checkbox, swipe actions, timer, expand-for-notes, individual skip). A
  // group child's drag is driven by the nested SortableList in the 'group'
  // render branch below (reorder within the group / drag out to remove),
  // entirely separate from the outer ReorderableList's own drag machinery.
  const renderTaskRow = (task: Task, opts?: { drag?: (e?: GestureResponderEvent) => void; isActive?: boolean; indented?: boolean; showCategory?: boolean }) => {
    const subs = subtasksByParent.get(task.id) ?? [];
    return (
      <TaskItem
        task={task}
        indented={opts?.indented}
        showCategory={opts?.showCategory}
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
            : (e?: GestureResponderEvent) => { draggingCategoryRef.current = null; opts.drag!(e); }
        }
        isActive={opts?.isActive}
        selectionMode={selectionMode}
        selected={selectedIds.has(task.id)}
        onSelect={() => toggleSelection(task.id)}
        onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(task.id); }}
        hideTodayLabel
        justCreated={task.id === justCreatedId}
        autoComplete={autoCompletingIds.has(task.id)}
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
    if (item.type === 'pinned-header') {
      return (
        <Pressable style={styles.focusSectionHeader} onPress={() => setExpandedTaskId(null)}>
          <View style={styles.focusSectionTitleRow}>
            <Ionicons name="pin" size={13} color={colors.orange} />
            <Text style={styles.focusSectionTitle}>Pinned Tasks</Text>
          </View>
          <View style={styles.pinnedSectionActions}>
            <TouchableOpacity onPress={clearAllPins} hitSlop={8}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          </View>
          <SpotlightScrim />
        </Pressable>
      );
    }
    if (item.type === 'pinned-task') {
      return renderTaskRow(item.task, { drag, isActive, showCategory: true });
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
          <SpotlightScrim />
        </TouchableOpacity>
      );
    }
    if (item.type === 'header') {
      // (Tapping it while a task is expanded still collapses the spotlight,
      // via the list wrapper's onTouchEnd.)
      const isCategory = item.label !== LATER_TODAY_LABEL;
      return (
        <SectionHeader
          label={isCategory ? categoryLabel(item.label, categories) : item.label}
          styles={styles}
          colors={colors}
          collapsed={isCategory ? (autoCollapseForDrag || collapsedCategories.has(item.label)) : undefined}
          onToggle={isCategory ? () => toggleCategoryCollapse(item.label) : undefined}
          onDrag={isCategory && drag && !selectionMode ? () => startCategoryDrag(item.label, drag) : undefined}
        />
      );
    }
    if (item.type === 'group') {
      const allChildren = childrenByGroupId.get(item.group.id) ?? [];
      return (
        <GroupDropTarget active={joinGroupIntentId === item.group.id}>
          <TaskGroupHeader
            group={item.group}
            allChildren={allChildren}
            onToggleCollapse={() => {
              if (expandedTaskId !== null) { setExpandedTaskId(null); return; }
              haptics.tap();
              // No animateLayout() here: AnimatedCollapsible already owns a
              // smooth Reanimated-driven height transition for this row, and
              // stacking a LayoutAnimation on the same commit fights it —
              // LayoutAnimation grabs the view's current committed frame to
              // animate from, which can race the in-progress Reanimated
              // value and leave the row frozen at zero height until
              // something else (a remount) forces a fresh layout.
              //
              // A tap landing here means no drag is in flight, so this
              // doubles as the recovery path if one ever ends without
              // onDragEnd — otherwise the stack would stay bodiless no
              // matter how many times it's collapsed and expanded.
              setDraggingGroupId(null);
              setGroupCollapsed(item.group.id, !item.group.collapsed);
            }}
            onComplete={() => completeGroup(item.group.id)}
            onDismiss={() => { animateLayout(); dismissGroup(item.group.id); }}
            onDefer={date => deferGroup(item.group.id, date)}
            onPin={() => pinGroup(item.group.id)}
            onSwipeSelect={() => selectGroupRoster(item.group.id)}
            onPressEdit={() => { setEditingGroup(item.group); setGroupEditorVisible(true); }}
            onDrag={!selectionMode && drag ? () => startGroupDrag(item.group.id, drag) : undefined}
          />
          <AnimatedCollapsible expanded={!item.group.collapsed && draggingGroupId !== item.group.id}>
            <SortableList
              data={item.children}
              onReorder={reordered => reorderGroupChildren(item.group.id, reordered.map(t => t.id))}
              onDragOut={task => removeFromGroup(task.id)}
              renderItem={(child, _displayIndex, childDrag, childIsActive) => (
                <React.Fragment key={child.id}>
                  {renderTaskRow(child, {
                    indented: true,
                    isActive: childIsActive,
                    // Reads the long-press's pageY to seed SortableList's own
                    // delta-based drag tracking (it has no row-layout map to
                    // fall back on the way the outer ReorderableList does).
                    drag: selectionMode
                      ? undefined
                      : (e?: GestureResponderEvent) => childDrag(e?.nativeEvent.pageY ?? 0),
                  })}
                </React.Fragment>
              )}
            />
          </AnimatedCollapsible>
        </GroupDropTarget>
      );
    }

    return renderTaskRow(item.task, { drag, isActive });
  };

  // Revealed vacation-hidden tasks are peek-only: no drag, but they can still
  // be swiped into selection like any other row so they don't lose delete
  // capability now that per-row swipe-delete is gone.
  const renderHiddenTask = (task: Task, opts?: { indented?: boolean }) => {
    const subs = subtasksByParent.get(task.id) ?? [];
    return (
      <TaskItem
        task={task}
        indented={opts?.indented}
        showCategory
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

  // Group header + children for a stack rendered inside the "Later Today"
  // reveal — mirrors renderItem's 'group' branch, including indenting
  // children under the header, but children use renderHiddenTask (no drag,
  // since Later Today rows are peek-only). The badge's "N/M" tally uses only
  // this group's later-today children (dueTodayOverride) rather than
  // TaskGroupHeader's default isRelevantToGroupToday filter, since those
  // children aren't currently visible yet and would otherwise never count.
  const renderLaterGroup = (group: TaskGroup, children: Task[]) => {
    const allChildren = childrenByGroupId.get(group.id) ?? [];
    return (
      <View>
        <TaskGroupHeader
          group={group}
          allChildren={allChildren}
          dueTodayOverride={children}
          onToggleCollapse={() => {
            haptics.tap();
            // See the main list's group onToggleCollapse: no animateLayout()
            // here either, for the same reason — AnimatedCollapsible drives
            // this row's own transition already.
            setGroupCollapsed(group.id, !group.collapsed);
          }}
          onComplete={() => completeGroup(group.id)}
          onDismiss={() => { animateLayout(); dismissGroup(group.id); }}
          onDefer={date => deferGroup(group.id, date)}
          onPin={() => pinGroup(group.id)}
          onSwipeSelect={() => selectGroupRoster(group.id)}
          onPressEdit={() => { setEditingGroup(group); setGroupEditorVisible(true); }}
        />
        <AnimatedCollapsible expanded={!group.collapsed}>
          {children.map(child => (
            <React.Fragment key={child.id}>{renderHiddenTask(child, { indented: true })}</React.Fragment>
          ))}
        </AnimatedCollapsible>
      </View>
    );
  };

  // An Inbox row. Deliberately plainer than renderTaskRow: no category or
  // project chip and no "today" label, because an Inbox task has none of
  // that by definition (see isInboxTask), and no drag, since the Inbox list
  // doesn't reorder. Shared by the loose rows and a stack's children.
  const renderInboxTask = (task: Task, opts?: { indented?: boolean }) => {
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
        selectionMode={selectionMode}
        selected={selectedIds.has(task.id)}
        onSelect={() => toggleSelection(task.id)}
        onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(task.id); }}
        justCreated={task.id === justCreatedId}
      />
    );
  };

  // Group header + children for a stack rendered in the Inbox — mirrors
  // renderLaterGroup, minus the drag (the Inbox list doesn't reorder). No
  // dueTodayOverride here, unlike Later Today: these children are undated,
  // so the honest "N/M today" tally is the one TaskGroupHeader computes from
  // the full roster — 0 for an all-Inbox stack, which hides the badge, and
  // the real count for a stack that also has members due today.
  const renderInboxGroup = (group: TaskGroup, children: Task[]) => {
    const allChildren = childrenByGroupId.get(group.id) ?? [];
    return (
      <View>
        <TaskGroupHeader
          group={group}
          allChildren={allChildren}
          onToggleCollapse={() => {
            if (expandedTaskId !== null) { setExpandedTaskId(null); return; }
            haptics.tap();
            animateLayout();
            setGroupCollapsed(group.id, !group.collapsed);
          }}
          onComplete={() => completeGroup(group.id)}
          onDismiss={() => { animateLayout(); dismissGroup(group.id); }}
          onDefer={date => deferGroup(group.id, date)}
          onPin={() => pinGroup(group.id)}
          onSwipeSelect={() => selectGroupRoster(group.id)}
          onPressEdit={() => { setEditingGroup(group); setGroupEditorVisible(true); }}
        />
        <AnimatedCollapsible expanded={!group.collapsed}>
          {children.map(child => (
            <React.Fragment key={child.id}>{renderInboxTask(child, { indented: true })}</React.Fragment>
          ))}
        </AnimatedCollapsible>
      </View>
    );
  };

  // Footer shared by every list variant: the vacation-hidden reveal (when any)
  // followed by the tap-to-dismiss spacer. `fixedWhenEmpty` keeps the empty
  // state centered by stopping the spacer from growing.
  const listFooter = (fixedWhenEmpty = false) => (
    <>
      {viewMode === 'today' && pinnedTasks.length === 0 && (
        <LaterTodaySection
          sections={laterTodaySections}
          expanded={showUpcoming}
          onToggle={() => {
            haptics.tap();
            animateLayout();
            setExpandedTaskId(null);
            setShowUpcoming(v => !v);
          }}
          renderTask={renderHiddenTask}
          renderGroup={renderLaterGroup}
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

  const emptyComponent = isEmptyDatabase ? (
    <EmptyState
      icon="sparkles-outline"
      title="Welcome to your list"
      subtitle="Add your first task to get started"
      actionLabel="Add a task"
      onAction={() => setQuickAddVisible(true)}
      bottomOffset={tabBarHeight}
    />
  ) : (
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

  const laterGroupKeys = (task: Task): string[] => {
    const visibleAt = getVisibleAt(task);
    const dayLabel = formatGroupHeader(visibleAt.toISOString());
    if (task.timeSegments.length > 0) {
      return task.timeSegments.map(seg => `${dayLabel} — ${SEGMENT_LABELS[seg]}`);
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

  // The Later list can grow unboundedly (nothing prunes it), and its
  // ReorderableList renders every row unmounted-free (no virtualization — see
  // the file's own comments on why that's deliberate for drag-and-drop). To
  // keep the initial mount cheap, only feed it sections up to a task budget,
  // growing that budget as the user scrolls near the bottom (see the Later
  // ReorderableList's onEndReached below). Whole sections are always included
  // together so a header never renders without at least one of its tasks.
  const LATER_INITIAL_TASK_LIMIT = 60;
  const LATER_TASK_PAGE_SIZE = 60;
  const [laterTaskLimit, setLaterTaskLimit] = useState(LATER_INITIAL_TASK_LIMIT);

  const visibleLaterSections = useMemo(() => {
    const result: typeof laterSections = [];
    let count = 0;
    for (const section of laterSections) {
      result.push(section);
      count += section.data.length;
      if (count >= laterTaskLimit) break;
    }
    return result;
  }, [laterSections, laterTaskLimit]);

  const hasMoreLaterSections = useMemo(
    () => visibleLaterSections.length < laterSections.length,
    [visibleLaterSections, laterSections],
  );

  const laterData = useMemo(() => flattenLaterSections(visibleLaterSections), [visibleLaterSections]);
  const [laterDraggableData, setLaterDraggableData] = useState<LaterListItem[]>(laterData);
  useEffect(() => {
    setLaterDraggableData(laterData);
  }, [laterData]);

  const handleLaterEndReached = useCallback(() => {
    setLaterTaskLimit(limit => limit + LATER_TASK_PAGE_SIZE);
  }, []);

  const headerActions: ScreenHeaderAction[] = [
    ...(viewMode === 'today'
      ? [{
          icon: 'funnel' as const,
          onPress: () => setFilterVisible(true),
          active: activeFilterCount > 0,
          badge: activeFilterCount,
          accessibilityLabel: 'Sort and filter',
        }]
      : []),
    ...(viewMode === 'today'
      ? [{
          icon: 'ellipsis-horizontal' as const,
          onPress: () => setOptionsMenuVisible(true),
          active: hideCategories,
          accessibilityLabel: 'More options',
        }]
      : []),
    ...(viewMode === 'today' && pinnedTasks.length < 5 && visibleTasks.length > 0
      ? [{
          icon: 'sparkles' as const,
          onPress: handleSuggestPin,
          active: pinnedTasks.length === 0,
          tint: 'orange' as const,
          disabled: isSuggestingPin,
          loading: isSuggestingPin,
          accessibilityLabel: 'Suggest pin tasks',
        }]
      : []),
  ];

  return (
    <SpotlightProvider progress={spotlightProgress}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader
          title={VIEW_TITLES[viewMode]}
          overline={viewMode === 'today' ? today : undefined}
          actions={headerActions}
        />

        {/* View mode switcher */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.viewModePillsScroll}
          contentContainerStyle={styles.viewModePills}
        >
          {VIEW_MODES.map(mode => {
            const active = viewMode === mode;
            const badge = mode === 'inbox' ? inboxTasks.length : 0;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.viewModePill, active && styles.viewModePillActive]}
                onPress={() => {
                  haptics.tap();
                  setViewMode(mode);
                  setExpandedTaskId(null);
                  if (selectionMode) exitSelection();
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  badge > 0 ? `${VIEW_TITLES[mode]} view, ${badge} to sort` : `${VIEW_TITLES[mode]} view`
                }
              >
                <Text style={[styles.viewModePillText, active && styles.viewModePillTextActive]}>
                  {VIEW_TITLES[mode]}
                </Text>
                {badge > 0 && (
                  <View style={styles.viewModePillBadge}>
                    <Text style={styles.viewModePillBadgeText}>{badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

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
        <PaintSelectionProvider {...paintProps}>
        {viewMode === 'later' && (
          <ReorderableList
            scrollEnabled={!painting}
            data={laterDraggableData}
            keyExtractor={item => item.key}
            renderItem={({ item, drag, isActive }) => {
              if (item.type === 'header') {
                return (
                  <Pressable style={styles.sectionHeader} onPress={() => setExpandedTaskId(null)}>
                    <Text style={styles.sectionHeaderText}>{item.label}</Text>
                    <SpotlightScrim />
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
                  showProject
                  showGroup
                  showActions={false}
                  justCreated={item.task.id === justCreatedId}
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
            onEndReached={handleLaterEndReached}
            onEndReachedThreshold={400}
            contentContainerStyle={
              laterDraggableData.length === 0
                ? styles.emptyContainer
                : [styles.listContent, selectionListPadding !== undefined && { paddingBottom: selectionListPadding }]
            }
            ListEmptyComponent={
              isEmptyDatabase ? (
                <EmptyState
                  icon="sparkles-outline"
                  title="Welcome to your list"
                  subtitle="Add your first task to get started"
                  actionLabel="Add a task"
                  onAction={() => setQuickAddVisible(true)}
                  bottomOffset={tabBarHeight}
                />
              ) : (
                <EmptyState
                  icon="moon"
                  title="Nothing deferred"
                  subtitle="Swipe a task right to defer it"
                  bottomOffset={tabBarHeight}
                />
              )
            }
            ListFooterComponent={
              <>
                {hasMoreLaterSections && (
                  <View style={styles.laterLoadingMore}>
                    <Text style={styles.laterLoadingMoreText}>Loading more…</Text>
                  </View>
                )}
                {listFooter(laterSections.length === 0)}
              </>
            }
          />
        )}

        {viewMode === 'today' && pinnedTasks.length > 0 && (
          <FlatList
            scrollEnabled={!painting}
            data={data}
            keyExtractor={listItemKey}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            renderItem={({ item }) => renderItem({ item })}
            contentContainerStyle={[styles.listContent, selectionListPadding !== undefined && { paddingBottom: selectionListPadding }]}
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

        {viewMode === 'today' && pinnedTasks.length === 0 && (
          <ReorderableList
            scrollEnabled={!painting}
            data={draggableData}
            keyExtractor={listItemKey}
            renderItem={renderItem}
            onDragBegin={() => {
              setExpandedTaskId(null);
              joinedTaskIdRef.current = null;
              // Fires synchronously inside drag(), so this is the group whose
              // header started this drag — or null for any other row, which
              // also clears a previous group drag that somehow outlived its
              // own onDragEnd.
              setDraggingGroupId(pendingGroupDragRef.current);
            }}
            onDragEnd={({ committed }) => {
              const joinGroupId = joinGroupIntentRef.current;
              joinGroupIntentRef.current = null;
              setJoinGroupIntentId(null);
              // The join lands here rather than in onReorder: a drop onto a
              // group leaves the list order untouched (the list stops
              // reordering once it's aimed at a group), and onReorder stays
              // silent when nothing moved. `committed` keeps a cancelled drag —
              // touch loss, app switch — from quietly stacking the task.
              const dragged = draggableData[activeDragIndexRef.current ?? -1];
              if (committed && joinGroupId !== null && dragged?.type === 'task') {
                joinedTaskIdRef.current = dragged.task.id;
                addExistingToGroup(dragged.task.id, joinGroupId);
                haptics.success();
              }
              // Unconditional: the guard this used to carry read a
              // render-stale draggingGroupId, so a drag that began and ended
              // before the state update committed left it set.
              setDraggingGroupId(null);
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
            onDragMove={({ dx, overIndex }) => {
              // Only a plain loose task can be dragged right to join a group —
              // headers and groups themselves use the same horizontal offset
              // purely as drag-overlay cosmetics (see ReorderableList).
              const draggedItem = draggableData[activeDragIndexRef.current ?? -1];
              if (draggedItem?.type !== 'task') return;
              // The target is the group the card is physically over, anywhere
              // from the top of its header to the bottom of its last child —
              // not the reorder gap next to it. hoverIndex describes a gap
              // between rows, and the rows sliding to open that gap are exactly
              // what used to move the group out from under the card, leaving a
              // sliver at the group's top edge as the only place a drop
              // registered.
              const over = overIndex !== null ? draggableData[overIndex] : null;
              const target = over?.type === 'group' ? over.group : null;
              // The rightward offset stays the deliberate part of the gesture —
              // without it there'd be no way to drag a task past a group without
              // falling into it — but disarming now needs a real move back, not
              // just dropping under the arming threshold.
              const armed = joinGroupIntentRef.current !== null;
              const threshold = armed ? JOIN_GROUP_RELEASE_THRESHOLD : JOIN_GROUP_INDENT_THRESHOLD;
              const nextId = target && dx > threshold ? target.id : null;
              if (nextId !== joinGroupIntentRef.current) {
                joinGroupIntentRef.current = nextId;
                setJoinGroupIntentId(nextId);
                if (nextId) haptics.impactLight();
              }
            }}
            // Aiming at a group takes the drag over: the list stops opening a
            // reorder gap, so the group stays put under the card instead of
            // sliding away from the finger chasing it.
            dropDisabled={joinGroupIntentId !== null}
            dropIntoIndex={
              joinGroupIntentId === null
                ? null
                : draggableData.findIndex(i => i.type === 'group' && i.group.id === joinGroupIntentId)
            }
            dragRange={(rangeData, activeIndex) => {
              activeDragIndexRef.current = activeIndex;
              const activeItem = rangeData[activeIndex];
              if (activeItem?.type === 'header' && activeItem.label !== LATER_TODAY_LABEL) {
                const range = categoryHeaderRange(rangeData);
                if (range) return range;
              }
              return [0, rangeData.length - 1];
            }}
            placeholderStyle={styles.dropSlot}
            onReorder={reordered => {
              // The draggable list only ever contains header/task/group items.
              const dropped = reordered.filter(
                (item): item is CategoryListItem =>
                  item.type === 'header' || item.type === 'task' || item.type === 'group',
              );

              const joinedTaskId = joinedTaskIdRef.current;
              joinedTaskIdRef.current = null;

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

              // A task dragged onto a group (see onDragMove) has already joined
              // it in onDragEnd — drop it from the normal placement pass so
              // resolveDrop never assigns it a category/order of its own.
              if (joinedTaskId !== null) {
                const withoutJoined = dropped.filter(
                  item => !(item.type === 'task' && item.task.id === joinedTaskId),
                );
                const { taskIds, categoryUpdates, groupUpdates, settled } = resolveDrop(withoutJoined, {
                  isUpcoming: id => upcomingTaskIds.has(id),
                  showUpcoming,
                  categoryOrder: allCategories,
                });
                groupUpdates.forEach(u => updateGroup(u.id, { category: u.category, sortOrder: u.sortOrder }));
                setDraggableData(settled);
                reorderWithCategoryUpdates(taskIds, categoryUpdates);
                return;
              }

              const { taskIds, categoryUpdates, groupUpdates, settled } = resolveDrop(dropped, {
                isUpcoming: id => upcomingTaskIds.has(id),
                showUpcoming,
                categoryOrder: allCategories,
              });

              const commitDrop = (scope?: 'occurrence' | 'series') => {
                // Show the final grouped layout immediately to avoid a flash; the
                // effect then reconciles to the store-derived `data` (structurally
                // identical) once the store write lands.
                setDraggableData(settled);
                groupUpdates.forEach(u => updateGroup(u.id, { category: u.category, sortOrder: u.sortOrder }));
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
            contentContainerStyle={
              filtered.length === 0
                ? styles.emptyContainer
                : [styles.listContent, selectionListPadding !== undefined && { paddingBottom: selectionListPadding }]
            }
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

        {viewMode === 'unscheduled' && (
          <FlatList
            scrollEnabled={!painting}
            data={unscheduledTasks}
            keyExtractor={t => t.id}
            automaticallyAdjustKeyboardInsets
            renderItem={({ item }) => {
              const subs = subtasksByParent.get(item.id) ?? [];
              return (
                <TaskItem
                  task={item}
                  onPress={() => {
                    if (expandedTaskId !== null && expandedTaskId !== item.id) {
                      setExpandedTaskId(null);
                      return;
                    }
                    setExpandedTaskId(prev => prev === item.id ? null : item.id);
                  }}
                  expanded={expandedTaskId === item.id}
                  spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id && !selectionMode}
                  onEdit={() => openEditor(item)}
                  subtaskCount={subs.length}
                  subtaskDoneCount={subs.filter(t => t.completed).length}
                  subtasks={subs}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.id)}
                  onSelect={() => toggleSelection(item.id)}
                  onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(item.id); }}
                  hideTodayLabel
                  showCategory
                  showProject
                  justCreated={item.id === justCreatedId}
                />
              );
            }}
            contentContainerStyle={
              unscheduledTasks.length === 0
                ? styles.emptyContainer
                : [styles.listContent, selectionListPadding !== undefined && { paddingBottom: selectionListPadding }]
            }
            ListEmptyComponent={
              isEmptyDatabase ? (
                <EmptyState
                  icon="sparkles-outline"
                  title="Welcome to your list"
                  subtitle="Add your first task to get started"
                  actionLabel="Add a task"
                  onAction={() => setQuickAddVisible(true)}
                  bottomOffset={tabBarHeight}
                />
              ) : (
                <EmptyState
                  icon="layers-outline"
                  title="Nothing unscheduled"
                  subtitle="Tasks with no due date land here once they're organized"
                  bottomOffset={tabBarHeight}
                />
              )
            }
            ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
            ListFooterComponentStyle={unscheduledTasks.length === 0 ? undefined : styles.listFooterCell}
          />
        )}

        {/* Triage view of "loose" tasks — title only, no category, tag, date,
            time window, recurrence, reminder or priority (see isInboxTask).
            It's where voice-added ("Hey Siri") and quickly-jotted tasks surface
            for sorting. A computed lens like the others, so a task leaves the
            moment it's organized — no rows show their metadata because by
            definition they have none. Stacks are the exception: a stack is a
            label rather than a schedule, so its members can still be untriaged,
            and they render under the stack's header here just as they do on
            Today (see inboxData). */}
        {viewMode === 'inbox' && (
          <FlatList
            scrollEnabled={!painting}
            data={inboxData}
            keyExtractor={listItemKey}
            automaticallyAdjustKeyboardInsets
            renderItem={({ item }) =>
              item.type === 'group'
                ? renderInboxGroup(item.group, item.children)
                : item.type === 'task'
                  ? renderInboxTask(item.task)
                  : null
            }
            contentContainerStyle={
              inboxTasks.length === 0
                ? styles.emptyContainer
                : [styles.listContent, selectionListPadding !== undefined && { paddingBottom: selectionListPadding }]
            }
            ListEmptyComponent={
              isEmptyDatabase ? (
                <EmptyState
                  icon="sparkles-outline"
                  title="Welcome to your list"
                  subtitle="Add your first task to get started"
                  actionLabel="Add a task"
                  onAction={() => setQuickAddVisible(true)}
                  bottomOffset={tabBarHeight}
                />
              ) : (
                <EmptyState
                  icon="file-tray-outline"
                  title="Inbox zero"
                  subtitle="Voice-added and quick tasks land here to be sorted."
                  bottomOffset={tabBarHeight}
                />
              )
            }
            ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
            ListFooterComponentStyle={inboxTasks.length === 0 ? undefined : styles.listFooterCell}
          />
        )}
        </PaintSelectionProvider>
        </View>

        {!selectionMode && (
          <AddTaskFab
            bottom={insets.bottom + 64}
            disabled={spotlightActive}
            opacity={fabOpacity}
            onSelect={handleAddMenuSelect}
          />
        )}

        <QuickAddModal
          visible={quickAddVisible}
          onClose={() => setQuickAddVisible(false)}
          onOpenFull={handleQuickAddOpenFull}
          context={viewMode}
          onCreated={handleTaskCreated}
          initialRecurrenceType={quickAddInitialRecurrence}
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

        <TodayOptionsMenu
          visible={optionsMenuVisible}
          onClose={() => setOptionsMenuVisible(false)}
          hideCategories={hideCategories}
          onHideCategoriesChange={setHideCategories}
        />

        <TaskGroupEditor
          visible={groupEditorVisible}
          group={editingGroup}
          isNew={newStackIdRef.current !== null}
          onClose={() => {
            setGroupEditorVisible(false);
            if (newStackIdRef.current) {
              const id = newStackIdRef.current;
              newStackIdRef.current = null;
              const current = useTaskGroupStore.getState().getGroupById(id);
              if (current && current.title.trim() === '') removeGroupRow(id);
            }
            setEditingGroup(null);
          }}
        />

        {selectionMode && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            totalCount={visibleForMode.length}
            existingTags={allTags}
            existingCategories={allCategories}
            onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
            onSetCategory={category => { bulkSetCategory(Array.from(selectedIds), category); exitSelection(); }}
            onAddCategory={addCategory}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            // Grouping works from the Inbox too: the tasks stay here (being in
            // a stack isn't one of the things isInboxTask() counts as filed),
            // but they collect under the new stack's header instead of staying
            // loose — see inboxData.
            onGroup={title => {
              const ids = Array.from(selectedIds);
              const selectedCategories = new Set(
                ids.map(id => allTasks.find(t => t.id === id)?.category ?? null)
              );
              const category = selectedCategories.size === 1 ? [...selectedCategories][0] : null;
              groupTasks(ids, title, category);
              exitSelection();
            }}
            onSelectAll={() => selectAll(visibleForMode.map(t => t.id))}
            onDeselectAll={deselectAll}
            onCancel={exitSelection}
            bottomInset={tabBarHeight}
            onHeightChange={setBulkBarHeight}
          />
        )}
      </View>
    </SpotlightProvider>
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
  // ScrollView defaults its outer container to flexGrow/flexShrink: 1, which
  // let it balloon to fill the screen's remaining flex space (competing with
  // listWrapper below) instead of sizing to its own (short, pill-height)
  // content — this pins it back to its natural height.
  viewModePillsScroll: { flexGrow: 0, flexShrink: 0 },
  viewModePills: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: 6, paddingBottom: 4,
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
  pinnedSectionActions: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
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
  laterLoadingMore: {
    paddingVertical: spacing.md, alignItems: 'center',
  },
  laterLoadingMoreText: {
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
