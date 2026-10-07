import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Project, ProjectLink, TaskFieldDefaults } from '../types';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { parseLabelledLink, linkHost } from '../utils/textLinks';
import { generateId } from '../utils/id';
import { TITLE_MAX_LENGTH } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore, redoRestoringRows } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { templateFromProject } from '../utils/projectTemplate';
import { useNavigation } from '@react-navigation/native';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { WhenPicker } from './WhenPicker';
import { CollapsibleField } from './CollapsibleField';
import { TaskFieldDefaultsFields } from './TaskFieldDefaultsFields';
import { InlineAction } from './InlineAction';
import {
  describeTaskFieldDefaults, existingTaskPatch, hasTaskFieldDefaults, tasksNeedingDefaults,
} from '../utils/taskFieldDefaults';
import { CategoryPickerList } from './CategoryPicker';
import { PillGroup, type PillGroupOption } from './PillGroup';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useGroceryStore } from '../store/useGroceryStore';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';
import { EditorRow } from './EditorRow';
import { awayNoonIso } from '../utils/awayDates';
import { useSettingsStore } from '../store/useSettingsStore';
import { featureShown } from '../utils/simpleMode';
import { AwayShiftSheet } from './AwayShiftSheet';
import { EditorSheet } from './EditorSheet';
import { CountStepper } from './CountStepper';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { dayKeyOf, dayKeyToDate, formatDeadlineDate } from '../utils/dateUtils';
import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { buildAwayShiftPlan } from '../utils/awayShift';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  CADENCE_UNITS,
  CADENCE_UNIT_MAX,
  FALLBACK_CADENCE_DAYS,
  NUDGE_MODES,
  NUDGE_MODE_LABEL,
  cadenceUnitLabel,
  describeCadence,
  describeNudge,
  fromCadenceParts,
  nudgeFieldsFor,
  nudgeModeOf,
  toCadenceParts,
  withCadenceUnit,
  type NudgeMode,
} from '../utils/nudgeCadence';
import { TextField } from './TextField';
import { usePlaceSuggestions } from '../hooks/usePlaceSuggestions';
import { placeSubtitle, type PlaceResult } from '../utils/places';
import { useSheetSubject } from '../hooks/useSheetSubject';

const NUDGE_MODE_OPTIONS: SegmentOption<NudgeMode>[] = NUDGE_MODES.map(mode => ({
  value: mode,
  label: NUDGE_MODE_LABEL[mode],
}));

/**
 * One line per answer, under the track. These say what the app will *do*,
 * because the labels can't: "When I ask" and "Every…" are the difference
 * between a project that waits to be looked for and one that comes to you, and
 * neither three-word label carries that on its own.
 */
const NUDGE_MODE_HINT: Record<NudgeMode, string> = {
  never: 'Stays out of "Pull from projects" and never writes a review task. For a list you keep rather than work through, like gift ideas.',
  'on-ask': 'Shows up in "Pull from projects" when you open it, and never brings itself up.',
  scheduled: "Adds a review task once nothing in it is scheduled and nothing's been finished in it for this long.",
};

interface Props {
  visible: boolean;
  project: Project | null;
  /** Titles the sheet "New project" — set when arriving from quick add's "More details". */
  isNew?: boolean;
  /**
   * `discarded` is passed when the person backed out of a project created for
   * this sheet (isNew). The row already exists, so the host deletes it; a
   * plain close keeps whatever was saved.
   */
  onClose: (outcome?: 'discarded') => void;
}

