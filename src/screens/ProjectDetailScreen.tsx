import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  StyleSheet,
  Modal,
  type GestureResponderEvent,
} from 'react-native';
import { ReorderableList } from '../components/ReorderableList';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { DeliverablePromptQueue } from '../components/DeliverablePromptQueue';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore, projectDecisions, projectProgress } from '../store/useProjectStore';
import { OfferBanner } from '../components/OfferBanner';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { TaskItem } from '../components/TaskItem';
import { SpotlightProvider, useSpotlightProgress } from '../components/SpotlightOverlay';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { TaskGroupEditor } from '../components/TaskGroupEditor';
import { TaskGroupHeader } from '../components/TaskGroupHeader';
import { TaskGroupBody } from '../components/TaskGroupBody';
import { TaskGroupTray } from '../components/TaskGroupTray';
import { GroupDropTarget } from '../components/GroupDropTarget';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { groupRoster, isRelevantToGroupToday } from '../utils/visibilityUtils';
import { buildProjectListItems, type ProjectListItem } from '../utils/projectStacks';
import { ProjectEditor } from '../components/ProjectEditor';
import { BulkActionBar } from '../components/BulkActionBar';
import { QuickAddModal } from '../components/QuickAddModal';
import { TemplatePickerSheet } from '../components/TemplatePickerSheet';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { ProjectTaskSuggestionsSheet } from '../components/ProjectTaskSuggestionsSheet';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { ProjectDecisions } from '../components/ProjectDecisions';
import { DeliverablePromptSheet } from '../components/DeliverablePromptSheet';
import { FabMenu, FAB_SIZE, type FabMenuItem } from '../components/Fab';
import { useSettingsStore } from '../store/useSettingsStore';
import { addDays } from 'date-fns/addDays';
import { dayKeyOf } from '../utils/dateUtils';
import { awayNights, awaySpanOf } from '../utils/awayDates';
import { geocodePlace } from '../services/geocode';
import { fetchDestinationForecast } from '../services/weatherLookup';
import {
  describeForecastGap,
  describeTripForecast,
  summarizeTripForecast,
} from '../utils/tripForecast';
import { addMenuItemShown } from '../utils/simpleMode';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task, Project, TaskGroup, TaskTemplate } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { SheetHeaderButton } from '../components/SheetHeaderButton';
import { SearchField } from '../components/SearchField';
import { DetailHeader } from '../components/DetailHeader';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

type RootStackParamList = {
  ProjectDetail: { projectId: string };
};

// One shared empty array for a task with no subtasks — a fresh `[]` per row per
// render is exactly the identity churn the grouping below exists to avoid.
const NO_SUBTASKS: Task[] = [];
const NO_GROUP_CHILDREN: Task[] = [];

// A project's incomplete tasks, with any stacked among them collapsed into a
// single 'group' entry each — mirrors Today's own CategoryListItem, minus the
// category header this screen doesn't have.
// Bottom-up: "New task" ends up closest to the button.
const ADD_MENU_ITEMS: FabMenuItem[] = [
  { key: 'existing', label: 'Add existing task', icon: 'albums-outline' },
  { key: 'stack', label: 'Stack', icon: 'layers' },
  { key: 'template', label: 'Template', icon: 'copy' },
  { key: 'new', label: 'New task', icon: 'checkbox' },
];

// A list's own add field already covers "New task", and Template doesn't fit
// a line-per-item list the way it does a scheduled project — so the FAB here
// only offers the two things the field can't: pulling in a task that already
// exists elsewhere, and starting a section (a Stack homed on this project).
const LIST_ADD_MENU_ITEMS: FabMenuItem[] = [
  { key: 'existing', label: 'Add existing task', icon: 'albums-outline' },
  { key: 'stack', label: 'Section', icon: 'layers' },
];

