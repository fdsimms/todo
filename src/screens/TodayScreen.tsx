// Today, Later, Unscheduled and Inbox: four `viewMode` lenses over one screen,
// not four routes (see the Navigation note in CLAUDE.md before adding a fifth).
// One component of ~3,000 lines, so grep a landmark rather than reading it
// start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   makeStyles              styles, at the bottom
//
// The small components above TodayScreen (SectionHeader, LaterTodaySection,
// ExpiredSection, …) are its section furniture and are declared at module level.
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
import type { ContextRow, Task, TaskGroup, TaskTemplate, Category, TimeOfDay } from '../types';
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
  laterVisibleOrder,
  laterDaySections,
  laterDropZones,
  laterTodaySections as computeLaterTodaySections,
  applyCategoryCollapse as applyCategoryCollapseTo,
  sectionTaskIds as computeSectionTaskIds,
  sectionTasksByLabel,
  findTaskJumpTarget,
  type LaterListItem,
  type CategoryListItem,
  type TodayListItem,
  type LaterTodaySectionData,
} from '../utils/taskGrouping';
import { liveGeneratedTask, liveGeneratedTasksOfKind } from '../utils/generatedTasks';
import { useDemoStore } from '../store/useDemoStore';
import {
  eventContextRows,
  mealContextRows,
  kitchenContextRows,
  plannedUsesToday,
  insertContextRows,
  withoutContextRows,
} from '../utils/dayContextRows';
import { dragRange } from '../utils/reorder';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { asksOnCompletion } from '../utils/deliverables';
import { DeliverablePromptQueue } from '../components/DeliverablePromptQueue';
import { useTaskStore } from '../store/useTaskStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { kitchenInventory, type KitchenEntry } from '../utils/kitchenInventory';
import { standingSwapMap } from '../utils/standingSwaps';
import { useWidgetCompletionStore } from '../store/useWidgetCompletionStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { featureHidden, visibleLenses } from '../utils/simpleMode';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useMealPlanNudgeProgress } from '../hooks/useMealPlanNudgeProgress';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useSettingsStore, type MealsOnToday } from '../store/useSettingsStore';
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
import { LookAheadSheet } from '../components/LookAheadSheet';
import { ProjectPullSheet } from '../components/ProjectPullSheet';
import { useProjectStore } from '../store/useProjectStore';
import { DayContextRow } from '../components/DayContextRow';
import { mealSlotSourceId } from '../utils/mealSlotTasks';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { selectTodayMealEntries, recipeIndex } from '../utils/mealPlan';
import { dayKeyOf, getDayStart } from '../utils/dateUtils';
import { addDays } from 'date-fns/addDays';
import { useCalendarStore } from '../store/useCalendarStore';
import { eventsIn } from '../utils/calendarBusy';
import { TodayEventsSheet } from '../components/TodayEventsSheet';
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
import { TipHost } from '../components/TipHost';
import { FocusBar } from '../components/FocusBar';
import { FocusSetupSheet } from '../components/FocusSetupSheet';
import { FocusSessionSheet } from '../components/FocusSessionSheet';
import { useFocusStore } from '../store/useFocusStore';
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

