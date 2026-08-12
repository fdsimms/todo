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
  InteractionManager,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PinIcon } from '../components/PinIcon';
import { format } from 'date-fns/format';
import type { Task, TaskGroup, TaskTemplate, Category } from '../types';
import { isTaskNew, isTaskVisible, isUnscheduledTask, isInboxTask, isDismissedToday } from '../utils/visibilityUtils';
import { isRealCompletion } from '../utils/missed';
import { isToday } from 'date-fns/isToday';
import {
  makeCategoryGroups,
  resolveDrop,
  flattenLaterSections,
  isLaterHeader,
  laterTaskOrder,
  LATER_TODAY_LABEL,
  laterSections as computeLaterSections,
  visibleLaterSections as computeVisibleLaterSections,
  laterTodaySections as computeLaterTodaySections,
  applyCategoryCollapse as applyCategoryCollapseTo,
  applyCategoryFocus as applyCategoryFocusTo,
  sectionTaskIds as computeSectionTaskIds,
  findTaskJumpTarget,
  type LaterListItem,
  type CategoryListItem,
  type LaterTodaySectionData,
} from '../utils/taskGrouping';
import { dragRange } from '../utils/reorder';
import { useTaskStore } from '../store/useTaskStore';
import { useWidgetCompletionStore } from '../store/useWidgetCompletionStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useShallow } from 'zustand/react/shallow';
import { MAX_SUGGESTED_PINS } from '../utils/pinSuggest';
import { SuggestedPinsSheet } from '../components/SuggestedPinsSheet';
import { TaskItem } from '../components/TaskItem';
import { TaskGroupHeader } from '../components/TaskGroupHeader';
import { TaskGroupBody } from '../components/TaskGroupBody';
import { TaskGroupTray } from '../components/TaskGroupTray';
import { TaskGroupEditor } from '../components/TaskGroupEditor';
import { ReorderableList, type RowScroller } from '../components/ReorderableList';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { GroupDropTarget } from '../components/GroupDropTarget';
import {
  FabDropZone,
  FabDropZoneProvider,
  useFabIntentChannel,
  useFabIntentSelector,
  type FabDropZonesHandle,
  type FabIntentChannel,
} from '../components/FabDropZones';
import {
  categoriesByIndex,
  type DragScroller,
  type DropZone,
  type FabDropIntent,
} from '../utils/fabDrop';
import { SortableList } from '../components/SortableList';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import { QuickSearchModal } from '../components/QuickSearchModal';
import type { TaskKind } from '../utils/taskKinds';
import { TemplatePickerSheet } from '../components/TemplatePickerSheet';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { SortFilterSheet } from '../components/SortFilterSheet';
import { TodayOptionsMenu } from '../components/TodayOptionsMenu';
import { CategoryOrderSheet } from '../components/CategoryOrderSheet';
import { DeloadSheet } from '../components/DeloadSheet';
import { ProjectPullSheet } from '../components/ProjectPullSheet';
import { ProjectNudgeBanner } from '../components/ProjectNudgeBanner';
import { findProjectStalls } from '../utils/projectPull';
import { useProjectStore } from '../store/useProjectStore';
import { TodayMealPlanSection } from '../components/TodayMealPlanSection';
import { TodayMealStrip } from '../components/TodayMealStrip';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { selectTodayMealEntries, recipeIndex, uncookedEntries } from '../utils/mealPlan';
import { dayKeyOf } from '../utils/dateUtils';
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
import { CompletionCollapse } from '../components/CompletionCollapse';
import { NewTasksBanner } from '../components/NewTasksBanner';
import { CategoryFocusBanner } from '../components/CategoryFocusBanner';
import { PressableScale } from '../components/PressableScale';
import { AddTaskFab, type AddTaskType } from '../components/AddTaskFab';
import { type FabDragHandlers } from '../components/Fab';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { emitNowTick } from '../utils/nowTick';
import { sumEstimatedMinutes, formatDuration } from '../utils/effort';

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

// Task budgets for the Later list (see the laterTaskLimit block below for why
// it has one at all). INITIAL is about a screenful — it's what the tap into
// Later has to mount before anything paints; SETTLED is topped up once that
// commit is done, and PAGE_SIZE is what each scroll to the bottom adds.
const LATER_INITIAL_TASK_LIMIT = 15;
const LATER_SETTLED_TASK_LIMIT = 60;
const LATER_TASK_PAGE_SIZE = 60;

/** A parent's subtasks plus their done tally — see subtasksByParent. */
interface SubtaskEntry {
  items: Task[];
  doneCount: number;
}

// One shared entry for every childless row, which is the common case. A
// `?? { items: [], doneCount: 0 }` at the call site would allocate a fresh
// array per row per render and defeat TaskItem's shallow compare precisely
// where the memo matters most — on the rows that have nothing to say.
const NO_SUBTASKS: SubtaskEntry = { items: [], doneCount: 0 };

// Same idea for a header with no rows of its own to leave alongside (see
// sectionTaskIds): one shared empty array rather than a fresh one per render.
const NO_SECTION_TASKS: string[] = [];

// Same idea again for a stack with no children (or none matching the current
// filter/section) — TaskGroupHeader's `allChildren` prop, so a fresh `[]`
// here would be exactly the identity churn NO_SUBTASKS above exists to avoid.
const NO_GROUP_CHILDREN: Task[] = [];

// The add button's drop target for "create this already pinned". A module
// constant so its identity is stable across renders — FabDropZone keys zones by
// value but re-registers the payload every render, and the pinned block is one
// zone rather than one per row.
const PINNED_DROP_ZONE = { kind: 'pinned', key: '__pinned-header__' } as const;

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
  onLongPress,
  focused,
  count,
}: {
  label: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  collapsed?: boolean;
  onToggle?: () => void;
  onLongPress?: () => void;
  focused?: boolean;
  count?: number;
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
      onLongPress={onLongPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
      accessibilityHint={onLongPress ? `Double tap and hold to ${focused ? 'stop focusing on' : 'focus on'} ${label}` : undefined}
    >
      <View style={styles.categorySectionHeaderLeft}>
        {focused && <Ionicons name="locate" size={13} color={colors.accent} />}
        <Text style={styles.sectionHeaderText}>
          {label}
          {collapsed && count !== undefined ? ` (${count})` : ''}
        </Text>
        <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={13} color={colors.textTertiary} />
      </View>
      {scrim}
    </TouchableOpacity>
  );
}

// The two readers of the add button's drag target. Both exist as components
// purely so a target change re-renders them and nothing else — reading the
// intent as screen state re-ran every row's renderItem on each crossing, which
// is what made the drag stutter as it passed over tasks. Children arrive as an
// untouched prop, so the row underneath doesn't re-render with the wrapper.