export function ProjectDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ProjectDetail'>>();
  const { projectId } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const simpleMode = useSettingsStore(s => s.simpleMode);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);

  const projects = useProjectStore(useShallow(s => s.projects));
  const updateProject = useProjectStore(s => s.updateProject);
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const addExistingToProject = useTaskStore(s => s.addExistingToProject);
  const addTask = useTaskStore(s => s.addTask);
  const bulkRemoveFromProject = useTaskStore(s => s.bulkRemoveFromProject);
  const reorderProjectItems = useTaskStore(s => s.reorderProjectItems);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkMarkMissed = useTaskStore(s => s.bulkMarkMissed);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const groupTasks = useTaskStore(s => s.groupTasks);
  const setDeliverableValue = useTaskStore(s => s.setDeliverableValue);
  const completeProject = useTaskStore(s => s.completeProject);
  const createTaskGroup = useTaskGroupStore(s => s.createGroup);
  const updateTaskGroup = useTaskGroupStore(s => s.updateGroup);
  const removeGroupRow = useTaskGroupStore(s => s.removeGroupRow);
  const taskGroups = useTaskGroupStore(useShallow(s => s.groups));
  const setGroupCollapsed = useTaskGroupStore(s => s.setGroupCollapsed);
  const groupRosterOf = useTaskStore(s => s.groupRosterOf);
  const completeGroup = useTaskStore(s => s.completeGroup);
  const deferGroup = useTaskStore(s => s.deferGroup);
  const pinGroup = useTaskStore(s => s.pinGroup);
  const addExistingToGroup = useTaskStore(s => s.addExistingToGroup);

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [groupEditorVisible, setGroupEditorVisible] = useState(false);
  // Set while editingGroup is a stack freshly created from the add menu —
  // an untitled one is garbage-collected on close rather than left behind
  // as a nameless stack (see TodayScreen's own newStackIdRef).
  const newStackIdRef = React.useRef<string | null>(null);
  // Set while a group header's drag() is in flight, so its body can collapse
  // for the duration rather than dragging a tall floating tray — see the same
  // state in TodayScreen. pendingGroupDragRef is read from onDragBegin, which
  // fires synchronously inside drag(), so the id is never set a frame late.
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const pendingGroupDragRef = React.useRef<string | null>(null);
  // Tracks a "drag onto a group to join it" gesture while a plain loose task
  // is being dragged — same mechanism as TodayScreen's joinGroupIntentRef.
  // Set from onDragMove whenever the dragged card sits over a group, read
  // once at drop time in onDragEnd.
  const joinGroupIntentRef = React.useRef<string | null>(null);
  const [joinGroupIntentId, setJoinGroupIntentId] = useState<string | null>(null);
  // Task the drop just handed to a group (set in onDragEnd, which runs before
  // onReorder), so the placement pass below leaves it alone — it belongs to
  // the group now, not to whatever slot it was let go over.
  const joinedTaskIdRef = React.useRef<string | null>(null);
  // Index (within projectListItems) of the row currently being dragged, kept
  // up to date from dragRange (called every hover update) so onDragMove can
  // tell which row is in flight.
  const activeDragIndexRef = React.useRef<number | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // True while a subtask inside the expanded row is mid-drag; the list has to
  // stop scrolling for the duration (see TaskItem.onSubtaskDragStateChange).
  const [draggingSubtask, setDraggingSubtask] = useState(false);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [listDraft, setListDraft] = useState('');
  const listInputRef = useRef<TextInput>(null);
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const [applyTemplate, setApplyTemplate] = useState<TaskTemplate | null>(null);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const [existingSearch, setExistingSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  // Not-now only, like every OfferBanner — reopening the project re-offers it,
  // which is right since nothing else marks the project done for the user.
  const [completeOfferDismissed, setCompleteOfferDismissed] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [flashTaskId, setFlashTaskId] = useState<string | null>(null);
  // The decision whose answer is being corrected. Held by id and read back off
  // the live list, so the sheet re-seeds from the store rather than from a
  // snapshot taken when the row was tapped — same as the Logbook's.
  const [answerTaskId, setAnswerTaskId] = useState<string | null>(null);
  const flashTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    handleBulkDelete,
    completableCount,
    painting,
    paintProps,
  } = useTaskSelection(allTasks);

  // Bulk completion asks before it drops an answer — see
  // useAnswerFirstCompletion. Selection is left alone until something actually
  // happens: `complete` runs on every path out of the confirm except Cancel,
  // so backing out leaves the selection exactly as it was rather than making
  // the user rebuild it.
  const { requestComplete, queueProps } = useAnswerFirstCompletion();
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
  // This screen is a RootStack card, not a tab screen — it covers the tab bar
  // entirely, so the bulk bar sits above the home indicator, not above a tab
  // bar. (Asking for useBottomTabBarHeight() here throws outright.)
  const selectionListPadding = selectionMode ? insets.bottom + spacing.sm + bulkBarHeight + spacing.sm : undefined;
  // Every row's scrim shares this one animation, so the dim lands as a
  // single motion — see SpotlightOverlay.
  const spotlightProgress = useSpotlightProgress(expandedTaskId !== null && !selectionMode);

  const project = projects.find(p => p.id === projectId) ?? null;
  const projectTasks = project
    ? allTasks.filter(t => t.projectId === project.id && t.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  const incompleteProjectTasks = projectTasks.filter(t => !t.completed);
  const copyText = useMemo(
    () => incompleteProjectTasks.map(t => t.title).join('\n'),
    [incompleteProjectTasks],
  );
  const { copied, copy } = useCopyToClipboard();
  // Presentation only — see Project.kind.
  const isList = project?.kind === 'list';

  /**
   * The destination forecast line, fetched on open and never stored.
   *
   * A read with no store, the shape `useWeatherStore`'s own daily snapshot
   * takes one feature over: a forecast written onto the project would go stale
   * and then be believed. Held in component state so it lives exactly as long
   * as the screen does.
   *
   * Every refusal upstream (the switch off, demo mode, no network, a place no
   * gazetteer knows, a trip further out than the forecast reaches) comes back
   * as null and draws nothing. There is no error state, deliberately: a line
   * that could not be fetched has nothing to say, and saying so would be a
   * second row about the app rather than about the trip.
   */
  const [forecastLine, setForecastLine] = useState<string | null>(null);
  const [forecastGap, setForecastGap] = useState<string | null>(null);
  const destinationForecastEnabled = useSettingsStore(s => s.destinationForecastEnabled);
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const awaySpan = project ? awaySpanOf(project) : null;
  const destination = project?.destination ?? null;
  const spanStartKey = awaySpan ? dayKeyOf(awaySpan.start) : null;
  const spanEndKey = awaySpan?.end ? dayKeyOf(addDays(awaySpan.end, -1)) : spanStartKey;

  useEffect(() => {
    setForecastLine(null);
    setForecastGap(null);
    if (!destinationForecastEnabled || !destination || !spanStartKey || !spanEndKey) return;
    let live = true;
    void (async () => {
      const place = await geocodePlace(destination);
      if (!live || !place) return;
      const days = await fetchDestinationForecast(place, spanStartKey, spanEndKey);
      if (!live || !days) return;
      const summary = summarizeTripForecast(days);
      const nights = awayNights(awaySpan);
      setForecastLine(describeTripForecast(summary, place.name, unitSystem === 'metric'));
      setForecastGap(describeForecastGap(summary, nights));
    })();
    return () => { live = false; };
  }, [destinationForecastEnabled, destination, spanStartKey, spanEndKey, unitSystem]);
  const completedProjectTasks = projectTasks
    .filter(t => t.completed)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  // Clears the FAB under the last row, the same amount `detailFooter` below
  // reserves — but only when that footer isn't already on screen to provide
  // it. With completed tasks present, ListFooterComponent renders and carries
  // its own bottom padding; stacking this on top of it would double the gap.
  const baseListBottomPadding = completedProjectTasks.length === 0
    ? insets.bottom + FAB_SIZE + spacing.lg
    : undefined;
  // Same identity-grouped count the Projects list badges its quick-complete
  // action with — a recurring member never reads done here either. Memoized
  // because it filters the whole task list and walks a previousOccurrenceId
  // chain per member, and this screen re-renders on every row tap.
  const progress = useMemo(
    () => (project ? projectProgress(project.id, allTasks) : { done: 0, total: 0 }),
    [project?.id, allTasks],
  );
  const allDone = progress.total > 0 && progress.done === progress.total && !project?.completed && !project?.ongoing;

  const handleMarkComplete = () => {
    if (!project) return;
    haptics.success();
    // Nothing open to ask about archiving — allDone already means every
    // unarchived member is done, same guarantee ProjectsScreen's quick action
    // relies on.
    completeProject(project.id, { archiveRemaining: false });
  };
  // What "Select all" covers, and what the bar counts against to decide it has
  // everything: the rows actually on screen. Completed tasks are collapsed
  // behind a toggle, and counting hidden rows would leave the bar stuck
  // offering "Select all" after the user already had.
  const selectableTasks = showCompleted ? projectTasks : incompleteProjectTasks;
  // What this project has already decided — one row per member, most recent
  // answer first. It does its own filtering (members, unarchived, collapsed by
  // identity), so it takes the whole task list rather than projectTasks.
  const decisions = useMemo(() => projectDecisions(projectId, allTasks), [projectId, allTasks]);
  const answerTask = answerTaskId !== null ? allTasks.find(t => t.id === answerTaskId) ?? null : null;

  const onClose = () => {
    if (selectionMode) exitSelection();
    navigation.goBack();
  };

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  // Every subtask on this screen, grouped once. Each row used to filter the
  // whole task list for its own children inline, which is O(tasks) per row and
  // — worse — handed the memoized row a fresh array on every render.
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
  const subtasksOf = (id: string): Task[] => subtasksByParent.get(id) ?? NO_SUBTASKS;

  // Every task currently assigned to a group, across the whole app — a
  // TaskGroup has no projectId of its own (it's scoped by its children), and
  // TaskGroupHeader's "N/M done today" tally needs the stack's whole roster
  // regardless of which project happens to hold a given member. Same
  // computation as TodayScreen's own childrenByGroupId.
  const childrenByGroupId = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.groupId) continue;
      const list = map.get(t.groupId);
      if (list) list.push(t);
      else map.set(t.groupId, [t]);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [allTasks]);

  // Same pin-eligibility computation as TodayScreen's groupPinInfo, so the
  // pin button on a stack header reads the same whichever screen it's on.
  const groupPinInfo = useMemo(() => {
    const map = new Map<string, { pinnable: boolean; pinned: boolean }>();
    for (const group of taskGroups) {
      const roster = groupRoster(childrenByGroupId.get(group.id) ?? NO_GROUP_CHILDREN);
      const eligible = roster.filter(c => !c.completed && isRelevantToGroupToday(c));
      map.set(group.id, { pinnable: eligible.length > 0, pinned: eligible.length > 0 && eligible.every(c => c.pinned) });
    }
    return map;
  }, [taskGroups, childrenByGroupId]);

  // Stacked tasks collapsed into a single 'group' entry, plus any stack built
  // on this project's screen that has no members to be found through — see
  // buildProjectListItems for which of the two puts a given stack here.
  const projectListItems: ProjectListItem[] = useMemo(
    () => buildProjectListItems(incompleteProjectTasks, taskGroups, projectId),
    [incompleteProjectTasks, taskGroups, projectId],
  );

  // The row handlers take the row's own id rather than closing over it, so one
  // callback serves every row — TaskItem is memoized and a fresh arrow per row
  // per render defeats its shallow compare silently, putting every mounted row
  // back to re-rendering on each store write. Empty deps throughout: the expand
  // toggle reaches state only through the functional form of setState, and the
  // editor resolves its task from the store at call time rather than capturing
  // it, so neither can read a stale value from its frozen closure.
  const handleRowPress = useCallback((id: string) => {
    setExpandedTaskId(prev => {
      // A tap landing while a *different* row is spotlighted just dismisses
      // that one, rather than expanding the row that was tapped.
      if (prev !== null && prev !== id) return null;
      return prev === id ? null : id;
    });
  }, []);

  const handleRowEdit = useCallback((id: string) => {
    const task = useTaskStore.getState().tasks.find(t => t.id === id);
    if (!task) return;
    setEditingTask(task);
    setEditorVisible(true);
  }, []);

  const handleRowSwipeSelect = useCallback((id: string) => {
    setExpandedTaskId(null);
    enterSelectionMode(id);
  }, [enterSelectionMode]);

  // Same id-bound shape as the row handlers above, and the same four actions
  // TodayScreen's own stack headers get — see groupHeaderProps there.
  const handleGroupSwipeSelect = useCallback((groupId: string) => {
    const ids = groupRosterOf(groupId).filter(t => !t.completed).map(t => t.id);
    if (ids.length === 0) return;
    setExpandedTaskId(null);
    enterSelectionMode(ids);
  }, [groupRosterOf, enterSelectionMode]);

  const handleGroupComplete = useCallback((groupId: string) => {
    const roster = useTaskStore.getState().groupRosterOf(groupId);
    requestComplete({
      ids: roster.filter(t => !t.completed).map(t => t.id),
      complete: skipIds => completeGroup(groupId, { skipIds }),
    });
  }, [completeGroup, requestComplete]);
  const handleGroupDefer = useCallback((groupId: string, date: Date) => deferGroup(groupId, date), [deferGroup]);
  const handleGroupPin = useCallback((groupId: string) => pinGroup(groupId), [pinGroup]);
  const handleGroupPressEdit = useCallback((groupId: string) => {
    const group = useTaskGroupStore.getState().getGroupById(groupId);
    if (!group) return;
    setEditingGroup(group);
    setGroupEditorVisible(true);
  }, []);

  const startGroupDrag = (groupId: string, drag: () => void) => {
    pendingGroupDragRef.current = groupId;
    drag();
    pendingGroupDragRef.current = null;
  };

  const listTouchStart = React.useRef<{ x: number; y: number } | null>(null);
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

  // Template goes in simplified mode, same as it does from Today's add button.
  const addMenuItems = useMemo(
    () => (isList ? LIST_ADD_MENU_ITEMS : ADD_MENU_ITEMS).filter(item => addMenuItemShown(item.key, simpleMode)),
    [isList, simpleMode],
  );

  const handleAddMenuSelect = (key: string) => {
    if (key === 'new') {
      setQuickAddVisible(true);
      return;
    }
    if (key === 'template') {
      setTemplatePickerVisible(true);
      return;
    }
    if (key === 'stack') {
      // Homed here, so it stays on this page while the user fills it in —
      // there are no members yet to scope it by. See TaskGroup.projectId.
      const group = createTaskGroup('', null, projectId);
      // createGroup ranks a new stack against other stacks only, which says
      // nothing about where it falls among this project's tasks — the two
      // share one number space (TaskGroup.sortOrder), so it has to be anchored
      // into this list or it lands at the top of it. Same re-anchor groupTasks
      // does, from the other end: a new stack goes after the rows already here.
      const lastSlot = incompleteProjectTasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
      updateTaskGroup(group.id, { sortOrder: lastSlot + 1 });
      newStackIdRef.current = group.id;
      setEditingGroup(group);
      setGroupEditorVisible(true);
      return;
    }
    setExistingSearch('');
    setShowExistingPicker(true);
  };

  // Quick add doesn't know about projects, so the task lands here right after
  // it's created — or resumed from the archive, which is just as much an "add"
  // from this screen. "More details" carries the project into the editor instead.
  const attachToProject = (task: Task) => {
    if (project) addExistingToProject(task.id, project.id);
    // Same brief highlight Today gives a freshly added row — the list is
    // sorted by sortOrder, so a new task doesn't necessarily land at the end.
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    setFlashTaskId(task.id);
    flashTimeoutRef.current = setTimeout(() => setFlashTaskId(null), 1200);
  };

  React.useEffect(() => () => {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
  }, []);

  const handleQuickAddOpenFull = (draft: TaskDraft) => {
    setQuickAddVisible(false);
    setEditingTask(null);
    setEditorInitialDraft({ ...draft, projectId: project?.id ?? null });
    setEditorVisible(true);
  };

  // Shared by a loose top-level row and a stacked task rendered inside its
  // group's tray — same capabilities either way (checkbox, swipe actions,
  // expand-for-subtasks); only the drag source and the indent differ.
  // `indented` rows are already under their stack's header, so the inline
  // stack chip (`showGroup`) would just repeat it.
  /**
   * A list's add field: one line, straight into the project, and the keyboard
   * stays up for the next one.
   *
   * The FAB stays for a list too, but its menu shrinks to Add existing /
   * Section — New task is this field, and Template doesn't fit a
   * doctor-questions list. Writing five questions in a row is the whole
   * activity here, so the field is the surface for that and the FAB is only
   * for the two things it can't do: pull in a task from elsewhere, or start a
   * new section to write questions under.
   *
   * No date, no category, no title rules: a line typed here is exactly what it
   * says. `skipTitleRules` matters — a rule rewriting "Ask about the MRI
   * results" would be editing the user's own note back at them.
   */
  const handleListAdd = () => {
    const title = listDraft.trim();
    if (!title || !project) return;
    animateLayout();
    addTask({ title, projectId: project.id }, undefined, { skipTitleRules: true });
    haptics.tap();
    setListDraft('');
    listInputRef.current?.focus();
  };

  const renderProjectTaskItem = (
    task: Task,
    opts: { drag?: () => void; isActive?: boolean; indented?: boolean } = {},
  ) => {
    const subs = subtasksOf(task.id);
    return (
      <TaskItem
        task={task}
        drag={selectionMode ? undefined : opts.drag}
        isActive={opts.isActive}
        onPress={handleRowPress}
        expanded={expandedTaskId === task.id}
        onEdit={handleRowEdit}
        subtaskCount={subs.length}
        subtaskDoneCount={subs.filter(t => t.completed).length}
        subtasks={subs}
        onSubtaskDragStateChange={setDraggingSubtask}
        spotlightDisabled={expandedTaskId !== null && expandedTaskId !== task.id && !selectionMode}
        selectionMode={selectionMode}
        selected={selectedIds.has(task.id)}
        onSelect={toggleSelection}
        onSwipeSelect={handleRowSwipeSelect}
        indented={opts.indented}
        showCategory={!isList}
        showGroup={!opts.indented}
        // A list's members are undated by construction, so the date affordance
        // is an empty control on every row. Turning it off is most of what
        // makes a list look like one rather than like a project with a lot of
        // blank fields — the task still has the field, and the editor still
        // offers it, for the line that turns out to be a real errand.
        showDate={!isList}
        showPin={false}
        highlighted={task.id === flashTaskId}
      />
    );
  };

  const eligibleForAdd = useMemo(() => {
    if (!project) return [];
    const q = existingSearch.trim().toLowerCase();
    return allTasks.filter(t =>
      !t.parentId &&
      !t.projectId &&
      !t.completed &&
      (q === '' || t.title.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [allTasks, existingSearch, project]);

  return (
    <SpotlightProvider progress={spotlightProgress}>
      <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
        <DetailHeader
          title={project?.title ?? ''}
          onBack={onClose}
          actions={
            <View style={styles.detailHeaderActions}>
              {/*
                Presentation only — see Project.kind. Same shape as Recipes'
                own grid-outline toggle in its header: an icon button that
                flips a display switch right where its effect shows, rather
                than a setting buried in the full editor.
              */}
              {!!project && (
                <TouchableOpacity
                  onPress={() => { haptics.tap(); updateProject(project.id, { kind: isList ? 'project' : 'list' }); }}
                  hitSlop={8}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isList }}
                  accessibilityLabel={isList ? 'Keep as a list, without dates' : 'Show as a project, with dates'}
                >
                  <Ionicons name="list-outline" size={20} color={isList ? colors.accent : colors.textSecondary} />
                </TouchableOpacity>
              )}
              {!!copyText && (
                <TouchableOpacity
                  onPress={() => copy(copyText)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Copy task names"
                >
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {!!anthropicApiKey && (
                <TouchableOpacity
                  onPress={() => { haptics.tap(); setSuggestionsVisible(true); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Suggest tasks with AI"
                >
                  <Ionicons name="sparkles-outline" size={20} color={colors.purple} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => project && setEditingProject(project)}
                accessibilityRole="button"
                accessibilityLabel="Edit project"
              >
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          }
        />

        {allDone && !completeOfferDismissed && (
          <OfferBanner
            lead="Every task in this project"
            rest="is complete."
            actionLabel="Mark Complete"
            onAction={handleMarkComplete}
            onDismiss={() => setCompleteOfferDismissed(true)}
            accessibilityLabel="Every task in this project is complete"
            actionAccessibilityLabel={`Mark ${project?.title ?? 'this project'} complete`}
            dismissAccessibilityLabel="Dismiss project complete notice"
          />
        )}

        {!!project?.notes && (
          // Collapsed to one line by default — the notes are a reference, not
          // the point of this screen, and a multi-paragraph note shouldn't push
          // the task list below the fold. Tap to unfold in place.
          <TouchableOpacity
            style={styles.notesPreview}
            onPress={() => { animateLayout(); setNotesExpanded(v => !v); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${notesExpanded ? 'Collapse' : 'Expand'} project notes`}
          >
            <Ionicons name="document-text-outline" size={13} color={colors.textTertiary} style={styles.notesPreviewIcon} />
            <Text style={styles.notesPreviewText} numberOfLines={notesExpanded ? undefined : 1}>
              {project.notes}
            </Text>
          </TouchableOpacity>
        )}

        <View
          style={{ flex: 1 }}
          onTouchStart={expandedTaskId !== null ? handleListTouchStart : undefined}
          onTouchEnd={expandedTaskId !== null ? handleListTouchEnd : undefined}
        >
        <PaintSelectionProvider {...paintProps}>
          <ReorderableList
            scrollEnabled={!painting && !draggingSubtask}
            data={projectListItems}
            keyExtractor={item => item.type === 'group' ? `g-${item.group.id}` : item.task.id}
            // Two rows need lifting over their neighbours: an expanded row,
            // whose card shadow falls across the row below it, and a task
            // group's tray, for the same reason — see ReorderableList's own
            // note on why this can't live on the card.
            rowElevated={item => item.type === 'task' && item.task.id === expandedTaskId}
            // paddingTop only applies once there's a first row to clear — with
            // none, it's top-only padding inside the flexGrow:1 box the empty
            // state centers in, which pushes that centering down off true
            // middle. Same reasoning as ListFooterComponent below.
            contentContainerStyle={[
              { flexGrow: 1 },
              incompleteProjectTasks.length > 0 && { paddingTop: spacing.sm },
              selectionListPadding !== undefined
                ? { paddingBottom: selectionListPadding }
                : baseListBottomPadding !== undefined && { paddingBottom: baseListBottomPadding },
            ]}
            onHoverChange={haptics.dragTick}
            // A stack hands over its own id, never its children's: it holds a
            // slot in this order itself (see buildProjectListItems), and its
            // members' sortOrders are their within-stack order, which a drag
            // out here has no business rewriting.
            onReorder={reordered => {
              // A task just handed to a group (see onDragEnd) has already been
              // absorbed there — drop it from the normal placement pass so it
              // doesn't also get a sortOrder of its own from this reorder.
              const joinedTaskId = joinedTaskIdRef.current;
              joinedTaskIdRef.current = null;
              const settled = joinedTaskId !== null
                ? reordered.filter(item => !(item.type === 'task' && item.task.id === joinedTaskId))
                : reordered;
              const orderedIds = settled.map(item =>
                item.type === 'group' ? item.group.id : item.task.id,
              );
              reorderProjectItems(projectId, orderedIds);
            }}
            onDragBegin={() => {
              joinedTaskIdRef.current = null;
              setDraggingGroupId(pendingGroupDragRef.current);
            }}
            onDragEnd={({ committed }) => {
              const joinGroupId = joinGroupIntentRef.current;
              joinGroupIntentRef.current = null;
              setJoinGroupIntentId(null);
              // The join lands here rather than in onReorder: a drop onto a
              // group leaves the list order untouched (dropDisabled stops it
              // opening a gap), and onReorder stays silent when nothing moved.
              // `committed` keeps a cancelled drag — touch loss, app switch —
              // from quietly joining the task to the group.
              const dragged = projectListItems[activeDragIndexRef.current ?? -1];
              if (committed && joinGroupId !== null && dragged?.type === 'task') {
                joinedTaskIdRef.current = dragged.task.id;
                addExistingToGroup(dragged.task.id, joinGroupId);
                haptics.success();
              }
              setDraggingGroupId(null);
            }}
            onDragMove={({ overIndex }) => {
              const draggedItem = projectListItems[activeDragIndexRef.current ?? -1];
              // Only a plain loose task can be dragged onto a group to join it.
              if (draggedItem?.type !== 'task') return;
              const over = overIndex !== null ? projectListItems[overIndex] : null;
              const target = over?.type === 'group' ? over.group : null;
              const nextId = target ? target.id : null;
              if (nextId !== joinGroupIntentRef.current) {
                joinGroupIntentRef.current = nextId;
                setJoinGroupIntentId(nextId);
                if (nextId) haptics.impactLight();
              }
            }}
            // Aiming at a group takes the drag over: the list stops opening a
            // reorder gap, so the target stays put under the card instead of
            // sliding away from the finger chasing it.
            dropDisabled={joinGroupIntentId !== null}
            dropIntoIndex={
              joinGroupIntentId === null
                ? null
                : projectListItems.findIndex(i => i.type === 'group' && i.group.id === joinGroupIntentId)
            }
            // Only here to record which row is in flight (onDragMove reads
            // it); every draggable row on this list may go anywhere in it.
            dragRange={(rangeData, activeIndex) => {
              activeDragIndexRef.current = activeIndex;
              return [0, rangeData.length - 1];
            }}
            // Inside the scroll content, not pinned above the list: it's
            // reference material, so it should scroll out of the way once
            // you're working through the tasks. Not tappable while selecting —
            // these rows aren't selectable, and a tap that opened a sheet
            // mid-selection would be the odd one out.
            ListHeaderComponent={
              <>
                {forecastLine && (
                  <View style={styles.forecastRow}>
                    <Ionicons name="partly-sunny-outline" size={16} color={colors.textSecondary} />
                    <View style={styles.forecastContent}>
                      <Text style={styles.forecastLine}>{forecastLine}</Text>
                      {forecastGap && <Text style={styles.forecastGap}>{forecastGap}</Text>}
                    </View>
                  </View>
                )}
                {isList && !selectionMode && (
                  <View style={styles.listAddRow}>
                    <Ionicons name="add" size={18} color={colors.textTertiary} />
                    <TextInput
                      ref={listInputRef}
                      style={styles.listAddInput}
                      value={listDraft}
                      onChangeText={setListDraft}
                      onSubmitEditing={handleListAdd}
                      placeholder="e.g. Ask about the MRI results"
                      placeholderTextColor={colors.textTertiary}
                      maxLength={TITLE_MAX_LENGTH}
                      returnKeyType="done"
                      blurOnSubmit={false}
                    />
                  </View>
                )}
                <ProjectDecisions
                  decisions={decisions}
                  onPress={selectionMode ? undefined : task => setAnswerTaskId(task.id)}
                />
              </>
            }
            renderItem={({ item, drag, isActive }) => {
              if (item.type === 'group') {
                const { group, children } = item;
                const allChildren = childrenByGroupId.get(group.id) ?? NO_GROUP_CHILDREN;
                // Only ever a stack homed here with nothing to show (see
                // buildProjectListItems) — the membership walk can't produce a
                // group row without the task that led it there.
                const empty = children.length === 0;
                return (
                  <GroupDropTarget active={joinGroupIntentId === group.id}>
                  <TaskGroupTray>
                    <TaskGroupHeader
                      group={group}
                      allChildren={allChildren}
                      pinned={groupPinInfo.get(group.id)?.pinned ?? false}
                      pinDisabled={!(groupPinInfo.get(group.id)?.pinnable ?? false)}
                      onToggleCollapse={() => {
                        if (expandedTaskId !== null) { setExpandedTaskId(null); return; }
                        haptics.tap();
                        setDraggingGroupId(null);
                        setGroupCollapsed(group.id, !group.collapsed);
                      }}
                      onComplete={handleGroupComplete}
                      onDefer={handleGroupDefer}
                      onSwipeSelect={handleGroupSwipeSelect}
                      onPressEdit={handleGroupPressEdit}
                      onPressPin={handleGroupPin}
                      onDrag={!selectionMode && drag ? () => startGroupDrag(group.id, drag) : undefined}
                    />
                    <TaskGroupBody
                      // Collapse hides rows, and an empty stack has none to
                      // hide — collapsed it would be a bare title with no way
                      // to reach the button that fills it in. A drag still
                      // folds it, so its floating card is the header alone
                      // like every other stack's.
                      expanded={(empty || !group.collapsed) && draggingGroupId !== group.id}
                      hasChildren
                    >
                      {empty ? (
                        <View style={styles.emptyStackRow}>
                          <Text style={styles.emptyStackText}>No tasks in this stack yet</Text>
                          <InlineAction
                            label="Add task"
                            icon="add"
                            onPress={() => handleGroupPressEdit(group.id)}
                            accessibilityLabel={`Add a task to the ${group.title} stack`}
                          />
                        </View>
                      ) : children.map(child => (
                        <React.Fragment key={child.id}>
                          {renderProjectTaskItem(child, { indented: true })}
                        </React.Fragment>
                      ))}
                    </TaskGroupBody>
                  </TaskGroupTray>
                  </GroupDropTarget>
                );
              }
              return renderProjectTaskItem(item.task, { drag, isActive });
            }}
            ListEmptyComponent={
              completedProjectTasks.length === 0 ? (
                <EmptyState
                  icon="briefcase-outline"
                  title="No tasks yet"
                  subtitle={isList ? 'Add a line to get started' : "Add a new task, or pull in one you've already written down"}
                  actionLabel="New task"
                  onAction={() => isList ? listInputRef.current?.focus() : setQuickAddVisible(true)}
                />
              ) : null
            }
            // Only the completed section lives down here, so with nothing
            // completed the footer is bare padding — and that padding comes off
            // the box the empty state centres in.
            ListFooterComponent={
              completedProjectTasks.length === 0 ? null : (
              <View style={[styles.detailFooter, { paddingBottom: insets.bottom + FAB_SIZE + spacing.lg }]}>
                {completedProjectTasks.length > 0 && (
                  <View style={styles.completedSection}>
                    <TouchableOpacity
                      style={styles.completedToggle}
                      onPress={() => { animateLayout(); setShowCompleted(v => !v); }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`${showCompleted ? 'Hide' : 'Show'} ${completedProjectTasks.length} completed tasks`}
                    >
                      <Ionicons name="checkmark-circle-outline" size={13} color={colors.textTertiary} />
                      <Text style={styles.completedToggleText}>
                        {showCompleted ? 'Hide' : 'Show'} {completedProjectTasks.length} completed
                      </Text>
                      <Ionicons name={showCompleted ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
                    </TouchableOpacity>
                    {showCompleted && completedProjectTasks.map(task => {
                      const subs = subtasksOf(task.id);
                      return (
                        <TaskItem
                          key={task.id}
                          task={task}
                          onPress={handleRowPress}
                          expanded={expandedTaskId === task.id}
                          onEdit={handleRowEdit}
                          subtaskCount={subs.length}
                          subtaskDoneCount={subs.filter(t => t.completed).length}
                          subtasks={subs}
                          onSubtaskDragStateChange={setDraggingSubtask}
                          spotlightDisabled={expandedTaskId !== null && expandedTaskId !== task.id && !selectionMode}
                          selectionMode={selectionMode}
                          selected={selectedIds.has(task.id)}
                          onSelect={toggleSelection}
                          onSwipeSelect={handleRowSwipeSelect}
                          showCategory
                          showGroup
                          showPin={false}
                        />
                      );
                    })}
                  </View>
                )}
              </View>
              )
            }
          />
        </PaintSelectionProvider>
        </View>

        {selectionMode && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            totalCount={selectableTasks.length}
            existingTags={allTags}
            onComplete={handleBulkComplete}
            completableCount={completableCount}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
            onSetCategory={cat => { bulkSetCategory(Array.from(selectedIds), cat); exitSelection(); }}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            onMarkMissed={() => { bulkMarkMissed(Array.from(selectedIds)); exitSelection(); }}
            // Same majority-category rule TodayScreen's onGroup uses: the new
            // stack takes the category its members most often already have,
            // since groupTasks cascades that category onto every member.
            onGroup={title => {
              const ids = Array.from(selectedIds);
              const tally = new Map<string | null, number>();
              for (const id of ids) {
                const c = allTasks.find(t => t.id === id)?.category ?? null;
                tally.set(c, (tally.get(c) ?? 0) + 1);
              }
              let category: string | null = null;
              let best = 0;
              for (const [c, n] of tally) {
                if (n > best) { best = n; category = c; }
              }
              groupTasks(ids, title, category);
              exitSelection();
            }}
            // The other half of "Add existing task", which this screen has had
            // its own picker for since the start while taking one back out was
            // reachable from nowhere on it (see BulkActionBar's own note).
            onRemoveFromProject={() => {
              animateLayout();
              bulkRemoveFromProject(Array.from(selectedIds));
              exitSelection();
            }}
            onSelectAll={() => selectAll(selectableTasks.map(t => t.id))}
            onDeselectAll={deselectAll}
            onCancel={exitSelection}
            bottomInset={insets.bottom}
            onHeightChange={setBulkBarHeight}
          />
        )}

        {/* Add-existing-task picker — nested inside this screen's own tree
            (not a sibling top-level Modal), same nested-modal-stacking risk as
            the old Projects detail Modal. */}
        <Modal
          visible={showExistingPicker}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowExistingPicker(false)}
        >
          <View style={[styles.pickerRoot, { paddingTop: insets.top + spacing.md }]}>
            {/* Deliberately not `DetailHeader`: that's the back-chevron bar a
                pushed screen gets, and this is the Cancel/title/confirm bar
                every sheet in the app gets (fourteen of them, all built the
                same way out of `SheetHeaderButton`). Two idioms, already
                decomposed — the button is the shared part, the row isn't. */}
            <View style={styles.detailHeader}>
              <SheetHeaderButton
                label="Cancel"
                role="cancel"
                onPress={() => setShowExistingPicker(false)}
                accessibilityLabel="Close"
              />
              <Text style={styles.detailTitleText}>Add existing task</Text>
              {/* Balances Cancel so the title stays optically centered. */}
              <View style={styles.headerSpacer} />
            </View>
            <SearchField
              autoFocus
              style={styles.searchBar}
              value={existingSearch}
              onChangeText={setExistingSearch}
              placeholder="Search tasks"
              accessibilityLabel="Search tasks to add"
            />
            <FlatList
              data={eligibleForAdd}
              keyExtractor={t => t.id}
              contentContainerStyle={eligibleForAdd.length === 0 ? styles.emptyContainer : undefined}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    if (project) addExistingToProject(item.id, project.id);
                    haptics.tap();
                  }}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Text style={styles.pickerRowText} numberOfLines={1}>{item.title}</Text>
                  <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <EmptyState icon="search" title="No matching tasks" subtitle="Tasks already in a project, or completed, won't show here" />
              }
            />
          </View>
        </Modal>

        {!selectionMode && (
          <FabMenu
            items={addMenuItems}
            onSelect={handleAddMenuSelect}
            bottom={insets.bottom + spacing.xl}
            accessibilityLabel="Add task to project"
          />
        )}

        <TaskGroupEditor
          visible={groupEditorVisible}
          group={editingGroup}
          isNew={newStackIdRef.current !== null}
          projectId={project?.id}
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

        <QuickAddModal
          visible={quickAddVisible}
          onClose={() => setQuickAddVisible(false)}
          onOpenFull={handleQuickAddOpenFull}
          // Project tasks are picked off over time rather than scheduled for
          // today, so the quick add opens with no due date.
          context="unscheduled"
          onCreated={attachToProject}
          onResumed={attachToProject}
        />

        {/* Add from a template: pick one here, then the apply sheet below —
            same two-step flow as Today, but the applied tasks land directly
            in this project instead of the template's own container. */}
        <TemplatePickerSheet
          visible={templatePickerVisible}
          onClose={() => setTemplatePickerVisible(false)}
          onSelect={setApplyTemplate}
        />

        <ApplyTemplateSheet
          visible={applyTemplate !== null}
          template={applyTemplate}
          onClose={() => setApplyTemplate(null)}
          projectId={project?.id}
          onApplied={tasks => { if (tasks[0]) openEditor(tasks[0]); }}
        />

        {/* Correcting a decision from where it's read — the same sheet in the
            same mode the Logbook's ⋯ menu opens, so there's one place an
            answer is written and one way it's written. */}
        {answerTask && (
          <DeliverablePromptSheet
            visible
            task={answerTask}
            mode="edit"
            onConfirm={value => {
              setDeliverableValue(answerTask.id, value);
              setAnswerTaskId(null);
            }}
            onCancel={() => setAnswerTaskId(null)}
          />
        )}

        <ProjectEditor
          visible={editingProject !== null}
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />

        <ProjectTaskSuggestionsSheet
          visible={suggestionsVisible}
          projectId={project?.id ?? null}
          projectTitle={project?.title ?? ''}
          projectNotes={project?.notes ?? ''}
          existingTitles={projectTasks.map(t => t.title)}
          onClose={() => setSuggestionsVisible(false)}
        />

        <DeliverablePromptQueue {...queueProps} />

        <TaskEditor
          visible={editorVisible}
          task={editingTask}
          initialDraft={editorInitialDraft}
          onClose={() => {
            setEditorVisible(false);
            setEditorInitialDraft(null);
            setExpandedTaskId(null);
          }}
        />
      </View>
    </SpotlightProvider>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Reference material above the list, in the same card treatment and the same
  // gutters as the add row below it. Both margins set: the list starts right
  // underneath with no top margin of its own.
  forecastRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  forecastContent: { flex: 1 },
  forecastLine: { color: colors.text, fontSize: font.sm },
  forecastGap: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2 },
  listAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    // A height rather than lineHeight, which RN maps onto the iOS paragraph
    // style with no baseline compensation and draws the glyphs low in the box.
    minHeight: 44,
  },
  listAddInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 10,
  },
  detailRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pickerRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerSpacer: { width: 48 },
  detailHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  detailTitleText: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  // A full-height content container, so the empty state's `flex: 1` centres in
  // the list's viewport rather than collapsing to its own height at the top.
  emptyContainer: { flexGrow: 1 },
  detailFooter: {
    paddingTop: spacing.sm,
    // paddingBottom is set inline, from insets.bottom, to clear the floating
    // add button so the last row is never under it.
  },
  notesPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  notesPreviewIcon: {
    // Nudged down to sit on the text's cap height instead of its vertical
    // center.
    marginTop: 2,
  },
  notesPreviewText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  // No horizontal padding: the tray's own TRAY_PAD is what the child cards and
  // the header's glyph line up against, so anything here would push this block
  // in past the rows it stands in for.
  emptyStackRow: {
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  // textTertiary because the dimness is the signal here, the same way
  // CollapsibleField's summaryEmpty says a field has no value yet.
  emptyStackText: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  completedSection: {
    paddingBottom: spacing.sm,
  },
  completedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  completedToggleText: {
    color: colors.textTertiary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  searchBar: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  pickerRowText: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
  },
});
