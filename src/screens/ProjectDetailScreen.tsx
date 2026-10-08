import React, { useState, useMemo, useCallback, useRef, useEffect, useId } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  type GestureResponderEvent,
} from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { ReorderableList, type RowScroller, type DropCapture } from '../components/ReorderableList';
import { SortableList } from '../components/SortableList';
import { ProgressBar } from '../components/ProgressBar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { navigateToTab } from '../navigation/navigationRef';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { DeliverablePromptQueue } from '../components/DeliverablePromptQueue';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore, projectDecisions, projectProgress, projectCompletedRows, isProjectPastWindow, projectAnswerTallies, answerTallyParts } from '../store/useProjectStore';
import { decisionOutcomes } from '../utils/decisionReview';
import { AddGuestsSheet } from '../components/AddGuestsSheet';
import { describeProjectActivity, overdueRoutines, projectActivity, projectCardCaption, projectProgressNote } from '../utils/projectList';
import { isPausedOn, isPlanning } from '../utils/projectPause';
import { LookAheadSheet } from '../components/LookAheadSheet';
import { LinkedText } from '../components/LinkedText';
import { format } from 'date-fns/format';
import { groupRoster, isHeldBack, isTaskNotNeeded } from '../utils/visibilityUtils';
import { reuseUnchangedLists } from '../utils/stableLists';
import { Alert, InteractionManager, Linking, Share } from 'react-native';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { linkHost, parseLabelledLink } from '../utils/textLinks';
import { OfferBanner } from '../components/OfferBanner';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { TaskItem } from '../components/TaskItem';
import { SpotlightProvider, useSpotlightProgress } from '../components/SpotlightOverlay';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { TaskGroupEditor } from '../components/TaskGroupEditor';
import { InlineNameField } from '../components/InlineNameField';
import { TaskGroupHeader } from '../components/TaskGroupHeader';
import { TaskGroupBody } from '../components/TaskGroupBody';
import { TaskGroupTray } from '../components/TaskGroupTray';
import { GroupDropTarget } from '../components/GroupDropTarget';
import { useDropTargetAimed, useDropTargetChannel, type DropTargetChannel } from '../components/DropTargetChannel';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { confirmBulkSetWhen } from '../utils/scheduleMovePrompt';
import { alphabeticalPageOrder, buildProjectListItems, filterProjectListItems, filterTasksByTitle, orderWithInserted, projectCopyText, type ProjectListItem } from '../utils/projectStacks';
import { ProjectEditor } from '../components/ProjectEditor';
import { ProjectPageMenu } from '../components/ProjectPageMenu';
import { LazySheet } from '../components/LazySheet';
import type { CardAnchor } from '../components/CardSheet';
import { BulkActionBar } from '../components/BulkActionBar';
import { QuickAddModal } from '../components/QuickAddModal';
import { useStableCallback } from '../hooks/useStableCallback';
import { TemplatePickerSheet } from '../components/TemplatePickerSheet';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { TemplateAppliedToast } from '../components/TemplateAppliedToast';
import { ProjectTaskSuggestionsSheet } from '../components/ProjectTaskSuggestionsSheet';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { ProjectDecisions } from '../components/ProjectDecisions';
import { DeliverablePromptSheet } from '../components/DeliverablePromptSheet';
import { FabMenu, FAB_SIZE, type FabDragHandlers, type FabMenuItem, useFabBottom } from '../components/Fab';
import {
  FabDropZone,
  FabDropZoneProvider,
  useFabIntentChannel,
  useFabIntentSelector,
  type FabDropZonesHandle,
  type FabIntentChannel,
} from '../components/FabDropZones';
import type { DragScroller, DropZone, FabDropIntent } from '../utils/fabDrop';
import { useSettingsStore } from '../store/useSettingsStore';
import { addDays } from 'date-fns/addDays';
import { dayKeyOf, formatScheduledDate, getCurrentDayStart, getLogicalDayKey, getLogicalNow } from '../utils/dateUtils';
import {
  NO_LINE_PENDING,
  confirmLineSuggestion,
  lineMarkerFields,
  linePendingFields,
  lineSuggestion,
  type LineParseContext,
  type LinePending,
} from '../utils/listLineParse';
import { describeSchedule } from '../utils/parseTaskInput';
import { groupMentionTokens } from '../utils/peopleRegistry';
import { useTitleSelection } from '../hooks/useTitleSelection';
import { TitleTokenAccessory } from '../components/TitleTokenAccessory';
import { categoryLabel } from '../utils/categoryLabel';
import { useCategoryStore } from '../store/useCategoryStore';
import { awayNights, awaySpanOf, destinationPinUpdate } from '../utils/awayDates';
import { useDestinationForecast } from '../hooks/useDestinationForecast';
import type { GeocodedPlace } from '../services/geocode';
import { addMenuItemShown } from '../utils/simpleMode';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task, Project, TaskDraft as NewTaskDraft, TaskGroup, TaskTemplate } from '../types';
import { PRIORITY_LABELS, TITLE_MAX_LENGTH } from '../types';
import { SheetHeaderButton } from '../components/SheetHeaderButton';
import { SheetHeader } from '../components/SheetHeader';
import { SearchField } from '../components/SearchField';
import { DetailHeader } from '../components/DetailHeader';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useFilterField } from '../hooks/useFilterField';
import { useLogicalDayKey } from '../hooks/useLogicalDayKey';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { TextField } from '../components/TextField';

type RootStackParamList = {
  // addLine: opened from a list card's "+", so the add field takes focus.
  // A stamp rather than a flag so a second tap on "+" asks again.
  ProjectDetail: { projectId: string; addLine?: number };
};

// One shared empty array for a task with no subtasks — a fresh `[]` per row per
// render is exactly the identity churn the grouping below exists to avoid.
const NO_SUBTASKS: Task[] = [];
const NO_GROUP_CHILDREN: Task[] = [];

// How many tasks "Add existing task" lists before it asks for a search. It used
// to cut off here without saying so.
const EXISTING_PICKER_LIMIT = 30;

// Matches the list's own keyExtractor — shared so the add button's drop
// zones and the placement pass that follows a drop agree on what a row is
// called.
/** A list (or a project's checklist sections) this long gets a find field. */
const LIST_FILTER_MIN_LINES = 15;

function projectListItemKey(item: ProjectListItem): string {
  return item.type === 'group' ? `g-${item.group.id}` : item.task.id;
}

// A project's incomplete tasks, with any stacked among them collapsed into a
// single 'group' entry each — mirrors Today's own CategoryListItem, minus the
// category header this screen doesn't have.
// Bottom-up: "New task" ends up closest to the button.
const ADD_MENU_ITEMS: FabMenuItem[] = [
  { key: 'existing', label: 'Add existing task', icon: 'albums-outline' },
  { key: 'replies', label: 'Track replies', icon: 'people-outline' },
  { key: 'stack', label: 'New section', icon: 'layers' },
  { key: 'template', label: 'Template', icon: 'copy' },
  { key: 'new', label: 'New task', icon: 'checkbox' },
];

// The list's own add field at the top covers "New task" too, but scrolling
// there from the bottom of a long list is real friction — so the FAB still
// offers it, alongside the two things the field can't: pulling in a task
// that already exists elsewhere, and starting a section (a Stack homed on
// this project). Template doesn't fit a line-per-item list the way it does
// a scheduled project, so it's left out. Same "New section" label as the full
// menu above — it's the same TaskGroup mechanism either way, and having it
// read as two different features depending on Project.kind is exactly the
// confusion this label avoids.
//
// Template is offered after all: a packing template applied to a packing list
// is exactly a line-per-item list, and leaving it out meant the only place to
// apply one was a project that wasn't a list.
//
// Track replies is left out: it adds a task per person, waiting on each, which
// is follow-up work with a date to chase, not a line on a list.
const LIST_ADD_MENU_ITEMS: FabMenuItem[] = [
  { key: 'existing', label: 'Add existing task', icon: 'albums-outline' },
  { key: 'stack', label: 'New section', icon: 'layers' },
  { key: 'template', label: 'Template', icon: 'copy' },
  { key: 'new', label: 'New item', icon: 'checkbox' },
];

// The add button, naming what a release right now would do — same wrapper
// shape as Today's and Projects' own add buttons.
function AddProjectTaskFabWithDropLabel({
  channel,
  isList,
  ...props
}: {
  channel: FabIntentChannel;
  isList: boolean;
} & Omit<React.ComponentProps<typeof FabMenu>, 'dragLabel'>) {
  const label = useFabIntentSelector(channel, intent => {
    switch (intent?.kind) {
      case 'cancel': return 'Cancel';
      case 'joinGroup': return `Add to ${intent.groupTitle.trim() || 'section'}`;
      case 'insert': return isList ? 'New item here' : 'New task here';
      default: return null;
    }
  });
  return <FabMenu {...props} dragLabel={label} />;
}

// A section row, lit by either drag that can land in it: an existing task
// dragged onto it (`dragTarget`), or the add button aimed at it — the same
// wrapper Today's own GroupDropTargetRow gives a stack, so a section here
// gets the same border the add button lights up a stack with there.
function GroupDropTargetRow({
  channel,
  groupId,
  dragTarget,
  children,
}: {
  channel: FabIntentChannel;
  groupId: string;
  dragTarget: DropTargetChannel;
  children: React.ReactNode;
}) {
  const aimed = useFabIntentSelector(
    channel,
    intent => intent?.kind === 'joinGroup' && intent.groupId === groupId,
  );
  const dragAimed = useDropTargetAimed(dragTarget, groupId);
  return <GroupDropTarget active={dragAimed || aimed}>{children}</GroupDropTarget>;
}

/** A pasted list's lines, without the bullets it often carries. */
function cleanPastedLines(raw: string[]): string[] {
  return raw.map(l => l.replace(/^\s*(?:[-*•◦▪]|\d+[.)]|\[[ xX]?\])\s+/, '').trim()).filter(Boolean);
}

/**
 * The blank line Return opens under a list line (see TaskItem's
 * onSubmitLine). Return adds what's typed and moves the field under the new
 * line; Return or leaving it with nothing typed closes it. Its own component
 * so each placement starts empty and focused.
 *
 * It carries quick add's keyboard bar (#2312): # @ ! to type a marker, and a
 * Confirm that applies a date or priority phrase the way quick add's does (see
 * `listLineParse.ts` for which markers apply on their own and which wait for
 * Confirm). Each field has its own accessory id, since a page can hold several
 * at once and two views claiming one id leaves which one shows to chance.
 */