// A stack row, lit by either drag that can land in it: an existing task dragged
// onto it (`active`), or the add button aimed at it.
function GroupDropTargetRow({
  channel,
  groupId,
  active,
  children,
}: {
  channel: FabIntentChannel;
  groupId: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const aimed = useFabIntentSelector(
    channel,
    intent => intent?.kind === 'joinGroup' && intent.groupId === groupId,
  );
  return <GroupDropTarget active={active || aimed}>{children}</GroupDropTarget>;
}

// The add button, naming what a release right now would do.
function AddTaskFabWithDropLabel({
  channel,
  categories,
  ...props
}: {
  channel: FabIntentChannel;
  categories: Category[];
} & Omit<React.ComponentProps<typeof AddTaskFab>, 'dragLabel'>) {
  const label = useFabIntentSelector(channel, intent => {
    switch (intent?.kind) {
      case 'cancel': return 'Cancel';
      case 'joinGroup': return `Add to ${intent.groupTitle.trim() || 'stack'}`;
      case 'pin': return 'New pinned task';
      case 'insert':
        return intent.category
          ? `New task in ${categoryLabel(intent.category, categories)}`
          : 'New task here';
      default: return null;
    }
  });
  return <AddTaskFab {...props} dragLabel={label} />;
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

// Collapsible reveal for tasks that aren't due yet today — a time segment or
// window that hasn't opened, or a daily target you're keeping up with (which
// is also how a unit gets logged at a moment nothing asked for it: the rows
// here keep their meters, and one tap logs without sending the row anywhere).
// Mirrors ExpiredSection below: collapsed and deemphasized by default, expands
// in place to show the tasks, sub-grouped by time segment
// (Morning/Afternoon/Evening) the same way the Later screen sub-groups by
// segment within a day. A target has no segment, so it sits in the headerless
// bucket at the end.
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
              <SpotlightScrim />
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
  const deferredTasks = useTaskStore(useShallow(s => s.deferredTasks()));
  const unscheduledTasks = useTaskStore(useShallow(s => s.unscheduledTasks()));
  const expiredTasks = useTaskStore(useShallow(s => s.expiredTasks()));
  const vacationHiddenTasks = useTaskStore(useShallow(s => s.vacationHiddenTasks()));
  const upcomingTodayTasks = useTaskStore(useShallow(s => s.upcomingTodayTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const isEmptyDatabase = allTasks.length === 0;
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const updateTask = useTaskStore(s => s.updateTask);
  const clearAllPins = useTaskStore(s => s.clearAllPins);
  const reorderPinnedTasks = useTaskStore(s => s.reorderPinnedTasks);
  const reorderTasks = useTaskStore(s => s.reorderTasks);
  const reorderWithCategoryUpdates = useTaskStore(s => s.reorderWithCategoryUpdates);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkTogglePin = useTaskStore(s => s.bulkTogglePin);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const addCategory = useTaskStore(s => s.addCategory);
  const markTasksSeen = useTaskStore(s => s.markTasksSeen);
  const markTaskSeen = useTaskStore(s => s.markTaskSeen);
  const taskGroups = useTaskGroupStore(useShallow(s => s.groups));
  const setGroupCollapsed = useTaskGroupStore(s => s.setGroupCollapsed);
  const updateGroup = useTaskGroupStore(s => s.updateGroup);
  const createTaskGroup = useTaskGroupStore(s => s.createGroup);
  const removeGroupRow = useTaskGroupStore(s => s.removeGroupRow);
  const completeGroup = useTaskStore(s => s.completeGroup);
  const deferGroup = useTaskStore(s => s.deferGroup);
  const groupRosterOf = useTaskStore(s => s.groupRosterOf);
  const groupTasks = useTaskStore(s => s.groupTasks);
  const reorderGroupChildren = useTaskStore(s => s.reorderGroupChildren);
  const addExistingToGroup = useTaskStore(s => s.addExistingToGroup);
  const removeFromGroup = useTaskStore(s => s.removeFromGroup);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [quickAddType, setQuickAddType] = useState<TaskKind>('task');
  const [flashTaskId, setFlashTaskId] = useState<string | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A row a jump is on its way to, held as state rather than scrolled straight
  // from the tap: the jump can expand a section in the same batch, and the
  // scroll has to happen against the list that expansion produced, not the one
  // the tap was made on. The counter makes a repeat tap on the same row a new
  // value, so it fires again instead of being deduped away.
  const [pendingJump, setPendingJump] = useState<{ key: string; n: number } | null>(null);
  const jumpCount = useRef(0);
  const [autoCompletingIds, setAutoCompletingIds] = useState<Set<string>>(new Set());
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [pullingToSearch, setPullingToSearch] = useState(false);
  const [quickSearchVisible, setQuickSearchVisible] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [categoryOrderVisible, setCategoryOrderVisible] = useState(false);
  const [deloadVisible, setDeloadVisible] = useState(false);
  const [suggestedPinsVisible, setSuggestedPinsVisible] = useState(false);
  const [pullVisible, setPullVisible] = useState(false);
  // undefined = unscoped (opened from the "…" menu's "Pull from projects");
  // set = opened from the quiet-project nudge, restricted to those projects.
  const [pullScopeProjectIds, setPullScopeProjectIds] = useState<string[] | undefined>(undefined);
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
  // One per view mode: only ever one of these lists is mounted at a time, but
  // each needs its own ref and its own record of where it last settled.
  const unscheduledScroll = useKeyboardInsetScroll<FlatList>();
  const inboxScroll = useKeyboardInsetScroll<FlatList>();
  // Extra bottom padding so the last rows aren't hidden behind the floating BulkActionBar.
  const selectionListPadding = selectionMode ? tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm : undefined;
  // "Hide everything but the pins", toggled by the eye in the pinned header.
  // Off by default and session-only, like collapsedCategories: the pinned block
  // is additive now — pinning shows you a copy at the top, it doesn't take the
  // rest of the day away — so hiding is something you ask for, once, when you
  // want it. The previous design had this the other way round ("Everything
  // else" arrived collapsed) and that's the half people turned the feature off
  // over.
  const [othersHidden, setOthersHidden] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  // Session-only, like collapsedCategories: "show only this category's tasks,
  // hide the rest of Today" — a stronger filter than collapse, toggled from a
  // category header's long-press. Resets on unmount/view-mode switch, never
  // persisted; see toggleCategoryFocus and applyCategoryFocusTo.
  const [focusedCategory, setFocusedCategory] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [groupEditorVisible, setGroupEditorVisible] = useState(false);
  // Set while editingGroup is a stack freshly created from the add menu —
  // discarded on close if it was never given a title.
  const newStackIdRef = useRef<string | null>(null);
  // Two-step "add from a template" flow off the add menu: pick a template,
  // then the apply sheet takes over for anchors and the item checklist.
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false);
  const [applyTemplate, setApplyTemplate] = useState<TaskTemplate | null>(null);

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

  // The "Add Task" Home Screen quick action (openQuickAddFromShortcut() in
  // navigationRef.ts) rides the same params object, stamped with its own
  // fresh timestamp. An effect rather than the during-render handling above:
  // there's no wrong-sub-view frame to avoid here, just a sheet appearing a
  // frame after the tab does, which isn't visible.
  const [handledOpenQuickAdd, setHandledOpenQuickAdd] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openQuickAdd === undefined || route.params.openQuickAdd === handledOpenQuickAdd) return;
    setHandledOpenQuickAdd(route.params.openQuickAdd);
    setQuickAddType('task');
    setQuickAddVisible(true);
  }, [route.params?.openQuickAdd, handledOpenQuickAdd]);

  // Claims completions queued by the Today widget's checkbox and by Live
  // Activity's Done button (see useWidgetCompletionStore / widgetSync.ts).
  // Handing a pending id off to a TaskItem via autoComplete triggers the real
  // tap-to-complete animation there — completeTask() itself is only called
  // once that animation finishes, not here — so dequeue right away to avoid
  // re-triggering it on a later render. A task that's already gone
  // (completed/deleted elsewhere in the meantime) is just dropped.
  //
  // resetToToday() (widgetSync.ts) always switches this screen to the
  // 'today' sub-view, so a TaskItem row only actually mounts here for tasks
  // isTaskVisible() would place in Today — the Today widget only ever lists
  // those, so its checkbox is always safe. A Live Activity, though, can be
  // started from any task with a link regardless of where it's scheduled
  // (Later, Unscheduled, Inbox); for those, no row is ever mounted to catch
  // the autoComplete prop, so the animated path would silently drop the
  // completion. Call completeTask() directly instead for anything that
  // wouldn't land in Today.
  const widgetCompletionIds = useWidgetCompletionStore(useShallow(s => s.pendingIds));
  const dequeueWidgetCompletion = useWidgetCompletionStore(s => s.dequeue);
  useEffect(() => {
    if (widgetCompletionIds.length === 0) return;
    widgetCompletionIds.forEach(id => {
      dequeueWidgetCompletion(id);
      const task = allTasks.find(t => t.id === id);
      if (!task || task.completed) return;
      if (!isTaskVisible(task)) {
        useTaskStore.getState().completeTask(id);
        return;
      }
      setAutoCompletingIds(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
    });
  }, [widgetCompletionIds]);

  // Briefly flags a task so its row tints — used to point at a task that was
  // just created, and at one jumped to from the new-todos banner. Cleared once
  // the animation has had time to finish.
  const flashTask = (taskId: string) => {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    setFlashTaskId(taskId);
    flashTimeoutRef.current = setTimeout(() => setFlashTaskId(null), 1200);
  };

  // Switch to whichever sub-view the new task actually landed in, so it's never
  // created into a view that can't show it. A quick-add with no organizing
  // metadata at all is an Inbox task, whichever view it was added from.
  const handleTaskCreated = (task: Task, placed = false) => {
    // A drag of the add button chose where this goes; a plain tap didn't, and
    // shaking the chip off in the sheet takes the choice back.
    const dropped = pendingDropRef.current;
    pendingDropRef.current = null;

    const destination: ViewMode = isInboxTask(task)
      ? 'inbox'
      : isTaskVisible(task) ? 'today'
      : isUnscheduledTask(task) ? 'unscheduled'
      : 'later';
    // Position it only if it actually landed in the list it was dropped on: the
    // sheet can push a task out of Today entirely (a defer date, no date at
    // all), and then the spot it was dropped at isn't somewhere it can go.
    if (placed && destination === 'today' && dropped?.kind === 'insert') {
      placeCreatedTask(task, dropped);
    }
    if (destination !== viewMode) setViewMode(destination);
    flashTask(task.id);
  };

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
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
          useTaskStore.getState().rolloverQuotas();
          // Opt-in counterpart to rolloverQuotas, for allowOvershoot tasks —
          // see its doc comment in useTaskStore.ts.
          useTaskStore.getState().sweepOvershootQuotas();
          // After rolloverQuotas/sweepOvershootQuotas: either can complete and
          // spawn members, which changes what a project counts as scheduled.
          useTaskStore.getState().dripStalledProjects();
          forceRefresh(n => n + 1);
          // The rows are memoized, so re-rendering this screen no longer
          // re-renders them. Their clock-derived text (deadline countdowns,
          // "N left") needs its own nudge, or it would sit showing the
          // pre-background value until the next 30s tick came round.
          emitNowTick();
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

  // Pinning no longer moves anything: the task keeps its row where it is and a
  // copy appears in the pinned block above the list. Nothing shifts under the
  // finger, so a run of pins needs no settle delay and the list needs no second
  // layout to swap into. The ~110 lines of grace machinery that used to live
  // here — a 3s ceiling timer, five "the run is over" interaction signals, a
  // render-time prevPinnedCount check to kill a one-frame flash, and a
  // todayDragging hold so the two list components couldn't swap mid-gesture —
  // all existed to serve that reshuffle and went with it. Don't reintroduce
  // them: they are the cost of lifting rows out, and nothing lifts rows out now.

  const handleSuggestedPins = (ids: string[]) => {
    for (const id of ids) updateTask(id, { pinned: true });
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

  /**
   * Long-press a category header to show only that category's tasks on
   * Today; long-press the focused one again (or the clear banner) to go back
   * to normal. A category that's collapsed loses its collapse when focused —
   * otherwise focusing it would show its header over an empty section.
   */
  const toggleCategoryFocus = (label: string) => {
    if (expandedTaskId !== null) {
      setExpandedTaskId(null);
      return;
    }
    haptics.tap();
    animateLayout();
    const next = focusedCategory === label ? null : label;
    setFocusedCategory(next);
    if (next && collapsedCategories.has(label)) {
      setCollapsedCategories(prev => {
        const nextCollapsed = new Set(prev);
        nextCollapsed.delete(label);
        return nextCollapsed;
      });
    }
  };

  // Sort & filter state. Persisted, like hideCategories below — the three are
  // set from the same sheet, and only one of them used to survive a launch.
  const sort = useSettingsStore(s => s.sortOption);
  const setSort = useSettingsStore(s => s.setSortOption);
  const filterPriorities = useSettingsStore(useShallow(s => s.filterPriorities));
  const setFilterPriorities = useSettingsStore(s => s.setFilterPriorities);
  const filterEfforts = useSettingsStore(useShallow(s => s.filterEfforts));
  const setFilterEfforts = useSettingsStore(s => s.setFilterEfforts);
  const hideCategories = useSettingsStore(s => s.hideCategories);
  const setHideCategories = useSettingsStore(s => s.setHideCategories);
  const projects = useProjectStore(useShallow(s => s.projects));
  const projectNudgeDismissedAt = useSettingsStore(s => s.projectNudgeDismissedAt);
  const setProjectNudgeDismissedAt = useSettingsStore(s => s.setProjectNudgeDismissedAt);

  const activeFilterCount =
    (sort !== 'default' ? 1 : 0) + filterPriorities.length + filterEfforts.length;
  // Only priority/effort filters narrow which tasks render — sort just
  // reorders them — so only those should suppress a stack's "N/M" tally (see
  // the filtered prop on TaskGroupHeader). Later Today and Inbox groups don't
  // go through this filter at all (deferredTasks/inboxTasks are unfiltered),
  // so this only applies to the main Today list's group rows below.
  const groupTallyFiltered = filterPriorities.length > 0 || filterEfforts.length > 0;

  // Today stays current on its own (see the tick effect above), so pulling
  // down doesn't refresh anything — it opens quick search. It used to open
  // quick add, but the FAB and its add menu already cover adding; searching
  // had no gesture of its own.
  const handlePullToSearch = useCallback(() => {
    setPullingToSearch(true);
    haptics.impactLight();
    setQuickSearchVisible(true);
    setPullingToSearch(false);
  }, []);

  // Anything the card's five slots couldn't answer goes to the real Search
  // screen, carrying the query so it isn't typed twice.
  const handleOpenFullSearch = useCallback((query: string) => {
    navigation.navigate({ name: 'Search', params: { query, at: Date.now() } } as never);
  }, [navigation]);

  const openEditor = (task?: Task) => {
    setEditingTask(task ?? null);
    setEditorInitialDraft(null);
    setEditorVisible(true);
  };

  // The row handlers below are shared verbatim by all five TaskItem call sites
  // in this file and are deliberately stable across renders: TaskItem is
  // memoized, and a fresh arrow per row per render defeats its shallow compare
  // silently — the list still works, it just goes back to re-rendering every
  // row on every store mutation. Each takes the row's own id (see TaskItem's
  // Props) so one callback serves the whole list rather than one closure per
  // row, which is what lets the identity be stable at all.
  //
  // Empty deps throughout, and each is written so that's provably safe: the
  // expand toggle reaches state only through the functional form of setState,
  // and the editor resolves its task from the store at call time instead of
  // capturing it. Neither can read a stale value from its frozen closure.
  const handleRowPress = useCallback((id: string) => {
    setExpandedTaskId(prev => {
      // A tap landing while a *different* row is spotlighted just dismisses
      // that one, rather than expanding the row that was tapped.
      if (prev !== null && prev !== id) return null;
      return prev === id ? null : id;
    });
  }, []);

  const handleRowEdit = useCallback((id: string) => {
    setEditingTask(useTaskStore.getState().tasks.find(t => t.id === id) ?? null);
    setEditorInitialDraft(null);
    setEditorVisible(true);
  }, []);

  const handleRowSwipeSelect = useCallback((id: string) => {
    setExpandedTaskId(null);
    enterSelectionMode(id);
  }, [enterSelectionMode]);

  // Read off the store rather than closed over, so these stay referentially
  // stable and TaskItem's memo keeps holding — the same reason every other row
  // handler here takes an id instead of being made per row.
  const handleApplyImport = useCallback((id: string) => {
    useTaskStore.getState().applyPendingImport(id);
  }, []);

  const handleDismissImport = useCallback((id: string) => {
    useTaskStore.getState().dismissPendingImport(id);
  }, []);

  const handleQuickAddOpenFull = (draft: TaskDraft) => {
    // The draft carries everything the sheet had, including the seeded
    // category; only the placement is let go of, and the editor has no notion
    // of one anyway.
    closeQuickAdd();
    setEditingTask(null);
    setEditorInitialDraft(draft);
    setEditorVisible(true);
  };

  const handleAddMenuSelect = (type: AddTaskType) => {
    switch (type) {
      case 'task':
        setQuickAddType('task');
        setQuickAddVisible(true);
        break;
      case 'template':
        setTemplatePickerVisible(true);
        break;
      // Quick add builds a chain end to end now, so this no longer has to
      // open the full editor just to reach a step list.
      case 'chain':
        setQuickAddType('chain');
        setQuickAddVisible(true);
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

  // The pinned block is not in here: it renders above the list as its own
  // header (see pinnedBlock), and a pinned task keeps its ordinary row in this
  // data as well. Two rows for one task, which is the point — pinning now adds
  // a copy at the top rather than moving the original.
  type ListItem =
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
    // Sorted, not left in store order: `tasks` is only sort_order-ordered as it
    // comes out of SQLite at startup, and every mutation after that patches
    // rows in place without moving them. Reordering a stack's children writes
    // sortOrder and nothing else, so without this the drag committed and the
    // list carried on showing the order it had before — a drag that looked
    // like it did nothing at all. (groupChildrenOf sorts for the same reason.)
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [allTasks]);

  // Groups with at least one currently-visible child, each paired with just
  // that visible-and-filtered subset — a group with nothing left to show
  // simply doesn't render, same as an empty category would. Only the default
  // Today view groups/collapses.
  //
  // Having a visible child is the *whole* condition, which is what makes a
  // finished stack leave in the same commit its last row does rather than a
  // beat later: `filtered` comes from visibleTasks, so a just-ticked row is
  // still in it for the completion hold (see completionHoldIds), and the
  // header rides that window out with it. A stack used to stay behind here
  // reading "all 6 done for today" until it was tapped to dismiss; that tap
  // is gone along with the stamp it wrote (see isDismissedToday's note).
  // Nothing has to expire either — tomorrow's occurrences are visible tasks
  // again, so the stack comes back on its own.
  const visibleGroupItems = useMemo(() => {
    const filteredIds = new Set(filtered.map(t => t.id));
    return taskGroups
      .map(group => ({
        group,
        children: (childrenByGroupId.get(group.id) ?? []).filter(t => filteredIds.has(t.id)),
      }))
      .filter(g => g.children.length > 0);
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
  // out in the Inbox's own sortOrder.
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
  const laterTodaySections = useMemo(
    (): LaterTodaySectionData[] => computeLaterTodaySections(upcomingUngroupedTasks, laterGroupItems),
    [upcomingUngroupedTasks, laterGroupItems],
  );

  // Hide task/group rows under a collapsed category header, leaving the
  // header itself in place so it stays tappable to re-expand. The "Later
  // Today" header is a time section, not a category, so it's never
  // collapsible.
  const applyCategoryCollapse = (items: ListItem[]): ListItem[] =>
    applyCategoryCollapseTo(items, collapsedCategories) as unknown as ListItem[];

  // When the "Hide categories" display option is on, drop every category
  // header (but keep the "Later Today" time-section header) so the list
  // reads as one flat run of tasks/groups instead of category sections.
  const stripCategoryHeaders = (items: ListItem[]): ListItem[] =>
    hideCategories
      ? items.filter(item => item.type !== 'header' || item.label === LATER_TODAY_LABEL)
      : items;

  // Every row the current layout *has*, before anything the user has folded
  // away is dropped. `data` below is this narrowed to what's on screen; this
  // is what a jump searches, so a task inside a collapsed section can still be
  // found and the section it's in opened (see jumpToTask).
  const listItems: ListItem[] = useMemo(() => {
    // Pinned tasks are deliberately NOT filtered out. They keep their row in
    // their own category section — the pinned block above the list is a second
    // copy, not a relocation — which is what stops the list reflowing when one
    // is pinned, and what lets stacks keep working while pins exist (the old
    // pinned layout dropped visibleGroupItems on the floor and flattened them).
    const ungrouped = filtered.filter(t => !t.groupId);
    // Stacks slot into the task order by sortOrder (see makeCategoryGroups) —
    // but only while the list is in its hand-ordered state. Any other sort
    // reorders the tasks by something sortOrder says nothing about, so the
    // stacks go back to heading their section.
    return makeCategoryGroups(ungrouped, allCategories, visibleGroupItems, {
      interleaveGroups: sort === 'default',
    });
  }, [filtered, allCategories, visibleGroupItems, sort]);

  // Whether anything other than the pinned block is on screen. Focus wins over
  // the hide for the reason spelled out in `data` below.
  const restVisible = !othersHidden || !!focusedCategory;

  const data: ListItem[] = useMemo(() => {
    // "Hide everything else" empties the list rather than collapsing a section
    // inside it: what's hidden is every category section at once, and the
    // pinned block that stays behind isn't in this data to begin with. Focused
    // on a category, the hide is ignored — the focus filter is about to narrow
    // to that one section, and hiding it too would leave nothing at all.
    if (!restVisible) return [];
    return stripCategoryHeaders(
      applyCategoryFocusTo(applyCategoryCollapse(listItems), focusedCategory) as unknown as ListItem[],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listItems, restVisible, collapsedCategories, hideCategories, focusedCategory]);

  const listItemKey = (item: ListItem): string =>
    item.type === 'header' ? `h-${item.label}`
    : item.type === 'group' ? `g-${item.group.id}`
    : item.task.id;

  // Set by Today's one list. There used to be two — a plain FlatList swapped
  // in whenever anything was pinned — and the swap is gone with the lift-out.
  const todayRowScroller = useRef<RowScroller | null>(null);

  // The scroll half of a jump (see jumpToTask). In an effect so it runs
  // against the committed list: expanding a section and asking for the jump
  // land in the same batch, and `data` here is the list that batch produced.
  // Deps are the request alone — it's cleared on arrival, so there's no second
  // run to read a later `data` from.
  useEffect(() => {
    if (!pendingJump) return;
    setPendingJump(null);
    todayRowScroller.current?.scrollToKey(pendingJump.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump]);

  // What each section header needs to know to leave with its rows when the last
  // of them is ticked off (see CompletionCollapse). Built from `data` — the list
  // as rendered — so a header whose rows a collapsed category has folded away
  // isn't told they're all leaving.
  const sectionTaskIds = useMemo(() => computeSectionTaskIds(data), [data]);

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

  // ——— Dragging the add button into the list ———————————————————————————
  //
  // Pulling the button off its corner and dropping it on the list creates the
  // task where it lands: in a category section, into a stack, at a spot between
  // two rows, or pinned. The button reports raw pointer positions and
  // FabDropZoneProvider turns those into an intent; everything below is about
  // what each intent means here.

  const dropZonesRef = useRef<FabDropZonesHandle>(null);
  const [fabDragging, setFabDragging] = useState(false);
  // The list the drag scrolls when it reaches the top or bottom of the screen.
  // One list now, so one control: the ReorderableList hands its own over.
  const todayScrollControl = useRef<DragScroller | null>(null);
  // What the drag is currently aimed at goes through a channel rather than
  // state: it changes as the finger crosses each row, and re-rendering this
  // screen re-runs every row's renderItem. The two things that do change with
  // it — the label on the button, the highlight on a stack — subscribe.
  const fabIntentChannel = useFabIntentChannel();
  const [quickAddSeed, setQuickAddSeed] = useState<
    { category?: string | null; groupId?: string; pinned?: boolean } | undefined
  >(undefined);
  const [quickAddSeedLabel, setQuickAddSeedLabel] = useState<string | null>(null);
  // The drop that opened the sheet, read once when the task comes back.
  const pendingDropRef = useRef<FabDropIntent | null>(null);

  /**
   * Close the quick-add sheet and forget what this opening of it was set up
   * for. Every path out of the sheet goes through here — cancel, create, and
   * "More details", which closes it without going through onClose. Missing one
   * leaves the placement armed, and the next plain tap on the button inherits
   * it: a task filed into a stack, or pinned, because of a drag two minutes
   * ago that landed somewhere else entirely.
   */
  const closeQuickAdd = () => {
    setQuickAddVisible(false);
    setQuickAddSeed(undefined);
    setQuickAddSeedLabel(null);
    setQuickAddType('task');
    pendingDropRef.current = null;
  };

  // One list now, so one source of zones. The pinned block isn't in this data
  // (it's the list's header) and registers its own 'pinned' zone directly —
  // see PINNED_DROP_ZONE where the block is rendered.
  const todayListData = draggableData;
  const zoneByKey = useMemo(() => {
    const categoriesFor = categoriesByIndex(
      todayListData.map(item =>
        item.type === 'header' && item.label !== LATER_TODAY_LABEL ? item.label : null,
      ),
    );
    const map = new Map<string, DropZone>();
    todayListData.forEach((item, i) => {
      const key = listItemKey(item);
      const category = categoriesFor[i] ?? null;
      switch (item.type) {
        case 'header':
          // "Later Today" is a time section, not a category — there's nothing
          // for a drop to inherit from it.
          map.set(key, item.label === LATER_TODAY_LABEL
            ? { kind: 'rest', key }
            : { kind: 'header', key, category: item.label });
          break;
        case 'group':
          map.set(key, {
            kind: 'group', key, groupId: item.group.id, groupTitle: item.group.title, category,
          });
          break;
        case 'task':
          map.set(key, { kind: 'task', key, category });
          break;
      }
    });
    return map;
  }, [todayListData]);

  /**
   * Give the freshly created task the position it was dropped at.
   *
   * Deliberately the same placement pass a finished row drag runs: splicing the
   * new row into the list at the drop point and handing the result to
   * resolveDrop means the category-from-nearest-header rule and the sortOrder
   * renumber are the ones already in use, not a second implementation of them.
   */
  const placeCreatedTask = (task: Task, intent: Extract<FabDropIntent, { kind: 'insert' }>) => {
    // The category the sheet actually committed wins: changing it there means
    // the row belongs in that section, wherever the button happened to land.
    if ((task.category ?? null) !== intent.category) return;
    const anchor = draggableData.findIndex(item => listItemKey(item) === intent.anchorKey);
    if (anchor < 0) return;

    const spliced = [...draggableData];
    spliced.splice(intent.before ? anchor : anchor + 1, 0, { type: 'task', task });
    const dropped = spliced.filter(
      (item): item is CategoryListItem =>
        item.type === 'header' || item.type === 'task' || item.type === 'group',
    );
    const { taskOrders, categoryUpdates, groupUpdates, settled } = resolveDrop(dropped, {
      isUpcoming: id => upcomingTaskIds.has(id),
      showUpcoming,
      categoryOrder: allCategories,
    });
    setDraggableData(settled);
    groupUpdates.forEach(u => updateGroup(u.id, { category: u.category, sortOrder: u.sortOrder }));
    // No "this task or this and future occurrences?" prompt, unlike the drag
    // path: a task created a moment ago has no other occurrences to apply to.
    reorderWithCategoryUpdates(taskOrders, categoryUpdates);
  };

  const openQuickAddForDrop = (intent: FabDropIntent) => {
    // Dropped back on the button: the drag is the whole of what happened, so
    // no sheet, and nothing left armed for the next tap (see closeQuickAdd).
    if (intent.kind === 'cancel') {
      pendingDropRef.current = null;
      haptics.tap();
      return;
    }
    pendingDropRef.current = intent;
    switch (intent.kind) {
      case 'joinGroup':
        // Inheriting the stack's category matches what joining one by dragging
        // an existing task does (addExistingToGroup).
        setQuickAddSeed({ groupId: intent.groupId, category: intent.category });
        setQuickAddSeedLabel(intent.groupTitle.trim() || 'Stack');
        break;
      case 'pin':
        setQuickAddSeed({ pinned: true });
        setQuickAddSeedLabel('Pinned');
        break;
      case 'insert':
        setQuickAddSeed({ category: intent.category });
        setQuickAddSeedLabel(
          intent.category ? categoryLabel(intent.category, categories) : 'This spot',
        );
        break;
      case 'plain':
        setQuickAddSeed(undefined);
        setQuickAddSeedLabel(null);
        break;
    }
    setQuickAddVisible(true);
  };

  // Rebuilt each render so it closes over fresh state; the button reads it
  // through a ref, and its responder is built once regardless.
  const fabDrag: FabDragHandlers = {
    onStart: () => {
      setExpandedTaskId(null);
      setFabDragging(true);
      dropZonesRef.current?.begin();
    },
    onMove: (pageY, home) => dropZonesRef.current?.moveTo(pageY, home),
    onEnd: (pageY, home) => {
      setFabDragging(false);
      // end()/cancel() publish a null intent themselves, which is what clears
      // the label and any lit stack.
      openQuickAddForDrop(dropZonesRef.current?.end(pageY, home) ?? { kind: 'plain' });
    },
    onCancel: () => {
      setFabDragging(false);
      dropZonesRef.current?.cancel();
    },
  };

  // Set while a group header's drag() is in flight — lets the group's own
  // children collapse for the duration of the drag (rendered check further
  // down) without touching the rest of the category. Cleared in the outer
  // ReorderableList's onDragEnd.
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  // A stack's children are reordered by a nested SortableList, whose responder
  // sits *inside* this screen's list rather than around it — so the list has to
  // be told to stop scrolling for the drag to survive the first finger move
  // (see SortableList's onDragStateChange).
  const [draggingStackChild, setDraggingStackChild] = useState(false);
  // Same deal for the pinned block's own SortableList, which sits in the list's
  // header — inside the scroll view, so the scroll has to stand down for it too.
  const [draggingPin, setDraggingPin] = useState(false);
  // Same deal one level down: a drag of the inline subtask list inside an
  // expanded row (see TaskItem.onSubtaskDragStateChange).
  const [draggingSubtask, setDraggingSubtask] = useState(false);
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

  // Keyed by parent id, carrying the done tally alongside the rows so the
  // per-row `subs.filter(t => t.completed).length` that used to run on every
  // render of every row happens once per parent per change instead.
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, SubtaskEntry>();
    for (const t of allTasks) {
      if (!t.parentId) continue;
      const entry = map.get(t.parentId);
      if (entry) entry.items.push(t);
      else map.set(t.parentId, { items: [t], doneCount: 0 });
    }
    for (const entry of map.values()) {
      entry.doneCount = entry.items.filter(t => t.completed).length;
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
  // Id-bound like handleRowPress/handleRowEdit above, and for the same
  // reason: TaskGroupHeader takes the group's own id back rather than a
  // closure capturing it, so this one useCallback serves every stack header
  // instead of a fresh arrow per group per render.
  const handleGroupSwipeSelect = useCallback((groupId: string) => {
    const ids = groupRosterOf(groupId).filter(t => !t.completed).map(t => t.id);
    if (ids.length === 0) return;
    setExpandedTaskId(null);
    enterSelectionMode(ids);
  }, [groupRosterOf, enterSelectionMode]);

  const handleGroupComplete = useCallback((groupId: string) => completeGroup(groupId), [completeGroup]);
  const handleGroupDefer = useCallback((groupId: string, date: Date) => deferGroup(groupId, date), [deferGroup]);
  const handleGroupPressEdit = useCallback((groupId: string) => {
    const group = useTaskGroupStore.getState().getGroupById(groupId);
    if (!group) return;
    setEditingGroup(group);
    setGroupEditorVisible(true);
  }, []);

  // The TaskGroupHeader callbacks below are identical across every place a
  // stack header renders (main list, Later Today, Inbox) — only
  // onToggleCollapse differs per site, so it stays out of this helper. Each
  // is one of the stable, id-bound handlers above, so spreading this object
  // (itself recreated every render) still hands TaskGroupHeader the same
  // four function identities call to call.
  const groupHeaderProps = {
    onComplete: handleGroupComplete,
    onDefer: handleGroupDefer,
    onSwipeSelect: handleGroupSwipeSelect,
    onPressEdit: handleGroupPressEdit,
  };

  // Shared by the plain 'task' row case and a group's expanded children —
  // group children are full TaskItem rows with every normal capability
  // (checkbox, swipe actions, timer, expand-for-notes, individual skip). A
  // group child's drag is driven by the nested SortableList in the 'group'
  // render branch below (reorder within the group / drag out to remove),
  // entirely separate from the outer ReorderableList's own drag machinery.
  const renderTaskRow = (
    task: Task,
    opts?: {
      drag?: (e?: GestureResponderEvent) => void;
      isActive?: boolean;
      indented?: boolean;
      showCategory?: boolean;
      /**
       * Which *row* this is, when one task has more than one on screen. A
       * pinned task renders twice — once in the pinned block, once in its own
       * category section — and the two expand independently, so the spotlight
       * is keyed on the row rather than on the task. Defaults to the task's own
       * id, which is what every single-row caller wants and what expandedTaskId
       * has always held.
       */
      rowKey?: string;
      duplicateRow?: boolean;
      hidesWhenOnPace?: boolean;
    },
  ) => {
    const subs = subtasksByParent.get(task.id) ?? NO_SUBTASKS;
    const rowKey = opts?.rowKey ?? task.id;
    return (
      <TaskItem
        task={task}
        indented={opts?.indented}
        showCategory={opts?.showCategory}
        duplicateRow={opts?.duplicateRow}
        // Unconditional, unlike showCategory: Today's sections *are* the
        // categories, so a category chip only earns its place on a row outside
        // them (the pinned section). Nothing on this screen says which project
        // a task came from, and a task dated here by a project nudge —
        // dripStalledProjects, which the user never saw run — is otherwise a
        // title with no explanation of where it came from.
        showProject
        onPress={() => handleRowPress(rowKey)}
        expanded={expandedTaskId === rowKey}
        spotlightDisabled={expandedTaskId !== null && expandedTaskId !== rowKey && !selectionMode}
        onEdit={handleRowEdit}
        subtaskCount={subs.items.length}
        subtaskDoneCount={subs.doneCount}
        subtasks={subs.items}
        onSubtaskDragStateChange={setDraggingSubtask}
        // The one prop here that isn't stable, and knowingly so: ReorderableList
        // builds a fresh `drag` per row on every render (it closes over the row
        // key to call startDrag), so a reorderable row re-renders with its list
        // the way it always has. Stabilising it means caching callbacks inside
        // ReorderableList, whose header is explicit that the PanResponder
        // lifecycle is not a safe thing to reach into — not worth it for this.
        //
        // It costs less than it looks: this is `undefined` throughout selection
        // mode, which is where the expensive case actually lives — a paint drag
        // mutates the selection on every frame, and with the memo only the rows
        // whose `selected` flipped re-render.
        drag={
          selectionMode || !opts?.drag || upcomingTaskIds.has(task.id) ? undefined : opts.drag
        }
        isActive={opts?.isActive}
        selectionMode={selectionMode}
        selected={selectedIds.has(task.id)}
        onSelect={toggleSelection}
        onSwipeSelect={handleRowSwipeSelect}
        hideTodayLabel
        highlighted={task.id === flashTaskId}
        autoComplete={autoCompletingIds.has(task.id)}
        // This list is `filtered`, i.e. visibleTasks — a row leaves it the
        // moment it stops being visible, which is what logging a unit does to
        // a daily target that's back on pace. The pinned block passes false:
        // pinnedTasks doesn't filter on visibility, so its copy stays whether
        // or not the task is due, and a row that isn't going anywhere
        // shouldn't play itself out.
        hidesWhenOnPace={opts?.hidesWhenOnPace ?? true}
      />
    );
  };

  const renderListItem = ({ item, drag, isActive }: { item: ListItem; drag?: () => void; isActive?: boolean }) => {
    // Headers sit in the same elevated list as task rows, above the spotlight
    // overlay, so each one draws its own scrim to dim in step with the rows.
    if (item.type === 'header') {
      // (Tapping it while a task is expanded still collapses the spotlight,
      // via the list wrapper's onTouchEnd.)
      const isCategory = item.label !== LATER_TODAY_LABEL;
      const sectionIds = sectionTaskIds.get(item.label) ?? NO_SECTION_TASKS;
      return (
        <CompletionCollapse taskIds={sectionIds}>
          <SectionHeader
            label={isCategory ? categoryLabel(item.label, categories) : item.label}
            styles={styles}
            colors={colors}
            collapsed={isCategory ? collapsedCategories.has(item.label) : undefined}
            onToggle={isCategory ? () => toggleCategoryCollapse(item.label) : undefined}
            onLongPress={isCategory ? () => toggleCategoryFocus(item.label) : undefined}
            focused={isCategory ? focusedCategory === item.label : undefined}
            count={isCategory ? sectionIds.length : undefined}
          />
        </CompletionCollapse>
      );
    }
    if (item.type === 'group') {
      const allChildren = childrenByGroupId.get(item.group.id) ?? NO_GROUP_CHILDREN;
      return (
        <GroupDropTargetRow
          channel={fabIntentChannel}
          groupId={item.group.id}
          active={joinGroupIntentId === item.group.id}
        >
          <TaskGroupTray>
            <TaskGroupHeader
              group={item.group}
              allChildren={allChildren}
              filtered={groupTallyFiltered}
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
              {...groupHeaderProps}
              onDrag={!selectionMode && drag ? () => startGroupDrag(item.group.id, drag) : undefined}
            />
            <TaskGroupBody
              expanded={!item.group.collapsed && draggingGroupId !== item.group.id}
              hasChildren={item.children.length > 0}
              // Lets the dragged child's floating card cross the tray's edge
              // on its way out of the stack instead of being clipped there.
              dragging={draggingStackChild}
            >
              <SortableList
                data={item.children}
                onReorder={reordered => reorderGroupChildren(item.group.id, reordered.map(t => t.id))}
                onDragOut={task => removeFromGroup(task.id)}
                onDragStateChange={setDraggingStackChild}
                // The same drop slot the main list leaves behind — a stack's
                // rows are the main list's rows, so the gap should read the same.
                placeholderStyle={styles.stackDropSlot}
                renderItem={(child, _displayIndex, childDrag, childIsActive) => (
                  <React.Fragment key={child.id}>
                    {renderTaskRow(child, {
                      indented: true,
                      isActive: childIsActive,
                      drag: selectionMode ? undefined : childDrag,
                    })}
                  </React.Fragment>
                )}
              />
            </TaskGroupBody>
          </TaskGroupTray>
        </GroupDropTargetRow>
      );
    }

    return renderTaskRow(item.task, { drag, isActive });
  };

  // Every row doubles as a target for the add button being dragged in. The
  // wrapper only measures — it adds no styling and claims no touches — so a row
  // behaves exactly as it did without one.
  const renderItem = (info: { item: ListItem; drag?: () => void; isActive?: boolean }) => {
    const content = renderListItem(info);
    if (content === null) return null;
    // ReorderableList re-renders the dragged row into its floating overlay;
    // that copy must not claim the real row's slot in the registry.
    const zone = info.isActive ? null : zoneByKey.get(listItemKey(info.item)) ?? null;
    return <FabDropZone zone={zone}>{content}</FabDropZone>;
  };

  // Revealed vacation-hidden tasks are peek-only: no drag, but they can still
  // be swiped into selection like any other row so they don't lose delete
  // capability now that per-row swipe-delete is gone.
  const renderHiddenTask = (task: Task, opts?: { indented?: boolean }) => {
    const subs = subtasksByParent.get(task.id) ?? NO_SUBTASKS;
    return (
      <TaskItem
        task={task}
        indented={opts?.indented}
        showCategory
        showProject
        onPress={handleRowPress}
        expanded={expandedTaskId === task.id}
        spotlightDisabled={expandedTaskId !== null && expandedTaskId !== task.id && !selectionMode}
        onEdit={handleRowEdit}
        subtaskCount={subs.items.length}
        subtaskDoneCount={subs.doneCount}
        subtasks={subs.items}
        onSubtaskDragStateChange={setDraggingSubtask}
        selectionMode={selectionMode}
        selected={selectedIds.has(task.id)}
        onSelect={toggleSelection}
        onSwipeSelect={handleRowSwipeSelect}
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
    const allChildren = childrenByGroupId.get(group.id) ?? NO_GROUP_CHILDREN;
    return (
      <TaskGroupTray>
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
          {...groupHeaderProps}
        />
        <TaskGroupBody expanded={!group.collapsed} hasChildren={children.length > 0}>
          {children.map(child => (
            <React.Fragment key={child.id}>{renderHiddenTask(child, { indented: true })}</React.Fragment>
          ))}
        </TaskGroupBody>
      </TaskGroupTray>
    );
  };

  // An Inbox row. Deliberately plainer than renderTaskRow: no category or
  // project chip and no "today" label, because an Inbox task has none of
  // that by definition (see isInboxTask), and no drag, since the Inbox list
  // doesn't reorder. Shared by the loose rows and a stack's children.
  const renderInboxTask = (task: Task, opts?: { indented?: boolean }) => {
    const subs = subtasksByParent.get(task.id) ?? NO_SUBTASKS;
    return (
      <TaskItem
        task={task}
        indented={opts?.indented}
        onPress={handleRowPress}
        expanded={expandedTaskId === task.id}
        spotlightDisabled={expandedTaskId !== null && expandedTaskId !== task.id && !selectionMode}
        onEdit={handleRowEdit}
        subtaskCount={subs.items.length}
        subtaskDoneCount={subs.doneCount}
        subtasks={subs.items}
        onSubtaskDragStateChange={setDraggingSubtask}
        selectionMode={selectionMode}
        selected={selectedIds.has(task.id)}
        onSelect={toggleSelection}
        onSwipeSelect={handleRowSwipeSelect}
        highlighted={task.id === flashTaskId}
        onApplyImport={handleApplyImport}
        onDismissImport={handleDismissImport}
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
    const allChildren = childrenByGroupId.get(group.id) ?? NO_GROUP_CHILDREN;
    return (
      <TaskGroupTray>
        <TaskGroupHeader
          group={group}
          allChildren={allChildren}
          onToggleCollapse={() => {
            if (expandedTaskId !== null) { setExpandedTaskId(null); return; }
            haptics.tap();
            animateLayout();
            setGroupCollapsed(group.id, !group.collapsed);
          }}
          {...groupHeaderProps}
        />
        <TaskGroupBody expanded={!group.collapsed} hasChildren={children.length > 0}>
          {children.map(child => (
            <React.Fragment key={child.id}>{renderInboxTask(child, { indented: true })}</React.Fragment>
          ))}
        </TaskGroupBody>
      </TaskGroupTray>
    );
  };

  /**
   * The Pinned block — Today's list header, and deliberately NOT part of the
   * list's data.
   *
   * A pinned task keeps its ordinary row in its own category section; this is a
   * *second* row for it, which is what makes pinning additive. Nothing below
   * moves when you pin, so you can pin a run of tasks without the next one
   * jumping out from under your finger, and the delay that used to buy that
   * (see the note where the grace machinery was) is gone.
   *
   * It's the list's header rather than rows in the list because the two want
   * different drags. The section is hand-orderable within itself (pinnedOrder,
   * its own number space — dragging a pin must not drag the original's place in
   * Work), and a nested SortableList gives exactly that, clamped to the block,
   * with no change to resolveDrop's category-from-nearest-header rule. As rows,
   * a pinned row dragged into a category section would inherit that category,
   * and a task dragged up into the block would inherit no category at all.
   *
   * ReorderableList renders it inside its ScrollView, which is load-bearing —
   * see the ListHeaderComponent prop for what a header outside it would do to
   * the drag math.
   */
  const pinnedBlock = pinnedTasks.length === 0 ? null : (
    // One zone for the whole block rather than one per row: the add button only
    // ever asks "did this land on the pinned section", and the answer doesn't
    // change per row. The rows aren't in `zoneByKey` at all now.
    <FabDropZone zone={PINNED_DROP_ZONE}>
      <Pressable style={styles.focusSectionHeader} onPress={() => setExpandedTaskId(null)}>
        <View style={styles.focusSectionTitleRow}>
          <PinIcon filled size={13} color={colors.orange} />
          <Text style={styles.focusSectionTitle}>Pinned Tasks</Text>
        </View>
        <View style={styles.pinnedSectionActions}>
          <TouchableOpacity
            onPress={() => {
              // Same first-tap-dismisses rule every header on this screen has.
              if (expandedTaskId !== null) {
                setExpandedTaskId(null);
                return;
              }
              haptics.tap();
              animateLayout();
              setOthersHidden(h => !h);
            }}
            hitSlop={8}
            accessibilityRole="switch"
            accessibilityState={{ checked: othersHidden }}
            accessibilityLabel={
              othersHidden ? 'Show everything else' : 'Hide everything but pinned tasks'
            }
          >
            <Ionicons
              name={othersHidden ? 'eye-off' : 'eye-outline'}
              size={iconSize.sm}
              color={othersHidden ? colors.orange : colors.textTertiary}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={clearAllPins} hitSlop={8} accessibilityRole="button">
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>
        <SpotlightScrim />
      </Pressable>
      <SortableList
        data={pinnedTasks}
        onReorder={next => reorderPinnedTasks(next.map(t => t.id))}
        onDragStateChange={setDraggingPin}
        placeholderStyle={styles.stackDropSlot}
        renderItem={(task, _displayIndex, drag, isActive) =>
          renderTaskRow(task, {
            drag,
            isActive,
            // The section sits above the category headers, so a row in it has
            // nothing around it to say where the task actually lives.
            showCategory: true,
            rowKey: `pin-${task.id}`,
            duplicateRow: true,
            // pinnedTasks ignores visibility, so this copy isn't going
            // anywhere when a quota goes back on pace — only the real row is.
            hidesWhenOnPace: false,
          })
        }
      />
    </FabDropZone>
  );

  // Footer shared by every list variant: the vacation-hidden reveal (when any)
  // followed by the tap-to-dismiss spacer. `fixedWhenEmpty` keeps the empty
  // state centered by stopping the spacer from growing.
  const listFooter = (fixedWhenEmpty = false) => (
    <>
      {viewMode === 'today' && restVisible && (
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

  // Nothing to say when the list is empty only because the user just hid it —
  // "All clear" over a screen of pinned tasks would be flatly wrong, and the
  // eye that emptied it is right there to undo it.
  const emptyComponent = !restVisible ? null : isEmptyDatabase ? (
    <EmptyState
      icon="rocket-outline"
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

  const newTasks = useMemo(() => visibleTasks.filter(isTaskNew), [visibleTasks]);
  const dismissNewTasksBanner = () => {
    animateLayout();
    markTasksSeen(newTasks.map(t => t.id));
  };
  /**
   * Take a title tapped in the new-todos banner to the row it stands for,
   * rather than opening it: the banner's job is "what showed up and where is
   * it", and the answer to the second half is a place in this list, not a
   * sheet on top of it. Anything folded over the row — its category section,
   * "Everything else", the stack it's filed in — opens on the way.
   *
   * Seeing where it landed counts as seeing it, the same as tapping the row
   * itself does (see TaskItem.handleContentPress).
   */
  const jumpToTask = (task: Task) => {
    markTaskSeen(task.id);
    // Resolved against the pre-collapse list, so a task folded away still has
    // a row to aim at. Nothing at all means a filter is hiding it, and there's
    // nowhere to scroll — open it instead of eating the tap.
    const target = findTaskJumpTarget(listItems, task.id, listItemKey);
    if (!target) {
      openEditor(task);
      return;
    }
    haptics.tap();
    const expandCategory = target.category !== null && collapsedCategories.has(target.category);
    // Every row but the pinned block is behind the hide, and the jump target is
    // always one of those (the block isn't in `listItems`), so a jump while
    // hidden has nothing to land on until the sections are back.
    const unhide = othersHidden;
    // A jump target outside the focused category has no row to land on until
    // focus is cleared — same reasoning as expanding a collapsed section.
    if (focusedCategory && target.category !== focusedCategory) setFocusedCategory(null);
    if (expandCategory || unhide) animateLayout();
    if (expandCategory) {
      setCollapsedCategories(prev => {
        const next = new Set(prev);
        next.delete(target.category!);
        return next;
      });
    }
    if (unhide) setOthersHidden(false);
    // The scroll lands on the stack's header, which doesn't move when the
    // stack opens — but the row the user asked for is inside it, so open it.
    // (No animateLayout here, for the reason TaskGroupHeader's own toggle
    // gives: AnimatedCollapsible already drives this transition.)
    if (target.groupId) {
      const group = taskGroups.find(g => g.id === target.groupId);
      if (group?.collapsed) setGroupCollapsed(group.id, false);
    }
    setExpandedTaskId(null);
    setPendingJump({ key: target.key, n: jumpCount.current++ });
    flashTask(task.id);
  };

  // Projects that have gone quiet. One bucketing pass inside a memo, not a
  // filter per project — this screen re-renders on every store change plus a
  // 30s tick.
  //
  // 'nudge' mode deliberately, unlike the sheet these feed into: this drives an
  // accent tint and a count the user didn't ask for, so it stays gated on each
  // project's own cadence. Opening the sheet asks a question and gets every
  // quiet project back; sitting here does not, and shouldn't (see StallMode).
  // The two counts disagreeing is the design, not a bug to reconcile.
  const projectStalls = useMemo(
    () => findProjectStalls(projects, allTasks, 'nudge').filter(s => !s.project.autoSchedule),
    [projects, allTasks]
  );
  const nudgeDismissed = isDismissedToday(projectNudgeDismissedAt);
  const dismissProjectNudge = () => {
    animateLayout();
    setProjectNudgeDismissedAt(new Date().toISOString());
  };

  const today = format(new Date(), 'EEEE, MMMM d');

  // Today's planned meals (#1133) — see TodayMealPlanSection for why this
  // reads useMealPlanStore passively rather than calling loadRange itself.
  const todayKey = useMemo(() => dayKeyOf(new Date()), []);
  const mealEntries = useMealPlanStore(useShallow(s => s.entries));
  const mealRangeStart = useMealPlanStore(s => s.rangeStart);
  const mealRangeEnd = useMealPlanStore(s => s.rangeEnd);
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const recipesById = useMemo(() => recipeIndex(recipes), [recipes]);
  const todayMealEntries = useMemo(
    () => selectTodayMealEntries(mealEntries, mealRangeStart, mealRangeEnd, todayKey),
    [mealEntries, mealRangeStart, mealRangeEnd, todayKey]
  );
  const openMealPlan = useCallback(() => {
    navigation.navigate('MealPlan' as never);
  }, [navigation]);
  const mealsOnToday = useSettingsStore(s => s.mealsOnToday);
  // What the strip shows: only what's still to be eaten, so the line empties
  // as the day goes and disappears once everything's cooked. The block
  // deliberately keeps the cooked ones — see uncookedEntries.
  const todayMealStripEntries = useMemo(
    () => (todayMealEntries ? uncookedEntries(todayMealEntries) : null),
    [todayMealEntries]
  );

  const laterSections = useMemo(() => computeLaterSections(deferredTasks), [deferredTasks]);

  // The Later list can grow unboundedly (nothing prunes it), and its
  // ReorderableList renders every row unmounted-free (no virtualization — see
  // the file's own comments on why that's deliberate for drag-and-drop). To
  // keep the initial mount cheap, only feed it sections up to a task budget,
  // growing that budget as the user scrolls near the bottom (see the Later
  // ReorderableList's onEndReached below). Whole sections are always included
  // together so a header never renders without at least one of its tasks.
  //
  // The budget starts at one screenful rather than at its settled size because
  // switching to Later mounts every row it's handed in the same blocking
  // commit as the tab switch, and a TaskItem is not a cheap row (four store
  // subscriptions, a PanResponder and several animated values each) — sixty of
  // them is a visible stall between the tap and the switch. The rest is topped
  // up right after that commit lands, so it's already there by the time anyone
  // can scroll to it.
  const [laterTaskLimit, setLaterTaskLimit] = useState(LATER_INITIAL_TASK_LIMIT);

  useEffect(() => {
    // Leaving Later drops the budget back: the list unmounts and returns
    // scrolled to the top, so anything it had paged in is just rows the next
    // switch would pay to mount off-screen.
    if (viewMode !== 'later') {
      setLaterTaskLimit(LATER_INITIAL_TASK_LIMIT);
      return;
    }
    const handle = InteractionManager.runAfterInteractions(() => {
      setLaterTaskLimit(limit => Math.max(limit, LATER_SETTLED_TASK_LIMIT));
    });
    return () => handle.cancel();
  }, [viewMode]);

  const visibleLaterSections = useMemo(
    () => computeVisibleLaterSections(laterSections, laterTaskLimit),
    [laterSections, laterTaskLimit],
  );

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

  // Shared by the header subtitle and the "Lighten today" action's hint.
  const plannedLabel = useMemo(() => {
    const minutes = sumEstimatedMinutes(visibleTasks);
    return minutes > 0 ? formatDuration(minutes) : undefined;
  }, [visibleTasks]);

  // Same estimate machinery, scoped to what's already been finished today —
  // paired with plannedLabel so the header reads "done · planned" instead of
  // planned alone.
  const completedTodayLabel = useMemo(() => {
    const completedToday = allTasks.filter(
      t => !t.parentId && isRealCompletion(t) && t.completedAt && isToday(new Date(t.completedAt)),
    );
    const minutes = sumEstimatedMinutes(completedToday);
    return minutes > 0 ? formatDuration(minutes) : undefined;
  }, [allTasks]);

  const workloadSubtitle =
    viewMode === 'today' && (plannedLabel || completedTodayLabel)
      ? [
          completedTodayLabel ? `${completedTodayLabel} done` : undefined,
          plannedLabel ? `${plannedLabel} planned` : undefined,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;

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
    ...(viewMode === 'today' && pinnedTasks.length < MAX_SUGGESTED_PINS && visibleTasks.length > 0
      ? [{
          icon: 'color-wand' as const,
          onPress: () => setSuggestedPinsVisible(true),
          active: pinnedTasks.length === 0,
          tint: 'orange' as const,
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
          subtitle={workloadSubtitle}
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
                  // Focus only has meaning inside Today's own category
                  // sections; leaving it set while on Later/Unscheduled/Inbox
                  // would silently narrow Today again on the way back.
                  if (mode !== 'today') setFocusedCategory(null);
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

        {viewMode === 'today' && focusedCategory && (
          <CategoryFocusBanner
            categoryLabel={categoryLabel(focusedCategory, categories)}
            onClear={() => {
              haptics.tap();
              animateLayout();
              setFocusedCategory(null);
            }}
          />
        )}

        {viewMode === 'today' && newTasks.length > 0 && (
          <NewTasksBanner tasks={newTasks} onJumpToTask={jumpToTask} onDismiss={dismissNewTasksBanner} />
        )}

        {/* "What's new" leads; "what's gone quiet" follows. */}
        {viewMode === 'today' && projectStalls.length > 0 && !nudgeDismissed && (
          <ProjectNudgeBanner
            stalls={projectStalls}
            onReview={projectIds => {
              setPullScopeProjectIds(projectIds);
              setPullVisible(true);
            }}
            onDismiss={dismissProjectNudge}
          />
        )}

        {/*
          Two shapes for one thing, picked by `mealsOnToday` (default `strip`).
          The strip additionally drops what's been cooked, which is why it reads
          its own array rather than filtering inline.
        */}
        {viewMode === 'today' && mealsOnToday === 'strip'
          && todayMealStripEntries && todayMealStripEntries.length > 0 && (
          <TodayMealStrip
            entries={todayMealStripEntries}
            recipesById={recipesById}
            onOpen={openMealPlan}
          />
        )}

        {viewMode === 'today' && mealsOnToday === 'block' && todayMealEntries && todayMealEntries.length > 0 && (
          <TodayMealPlanSection
            entries={todayMealEntries}
            recipesById={recipesById}
            onOpen={openMealPlan}
          />
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
        <FabDropZoneProvider
          ref={dropZonesRef}
          onIntentChange={fabIntentChannel.publish}
          scroller={todayScrollControl}
        >
        {viewMode === 'later' && (
          <ReorderableList
            scrollEnabled={!painting && !draggingSubtask}
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
              const subs = subtasksByParent.get(item.task.id) ?? NO_SUBTASKS;
              return (
                <TaskItem
                  task={item.task}
                  onPress={handleRowPress}
                  expanded={expandedTaskId === item.task.id}
                  spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.task.id && !selectionMode}
                  onEdit={handleRowEdit}
                  subtaskCount={subs.items.length}
                  subtaskDoneCount={subs.doneCount}
                  subtasks={subs.items}
                  onSubtaskDragStateChange={setDraggingSubtask}
                  drag={selectionMode || !drag ? undefined : drag}
                  isActive={isActive}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.task.id)}
                  onSelect={toggleSelection}
                  onSwipeSelect={handleRowSwipeSelect}
                  hideTodayLabel
                  showCategory
                  showProject
                  showGroup
                  showActions={false}
                  highlighted={item.task.id === flashTaskId}
                />
              );
            }}
            onDragBegin={() => setExpandedTaskId(null)}
            onHoverChange={haptics.dragTick}
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
                  icon="rocket-outline"
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

        {viewMode === 'today' && (
          <ReorderableList
            // The user can't scroll during an add-button drag (the button's
            // responder has the touch); the drag scrolls it instead, through
            // this control.
            scrollEnabled={!painting && !fabDragging && !draggingStackChild && !draggingSubtask && !draggingPin}
            scrollControlRef={todayScrollControl}
            rowScrollerRef={todayRowScroller}
            data={draggableData}
            keyExtractor={listItemKey}
            renderItem={renderItem}
            ListHeaderComponent={pinnedBlock}
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
            }}
            onHoverChange={haptics.dragTick}
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
            // Only here to record which row is in flight (onDragMove reads it);
            // every draggable row on this list may go anywhere in it. Section
            // headers aren't draggable at all — their order is set from the "…"
            // menu (see CategoryOrderSheet).
            dragRange={(rangeData, activeIndex) => {
              activeDragIndexRef.current = activeIndex;
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

              // A task dragged onto a group (see onDragMove) has already joined
              // it in onDragEnd — drop it from the normal placement pass so
              // resolveDrop never assigns it a category/order of its own.
              if (joinedTaskId !== null) {
                const withoutJoined = dropped.filter(
                  item => !(item.type === 'task' && item.task.id === joinedTaskId),
                );
                const { taskOrders, categoryUpdates, groupUpdates, settled } = resolveDrop(withoutJoined, {
                  isUpcoming: id => upcomingTaskIds.has(id),
                  showUpcoming,
                  categoryOrder: allCategories,
                });
                groupUpdates.forEach(u => updateGroup(u.id, { category: u.category, sortOrder: u.sortOrder }));
                setDraggableData(settled);
                reorderWithCategoryUpdates(taskOrders, categoryUpdates);
                return;
              }

              const { taskOrders, categoryUpdates, groupUpdates, settled } = resolveDrop(dropped, {
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
                reorderWithCategoryUpdates(taskOrders, categoryUpdates, scope ? { scope } : undefined);
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
                refreshing={pullingToSearch}
                onRefresh={handlePullToSearch}
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
            ref={unscheduledScroll.ref}
            scrollEnabled={!painting && !draggingSubtask}
            data={unscheduledTasks}
            keyExtractor={t => t.id}
            {...unscheduledScroll.props}
            renderItem={({ item }) => {
              const subs = subtasksByParent.get(item.id) ?? NO_SUBTASKS;
              return (
                <TaskItem
                  task={item}
                  onPress={handleRowPress}
                  expanded={expandedTaskId === item.id}
                  spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id && !selectionMode}
                  onEdit={handleRowEdit}
                  subtaskCount={subs.items.length}
                  subtaskDoneCount={subs.doneCount}
                  subtasks={subs.items}
                  onSubtaskDragStateChange={setDraggingSubtask}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.id)}
                  onSelect={toggleSelection}
                  onSwipeSelect={handleRowSwipeSelect}
                  hideTodayLabel
                  showCategory
                  showProject
                  highlighted={item.id === flashTaskId}
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
                  icon="rocket-outline"
                  title="Welcome to your list"
                  subtitle="Add your first task to get started"
                  actionLabel="Add a task"
                  onAction={() => setQuickAddVisible(true)}
                  bottomOffset={tabBarHeight}
                />
              ) : (
                <EmptyState
                  icon="calendar-clear-outline"
                  title="Nothing unscheduled"
                  subtitle="Tasks with no due date land here once they're organized"
                  bottomOffset={tabBarHeight}
                />
              )
            }
            ListFooterComponent={
              <TouchableOpacity
                style={[styles.listFooter, unscheduledTasks.length === 0 && styles.listFooterFixed]}
                activeOpacity={1}
                onPress={() => setExpandedTaskId(null)}
              />
            }
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
            ref={inboxScroll.ref}
            scrollEnabled={!painting && !draggingSubtask}
            data={inboxData}
            keyExtractor={listItemKey}
            {...inboxScroll.props}
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
                  icon="rocket-outline"
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
            ListFooterComponent={
              <TouchableOpacity
                style={[styles.listFooter, inboxTasks.length === 0 && styles.listFooterFixed]}
                activeOpacity={1}
                onPress={() => setExpandedTaskId(null)}
              />
            }
            ListFooterComponentStyle={inboxTasks.length === 0 ? undefined : styles.listFooterCell}
          />
        )}
        </FabDropZoneProvider>
        </PaintSelectionProvider>
        </View>

        {!selectionMode && (
          <AddTaskFabWithDropLabel
            channel={fabIntentChannel}
            categories={categories}
            bottom={insets.bottom + 64}
            disabled={spotlightActive}
            opacity={fabOpacity}
            onSelect={handleAddMenuSelect}
            // Only Today resolves a drop to anything; the other sub-views leave
            // the button tap-only rather than accepting a drag that can't mean
            // anything when it lands.
            drag={viewMode === 'today' ? fabDrag : undefined}
          />
        )}

        <QuickAddModal
          visible={quickAddVisible}
          onClose={closeQuickAdd}
          onOpenFull={handleQuickAddOpenFull}
          context={viewMode}
          onCreated={handleTaskCreated}
          seed={quickAddSeed}
          seedLabel={quickAddSeedLabel}
          initialType={quickAddType}
        />

        {/* Opened by pulling the Today list down. */}
        <QuickSearchModal
          visible={quickSearchVisible}
          onClose={() => setQuickSearchVisible(false)}
          onSelectTask={openEditor}
          onOpenFullSearch={handleOpenFullSearch}
        />

        {/* Add from a template: pick one here, then the apply sheet below. */}
        <TemplatePickerSheet
          visible={templatePickerVisible}
          onClose={() => setTemplatePickerVisible(false)}
          onSelect={setApplyTemplate}
        />

        <ApplyTemplateSheet
          visible={applyTemplate !== null}
          template={applyTemplate}
          onClose={() => setApplyTemplate(null)}
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
          onLightenDay={visibleTasks.length > 0 ? () => {
            setOptionsMenuVisible(false);
            setDeloadVisible(true);
          } : undefined}
          plannedLabel={plannedLabel}
          onPullFromProjects={() => {
            setOptionsMenuVisible(false);
            setPullScopeProjectIds(undefined);
            setPullVisible(true);
          }}
          quietProjectCount={projectStalls.length}
          onReorderCategories={() => {
            setOptionsMenuVisible(false);
            setCategoryOrderVisible(true);
          }}
          categoryCount={allCategories.length}
        />

        <CategoryOrderSheet
          visible={categoryOrderVisible}
          onClose={() => setCategoryOrderVisible(false)}
        />

        <DeloadSheet
          visible={deloadVisible}
          todaysTasks={visibleTasks}
          onClose={() => setDeloadVisible(false)}
        />

        <SuggestedPinsSheet
          visible={suggestedPinsVisible}
          tasks={visibleTasks}
          pinnedTasks={pinnedTasks}
          onClose={() => setSuggestedPinsVisible(false)}
          onConfirm={handleSuggestedPins}
        />

        <ProjectPullSheet
          visible={pullVisible}
          todaysTasks={visibleTasks}
          scopeProjectIds={pullScopeProjectIds}
          onClose={() => {
            setPullVisible(false);
            setPullScopeProjectIds(undefined);
          }}
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
            existingTags={useTaskStore.getState().allTags()}
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
            // The new stack takes the category its members most often already
            // have, and they all adopt it (see applyGroupCategory). Mixed
            // selections used to fall back to no category at all, which was
            // harmless while the stack's category was its own business — now
            // that it cascades, that fallback would strip the category off
            // every task in the selection.
            onGroup={title => {
              const ids = Array.from(selectedIds);
              const tally = new Map<string | null, number>();
              for (const id of ids) {
                const c = allTasks.find(t => t.id === id)?.category ?? null;
                tally.set(c, (tally.get(c) ?? 0) + 1);
              }
              let category: string | null = null;
              let best = 0;
              // Insertion order is selection order, so ties go to whichever
              // category appeared first rather than to an arbitrary winner.
              for (const [c, n] of tally) {
                if (n > best) { best = n; category = c; }
              }
              groupTasks(ids, title, category);
              exitSelection();
            }}
            onTogglePin={() => { bulkTogglePin(Array.from(selectedIds)); exitSelection(); }}
            allPinned={selectedIds.size > 0 && Array.from(selectedIds).every(
              id => allTasks.find(t => t.id === id)?.pinned,
            )}
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
  // Same slot for a drag inside a stack, minus the horizontal margin: an
  // `indented` row drops its own margins so the tray's padding is its only
  // inset (see TaskGroupTray), and a slot 16pt narrower than the row it
  // stands in for reads as a different, smaller thing.
  stackDropSlot: {
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
  // On an empty list there is no expanded row to dismiss and nothing below to
  // reach for, so the tap catcher collapses entirely: any height it kept would
  // come off the bottom of the box the empty state centres in, and land it
  // half that height above where every other empty state in the app sits.
  listFooterFixed: { flexGrow: 0, minHeight: 0 },
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