export function ProjectEditor({ visible, project: liveProject, isNew, onClose }: Props) {
  // Held past the host clearing it, so the `return null` below can't tear the
  // presented sheet out of the tree while it is still closing: every host
  // clears the project in the same commit that lowers `visible`, and that
  // unmount is the freeze CLAUDE.md's SheetModal notes describe.
  const project = useSheetSubject(liveProject);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const updateProject = useProjectStore(s => s.updateProject);
  const archiveProject = useTaskStore(s => s.archiveProject);
  const unarchiveProject = useTaskStore(s => s.unarchiveProject);
  const completeProject = useTaskStore(s => s.completeProject);
  const uncompleteProject = useTaskStore(s => s.uncompleteProject);
  const deleteProject = useTaskStore(s => s.deleteProject);
  const startFreshFromProject = useTaskStore(s => s.startFreshFromProject);
  const addTemplateFromProject = useTemplateStore(s => s.addTemplateFromProject);
  const navigation = useNavigation();
  // `project` is a snapshot handed down when the sheet was opened, so it never
  // sees its own archived flag flip back — read that one field live instead,
  // or unarchiving here leaves the toggle showing "archived" until the sheet
  // is reopened even though the store already changed.
  const liveArchived = useProjectStore(s => project ? s.projects.find(p => p.id === project.id)?.archived : undefined);
  const liveCompleted = useProjectStore(s => project ? s.projects.find(p => p.id === project.id)?.completed : undefined);
  const categories = useProjectCategoryStore(useShallow(s => s.categories));
  const addCategory = useProjectCategoryStore(s => s.addCategory);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  // The notes field's measured content height, same fix as PersonEditor: the
  // native multiline field clipped long notes to a few lines.
  const [notesHeight, setNotesHeight] = useState(0);
  const [category, setCategory] = useState<string | null>(null);
  // The task category, deliberately a separate pool from the project category
  // just above — see Project.defaultTaskCategory.
  const [defaultTaskCategory, setDefaultTaskCategory] = useState<string | null>(null);
  const [defaultTaskCategoryOpen, setDefaultTaskCategoryOpen] = useState(false);
  const [taskDefaults, setTaskDefaults] = useState<TaskFieldDefaults | null>(null);
  const [taskDefaultsOpen, setTaskDefaultsOpen] = useState(false);
  const rewardsEnabled = useSettingsStore(s => s.rewardsEnabled);
  const setLastAction = useTaskStore(s => s.setLastAction);
  const updateTask = useTaskStore(s => s.updateTask);
  const taskCategories = useCategoryStore(useShallow(s => s.categories));
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  // Project.eventDate: the day it's all for. Its own row, beside the deadline.
  const [eventDate, setEventDate] = useState<Date | null>(null);
  const [showEventPicker, setShowEventPicker] = useState(false);
  // The away span (see Project.awayStart). Held as two dates rather than one
  // range because that is what the columns are, and because the end is
  // optional in a way the start is not.
  const [awayStart, setAwayStart] = useState<Date | null>(null);
  const [awayEnd, setAwayEnd] = useState<Date | null>(null);
  const [pickingAway, setPickingAway] = useState<'start' | 'end' | null>(null);
  const [awayPauses, setAwayPauses] = useState(false);
  const [awayListId, setAwayListId] = useState<string | null>(null);
  const [awayListOpen, setAwayListOpen] = useState(false);
  const [destination, setDestination] = useState('');
  // What a tapped suggestion wrote, so the list stays closed until the field
  // is edited again.
  const [pickedDestination, setPickedDestination] = useState<string | null>(null);
  const setPlaceSuggestionsEnabled = useSettingsStore(s => s.setPlaceSuggestionsEnabled);
  const placeSuggestions = usePlaceSuggestions(destination, visible && awayStart !== null && destination !== pickedDestination);
  // The lists to nominate from, and whether there is a Groceries tab at all to
  // nominate one for. With the kitchen switched off this row would name a
  // screen the user cannot reach.
  const groceryLists = useGroceryStore(useShallow(s => s.lists));
  const addGroceryList = useGroceryStore(s => s.addList);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const weekendNudgeOn = useSettingsStore(s => s.weekendNudgeTasks && !!s.weekendNudgeTaskCategory);
  const forecastOn = useSettingsStore(s => s.destinationForecastEnabled);
  const setForecastOn = useSettingsStore(s => s.setDestinationForecastEnabled);
  // What "Pause tasks while away" would actually hide: only what's already
  // marked to pause on vacation. Counted so the hint can say when that's
  // nothing, which turned vacation mode on to hide nothing at all.
  const pausedTaskCount = useTaskStore(s => s.tasks.filter(t => t.vacationPause && !t.completed && !t.archived && t.parentId === null).length);
  const pausedCategoryCount = useCategoryStore(s => s.categories.filter(c => c.hideOnVacation).length);
  // Rule 2 of simplified mode: a project that already has a trip keeps its
  // rows, whatever the switch says.
  // A list is lines to tick off, so the fields about dates and being chased
  // step aside for it. Only while unused: a list that was given a deadline or
  // a nudge before it became one keeps the row that can take it off again.
  const isList = project?.kind === 'list';
  const awayFieldShown = featureShown('awayDates', simpleMode, awayStart !== null) && (!isList || awayStart !== null);
  // Collapsed to the chosen category until tapped, like every other editor.
  const [categoryOpen, setCategoryOpen] = useState(false);
  // The merged nudge control: one chosen answer, plus the cadence the third of
  // them counts in. The cadence is held positive whatever the project stored,
  // so switching to "Every…" always lands on a real interval rather than on a
  // schedule that can never fire (see nudgeFieldsFor).
  const [nudgeMode, setNudgeMode] = useState<NudgeMode>('never');
  const [nudgeCadenceDays, setNudgeCadenceDays] = useState(FALLBACK_CADENCE_DAYS);
  const [autoSchedule, setAutoSchedule] = useState(false);
  const [ongoing, setOngoing] = useState(false);
  const [weekendSource, setWeekendSource] = useState(false);
  // Project.pausedUntil, held as the day it comes back.
  const [pausedUntil, setPausedUntil] = useState<Date | null>(null);
  const [pickingPause, setPickingPause] = useState(false);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [links, setLinks] = useState<ProjectLink[]>([]);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [inOrder, setInOrder] = useState(false);
  const [showChecked, setShowChecked] = useState(false);
  const people = usePersonStore(useShallow(s => s.people.filter(p => !p.archived)));

  // Returns the typed link to the list, or says why it can't.
  const addLinkDraft = () => {
    if (!linkDraft.trim()) return;
    const parsed = parseLabelledLink(linkDraft);
    if (!parsed) { setLinkError("That doesn't look like a link. Paste one that starts with https://."); return; }
    haptics.tap();
    setLinks(ls => [...ls, { id: generateId(), ...parsed }]);
    setLinkDraft('');
    setLinkError(null);
  };
  const [cadenceOpen, setCadenceOpen] = useState(false);

  const awayListName = awayListId
    ? groceryLists.find(l => l.id === awayListId)?.name ?? 'No list'
    : 'No list';

  const awayListOptions: PillGroupOption[] = [
    {
      key: '__none__',
      label: 'No list',
      pinned: true,
      selected: awayListId === null,
      onPress: () => { haptics.tap(); setAwayListId(null); setAwayListOpen(false); },
    },
    ...groceryLists.map(list => ({
      key: list.id,
      label: list.name,
      selected: list.id === awayListId,
      onPress: () => { haptics.tap(); setAwayListId(list.id); setAwayListOpen(false); },
    })),
  ];

  // Rejected by name rather than silently, the way PillGroup's contract asks:
  // addList refuses a blank or a name already taken, home's included.
  const handleCreateAwayList = (name: string) => {
    const created = addGroceryList(name);
    if (!created) return 'That name is already taken.';
    setAwayListId(created.id);
    setAwayListOpen(false);
  };

  // Keyed on `visible` too, now that the held project survives a close: a
  // reopen on the same row has to reseed from it rather than show the last
  // opening's state.
  useEffect(() => {
    if (!visible || !project) return;
    setTitle(project.title);
    setNotes(project.notes);
    setCategory(project.category);
    setDefaultTaskCategory(project.defaultTaskCategory);
    setDefaultTaskCategoryOpen(false);
    setTaskDefaults(project.taskDefaults ?? null);
    setTaskDefaultsOpen(false);
    setDeadline(project.deadline ? new Date(project.deadline) : null);
    setEventDate(project.eventDate ? new Date(project.eventDate) : null);
    setAwayStart(project.awayStart ? new Date(project.awayStart) : null);
    setAwayEnd(project.awayEnd ? new Date(project.awayEnd) : null);
    setPickingAway(null);
    setAwayPauses(project.awayPauses);
    setAwayListId(project.awayListId);
    setAwayListOpen(false);
    setDestination(project.destination ?? '');
    setPickedDestination(project.destination ?? null);
    setNudgeMode(nudgeModeOf(project));
    setNudgeCadenceDays(project.nudgeCadenceDays > 0 ? project.nudgeCadenceDays : FALLBACK_CADENCE_DAYS);
    setAutoSchedule(project.autoSchedule);
    setOngoing(project.ongoing);
    setWeekendSource(project.weekendSource);
    setPausedUntil(project.pausedUntil ? dayKeyToDate(project.pausedUntil) : null);
    setPickingPause(false);
    setPersonIds(project.personIds ?? []);
    setPeopleOpen(false);
    setLinks(project.links ?? []);
    setLinkDraft('');
    setLinkError(null);
    setInOrder(project.inOrder ?? false);
    setShowChecked(project.showChecked ?? false);
    setCategoryOpen(false);
    setCadenceOpen(false);
  }, [visible, project]);

  const closeCategory = () => { animateLayout(); setCategoryOpen(false); };

  // The cadence is stored in days; the picker shows it as a count and a unit.
  const cadence = toCadenceParts(nudgeCadenceDays);

  // A new category is created and picked as soon as it's submitted in the
  // pill grid, so there's no half-typed name to resolve at save time.
  const resolveCategory = () => category;

  /**
   * The departure this sheet opened on, and where it has just been moved to.
   *
   * Held rather than closed over, because the offer outlives the save: the
   * sheet writes the project and then hands the reader a plan built against
   * the dates it changed *from*.
   */
  const projectTasks = useTaskStore(
    useShallow(s => (project ? s.tasks.filter(t => t.projectId === project.id) : [])),
  );
  // The tasks the staged defaults would still change: only a field still unset
  // is filled, so what someone already answered is never touched.
  const applyableTasks = useMemo(
    () => (project ? tasksNeedingDefaults(projectTasks, taskDefaults) : []),
    [project, projectTasks, taskDefaults],
  );
  const applyableCount = applyableTasks.length;
  const confirmApplyToExisting = () => {
    const targets = applyableTasks;
    if (targets.length === 0) return;
    Alert.alert(
      `Apply to ${targets.length} ${targets.length === 1 ? 'task' : 'tasks'}?`,
      'Fills in only what is still unset on each task. Anything already answered stays as it is. A shake undoes it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: () => {
            const snapshots = targets.map(t => ({ ...t }));
            for (const t of targets) {
              const patch = existingTaskPatch(t, taskDefaults);
              if (patch) updateTask(t.id, patch);
            }
            haptics.success();
            setLastAction({
              label: `Defaults applied to ${targets.length} ${targets.length === 1 ? 'task' : 'tasks'}`,
              undo: () => { for (const snap of snapshots) updateTask(snap.id, snap); },
              redo: redoRestoringRows(snapshots.map(t => t.id)),
            });
          },
        },
      ],
    );
  };
  const [shiftFrom, setShiftFrom] = useState<Date | null>(null);
  const [shiftTo, setShiftTo] = useState<Date | null>(null);

  /**
   * Writes everything on the sheet. Split from the close because Mark complete
   * and Archive also end the session, and they used to close without it: every
   * edit made alongside was dropped, and a project fresh from quick add's "More
   * details" still had its blank stored title, so ProjectsScreen's
   * handleEditorClose read it as never named and deleted the row outright.
   *
   * Answers whether the trip's departure moved, which only the Done path acts
   * on (a trip being completed or filed away has nothing left to prepare).
   */
  const commitEdits = (): { from: Date; to: Date } | null => {
    if (!project) return null;
    const trimmed = title.trim();
    // Did the departure move? Only the start is compared: a trip that got
    // longer at the far end has not moved anything scheduled against its
    // start, which is the same reason buildAwayShiftPlan takes no return date.
    const priorStart = project.awayStart ? new Date(project.awayStart) : null;
    const nextStart = awayStart;
    const departureMoved =
      priorStart !== null && nextStart !== null &&
      awayNoonIso(priorStart) !== awayNoonIso(nextStart);
    updateProject(project.id, {
      // A blank name is refused, but it must not take the rest of the sheet
      // with it. The whole `updateProject` used to sit behind `if (trimmed)`,
      // so clearing the title on an existing project — a stray select-all, a
      // fumbled backspace — silently dropped the dates, category, notes and
      // every toggle changed in the same session, with no alert and nothing on
      // screen to say so (the stored title comes back on reopen, so the sheet
      // looked untouched). Falling back to the stored title keeps the refusal
      // and commits everything else.
      //
      // A project created from quick add's "More details" is stored with a
      // blank title until it's named, so this writes '' back for that one —
      // which is exactly what ProjectsScreen's handleEditorClose still reads to
      // discard a row that never got a name.
      title: trimmed || project.title,
      notes,
      category: resolveCategory(),
      defaultTaskCategory,
      taskDefaults: hasTaskFieldDefaults(taskDefaults) ? taskDefaults : null,
      deadline: deadline ? deadline.toISOString() : null,
      // Midday, like the away span, so a time zone can't move it a day.
      eventDate: eventDate ? awayNoonIso(eventDate) : null,
      // Stored at midday so a flight cannot move either boundary by a calendar
      // day, and the end is dropped without a start because on its own it is
      // indistinguishable from the deadline above. See utils/awayDates.
      awayStart: awayStart ? awayNoonIso(awayStart) : null,
      awayEnd: awayStart && awayEnd ? awayNoonIso(awayEnd) : null,
      awayPauses: awayStart !== null && awayPauses,
      destination: awayStart !== null && destination.trim() ? destination.trim() : null,
      // Switching the nomination back on is a fresh statement, so it clears a
      // refusal made during an earlier run of the same trip (see
      // Project.awayPauseDeclinedFor). Moving the dates clears it on its own,
      // since the stamp holds the departure it was made for.
      awayPauseDeclinedFor: awayPauses && !project.awayPauses ? null : project.awayPauseDeclinedFor,
      awayListId: awayStart !== null ? awayListId : null,
      // Same rule as the line above, one nomination over: naming a list is a
      // fresh statement and clears a refusal from an earlier run of this trip.
      awayListDeclinedFor: awayListId && awayListId !== project.awayListId
        ? null
        : project.awayListDeclinedFor,
      ...nudgeFieldsFor(nudgeMode, nudgeCadenceDays),
      // Anything but a scheduled cadence leaves nothing for auto-scheduling to
      // trigger on, so the two can't disagree about whether this project is
      // managed. The drip's own gate stays in 'nudge' mode for the same reason
      // (see dripCandidate) — this just means it is never asked.
      autoSchedule: nudgeMode === 'scheduled' && autoSchedule,
      ongoing,
      weekendSource,
      pausedUntil: pausedUntil ? dayKeyOf(pausedUntil) : null,
      // A person archived since keeps their place: the page reads through
      // the people store and simply doesn't draw them.
      personIds,
      // A link still sitting in the field counts too, the way a typed line
      // does on Done anywhere else.
      links: (() => {
        const pending = linkDraft.trim() ? parseLabelledLink(linkDraft) : null;
        return pending ? [...links, { id: generateId(), ...pending }] : links;
      })(),
      inOrder,
      showChecked,
    });
    if (departureMoved && priorStart && nextStart) return { from: priorStart, to: nextStart };
    // The same offer when the event moves: the wedding pushed back a month
    // takes "license 60 days before" and "thank-you notes after" with it.
    // Ahead of the deadline, since an event is what the dates are counted from.
    const priorEvent = project.eventDate ? new Date(project.eventDate) : null;
    if (priorEvent && eventDate && dayKeyOf(priorEvent) !== dayKeyOf(eventDate)) {
      return { from: priorEvent, to: eventDate };
    }
    // The same offer when the deadline moves: a party pushed back a week takes
    // its "a week before" tasks with it. The departure wins when both moved,
    // since a trip's prep is counted from the day you leave.
    const priorDeadline = project.deadline ? new Date(project.deadline) : null;
    if (priorDeadline && deadline && dayKeyOf(priorDeadline) !== dayKeyOf(deadline)) {
      return { from: priorDeadline, to: deadline };
    }
    return null;
  };

  const saveAndClose = (skipLinkCheck = false) => {
    // A new project can't be saved without a name. It used to close anyway,
    // and the host then deleted the unnamed row along with the deadline,
    // notes and settings entered for it, without a word.
    if (isNew && !title.trim()) {
      Alert.alert(
        isList ? 'Name this list' : 'Name this project',
        isList ? 'A new list needs a name before it can be saved.' : 'A new project needs a name before it can be saved.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: isList ? 'Discard list' : 'Discard project', style: 'destructive', onPress: () => onClose('discarded') },
        ],
      );
      return;
    }
    // A link left in the field is saved with the rest, so one that can't be
    // read was dropped without a word. Say so instead.
    if (!skipLinkCheck && linkDraft.trim() && !parseLabelledLink(linkDraft)) {
      Alert.alert(
        "That link can't be read",
        'A link starts with https://, or is a site name like example.com.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Save without it', onPress: () => saveAndClose(true) },
        ],
      );
      return;
    }
    const moved = commitEdits();
    // The trip moved, so offer to bring its prepared work with it (see
    // utils/awayShift). Deliberately an offer rather than a shift: "Renew
    // passport" is anchored to the trip and "Buy a suitcase" is not, and only
    // the person who typed them knows which. The sheet closes this one.
    // Only when something would move: with no dated task the sheet opened
    // anyway, over "0 tasks" and a disabled button.
    if (moved && buildAwayShiftPlan(projectTasks, moved.from, moved.to, useSettingsStore.getState().dayResetTime).proposals.length > 0) {
      setShiftFrom(moved.from);
      setShiftTo(moved.to);
      return;
    }
    onClose();
  };

  // The name as it reads on screen right now, for the confirms below: the
  // snapshot's title is blank for a project fresh from quick add, and stale
  // for one renamed in this session.
  const displayTitle = () => title.trim() || project?.title || (isList ? 'this list' : 'this project');

  /**
   * Whether anything on the sheet differs from what the project holds. Read
   * against the stored project rather than a snapshot, since nothing else
   * writes these fields while the sheet is open.
   */
  const isDirty = (): boolean => {
    if (!project) return false;
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const nudge = nudgeFieldsFor(nudgeMode, nudgeCadenceDays);
    return (
      title.trim() !== project.title ||
      notes !== project.notes ||
      category !== project.category ||
      defaultTaskCategory !== project.defaultTaskCategory ||
      JSON.stringify(hasTaskFieldDefaults(taskDefaults) ? taskDefaults : null) !== JSON.stringify(hasTaskFieldDefaults(project.taskDefaults) ? project.taskDefaults : null) ||
      iso(deadline) !== (project.deadline ? new Date(project.deadline).toISOString() : null) ||
      (eventDate ? awayNoonIso(eventDate) : null) !== (project.eventDate ?? null) ||
      (awayStart ? awayNoonIso(awayStart) : null) !== project.awayStart ||
      (awayStart && awayEnd ? awayNoonIso(awayEnd) : null) !== project.awayEnd ||
      (awayStart !== null && awayPauses) !== project.awayPauses ||
      (awayStart !== null ? awayListId : null) !== project.awayListId ||
      (awayStart !== null && destination.trim() ? destination.trim() : null) !== project.destination ||
      nudge.nudgeOptIn !== project.nudgeOptIn ||
      nudge.nudgeCadenceDays !== project.nudgeCadenceDays ||
      (nudgeMode === 'scheduled' && autoSchedule) !== project.autoSchedule ||
      ongoing !== project.ongoing ||
      weekendSource !== project.weekendSource ||
      (pausedUntil ? dayKeyOf(pausedUntil) : null) !== project.pausedUntil ||
      personIds.join() !== (project.personIds ?? []).join() ||
      JSON.stringify(links) !== JSON.stringify(project.links ?? []) ||
      linkDraft.trim() !== '' ||
      inOrder !== (project.inOrder ?? false) ||
      showChecked !== (project.showChecked ?? false)
    );
  };

  // Same confirm, in the same words, as TaskEditor's own Cancel.
  //
  // On a project created for this sheet, Cancel means "don't create it": the
  // row already exists (quick add's "More details" makes it up front), so the
  // host is told to delete it. Only asked about when something was entered
  // beyond the name quick add passed in.
  const handleCancel = () => {
    const leave = () => onClose(isNew ? 'discarded' : undefined);
    if (!isDirty()) { leave(); return; }
    Alert.alert(
      isNew ? (isList ? 'Discard this list?' : 'Discard this project?') : 'Discard changes?',
      isNew
        ? "It hasn't been saved yet. Are you sure you want to discard it?"
        : 'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: leave },
      ],
    );
  };

  const handleDelete = () => {
    if (!project) return;
    Alert.alert(
      `Delete "${displayTitle()}"?`,
      isList
        ? 'Its items can stay as tasks without a list, or be deleted with it.'
        : 'Its tasks can stay in your list without a project, or be deleted with it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: isList ? 'Delete list only' : 'Delete project only', onPress: () => { deleteProject(project.id, { cascade: false }); onClose(); } },
        {
          text: isList ? 'Delete list and items' : 'Delete project and tasks',
          style: 'destructive',
          onPress: () => { deleteProject(project.id, { cascade: true }); onClose(); },
        },
      ],
    );
  };

  const handleComplete = () => {
    if (!project) return;
    // Read at the moment of asking rather than subscribed to: nothing else on
    // the sheet needs the task list, and a subscription re-rendered the whole
    // editor on every task write anywhere in the app.
    const remaining = useTaskStore.getState().tasks.filter(
      t => t.projectId === project.id && t.parentId === null && !t.completed && !t.archived
    );
    const finish = (archiveRemaining: boolean) => {
      haptics.success();
      commitEdits();
      completeProject(project.id, { archiveRemaining });
      onClose();
    };
    if (remaining.length === 0) {
      finish(false);
      return;
    }
    Alert.alert(
      `Complete "${displayTitle()}"?`,
      `It still has ${remaining.length} open ${remaining.length === 1 ? 'task' : 'tasks'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave remaining tasks', onPress: () => finish(false) },
        { text: 'Archive remaining tasks', onPress: () => finish(true) },
      ],
    );
  };

  const categoryOptions: PillGroupOption[] = [
    {
      key: '__none__', label: 'None', pinned: true, selected: !category,
      onPress: () => { haptics.tap(); setCategory(null); closeCategory(); },
    },
    ...[...categories].sort((a, b) => a.sortOrder - b.sortOrder).map(cat => ({
      key: cat.id,
      label: cat.name,
      selected: category === cat.name,
      onPress: () => { haptics.tap(); setCategory(cat.name); closeCategory(); },
    })),
  ];
  // Creating a taken name picks the existing row, in its stored case.
  const createCategory = (name: string) => {
    setCategory(addCategory(name).name);
    closeCategory();
  };

  const handleArchive = () => {
    if (!project) return;
    haptics.success();
    commitEdits();
    archiveProject(project.id);
    onClose();
  };

  // Reopening and unarchiving leave the sheet open, since the project is still
  // the one being edited; only the flag underneath it changed.
  const handleReopen = () => {
    if (!project) return;
    haptics.tap();
    uncompleteProject(project.id);
  };

  // Reusing a project, for the next party or the next trip: as a template to
  // apply whenever, or as a fresh copy straight away. Both save the sheet
  // first, so what's reused is what's on screen.
  const handleSaveAsTemplate = () => {
    if (!project) return;
    commitEdits();
    const saved = useProjectStore.getState().getProjectById(project.id) ?? project;
    const draft = templateFromProject(
      saved,
      useTaskStore.getState().tasks,
      useTaskGroupStore.getState().groups,
      useSettingsStore.getState().dayResetTime,
    );
    addTemplateFromProject(draft);
    haptics.success();
    Alert.alert(
      'Saved as a template',
      `"${draft.name}" is in Templates with its ${draft.items.length} ${draft.items.length === 1 ? 'task' : 'tasks'}${
        saved.awayStart ? ', dated from the day you leave' : saved.eventDate ? ', dated from the event date' : saved.deadline ? ', dated from the deadline' : ''
      }. Apply it from any project's add button, or from Templates.`,
    );
  };

  const handleStartFresh = () => {
    if (!project) return;
    Alert.alert(
      'Start a fresh copy?',
      'Makes a new project with the same tasks and sections, all open again and with no dates. This one stays as it is.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start fresh',
          onPress: () => {
            commitEdits();
            const copy = startFreshFromProject(project.id);
            if (!copy) return;
            haptics.success();
            onClose();
            (navigation as any).navigate('ProjectDetail', { projectId: copy.id });
          },
        },
      ],
    );
  };

  const handleUnarchive = () => {
    if (!project) return;
    haptics.tap();
    unarchiveProject(project.id);
  };

  if (!project) return null;
  const archived = liveArchived ?? project.archived;
  const completed = liveCompleted ?? project.completed;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={() => saveAndClose()}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        // Cancel and Done, the pair every other editor sheet has. Done used to
        // be the only way out, so there was no way to back out of an edit;
        // Delete moved down to the actions at the bottom to make room.
        <SheetHeader
          bare
          title={isNew ? (isList ? 'New list' : 'New project') : (isList ? 'Edit list' : 'Edit project')}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} />}
          right={<SheetHeaderButton label="Done" onPress={() => saveAndClose()} />}
        />
      }
      footer={
        <>
          <WhenPicker
            visible={showEventPicker}
            value={eventDate}
            title="Event date"
            showTimeOfDay={false}
            showSuggest={false}
            onConfirm={(date) => { setEventDate(date); setShowEventPicker(false); }}
            onClear={() => { setEventDate(null); setShowEventPicker(false); }}
            onCancel={() => setShowEventPicker(false)}
          />
          <WhenPicker
            visible={showDeadlinePicker}
            value={deadline}
            title="Deadline"
            showTimeOfDay={false}
            showSuggest={false}
            onConfirm={(date) => { setDeadline(date); setShowDeadlinePicker(false); }}
            onClear={() => { setDeadline(null); setShowDeadlinePicker(false); }}
            onCancel={() => setShowDeadlinePicker(false)}
          />
          <WhenPicker
            visible={pickingAway !== null}
            value={pickingAway === 'end' ? awayEnd : awayStart}
            title={pickingAway === 'end' ? 'Coming back' : 'Leaving'}
            showTimeOfDay={false}
            showSuggest={false}
            onConfirm={(date) => {
              if (pickingAway === 'end') {
                // Only a return strictly after the departure is kept, matching
                // awaySpanOf's own refusal — an end on or before the start is
                // a typo, and a span that contains no days is not one anybody
                // entered on purpose. Backdating is still allowed for both:
                // recording a trip that has already happened is a real thing
                // to do, which is why allowPast is left at its default.
                if (date && awayStart && date <= awayStart) {
                  // Said rather than silently dropped, which is what this did:
                  // the picker closed and the row stayed empty with no reason.
                  Alert.alert('Coming back is before leaving', 'Pick a day after you leave.');
                  return;
                }
                setAwayEnd(date);
              } else {
                // Moving the departure moves the return with it, keeping the
                // trip the same length: a flight moved three days later is the
                // same ten-day trip. Leaving the return where it was quietly
                // shortened the trip, or cleared the return when the new
                // departure passed it.
                if (date && awayStart && awayEnd) {
                  setAwayEnd(addDays(awayEnd, differenceInCalendarDays(date, awayStart)));
                }
                setAwayStart(date);
              }
              setPickingAway(null);
            }}
            onClear={() => {
              if (pickingAway === 'end') setAwayEnd(null);
              // Clearing the departure clears the return with it: an end with
              // no start is dropped on save anyway, and leaving it on screen
              // would show a value that no longer means anything.
              else { setAwayStart(null); setAwayEnd(null); }
              setPickingAway(null);
            }}
            onCancel={() => setPickingAway(null)}
          />
          <WhenPicker
            visible={pickingPause}
            value={pausedUntil}
            title="Pause until"
            showTimeOfDay={false}
            showSuggest={false}
            // The day it comes back, so it has to be one still ahead.
            allowPast={false}
            onConfirm={(date) => { setPausedUntil(date); setPickingPause(false); }}
            onClear={() => { setPausedUntil(null); setPickingPause(false); }}
            onCancel={() => setPickingPause(false)}
          />
          <AwayShiftSheet
            visible={shiftFrom !== null && shiftTo !== null}
            tasks={projectTasks}
            from={shiftFrom}
            to={shiftTo}
            projectTitle={project?.title ?? 'The trip'}
            onClose={() => { setShiftFrom(null); setShiftTo(null); onClose(); }}
          />
        </>
      }
    >
      <TextField
        style={styles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="Project name"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={TITLE_MAX_LENGTH}
        // A project fresh from quick add's "More details" arrives unnamed, and
        // naming it is the one thing it can't be saved without.
        autoFocus={isNew && !project.title}
      />
      <View style={styles.notesCard}>
        <TextField
          style={[styles.notesInput, { height: Math.max(styles.notesInput.minHeight, notesHeight) }]}
          value={notes}
          onChangeText={setNotes}
          onContentSizeChange={e => setNotesHeight(Math.ceil(e.nativeEvent.contentSize.height))}
          placeholder="Notes"
          placeholderTextColor={colors.textTertiary}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
        />
      </View>

      {/* The same card order every other editor follows (Schedule, Organize,
          then the rarely-changed rows), under the same uppercase labels. This
          sheet was a column of unlabelled cards in the order each field was
          added, with the nudge's own switch floating free of the field it
          belongs to. */}
      {(!isList || deadline !== null || eventDate !== null) && (
      <>
      <Text style={styles.groupLabel}>Schedule</Text>
      <View style={styles.card}>
        <EditorRow
          icon="calendar-outline"
          label="Event date"
          value={eventDate ? formatDeadlineDate(eventDate.toISOString()) : undefined}
          onPress={() => setShowEventPicker(true)}
          onClear={eventDate ? () => setEventDate(null) : undefined}
        />
        <EditorRow
          icon="flag-outline"
          label="Deadline"
          value={deadline ? formatDeadlineDate(deadline.toISOString()) : undefined}
          onPress={() => setShowDeadlinePicker(true)}
          onClear={deadline ? () => setDeadline(null) : undefined}
        />
      </View>
      {/* Same flag icon and the same word a task's own deadline uses, because
          it is the same idea one container out. It replaced a "Start date" /
          "Target date" pair whose first half had one reader in its life (see
          Project.deadline). */}
      <Text style={styles.sectionFooter}>
        The event date is the day the project is for, like a wedding or a move. Changing it offers to move the project's dated tasks by the same number of days. The deadline is shown on the project's card and flagged once it passes.
      </Text>
      </>
      )}

      {/* The away span. Two rows rather than one range control because the end
          is genuinely optional: a trip you have booked a flight out for and
          not back from is a real state, and it is the one LookAheadWindow
          already calls "a boundary but not a trip". The return row only
          appears once there is a departure, so the asymmetry is visible
          instead of being enforced by silently dropping what you typed.

          Simplified mode takes the whole block, but only while this project
          has no span: rule 2 of that mode is that a feature already in use
          stays on show, and the rule it is *not* allowed to break is rule 1 —
          hiding these rows must never stop checkAwayVacation, or a rendering
          switch would be quietly changing behaviour. */}
      {awayFieldShown && (
      <>
      <View style={[styles.card, styles.stackedCard]}>
        <EditorRow
          icon="airplane-outline"
          label="Leaving"
          value={awayStart ? formatDeadlineDate(awayStart.toISOString()) : undefined}
          onPress={() => setPickingAway('start')}
          onClear={awayStart ? () => { setAwayStart(null); setAwayEnd(null); } : undefined}
        />
        {awayStart && (
          <EditorRow
            icon="home-outline"
            label="Coming back"
            value={awayEnd ? formatDeadlineDate(awayEnd.toISOString()) : undefined}
            onPress={() => setPickingAway('end')}
            onClear={awayEnd ? () => setAwayEnd(null) : undefined}
          />
        )}
        {awayStart && (
          <View style={styles.destinationRow}>
            <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
            <TextField
              style={styles.destinationInput}
              value={destination}
              onChangeText={setDestination}
              placeholder="e.g. Lisbon"
              placeholderTextColor={colors.textTertiary}
              maxLength={80}
              accessibilityLabel="Where you're going"
            />
          </View>
        )}
        {awayStart && placeSuggestions.results.length > 0 && (
          <View style={styles.placeList}>
            {placeSuggestions.results.map((place: PlaceResult, index) => {
              const subtitle = placeSubtitle(place);
              return (
                <TouchableOpacity
                  key={`${place.latitude},${place.longitude},${index}`}
                  style={[styles.placeRow, styles.placeRowRuled]}
                  onPress={() => {
                    haptics.tap();
                    animateLayout();
                    // The name alone, never the address: the forecast looks the
                    // destination up by place name, and a street address finds
                    // nothing there.
                    const text = place.name ?? place.address ?? '';
                    setDestination(text);
                    setPickedDestination(text);
                  }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${place.name ?? place.address}`}
                >
                  <Text style={styles.placeName} numberOfLines={1}>{place.name ?? place.address}</Text>
                  {subtitle && <Text style={styles.placeAddress} numberOfLines={1}>{subtitle}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {awayStart && !placeSuggestions.enabled && placeSuggestions.wanted && (
          <View style={styles.placeOffer}>
            <InlineAction
              icon="search-outline"
              label="Suggest places"
              variant="neutral"
              onPress={() => setPlaceSuggestionsEnabled(true)}
              accessibilityLabel="Turn on place suggestions from Apple Maps"
            />
            <Text style={styles.placeOfferText}>Looks up what you type in Apple Maps.</Text>
          </View>
        )}
        {/* The forecast is an app-wide switch, off by default, and was only
            mentioned in the footer. Offered right where a place is typed. */}
        {awayStart && destination.trim().length > 0 && (
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { haptics.tap(); setForecastOn(!forecastOn); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityLabel="Show the forecast for where you're going"
            accessibilityState={{ checked: forecastOn }}
          >
            <Ionicons name="partly-sunny-outline" size={18} color={forecastOn ? colors.accent : colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Show the forecast there</Text>
              <Text style={styles.optionHint}>
                {forecastOn
                  ? "Looks up the place's weather for your trip dates and shows it on the project. Applies to every trip."
                  : 'Off. Turning it on looks up the place by name, for every trip.'}
              </Text>
            </View>
            <View style={[styles.toggle, forecastOn && styles.toggleOn]}>
              <View style={[styles.toggleKnob, forecastOn && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        )}
        {awayStart && (
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { haptics.tap(); setAwayPauses(v => !v); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityLabel="Pause tasks while away"
            accessibilityState={{ checked: awayPauses }}
          >
            <Ionicons name="pause-circle-outline" size={18} color={awayPauses ? colors.accent : colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Pause tasks while away</Text>
              <Text style={styles.optionHint}>
                {awayPauses
                  ? pausedTaskCount + pausedCategoryCount === 0
                    ? "Vacation mode turns on the day you leave and off when you're back. Nothing is set to pause on vacation yet, so it won't hide anything until you set that on a task or category."
                    : `Vacation mode turns on the day you leave and off when you're back, hiding ${[
                        pausedTaskCount > 0 ? `${pausedTaskCount} ${pausedTaskCount === 1 ? 'task' : 'tasks'}` : null,
                        pausedCategoryCount > 0 ? `${pausedCategoryCount} ${pausedCategoryCount === 1 ? 'category' : 'categories'}` : null,
                      ].filter(Boolean).join(' and ')} set to pause on vacation.`
                  : 'Vacation mode stays however you set it.'}
              </Text>
            </View>
            <View style={[styles.toggle, awayPauses && styles.toggleOn]}>
              <View style={[styles.toggleKnob, awayPauses && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        )}
        {/* The shopping list this trip buys from. A CollapsibleField holding a
            PillGroup, because the set is one the user builds and has no
            ceiling — the rule the design system states for aisles and stores,
            and lists are the same shape. "No list" is pinned so the option
            meaning *leave my lists alone* is never buried behind the cap. */}
        {awayStart && kitchenEnabled && (
          <CollapsibleField
            label="Shopping list"
            summary={awayListName}
            hint="Groceries opens on this list while you're away, and goes back to Groceries when you're home. Switch lists yourself any time and it stays where you put it for the rest of the trip."
            expanded={awayListOpen}
            onToggle={() => setAwayListOpen(v => !v)}
          >
            <PillGroup
              options={awayListOptions}
              noun="list"
              onCreate={handleCreateAwayList}
              filterPlaceholder="Find or add a list…"
            />
          </CollapsibleField>
        )}
      </View>
      <Text style={styles.sectionFooter}>
        The days you're away from home, for a trip. Leave these blank otherwise. The day you come back doesn't count as a day away.
      </Text>
      </>
      )}

      <Text style={styles.groupLabel}>Organize</Text>
      <View style={styles.card}>
        <CollapsibleField
          label="Category"
          summary={category ?? undefined}
          hint="Groups this project with others of the same kind on the Projects page."
          expanded={categoryOpen}
          onToggle={() => setCategoryOpen(v => !v)}
        >
          {/* A PillGroup, for the reason the trip's shopping list below is one:
              the pool is the user's own and has no ceiling. */}
          <PillGroup options={categoryOptions} noun="category" pluralNoun="categories" onCreate={createCategory} />
        </CollapsibleField>
        <View style={styles.sep} />
        <CollapsibleField
          label="Default task category"
          summary={defaultTaskCategory ? categoryLabel(defaultTaskCategory, taskCategories) : undefined}
          hint="A task added straight to this project starts in this category, unless it's given one of its own."
          expanded={defaultTaskCategoryOpen}
          onToggle={() => setDefaultTaskCategoryOpen(v => !v)}
        >
          <CategoryPickerList
            value={defaultTaskCategory}
            onSelect={cat => { setDefaultTaskCategory(cat); setDefaultTaskCategoryOpen(false); }}
          />
        </CollapsibleField>
        <View style={styles.sep} />
        <CollapsibleField
          label="New task defaults"
          summary={describeTaskFieldDefaults(taskDefaults) ?? undefined}
          emptySummary="Ask for each task"
          hint="Tasks added to this project start with these answers, so they don't come up in Backfill. Anything set on a task itself wins."
          expanded={taskDefaultsOpen}
          onToggle={() => setTaskDefaultsOpen(v => !v)}
        >
          <TaskFieldDefaultsFields value={taskDefaults} onChange={setTaskDefaults} showDifficulty={rewardsEnabled} />
          {applyableCount > 0 && (
            <View style={{ marginTop: spacing.md, alignItems: 'flex-start' }}>
              <InlineAction
                label={`Apply to ${applyableCount} existing ${applyableCount === 1 ? 'task' : 'tasks'}`}
                icon="checkmark-done-outline"
                onPress={confirmApplyToExisting}
                variant="neutral"
              />
            </View>
          )}
        </CollapsibleField>
        <View style={styles.sep} />
        <CollapsibleField
          label="People"
          summary={personIds.length > 0
            ? people.filter(p => personIds.includes(p.id)).map(displayNameOf).join(', ') || undefined
            : undefined}
          hint="Who this project is with or for. They're shown on the project page. New tasks don't pick them up."
          expanded={peopleOpen}
          onToggle={() => setPeopleOpen(v => !v)}
        >
          <PillGroup
            noun="person"
            pluralNoun="people"
            options={people.map(p => {
              const on = personIds.includes(p.id);
              return {
                key: p.id,
                label: displayNameOf(p),
                selected: on,
                onPress: () => {
                  haptics.tap();
                  setPersonIds(ids => (on ? ids.filter(id => id !== p.id) : [...ids, p.id]));
                },
              };
            })}
            onCreate={name => {
              const person = usePersonStore.getState().createPerson(name);
              setPersonIds(ids => [...ids, person.id]);
            }}
          />
        </CollapsibleField>
      </View>

      {/* Links kept with the project: the booking, the shared doc, the
          listing. A line each, tapped open from the project page. */}
      <Text style={styles.groupLabel}>Links</Text>
      <View style={styles.card}>
        {links.map((link, i) => (
          <React.Fragment key={link.id}>
            {i > 0 && <View style={styles.sep} />}
            <View style={styles.linkRow}>
              <Ionicons name="link-outline" size={18} color={colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel} numberOfLines={1}>{link.label || linkHost(link.url)}</Text>
                <Text style={styles.optionHint} numberOfLines={1}>{link.url}</Text>
              </View>
              <TouchableOpacity
                onPress={() => { haptics.tap(); setLinks(ls => ls.filter(l => l.id !== link.id)); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${link.label || linkHost(link.url)}`}
              >
                <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </React.Fragment>
        ))}
        {links.length > 0 && <View style={styles.sep} />}
        <View style={styles.linkRow}>
          <Ionicons name="add" size={18} color={colors.textTertiary} />
          <TextField
            style={styles.linkInput}
            value={linkDraft}
            onChangeText={setLinkDraft}
            onSubmitEditing={addLinkDraft}
            placeholder="Paste a link, with a name before it if you like"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel="Add a link"
          />
        </View>
      </View>
      {linkError && <Text style={styles.sectionFooter}>{linkError}</Text>}

      {/* One question, three answers. "Include in nudges" and "Review cadence"
          used to be a switch and a stepper nested inside it, which took two
          controls to say one thing and let them be set into combinations
          nobody chose — see NudgeMode in utils/nudgeCadence. Automatic
          scheduling only exists under "Every…", so it lives inside the same
          field rather than as a card of its own that came and went beside it. */}
      {(!isList || nudgeMode !== 'never') && (
      <>
      <Text style={styles.groupLabel}>Nudges</Text>
      <View style={styles.card}>
        <CollapsibleField
          label="Bring this up"
          summary={describeNudge(nudgeFieldsFor(nudgeMode, nudgeCadenceDays))
            + (nudgeMode === 'scheduled' && autoSchedule ? ', automatically' : '')}
          hint="A project's tasks only reach Today once they have a date. This is what happens when nothing in this project has one."
          expanded={cadenceOpen}
          onToggle={() => setCadenceOpen(v => !v)}
        >
          <View style={styles.modeBlock}>
            <SegmentedControl
              label="Bring this up"
              options={NUDGE_MODE_OPTIONS}
              value={nudgeMode}
              onChange={next => { animateLayout(); setNudgeMode(next); }}
            />
            <Text style={styles.modeHint}>{NUDGE_MODE_HINT[nudgeMode]}</Text>
          </View>

          {nudgeMode === 'scheduled' && (
            <View style={styles.cadenceRow}>
              <CountStepper
                value={cadence.count}
                onChange={next => setNudgeCadenceDays(fromCadenceParts({ ...cadence, count: next }))}
                min={1}
                max={CADENCE_UNIT_MAX[cadence.unit]}
                label="Review cadence"
                describeValue={n => describeCadence(fromCadenceParts({ ...cadence, count: n }))}
              />
              {/* No allowNull on the stepper: the track above is where Never
                  lives now, and two controls clearing to the same state is the
                  ambiguity this merge removed. */}
              <View style={styles.cadenceUnit}>
                <SegmentedControl
                  label="Review cadence unit"
                  options={CADENCE_UNITS.map(unit => ({ value: unit, label: cadenceUnitLabel(unit) }))}
                  value={cadence.unit}
                  onChange={unit => setNudgeCadenceDays(fromCadenceParts(withCadenceUnit(cadence, unit)))}
                />
              </View>
            </View>
          )}

          {nudgeMode === 'scheduled' && (
            <TouchableOpacity
              style={[styles.optionRow, styles.optionRowInset]}
              onPress={() => { haptics.tap(); setAutoSchedule(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityLabel="Schedule automatically"
              accessibilityState={{ checked: autoSchedule }}
            >
              <Ionicons name="play-forward-outline" size={18} color={autoSchedule ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Schedule automatically</Text>
                <Text style={styles.optionHint}>
                  {autoSchedule
                    ? 'Dates the next task on its own instead of adding a review task'
                    : 'Adds a review task and leaves the dates to you'}
                </Text>
              </View>
              <View style={[styles.toggle, autoSchedule && styles.toggleOn]}>
                <View style={[styles.toggleKnob, autoSchedule && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          )}
        </CollapsibleField>
      </View>
      </>
      )}

      {/*
        Whether this project is a list lives on its own screen — the
        list-outline toggle in ProjectDetailScreen's header, right where its
        effect shows — not here. See docs/arch/lists.md.
      */}

      <Text style={styles.groupLabel}>More</Text>
      <View style={styles.card}>
        {/* Parking a project for a season. Archive files the project but
            leaves its tasks (a weekly watering stays on Today all winter);
            this holds every one of them back until the day, then brings the
            lot back on its own. */}
        <EditorRow
          icon="pause-outline"
          label="Pause until"
          hint={isList
            ? 'Hides all of its items and stops any nudges until this day.'
            : 'Hides all of its tasks, repeating ones too, and stops any nudges until this day.'}
          value={pausedUntil ? formatDeadlineDate(pausedUntil.toISOString()) : undefined}
          onPress={() => setPickingPause(true)}
          onClear={pausedUntil ? () => setPausedUntil(null) : undefined}
        />
        <View style={styles.sepIcon} />
        {isList ? (
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { haptics.tap(); setShowChecked(v => !v); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityLabel="Keep checked items in view"
            accessibilityState={{ checked: showChecked }}
          >
            <Ionicons name="checkmark-done-outline" size={18} color={showChecked ? colors.accent : colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Keep checked items in view</Text>
              <Text style={styles.optionHint}>
                {showChecked
                  ? 'Checked items stay at the bottom, crossed out, in list order'
                  : 'Checked items fold away under a "Show checked" button at the bottom'}
              </Text>
            </View>
            <View style={[styles.toggle, showChecked && styles.toggleOn]}>
              <View style={[styles.toggleKnob, showChecked && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { haptics.tap(); setInOrder(v => !v); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityLabel="Work in order"
            accessibilityState={{ checked: inOrder }}
          >
            <Ionicons name="list-outline" size={18} color={inOrder ? colors.accent : colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Work in order</Text>
              <Text style={styles.optionHint}>
                {inOrder
                  ? 'Pull and automatic scheduling only offer the first open task on the page'
                  : 'Pull and automatic scheduling offer whichever task fits best'}
              </Text>
            </View>
            <View style={[styles.toggle, inOrder && styles.toggleOn]}>
              <View style={[styles.toggleKnob, inOrder && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        )}
        <View style={styles.sepIcon} />
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setOngoing(v => !v); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Ongoing"
          accessibilityState={{ checked: ongoing }}
        >
          <Ionicons name="infinite-outline" size={18} color={ongoing ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Ongoing</Text>
            <Text style={styles.optionHint}>
              {ongoing
                ? `Never offered as complete. Its card counts open ${isList ? 'items' : 'tasks'} instead of a progress bar`
                : isList ? 'Offers to mark complete once every item is checked' : 'Offers to mark complete once every task is done'}
            </Text>
          </View>
          <View style={[styles.toggle, ongoing && styles.toggleOn]}>
            <View style={[styles.toggleKnob, ongoing && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
        <View style={styles.sepIcon} />
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setWeekendSource(v => !v); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Suggest for a free weekend"
          accessibilityState={{ checked: weekendSource }}
        >
          <Ionicons name="sunny-outline" size={18} color={weekendSource ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Suggest for a free weekend</Text>
            <Text style={styles.optionHint}>
              {!weekendNudgeOn
                ? 'Takes effect once "Nudge for an empty weekend" is on in Automations, in the menu'
                : nudgeMode === 'never'
                  ? 'Takes effect once "Bring this up" is set to When I ask or Every…'
                  : weekendSource
                  ? 'The weekend task names this project when a weekend has nothing on it'
                  : 'The weekend task does not name this project'}
            </Text>
          </View>
          <View style={[styles.toggle, weekendSource && styles.toggleOn]}>
            <View style={[styles.toggleKnob, weekendSource && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Actions, not settings. These were drawn as switches, but turning one
          on closed the sheet and turning it off didn't, which no switch does.
          A project fresh from quick add doesn't get them: completing or
          filing away something that hasn't been named yet isn't a real want,
          and an unnamed row is discarded on close anyway. */}
      {!isNew && (
        <View style={[styles.card, styles.actionsCard]}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={completed ? handleReopen : handleComplete}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={completed ? 'Reopen project' : 'Mark project complete'}
          >
            <Ionicons
              name={completed ? 'refresh-outline' : 'checkmark-circle-outline'}
              size={18}
              color={colors.textSecondary}
            />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>{completed ? 'Reopen project' : 'Mark complete'}</Text>
              <Text style={styles.optionHint}>
                {completed ? 'Moves it back to the active list' : 'Moves it to the Completed list'}
              </Text>
            </View>
          </TouchableOpacity>
          <View style={styles.sepIcon} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={archived ? handleUnarchive : handleArchive}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={archived ? 'Unarchive project' : 'Archive project'}
          >
            <Ionicons name="archive-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>{archived ? 'Unarchive' : 'Archive'}</Text>
              <Text style={styles.optionHint}>
                {archived ? 'Moves it back out of the Archived list' : 'Moves it to the Archived list. Its tasks stay where they are'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {!isNew && (
        <View style={[styles.card, styles.stackedCard]}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={handleSaveAsTemplate}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Save as a template"
          >
            <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Save as template</Text>
              <Text style={styles.optionHint}>Keeps its tasks and sections to apply again, with dates counted from its deadline or trip</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.sepIcon} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={handleStartFresh}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Start a fresh copy"
          >
            <Ionicons name="duplicate-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Start a fresh copy</Text>
              <Text style={styles.optionHint}>{isList ? 'A new list with the same items, all unchecked' : 'A new project with the same tasks, all open and undated'}</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {!isNew && (
        <View style={[styles.card, styles.stackedCard]}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={handleDelete}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={isList ? 'Delete list' : 'Delete project'}
          >
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <View style={styles.optionContent}>
              <Text style={[styles.optionLabel, styles.deleteLabel]}>{isList ? 'Delete list' : 'Delete project'}</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}
    </EditorSheet>
  );
}


const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: fontWeight.medium,
    paddingVertical: spacing.sm, minHeight: 44,
  },
  notesCard: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
    marginBottom: spacing.md,
  },
  notesInput: {
    color: colors.text, fontSize: font.md,
    padding: 0, minHeight: 120,
    // No lineHeight on a TextInput. RN maps it onto the iOS paragraph style's
    // minimum/maximum line height with no compensating baseline offset, so the
    // glyphs are drawn a full line height below the top of the line box rather
    // than one ascent below it: the notes sat low in the field while the caret
    // stayed centred, and the placeholder inherited the same attributes so an
    // empty field looked wrong too. The minHeight above is what keeps the box
    // the size the lineHeight used to imply.
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  // A second card under the same group label, like the away rows beneath the
  // deadline.
  stackedCard: { marginTop: spacing.md },
  deleteLabel: { color: colors.redText },
  actionsCard: { marginTop: spacing.xl },
  // Matches EditorGroup's label, which this sheet can't use directly: its
  // cards carry their own horizontal margin, and these sit on the scroll
  // content's padding instead.
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.bold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  modeBlock: { marginTop: spacing.md, gap: spacing.sm },
  modeHint: { color: colors.textTertiary, fontSize: font.xs },
  // The unit track stays one group: at a narrow width the whole track drops to
  // a second line rather than splitting "Months" off on its own.
  cadenceRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: spacing.sm, marginTop: spacing.md,
  },
  cadenceUnit: { flexGrow: 1, flexBasis: 200 },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  // Clears the 18pt icon column, the way EditorGroup's own divider does.
  sepIcon: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 18 + spacing.md,
  },
  sectionFooter: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  destinationRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  placeList: { paddingHorizontal: spacing.md },
  placeRow: { paddingVertical: spacing.sm, gap: spacing.xxs },
  placeRowRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  placeName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  placeAddress: { color: colors.textSecondary, fontSize: font.xs },
  placeOffer: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  placeOfferText: { flex: 1, color: colors.textSecondary, fontSize: font.xs },
  destinationInput: { flex: 1, color: colors.text, fontSize: font.md, padding: 0 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    paddingHorizontal: spacing.md,
    minHeight: 52,
  },
  // Height rather than lineHeight, per the TextInput note in CLAUDE.md.
  linkInput: { flex: 1, color: colors.text, fontSize: font.md, minHeight: 44 },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  // Inside a CollapsibleField, which already supplies the side padding.
  optionRowInset: { paddingHorizontal: 0, paddingBottom: 0, marginTop: spacing.xs },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.xxs },
  toggle: {
    width: 44, height: 26, borderRadius: radius.full,
    backgroundColor: colors.bgQuaternary, padding: spacing.xxs, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.bg,
  },
  toggleKnobOn: { alignSelf: 'flex-end' },
});