// What a pill's badge count means, read out after the view's name. Only the two
// lenses holding tasks that haven't been placed anywhere carry a badge — Today
// and Later already say their size in the header subtitle, and a count on every
// pill is a count on none of them.
const VIEW_BADGE_LABELS: Partial<Record<ViewMode, string>> = {
  unscheduled: 'with no date',
  inbox: 'to sort',
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

// Stands in for a task selector this sub-view doesn't read — one shared
// identity, so useShallow sees no change rather than a fresh [] each time.
// See the selector block in TodayScreen for what gates what.
const NO_TASKS: Task[] = [];

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
  allPinned,
  count,
}: {
  label: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  collapsed?: boolean;
  onToggle?: () => void;
  onLongPress?: () => void;
  allPinned?: boolean;
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
      accessibilityHint={onLongPress ? `Double tap and hold to ${allPinned ? 'unpin' : 'pin'} the tasks shown under ${label}` : undefined}
    >
      <View style={styles.categorySectionHeaderLeft}>
        {allPinned && <PinIcon filled size={13} color={colors.orange} />}
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
        return intent.schedule
          ? `New task on ${intent.schedule.label}`
          : intent.category
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
  // ==== store bindings, navigation, layout insets ====
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const inboxTasks = useTaskStore(useShallow(s => s.inboxTasks()));
  const tabBarHeight = useBottomTabBarHeight();
  // ==== local state (view mode, selection, expansion, sheets) ====
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  // Declared up here rather than with the rest of the sheet/selection state
  // below, because the selectors immediately after it are gated on it.
  const [viewMode, setViewMode] = useState<ViewMode>('today');
  // Each of these is a full filter and sort over every task in the database,
  // re-run on every store change. Only one sub-view's list is mounted at a
  // time, so all seven used to run for every completion, edit and reorder no
  // matter which lens was on screen. They are now gated on the view that
  // actually reads them: the hook still runs unconditionally (it has to), but
  // the work inside the selector doesn't.
  //
  // inboxTasks is deliberately ungated — its count is the badge on the Inbox
  // pill, which every view shows. vacationHiddenTasks covers two views because
  // VacationHiddenSection lives in the shared listFooter.
  const showingToday = viewMode === 'today';
  const visibleTasks = useTaskStore(useShallow(s => (showingToday ? s.visibleTasks() : NO_TASKS)));
  const pinnedTasks = useTaskStore(useShallow(s => (showingToday ? s.pinnedTasks() : NO_TASKS)));
  const deferredTasks = useTaskStore(useShallow(s => (viewMode === 'later' ? s.deferredTasks() : NO_TASKS)));
  const unscheduledTasks = useTaskStore(
    useShallow(s => (viewMode === 'unscheduled' ? s.unscheduledTasks() : NO_TASKS)),
  );
  const expiredTasks = useTaskStore(useShallow(s => (showingToday ? s.expiredTasks() : NO_TASKS)));
  const vacationHiddenTasks = useTaskStore(
    useShallow(s => (showingToday || viewMode === 'later' ? s.vacationHiddenTasks() : NO_TASKS)),
  );
  const upcomingTodayTasks = useTaskStore(
    useShallow(s => (showingToday ? s.upcomingTodayTasks() : NO_TASKS)),
  );
  const allTasks = useTaskStore(s => s.tasks);
  const isEmptyDatabase = allTasks.length === 0;
  // The whole shortlist "batch the reach-outs" (#2091) starts from — the cap
  // on the generator is already the ranking, the same way pinnedTasks() is
  // for its own seed above.
  const reachOutTasks = useMemo(
    () => liveGeneratedTasksOfKind(allTasks, 'reachOut'),
    [allTasks],
  );
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const updateTask = useTaskStore(s => s.updateTask);
  const clearAllPins = useTaskStore(s => s.clearAllPins);
  const reorderPinnedTasks = useTaskStore(s => s.reorderPinnedTasks);
  const reorderTasks = useTaskStore(s => s.reorderTasks);
  const reorderWithCategoryUpdates = useTaskStore(s => s.reorderWithCategoryUpdates);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkMarkMissed = useTaskStore(s => s.bulkMarkMissed);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkTogglePin = useTaskStore(s => s.bulkTogglePin);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
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
  const applyGroupCategory = useTaskStore(s => s.applyGroupCategory);
  const reorderGroupChildren = useTaskStore(s => s.reorderGroupChildren);
  const addExistingToGroup = useTaskStore(s => s.addExistingToGroup);
  const removeFromGroup = useTaskStore(s => s.removeFromGroup);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const segmentColors: Record<string, string> = useMemo(
    () => ({
      morning: colors.timeMorning,
      afternoon: colors.timeAfternoon,
      evening: colors.timeEvening,
      night: colors.timeNight,
    }),
    [colors],
  );

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
  // The Later/Unscheduled/Inbox counterparts of pendingJump — a newly-created
  // task can land in any of the four views (see handleTaskCreated), and each
  // list needs its own queued scroll since each is its own component with its
  // own ref, mounted only while that view is showing.
  const [pendingLaterJump, setPendingLaterJump] = useState<{ key: string; n: number } | null>(null);
  const [pendingUnscheduledJump, setPendingUnscheduledJump] = useState<{ index: number; n: number } | null>(null);
  const [pendingInboxJump, setPendingInboxJump] = useState<{ index: number; n: number } | null>(null);
  const [autoCompletingIds, setAutoCompletingIds] = useState<Set<string>>(new Set());
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [pullingToSearch, setPullingToSearch] = useState(false);
  const [quickSearchVisible, setQuickSearchVisible] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [focusSetupVisible, setFocusSetupVisible] = useState(false);
  // Which entry point opened the setup sheet — whether it should seed from
  // the pinned block instead of running the suggester. See FocusSetupSheet's
  // `pinnedSeed` prop.
  const [focusFromPinned, setFocusFromPinned] = useState(false);
  // Same idea, seeded from the live reach-out tasks instead — see
  // FocusSetupSheet's `reachOutSeed` prop and the "…" menu's new row.
  const [focusFromReachOuts, setFocusFromReachOuts] = useState(false);
  const [focusSessionVisible, setFocusSessionVisible] = useState(false);
  const focusSession = useFocusStore(s => s.session);
  const startFocusSession = useFocusStore(s => s.startSession);
  const [categoryOrderVisible, setCategoryOrderVisible] = useState(false);
  const [deloadVisible, setDeloadVisible] = useState(false);
  const [lookAheadVisible, setLookAheadVisible] = useState(false);
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

  // Every path here that completes more than one task at a time asks first if
  // any of them would go unanswered — the bulk bar, and a stack's "complete
  // all". See useAnswerFirstCompletion. Selection is left alone until
  // something actually happens, so cancelling the confirm doesn't cost the
  // user the selection they just built.
  const { requestComplete, enqueue, queueProps } = useAnswerFirstCompletion();
  const handleBulkComplete = () => {
    const ids = Array.from(selectedIds);
    requestComplete({
      ids,
      complete: skipIds => {
        bulkCompleteTasks(ids.filter(id => !skipIds.includes(id)));
        exitSelection();
      },
    });
  };
  // One per view mode: only ever one of these lists is mounted at a time, but
  // each needs its own ref and its own record of where it last settled.
  const unscheduledScroll = useKeyboardInsetScroll<FlatList>();
  const inboxScroll = useKeyboardInsetScroll<FlatList>();
  // Extra bottom padding so the last rows aren't hidden behind the floating
  // BulkActionBar.
  const extraListBottomPadding = selectionMode
    ? tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm
    : undefined;
  // "Hide everything but the pins", toggled by the eye in the pinned header.
  // Off by default and session-only: the pinned block is additive now —
  // pinning shows you a copy at the top, it doesn't take the rest of the day
  // away — so hiding is something you ask for, once, when you want it. The previous design had this the other way round ("Everything
  // else" arrived collapsed) and that's the half people turned the feature off
  // over.
  const [othersHidden, setOthersHidden] = useState(false);
  // The toggle lives on the pinned block's header, and the block itself
  // renders nothing once nothing is pinned — so if the last pin goes away
  // (Clear, or unpinning the last one) while this is still true, there's no
  // header left to switch it back off from, and the list stays empty for
  // good. Drop the hide the moment it has nothing left to hide besides.
  // ==== effects ====
  // Gated on the view as well as the count: pinnedTasks reads empty off Today
  // (see the selector block), and "hide everything but the pins" is a Today
  // display state that must survive a look at Later and back. Re-runs on the
  // way back in, so a pin cleared while away is still caught.
  useEffect(() => {
    if (showingToday && pinnedTasks.length === 0) setOthersHidden(false);
  }, [showingToday, pinnedTasks.length]);
  const [showHidden, setShowHidden] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  // Persisted: folding a section shut is a statement about how you want the
  // list to look, and it used to be forgotten on every cold start. Kept as a
  // Set here (the three call sites below all ask "is this one collapsed") and
  // written back as a plain array.
  const storedCollapsedCategories = useSettingsStore(useShallow(s => s.collapsedCategories));
  const setStoredCollapsedCategories = useSettingsStore(s => s.setCollapsedCategories);
  const collapsedCategories = useMemo(
    () => new Set(storedCollapsedCategories),
    [storedCollapsedCategories],
  );
  const setCollapsedCategories = useCallback(
    (update: (prev: Set<string>) => Set<string>) => {
      setStoredCollapsedCategories([...update(new Set(storedCollapsedCategories))]);
    },
    [storedCollapsedCategories, setStoredCollapsedCategories],
  );
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
  //
  // Pressing it while Today is already the tab *and* the sub-view means there
  // is nowhere left to go, so it scrolls the list back to the top instead —
  // the standard second-tap-on-the-active-tab gesture. The other sub-views
  // need no equivalent: each renders its own list, so switching back to Today
  // mounts that list fresh at offset 0. Deliberately gated on isFocused() —
  // arriving from another tab is a plain switch, and yanking the list the user
  // left mid-scroll back to the top isn't part of that.
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as never, () => {
      if (navigation.isFocused() && viewMode === 'today') {
        todayRowScroller.current?.scrollToTop();
        return;
      }
      setViewMode('today');
    });
    return unsubscribe;
  }, [navigation, viewMode]);

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

  // The same stamped-param handoff, for a quiet project's review task: its
  // linkUrl is dundundun://projects?pull=<id>, which lands here and pops the
  // pull sheet scoped to that one project (see utils/projectReviewTasks.ts).
  // The sheet is mounted by this screen, which is why the link routes to Today
  // rather than to the Projects tab.
  const [handledOpenPull, setHandledOpenPull] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openProjectPull === undefined || route.params.openProjectPull === handledOpenPull) return;
    setHandledOpenPull(route.params.openProjectPull);
    const projectId = route.params.pullProjectId as string | undefined;
    // An unscoped link opens the sheet over the whole board, the same thing the
    // options row does. A scoped one whose project has since been deleted or
    // archived scopes to nothing and lands on the sheet's own empty state,
    // which is the right answer and a narrow window anyway — the next sweep
    // drops a review task whose project has stopped being quiet, and a project
    // that no longer exists has certainly stopped.
    setPullScopeProjectIds(projectId ? [projectId] : undefined);
    setPullVisible(true);
  }, [route.params?.openProjectPull, route.params?.pullProjectId, handledOpenPull]);

  // The same handoff again, for every tap on the focus session's Live Activity
  // (dundundun://focus[?do=…] — see utils/focusLiveActivity.ts). Whatever the
  // link asked for has already been applied to the store by the time this
  // runs; this is only the sheet arriving on top so the result is visible.
  // A session that has since ended leaves the sheet's own `focusSession !==
  // null` guard to keep it shut.
  const [handledOpenFocus, setHandledOpenFocus] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openFocusSession === undefined || route.params.openFocusSession === handledOpenFocus) return;
    setHandledOpenFocus(route.params.openFocusSession);
    setFocusSessionVisible(true);
  }, [route.params?.openFocusSession, handledOpenFocus]);

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
        // No row is mounted to catch autoComplete, so the animated path (which
        // asks a decision task its question) can't run. Ask here instead
        // rather than completing straight through it — a Live Activity's Done
        // button is a person finishing a task, and it's the one completion
        // path left that would drop an answer with nobody told.
        if (asksOnCompletion(task)) {
          enqueue([id]);
          return;
        }
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
  // metadata at all is an Inbox task, whichever view it was added from. Beyond
  // the switch, scroll to and flash the row itself — a task landing off-screen
  // (a different category section on Today, a later page of Later, anywhere
  // in Unscheduled/Inbox) would otherwise just silently appear somewhere the
  // user has to go looking for it.
  // ==== handlers: creating, opening and acting on a row ====
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
    if (placed && dropped?.kind === 'insert') {
      if (destination === 'today') placeCreatedTask(task, dropped);
      else if (destination === 'later') placeCreatedLaterTask(task, dropped);
      else if (destination === 'unscheduled') placeCreatedUnscheduledTask(task, dropped);
      else placeCreatedInboxTask(task, dropped);
    }
    if (destination !== viewMode) setViewMode(destination);

    if (destination === 'today') {
      revealTaskInToday(task);
    } else if (destination === 'later') {
      // Later pages itself in behind a task budget (see laterTaskLimit) — jump
      // it straight to the settled size so the new row's section is actually
      // in the data the list is about to scroll.
      setLaterTaskLimit(limit => Math.max(limit, LATER_SETTLED_TASK_LIMIT));
      setPendingLaterJump({ key: task.id, n: jumpCount.current++ });
    } else if (destination === 'unscheduled') {
      // Indexed against what's actually rendered (filteredUnscheduledTasks) —
      // a freshly created task has no reminder yet, so the reminder filter
      // being on means it has no row to scroll to at all.
      const index = filteredUnscheduledTasks.findIndex(t => t.id === task.id);
      if (index >= 0) setPendingUnscheduledJump({ index, n: jumpCount.current++ });
    } else {
      // A drag onto a stack row (see placeCreatedInboxTask) makes the task a
      // member rather than a loose row — jump to the stack's own row then,
      // since the member itself isn't independently indexed in this list.
      const index = task.groupId
        ? inboxData.findIndex(item => item.type === 'group' && item.group.id === task.groupId)
        : inboxData.findIndex(item => item.type === 'task' && item.task.id === task.id);
      if (index >= 0) setPendingInboxJump({ index, n: jumpCount.current++ });
    }
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
  const [minuteTick, forceRefresh] = useState(0);
  useFocusEffect(
    useCallback(() => {
      // On *focus* as well as on foreground below, which is this pass alone and
      // deliberate: a pantry check is answered on another screen — its own link
      // opens the item sheet — and the six writes that answer it (both Pantry
      // pills, the kitchen row's ✕, the freezer, running low, marking a staple)
      // are six call sites that would each have to remember to clear the row.
      // That is the "four call sites and still missed one" the stacks note
      // warns about, so the sweep hangs off the one place the stale row would
      // actually be seen instead. Same move checkTripExpiry makes on focus, and
      // for the same reason: it turns something already true into something
      // visible. A no-op boolean check while the setting is off.
      useTaskStore.getState().checkPantryCheckTasks();
      // On focus as well, for the pantry check's exact reason: a shortfall task
      // is answered somewhere else entirely — its link opens the Meal Plan
      // screen, and the add-to-list sheet there is what clears it — so hanging
      // the sweep off the one place the stale row would actually be seen beats
      // asking every grocery and meal-plan write to remember it.
      useTaskStore.getState().checkMealShortfallTasks();
      // Same reasoning one row over: a supply crosses its lead time purely by
      // time passing (the run-out day stops being far enough away), and it
      // stops wanting anything the moment the user restocks it — including
      // from the reorder task's own completion prompt, which completeTask
      // already sweeps for. This is the half that catches the clock.
      useTaskStore.getState().checkSupplyReorderTasks();
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
          // A project goes quiet purely by time passing, and stops being quiet
          // the moment anything in it is dated — including from the review
          // task's own row, which nothing else would then clear. Same reason
          // the passes around it run here rather than waiting for a cold start.
          useTaskStore.getState().checkProjectReviewTasks();
          // A birthday arrives purely by time passing, the same trigger as the
          // passes around it, and a phone left open across midnight never sees
          // another cold start — so without this somebody's birthday task would
          // wait for a force-quit. Idempotent: the source id carries the year,
          // so a second run finds the row already there and does nothing.
          useTaskStore.getState().checkBirthdayTasks();
          // Beside it, same trigger, same idempotency (the source id carries
          // the year) — off by default, so ordinarily a no-op check.
          useTaskStore.getState().checkBirthdayGiftTasks();
          // Same trigger again: a cadence runs out by time passing, and stops
          // needing a row the moment anything lands in that person's history —
          // including from this very row, which nothing else would then clear.
          useTaskStore.getState().checkReachOutTasks();
          // A day rolls over purely by time passing, and a phone left open
          // across midnight never sees another cold start — so without this
          // the window would stop advancing until the app was force-quit. It
          // only ever writes past its own mark
          // (mealSlotTasksWrittenThroughDayKey), so running it here as well as
          // in the launch sequence costs one day's work at most and can never
          // double-fire.
          useTaskStore.getState().checkMealSlotTasks();
          // Same shape one shelf over: a pantry guess runs out purely by time
          // passing, and stops needing an answer the moment the user gives one
          // from the sheet this task links to.
          useTaskStore.getState().checkPantryCheckTasks();
          // A meal comes into shopping range purely by time passing, and stops
          // wanting a shop the moment the plan changes under it — re-planned,
          // moved, cooked, or the ingredients added to the list. None of those
          // mutations knows a row is sitting on Today naming the old dish, and
          // wiring the ~15 that can change a week is the "four call sites and
          // still missed one" the stacks note warns about. This pass re-runs the
          // predicate instead. After checkMealSlotTasks, which can plan a meal.
          useTaskStore.getState().checkMealShortfallTasks();
          // And the same for a supply whose lead time has come round while the
          // app sat in the background — a phone left open for a fortnight
          // never sees another cold start, and the whole point of a lead time
          // is that it fires on a day nobody opened the editor.
          useTaskStore.getState().checkSupplyReorderTasks();
          // And a third generator on the same shelf: which day is "tomorrow"
          // rolls over purely by time passing too, and the calendar window this
          // reads is kept current by useCalendarSync's own AppState listener
          // rather than anything here.
          useTaskStore.getState().checkCalendarReviewTasks();
          // And any template whose schedule came due while the app sat in the
          // background (#1781) — a weekly run would otherwise wait for the next
          // cold start, which for a phone left open all week never comes. Same
          // reason dripStalledProjects is here as well as in the launch
          // sequence; checkScheduledTemplates is idempotent within a period, so
          // running it in both places can't double-fire.
          useTemplateStore.getState().checkScheduledTemplates();
          // A leftover can age from "fresh" into "soon" purely by time
          // passing, with no store mutation to trigger a reconcile — same
          // reason the other checks above run here rather than waiting for
          // the next cold start.
          useLeftoverStore.getState().reconcileAllLeftoverTasks();
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
   * Long-press a category header to pin its section in one go. Pins unless
   * every row under the header is already pinned, in which case it unpins
   * them — the same mixed-selection rule the bulk bar's pin uses, which is
   * why this goes through bulkTogglePin rather than the store's pinCategory.
   *
   * The scope is the section as rendered (see sectionTasksByLabel), not the
   * category: a header speaks for the rows beneath it, and Today's sections
   * hold today's work. pinCategory reaches every live task filed under the
   * category, so a long-press here used to pin things dated weeks out as
   * well, and because pinnedTasks() ignores visibility on purpose (see the
   * Pinning note in CLAUDE.md) each of them landed in the Pinned block and
   * stayed. CategoryDetailScreen's own button keeps pinCategory: it sits
   * above a list of exactly the tasks it pins.
   *
   * A header can exist for a category holding only calendar-event context
   * rows (see the `data` memo below), which is why an empty section is still
   * checked for.
   */
  const handlePinCategory = (label: string) => {
    if (expandedTaskId !== null) {
      setExpandedTaskId(null);
      return;
    }
    const sectionTasks = sectionTasksByCategory.get(label) ?? NO_GROUP_CHILDREN;
    if (sectionTasks.length === 0) return;
    haptics.tap();
    animateLayout();
    bulkTogglePin(sectionTasks.map(t => t.id));
  };

  // Sort & filter state. Persisted, like hideCategories below — the three are
  // set from the same sheet, and only one of them used to survive a launch.
  const sort = useSettingsStore(s => s.sortOption);
  const setSort = useSettingsStore(s => s.setSortOption);
  const filterPriorities = useSettingsStore(useShallow(s => s.filterPriorities));
  const setFilterPriorities = useSettingsStore(s => s.setFilterPriorities);
  const filterEfforts = useSettingsStore(useShallow(s => s.filterEfforts));
  const setFilterEfforts = useSettingsStore(s => s.setFilterEfforts);
  const filterHasReminder = useSettingsStore(s => s.filterHasReminder);
  const setFilterHasReminder = useSettingsStore(s => s.setFilterHasReminder);
  const hideCategories = useSettingsStore(s => s.hideCategories);
  const setHideCategories = useSettingsStore(s => s.setHideCategories);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  // Counted in every mode now, not just simplified: it's the badge on the
  // Unscheduled pill, which every view shows, so it can't be gated on the view
  // that reads the list (same trade inboxTasks makes above). A scalar, so it
  // can't churn renders — this recomputes on every store write and re-renders
  // only when the number itself moves.
  const unscheduledCount = useTaskStore(s => s.tasks.filter(isUnscheduledTask).length);
  // Later and Inbox stay whatever the mode is: each is the only route to a set
  // of real tasks, and a lens that hides tasks isn't a simplification. Only
  // Unscheduled goes, and only while it's empty and isn't the view you're on.
  const viewModes = useMemo(
    () => (featureHidden('unscheduledLens', simpleMode)
      ? visibleLenses(VIEW_MODES, { unscheduled: unscheduledCount }, viewMode)
      : VIEW_MODES),
    [simpleMode, unscheduledCount, viewMode]
  );
  const projects = useProjectStore(useShallow(s => s.projects));

  const activeFilterCount =
    (sort !== 'default' ? 1 : 0) + filterPriorities.length + filterEfforts.length + (filterHasReminder ? 1 : 0);
  // Only priority/effort/reminder filters narrow which tasks render — sort
  // just reorders them — so only those should suppress a stack's "N/M" tally
  // (see the filtered prop on TaskGroupHeader). Later Today's groups don't go
  // through this filter at all (upcomingTaskIds is unfiltered), so this only
  // applies to the main Today list's group rows below.
  const groupTallyFiltered = filterPriorities.length > 0 || filterEfforts.length > 0 || filterHasReminder;

  // Later, Unscheduled and Inbox get the reminder filter too (#1798), but not
  // priority/effort or sort — those stay Today-only, since Later/Unscheduled
  // already have their own date-driven order and Inbox's whole premise is
  // tasks with no metadata to sort or filter by. Same shape as `filtered`
  // above, minus everything that doesn't apply here.
  const filteredDeferredTasks = useMemo(
    () => (filterHasReminder ? deferredTasks.filter(t => t.reminderTime !== null) : deferredTasks),
    [deferredTasks, filterHasReminder]
  );
  const filteredUnscheduledTasks = useMemo(
    () => (filterHasReminder ? unscheduledTasks.filter(t => t.reminderTime !== null) : unscheduledTasks),
    [unscheduledTasks, filterHasReminder]
  );
  const filteredInboxTasks = useMemo(
    () => (filterHasReminder ? inboxTasks.filter(t => t.reminderTime !== null) : inboxTasks),
    [inboxTasks, filterHasReminder]
  );

  // Every view here stays current on its own (see the tick effect above for
  // Today's), so pulling down on any of the four doesn't refresh anything —
  // it opens quick search. It used to open quick add on Today alone, but the
  // FAB and its add menu already cover adding; searching had no gesture of
  // its own, on any sub-view, and a gesture that worked on one lens but
  // silently did nothing on the other three was hard to learn (#821) —
  // Later, Unscheduled and Inbox all wire the same refreshControl to this.
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

  // ==== the lists: store tasks narrowed to what this view mode shows ====
  const filtered = useMemo(() => {
    let result = visibleTasks;
    if (filterPriorities.length > 0) result = result.filter(t => filterPriorities.includes(t.priority));
    if (filterEfforts.length > 0) result = result.filter(t => filterEfforts.includes(t.effort));
    if (filterHasReminder) result = result.filter(t => t.reminderTime !== null);
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
  }, [visibleTasks, sort, filterPriorities, filterEfforts, filterHasReminder]);

  // The rows the current sub-view is actually showing — what "select all" and
  // the bulk bar's tally operate on.
  const visibleForMode = useMemo(() => {
    switch (viewMode) {
      case 'later': return filteredDeferredTasks;
      case 'unscheduled': return filteredUnscheduledTasks;
      case 'inbox': return filteredInboxTasks;
      default: return filtered;
    }
  }, [viewMode, filteredDeferredTasks, filteredUnscheduledTasks, filteredInboxTasks, filtered]);

  // The pinned block is not in here: it renders above the list as its own
  // header (see pinnedBlock), and a pinned task keeps its ordinary row in this
  // data as well. Two rows for one task, which is the point — pinning now adds
  // a copy at the top rather than moving the original.
  // Headers, tasks and stacks — plus the `context` rows the day's calendar and
  // meal plan fold in, which render here but are never dragged, selected or
  // resolved into a drop (see dayContextRows.ts).
  type ListItem = TodayListItem;

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
  // Built from filteredInboxTasks (not childrenByGroupId) so the children come
  // out in the Inbox's own sortOrder and drop out with the rest of the row
  // when the reminder filter (#1798) doesn't match them.
  const inboxGroupItems = useMemo(() => {
    const byGroup = new Map<string, Task[]>();
    for (const t of filteredInboxTasks) {
      if (!t.groupId) continue;
      const list = byGroup.get(t.groupId);
      if (list) list.push(t);
      else byGroup.set(t.groupId, [t]);
    }
    return taskGroups
      .map(group => ({ group, children: byGroup.get(group.id) ?? [] }))
      .filter(g => g.children.length > 0);
  }, [taskGroups, filteredInboxTasks]);

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
    for (const task of filteredInboxTasks) {
      const header = headerAt.get(task.id);
      if (header) items.push({ type: 'group', group: header.group, children: header.children });
      if (!inGroup.has(task.id)) items.push({ type: 'task', task });
    }
    return items;
  }, [filteredInboxTasks, inboxGroupItems]);

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

  // Keeps the "2/3 planned" counters on the weekly nudge's day tasks current.
  // Mounted here because this is where those rows live; it holds no state of
  // its own and renders nothing (see the hook's own note on why the counts are
  // a separate read from the window below).
  useMealPlanNudgeProgress();

  // Today's planned meals (#1133). Read passively rather than calling
  // loadRange: the store is range-scoped and the Meal Plan screen owns which
  // week is loaded, so Today shows what's already there instead of fighting it
  // for the window.
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
  const setMealCookedPaired = useMealPlanStore(s => s.setCookedPaired);
  const setMealLastAction = useMealPlanStore(s => s.setLastAction);
  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  /**
   * Ticking a meal off from its row here (#1571).
   *
   * One way only, and that isn't a missing half: `mealContextRows` drops a
   * cooked entry, so the row leaves the moment it's ticked and there is no
   * un-tick left to offer. The way back is the undo registered below — the same
   * one the Meal plan screen's own row badge registers, which is why the label
   * matches it word for word.
   *
   * `setCookedPaired` because the recipe's counters have to move with the
   * entry, exactly as they do when a meal task's last step is ticked off two
   * rows up this same list. Null back from it means nothing happened (a stale row, an
   * entry already cooked), so nothing is animated and no undo is stored.
   *
   * The leftover close-out ask (was that the last of it?) used to be raised
   * here too, but it's asked from useTaskStore.completeTask now — that same
   * `setCookedPaired` call ticks the paired task, so this row already gets
   * the ask via FinishLeftoverPrompt without doing it a second time.
   */
  const handleMarkMealCooked = useCallback((entryId: string, title: string) => {
    const undo = setMealCookedPaired(entryId, true);
    if (!undo) return;
    animateLayout();
    setMealLastAction({ label: `Cooked "${title}"`, undo });
  }, [setMealCookedPaired, setMealLastAction]);
  // Resolved rather than read straight through: with the groceries/meals area
  // off, Today shows no meals whatever this is set to, but the setting itself
  // is left alone so turning the area back on restores the shape the user
  // picked. Both render sites below test this one value, so neither can be
  // missed.
  const storedMealsOnToday = useSettingsStore(s => s.mealsOnToday);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const mealsOnToday: MealsOnToday = kitchenEnabled ? storedMealsOnToday : 'off';
  // Today's calendar (#1489) — silent unless the read is on and succeeded.
  // `calendarLoaded` is checked separately from `events` being empty for the
  // reason useCalendarStore documents: an empty day and a failed read both
  // look like `[]`.
  //
  // Demo mode shows none of it, and that exception is the honest one: events
  // are read from EventKit into memory and never touch the database, so the
  // demo's swapped-out db can't seed them — which used to mean handing someone
  // the phone showed them your real meetings. Every other store rides the
  // database swap (see useTaskStore.initialize); this is the one that can't.
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const demoActive = useDemoStore(s => s.active);
  const calendarEvents = useCalendarStore(s => s.events);
  const calendarLoaded = useCalendarStore(s => s.loaded);
  const [eventsSheetVisible, setEventsSheetVisible] = useState(false);
  const todayCalendarDayEnd = useMemo(() => addDays(getDayStart(new Date()), 1), [todayKey]);
  const todayCalendarEvents = useMemo(
    () => (calendarReadEnabled && calendarLoaded && !demoActive
      ? eventsIn(calendarEvents, getDayStart(new Date()), todayCalendarDayEnd)
      : []),
    [calendarReadEnabled, calendarLoaded, demoActive, calendarEvents, todayCalendarDayEnd]
  );

  // The day's events and its uncooked-and-untasked meals, as rows in the list
  // (#1571). Each files under a category — the calendar's own, and the cook
  // tasks' for meals, so a leftover sits with the "Cook X" it isn't one of —
  // and inherits that section's place in the order, its collapse and its
  // focus. `minuteTick` is in the deps because both reads are against the
  // clock: an event drops when it ends and takes on the "Now" emphasis when it
  // starts, and nothing mutates a store at either moment.
  const calendarEventCategory = useSettingsStore(s => s.calendarEventCategory);
  const mealCookTaskCategory = useSettingsStore(s => s.mealCookTaskCategory);
  const use24HourTime = useSettingsStore(s => s.use24HourTime);

  /**
   * What's about to be wasted, and which of today's meals would eat it (#1689).
   *
   * Read straight off the two stores rather than through a new one: the whole
   * feature is the #1670 derivation rendered somewhere else, and giving it its
   * own state here is how a second inventory model starts. `minuteTick` is in
   * the deps because the ladder is against the clock — nothing mutates a store
   * when a use-by day arrives — and the same tick already refreshes the events.
   *
   * Gated on `kitchenEnabled` at the point of use, like `mealsOnToday` above:
   * with the groceries/meals area put away Today says nothing about food, and
   * the setting is left alone so turning the area back on restores it.
   */
  const storedKitchenOnToday = useSettingsStore(s => s.kitchenOnToday);
  // Simplified mode takes the pantry with it (`pantryTracking`), and a row
  // warning that something is about to go off is only useful when there is a
  // screen to go and deal with it on.
  const kitchenOnToday = kitchenEnabled && storedKitchenOnToday
    && !featureHidden('pantryTracking', simpleMode);
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const kitchenEntries = useMemo(
    () => (kitchenOnToday ? kitchenInventory(groceryItems, leftovers, new Date()) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kitchenOnToday, groceryItems, leftovers, minuteTick]
  );
  // Swapped, because the fridge holds what was actually bought: with "always
  // use oat milk for milk" on, the recipe line reads oat milk and oat milk is
  // the carton going off. Same map every shopping read builds.
  const standingSwaps = useMemo(
    () => standingSwapMap(itemSubs, groceryItems),
    [itemSubs, groceryItems]
  );
  const kitchenPlannedUses = useMemo(
    () => plannedUsesToday(kitchenEntries, todayMealEntries ?? [], recipesById, standingSwaps),
    [kitchenEntries, todayMealEntries, recipesById, standingSwaps]
  );

  const contextRows = useMemo(() => {
    const rows: ContextRow[] = [];
    // No category means nowhere to put them — see ensureCalendarEventCategory
    // for why a cleared setting is a real answer rather than a missing one.
    if (calendarEventCategory) {
      rows.push(...eventContextRows(todayCalendarEvents, {
        now: new Date(),
        category: calendarEventCategory,
        use24Hour: use24HourTime,
      }));
    }
    // The kitchen leads the meals it shares a section with, and that ordering
    // is the answer to "warning or plan first" (#1689): insertContextRows keeps
    // the order rows are pushed in, so what's about to be wasted sits at the
    // top of the section holding the day's food. Reading down from there — the
    // spinach, then the dinner that would eat it — is the pairing.
    if (kitchenOnToday && kitchenEntries.length > 0) {
      rows.push(...kitchenContextRows(kitchenEntries, {
        category: mealCookTaskCategory,
        hasUseUpTask: (entry: KitchenEntry) => !!liveGeneratedTask(
          allTasks,
          entry.kind === 'leftover' ? 'leftoverUseUp' : 'groceryUseUp',
          entry.sourceId,
        ),
        plannedUses: kitchenPlannedUses,
      }));
    }
    if (mealsOnToday === 'inline' && todayMealEntries) {
      rows.push(...mealContextRows(todayMealEntries, recipesById, {
        category: mealCookTaskCategory,
        // Either generator covering this meal suppresses its row — the meal
        // task keyed by the day and slot it's in, or a legacy cook task keyed
        // by the meal itself, which still exists for a launch or two after the
        // fold. Captioning a meal that already has a task in the list is the
        // duplication this whole arrangement removed.
        hasCookTask: entry =>
          !!liveGeneratedTask(allTasks, 'mealSlot', mealSlotSourceId(entry.date, entry.slot))
          || !!liveGeneratedTask(allTasks, 'mealCook', entry.id),
      }));
    }
    return rows;
  }, [
    todayCalendarEvents, calendarEventCategory, use24HourTime,
    mealsOnToday, todayMealEntries, recipesById, mealCookTaskCategory, allTasks,
    kitchenOnToday, kitchenEntries, kitchenPlannedUses,
    minuteTick,
  ]);

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
    const grouped = makeCategoryGroups(ungrouped, allCategories, visibleGroupItems, {
      interleaveGroups: sort === 'default',
    });
    // Folded in *here*, before collapse runs over the result, so a context row
    // is hidden by its section's collapse without that growing a special case.
    // It's also what lets a category holding nothing but events have a header
    // at all — makeCategoryGroups only knows about tasks and stacks.
    return insertContextRows(grouped, contextRows, { categoryOrder: allCategories });
  }, [filtered, allCategories, visibleGroupItems, sort, contextRows]);

  // The rows under each category header, for the header's own pin toggle and
  // the pin glyph that reports its state. Built from `listItems` rather than
  // `data` — before collapse and hideCategories run — so a collapsed header
  // still pins the section it has folded away.
  const sectionTasksByCategory = useMemo(() => sectionTasksByLabel(listItems), [listItems]);

  // Whether anything other than the pinned block is on screen.
  const restVisible = !othersHidden;

  const data: ListItem[] = useMemo(() => {
    // "Hide everything else" empties the list rather than collapsing a section
    // inside it: what's hidden is every category section at once, and the
    // pinned block that stays behind isn't in this data to begin with.
    if (!restVisible) return [];
    return stripCategoryHeaders(applyCategoryCollapse(listItems) as unknown as ListItem[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listItems, restVisible, collapsedCategories, hideCategories]);

  const listItemKey = (item: ListItem): string =>
    item.type === 'header' ? `h-${item.label}`
    : item.type === 'group' ? `g-${item.group.id}`
    // Already prefixed by kind (see ContextRow.id), so it can't collide with a
    // task id sharing this list.
    : item.type === 'context' ? item.row.id
    : item.task.id;

  // Set by Today's one list. There used to be two — a plain FlatList swapped
  // in whenever anything was pinned — and the swap is gone with the lift-out.
  const todayRowScroller = useRef<RowScroller | null>(null);
  // Later's counterpart — its ReorderableList never needed one before this,
  // since nothing but a fresh task's jump ever asks Later to scroll anywhere.
  const laterRowScroller = useRef<RowScroller | null>(null);

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

  useEffect(() => {
    if (!pendingLaterJump) return;
    setPendingLaterJump(null);
    laterRowScroller.current?.scrollToKey(pendingLaterJump.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLaterJump]);

  // Unscheduled and Inbox are plain FlatLists with no row-layout tracking of
  // their own, so the scroll is by index rather than by key — and since
  // neither list measures every row up front, a target past what's already
  // rendered needs the onScrollToIndexFailed fallback wired below to retry
  // once RN has measured far enough to know where it is.
  useEffect(() => {
    if (!pendingUnscheduledJump) return;
    setPendingUnscheduledJump(null);
    unscheduledScroll.ref.current?.scrollToIndex({ index: pendingUnscheduledJump.index, animated: true, viewPosition: 0.3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUnscheduledJump]);

  useEffect(() => {
    if (!pendingInboxJump) return;
    setPendingInboxJump(null);
    inboxScroll.ref.current?.scrollToIndex({ index: pendingInboxJump.index, animated: true, viewPosition: 0.3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInboxJump]);

  // What each section header needs to know to leave with its rows when the last
  // of them is ticked off (see CompletionCollapse). Built from `data` — the list
  // as rendered — so a header whose rows a collapsed category has folded away
  // isn't told they're all leaving.
  const sectionTaskIds = useMemo(() => computeSectionTaskIds(data), [data]);

  // Every row per section, for the count a collapsed header shows: task rows,
  // context rows, and each stack's currently-visible children (the same
  // subset `visibleGroupItems` hands the tray itself, so a collapsed header's
  // total matches what expanding it would show). Built from `listItems` —
  // before collapse/hideCategories run — deliberately unlike
  // `sectionTaskIds` below: applyCategoryCollapse strips every task/group/
  // context row out of a *collapsed* section, so reading off `data` would
  // always report a collapsed header's own count as 0, stack or no stack.
  // This also can't come from sectionTaskIds even pre-collapse — that map
  // deliberately drops a whole section the moment it hits a group item (see
  // its own doc comment: a collapsed header must not strand a stack's tray),
  // which would silently drop every task row sharing that category from the
  // count too, and it never counted context rows to begin with (it feeds
  // CompletionCollapse, which animates a header out with the rows being
  // ticked off — a header shouldn't wait on rows that can never complete).
  const sectionDisplayCounts = useMemo(() => {
    const visibleCountByGroupId = new Map(visibleGroupItems.map(g => [g.group.id, g.children.length]));
    const counts = new Map<string, number>();
    let label: string | null = null;
    for (const item of listItems) {
      if (item.type === 'header') {
        label = item.label;
        counts.set(label, 0);
      } else if (label !== null) {
        if (item.type === 'task' || item.type === 'context') {
          counts.set(label, (counts.get(label) ?? 0) + 1);
        } else if (item.type === 'group') {
          const visibleCount = visibleCountByGroupId.get(item.group.id) ?? 0;
          counts.set(label, (counts.get(label) ?? 0) + visibleCount);
        }
      }
    }
    return counts;
  }, [listItems, visibleGroupItems]);

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

  // The settled layout a drop hands back, with the day's context rows put back
  // into it. resolveDrop is deliberately blind to them (they carry no order to
  // commit), so its `settled` is tasks-and-headers only — and setting that
  // straight into the list would blink the events out for the frame or two
  // before the store-derived `data` catches up.
  const settleWithContext = (settled: CategoryListItem[]): ListItem[] =>
    // resolveDrop always rebuilds `settled` with headers (its own job stops at
    // category resolution); strip them back out here so the preview matches
    // the store-derived `data`, which runs stripCategoryHeaders after it.
    stripCategoryHeaders(
      insertContextRows(settled, contextRows, { categoryOrder: allCategories }),
    );

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
  // Same scroller and the same measured viewport (FabDropZoneProvider's own),
  // handed to the nested SortableLists that reorder the pinned block and a
  // stack's children — both sit inside this same list and can run past
  // viewport height, so dragging a row in either one to the screen's edge
  // should autoscroll this list exactly as the add-button drag already does.
  // Stable identity (both refs, built once) so it isn't a fresh object every
  // render for SortableList's autoscroll-prop effect to resync.
  const pinnedAndStackAutoscroll = useMemo(() => ({
    scroller: todayScrollControl,
    getViewport: () => dropZonesRef.current?.getViewport() ?? { top: 0, bottom: 0 },
  }), []);
  // What the drag is currently aimed at goes through a channel rather than
  // state: it changes as the finger crosses each row, and re-rendering this
  // screen re-runs every row's renderItem. The two things that do change with
  // it — the label on the button, the highlight on a stack — subscribe.
  const fabIntentChannel = useFabIntentChannel();
  const [quickAddSeed, setQuickAddSeed] = useState<
    | {
        category?: string | null;
        groupId?: string;
        pinned?: boolean;
        dueDate?: string | null;
        timeSegments?: TimeOfDay[];
        windowStart?: string | null;
        windowEnd?: string | null;
      }
    | undefined
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
  // ==== drag-and-drop drop zones (see resolveDrop in src/utils/reorder.ts) ====
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

  // Inbox tasks carry no category by definition (isInboxTask), so every row's
  // zone is uncategorized — a stack row joins it (mirroring Today's own
  // 'group' zone), a loose task only marks a sort position.
  const inboxZoneByKey = useMemo(() => {
    const map = new Map<string, DropZone>();
    inboxData.forEach(item => {
      const key = listItemKey(item);
      if (item.type === 'group') {
        map.set(key, { kind: 'group', key, groupId: item.group.id, groupTitle: item.group.title, category: null });
      } else if (item.type === 'task') {
        map.set(key, { kind: 'task', key, category: null });
      }
    });
    return map;
  }, [inboxData]);

  // Flattest of the four sub-views — no headers, no stacks, so every row is
  // the same 'task' zone kind, sort-position only. Built off the filtered set
  // (#1798), matching listItems' own filtered-not-raw drop zones on Today.
  const unscheduledZoneByKey = useMemo(() => {
    const map = new Map<string, DropZone>();
    filteredUnscheduledTasks.forEach(task => {
      map.set(task.id, { kind: 'task', key: task.id, category: null });
    });
    return map;
  }, [filteredUnscheduledTasks]);

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
    const dropped = withoutContextRows(spliced);
    const { taskOrders, categoryUpdates, groupUpdates, settled } = resolveDrop(dropped, {
      isUpcoming: id => upcomingTaskIds.has(id),
      showUpcoming,
      categoryOrder: allCategories,
    });
    setDraggableData(settleWithContext(settled));
    groupUpdates.forEach(u => {
      updateGroup(u.id, { category: u.category, sortOrder: u.sortOrder });
      applyGroupCategory(u.id, u.category);
    });
    // No "this task or this and future occurrences?" prompt, unlike the drag
    // path: a task created a moment ago has no other occurrences to apply to.
    reorderWithCategoryUpdates(taskOrders, categoryUpdates);
  };

  /**
   * Later's counterpart to placeCreatedTask — splice the new row into the
   * flattened day/segment list at the drop point and hand the whole thing to
   * reorderTasks, the same commit a finished row drag runs (see the
   * ReorderableList's own onReorder just below).
   */
  const placeCreatedLaterTask = (task: Task, intent: Extract<FabDropIntent, { kind: 'insert' }>) => {
    // The date the sheet actually committed wins, same rule as Today's
    // category check — a date changed in the sheet means the task belongs
    // wherever that lands it, not where the button was dropped.
    if (!intent.schedule || (task.dueDate ?? null) !== intent.schedule.dueDate) return;
    const anchor = laterDraggableData.findIndex(item => item.key === intent.anchorKey);
    if (anchor < 0) return;

    const spliced = [...laterDraggableData];
    spliced.splice(intent.before ? anchor : anchor + 1, 0, { type: 'task', task, key: task.id });
    setLaterDraggableData(spliced);
    reorderTasks(laterTaskOrder(spliced));
  };

  /** Shared by Inbox and Unscheduled: splice the new task's id into a flat id
   * order and hand it to reorderTasks — no categories, no stacks, nothing
   * resolveDrop's machinery is for. */
  const placeCreatedInFlatOrder = (ids: string[], anchorId: string, taskId: string, before: boolean) => {
    const anchor = ids.indexOf(anchorId);
    if (anchor < 0) return;
    const spliced = [...ids];
    spliced.splice(before ? anchor : anchor + 1, 0, taskId);
    reorderTasks(spliced);
  };

  const placeCreatedInboxTask = (task: Task, intent: Extract<FabDropIntent, { kind: 'insert' }>) => {
    const ids = inboxData.flatMap(item =>
      item.type === 'group' ? item.children.map(c => c.id) : item.type === 'task' ? [item.task.id] : [],
    );
    placeCreatedInFlatOrder(ids, intent.anchorKey, task.id, intent.before);
  };

  const placeCreatedUnscheduledTask = (task: Task, intent: Extract<FabDropIntent, { kind: 'insert' }>) => {
    placeCreatedInFlatOrder(filteredUnscheduledTasks.map(t => t.id), intent.anchorKey, task.id, intent.before);
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
        if (intent.schedule) {
          // A Later day/time section — seeds the same fields the row's own
          // reschedule action writes (see ScheduleInfo).
          setQuickAddSeed({
            dueDate: intent.schedule.dueDate,
            timeSegments: intent.schedule.timeSegments as TimeOfDay[],
            windowStart: intent.schedule.windowStart,
            windowEnd: intent.schedule.windowEnd,
          });
          setQuickAddSeedLabel(intent.schedule.label);
        } else {
          setQuickAddSeed({ category: intent.category });
          setQuickAddSeedLabel(
            intent.category ? categoryLabel(intent.category, categories) : 'This spot',
          );
        }
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
  // (see SortableList's onDragStateChange). Keyed by group id, not a plain
  // bool, so only the tray actually being dragged in gets lifted above its
  // siblings below — see the list's `rowElevated`.
  const [draggingStackChildGroupId, setDraggingStackChildGroupId] = useState<string | null>(null);
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

  // Tracks a "drag onto a group to join it" gesture while a plain loose task
  // is being dragged: set from onDragMove below whenever the dragged card
  // sits over a group — header or children — and cleared the moment it isn't.
  // Read once at drop time in onDragEnd.
  const joinGroupIntentRef = useRef<string | null>(null);
  const [joinGroupIntentId, setJoinGroupIntentId] = useState<string | null>(null);
  // Task the drop just handed to a group (set in onDragEnd, which runs before
  // onReorder), so the placement pass below leaves it alone — it belongs to
  // the group now, not to whatever slot it was let go over.
  const joinedTaskIdRef = useRef<string | null>(null);

  // Same shape as joinGroupIntentRef/joinedTaskIdRef above, for dragging a
  // task onto the Pinned Tasks block instead of into a group. `overHeader`
  // reports the card sitting over ReorderableList's ListHeaderComponent —
  // here, the pinned block — so there's no group id to track, just whether
  // the drop is currently aimed there.
  const pinIntentRef = useRef(false);
  const [pinIntentActive, setPinIntentActive] = useState(false);
  const pinnedTaskIdRef = useRef<string | null>(null);
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

  const handleGroupComplete = useCallback((groupId: string) => {
    // A stack's cascade is a bulk completion like any other, so it gets the
    // same question. skipIds is what keeps the members being asked about out
    // of the cascade until they've been answered.
    const roster = useTaskStore.getState().groupRosterOf(groupId);
    requestComplete({
      ids: roster.filter(t => !t.completed).map(t => t.id),
      complete: skipIds => completeGroup(groupId, { skipIds }),
    });
  }, [completeGroup, requestComplete]);
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
  // ==== row renderers ====
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
        // Handed to the row rather than bound here in an arrow: a fresh arrow
        // per row per render defeats TaskItem's memo, and on this screen that
        // means every mounted row re-renders on every store write — including
        // the one a stack's own collapse toggle makes, in the frame its 250ms
        // height animation starts. Neither list virtualizes, so "every mounted
        // row" is every row Today has (see ReorderableList's dragHandlerFor,
        // which is the same fix on the other unstable prop).
        onPress={handleRowPress}
        rowKey={opts?.rowKey}
        expanded={expandedTaskId === rowKey}
        spotlightDisabled={expandedTaskId !== null && expandedTaskId !== rowKey && !selectionMode}
        onEdit={handleRowEdit}
        subtaskCount={subs.items.length}
        subtaskDoneCount={subs.doneCount}
        subtasks={subs.items}
        onSubtaskDragStateChange={setDraggingSubtask}
        // Stable per row, from either list: both cache one `drag` callback per
        // row key for the life of that key (ReorderableList's dragHandlerFor,
        // and SortableList's, which is what a stack's children come through).
        // Neither caches anything about the PanResponder itself, so the
        // lifecycle their headers warn about is untouched.
        //
        // It is `undefined` throughout selection mode anyway, which is where
        // the expensive case lives — a paint drag mutates the selection on
        // every frame, and with the memo only the rows whose `selected`
        // flipped re-render.
        drag={
          selectionMode || !opts?.drag || upcomingTaskIds.has(task.id) ? undefined : opts.drag
        }
        isActive={opts?.isActive}
        selectionMode={selectionMode}
        selected={selectedIds.has(task.id)}
        onSelect={toggleSelection}
        onSwipeSelect={handleRowSwipeSelect}
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
      const categoryTasks = isCategory ? sectionTasksByCategory.get(item.label) ?? NO_GROUP_CHILDREN : NO_GROUP_CHILDREN;
      const allPinned = categoryTasks.length > 0 && categoryTasks.every(t => t.pinned);
      return (
        <CompletionCollapse taskIds={sectionIds}>
          <SectionHeader
            label={isCategory ? categoryLabel(item.label, categories) : item.label}
            styles={styles}
            colors={colors}
            collapsed={isCategory ? collapsedCategories.has(item.label) : undefined}
            onToggle={isCategory ? () => toggleCategoryCollapse(item.label) : undefined}
            onLongPress={isCategory ? () => handlePinCategory(item.label) : undefined}
            allPinned={isCategory ? allPinned : undefined}
            count={isCategory ? sectionDisplayCounts.get(item.label) ?? 0 : undefined}
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
              dragging={draggingStackChildGroupId === item.group.id}
            >
              <SortableList
                data={item.children}
                onReorder={reordered => reorderGroupChildren(item.group.id, reordered.map(t => t.id))}
                onDragOut={task => removeFromGroup(task.id)}
                onDragStateChange={dragging => setDraggingStackChildGroupId(dragging ? item.group.id : null)}
                // The same drop slot the main list leaves behind — a stack's
                // rows are the main list's rows, so the gap should read the same.
                placeholderStyle={styles.stackDropSlot}
                autoscroll={pinnedAndStackAutoscroll}
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

    // Never handed `drag`: the app doesn't own these rows, so there is no
    // order to commit and nothing for resolveDrop to place. Same as a section
    // header, which is also in this data and also static.
    if (item.type === 'context') {
      return (
        <DayContextRow
          row={item.row}
          onPress={
            item.row.kind === 'event' ? () => setEventsSheetVisible(true)
            // Every kitchen row lands in the same place, per-item and summary
            // alike: the merged inventory is where both halves are corrected,
            // and it asks the two-way question a row's glyph can't (#1689).
            // Same navigation openMealPlan below makes for a meal row — the
            // Kitchen screen is a hub tab now, not a sheet this screen owns.
            : item.row.kind === 'kitchen' ? () => navigation.navigate('Kitchen' as never)
            : openMealPlan
          }
          onMarkCooked={
            item.row.kind === 'meal'
              ? () => handleMarkMealCooked(item.row.sourceId, item.row.title)
              : undefined
          }
        />
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
  // the real count for a stack that also has members due today. `filtered`
  // is the reminder filter (#1798): with it on, `children` below is a subset
  // of the roster the tally is computed from, so the badge would misstate
  // what's actually rendered underneath it — same call groupTallyFiltered
  // makes for Today's own stacks.
  const renderInboxGroup = (group: TaskGroup, children: Task[]) => {
    const allChildren = childrenByGroupId.get(group.id) ?? NO_GROUP_CHILDREN;
    return (
      <TaskGroupTray>
        <TaskGroupHeader
          group={group}
          allChildren={allChildren}
          filtered={filterHasReminder}
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
    //
    // The trailing spacer (outside the zone, so it isn't part of the drop
    // target) is what stops the block visually fusing with an uncategorized
    // task's row right below it — that section deliberately has no header
    // (see makeCategoryGroups), so without it the pinned block's last card and
    // the next task's card sit back to back with only the ordinary 2px
    // inter-row gap, reading as one section.
    <>
    <GroupDropTarget active={pinIntentActive}>
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
          {/* Gone during a bulk edit (same reasoning as Clear, right below)
              and while a session is already running — there's nothing to
              start. Opens the ordinary setup sheet seeded from this block
              instead of the suggester, so the window, plan preview and swap
              still apply; see FocusSetupSheet's pinnedSeed prop. The "…" menu's
              "Reach out to people" row is the same idea (reachOutSeed) — that
              one lives there rather than here because it has nothing to
              anchor a header button to; there's no pinned-tasks-style block
              a reach-out set renders inside. */}
          {!selectionMode && !focusSession && (
            <TouchableOpacity
              onPress={() => {
                haptics.tap();
                setFocusFromReachOuts(false);
                setFocusFromPinned(true);
                setFocusSetupVisible(true);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Start a focus session with pinned tasks"
            >
              <Ionicons name="hourglass-outline" size={iconSize.sm} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          {/* Gone during a bulk edit. It unpins every task in one tap, with no
              confirm and no undo, and it sits a thumb's width from the rows
              being tapped in a mode whose whole gesture is tapping rows — so
              the one control here that ignores the selection is also the most
              expensive thing to hit by accident. Unpinning has a home in that
              mode already, and it's the right one: the bulk bar's Pin/Unpin,
              which acts on what was picked. The eye stays, because hiding
              everything but the pinned tasks is a way to *see* the rows you're
              selecting among, and it's reversible by tapping it again. */}
          {!selectionMode && (
            <TouchableOpacity onPress={clearAllPins} hitSlop={8} accessibilityRole="button">
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        <SpotlightScrim />
      </Pressable>
      <SortableList
        data={pinnedTasks}
        onReorder={next => reorderPinnedTasks(next.map(t => t.id))}
        onDragStateChange={setDraggingPin}
        placeholderStyle={styles.stackDropSlot}
        autoscroll={pinnedAndStackAutoscroll}
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
    </GroupDropTarget>
    <View style={styles.pinnedBlockFooter}>
      <SpotlightScrim />
    </View>
    </>
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
  // Expands/unhides whatever in Today's own list is folding a task away
  // (collapsed category, "everything else" hidden, a collapsed stack, a
  // category filter aimed elsewhere) and queues the scroll to its row.
  // Returns false if the task has no row in this list at all — a filter is
  // hiding it, not just folding it — so a caller can fall back to opening it
  // directly. Shared by jumpToTask and handleTaskCreated.
  const revealTaskInToday = (task: Task): boolean => {
    // Resolved against the pre-collapse list, so a task folded away still has
    // a row to aim at.
    const target = findTaskJumpTarget(listItems, task.id, listItemKey);
    if (!target) return false;
    const expandCategory = target.category !== null && collapsedCategories.has(target.category);
    // Every row but the pinned block is behind the hide, and the jump target is
    // always one of those (the block isn't in `listItems`), so a jump while
    // hidden has nothing to land on until the sections are back.
    const unhide = othersHidden;
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
    return true;
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
    // Nothing to land on means a filter is hiding it — open it instead of
    // eating the tap.
    if (!revealTaskInToday(task)) {
      openEditor(task);
      return;
    }
    haptics.tap();
    flashTask(task.id);
  };

  // The quiet-projects banner used to sit here, above the pinned block. It's a
  // real task now (see utils/projectReviewTasks.ts), so the offer arrives in
  // the list rather than as a strip over it and there is nothing left to put
  // in the header but the pinned block itself.
  const todayListHeader = pinnedBlock;

  const today = format(new Date(), 'EEEE, MMMM d');


  // Split in two memos on purpose. The ordering is the O(every deferred task)
  // half and depends only on the deferred set; the grouping is bounded by the
  // row budget below and reruns each time that budget grows a page. Grouping
  // used to run over everything and be truncated afterwards, so the budget
  // bounded how many rows mounted but not what it cost to work out which.
  const laterOrder = useMemo(() => laterVisibleOrder(filteredDeferredTasks), [filteredDeferredTasks]);

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

  // Leaving Later drops the budget back: the list unmounts and returns
  // scrolled to the top, so anything it had paged in is just rows the next
  // switch would pay to mount off-screen.
  //
  // Both directions wait for the switch to settle. The ramp *up* always has,
  // for the reason above; the reset used to run synchronously on the commit
  // that left Later, which put a second full render of this screen (the budget
  // shrinks → laterData → laterDraggableData) in the very frame already
  // unmounting sixty TaskItems and mounting the destination list. Nothing
  // needs it to be that early — the list it prunes is already gone. Deferring
  // it also means switching out and straight back keeps the settled budget
  // rather than paying to re-mount the same rows: the pending reset is
  // cancelled by this effect's own cleanup, and the ramp-up that replaces it
  // is a Math.max.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setLaterTaskLimit(limit =>
        viewMode === 'later' ? Math.max(limit, LATER_SETTLED_TASK_LIMIT) : LATER_INITIAL_TASK_LIMIT,
      );
    });
    return () => handle.cancel();
  }, [viewMode]);

  const { sections: visibleLaterSections, hasMore: hasMoreLaterSections } = useMemo(
    () => laterDaySections(laterOrder, laterTaskLimit),
    [laterOrder, laterTaskLimit],
  );

  const laterData = useMemo(() => flattenLaterSections(visibleLaterSections), [visibleLaterSections]);
  // Synced during render (comparing against a ref), same as Today's own
  // draggableData above — a useEffect sync lands a frame late, which is what
  // made switching to Later always flash "Nothing deferred" (the stale,
  // still-empty laterDraggableData from before the switch) alongside a
  // correctly-computed "Loading more" footer (already reflecting the real,
  // paginated laterData) for one frame before the effect caught up.
  const [laterDraggableData, setLaterDraggableData] = useState<LaterListItem[]>(laterData);
  const syncedLaterDataRef = useRef(laterData);
  if (syncedLaterDataRef.current !== laterData) {
    syncedLaterDataRef.current = laterData;
    setLaterDraggableData(laterData);
  }

  // One zone per row, keyed the same way ReorderableList's own keyExtractor
  // reads them (item.key) — see laterDropZones for what a header/subheader/
  // task zone each carry.
  const laterZoneByKey = useMemo(() => {
    const zones = laterDropZones(laterDraggableData);
    const map = new Map<string, DropZone>();
    laterDraggableData.forEach((item, i) => map.set(item.key, zones[i]));
    return map;
  }, [laterDraggableData]);

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

  // Dropped by simplified mode: "40m done · 2h 15m planned" is a reading of the
  // day rather than a part of it, and it needs the effort ratings that mode
  // also takes away.
  const workloadSubtitle =
    viewMode === 'today' && !featureHidden('workloadSubtitle', simpleMode)
    && (plannedLabel || completedTodayLabel)
      ? [
          completedTodayLabel ? `${completedTodayLabel} done` : undefined,
          plannedLabel ? `${plannedLabel} planned` : undefined,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;

  // Later, Unscheduled and Inbox share Today's filter icon and sheet (#1798),
  // but only the reminder filter applies there — sort and priority/effort stay
  // Today-only (see filteredDeferredTasks and friends above) — so their badge
  // is just that one chip, not the combined Today count.
  const viewFilterCount = viewMode === 'today' ? activeFilterCount : (filterHasReminder ? 1 : 0);

  const headerActions: ScreenHeaderAction[] = [
    {
      icon: 'funnel' as const,
      onPress: () => setFilterVisible(true),
      active: viewFilterCount > 0,
      badge: viewFilterCount,
      accessibilityLabel: 'Sort and filter',
    },
    ...(viewMode === 'today' && !featureHidden('suggestedPins', simpleMode)
      && pinnedTasks.length < MAX_SUGGESTED_PINS && visibleTasks.length > 0
      ? [{
          icon: 'color-wand' as const,
          onPress: () => setSuggestedPinsVisible(true),
          active: pinnedTasks.length === 0,
          tint: 'orange' as const,
          accessibilityLabel: 'Suggest pin tasks',
        }]
      : []),
    // A focus session outlives the switch being flipped, so the way back into a
    // running one stays whatever the mode says — same call the recipe-timer dot
    // on the More tab makes about `kitchenEnabled`. Only starting a new one goes.
    ...(viewMode === 'today' && (!featureHidden('focusSessions', simpleMode) || focusSession)
      ? [{
          icon: 'hourglass-outline' as const,
          onPress: () => {
            if (focusSession) {
              setFocusSessionVisible(true);
              return;
            }
            setFocusFromPinned(false);
            setFocusFromReachOuts(false);
            setFocusSetupVisible(true);
          },
          active: focusSession !== null,
          accessibilityLabel: focusSession ? 'Focus session running' : 'Start a focus session',
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
  ];

  // ==== render. Everything below is JSX ====
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
          {viewModes.map(mode => {
            const active = viewMode === mode;
            const badge = mode === 'inbox'
              ? inboxTasks.length
              : mode === 'unscheduled' ? unscheduledCount : 0;
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
                  badge > 0
                    ? `${VIEW_TITLES[mode]} view, ${badge} ${VIEW_BADGE_LABELS[mode]}`
                    : `${VIEW_TITLES[mode]} view`
                }
              >
                <Text style={[styles.viewModePillText, active && styles.viewModePillTextActive]}>
                  {VIEW_TITLES[mode]}
                </Text>
                {badge > 0 && (
                  <View style={[styles.viewModePillBadge, mode !== 'inbox' && styles.viewModePillBadgeQuiet]}>
                    <Text
                      style={[
                        styles.viewModePillBadgeText,
                        mode !== 'inbox' && styles.viewModePillBadgeTextQuiet,
                      ]}
                    >
                      {badge}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Outside the `viewMode` gate on purpose: a session runs against the
            tasks, not against a lens over them, so switching to Later must
            not make it look as though it stopped. */}
        {focusSession && <FocusBar onOpen={() => setFocusSessionVisible(true)} />}

        {viewMode === 'today' && newTasks.length > 0 && (
          <NewTasksBanner tasks={newTasks} onJumpToTask={jumpToTask} onDismiss={dismissNewTasksBanner} />
        )}

        {/* Last of the things above the list, because it's the least urgent of
            them by a distance: anything the app actually has to *ask* is above
            it, and a tip is only ever an aside.

            Explicitly suppressed while the new-tasks banner is up, which is
            the one competing notice this screen knows the state of. The other
            thing a tap here can raise, the post-cook sheet, is raised from the
            navigator and covers the screen rather than sharing it, so a tip
            underneath is never a thing you have to read past. See
            `chooseTip`. */}
        {viewMode === 'today' && newTasks.length === 0 && <TipHost screen="today" />}

        {/*
          Nothing about the day's calendar or its menu renders above the list
          any more. Both were a fixed block here — which meant the top of the
          Today screen was never a task — and both are rows in the list itself
          now (see contextRows / dayContextRows.ts). Nor does the kitchen render
          anything here any longer: what a cooking asks is a sheet raised from
          the navigator (CookRecap), not a banner this screen has to make room
          for above its own list.
        */}
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
          // Only Today's own ReorderableList hands this ref a live
          // DragScroller (scrollControlRef, below) — Later/Unscheduled/Inbox
          // don't wire autoscroll yet (#807's own note), so the drag simply
          // doesn't scroll their lists rather than driving a stale Today ref.
          scroller={viewMode === 'today' ? todayScrollControl : undefined}
        >
        {viewMode === 'later' && (
          <ReorderableList
            scrollEnabled={!painting && !draggingSubtask}
            rowScrollerRef={laterRowScroller}
            data={laterDraggableData}
            keyExtractor={item => item.key}
            // See the Today list's own note: an expanded row's card shadow
            // falls across the row below it.
            rowElevated={item => item.type === 'task' && item.task.id === expandedTaskId}
            renderItem={({ item, drag, isActive }) => {
              let content: React.ReactNode;
              if (item.type === 'header') {
                content = (
                  <Pressable style={styles.sectionHeader} onPress={() => setExpandedTaskId(null)}>
                    <Text style={styles.sectionHeaderText}>{item.label}</Text>
                    <SpotlightScrim />
                  </Pressable>
                );
              } else if (item.type === 'subheader') {
                content = (
                  <Pressable style={styles.laterSubHeader} onPress={() => setExpandedTaskId(null)}>
                    <View
                      style={[
                        styles.laterSubHeaderDot,
                        { backgroundColor: item.segment ? segmentColors[item.segment] : colors.textTertiary },
                      ]}
                    />
                    <Text style={styles.laterSubHeaderText}>{item.label}</Text>
                    <SpotlightScrim />
                  </Pressable>
                );
              } else {
                const subs = subtasksByParent.get(item.task.id) ?? NO_SUBTASKS;
                content = (
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
                    showCategory
                    showProject
                    showGroup
                    showActions={false}
                    highlighted={item.task.id === flashTaskId}
                  />
                );
              }
              // Row drags of their own take the responder, same reasoning as
              // Today's renderItem: the dragged row's floating overlay copy
              // must not steal the real row's registered slot.
              const zone = isActive ? null : laterZoneByKey.get(item.key) ?? null;
              return <FabDropZone zone={zone}>{content}</FabDropZone>;
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
                : [styles.listContent, extraListBottomPadding !== undefined && { paddingBottom: extraListBottomPadding }]
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
                  subtitle={
                    filterHasReminder && deferredTasks.length > 0
                      ? 'No tasks match this filter'
                      : 'Swipe a task right to defer it'
                  }
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
                {listFooter(laterOrder.length === 0)}
              </>
            }
            refreshControl={
              <RefreshControl
                refreshing={pullingToSearch}
                onRefresh={handlePullToSearch}
                tintColor={colors.textSecondary}
              />
            }
          />
        )}

        {viewMode === 'today' && (
          <ReorderableList
            // The user can't scroll during an add-button drag (the button's
            // responder has the touch); the drag scrolls it instead, through
            // this control.
            scrollEnabled={!painting && !fabDragging && !draggingStackChildGroupId && !draggingSubtask && !draggingPin}
            scrollControlRef={todayScrollControl}
            rowScrollerRef={todayRowScroller}
            data={draggableData}
            keyExtractor={listItemKey}
            renderItem={renderItem}
            // Two rows draw outside their own slot and so have to be lifted
            // over the ones below them: a stack whose child is being dragged
            // (the nested SortableList's floating card only paints above its
            // own siblings inside the tray, so it disappears under the next
            // row down the moment it crosses the tray's edge), and an expanded
            // row, whose card shadow falls across its neighbour.
            rowElevated={item =>
              (item.type === 'group' && item.group.id === draggingStackChildGroupId) ||
              (item.type === 'task' && item.task.id === expandedTaskId)
            }
            ListHeaderComponent={todayListHeader}
            onDragBegin={() => {
              setExpandedTaskId(null);
              joinedTaskIdRef.current = null;
              pinnedTaskIdRef.current = null;
              pinIntentRef.current = false;
              setPinIntentActive(false);
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
              const pinTarget = pinIntentRef.current;
              pinIntentRef.current = false;
              setPinIntentActive(false);
              // The join/pin lands here rather than in onReorder: a drop onto a
              // group or the pinned block leaves the list order untouched (the
              // list stops reordering once it's aimed at either), and onReorder
              // stays silent when nothing moved. `committed` keeps a cancelled
              // drag — touch loss, app switch — from quietly stacking or
              // pinning the task.
              const dragged = draggableData[activeDragIndexRef.current ?? -1];
              if (committed && joinGroupId !== null && dragged?.type === 'task') {
                joinedTaskIdRef.current = dragged.task.id;
                addExistingToGroup(dragged.task.id, joinGroupId);
                haptics.success();
              } else if (committed && pinTarget && dragged?.type === 'task') {
                pinnedTaskIdRef.current = dragged.task.id;
                updateTask(dragged.task.id, { pinned: true });
                haptics.success();
              }
              // Unconditional: the guard this used to carry read a
              // render-stale draggingGroupId, so a drag that began and ended
              // before the state update committed left it set.
              setDraggingGroupId(null);
            }}
            onHoverChange={haptics.dragTick}
            onDragMove={({ overIndex, overHeader }) => {
              const draggedItem = draggableData[activeDragIndexRef.current ?? -1];
              // Only a plain loose task can be dragged onto a group, or onto
              // the pinned block, to join/pin it.
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
              const nextId = target ? target.id : null;
              if (nextId !== joinGroupIntentRef.current) {
                joinGroupIntentRef.current = nextId;
                setJoinGroupIntentId(nextId);
                if (nextId) haptics.impactLight();
              }
              // Already-pinned task hovering its own block would be a no-op
              // write, so it's left out of the intent rather than treated as a
              // target.
              const wantsPin = nextId === null && overHeader && !draggedItem.task.pinned;
              if (wantsPin !== pinIntentRef.current) {
                pinIntentRef.current = wantsPin;
                setPinIntentActive(wantsPin);
                if (wantsPin) haptics.impactLight();
              }
            }}
            // Aiming at a group or the pinned block takes the drag over: the
            // list stops opening a reorder gap, so the target stays put under
            // the card instead of sliding away from the finger chasing it.
            dropDisabled={joinGroupIntentId !== null || pinIntentActive}
            dropIntoIndex={
              joinGroupIntentId === null
                ? null
                : draggableData.findIndex(i => i.type === 'group' && i.group.id === joinGroupIntentId)
            }
            dropIntoHeader={pinIntentActive}
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
              // Context rows ride along in the list but never in a drop — see
              // withoutContextRows, and settleWithContext for the way back.
              const dropped = withoutContextRows(reordered);

              const joinedTaskId = joinedTaskIdRef.current;
              joinedTaskIdRef.current = null;
              const pinnedTaskId = pinnedTaskIdRef.current;
              pinnedTaskIdRef.current = null;
              // The two are mutually exclusive (the card can only be over one
              // drop target at release), but read both defensively rather than
              // assuming it.
              const absorbedTaskId = joinedTaskId ?? pinnedTaskId;

              // A task dragged onto a group, or onto the Pinned Tasks block
              // (see onDragMove), has already been handled in onDragEnd — drop
              // it from the normal placement pass so resolveDrop never assigns
              // it a category/order of its own.
              if (absorbedTaskId !== null) {
                const withoutJoined = dropped.filter(
                  item => !(item.type === 'task' && item.task.id === absorbedTaskId),
                );
                const { taskOrders, categoryUpdates, groupUpdates, settled } = resolveDrop(withoutJoined, {
                  isUpcoming: id => upcomingTaskIds.has(id),
                  showUpcoming,
                  categoryOrder: allCategories,
                });
                groupUpdates.forEach(u => {
                  updateGroup(u.id, { category: u.category, sortOrder: u.sortOrder });
                  applyGroupCategory(u.id, u.category);
                });
                setDraggableData(settleWithContext(settled));
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
                setDraggableData(settleWithContext(settled));
                groupUpdates.forEach(u => {
                  updateGroup(u.id, { category: u.category, sortOrder: u.sortOrder });
                  applyGroupCategory(u.id, u.category);
                });
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
              // `data.length` as well as `filtered.length`: a day with no tasks
              // but something on the calendar still has rows to lay out, and
              // the centering this style does is for a genuinely empty screen.
              filtered.length === 0 && data.length === 0
                ? styles.emptyContainer
                : [styles.listContent, extraListBottomPadding !== undefined && { paddingBottom: extraListBottomPadding }]
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
              listFooter(filtered.length === 0 && data.length === 0)
            }
          />
        )}

        {viewMode === 'unscheduled' && (
          <FlatList
            ref={unscheduledScroll.ref}
            scrollEnabled={!painting && !draggingSubtask}
            data={filteredUnscheduledTasks}
            keyExtractor={t => t.id}
            // No getItemLayout (rows are variable-height), so a target past
            // what's mounted so far fails the first attempt — retry once RN's
            // own estimate has caught up.
            onScrollToIndexFailed={info => {
              setTimeout(() => {
                unscheduledScroll.ref.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.3 });
              }, 100);
            }}
            {...unscheduledScroll.props}
            renderItem={({ item }) => {
              const subs = subtasksByParent.get(item.id) ?? NO_SUBTASKS;
              return (
                <FabDropZone zone={unscheduledZoneByKey.get(item.id) ?? null}>
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
                    showCategory
                    showProject
                    highlighted={item.id === flashTaskId}
                  />
                </FabDropZone>
              );
            }}
            contentContainerStyle={
              filteredUnscheduledTasks.length === 0
                ? styles.emptyContainer
                : [styles.listContent, extraListBottomPadding !== undefined && { paddingBottom: extraListBottomPadding }]
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
                  subtitle={
                    filterHasReminder && unscheduledTasks.length > 0
                      ? 'No tasks match this filter'
                      : "Tasks with no due date land here once they're organized"
                  }
                  bottomOffset={tabBarHeight}
                />
              )
            }
            ListFooterComponent={
              <TouchableOpacity
                style={[styles.listFooter, filteredUnscheduledTasks.length === 0 && styles.listFooterFixed]}
                activeOpacity={1}
                onPress={() => setExpandedTaskId(null)}
              />
            }
            ListFooterComponentStyle={filteredUnscheduledTasks.length === 0 ? undefined : styles.listFooterCell}
            refreshControl={
              <RefreshControl
                refreshing={pullingToSearch}
                onRefresh={handlePullToSearch}
                tintColor={colors.textSecondary}
              />
            }
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
            onScrollToIndexFailed={info => {
              setTimeout(() => {
                inboxScroll.ref.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.3 });
              }, 100);
            }}
            {...inboxScroll.props}
            renderItem={({ item }) => {
              const content =
                item.type === 'group'
                  ? renderInboxGroup(item.group, item.children)
                  : item.type === 'task'
                    ? renderInboxTask(item.task)
                    : null;
              if (content === null) return null;
              return <FabDropZone zone={inboxZoneByKey.get(listItemKey(item)) ?? null}>{content}</FabDropZone>;
            }}
            contentContainerStyle={
              inboxData.length === 0
                ? styles.emptyContainer
                : [styles.listContent, extraListBottomPadding !== undefined && { paddingBottom: extraListBottomPadding }]
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
                  subtitle={
                    filterHasReminder && inboxTasks.length > 0
                      ? 'No tasks match this filter'
                      : 'Voice-added and quick tasks land here to be sorted.'
                  }
                  bottomOffset={tabBarHeight}
                />
              )
            }
            ListFooterComponent={
              <TouchableOpacity
                style={[styles.listFooter, inboxData.length === 0 && styles.listFooterFixed]}
                activeOpacity={1}
                onPress={() => setExpandedTaskId(null)}
              />
            }
            ListFooterComponentStyle={inboxData.length === 0 ? undefined : styles.listFooterCell}
            refreshControl={
              <RefreshControl
                refreshing={pullingToSearch}
                onRefresh={handlePullToSearch}
                tintColor={colors.textSecondary}
              />
            }
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
            drag={fabDrag}
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

        {/* Opened by pulling any of the four lists down — Today, Later,
            Unscheduled and Inbox all wire the same refreshControl to it. */}
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
          onApplied={tasks => { if (tasks[0]) openEditor(tasks[0]); }}
        />

        <DeliverablePromptQueue {...queueProps} />

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
          remindersOnly={viewMode !== 'today'}
          sort={sort}
          onSortChange={setSort}
          priorities={filterPriorities}
          onPrioritiesChange={setFilterPriorities}
          efforts={filterEfforts}
          onEffortsChange={setFilterEfforts}
          hasReminder={filterHasReminder}
          onHasReminderChange={setFilterHasReminder}
        />

        <TodayOptionsMenu
          visible={optionsMenuVisible}
          onClose={() => setOptionsMenuVisible(false)}
          hideCategories={hideCategories}
          onHideCategoriesChange={setHideCategories}
          onLightenDay={visibleTasks.length > 0 && !featureHidden('deload', simpleMode) ? () => {
            setOptionsMenuVisible(false);
            setDeloadVisible(true);
          } : undefined}
          plannedLabel={plannedLabel}
          onLookAhead={featureHidden('lookAhead', simpleMode) ? undefined : () => {
            setOptionsMenuVisible(false);
            setLookAheadVisible(true);
          }}
          onPullFromProjects={() => {
            setOptionsMenuVisible(false);
            setPullScopeProjectIds(undefined);
            setPullVisible(true);
          }}
          onBatchReachOuts={reachOutTasks.length > 0 && !focusSession ? () => {
            setOptionsMenuVisible(false);
            setFocusFromPinned(false);
            setFocusFromReachOuts(true);
            setFocusSetupVisible(true);
          } : undefined}
          reachOutCount={reachOutTasks.length}
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

        <TodayEventsSheet
          visible={eventsSheetVisible}
          onClose={() => setEventsSheetVisible(false)}
          events={todayCalendarEvents}
        />

        <DeloadSheet
          visible={deloadVisible}
          todaysTasks={visibleTasks}
          onClose={() => setDeloadVisible(false)}
        />

        <LookAheadSheet
          visible={lookAheadVisible}
          onClose={() => setLookAheadVisible(false)}
        />

        <SuggestedPinsSheet
          visible={suggestedPinsVisible}
          tasks={visibleTasks}
          pinnedTasks={pinnedTasks}
          onClose={() => setSuggestedPinsVisible(false)}
          onConfirm={handleSuggestedPins}
        />

        <FocusSetupSheet
          visible={focusSetupVisible}
          tasks={visibleTasks}
          allTasks={allTasks}
          pinnedSeed={focusFromPinned ? pinnedTasks : undefined}
          reachOutSeed={focusFromReachOuts ? reachOutTasks : undefined}
          onClose={() => setFocusSetupVisible(false)}
          onStart={(queue, options) => {
            startFocusSession(queue, options);
            setFocusSetupVisible(false);
            setFocusSessionVisible(true);
          }}
        />

        <FocusSessionSheet
          visible={focusSessionVisible && focusSession !== null}
          onClose={() => setFocusSessionVisible(false)}
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
            onComplete={handleBulkComplete}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
            onSetCategory={category => { bulkSetCategory(Array.from(selectedIds), category); exitSelection(); }}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            onMarkMissed={() => { bulkMarkMissed(Array.from(selectedIds)); exitSelection(); }}
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
  // gap: spacing.sm, not xs. A badge hangs 4pt past its pill's right edge, which
  // an xs gap gave it exactly nowhere to hang — fine while Inbox (the last pill)
  // was the only badged one, but Unscheduled's landed on the Inbox pill's left
  // edge, and RN paints later siblings on top, so the neighbour would have
  // clipped it rather than the other way round.
  viewModePills: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: 6, paddingBottom: 4,
  },
  viewModePill: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
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
  // Same badge, muted: Unscheduled is a pile of things with no date, not a pile
  // of things owed, so a red alert dot overstates it — and two red dots side by
  // side stop reading as "this one needs you". Red stays the Inbox's alone.
  viewModePillBadgeQuiet: { backgroundColor: colors.bgQuaternary },
  viewModePillBadgeTextQuiet: { color: colors.text },
  sectionHeader: {
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderText: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  // A lighter sub-grouping inside a Later day section (morning/afternoon/
  // evening/night, or a time window) — no full section break, so same-day
  // segments read as one day rather than several unrelated blocks (#1162).
  laterSubHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 2,
    backgroundColor: colors.bg,
  },
  laterSubHeaderDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  laterSubHeaderText: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.medium,
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
  // Gap between the pinned block and whatever renders below it — see the note
  // on pinnedBlock. Page-background colored, same as categorySectionHeader's
  // own paddingTop, so it reads as a break rather than more card.
  pinnedBlockFooter: {
    height: spacing.md,
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
});