function NewLineField({
  onAdd,
  onAddMany,
  onDone,
  styles,
  placeholderColor,
  placeholder = 'New line',
  inTray = false,
}: {
  onAdd: (text: string, pending: LinePending) => void;
  onAddMany: (lines: string[]) => void;
  onDone: () => void;
  styles: { newLineRow: object; newLineInTray: object; newLineInputRow: object; newLineInput: object; newLineConfirm: object; newLinePending: object; newLinePendingText: object };
  placeholderColor: string;
  placeholder?: string;
  /** Inside a stack's tray, which already insets its rows: the field drops its own side margins to match them. */
  inTray?: boolean;
}) {
  const colors = useColors();
  const [text, setText] = useState('');
  // What's typed, read by onBlur. A ref rather than the state, and emptied on
  // every add, so the blur a re-keyed field may send on its way out can't add
  // the same line twice.
  const textRef = useRef('');
  // What Confirm has set on this line, beside the text for the same reason.
  const [pending, setPending] = useState<LinePending>(NO_LINE_PENDING);
  const pendingRef = useRef<LinePending>(NO_LINE_PENDING);
  const accessoryId = `newLine-${useId()}`;
  const caret = useTitleSelection(text);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const suggestion = useMemo(
    () => (text.trim() ? lineSuggestion(text, getLogicalNow(dayResetTime), new Date()) : null),
    [text, dayResetTime],
  );
  const setPendingBoth = (next: LinePending) => { pendingRef.current = next; setPending(next); };
  // Taken by whichever add happens, so a line's date doesn't carry to the next.
  const takePending = (): LinePending => {
    const taken = pendingRef.current;
    setPendingBoth(NO_LINE_PENDING);
    return taken;
  };
  // Set once this field has handed off to the one under the new line, so a
  // blur on its way out neither adds nor closes that next field.
  const handedOffRef = useRef(false);
  const change = (next: string) => {
    // A pasted list becomes a line each, same as the field at the top.
    if (/[\r\n]/.test(next)) {
      textRef.current = '';
      handedOffRef.current = true;
      setText('');
      onAddMany(next.split(/\r?\n/));
      return;
    }
    textRef.current = next;
    setText(next);
  };
  // Return and the check button do the same thing: add what's typed and open
  // the next field, or close on an empty one.
  const submit = () => {
    const typed = textRef.current.trim();
    textRef.current = '';
    if (typed) { handedOffRef.current = true; onAdd(typed, takePending()); }
    else onDone();
  };
  const confirm = () => {
    if (!suggestion) return;
    haptics.success();
    const applied = confirmLineSuggestion(suggestion, pendingRef.current, dayResetTime);
    setPendingBoth(applied.pending);
    change(applied.text);
    caret.moveCaret(applied.text);
  };
  const pendingLabels = [
    pending.schedule ? describeSchedule(pending.schedule) : null,
    pending.priority !== null ? PRIORITY_LABELS[pending.priority] : null,
  ].filter((label): label is string => label !== null);
  return (
    <View style={[styles.newLineRow, inTray && styles.newLineInTray]}>
      <View style={styles.newLineInputRow}>
      <TextField
        style={styles.newLineInput}
        value={text}
        onChangeText={change}
        selection={caret.selection}
        onSelectionChange={caret.onSelectionChange}
        inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
        autoFocus
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        maxLength={TITLE_MAX_LENGTH}
        returnKeyType="next"
        blurOnSubmit={false}
        onSubmitEditing={submit}
        // Tapping away keeps what was typed: a line written and then left is
        // one the person meant to add.
        onBlur={() => {
          if (handedOffRef.current) return;
          const typed = textRef.current.trim();
          textRef.current = '';
          if (typed) onAdd(typed, takePending());
          onDone();
        }}
        accessibilityLabel={placeholder}
      />
      {text.trim().length > 0 && (
        // onPressIn rather than onPress: tapping away blurs the field, which
        // adds the line and closes it, and a press that waits for the finger
        // to lift would find the button already gone.
        <TouchableOpacity
          style={styles.newLineConfirm}
          onPressIn={() => { haptics.tap(); submit(); }}
          activeOpacity={interaction.activeOpacity}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Add ${placeholder.replace(/^New /, '')}`}
        >
          <Ionicons name="checkmark-circle" size={iconSize.lg} color={colors.accent} />
        </TouchableOpacity>
      )}
      </View>
      {pendingLabels.length > 0 && (
        <View style={styles.newLinePending}>
          <Text style={styles.newLinePendingText} numberOfLines={1}>{pendingLabels.join(' · ')}</Text>
          <TouchableOpacity
            onPress={() => { haptics.tap(); setPendingBoth(NO_LINE_PENDING); }}
            activeOpacity={interaction.activeOpacity}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${pendingLabels.join(' and ')}`}
          >
            <Ionicons name="close-circle" size={iconSize.sm} color={placeholderColor} />
          </TouchableOpacity>
        </View>
      )}
      <TitleTokenAccessory
        nativeID={accessoryId}
        onInsert={token => change(caret.insertToken(token))}
        onConfirm={confirm}
        confirmVisible={suggestion !== null}
      />
    </View>
  );
}

export function ProjectDetailScreen() {
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const fabBottom = useFabBottom();
  const navigation = useNavigation();
  // A task row's category chip opens that category's page. Stable, because
  // TaskItem is memoized.
  const handleOpenCategory = useCallback((category: string) => {
    (navigation as any).navigate('CategoryDetail', { category });
  }, [navigation]);
  const route = useRoute<RouteProp<RootStackParamList, 'ProjectDetail'>>();
  const { projectId, addLine } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const simpleMode = useSettingsStore(s => s.simpleMode);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);

  const projects = useProjectStore(useShallow(s => s.projects));
  const updateProject = useProjectStore(s => s.updateProject);
  const allTasks = useTaskStore(s => s.tasks);
  const addExistingToProject = useTaskStore(s => s.addExistingToProject);
  const addTask = useTaskStore(s => s.addTask);
  const bulkRemoveFromProject = useTaskStore(s => s.bulkRemoveFromProject);
  const bulkMoveToProject = useTaskStore(s => s.bulkMoveToProject);
  const bulkUncompleteTasks = useTaskStore(s => s.bulkUncompleteTasks);
  const deleteCheckedListItems = useTaskStore(s => s.deleteCheckedListItems);
  const uncompleteProject = useTaskStore(s => s.uncompleteProject);
  const unarchiveProject = useTaskStore(s => s.unarchiveProject);
  const reorderGroupChildren = useTaskStore(s => s.reorderGroupChildren);
  const removeFromGroup = useTaskStore(s => s.removeFromGroup);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const taskCategories = useCategoryStore(useShallow(s => s.categories));
  // The summary's deadline words move with the day; see ProjectsScreen.
  useLogicalDayKey();
  const reorderProjectItems = useTaskStore(s => s.reorderProjectItems);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkMarkMissed = useTaskStore(s => s.bulkMarkMissed);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetDifficulty = useTaskStore(s => s.bulkSetDifficulty);
  const rewardsEnabled = useSettingsStore(s => s.rewardsEnabled);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const groupTasks = useTaskStore(s => s.groupTasks);
  const setDeliverableValue = useTaskStore(s => s.setDeliverableValue);
  const completeProject = useTaskStore(s => s.completeProject);
  const createTaskGroup = useTaskGroupStore(s => s.createGroup);
  const updateTaskGroup = useTaskGroupStore(s => s.updateGroup);
  const taskGroups = useTaskGroupStore(useShallow(s => s.groups));
  const setGroupCollapsed = useTaskGroupStore(s => s.setGroupCollapsed);
  const groupRosterOf = useTaskStore(s => s.groupRosterOf);
  const completeGroup = useTaskStore(s => s.completeGroup);
  const deferGroup = useTaskStore(s => s.deferGroup);
  const addExistingToGroup = useTaskStore(s => s.addExistingToGroup);

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [pageMenuVisible, setPageMenuVisible] = useState(false);
  const [pageMenuAnchor, setPageMenuAnchor] = useState<CardAnchor | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [groupEditorVisible, setGroupEditorVisible] = useState(false);
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
  // Not screen state: every crossing re-rendered this whole screen, every
  // row and every sheet beside the list, which is what made dragging a line
  // into a section stutter. The section's highlight reads joinTargetChannel
  // and the list's freeze goes through dropCapture, so a crossing repaints
  // the one section it lit (see DropTargetChannel).
  const joinGroupIntentRef = React.useRef<string | null>(null);
  const joinTargetChannel = useDropTargetChannel();
  const dropCapture = React.useRef<DropCapture>(null);
  // Task the drop just handed to a group (set in onDragEnd, which runs before
  // onReorder), so the placement pass below leaves it alone — it belongs to
  // the group now, not to whatever slot it was let go over.
  const joinedTaskIdRef = React.useRef<string | null>(null);
  // Index (within projectListItems) of the row currently being dragged, kept
  // up to date from dragRange (called every hover update) so onDragMove can
  // tell which row is in flight.
  const activeDragIndexRef = React.useRef<number | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // A row deleted from its own expanded panel takes the expansion with it, so
  // an Undo brings the line back closed rather than open under a keyboard.
  useEffect(() => {
    if (expandedTaskId && !allTasks.some(t => t.id === expandedTaskId)) setExpandedTaskId(null);
  }, [allTasks, expandedTaskId]);
  // The line a blank "New line" field is open under, after Return in a list
  // line's text. See NewLineField.
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  // A section whose own "New line" field is open at its foot, on a list or in
  // a checklist section: the same field Return opens under a line. `n` moves
  // on with each line added, so the field remounts empty and focused.
  const [sectionLine, setSectionLine] = useState<{ groupId: string; n: number } | null>(null);
  // The add menu's "New section" field, open at the foot of the list.
  const [namingSection, setNamingSection] = useState(false);
  const handleSubmitLine = useCallback((taskId: string) => {
    setExpandedTaskId(null);
    setInsertAfterId(taskId);
  }, []);
  // True while a subtask inside the expanded row is mid-drag; the list has to
  // stop scrolling for the duration (see TaskItem.onSubtaskDragStateChange).
  const [draggingSubtask, setDraggingSubtask] = useState(false);
  // The section whose tasks are mid-drag, for the same reason one level up: a
  // section's rows are a nested SortableList whose responder sits inside this
  // screen's list, so the list has to stop scrolling or the drag is cancelled
  // on the first finger move. By id rather than a bool so only that section's
  // tray is lifted over its neighbours (see rowElevated), exactly as Today does.
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  // The list's own "New item" field, opened on demand (from the FAB, the
  // empty state, or a card's "+") rather than sitting on screen all the
  // time. Null when closed; a number otherwise, bumped on every add so the
  // field remounts empty and focused for the next one.
  const [topLineOpen, setTopLineOpen] = useState<number | null>(null);
  // A task project's own field, at the foot of the page where a new task
  // lands. Counts up like topLineOpen so each add remounts it empty.
  const [taskLineOpen, setTaskLineOpen] = useState<number | null>(null);
  // From a list card's "+": the field opens once the push has finished, so
  // the keyboard doesn't ride in on top of the transition.
  useEffect(() => {
    if (!addLine) return;
    const handle = InteractionManager.runAfterInteractions(() => setTopLineOpen(v => v ?? 0));
    return () => handle.cancel();
  }, [addLine]);
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const [applyTemplate, setApplyTemplate] = useState<TaskTemplate | null>(null);
  const [templateAppliedCount, setTemplateAppliedCount] = useState<number | null>(null);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const searchFilter = useFilterField();
  const existingSearch = searchFilter.query;
  // The picker's Modal stays mounted across opens, and SearchField's own
  // `autoFocus` only remounts the field on a `seed()` call — so it would
  // otherwise only focus the very first time this picker is ever opened.
  useEffect(() => {
    if (showExistingPicker) searchFilter.inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExistingPicker]);
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
  // Below `project` on purpose: the selector runs during render, so above the
  // declaration it read `project` before it existed.
  // Who the project is with, as the people store has them now: an archived or
  // deleted person drops off the page without the project being rewritten.
  const projectPeople = usePersonStore(useShallow(s => {
    const ids = project?.personIds ?? [];
    return ids.length === 0 ? [] : s.people.filter(p => ids.includes(p.id) && !p.archived);
  }));
  // Memoized because this walks the whole task list, and this screen
  // re-renders on any screen state change (an expanded row, entering selection
  // mode) rather than only on a task write. It also kept `copyText` below from
  // ever hitting: a fresh array every render is a fresh dependency every
  // render, so the memo re-ran every time while looking like it was working.
  const projectTasks = useMemo(
    () =>
      project
        ? allTasks
            // Archived rows are left out, as every other reader of a project
            // leaves them out (projectProgress, projectDecisions,
            // liveProjectSteps): archiving means "out of every list". Listed
            // here they read as open, and "Complete project, archive the rest"
            // left them all still on screen.
            .filter(t => t.projectId === project.id && t.parentId === null && !t.archived)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [allTasks, project],
  );
  const incompleteProjectTasks = useMemo(
    () => projectTasks.filter(t => !t.completed),
    [projectTasks],
  );
  const { copied, copy } = useCopyToClipboard();
  // Presentation only — see Project.kind.
  const isList = project?.kind === 'list';

  // The destination forecast line (see useDestinationForecast): fetched on
  // open and never stored.
  const awaySpan = project ? awaySpanOf(project) : null;
  const destination = project?.destination ?? null;
  const spanStartKey = awaySpan ? dayKeyOf(awaySpan.start) : null;
  const spanEndKey = awaySpan?.end ? dayKeyOf(addDays(awaySpan.end, -1)) : spanStartKey;
  // The geocode behind it also pins the trip's coordinates on the project, so
  // sunrise and sunset can follow the trip (Project.destinationLatitude). Re-read
  // rather than taken from this render, and only written while the destination
  // is still the one asked about and the place has actually moved.
  const pinDestination = useCallback((place: GeocodedPlace, askedFor: string) => {
    const current = useProjectStore.getState().projects.find(p => p.id === projectId);
    const pin = current ? destinationPinUpdate(current, askedFor, place) : null;
    if (pin) useProjectStore.getState().updateProject(projectId, pin);
  }, [projectId]);
  const { line: forecastLine, gap: forecastGap } = useDestinationForecast(
    destination, spanStartKey, spanEndKey, awayNights(awaySpan), pinDestination,
  );
  // One row per member, as progress counts them — see projectCompletedRows.
  const completedProjectTasks = useMemo(() => {
    if (!project) return [];
    const rows = projectCompletedRows(project.id, allTasks);
    // A list's checked lines keep the list's own order, so a packing list
    // reads the same checked or not. A project's read newest first.
    return project.kind === 'list'
      ? [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      : rows;
  }, [allTasks, project]);
  // A list set to keep checked lines in view shows them without the toggle.
  const keepChecked = project?.kind === 'list' && project.showChecked;
  const completedShown = showCompleted || keepChecked;
  // Clears the FAB under the last row, the same amount `detailFooter` below
  // reserves — but only when that footer isn't already on screen to provide
  // it. With completed tasks present, ListFooterComponent renders and carries
  // its own bottom padding; stacking this on top of it would double the gap.
  const baseListBottomPadding = completedProjectTasks.length === 0
    ? fabBottom + FAB_SIZE + spacing.lg
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
  //
  // A collapsed section's tasks are off screen too, so they're left out the
  // same way. Declared as a function of projectListItems below, which is where
  // the sections are known.
  // What this project has already decided — one row per member, most recent
  // answer first. It does its own filtering (members, unarchived, collapsed by
  // identity), so it takes the whole task list rather than projectTasks.
  const decisions = useMemo(() => projectDecisions(projectId, allTasks), [projectId, allTasks]);
  const decisionOutcomeMap = useMemo(() => decisionOutcomes(allTasks), [allTasks]);
  const answerTask = answerTaskId !== null ? allTasks.find(t => t.id === answerTaskId) ?? null : null;
  // Held so the sheet can close through `visible` rather than by leaving
  // the tree while still on screen. See useSheetSubject.
  const shownAnswerTask = useSheetSubject(answerTask);

  const onClose = () => {
    if (selectionMode) exitSelection();
    navigation.goBack();
  };

  // Deleting the project from its own editor used to leave this screen open
  // on nothing: a blank title, "No tasks yet", and an add button that made
  // orphan tasks and sections for a project that no longer existed. Only
  // once it has been seen, so a project still loading isn't mistaken for one
  // that was deleted.
  // Waits for the editor to have closed, so the sheet the delete came from
  // isn't pulled out from under itself mid-dismissal.
  const seenProjectRef = useRef(false);
  useEffect(() => {
    if (project) { seenProjectRef.current = true; return; }
    if (seenProjectRef.current && editingProject === null) navigation.goBack();
  }, [project, editingProject, navigation]);

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  // Every subtask on this screen, grouped once. Each row used to filter the
  // whole task list for its own children inline, which is O(tasks) per row and
  // — worse — handed the memoized row a fresh array on every render.
  // Each map below keeps last time's array for any key whose members didn't
  // change (reuseUnchangedLists), so adding one task re-renders the rows and
  // headers it touched rather than every one on the page.
  const subtasksPrev = useRef<Map<string, Task[]> | null>(null);
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.parentId) continue;
      const list = map.get(t.parentId);
      if (list) list.push(t);
      else map.set(t.parentId, [t]);
    }
    return (subtasksPrev.current = reuseUnchangedLists(subtasksPrev.current, map));
  }, [allTasks]);
  const subtasksOf = (id: string): Task[] => subtasksByParent.get(id) ?? NO_SUBTASKS;

  // Every task currently assigned to a group, across the whole app — a
  // TaskGroup has no projectId of its own (it's scoped by its children), and
  // TaskGroupHeader's "N/M done today" tally needs the stack's whole roster
  // regardless of which project happens to hold a given member. Same
  // computation as TodayScreen's own childrenByGroupId.
  const groupChildrenPrev = useRef<Map<string, Task[]> | null>(null);
  const childrenByGroupId = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.groupId) continue;
      const list = map.get(t.groupId);
      if (list) list.push(t);
      else map.set(t.groupId, [t]);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return (groupChildrenPrev.current = reuseUnchangedLists(groupChildrenPrev.current, map));
  }, [allTasks]);

  // Stacked tasks collapsed into a single 'group' entry, plus any stack built
  // on this project's screen that has no members to be found through — see
  // buildProjectListItems for which of the two puts a given stack here.
  const projectListItems: ProjectListItem[] = useMemo(
    () => buildProjectListItems(incompleteProjectTasks, taskGroups, projectId),
    [incompleteProjectTasks, taskGroups, projectId],
  );
  const lineCount = projectListItems.reduce((n, item) => n + (item.type === 'task' ? 1 : item.children.length), 0);
  // A long list gets a field that narrows it to the lines holding what's
  // typed. Drag is off while it's narrowed, since a drop among the lines
  // left showing can't say where it lands among the hidden ones.
  const lineFilter = useFilterField();
  // On a project, its checklist sections are where a long run of lines builds
  // up (a packing list), so enough of those brings the field too, narrowing
  // the whole page the same way.
  const checklistLineCount = projectListItems.reduce(
    (n, item) => n + (item.type === 'group' && item.group.checklist ? item.children.length : 0), 0,
  );
  // A list of books or gift ideas gets long the same way, and with nothing
  // dated to sort by, finding one item means reading the lot. The field stays
  // off a short list, which is what keeps the top of one uncluttered.
  const lineFilterShown = (isList ? lineCount : checklistLineCount) >= LIST_FILTER_MIN_LINES;
  const filteringLines = lineFilterShown && lineFilter.query.trim().length > 0;
  const shownListItems = useMemo(
    () => (filteringLines ? filterProjectListItems(projectListItems, lineFilter.query) : projectListItems),
    [filteringLines, projectListItems, lineFilter.query],
  );
  // A list keeping its checked items in view (a packing list) draws each one
  // at the foot of its own section, so the list reads as packed per section.
  // Only a section drawn on this page can hold them: anything else (no
  // section, or one homed elsewhere) stays in the checked block at the bottom.
  // A list that folds its checked items away keeps them in one place behind
  // the toggle, where scattering them back up the page would be a surprise.
  // Narrowed by the find field like the open rows, so a search doesn't leave
  // every checked item showing beneath what it found.
  const shownCheckedTasks = useMemo(
    () => (filteringLines ? filterTasksByTitle(completedProjectTasks, lineFilter.query) : completedProjectTasks),
    [filteringLines, completedProjectTasks, lineFilter.query],
  );
  const checkedBySection = useMemo(() => {
    const map = new Map<string, Task[]>();
    if (!keepChecked) return map;
    const onPage = new Set<string>();
    for (const item of shownListItems) if (item.type === 'group') onPage.add(item.group.id);
    for (const t of shownCheckedTasks) {
      if (!t.groupId || !onPage.has(t.groupId)) continue;
      const list = map.get(t.groupId);
      if (list) list.push(t); else map.set(t.groupId, [t]);
    }
    return map;
  }, [keepChecked, shownListItems, shownCheckedTasks]);
  const checkedAtFoot = useMemo(
    () => (checkedBySection.size === 0
      ? shownCheckedTasks
      : shownCheckedTasks.filter(t => !(t.groupId && checkedBySection.has(t.groupId)))),
    [checkedBySection, shownCheckedTasks],
  );
  // Each section's roster in this project, done and undone, for its header's
  // tally. Built once, so the memoized headers get the same array until a task
  // actually changes.
  const sectionRosterPrev = useRef<Map<string, Task[]> | null>(null);
  const sectionRosterById = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const [groupId, children] of childrenByGroupId) {
      map.set(groupId, groupRoster(children.filter(t => t.projectId === projectId && !t.archived && t.parentId === null)));
    }
    return (sectionRosterPrev.current = reuseUnchangedLists(sectionRosterPrev.current, map));
  }, [childrenByGroupId, projectId]);

  const selectableTasks = useMemo(() => {
    const onScreen: Task[] = [];
    // What's shown, so Select all while a list is narrowed to "Find a line"
    // takes the lines left showing, not the ones hidden with them.
    for (const item of shownListItems) {
      if (item.type === 'task') onScreen.push(item.task);
      else if (!item.group.collapsed) onScreen.push(...item.children);
    }
    return completedShown ? [...onScreen, ...shownCheckedTasks] : onScreen;
  }, [shownListItems, completedShown, shownCheckedTasks]);
  const copyText = useMemo(
    () => projectCopyText(projectListItems, id => subtasksByParent.get(id) ?? NO_SUBTASKS, projectId),
    [projectListItems, subtasksByParent, projectId],
  );

  // ——— Dragging the add button into the list ———————————————————————————
  //
  // Same gesture as Today's and Projects' own add buttons, over the shape
  // this list actually has: no category headers, so every loose task is a
  // plain insert point and a stack row means "join it" — the same rule the
  // row-drag's own dropIntoIndex/dropDisabled above already applies for a
  // dragged task.
  const dropZonesRef = useRef<FabDropZonesHandle>(null);
  const [fabDragging, setFabDragging] = useState(false);
  const scrollControl = useRef<DragScroller | null>(null);
  // Scrolls back up to a list's add field when it's opened from the FAB.
  const listScroller = useRef<RowScroller | null>(null);
  const fabIntentChannel = useFabIntentChannel();
  const [quickAddSeed, setQuickAddSeed] = useState<{ groupId?: string } | undefined>(undefined);
  const [quickAddSeedLabel, setQuickAddSeedLabel] = useState<string | null>(null);
  // The drop that opened the sheet, read once when the task comes back.
  const pendingDropRef = useRef<FabDropIntent | null>(null);

  const zoneByKey = useMemo(() => {
    const map = new Map<string, DropZone>();
    projectListItems.forEach(item => {
      const key = projectListItemKey(item);
      map.set(
        key,
        item.type === 'group'
          ? { kind: 'group', key, groupId: item.group.id, groupTitle: item.group.title, category: null }
          : { kind: 'task', key, category: null },
      );
    });
    return map;
  }, [projectListItems]);

  /**
   * Give the freshly created task the position it was dropped at — the same
   * splice-then-reorder pass a finished row drag runs (see the list's own
   * onReorder above), just seeded from the drop point instead of a settled
   * drag.
   */
  const placeCreatedTask = (task: Task, intent: Extract<FabDropIntent, { kind: 'insert' }>) => {
    const base = projectListItems.filter(item => !(item.type === 'task' && item.task.id === task.id));
    const anchor = base.findIndex(item => projectListItemKey(item) === intent.anchorKey);
    if (anchor < 0) return;
    const spliced: ProjectListItem[] = [...base];
    spliced.splice(intent.before ? anchor : anchor + 1, 0, { type: 'task', task });
    reorderProjectItems(projectId, spliced.map(item => (item.type === 'group' ? item.group.id : item.task.id)));
  };

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
  //
  // Both are scoped to this project's own members. A section's roster can hold
  // tasks filed under other projects (see buildProjectListItems), and a swipe
  // here selected those too, off screen, where "Remove from project" then
  // unfiled them from projects nobody was looking at.
  const handleGroupSwipeSelect = useCallback((groupId: string) => {
    const ids = groupRosterOf(groupId)
      .filter(t => !t.completed && !t.archived && t.projectId === projectId)
      .map(t => t.id);
    if (ids.length === 0) return;
    setExpandedTaskId(null);
    enterSelectionMode(ids);
  }, [groupRosterOf, enterSelectionMode, projectId]);

  const handleGroupComplete = useCallback((groupId: string) => {
    const roster = useTaskStore.getState().groupRosterOf(groupId);
    const open = roster.filter(t => !t.completed);
    const here = open.filter(t => t.projectId === projectId);
    // completeGroup finishes the whole roster, so the members filed elsewhere
    // go in its skip list alongside whatever the answer prompt skips.
    const elsewhere = open.filter(t => t.projectId !== projectId).map(t => t.id);
    requestComplete({
      ids: here.map(t => t.id),
      complete: skipIds => completeGroup(groupId, { skipIds: [...skipIds, ...elsewhere] }),
    });
  }, [completeGroup, requestComplete, projectId]);

  const openAddToSection = (group: TaskGroup) => {
    // Typed where it goes, not in a sheet: the field opens at the section's
    // foot, as it does under a list line on Return, and Return adds the task
    // and opens the next field. A task section used to open the full quick
    // add, which cost a sheet's round trip per task when filling a section
    // with several; anything the field can't set is a tap on the row away.
    // Dropping the add button on a section still opens the sheet.
    setExpandedTaskId(null);
    setInsertAfterId(null);
    if (group.collapsed) setGroupCollapsed(group.id, false);
    setSectionLine({ groupId: group.id, n: 0 });
  };

  // Stable, and a no-op on an empty section. An empty one always draws open
  // (it has no rows to hide, and collapsed it would hide its own Add task),
  // but the tap still stored `collapsed`, so the first task added to it
  // arrived in a section that snapped shut over it.
  const handleGroupToggleCollapse = useCallback((groupId: string) => {
    if (expandedTaskId !== null) { setExpandedTaskId(null); return; }
    const group = useTaskGroupStore.getState().getGroupById(groupId);
    if (!group) return;
    // Finished rows count too, to match `empty` in the render: a section whose
    // only members are done is not empty, so it has to be able to collapse.
    const hasRows = useTaskStore.getState().tasks.some(
      t => t.groupId === groupId && t.projectId === projectId && t.parentId === null && !t.archived,
    );
    if (!hasRows) return;
    haptics.tap();
    setDraggingGroupId(null);
    setGroupCollapsed(groupId, !group.collapsed);
  }, [expandedTaskId, setGroupCollapsed, projectId]);

  // Dragged out of a section, a task lands just below it rather than wherever
  // its within-section order happens to fall in the project's number space.
  const handleDragOutOfSection = (groupId: string, task: Task) => {
    removeFromGroup(task.id);
    const ids: string[] = [];
    for (const item of projectListItems) {
      if (item.type === 'group') {
        ids.push(item.group.id);
        if (item.group.id === groupId) ids.push(task.id);
      } else if (item.task.id !== task.id) {
        ids.push(item.task.id);
      }
    }
    reorderProjectItems(projectId, ids);
    haptics.success();
  };
  const handleGroupDefer = useCallback((groupId: string, date: Date) => deferGroup(groupId, date), [deferGroup]);
  const handleGroupPressEdit = useCallback((groupId: string) => {
    const group = useTaskGroupStore.getState().getGroupById(groupId);
    if (!group) return;
    setEditingGroup(group);
    setGroupEditorVisible(true);
  }, []);

  // One handler per section, kept while the list's own `drag` for it stays
  // the same (ReorderableList caches that per row). Built inline, a fresh
  // arrow defeated TaskGroupHeader's memo, so every header re-rendered on any
  // change to this screen's state: opening the quick add, a keystroke's
  // worth of selection, a task added.
  const groupDragHandlers = useRef(new Map<string, { drag: () => void; handler: () => void }>());
  const groupDragHandlerFor = (groupId: string, drag: () => void) => {
    const cached = groupDragHandlers.current.get(groupId);
    if (cached && cached.drag === drag) return cached.handler;
    const handler = () => {
      pendingGroupDragRef.current = groupId;
      drag();
      pendingGroupDragRef.current = null;
    };
    groupDragHandlers.current.set(groupId, { drag, handler });
    return handler;
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
    if (!project) return;
    if (key === 'new') {
      // A list's item is typed in its own field, which takes no dates or
      // categories and adds on return, not in the task sheet.
      if (isList) { listScroller.current?.scrollToTop(); setTopLineOpen(v => v ?? 0); return; }
      openTaskLine();
      return;
    }
    if (key === 'template') {
      setTemplatePickerVisible(true);
      return;
    }
    if (key === 'replies') {
      setGuestsOpen(true);
      return;
    }
    if (key === 'stack') {
      // Named in place at the foot of the list rather than in the editor
      // sheet: a name is all most sections need, and tapping the finished
      // header opens the sheet for the rest. createNamedSection does the work.
      setNamingSection(true);
      listScroller.current?.scrollToEnd();
      return;
    }
    searchFilter.clear();
    setShowExistingPicker(true);
  };

  /**
   * A task project's add field, at the foot of the list. Typed in place like
   * a section's: Return adds the task and opens the next field, where quick
   * add cost a sheet per task. Dropping the add button still opens the sheet.
   */
  const openTaskLine = () => {
    setExpandedTaskId(null);
    setInsertAfterId(null);
    setSectionLine(null);
    setTaskLineOpen(v => v ?? 0);
    listScroller.current?.scrollToEnd();
  };

  /** A section named from the foot of the list, placed after what's there. */
  const createNamedSection = (name: string) => {
    setNamingSection(false);
    animateLayout();
    haptics.tap();
    // Homed here, so it stays on this page while the user fills it in —
    // there are no members yet to scope it by. See TaskGroup.projectId.
    const group = createTaskGroup(name, null, projectId);
    // createGroup ranks a new stack against other stacks only, which says
    // nothing about where it falls among this project's tasks — the two
    // share one number space (TaskGroup.sortOrder), so it has to be anchored
    // into this list or it lands at the top of it. Same re-anchor groupTasks
    // does, from the other end: a new stack goes after the rows already here.
    // Read off the list as drawn: a stacked task's sortOrder is its place
    // within its section, and a section's own slot is on the group, so the
    // raw tasks alone could put the new one above sections already at the
    // bottom.
    const lastSlot = projectListItems.reduce(
      (m, item) => Math.max(m, item.type === 'group' ? item.group.sortOrder : item.task.sortOrder),
      0,
    );
    updateTaskGroup(group.id, { sortOrder: lastSlot + 1 });
    // createGroup makes it collapsed. Empty, it draws open regardless, but the
    // stored value would snap it shut over its first task (see
    // handleGroupToggleCollapse).
    setGroupCollapsed(group.id, false);
    // On a list the next thing is its first line, so the section's own line
    // field opens straight under it, same field its "Add a line" button opens.
    if (isList) setSectionLine({ groupId: group.id, n: 0 });
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

  /**
   * Close the quick-add sheet and forget the placement it was opened with.
   * Every path out of the sheet goes through here — cancel, create, and "More
   * details" — or the next plain tap on the button would inherit a drop from
   * a drag two minutes ago.
   */
  const closeQuickAdd = () => {
    setQuickAddVisible(false);
    setQuickAddSeed(undefined);
    setQuickAddSeedLabel(null);
    pendingDropRef.current = null;
  };

  // A drag of the add button chose where this task goes; a plain tap didn't,
  // and shaking the seed chip off in the sheet takes the choice back. Joining
  // a stack is seeded straight onto the create call (`quickAddSeed.groupId`),
  // so only a plain insert point needs placing after the fact.
  const handleTaskCreated = (task: Task, placed: boolean) => {
    const dropped = pendingDropRef.current;
    pendingDropRef.current = null;
    attachToProject(task);
    if (placed && dropped?.kind === 'insert') placeCreatedTask(task, dropped);
  };

  /** Where a drop on a list opens its line field, or null for the top field. */
  const listLineFieldFor = (intent: FabDropIntent): { kind: 'section'; groupId: string } | { kind: 'after'; taskId: string } | null => {
    if (intent.kind === 'joinGroup') return { kind: 'section', groupId: intent.groupId };
    if (intent.kind !== 'insert') return null;
    const index = projectListItems.findIndex(item => projectListItemKey(item) === intent.anchorKey);
    const at = intent.before ? projectListItems[index - 1] : projectListItems[index];
    return at && at.type === 'task' ? { kind: 'after', taskId: at.task.id } : null;
  };

  /**
   * A checklist section, A to Z: the list's own sort, one section at a time,
   * for the packing list inside a trip. One undo step puts it back.
   */
  const sortSectionAToZ = (group: TaskGroup, children: readonly Task[]) => {
    const before = [...children].sort((a, b) => a.sortOrder - b.sortOrder).map(t => t.id);
    const after = [...children]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }))
      .map(t => t.id);
    animateLayout();
    haptics.tap();
    reorderGroupChildren(group.id, after);
    useTaskStore.getState().setLastAction({
      label: 'Sorted A to Z',
      destructive: true,
      undo: () => reorderGroupChildren(group.id, before),
    });
  };

  /** A line at the foot of a section, from its own field. */
  /**
   * One typed or pasted line as a task (#2312), the same way from every add
   * field on the page: its `#` and `@` markers, whatever the keyboard bar's
   * Confirm set on it, and a link at the end kept on the task with the words
   * as its title. No title rules and no default category: a line is what was
   * typed, plus only what its own markers say. A task (`asTask`, a task
   * section's field) keeps both, the way quick add and the project's own
   * suggestions do.
   */
  const createLine = (text: string, placement: Partial<NewTaskDraft>, pending: LinePending = NO_LINE_PENDING, asTask = false): Task => {
    const context: LineParseContext = {
      categories: useCategoryStore.getState().categories.map(c => c.name),
      tags: useTaskStore.getState().allTags(),
      people: usePersonStore.getState().people.filter(p => !p.archived),
      groups: groupMentionTokens(),
    };
    const marked = lineMarkerFields(text, context);
    const link = parseLabelledLink(marked.title);
    const title = link ? (link.label || linkHost(link.url)) : marked.title;
    const { draft, seriesDates } = linePendingFields(pending);
    const task = addTask(
      {
        title: title.slice(0, TITLE_MAX_LENGTH),
        ...placement,
        ...draft,
        ...(marked.category ? { category: marked.category } : {}),
        ...(marked.tags.length > 0 ? { tags: marked.tags } : {}),
        ...(marked.personIds.length > 0 ? { personIds: marked.personIds } : {}),
        ...(link ? { linkUrl: link.url } : {}),
      },
      undefined,
      { skipTitleRules: !asTask, skipCategoryDefault: !asTask },
    );
    // "On the 10th and the 15th": the rest of the set, not just its first date.
    if (seriesDates) useTaskStore.getState().applyTaskDates(task.id, seriesDates);
    return task;
  };

  /** Tasks from the foot field, at the end of the project as quick add put them. */
  const addTaskLines = (raw: string[], pending?: LinePending) => {
    const lines = cleanPastedLines(raw);
    if (lines.length === 0 || !project) return;
    animateLayout();
    let last: Task | null = null;
    for (const line of lines) {
      last = createLine(line, { projectId: project.id }, lines.length === 1 ? pending : undefined, true);
    }
    if (last) {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      setFlashTaskId(last.id);
      flashTimeoutRef.current = setTimeout(() => setFlashTaskId(null), 1200);
    }
    haptics.tap();
    lineFilter.clear();
    setTaskLineOpen(v => (v ?? 0) + 1);
    listScroller.current?.scrollToEnd();
  };

  const addLineToSection = (group: TaskGroup, text: string, pending?: LinePending) => {
    const task = createLine(text, { projectId, groupId: group.id }, pending, !isList && !group.checklist);
    const siblings = useTaskStore.getState().tasks
      .filter(t => t.groupId === group.id && t.projectId === projectId && !t.parentId && !t.completed && !t.archived && t.id !== task.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    reorderGroupChildren(group.id, [...siblings.map(t => t.id), task.id]);
    haptics.tap();
    lineFilter.clear();
  };

  const openQuickAddForDrop = (intent: FabDropIntent) => {
    // Dropped back on the button: the drag is the whole of what happened, so
    // no sheet, and nothing left armed for the next tap.
    if (intent.kind === 'cancel') {
      pendingDropRef.current = null;
      haptics.tap();
      return;
    }
    // On a list, a drop opens the line field where it landed rather than the
    // sheet: into a section at its foot, or under the line it was let go on.
    // Anywhere the field can't go (above a section, the very top) falls back
    // to the field at the top of the list, where a new line goes anyway.
    if (isList) {
      const target = listLineFieldFor(intent);
      if (target) {
        haptics.tap();
        setExpandedTaskId(null);
        if (target.kind === 'section') {
          setInsertAfterId(null);
          if (useTaskGroupStore.getState().getGroupById(target.groupId)?.collapsed) setGroupCollapsed(target.groupId, false);
          setSectionLine({ groupId: target.groupId, n: 0 });
        }
        else { setSectionLine(null); setInsertAfterId(target.taskId); }
        return;
      }
      if (intent.kind === 'plain' || intent.kind === 'insert') {
        listScroller.current?.scrollToTop();
        setTopLineOpen(v => v ?? 0);
        return;
      }
    }
    pendingDropRef.current = intent;
    if (intent.kind === 'joinGroup') {
      setQuickAddSeed({ groupId: intent.groupId });
      setQuickAddSeedLabel(intent.groupTitle.trim() || 'Section');
    } else {
      setQuickAddSeed(undefined);
      setQuickAddSeedLabel(null);
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

  const handleQuickAddOpenFull = (draft: TaskDraft) => {
    // The draft carries the seeded stack, if any; only the placement is let
    // go of, and the editor has no notion of one anyway.
    closeQuickAdd();
    setEditingTask(null);
    setEditorInitialDraft({ ...draft, projectId: project?.id ?? null });
    setEditorVisible(true);
  };

  // The quick add is memoized and mounted the whole time this screen is.
  // Passed as plain functions, every render of this screen re-rendered the
  // hidden sheet too, all of its JSX included.
  const onQuickAddClose = useStableCallback(closeQuickAdd);
  const onQuickAddOpenFull = useStableCallback(handleQuickAddOpenFull);
  const onQuickAddCreated = useStableCallback(handleTaskCreated);
  const onQuickAddResumed = useStableCallback(attachToProject);

  // Shared by a loose top-level row and a stacked task rendered inside its
  // group's tray — same capabilities either way (checkbox, swipe actions,
  // expand-for-subtasks); only the drag source and the indent differ.
  // `indented` rows are already under their stack's header, so the inline
  // stack chip (`showGroup`) would just repeat it.
  /**
   * A list's items, added straight into the project with no date, category
   * or title rules — an item typed here is exactly what it says.
   * `skipTitleRules` matters: a rule rewriting "Ask about the MRI results"
   * would be editing the user's own note back at them.
   */
  const addListLines = (raw: string[], pending?: LinePending) => {
    // A pasted list often carries its own bullets; those aren't part of the item.
    const lines = cleanPastedLines(raw);
    if (lines.length === 0 || !project) return;
    animateLayout();
    // New lines go at the top, right under the field they were typed in, in
    // the order written. They used to go to the end, which on a long list was
    // off screen, and a note under the field had to say where they'd gone.
    const created: string[] = [];
    lines.forEach(line => {
      // A line that is a link, or ends in one ("Tapas place https://…"), keeps
      // the link on the task so the row's link button opens it (createLine).
      // Only a single typed line can carry what Confirm set; a paste never
      // sat in the field to be confirmed.
      const task = createLine(line, { projectId: project.id }, lines.length === 1 ? pending : undefined);
      created.push(task.id);
    });
    // The page's own order with the new lines in front, written through the
    // same slot pool a drag uses, so sections keep their places.
    if (projectListItems.length > 0) {
      reorderProjectItems(project.id, [
        ...created,
        ...projectListItems.map(item => (item.type === 'group' ? item.group.id : item.task.id)),
      ]);
    }
    haptics.tap();
    // A new item needn't match what's being searched for, and one added
    // straight into hiding reads as one that wasn't added.
    lineFilter.clear();
    // Keeps the field open, remounted empty and focused, for the next item.
    setTopLineOpen(v => (v ?? 0) + 1);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    setFlashTaskId(created[0]);
    flashTimeoutRef.current = setTimeout(() => setFlashTaskId(null), 2500);
  };

  const checklistSectionIds = useMemo(
    () => new Set(taskGroups.filter(g => g.checklist).map(g => g.id)),
    [taskGroups],
  );

  // A checked row, at the bottom or (keepChecked) at the foot of its section.
  // Not draggable: list order is the open rows'.
  const renderCheckedRow = (task: Task, inSection = false) => {
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
        // The same two a live row gets, so a list's finished lines don't grow
        // the chips its open ones leave out.
        showCategory={!isList}
        onOpenCategory={handleOpenCategory}
        showDate={!isList || !!task.dueDate}
        // Under its own section heading the section chip would only repeat it.
        showGroup={!inSection}
        showPin={false}
        indented={inSection}
        listRow={isList}
        swipeDeletes={isList}
      />
    );
  };

  const renderProjectTaskItem = (
    task: Task,
    opts: { drag?: () => void; isActive?: boolean; indented?: boolean } = {},
  ) => {
    const subs = subtasksOf(task.id);
    const row = (
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
        onOpenCategory={handleOpenCategory}
        showGroup={!opts.indented}
        // A list's members are undated by construction, so the date affordance
        // is an empty control on every row. Turning it off is most of what
        // makes a list look like one rather than like a project with a lot of
        // blank fields — the task still has the field, and the editor still
        // offers it, for the line that turns out to be a real errand.
        // A checklist section's lines are the same: checked off, not dated.
        // A list row has no date to show, unless an item came in carrying one
        // (Add existing task, Move to project, a template). That item is on
        // Today too, so the row says why rather than hiding it.
        showDate={(!isList || !!task.dueDate) && !checklistSectionIds.has(task.groupId ?? '')}
        showPin={false}
        highlighted={task.id === flashTaskId}
        listRow={isList || checklistSectionIds.has(task.groupId ?? '')}
        swipeDeletes={isList}
        onSubmitLine={isList || checklistSectionIds.has(task.groupId ?? '') ? handleSubmitLine : undefined}
      />
    );
    if (insertAfterId !== task.id) return row;
    return (
      <>
        {row}
        <NewLineField
          key={task.id}
          onAdd={(text, pending) => setInsertAfterId(addLineAfter(task, text, pending))}
          onAddMany={lines => setInsertAfterId(addLinesAfter(task, lines) ?? task.id)}
          onDone={() => setInsertAfterId(null)}
          styles={styles}
          placeholderColor={colors.textTertiary}
          placeholder={isList ? 'New item' : 'New line'}
          inTray={!!opts.indented}
        />
      </>
    );
  };

  /**
   * A new line right after `after`, in its section if it's in one, from what
   * was typed in the field Return opened. Same reading as the top field: a
   * link in the text becomes the line's link. Answers the new line's id, so
   * the field can move under it for the next.
   */
  const addLineAfter = (after: Task, text: string, pending?: LinePending): string => {
    const task = createLine(text, { projectId, groupId: after.groupId ?? null }, pending);
    const order = orderWithInserted(projectListItems, after.id, task.id);
    if (order?.groupId) reorderGroupChildren(order.groupId, order.ids);
    else if (order) reorderProjectItems(projectId, order.ids);
    haptics.tap();
    lineFilter.clear();
    return task.id;
  };

  /** Several lines at once after `after` (a paste), each under the one before. */
  const addLinesAfter = (after: Task, lines: string[]): string | null => {
    let anchor = after;
    let lastId: string | null = null;
    for (const line of cleanPastedLines(lines)) {
      lastId = addLineAfter(anchor, line);
      anchor = useTaskStore.getState().tasks.find(t => t.id === lastId) ?? anchor;
    }
    return lastId;
  };

  const eligibleForAdd = useMemo(() => {
    // Nothing to sort while the picker is shut, and this ran on every add.
    if (!project || !showExistingPicker) return [];
    const q = existingSearch.trim().toLowerCase();
    // Newest first, so the task just written somewhere else is at the top
    // rather than wherever it fell in store order.
    return allTasks
      .filter(t =>
        !t.parentId &&
        !t.projectId &&
        !t.completed &&
        !t.archived &&
        (q === '' || t.title.toLowerCase().includes(q))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [allTasks, existingSearch, project, showExistingPicker]);
  const shownForAdd = useMemo(() => eligibleForAdd.slice(0, EXISTING_PICKER_LIMIT), [eligibleForAdd]);

  // Where the bulk bar can move a selection: every other active project.
  const moveTargets = useMemo(
    () => projects
      .filter(p => p.id !== projectId && !p.archived && !p.completed)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(p => ({ id: p.id, title: p.title, isList: p.kind === 'list' })),
    [projects, projectId],
  );

  // The line under the header: how far along the project is and its deadline,
  // or, once it's finished or filed away, that, with the way back.
  const pastWindow = project ? isProjectPastWindow(project, progress) : false;
  const summaryCaption = project
    ? projectCardCaption(
        project,
        pastWindow,
        project.archived ? 'archived' : project.completed ? 'completed' : 'active',
        dayResetTime,
      )
    : null;
  // How many open tasks here are waiting on something, said on the summary
  // line so a page of dimmed rows has its count.
  // Not needed (a branch that wasn't taken, see Task.answerGate) is counted
  // apart: those rows aren't waiting for anything, and the progress figure
  // already leaves them out.
  const notNeededHere = useMemo(
    () => incompleteProjectTasks.filter(t => isTaskNotNeeded(t)).length,
    [incompleteProjectTasks],
  );
  const waitingHere = useMemo(
    () => incompleteProjectTasks.filter(t => isHeldBack(t)).length - notNeededHere,
    [incompleteProjectTasks, notNeededHere],
  );
  const summaryProgress = project && progress.total > 0
    ? (projectProgressNote(project, progress) ?? `${progress.done} of ${progress.total} done`)
      + (waitingHere > 0 ? ` · ${waitingHere} waiting` : '')
      + (notNeededHere > 0 ? ` · ${notNeededHere} not needed` : '')
    : null;
  // The trip's own dates, which the card's "Leaves in 45 days" never names.
  const tripLine = project?.awayStart
    ? `Away ${format(new Date(project.awayStart), 'MMM d')}${project.awayEnd ? ` to ${format(new Date(project.awayEnd), 'MMM d')}` : ''}`
      + (project.destination ? ` · ${project.destination}` : '')
    : null;
  const [lookAheadOpen, setLookAheadOpen] = useState(false);
  const tripAhead = !!awaySpan && !project?.completed && !project?.archived
    && awaySpan.start.getTime() > Date.now();
  // How recently it moved, and a way to its history. The Completed section
  // lists each member once, so the Logbook is where the rest of it lives.
  const activityLine = useMemo(
    // Not on a list: "last worked on" is a project's question, and a running
    // list of books to read isn't something that goes stale.
    () => (project && project.kind !== 'list'
      ? describeProjectActivity(projectActivity(project.id, allTasks, dayResetTime))
      : null),
    [project, allTasks, dayResetTime],
  );
  const paused = !!project?.pausedUntil && isPausedOn(project, getLogicalDayKey(new Date(), dayResetTime));
  // A pause that has run out on its own: its day has passed but the field is
  // still set, which is what lets the page offer its routines a new day once.
  const pauseEnded = !!project?.pausedUntil && !paused;
  // Planning is a pause with no day (PLANNING_PAUSE_KEY), ended only by hand.
  const planning = !!project && isPlanning(project);
  const routinesToCatchUp = useMemo(
    () => (pauseEnded ? overdueRoutines(projectId, allTasks, getCurrentDayStart(), dayResetTime) : []),
    [pauseEnded, projectId, allTasks, dayResetTime],
  );
  const redateRoutines = useTaskStore(s => s.redateRoutines);
  /**
   * Ending a pause, from "Resume now" or the offer after one ran out: the
   * routines that came due while it held them back are overdue, and a weekly
   * watering three weeks late isn't three weeks of work. Asked, since a
   * routine left overdue can be on purpose.
   */
  const endPause = () => {
    if (!project) return;
    const overdue = overdueRoutines(project.id, allTasks, getCurrentDayStart(), dayResetTime);
    const wasPlanning = isPlanning(project);
    updateProject(project.id, { pausedUntil: null });
    if (overdue.length === 0) return;
    Alert.alert(
      overdue.length === 1 ? 'Move the routine that came due?' : `Move ${overdue.length} routines that came due?`,
      `They came due while the project was ${wasPlanning ? 'in Planning' : 'paused'}. Move each to its next day from today, or leave them overdue.`,
      [
        { text: 'Leave them', style: 'cancel' },
        { text: 'Move them', onPress: () => { animateLayout(); redateRoutines(overdue.map(t => t.id)); } },
      ],
    );
  };
  // "12 Yes, 3 No, 5 waiting", one line per set of questions. See projectAnswerTallies.
  const answerTallies = useMemo(
    () => projectAnswerTallies(projectId, allTasks).map(answerTallyParts).filter(parts => parts.length > 0),
    [projectId, allTasks],
  );
  const showSummary = !!project && (routinesToCatchUp.length > 0 || summaryProgress !== null || summaryCaption !== null || tripLine !== null || paused || activityLine !== null || answerTallies.length > 0);
  // A list whose summary is only its count (and a date, if it has one) draws it
  // as a caption over the items rather than as a card, so the page doesn't open
  // on the same stats card a project does. Anything that needs the card (a
  // button, a trip, a pause, a tally) keeps it.
  const summaryCaptionOnly = isList && showSummary && routinesToCatchUp.length === 0 && tripLine === null
    && !paused && activityLine === null && answerTallies.length === 0
    && !project!.archived && !project!.completed;

  /**
   * One task per guest, each asking the given options on completion, under a
   * "Guests" section: an existing one on this page if there is one, else a
   * new one at the bottom. A section keeps a guest list from mixing into the
   * party's own tasks, and a second batch lands with the first.
   *
   * A new section is a checklist: a guest is ticked off with a reply, never
   * dated or pulled onto a day. And a name already on the list is left alone,
   * so pasting the whole list again to add two latecomers adds two rows.
   */
  const addGuests = (names: string[], options: string[]) => {
    if (!project) return;
    let section = taskGroups.find(g => g.projectId === projectId && g.title.trim().toLowerCase() === 'guests');
    if (!section) {
      section = createTaskGroup('Guests', null, projectId);
      const lastSlot = projectListItems.reduce(
        (m, item) => Math.max(m, item.type === 'group' ? item.group.sortOrder : item.task.sortOrder),
        0,
      );
      updateTaskGroup(section.id, { sortOrder: lastSlot + 1, checklist: true });
    }
    const sectionId = section.id;
    const onList = new Set(
      allTasks
        .filter(t => t.groupId === sectionId && t.projectId === projectId && !t.archived && !t.parentId)
        .map(t => t.title.trim().toLowerCase()),
    );
    const fresh = names.filter(name => {
      const key = name.trim().toLowerCase();
      if (!key || onList.has(key)) return false;
      onList.add(key);
      return true;
    });
    if (fresh.length === 0) return;
    animateLayout();
    for (const name of fresh) {
      addTask(
        { title: name.trim(), projectId, groupId: sectionId, deliverableKind: 'choice', deliverableOptions: options },
        undefined,
        { skipTitleRules: true, skipCategoryDefault: true },
      );
    }
  };
  // The trailing "New task" under a project's list. Only once there's a
  // list to be under: the empty state already has its own button. A list
  // (isList) has no trailing button of its own — see the top of the screen.
  const showInlineNewTask = !!project && !selectionMode && projectListItems.length > 0;

  /**
   * A list, A to Z: loose lines among their own slots and each section's
   * lines within it, sections left where they are. One step on the Undo bar
   * puts the hand order back.
   */
  const sortListAToZ = () => {
    if (!project) return;
    const before = {
      top: projectListItems.map(item => (item.type === 'group' ? item.group.id : item.task.id)),
      sections: projectListItems
        .filter((i): i is Extract<ProjectListItem, { type: 'group' }> => i.type === 'group')
        .map(i => ({ groupId: i.group.id, ids: [...i.children].sort((a, b) => a.sortOrder - b.sortOrder).map(t => t.id) })),
    };
    const after = alphabeticalPageOrder(projectListItems);
    const apply = (order: typeof after) => {
      reorderProjectItems(project.id, order.top);
      for (const section of order.sections) reorderGroupChildren(section.groupId, section.ids);
    };
    animateLayout();
    haptics.tap();
    apply(after);
    useTaskStore.getState().setLastAction({
      label: 'Sorted A to Z',
      destructive: true,
      undo: () => apply(before),
      redo: () => apply(after),
    });
  };

  return (
    <SpotlightProvider progress={spotlightProgress}>
      <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
        <DetailHeader
          title={project?.title ?? ''}
          onBack={onClose}
          actions={
            <View style={styles.detailHeaderActions}>
              {/* Share, whose sheet includes Copy: a list of questions or gift
                  ideas is usually headed for a message, not the clipboard.
                  Long-press still copies in one step. */}
              {!!copyText && (
                <TouchableOpacity
                  onPress={() => {
                    Share.share({ message: `${project?.title ?? ''}\n\n${copyText}` }).catch(() => {});
                  }}
                  onLongPress={() => copy(copyText)}
                  delayLongPress={interaction.delayLongPress}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={isList ? 'Share this list' : 'Share task names'}
                  accessibilityHint="Long press to copy instead"
                >
                  <Ionicons name={copied ? 'checkmark' : 'share-outline'} size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {!!anthropicApiKey && (
                <TouchableOpacity
                  onPress={() => { haptics.tap(); setSuggestionsVisible(true); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={isList ? 'Suggest items with AI' : 'Suggest tasks with AI'}
                >
                  <Ionicons name="sparkles-outline" size={20} color={colors.purple} />
                </TouchableOpacity>
              )}
              <TouchableOpacity hitSlop={12}
                onPress={() => project && setEditingProject(project)}
                accessibilityRole="button"
                accessibilityLabel="Edit project"
              >
                {/* A pencil, not "…": it opens the editor straight away, and
                    three dots promise a menu of choices first. */}
                <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              {!!project && (
                <TouchableOpacity
                  hitSlop={12}
                  onPress={(e) => {
                    setPageMenuAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
                    setPageMenuVisible(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Project options"
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          }
        />

        {allDone && !completeOfferDismissed && (
          <OfferBanner
            lead={isList ? 'Every item on this list' : 'Every task in this project'}
            rest={isList ? 'is checked.' : 'is complete.'}
            actionLabel="Mark complete"
            onAction={handleMarkComplete}
            onDismiss={() => setCompleteOfferDismissed(true)}
            accessibilityLabel={isList ? 'Every item on this list is checked' : 'Every task in this project is complete'}
            actionAccessibilityLabel={`Mark ${project?.title ?? 'this project'} complete`}
            dismissAccessibilityLabel={isList ? 'Dismiss list complete notice' : 'Dismiss project complete notice'}
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
            <LinkedText
              style={styles.notesPreviewText}
              numberOfLines={notesExpanded ? undefined : 1}
              text={project.notes}
            />
          </TouchableOpacity>
        )}

        <View
          style={{ flex: 1 }}
          onTouchStart={expandedTaskId !== null ? handleListTouchStart : undefined}
          onTouchEnd={expandedTaskId !== null ? handleListTouchEnd : undefined}
        >
        <PaintSelectionProvider {...paintProps}>
        <FabDropZoneProvider
          ref={dropZonesRef}
          onIntentChange={fabIntentChannel.publish}
          scroller={scrollControl}
        >
          <ReorderableList
            refreshControl={pullSearch.refreshControl}
            // The user can't scroll during an add-button drag (the button's
            // responder has the touch); the drag scrolls it instead, through
            // scrollControl below.
            scrollEnabled={!painting && !draggingSubtask && !fabDragging && draggingSectionId === null}
            scrollControlRef={scrollControl}
            rowScrollerRef={listScroller}
            scrollToTop={{ bottom: fabBottom }}
            data={shownListItems}
            keyExtractor={projectListItemKey}
            // Two rows need lifting over their neighbours: an expanded row,
            // whose card shadow falls across the row below it, and a task
            // group's tray, for the same reason — see ReorderableList's own
            // note on why this can't live on the card.
            rowElevated={item =>
              (item.type === 'task' && item.task.id === expandedTaskId) ||
              (item.type === 'group' && item.group.id === draggingSectionId)
            }
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
              if (filteringLines) return;
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
              joinTargetChannel.publish(null);
              dropCapture.current?.capture(null);
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
                joinTargetChannel.publish(nextId);
                // Aiming at a group takes the drag over: the list stops
                // opening a reorder gap, so the target stays put under the
                // card instead of sliding away from the finger chasing it,
                // and a drop settles into it.
                dropCapture.current?.capture(nextId === null ? null : overIndex);
                if (nextId) haptics.impactLight();
              }
            }}
            dropCaptureRef={dropCapture}
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
                {showSummary && (
                  <View style={summaryCaptionOnly ? styles.summaryCaptionOnly : styles.summaryCard}>
                    <Text style={summaryCaptionOnly ? styles.summaryCaptionText : styles.summaryText}>
                      {summaryProgress}
                      {summaryProgress && summaryCaption ? ' · ' : ''}
                      {summaryCaption && (
                        <Text
                          style={summaryCaption.overdue && pastWindow
                            ? styles.summaryOverdue
                            : summaryCaption.soon ? styles.summarySoon : undefined}
                        >
                          {summaryCaption.text}
                        </Text>
                      )}
                    </Text>
                    {summaryProgress !== null && !projectProgressNote(project!, progress) && (
                      <ProgressBar progress={progress.done / progress.total} />
                    )}
                    {tripLine && <Text style={styles.summaryText}>{tripLine}</Text>}
                    {/* Each count is a button naming who it counts: "3 Maybe"
                        is a question about which three. Keyed by place, since
                        two sets can read the same ("1 Yes"). */}
                    {answerTallies.map((parts, row) => (
                      <Text key={`tally-${row}`} style={styles.summaryText}>
                        {parts.map((part, i) => (
                          <React.Fragment key={part.label}>
                            {i > 0 && ', '}
                            <Text
                              style={styles.tallyCount}
                              onPress={() => { haptics.tap(); Alert.alert(part.label, part.names.join('\n')); }}
                              accessibilityRole="button"
                              accessibilityHint="Lists who this counts"
                            >
                              {part.label}
                            </Text>
                          </React.Fragment>
                        ))}
                      </Text>
                    ))}
                    {activityLine && (
                      <Text style={styles.summaryText}>{activityLine}</Text>
                    )}
                    {/* A pill on its own row rather than a tertiary-grey
                        suffix on the line above, which read as part of the
                        sentence and gave the tap a thin, wrapping target. */}
                    {activityLine && !selectionMode && (
                      <View style={styles.summaryActions}>
                        <InlineAction
                          icon="time-outline"
                          label="History"
                          variant="neutral"
                          onPress={() => {
                            haptics.tap();
                            navigateToTab('Logbook', { projectId, openProjectHistory: Date.now() });
                          }}
                          accessibilityLabel="Open this project's history"
                        />
                      </View>
                    )}
                    {!selectionMode && routinesToCatchUp.length > 0 && (
                      <>
                        <Text style={styles.summaryText}>
                          {routinesToCatchUp.length === 1
                            ? '1 repeating task came due while paused.'
                            : `${routinesToCatchUp.length} repeating tasks came due while paused.`}
                        </Text>
                        <View style={styles.summaryActions}>
                          <InlineAction
                            icon="arrow-forward-outline"
                            label="Move"
                            variant="neutral"
                            onPress={() => { haptics.tap(); endPause(); }}
                            accessibilityLabel={`${routinesToCatchUp.length} repeating ${routinesToCatchUp.length === 1 ? 'task' : 'tasks'} came due while paused. Choose whether to move them`}
                          />
                        </View>
                      </>
                    )}
                    {!selectionMode && (tripAhead || paused) && (
                      <View style={styles.summaryActions}>
                        {paused && (
                          <InlineAction
                            icon={planning ? 'checkmark-circle-outline' : 'play-outline'}
                            label={planning ? 'Mark ready' : 'Resume now'}
                            variant="neutral"
                            onPress={() => { haptics.tap(); endPause(); }}
                            accessibilityLabel={planning
                              ? 'Mark this project ready, so its tasks show up in your lists'
                              : 'Resume this project now'}
                          />
                        )}
                        {tripAhead && (
                          <InlineAction
                            icon="calendar-outline"
                            label="What's due before you leave"
                            variant="neutral"
                            onPress={() => { haptics.tap(); setLookAheadOpen(true); }}
                          />
                        )}
                      </View>
                    )}
                    {/* Its own row, under the text, so the line above never
                        gives up width to a button. */}
                    {!selectionMode && (project!.archived || project!.completed) && (
                      <View style={styles.summaryActions}>
                        <InlineAction
                          icon={project!.archived ? 'arrow-undo' : 'refresh'}
                          label={project!.archived ? 'Unarchive' : 'Reopen'}
                          variant="neutral"
                          onPress={() => {
                            haptics.tap();
                            if (project!.archived) unarchiveProject(project!.id);
                            else uncompleteProject(project!.id);
                          }}
                          accessibilityLabel={project!.archived ? 'Unarchive this project' : 'Reopen this project'}
                        />
                      </View>
                    )}
                  </View>
                )}
                {(projectPeople.length > 0 || (project?.links.length ?? 0) > 0) && (
                  <View style={styles.infoCard}>
                    {projectPeople.length > 0 && (
                      <View style={styles.peopleRow}>
                        {projectPeople.map(person => (
                          <TouchableOpacity
                            key={person.id}
                            style={styles.personChip}
                            onPress={() => { haptics.tap(); (navigation as any).navigate('PersonDetail', { personId: person.id }); }}
                            disabled={selectionMode}
                            activeOpacity={interaction.activeOpacity}
                            accessibilityRole="button"
                            accessibilityLabel={`${displayNameOf(person)}. Opens their page`}
                          >
                            <Ionicons name="person-circle-outline" size={16} color={colors.textSecondary} />
                            <Text style={styles.personChipText} numberOfLines={1}>{displayNameOf(person)}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {project!.links.map(link => (
                      <TouchableOpacity
                        key={link.id}
                        style={styles.infoLinkRow}
                        onPress={() => { haptics.tap(); Linking.openURL(link.url).catch(() => {}); }}
                        onLongPress={() => { haptics.tap(); Share.share({ url: link.url, message: link.url }); }}
                        disabled={selectionMode}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="link"
                        accessibilityLabel={`${link.label || linkHost(link.url)}. Opens the link`}
                      >
                        <Ionicons name="link-outline" size={16} color={colors.accent} />
                        <Text style={styles.infoLinkText} numberOfLines={1}>{link.label || linkHost(link.url)}</Text>
                        {!!link.label && <Text style={styles.infoLinkHost} numberOfLines={1}>{linkHost(link.url)}</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {forecastLine && (
                  <View style={styles.forecastRow}>
                    <Ionicons name="partly-sunny-outline" size={16} color={colors.textSecondary} />
                    <View style={styles.forecastContent}>
                      <Text style={styles.forecastLine}>{forecastLine}</Text>
                      {forecastGap && <Text style={styles.forecastGap}>{forecastGap}</Text>}
                    </View>
                  </View>
                )}
                {/* Sorting sits at the top rather than under the list, where
                    it used to share a row with the add button. */}
                {isList && !selectionMode && lineCount >= 3 && !filteringLines && (
                  <View style={[styles.sectionAddRow, styles.listSortRow]}>
                    <InlineAction
                      icon="swap-vertical-outline"
                      label="Sort A to Z"
                      variant="neutral"
                      onPress={sortListAToZ}
                      accessibilityLabel="Sort this list's items from A to Z"
                    />
                  </View>
                )}
                {isList && !selectionMode && topLineOpen !== null && (
                  <NewLineField
                    key={`top-line-${topLineOpen}`}
                    onAdd={(text, pending) => addListLines([text], pending)}
                    onAddMany={lines => addListLines(lines)}
                    onDone={() => setTopLineOpen(null)}
                    styles={styles}
                    placeholderColor={colors.textTertiary}
                    placeholder="New item"
                  />
                )}
                {/* Stays while selecting: the selection is taken from what it
                    leaves showing, so it has to be visible that it's on. */}
                {lineFilterShown && (
                  <SearchField
                    style={styles.lineFilter}
                    field={lineFilter}
                    placeholder={isList ? 'Find an item' : 'Find a task or line'}
                    accessibilityLabel={isList ? 'Find an item on this list' : 'Find a task or line in this project'}
                  />
                )}
                <ProjectDecisions
                  label={isList ? 'Answers' : 'Decisions'}
                  decisions={decisions}
                  outcomes={decisionOutcomeMap}
                  onPress={selectionMode ? undefined : task => setAnswerTaskId(task.id)}
                />
              </>
            }
            // Every row doubles as a target for the add button being dragged
            // in. The wrapper only measures — it adds no styling and claims
            // no touches — so a row behaves exactly as it did without one,
            // and the dragged row's floating copy registers nothing (a null
            // zone) rather than claiming the real row's slot under the same
            // key.
            renderItem={({ item, drag: rawDrag, isActive }) => {
              const drag = filteringLines ? undefined : rawDrag;
              const zone = isActive ? null : zoneByKey.get(projectListItemKey(item)) ?? null;
              if (item.type === 'group') {
                const { group, children } = item;
                const allChildren = childrenByGroupId.get(group.id) ?? NO_GROUP_CHILDREN;
                // Only ever a stack homed here with nothing to show (see
                // buildProjectListItems) — the membership walk can't produce a
                // group row without the task that led it there.
                const checkedHere = checkedBySection.get(group.id) ?? NO_GROUP_CHILDREN;
                // A finished member counts as something under the header even
                // while completed rows are hidden: a section holding only done
                // tasks is not empty, and reading as empty would both claim it
                // has no items and lock its chevron.
                const doneHere = allChildren.some(t => t.completed && !t.archived && t.parentId === null && t.projectId === projectId);
                const empty = children.length === 0 && checkedHere.length === 0 && !doneHere;
                // Collapse hides rows, and an empty stack has none to hide —
                // collapsed it would be a bare title with no way to reach the
                // button that fills it in. The header takes the same value so
                // its chevron describes what is actually under it.
                const stackExpanded = empty || !group.collapsed;
                return (
                  <FabDropZone zone={zone}>
                  <GroupDropTargetRow channel={fabIntentChannel} groupId={group.id} dragTarget={joinTargetChannel}>
                  <TaskGroupTray collapsed={!stackExpanded}>
                    <TaskGroupHeader
                      selectionMode={selectionMode}
                      group={group}
                      allChildren={allChildren}
                      // The section's own tasks in this project, done and
                      // not, counted whole: sections here are mostly undated
                      // work, which the Today tally ("done today") never saw.
                      dueTodayOverride={sectionRosterById.get(group.id) ?? NO_GROUP_CHILDREN}
                      tallyScope="all"
                      // No pin, for the reason the task rows here have none
                      // (showPin={false}): pinning is about Today, and this
                      // page is not where a day is arranged.
                      // Not ANDed with the drag fold below: that one is a
                      // transient the floating card owns, and a chevron
                      // flipping under the finger mid-drag is noise.
                      expanded={stackExpanded}
                      onToggleCollapse={handleGroupToggleCollapse}
                      onComplete={handleGroupComplete}
                      onDefer={handleGroupDefer}
                      onSwipeSelect={handleGroupSwipeSelect}
                      onPressEdit={handleGroupPressEdit}
                      onDrag={!selectionMode && drag ? groupDragHandlerFor(group.id, drag) : undefined}
                    />
                    <TaskGroupBody
                      // A drag still folds it, so its floating card is the
                      // header alone like every other stack's.
                      expanded={stackExpanded && draggingGroupId !== group.id}
                      hasChildren
                      // Lets a task dragged out of the section cross the
                      // tray's edge instead of being clipped at it.
                      dragging={draggingSectionId === group.id}
                    >
                      {sectionLine?.groupId === group.id && empty ? (
                        <NewLineField
                          key={`section-${group.id}-${sectionLine.n}`}
                          onAdd={(text, pending) => { addLineToSection(group, text, pending); setSectionLine(v => (v ? { ...v, n: v.n + 1 } : v)); }}
                          onAddMany={lines => {
                            for (const line of cleanPastedLines(lines)) addLineToSection(group, line);
                            setSectionLine(v => (v ? { ...v, n: v.n + 1 } : v));
                          }}
                          onDone={() => setSectionLine(null)}
                          styles={styles}
                          placeholderColor={colors.textTertiary}
                          placeholder={isList ? 'New item' : group.checklist ? 'New line' : 'New task'}
                          inTray
                        />
                      ) : empty ? (
                        <View style={styles.emptyStackRow}>
                          <Text style={styles.emptyStackText}>{isList ? 'No items in this section yet' : group.checklist ? 'No lines in this section yet' : 'No tasks in this section yet'}</Text>
                          <InlineAction
                            label={isList ? 'Add an item' : group.checklist ? 'Add a line' : 'Add task'}
                            icon="add"
                            onPress={() => openAddToSection(group)}
                            accessibilityLabel={group.title.trim() ? `Add ${isList ? 'an item' : group.checklist ? 'a line' : 'a task'} to the ${group.title.trim()} section` : `Add ${isList ? 'an item' : group.checklist ? 'a line' : 'a task'} to this section`}
                          />
                        </View>
                      ) : (
                        <>
                        {/* The same nested list Today gives a stack's rows:
                            drag to reorder within the section, or past its
                            edge to take a task out of it. These were drawn
                            static, so a section's order could only be changed
                            from Today, and a task could only leave one
                            through its editor. */}
                        {children.length > 0 && (
                        <SortableList
                          data={children}
                          onReorder={reordered => reorderGroupChildren(group.id, reordered.map(t => t.id))}
                          onDragOut={task => handleDragOutOfSection(group.id, task)}
                          onDragStateChange={dragging => setDraggingSectionId(dragging ? group.id : null)}
                          placeholderStyle={styles.sectionDropSlot}
                          renderItem={(child, _displayIndex, childDrag, childIsActive) => (
                            <React.Fragment key={child.id}>
                              {renderProjectTaskItem(child, {
                                indented: true,
                                isActive: childIsActive,
                                drag: childDrag,
                              })}
                            </React.Fragment>
                          )}
                        />
                        )}
                        {checkedHere.map(task => renderCheckedRow(task, true))}
                        {/* Every open section can take another task from
                            here, not only an empty one. Return adds what's
                            typed and opens the next field, and each task
                            joins this section. */}
                        {!selectionMode && sectionLine?.groupId === group.id && (
                          <NewLineField
                            key={`section-${group.id}-${sectionLine.n}`}
                            onAdd={(text, pending) => { addLineToSection(group, text, pending); setSectionLine(v => (v ? { ...v, n: v.n + 1 } : v)); }}
                            onAddMany={lines => {
                              for (const line of cleanPastedLines(lines)) addLineToSection(group, line);
                              setSectionLine(v => (v ? { ...v, n: v.n + 1 } : v));
                            }}
                            onDone={() => setSectionLine(null)}
                            styles={styles}
                            placeholderColor={colors.textTertiary}
                            placeholder={isList ? 'New item' : group.checklist ? 'New line' : 'New task'}
                            inTray
                          />
                        )}
                        {!selectionMode && sectionLine?.groupId !== group.id && (
                          <View style={styles.sectionAddRow}>
                            <InlineAction
                              label={isList ? 'Add an item' : group.checklist ? 'Add a line' : 'Add task'}
                              icon="add"
                              variant="neutral"
                              surface="tray"
                              onPress={() => openAddToSection(group)}
                              accessibilityLabel={group.title.trim() ? `Add ${isList ? 'an item' : group.checklist ? 'a line' : 'a task'} to the ${group.title.trim()} section` : `Add ${isList ? 'an item' : group.checklist ? 'a line' : 'a task'} to this section`}
                            />
                            {/* A list sorts from the top of the screen; a
                                checklist section on a project sorts here.
                                Hidden while narrowed, since only some lines
                                are showing. */}
                            {!isList && group.checklist && children.length >= 3 && !filteringLines && (
                              <InlineAction
                                label="Sort A to Z"
                                icon="swap-vertical-outline"
                                variant="neutral"
                                surface="tray"
                                onPress={() => sortSectionAToZ(group, children)}
                                accessibilityLabel={`Sort ${group.title.trim() || 'this section'} A to Z`}
                              />
                            )}
                          </View>
                        )}
                        </>
                      )}
                    </TaskGroupBody>
                  </TaskGroupTray>
                  </GroupDropTargetRow>
                  </FabDropZone>
                );
              }
              return (
                <FabDropZone zone={zone}>
                  {renderProjectTaskItem(item.task, { drag, isActive })}
                </FabDropZone>
              );
            }}
            ListEmptyComponent={
              filteringLines ? (
                // Checked items it found are drawn in the footer below.
                completedShown && shownCheckedTasks.length > 0 ? null :
                <Text style={styles.noLinesMatch}>{isList ? 'No items match.' : 'No lines match.'}</Text>
              ) : completedProjectTasks.length === 0 ? (
                <EmptyState
                  icon={isList ? 'list-outline' : 'briefcase-outline'}
                  title={isList ? 'Nothing on this list yet' : 'No tasks yet'}
                  subtitle={isList ? 'Add an item above. Paste several at once to add them all' : "Add a new task, or pull in one you've already written down"}
                  actionLabel={isList ? 'Add an item' : 'New task'}
                  onAction={() => isList ? setTopLineOpen(v => v ?? 0) : openTaskLine()}
                />
              ) : null
            }
            // Only the completed section lives down here, so with nothing
            // completed the footer is bare padding — and that padding comes off
            // the box the empty state centres in.
            ListFooterComponent={
              completedProjectTasks.length === 0 && (!showInlineNewTask || isList) && !namingSection && taskLineOpen === null ? null : (
              <View style={[styles.detailFooter, { paddingBottom: fabBottom + FAB_SIZE + spacing.lg }]}>
                {/* Where the new section will land: after everything else. */}
                {namingSection && (
                  <InlineNameField
                    placeholder="Section name"
                    onSubmit={createNamedSection}
                    onCancel={() => setNamingSection(false)}
                    accessibilityLabel="New section name"
                    style={styles.newSectionField}
                  />
                )}
                {/* One tap to a new task from wherever the list ends. A
                    list's own add field is reached from the FAB instead —
                    see the top of the screen. */}
                {!isList && !selectionMode && taskLineOpen !== null ? (
                  <NewLineField
                    key={`task-line-${taskLineOpen}`}
                    onAdd={(text, pending) => addTaskLines([text], pending)}
                    onAddMany={addTaskLines}
                    onDone={() => setTaskLineOpen(null)}
                    styles={styles}
                    placeholderColor={colors.textTertiary}
                    placeholder="New task"
                  />
                ) : showInlineNewTask && !isList && (
                  <View style={styles.inlineNewTask}>
                    <InlineAction
                      icon="add"
                      label="New task"
                      onPress={openTaskLine}
                    />
                  </View>
                )}
                {completedProjectTasks.length > 0 && (
                  <View style={styles.completedSection}>
                    {keepChecked ? (
                      <Text style={styles.completedToggleText}>{`${completedProjectTasks.length} checked`}</Text>
                    ) : (
                    <TouchableOpacity
                      style={styles.completedToggle}
                      onPress={() => { animateLayout(); setShowCompleted(v => !v); }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`${showCompleted ? 'Hide' : 'Show'} ${completedProjectTasks.length} ${isList ? 'checked items' : 'completed tasks'}`}
                    >
                      <Ionicons name="checkmark-circle-outline" size={13} color={colors.textTertiary} />
                      <Text style={styles.completedToggleText}>
                        {showCompleted ? 'Hide' : 'Show'} {completedProjectTasks.length} {isList ? 'checked' : 'completed'}
                      </Text>
                      <Ionicons name={showCompleted ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
                    </TouchableOpacity>
                    )}
                    {/* A packing list is checked off and then used again, so a
                        list can put every line back in one go, without opening
                        the checked lines first. Several at once raises the
                        Undo bar (bulkUncompleteTasks). Both act on the checked
                        lines, so they appear only while those lines are shown:
                        collapsed, the buttons would act on rows the person
                        can't see. */}
                    {isList && !selectionMode && completedShown && (
                      <View style={styles.uncheckAllRow}>
                        <InlineAction
                          icon="refresh"
                          label="Uncheck all"
                          variant="neutral"
                          onPress={() => {
                            animateLayout();
                            haptics.tap();
                            bulkUncompleteTasks(completedProjectTasks.map(t => t.id));
                          }}
                          accessibilityLabel={`Uncheck all ${completedProjectTasks.length} items`}
                        />
                        {/* Checked items on a list are never purged on their
                            own (see retention.ts), so this is how they go. */}
                        <InlineAction
                          icon="trash-outline"
                          label="Delete checked"
                          variant="neutral"
                          onPress={() => {
                            haptics.tap();
                            const n = completedProjectTasks.length;
                            Alert.alert(
                              `Delete ${n} checked item${n === 1 ? '' : 's'}?`,
                              'They are removed from this list and from the Logbook.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: () => {
                                    if (!project) return;
                                    animateLayout();
                                    deleteCheckedListItems(project.id);
                                  },
                                },
                              ],
                            );
                          }}
                          accessibilityLabel={`Delete all ${completedProjectTasks.length} checked items`}
                        />
                      </View>
                    )}
                    {completedShown && checkedAtFoot.map(task => renderCheckedRow(task))}
                  </View>
                )}
              </View>
              )
            }
          />
        </FabDropZoneProvider>
        </PaintSelectionProvider>
        </View>

        {selectionMode && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            totalCount={selectableTasks.length}
            // Read here rather than subscribed: the selector walks every
            // task's tags on every store write, for a bar that's only up
            // while selecting (and re-renders with the page anyway).
            existingTags={useTaskStore.getState().allTags()}
            onComplete={handleBulkComplete}
            completableCount={completableCount}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => confirmBulkSetWhen(Array.from(selectedIds), date, segs, exitSelection)}
            onSetCategory={cat => { bulkSetCategory(Array.from(selectedIds), cat); exitSelection(); }}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            onSetDifficulty={rewardsEnabled ? d => { bulkSetDifficulty(Array.from(selectedIds), d); exitSelection(); } : undefined}
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
            moveToProject={{
              projects: moveTargets,
              onMove: targetId => {
                animateLayout();
                bulkMoveToProject(Array.from(selectedIds), targetId);
                exitSelection();
              },
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
        <SheetModal
          visible={showExistingPicker}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => { Keyboard.dismiss(); setShowExistingPicker(false); }}
        >
          <View style={[styles.pickerRoot, { paddingTop: insets.top + spacing.md }]}>
            {/* Deliberately not `DetailHeader`: that's the back-chevron bar a
                pushed screen gets, and this is the Cancel/title/confirm bar
                every sheet in the app gets (fourteen of them, all built the
                same way out of `SheetHeaderButton`). Two idioms, already
                decomposed — the button is the shared part, the row isn't. */}
            <SheetHeader
              title="Add existing task"
              size="lg"
              // Done, not Cancel: every tap below adds its task straight away,
              // so there is nothing for Cancel to take back.
              left={
                <SheetHeaderButton
                  label="Done"
                  onPress={() => { Keyboard.dismiss(); setShowExistingPicker(false); }}
                  accessibilityLabel="Done adding tasks"
                />
              }
              // Balances Done so the title stays optically centered.
              right={<View style={styles.headerSpacer} />}
            />
            <SearchField
              style={styles.searchBar}
              field={searchFilter}
              placeholder="Search tasks"
              accessibilityLabel="Search tasks to add"
            />
            <FlatList
              data={shownForAdd}
              keyExtractor={t => t.id}
              contentContainerStyle={shownForAdd.length === 0 ? styles.emptyContainer : undefined}
              ListFooterComponent={
                eligibleForAdd.length > shownForAdd.length ? (
                  <Text style={styles.pickerMore}>
                    Showing the newest {shownForAdd.length} of {eligibleForAdd.length}. Search to find the rest.
                  </Text>
                ) : null
              }
              renderItem={({ item }) => {
                // Its date and category under the title, so two tasks with the
                // same name can be told apart before one is picked.
                const detail = [
                  item.dueDate ? formatScheduledDate(item.dueDate, dayResetTime) : null,
                  item.category ? categoryLabel(item.category, taskCategories) : null,
                ].filter(Boolean).join(' · ');
                return (
                  <TouchableOpacity
                    style={styles.pickerRow}
                    onPress={() => {
                      if (project) addExistingToProject(item.id, project.id);
                      haptics.tap();
                    }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${item.title}${detail ? `, ${detail}` : ''} to this project`}
                  >
                    <View style={styles.pickerRowInfo}>
                      <Text style={styles.pickerRowText} numberOfLines={1}>{item.title}</Text>
                      {!!detail && <Text style={styles.pickerRowDetail} numberOfLines={1}>{detail}</Text>}
                    </View>
                    <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <EmptyState icon="search" title="No matching tasks" subtitle="Tasks already in a project, or completed, won't show here" />
              }
            />
          </View>
        </SheetModal>

        {!selectionMode && (
          <AddProjectTaskFabWithDropLabel
            isList={isList}
            channel={fabIntentChannel}
            items={addMenuItems}
            onSelect={handleAddMenuSelect}
            accessibilityLabel={isList ? 'Add to this list' : 'Add task to project'}
            drag={fabDrag}
            dragHint={isList
              ? 'Drag onto the list to add an item at that spot. Drop it on a section to add it there, or back on the button to cancel.'
              : 'Drag onto the list to add a task at that spot. Drop it on a section to add it there, or back on the button to cancel.'}
          />
        )}

        <TaskGroupEditor
          visible={groupEditorVisible}
          group={editingGroup}
          projectId={project?.id}
          onClose={() => {
            setGroupEditorVisible(false);
            setEditingGroup(null);
          }}
        />

        <QuickAddModal
          visible={quickAddVisible}
          onClose={onQuickAddClose}
          onOpenFull={onQuickAddOpenFull}
          // Project tasks are picked off over time rather than scheduled for
          // today, so the quick add opens with no due date.
          context="unscheduled"
          intoProjectId={project?.id ?? null}
          onCreated={onQuickAddCreated}
          onResumed={onQuickAddResumed}
          seed={quickAddSeed}
          seedLabel={quickAddSeedLabel}
        />

        {/* Add from a template: pick one here, then the apply sheet below —
            same two-step flow as Today, but the applied tasks land directly
            in this project instead of the template's own container. */}
        <AddGuestsSheet
          visible={guestsOpen}
          onClose={() => setGuestsOpen(false)}
          onAdd={addGuests}
        />

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
          onApplied={tasks => { if (tasks.length > 0) setTemplateAppliedCount(tasks.length); }}
        />

        {templateAppliedCount !== null && (
          <TemplateAppliedToast
            count={templateAppliedCount}
            noun={isList ? 'item' : 'task'}
            bottom={fabBottom + FAB_SIZE + spacing.md}
            onDismiss={() => setTemplateAppliedCount(null)}
          />
        )}

        {/* Correcting a decision from where it's read — the same sheet in the
            same mode the Logbook's ⋯ menu opens, so there's one place an
            answer is written and one way it's written. */}
        {shownAnswerTask && (
          <DeliverablePromptSheet
            visible={answerTask !== null}
            task={shownAnswerTask}
            mode="edit"
            onConfirm={(value, reasoning) => {
              setDeliverableValue(shownAnswerTask.id, value, reasoning);
              setAnswerTaskId(null);
            }}
            onCancel={() => setAnswerTaskId(null)}
          />
        )}

        <LookAheadSheet
          visible={lookAheadOpen}
          tripProjectId={project?.id ?? null}
          onClose={() => setLookAheadOpen(false)}
        />

        <LazySheet open={pageMenuVisible}>
          <ProjectPageMenu
            visible={pageMenuVisible}
            onClose={() => setPageMenuVisible(false)}
            anchor={pageMenuAnchor}
            isList={isList}
            // The store brings the kind's own defaults along (a list never
            // finishes and is never pulled; a project gets both back). See
            // kindSwitchFields.
            onConvert={() => project && updateProject(project.id, { kind: isList ? 'project' : 'list' })}
          />
        </LazySheet>
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
          isList={isList}
          // Same toast a template apply gets: the new rows land at the end of
          // the list, often out of sight, and nothing else said they arrived.
          onAdded={count => setTemplateAppliedCount(count)}
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
        {pullSearch.sheet}
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
  // Same card and gutters as the forecast row under it.
  summaryCard: {
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    gap: spacing.sm,
  },
  summaryText: { color: colors.textSecondary, fontSize: font.sm },
  // A list's count with no card behind it; the section-label treatment every
  // other caption in the app uses.
  summaryCaptionOnly: { marginHorizontal: spacing.md + spacing.xs, marginTop: spacing.md, marginBottom: spacing.sm },
  summaryCaptionText: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  // A count that opens who it counts. Underlined rather than accent-tinted:
  // it's a word in a sentence, and accent text there reads as a link out.
  tallyCount: { textDecorationLine: 'underline', textDecorationColor: colors.textTertiary },
  // Sits where the next line will, so it reads as that line being typed.
  lineFilter: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  noLinesMatch: {
    color: colors.textSecondary,
    fontSize: font.sm,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  newLineRow: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    paddingLeft: spacing.md + 22 + spacing.sm,
    paddingRight: spacing.md,
  },
  // Height rather than lineHeight, per the TextInput note in CLAUDE.md.
  // In a stack's tray the tray's own padding is the gutter, same as its task rows.
  newLineInTray: { marginHorizontal: 0 },
  newLineInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  newLineInput: { flex: 1, color: colors.text, fontSize: font.md, minHeight: 44 },
  newLineConfirm: { justifyContent: 'center', alignItems: 'center' },
  // What Confirm set on the line being typed, under it until the line is added.
  newLinePending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  newLinePendingText: { flexShrink: 1, color: colors.accentText, fontSize: font.sm },
  infoCard: {
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    gap: spacing.sm,
  },
  peopleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    maxWidth: '100%',
  },
  personChipText: { color: colors.text, fontSize: font.sm, flexShrink: 1 },
  infoLinkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  infoLinkText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium, flexShrink: 1 },
  infoLinkHost: { color: colors.textTertiary, fontSize: font.xs, flexShrink: 1 },
  summaryOverdue: { color: colors.orangeText },
  summarySoon: { color: colors.text, fontWeight: fontWeight.medium },
  summaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // The same drop slot Today leaves in a stack.
  sectionDropSlot: {
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
  sectionAddRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
  },
  // The list-level sort sits directly on the screen rather than inside a
  // section tray, so it needs the same side gutter as the cards around it.
  listSortRow: { marginHorizontal: spacing.md },
  newSectionField: { marginTop: spacing.sm },
  inlineNewTask: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  uncheckAllRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  pickerMore: {
    color: colors.textSecondary,
    fontSize: font.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  forecastLine: { color: colors.text, fontSize: font.sm },
  forecastGap: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  detailRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pickerRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  headerSpacer: { width: 48 },
  detailHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
    marginTop: spacing.xxs,
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
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    gap: spacing.sm,
  },
  pickerRowInfo: { flex: 1, gap: spacing.xxs },
  pickerRowText: {
    color: colors.text,
    fontSize: font.md,
  },
  pickerRowDetail: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
});
