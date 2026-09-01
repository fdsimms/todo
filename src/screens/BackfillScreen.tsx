import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, StyleSheet, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { format } from 'date-fns/format';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { usePersonGroupStore } from '../store/usePersonGroupStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { SegmentedControl } from '../components/SegmentedControl';
import { CategoryPickerList } from '../components/CategoryPicker';
import { CountStepper } from '../components/CountStepper';
import { PillGroup } from '../components/PillGroup';
import { SubstituteSheet } from '../components/SubstituteSheet';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from '../components/NumberPadAccessory';
import { RemindMePicker } from '../components/RemindMePicker';
import { BirthdayPicker } from '../components/BirthdayPicker';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, lineHeight, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { displayTitleFor, activeChainStepTitle } from '../utils/visibilityUtils';
import { activeMealSlotStepId } from '../utils/mealSlotTasks';
import { describeTaskRecurrence } from '../utils/recurrenceLabels';
import { formatDuration, EFFORT_MINUTES, minutesToEffort } from '../utils/effort';
import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import {
  BACKFILL_FIELDS, backfillCandidates, backfillFieldCounts, estimatePatchFor, dismissBackfillField,
  isFieldMissing, type BackfillFieldId,
} from '../utils/fieldBackfill';
import {
  CATEGORY_BACKFILL_FIELDS, categoryBackfillCandidates, categoryBackfillFieldCounts, dismissCategoryBackfillField,
  type CategoryBackfillFieldId,
} from '../utils/categoryBackfill';
import {
  PROJECT_BACKFILL_FIELDS, projectBackfillCandidates, projectBackfillFieldCounts, dismissProjectBackfillField,
  type ProjectBackfillFieldId,
} from '../utils/projectBackfill';
import {
  PERSON_BACKFILL_FIELDS, personBackfillCandidates, personBackfillFieldCounts, dismissPersonBackfillField,
  personCadencePatch, groupmatesOf, groupmateCadenceOffer, type PersonBackfillFieldId,
} from '../utils/peopleBackfill';
import {
  ITEM_BACKFILL_FIELDS, itemBackfillCandidates, itemBackfillFieldCounts, dismissItemBackfillField,
  type ItemBackfillFieldId,
} from '../utils/itemBackfill';
import {
  CADENCE_UNITS, CADENCE_UNIT_MAX, toCadenceParts, fromCadenceParts, withCadenceUnit, describeCadence, cadenceUnitLabel,
  type CadenceParts,
  FALLBACK_CADENCE_DAYS,
  nudgeFieldsFor,
} from '../utils/nudgeCadence';
import { personHistory } from '../utils/personHistory';
import { observedCadenceDays, describeObservedCadence } from '../utils/reachOutTasks';
import { genericNameSuggestions } from '../utils/itemVarieties';
import { substitutesFor, describeSubstitutes } from '../utils/itemSubs';
import { groceryNameKey } from '../utils/groceryParse';
import { EFFORT_LABELS, GROCERY_NAME_MAX_LENGTH, type Effort, type Person, type ReminderKind, type Task } from '../types';

const FIELD_ICONS: Record<BackfillFieldId, keyof typeof Ionicons.glyphMap> = {
  estimate: 'time-outline',
  priority: 'flag-outline',
  category: 'folder-outline',
  streak: 'flame-outline',
  vacation: 'airplane-outline',
  reminder: 'notifications-outline',
  suggestions: 'color-wand-outline',
};

// Filled counterparts of the row icons above, for the per-card CTA button —
// same outline/filled split the task fields use (flame-outline in the list,
// flame on the button).
const CATEGORY_FIELD_ICONS: Record<CategoryBackfillFieldId, { row: keyof typeof Ionicons.glyphMap; button: keyof typeof Ionicons.glyphMap }> = {
  vacation: { row: 'airplane-outline', button: 'airplane' },
  suggestions: { row: 'color-wand-outline', button: 'color-wand' },
  newBanner: { row: 'notifications-off-outline', button: 'notifications-off' },
};

// The one project field with no single filled/outline icon pair — its "on"
// action is a value picker, not a tap, so there's no separate button glyph
// to reach for the way the toggle fields do.
const PROJECT_FIELD_ICONS: Record<ProjectBackfillFieldId, keyof typeof Ionicons.glyphMap> = {
  nudge: 'notifications-outline',
  sequential: 'list-outline',
};

// Neither person field with a value picker has a filled/outline pair to
// switch between, same as the project side — their "on" action is a birthday,
// a cadence or a sentence, not a tap.
const PERSON_FIELD_ICONS: Record<PersonBackfillFieldId, keyof typeof Ionicons.glyphMap> = {
  birthday: 'gift-outline',
  cadence: 'notifications-outline',
  askAbout: 'chatbubble-ellipses-outline',
};

// Neither item field is a plain toggle either — `variety` opens a name
// picker, `substitutes` opens the same sheet the grocery row's swap glyph
// does — so, like the project/person maps above, there's no filled/outline
// pair to switch between.
const ITEM_FIELD_ICONS: Record<ItemBackfillFieldId, keyof typeof Ionicons.glyphMap> = {
  substitutes: 'swap-horizontal-outline',
  variety: 'layers-outline',
};

type EntityKind = 'task' | 'category' | 'project' | 'person' | 'item';
const ENTITY_KIND_SEGMENTS = [
  { value: 'task' as const, label: 'Tasks' },
  { value: 'category' as const, label: 'Categories' },
  { value: 'project' as const, label: 'Projects' },
  { value: 'person' as const, label: 'People' },
  { value: 'item' as const, label: 'Items' },
];

// Bucket 0 ("—") is left off — see estimatePatchFor's doc comment for why.
const ESTIMATE_OPTIONS = [1, 2, 3, 4, 5, 6] as Effort[];
// None is the field's own "missing" value here, so offering it would be a
// tap that visibly does nothing — see the note on SegmentedControl's
// no-op-on-reselect behavior.
const PRIORITY_OPTIONS = PRIORITY_SEGMENTS.filter(s => s.value !== 0);

/** The unit beside the custom-estimate number — same pair TaskEditor's own Effort field offers. */
const DURATION_UNIT_SEGMENTS = [
  { value: 'min' as const, label: 'min' },
  { value: 'hr' as const, label: 'hr' },
];

/**
 * Walk the tasks or categories missing one field — time estimate, priority,
 * category, streak chip, vacation pause on the task side; hide-on-vacation,
 * skip-in-suggestions, skip-in-new-banner on the category side — and fill it
 * in one at a time: pick a value, the next item with the same gap takes its
 * place immediately. No swiping; a tap commits the value (writing straight
 * through `updateTask`/the category and project stores, same as their own
 * editors) and advances, which is the fast, low-friction loop the
 * field-by-field flow is for. The `Tasks`/`Categories`/`Projects`/`People`/
 * `Items` segmented control on the field-picker step chooses which pool
 * `active` (and everything downstream) reads from.
 *
 * The queue is *live*, not a snapshot: it's `backfillCandidates`/
 * `categoryBackfillCandidates`/`projectBackfillCandidates`/
 * `itemBackfillCandidates` recomputed off the current list every render,
 * filtered against `skippedIds` for items left for later this session.
 * That's what lets a plain "current item is the front of the queue" model
 * work with no index to keep in sync — once an item's field is set it drops
 * out on its own. Tasks, categories, projects and grocery items all carry a
 * plain `id`, so the same `skippedIds` set works for any of them without
 * knowing which kind is active.
 *
 * **The People pool plays by `docs/arch/people.md`'s rules, not by the other
 * pools.** Two of them bite here and both are held in `peopleBackfill.ts`
 * rather than in this file: the queue runs in the People screen's own hand
 * order rather than alphabetically (an alphabetical queue is still the app
 * replacing a ranking somebody made on purpose), and nothing about the pool
 * reads history, a last-together date or a day count. The one thing the person
 * card shows that its siblings don't is the *cadence offer* — a number out of
 * your own history, which is rule 5 and the reason declaring a frequency for a
 * friend never has to be the only way in.
 *
 * **The Items pool's two fields aren't toggles either**, same shape as the
 * project/person value-picker fields: `variety` opens the same generic-name
 * grid `GroceryItemSheet`'s own Variety of field does (`genericNameSuggestions`),
 * and `substitutes` opens the actual `SubstituteSheet` rather than reproducing
 * its search-and-link flow inline. Because that sheet writes to the store
 * itself (`linkItemSub`) rather than returning a value the way `RemindMePicker`/
 * `BirthdayPicker` do, its card snapshots the item's substitute ids on open and
 * diffs them on close (`openSubstituteSheet`/`closeSubstituteSheet`) to decide
 * whether anything was actually added — a cancel leaves the card exactly where
 * it was, and only a real add logs a session entry and lets the live queue
 * drop the item.
 *
 * The header's redo icon (task fields only, for now) starts the same loop
 * over from scratch — every live task for the field, including ones already
 * set — for someone who wants to revisit a field wholesale rather than just
 * fill in the gaps. It's still one task at a time through the normal
 * apply/skip/dismiss actions, so a value is only ever replaced when you
 * reach that task and set a new one; nothing is cleared in bulk up front.
 */
type ActiveField =
  | { kind: 'task'; id: BackfillFieldId }
  | { kind: 'category'; id: CategoryBackfillFieldId }
  | { kind: 'project'; id: ProjectBackfillFieldId }
  | { kind: 'person'; id: PersonBackfillFieldId }
  | { kind: 'item'; id: ItemBackfillFieldId };

/**
 * One line of the compact review shown once a field's queue empties: what got
 * set, for what, and how to take it back. Keyed by `itemId` and deduped on
 * that key (`logSession` below) rather than appended freely, so answering the
 * same item twice in one session (reachable through the Previous button)
 * updates its one row instead of leaving a stale one behind.
 *
 * `undo` is a closure captured at the moment of the write, holding whatever
 * the field actually needs to put back — the task's own `updateTask` snapshot
 * for task fields, the specific category setter for a toggle, or the prior
 * subset of a project/person patch. Firing it and then dropping the item's id
 * back out of `skippedIds` (see `undoSessionEntry`) is enough: the live
 * queue's own "is this still missing?" filter puts the item back at the front
 * on its own, the same mechanism the Previous button already leans on.
 */
interface SessionEntry {
  itemId: string;
  title: string;
  valueText: string;
  undo: () => void;
}

export function BackfillScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const tasks = useTaskStore(useShallow(s => s.tasks));
  const updateTask = useTaskStore(s => s.updateTask);
  const setLastAction = useTaskStore(s => s.setLastAction);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const setCategoryHideOnVacation = useCategoryStore(s => s.setCategoryHideOnVacation);
  const setCategoryExcludeFromSuggestions = useCategoryStore(s => s.setCategoryExcludeFromSuggestions);
  const setCategoryExcludeFromNewTasksBanner = useCategoryStore(s => s.setCategoryExcludeFromNewTasksBanner);
  const setCategoryBackfillDismissedFields = useCategoryStore(s => s.setCategoryBackfillDismissedFields);
  const projects = useProjectStore(useShallow(s => s.projects));
  const updateProject = useProjectStore(s => s.updateProject);
  const projectNamesById = useMemo(() => new Map(projects.map(p => [p.id, p.title])), [projects]);
  const people = usePersonStore(useShallow(s => s.people));
  const updatePerson = usePersonStore(s => s.updatePerson);
  const personGroups = usePersonGroupStore(useShallow(s => s.groups));
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const setVarietyOfKey = useGroceryStore(s => s.setVarietyOfKey);
  const unlinkItemSub = useGroceryStore(s => s.unlinkItemSub);
  const setItemBackfillDismissedFields = useGroceryStore(s => s.setItemBackfillDismissedFields);

  const [entityKind, setEntityKind] = useState<EntityKind>('task');
  const [active, setActive] = useState<ActiveField | null>(null);
  // Redo-from-scratch (task fields only): widens the queue to every live
  // task for the field instead of just the ones missing a value — see
  // confirmStartOver.
  const [fromScratch, setFromScratch] = useState(false);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  // Ids left behind as the queue advances, most-recent-last — what the
  // "Previous" header button steps back through. Recorded by recordVisited,
  // called from every apply/skip/dismiss handler before it acts, so a step
  // is captured whether it left the queue by being skipped/dismissed (added
  // to skippedIds) or by the item simply no longer matching the field's
  // "missing" test (a task/category/project apply).
  const [history, setHistory] = useState<string[]>([]);
  // Set by goBack: forces the queue to show this item instead of its own
  // front for one step, the same way it'd already look mid-way through a
  // from-scratch run showing an item that already has a value — nothing is
  // reverted, the item is just surfaced again to reconsider or re-answer.
  // Cleared as soon as any action is taken on it, so the queue's own front
  // takes back over.
  const [manualCurrentId, setManualCurrentId] = useState<string | null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  // What's been set this pass through a field's queue, for the compact review
  // shown once it empties — reset alongside history/skippedIds every time a
  // field is (re)chosen. See SessionEntry's doc comment.
  const [sessionLog, setSessionLog] = useState<SessionEntry[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customUnit, setCustomUnit] = useState<'min' | 'hr'>('min');
  const [nudgeDraft, setNudgeDraft] = useState<CadenceParts>({ count: null, unit: 'days' });
  const [reminderPickerOpen, setReminderPickerOpen] = useState(false);
  // The person pool's own drafts. Separate from nudgeDraft above even though
  // only one pool is ever active: a project's cadence and a person's are
  // different settings that happen to share a control, and one state holding
  // both invites a value from one entity being read as the other's.
  const [personCadenceDraft, setPersonCadenceDraft] = useState<CadenceParts>({ count: null, unit: 'days' });
  const [askAboutText, setAskAboutText] = useState('');
  const [birthdayPickerOpen, setBirthdayPickerOpen] = useState(false);
  // Whether the cadence about to be set should also go to the current
  // person's groupmates — off by default and reset per card, same as every
  // other per-card draft below: applying a value to somebody you weren't
  // asked about yet is a bigger assumption than applying it to the one
  // person the card is about, so this is opt-in every time rather than
  // remembered across cards.
  const [applyCadenceToGroup, setApplyCadenceToGroup] = useState(false);
  // The items pool's own picker, for the `substitutes` field — see the
  // module doc comment above for why this is a real sheet rather than an
  // inline control.
  const [subSheetOpen, setSubSheetOpen] = useState(false);
  // Snapshot of the current item's substitute ids, taken when the sheet
  // opens — see openSubstituteSheet/closeSubstituteSheet.
  const subsBeforeRef = useRef<Set<string>>(new Set());

  const taskCounts = useMemo(() => backfillFieldCounts(tasks, categories), [tasks, categories]);
  const categoryCounts = useMemo(() => categoryBackfillFieldCounts(categories), [categories]);
  const projectCounts = useMemo(() => projectBackfillFieldCounts(projects), [projects]);
  const personCounts = useMemo(() => personBackfillFieldCounts(people), [people]);
  const itemCounts = useMemo(() => itemBackfillFieldCounts(groceryItems, itemSubs), [groceryItems, itemSubs]);

  const taskQueue = useMemo(
    () => active?.kind === 'task'
      ? backfillCandidates(tasks, active.id, { fromScratch, categories }).filter(t => !skippedIds.has(t.id))
      : [],
    [tasks, active, fromScratch, skippedIds, categories]
  );
  const categoryQueue = useMemo(
    () => active?.kind === 'category' ? categoryBackfillCandidates(categories, active.id).filter(c => !skippedIds.has(c.id)) : [],
    [categories, active, skippedIds]
  );
  const projectQueue = useMemo(
    () => active?.kind === 'project' ? projectBackfillCandidates(projects, active.id).filter(p => !skippedIds.has(p.id)) : [],
    [projects, active, skippedIds]
  );
  const currentTask = active?.kind === 'task'
    ? (manualCurrentId ? tasks.find(t => t.id === manualCurrentId) ?? (taskQueue[0] ?? null) : (taskQueue[0] ?? null))
    : null;
  const currentCategory = active?.kind === 'category'
    ? (manualCurrentId ? categories.find(c => c.id === manualCurrentId) ?? (categoryQueue[0] ?? null) : (categoryQueue[0] ?? null))
    : null;
  const personQueue = useMemo(
    () => active?.kind === 'person' ? personBackfillCandidates(people, active.id).filter(p => !skippedIds.has(p.id)) : [],
    [people, active, skippedIds]
  );
  const itemQueue = useMemo(
    () => active?.kind === 'item' ? itemBackfillCandidates(groceryItems, active.id, itemSubs).filter(i => !skippedIds.has(i.id)) : [],
    [groceryItems, active, skippedIds, itemSubs]
  );
  const currentProject = active?.kind === 'project'
    ? (manualCurrentId ? projects.find(p => p.id === manualCurrentId) ?? (projectQueue[0] ?? null) : (projectQueue[0] ?? null))
    : null;
  const currentPerson = active?.kind === 'person'
    ? (manualCurrentId ? people.find(p => p.id === manualCurrentId) ?? (personQueue[0] ?? null) : (personQueue[0] ?? null))
    : null;
  const currentItem = active?.kind === 'item'
    ? (manualCurrentId ? groceryItems.find(i => i.id === manualCurrentId) ?? (itemQueue[0] ?? null) : (itemQueue[0] ?? null))
    : null;
  const queueLength = active?.kind === 'task' ? taskQueue.length
    : active?.kind === 'category' ? categoryQueue.length
    : active?.kind === 'project' ? projectQueue.length
    : active?.kind === 'person' ? personQueue.length
    : itemQueue.length;
  const currentId = currentTask?.id ?? currentCategory?.id ?? currentProject?.id ?? currentPerson?.id ?? currentItem?.id ?? null;

  /**
   * The cadence this person's own history suggests, or null when there is not
   * enough of it to say so honestly.
   *
   * Rule 5 in `docs/arch/people.md`, and the reason a wizard that asks you to
   * declare a frequency for a friend does not have to be a cold one: the number
   * comes from what actually happened rather than from an estimate of how much
   * you care. `PersonEditor` builds the identical offer from the identical two
   * calls — same discipline, same sample floor, same silence below it.
   */
  const observedCadence = useMemo(() => {
    if (!currentPerson) return null;
    const theirs = tasks.filter(t => t.personIds.includes(currentPerson.id));
    return observedCadenceDays(personHistory(theirs));
  }, [tasks, currentPerson?.id]);

  // The group the current person belongs to, if any — shown as plain context
  // on the card (a group is a fact about somebody, the same standing a
  // birthday or a note has) and consulted below for the cadence-only offer
  // and the "also set for the group" toggle. See docs/arch/people.md's
  // "Groups" section.
  const currentPersonGroup = useMemo(
    () => currentPerson?.groupId ? personGroups.find(g => g.id === currentPerson.groupId) ?? null : null,
    [currentPerson?.groupId, personGroups]
  );
  const currentGroupmates = useMemo(
    () => currentPerson ? groupmatesOf(currentPerson, people) : [],
    [currentPerson, people]
  );
  // Rule 5 pointed at a groupmate instead of at history: a couple who share a
  // reminder in practice usually want the same number, so a groupmate's own
  // cadence is offered the same way an observed one is, below.
  const groupmateOffer = useMemo(
    () => currentPerson ? groupmateCadenceOffer(currentPerson, people) : null,
    [currentPerson, people]
  );

  // The custom-estimate entry is per-card: once the card advances (a value
  // was applied, or the item was skipped), a half-typed number from the
  // previous card has no business surviving onto this one.
  useEffect(() => {
    setCustomOpen(false);
    setCustomText('');
    setCustomUnit('min');
    setReminderPickerOpen(false);
    setBirthdayPickerOpen(false);
    setApplyCadenceToGroup(false);
    setSubSheetOpen(false);
  }, [currentId]);

  // Whatever is already on file, so the field shows what's actually there
  // rather than an empty box — the same call the project cadence draft below
  // makes. In the normal queue both are at their default (that is what put the
  // person in it), but the Previous button can land on somebody already
  // answered, and handing them a blank field would read as their answer having
  // been lost.
  useEffect(() => {
    if (!currentPerson) return;
    setPersonCadenceDraft(toCadenceParts(currentPerson.cadenceDays));
    setAskAboutText(currentPerson.askAbout);
  }, [currentPerson?.id]);

  // Same default RemindMePicker's own caller (TaskEditor) opens with: 9am on
  // the date being scheduled against. Every card reaching this field has a
  // dueDate (see isFieldMissing's 'reminder' case) and no reminderTime yet,
  // so there's no existing value to prefer over it.
  const reminderDefaultDate = useMemo(() => {
    if (!currentTask?.dueDate) return null;
    const d = new Date(currentTask.dueDate);
    d.setHours(9, 0, 0, 0);
    return d;
  }, [currentTask?.dueDate]);

  // The cadence draft starts from whatever the project already has stored
  // (see isProjectFieldMissing's note on a seeded default) rather than always
  // resetting — same "show what's actually there" call the custom-estimate
  // reset above doesn't need to make, since a task missing an estimate has
  // nothing to show. Never falls back to a real interval: this pool exists to
  // opt projects *in*, and "Skip for now" and the dismiss below are how you
  // say no, so a cadence that can never fire has nothing to offer here.
  useEffect(() => {
    if (currentProject) {
      setNudgeDraft(toCadenceParts(
        currentProject.nudgeCadenceDays > 0 ? currentProject.nudgeCadenceDays : FALLBACK_CADENCE_DAYS,
      ));
    }
  }, [currentProject?.id]);

  const chooseTaskField = (id: BackfillFieldId) => {
    haptics.tap();
    animateLayout();
    setActive({ kind: 'task', id });
    setFromScratch(false);
    setSkippedIds(new Set());
    setHistory([]);
    setManualCurrentId(null);
    setSessionLog([]);
    setSessionTotal(backfillCandidates(tasks, id, { categories }).length);
  };

  const chooseCategoryField = (id: CategoryBackfillFieldId) => {
    haptics.tap();
    animateLayout();
    setActive({ kind: 'category', id });
    setSkippedIds(new Set());
    setHistory([]);
    setManualCurrentId(null);
    setSessionLog([]);
    setSessionTotal(categoryBackfillCandidates(categories, id).length);
  };

  const chooseProjectField = (id: ProjectBackfillFieldId) => {
    haptics.tap();
    animateLayout();
    setActive({ kind: 'project', id });
    setSkippedIds(new Set());
    setHistory([]);
    setManualCurrentId(null);
    setSessionLog([]);
    setSessionTotal(projectBackfillCandidates(projects, id).length);
  };

  const choosePersonField = (id: PersonBackfillFieldId) => {
    haptics.tap();
    animateLayout();
    setActive({ kind: 'person', id });
    setSkippedIds(new Set());
    setHistory([]);
    setManualCurrentId(null);
    setSessionLog([]);
    setSessionTotal(personBackfillCandidates(people, id).length);
  };

  const chooseItemField = (id: ItemBackfillFieldId) => {
    haptics.tap();
    animateLayout();
    setActive({ kind: 'item', id });
    setSkippedIds(new Set());
    setHistory([]);
    setManualCurrentId(null);
    setSessionLog([]);
    setSessionTotal(itemBackfillCandidates(groceryItems, id, itemSubs).length);
  };

  const backToFields = () => {
    haptics.tap();
    animateLayout();
    setActive(null);
    setFromScratch(false);
    setHistory([]);
    setManualCurrentId(null);
    setSessionLog([]);
  };

  // Widens the task queue to every live task for the field, including ones
  // that already have a value or were dismissed — nothing is cleared by this
  // alone, it just puts every task back in front of you to confirm or
  // replace one at a time (see apply/dismiss below for how each one leaves
  // the queue once you've actually reached it). Category and project fields
  // have no redo-from-scratch mode of their own yet.
  const startOver = () => {
    if (active?.kind !== 'task') return;
    haptics.tap();
    setFromScratch(true);
    setSkippedIds(new Set());
    setHistory([]);
    setManualCurrentId(null);
    setSessionLog([]);
    setSessionTotal(backfillCandidates(tasks, active.id, { fromScratch: true }).length);
  };

  const confirmStartOver = () => {
    if (active?.kind !== 'task') return;
    const label = BACKFILL_FIELDS.find(f => f.id === active.id)!.label.toLowerCase();
    Alert.alert(
      `Redo ${label} from scratch?`,
      `Walks through every task again, one at a time, including ones that already have a ${label} set. Each task keeps its current value until you set a new one for it, so nothing is cleared upfront.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start over', onPress: startOver },
      ]
    );
  };

  // Every action below advances the queue by adding the current item to
  // skippedIds, regardless of whether the underlying candidate filter would
  // also have dropped it (e.g. applying a value in the normal,
  // not-from-scratch task queue, or setting a category/project field) — in
  // fromScratch mode the task filter doesn't drop already-set tasks on its
  // own, so this is what actually moves past the current card there.
  const advance = (id: string) => setSkippedIds(prev => new Set(prev).add(id));

  // Called from every apply/skip/dismiss handler, before it acts, so the
  // item about to leave the front of the queue is captured regardless of
  // *how* it leaves (an explicit advance() vs. a category/project apply
  // that just mutates the store and lets the live filter drop it).
  const recordVisited = () => {
    if (currentId) setHistory(prev => [...prev, currentId]);
  };

  // Steps back to the item recorded just before the current one. It isn't
  // an undo: nothing already applied is reverted, the item is just forced
  // back to the front of the queue (see manualCurrentId) so it can be
  // reconsidered or answered again, same as reaching an already-set item
  // mid-way through a from-scratch run.
  const goBack = () => {
    if (history.length === 0) return;
    haptics.tap();
    animateLayout();
    const prevId = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setSkippedIds(prev => {
      if (!prev.has(prevId)) return prev;
      const next = new Set(prev);
      next.delete(prevId);
      return next;
    });
    setManualCurrentId(prevId);
  };

  // Records or replaces this item's row in the session review — replaces
  // rather than appends so re-answering an item (through Previous) updates
  // its one line instead of leaving the earlier answer sitting above it.
  const logSession = (entry: SessionEntry) => {
    setSessionLog(prev => [...prev.filter(e => e.itemId !== entry.itemId), entry]);
  };

  // The review step's own Undo: fires the entry's captured undo, drops its
  // row, and un-skips the item so the live queue's own "still missing?"
  // filter picks it back up at the front — same mechanism goBack leans on,
  // just without needing manualCurrentId since the item is genuinely missing
  // the field again rather than merely being revisited.
  const undoSessionEntry = (entry: SessionEntry) => {
    haptics.tap();
    animateLayout();
    entry.undo();
    setSessionLog(prev => prev.filter(e => e.itemId !== entry.itemId));
    setSkippedIds(prev => {
      if (!prev.has(entry.itemId)) return prev;
      const next = new Set(prev);
      next.delete(entry.itemId);
      return next;
    });
  };

  // A tap here commits immediately and advances the queue, with no per-row
  // confirm — registering the snapshot with setLastAction, same as
  // TaskEditor's save, is what makes a mis-tap recoverable via shake-to-undo
  // instead of a trip back into the task editor. Category and project fields
  // don't go through setLastAction/shake-to-undo yet — see applyCategory,
  // applySequential and applyNudge below.
  const apply = (patch: Partial<Task>, valueText: string) => {
    if (!currentTask || active?.kind !== 'task') return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const snapshot = { ...currentTask };
    const fieldLabel = BACKFILL_FIELDS.find(f => f.id === active.id)!.label;
    updateTask(currentTask.id, patch);
    // Choosing and eating a given meal take about the same time every day,
    // so a size given to "Choose breakfast" here is remembered under its
    // step id and carried onto every future "Choose breakfast" at creation
    // — see mealSlotStepEstimates. A recipe-backed "Make X" step already has
    // its own evidence and never reaches isFieldMissing in the first place.
    if (active.id === 'estimate' && patch.estimatedMinutes != null) {
      const stepId = activeMealSlotStepId(currentTask);
      if (stepId) useSettingsStore.getState().setMealSlotStepEstimate(stepId, patch.estimatedMinutes);
    }
    setLastAction({ label: `${fieldLabel} set`, undo: () => updateTask(snapshot.id, snapshot) });
    logSession({
      itemId: currentTask.id,
      title: displayTitleFor(currentTask),
      valueText,
      undo: () => updateTask(snapshot.id, snapshot),
    });
    advance(currentTask.id);
  };

  // The category store has no generic "patch a category" setter (see
  // useCategoryStore) — each field already owns a dedicated one, matching
  // how CategoryEditor itself writes them, so this just dispatches to it.
  const applyCategory = () => {
    if (!currentCategory || active?.kind !== 'category') return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const categoryName = currentCategory.name;
    const fieldId = active.id;
    switch (fieldId) {
      case 'vacation': setCategoryHideOnVacation(categoryName, true); break;
      case 'suggestions': setCategoryExcludeFromSuggestions(categoryName, true); break;
      case 'newBanner': setCategoryExcludeFromNewTasksBanner(categoryName, true); break;
    }
    // Always off before this fires (that's what made the category a
    // candidate), so the undo is just the same setter with the value flipped
    // back — no snapshot needed the way the project/person cases below take.
    logSession({
      itemId: currentCategory.id,
      title: categoryLabel(categoryName, getCategoryByName),
      valueText: CATEGORY_BACKFILL_FIELDS.find(f => f.id === fieldId)!.label,
      undo: () => {
        switch (fieldId) {
          case 'vacation': setCategoryHideOnVacation(categoryName, false); break;
          case 'suggestions': setCategoryExcludeFromSuggestions(categoryName, false); break;
          case 'newBanner': setCategoryExcludeFromNewTasksBanner(categoryName, false); break;
        }
      },
    });
  };

  const applySequential = () => {
    if (!currentProject) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const projectId = currentProject.id;
    updateProject(projectId, { sequential: true });
    logSession({
      itemId: projectId,
      title: currentProject.title,
      valueText: PROJECT_BACKFILL_FIELDS.find(f => f.id === 'sequential')!.label,
      undo: () => updateProject(projectId, { sequential: false }),
    });
  };

  // The cadence is a value, not a toggle — committing it needs the
  // in-progress stepper/unit draft, not just a fixed patch, so it's its own
  // handler rather than another case dispatched from a shared `apply`.
  const applyNudge = () => {
    if (!currentProject) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const projectId = currentProject.id;
    const before = { nudgeOptIn: currentProject.nudgeOptIn, nudgeCadenceDays: currentProject.nudgeCadenceDays };
    // Through nudgeFieldsFor rather than writing the two fields by hand: they
    // are one control now (see NudgeMode), and it refuses to store a scheduled
    // project with a cadence that can never fire. The label is read back off
    // what was actually committed, so the two can't disagree.
    const fields = nudgeFieldsFor('scheduled', fromCadenceParts(nudgeDraft));
    updateProject(projectId, fields);
    logSession({
      itemId: projectId,
      title: currentProject.title,
      valueText: describeCadence(fields.nudgeCadenceDays),
      undo: () => updateProject(projectId, before),
    });
  };

  // The three person handlers, one per field, for the reason applyNudge above
  // is its own: each commits a value held in a draft rather than a fixed patch.
  // None of them calls advance() — setting the value is what drops the person
  // out of the live queue, same as the category and project applies.
  const applyBirthday = (month: number, day: number, year: number | null) => {
    if (!currentPerson) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    setBirthdayPickerOpen(false);
    const personId = currentPerson.id;
    const before = {
      birthdayMonth: currentPerson.birthdayMonth,
      birthdayDay: currentPerson.birthdayDay,
      birthYear: currentPerson.birthYear,
    };
    updatePerson(personId, { birthdayMonth: month, birthdayDay: day, birthYear: year });
    const bDate = new Date(year ?? 2000, month - 1, day);
    logSession({
      itemId: personId,
      title: displayNameOf(currentPerson),
      valueText: year ? format(bDate, 'MMM d, yyyy') : format(bDate, 'MMM d'),
      undo: () => updatePerson(personId, before),
    });
  };

  // All three together, always: a year with no month and day is not a birthday.
  // Reachable only through the Previous button, on somebody whose birthday was
  // just entered and is being taken back off — the queue itself never offers
  // anybody who already has one.
  const clearBirthday = () => {
    if (!currentPerson) return;
    haptics.tap();
    setBirthdayPickerOpen(false);
    const personId = currentPerson.id;
    updatePerson(personId, { birthdayMonth: null, birthdayDay: null, birthYear: null });
    // Missing again, so any row this person already has in the review no
    // longer describes anything real — drop it rather than leave a stale
    // "set" line for a value that was just taken back off.
    setSessionLog(prev => prev.filter(e => e.itemId !== personId));
  };

  // Never is a real answer to "how long before a reminder", but it is the
  // field's own default rather than a value to commit — applying it would set
  // nothing and leave the card exactly where it is, so the button stands down
  // instead (see the disabled branch where it renders).
  const applyPersonCadence = () => {
    if (!currentPerson || personCadenceDraft.count === null) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const personId = currentPerson.id;
    const before = {
      cadenceDays: currentPerson.cadenceDays,
      nudgeOptIn: currentPerson.nudgeOptIn,
      cadenceSetAt: currentPerson.cadenceSetAt,
    };
    const days = fromCadenceParts(personCadenceDraft);
    updatePerson(personId, personCadencePatch(currentPerson, days));
    // "Also set for the group" — each groupmate gets the same off→on rule
    // personCadencePatch already applies to the person the card is about, so
    // a groupmate already opted in keeps their own anchor rather than having
    // it silently restamped.
    const includeGroup = applyCadenceToGroup && currentGroupmates.length > 0;
    const mateUndo: Array<{ id: string; before: Pick<Person, 'cadenceDays' | 'nudgeOptIn' | 'cadenceSetAt'> }> = [];
    if (includeGroup) {
      for (const mate of currentGroupmates) {
        mateUndo.push({
          id: mate.id,
          before: { cadenceDays: mate.cadenceDays, nudgeOptIn: mate.nudgeOptIn, cadenceSetAt: mate.cadenceSetAt },
        });
        updatePerson(mate.id, personCadencePatch(mate, days));
      }
    }
    logSession({
      itemId: personId,
      title: displayNameOf(currentPerson),
      valueText: includeGroup
        ? `${describeCadence(days)} (and ${currentGroupmates.map(displayNameOf).join(', ')})`
        : describeCadence(days),
      undo: () => {
        updatePerson(personId, before);
        mateUndo.forEach(m => updatePerson(m.id, m.before));
      },
    });
  };

  const applyAskAbout = () => {
    const text = askAboutText.trim();
    if (!currentPerson || !text) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const personId = currentPerson.id;
    const before = { askAbout: currentPerson.askAbout };
    updatePerson(personId, { askAbout: text });
    logSession({
      itemId: personId,
      title: displayNameOf(currentPerson),
      valueText: text,
      undo: () => updatePerson(personId, before),
    });
  };

  const skip = () => {
    if (!currentId) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    advance(currentId);
  };

  // Unlike skip, this is a written, permanent decision about the item —
  // "this one genuinely doesn't need a time estimate" — so it goes through
  // updateTask/the category and project stores rather than the session-only
  // skippedIds, and the item never comes back into this field's queue, in
  // this session or any other (or, for tasks, into a future from-scratch
  // run of it).
  const dismiss = () => {
    if (!active) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    if (active.kind === 'task') {
      if (!currentTask) return;
      const snapshot = { ...currentTask };
      const fieldLabel = BACKFILL_FIELDS.find(f => f.id === active.id)!.label;
      const wasMissing = isFieldMissing(currentTask, active.id, categories);
      updateTask(currentTask.id, dismissBackfillField(currentTask, active.id));
      setLastAction({ label: `${fieldLabel} left unset`, undo: () => updateTask(snapshot.id, snapshot) });
      logSession({
        itemId: currentTask.id,
        title: displayTitleFor(currentTask),
        valueText: wasMissing ? 'Left unset' : "Won't ask again",
        undo: () => updateTask(snapshot.id, snapshot),
      });
      advance(currentTask.id);
    } else if (active.kind === 'category') {
      if (!currentCategory) return;
      const categoryName = currentCategory.name;
      const beforeDismissed = currentCategory.backfillDismissedFields;
      setCategoryBackfillDismissedFields(
        categoryName,
        dismissCategoryBackfillField(currentCategory, active.id).backfillDismissedFields
      );
      logSession({
        itemId: currentCategory.id,
        title: categoryLabel(categoryName, getCategoryByName),
        valueText: "Won't ask again",
        undo: () => setCategoryBackfillDismissedFields(categoryName, beforeDismissed),
      });
    } else if (active.kind === 'project') {
      if (!currentProject) return;
      const projectId = currentProject.id;
      const before = { backfillDismissedFields: currentProject.backfillDismissedFields };
      updateProject(projectId, dismissProjectBackfillField(currentProject, active.id));
      logSession({
        itemId: projectId,
        title: currentProject.title,
        valueText: "Won't ask again",
        undo: () => updateProject(projectId, before),
      });
    } else if (active.kind === 'person') {
      if (!currentPerson) return;
      const personId = currentPerson.id;
      const before = { backfillDismissedFields: currentPerson.backfillDismissedFields };
      updatePerson(personId, dismissPersonBackfillField(currentPerson, active.id));
      logSession({
        itemId: personId,
        title: displayNameOf(currentPerson),
        valueText: "Won't ask again",
        undo: () => updatePerson(personId, before),
      });
    } else {
      if (!currentItem) return;
      const itemId = currentItem.id;
      const before = currentItem.backfillDismissedFields;
      setItemBackfillDismissedFields(itemId, dismissItemBackfillField(currentItem, active.id).backfillDismissedFields);
      logSession({
        itemId,
        title: currentItem.name,
        valueText: "Won't ask again",
        undo: () => setItemBackfillDismissedFields(itemId, before),
      });
    }
  };

  // The item pool's `variety` field — a value picker like category/project's
  // own applies, so no advance() call: setting a key drops the item from the
  // live queue on its own once it no longer satisfies isItemFieldMissing.
  const applyVariety = (key: string) => {
    if (!currentItem || active?.kind !== 'item') return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const itemId = currentItem.id;
    const before = currentItem.varietyOfKey;
    setVarietyOfKey(itemId, key);
    const label = groceryItems.find(i => i.nameKey === key)?.name ?? key;
    logSession({
      itemId,
      title: currentItem.name,
      valueText: label,
      undo: () => setVarietyOfKey(itemId, before),
    });
  };

  // Same validation GroceryItemSheet's own Variety of field runs before
  // minting a generic name nobody's typed before.
  const handleCreateVariety = (name: string): string | void => {
    if (!currentItem) return;
    const key = groceryNameKey(name);
    if (!key) return 'That isn’t a usable name.';
    if (key === currentItem.nameKey) return 'An item can’t be a variety of itself.';
    haptics.success();
    applyVariety(key);
  };

  // The item pool's `substitutes` field opens the real SubstituteSheet rather
  // than reproducing its search/link flow — see the module doc comment for
  // why. This just remembers what the item had before, so close can tell
  // whether anything was actually added.
  const openSubstituteSheet = () => {
    if (!currentItem) return;
    haptics.tap();
    subsBeforeRef.current = new Set(substitutesFor(currentItem.id, itemSubs, groceryItems).map(s => s.item.id));
    setSubSheetOpen(true);
  };

  const closeSubstituteSheet = () => {
    setSubSheetOpen(false);
    if (!currentItem || active?.kind !== 'item') return;
    const store = useGroceryStore.getState();
    const nowSubs = substitutesFor(currentItem.id, store.itemSubs, store.items);
    const added = nowSubs.filter(s => !subsBeforeRef.current.has(s.item.id));
    // Cancelled, or nothing new — leave the card exactly where it was rather
    // than logging a session entry for a value that didn't change.
    if (added.length === 0) return;
    recordVisited();
    setManualCurrentId(null);
    const itemId = currentItem.id;
    const addedIds = added.map(s => s.item.id);
    logSession({
      itemId,
      title: currentItem.name,
      valueText: describeSubstitutes(nowSubs)!,
      undo: () => addedIds.forEach(subId => unlinkItemSub(itemId, subId)),
    });
  };

  // iOS's number-pad keyboard has no return key (see NumberPadAccessory), so
  // this is reached by an explicit "Set" tap rather than onSubmitEditing.
  // Invalid/empty text is silently ignored rather than applied as null —
  // there's no draft to fall back to here the way there is in the editor.
  const applyCustomEstimate = () => {
    const n = parseFloat(customText);
    if (!Number.isFinite(n) || n <= 0) return;
    const minutes = Math.round(customUnit === 'hr' ? n * 60 : n);
    apply({ effort: minutesToEffort(minutes), estimatedMinutes: minutes }, formatDuration(minutes));
  };

  const applyReminder = (date: Date, kind: ReminderKind, offsetDays: number | null, anchor: 'wallClock' | 'fixed') => {
    apply(
      {
        reminderTime: date.toISOString(),
        reminderKind: kind,
        reminderOffsetDays: offsetDays,
        reminderTimeAnchor: anchor,
        reminderUtcOffsetMinutes: date.getTimezoneOffset(),
      },
      format(date, 'MMM d, h:mm a')
    );
    setReminderPickerOpen(false);
  };

  if (!active) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="Backfill" subtitle="Choose a field to fill in, one item at a time" />
        <View style={styles.entitySwitch}>
          <SegmentedControl label="Backfill scope" surface="page" value={entityKind} onChange={next => { animateLayout(); setEntityKind(next); }} options={ENTITY_KIND_SEGMENTS} />
        </View>
        {entityKind === 'task' && (
          <ScrollView contentContainerStyle={[styles.fieldList, { paddingBottom: tabBarHeight + spacing.lg }]}>
            {BACKFILL_FIELDS.map(field => {
              const count = taskCounts[field.id];
              return (
                <TouchableOpacity
                  key={field.id}
                  style={[styles.fieldRow, shadows.card]}
                  onPress={() => chooseTaskField(field.id)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`${field.label}, ${count === 0 ? 'every task already has one' : `${count} ${count === 1 ? 'task needs' : 'tasks need'} one`}`}
                >
                  <View style={styles.fieldIcon}>
                    <Ionicons name={FIELD_ICONS[field.id]} size={iconSize.md} color={colors.accent} />
                  </View>
                  <View style={styles.fieldBody}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldHint}>{field.hint}</Text>
                    <Text style={count === 0 ? styles.fieldCountDone : styles.fieldCount}>
                      {count === 0 ? 'Every task already has one' : `${count} ${count === 1 ? 'task needs' : 'tasks need'} one`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {entityKind === 'category' && (
          <ScrollView contentContainerStyle={[styles.fieldList, { paddingBottom: tabBarHeight + spacing.lg }]}>
            {CATEGORY_BACKFILL_FIELDS.map(field => {
              const count = categoryCounts[field.id];
              return (
                <TouchableOpacity
                  key={field.id}
                  style={[styles.fieldRow, shadows.card]}
                  onPress={() => chooseCategoryField(field.id)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`${field.label}, ${count === 0 ? 'every category already has this on' : `${count} ${count === 1 ? "category hasn't" : "categories haven't"} turned this on`}`}
                >
                  <View style={styles.fieldIcon}>
                    <Ionicons name={CATEGORY_FIELD_ICONS[field.id].row} size={iconSize.md} color={colors.accent} />
                  </View>
                  <View style={styles.fieldBody}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldHint}>{field.hint}</Text>
                    <Text style={count === 0 ? styles.fieldCountDone : styles.fieldCount}>
                      {count === 0 ? 'Every category already has this on' : `${count} ${count === 1 ? "category hasn't" : "categories haven't"} turned this on`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {entityKind === 'project' && (
          <ScrollView contentContainerStyle={[styles.fieldList, { paddingBottom: tabBarHeight + spacing.lg }]}>
            {PROJECT_BACKFILL_FIELDS.map(field => {
              const count = projectCounts[field.id];
              return (
                <TouchableOpacity
                  key={field.id}
                  style={[styles.fieldRow, shadows.card]}
                  onPress={() => chooseProjectField(field.id)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`${field.label}, ${count === 0 ? 'every project already has this set' : `${count} ${count === 1 ? "project hasn't" : "projects haven't"} set this`}`}
                >
                  <View style={styles.fieldIcon}>
                    <Ionicons name={PROJECT_FIELD_ICONS[field.id]} size={iconSize.md} color={colors.accent} />
                  </View>
                  <View style={styles.fieldBody}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldHint}>{field.hint}</Text>
                    <Text style={count === 0 ? styles.fieldCountDone : styles.fieldCount}>
                      {count === 0 ? 'Every project already has this set' : `${count} ${count === 1 ? "project hasn't" : "projects haven't"} set this`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {entityKind === 'person' && (
          people.some(p => !p.archived) ? (
            <ScrollView contentContainerStyle={[styles.fieldList, { paddingBottom: tabBarHeight + spacing.lg }]}>
              {PERSON_BACKFILL_FIELDS.map(field => {
                const count = personCounts[field.id];
                // Phrased about the field rather than about the people: "6
                // people need one" reads as a list of ways you're behind on
                // your friends, which is the tone docs/arch/people.md exists to
                // keep out. "Not set for 6 people" is the same fact about your
                // own data entry with nobody on the hook for it.
                const countLabel = count === 0
                  ? 'Set for everyone'
                  : `Not set for ${count} ${count === 1 ? 'person' : 'people'}`;
                return (
                  <TouchableOpacity
                    key={field.id}
                    style={[styles.fieldRow, shadows.card]}
                    onPress={() => choosePersonField(field.id)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${field.label}, ${countLabel.toLowerCase()}`}
                  >
                    <View style={styles.fieldIcon}>
                      <Ionicons name={PERSON_FIELD_ICONS[field.id]} size={iconSize.md} color={colors.accent} />
                    </View>
                    <View style={styles.fieldBody}>
                      <Text style={styles.fieldLabel}>{field.label}</Text>
                      <Text style={styles.fieldHint}>{field.hint}</Text>
                      <Text style={count === 0 ? styles.fieldCountDone : styles.fieldCount}>{countLabel}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            // Nothing at all until somebody has been added on the People
            // screen, rather than three field rows all reading "set for
            // everyone" over an empty list. Same rule the meal guest picker and
            // the template people question follow: an empty people surface is a
            // prompt to start filing your friends, which is the failure mode.
            <EmptyState
              icon="people-outline"
              title="Nobody added yet"
              subtitle="People you add on the People screen show up here, so you can fill in birthdays and reminders for them a few at a time."
              bottomOffset={tabBarHeight}
            />
          )
        )}
        {entityKind === 'item' && (
          groceryItems.length > 0 ? (
            <ScrollView contentContainerStyle={[styles.fieldList, { paddingBottom: tabBarHeight + spacing.lg }]}>
              {ITEM_BACKFILL_FIELDS.map(field => {
                const count = itemCounts[field.id];
                return (
                  <TouchableOpacity
                    key={field.id}
                    style={[styles.fieldRow, shadows.card]}
                    onPress={() => chooseItemField(field.id)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${field.label}, ${count === 0 ? 'every item already has one' : `${count} ${count === 1 ? 'item needs' : 'items need'} one`}`}
                  >
                    <View style={styles.fieldIcon}>
                      <Ionicons name={ITEM_FIELD_ICONS[field.id]} size={iconSize.md} color={colors.accent} />
                    </View>
                    <View style={styles.fieldBody}>
                      <Text style={styles.fieldLabel}>{field.label}</Text>
                      <Text style={styles.fieldHint}>{field.hint}</Text>
                      <Text style={count === 0 ? styles.fieldCountDone : styles.fieldCount}>
                        {count === 0 ? 'Every item already has one' : `${count} ${count === 1 ? 'item needs' : 'items need'} one`}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            // Nothing to walk until the catalog has a row in it — same call
            // the People pool makes above for the same reason.
            <EmptyState
              icon="basket-outline"
              title="Nothing in your catalog yet"
              subtitle="Items you add on the Groceries screen show up here, so you can fill in varieties and substitutes for them a few at a time."
              bottomOffset={tabBarHeight}
            />
          )
        )}
      </View>
    );
  }

  const doneCount = Math.max(0, sessionTotal - queueLength);

  if (active.kind === 'task') {
    const field = BACKFILL_FIELDS.find(f => f.id === active.id)!;
    // In a from-scratch run, "dismiss" often lands on a task that already has
    // a value — the current value is left exactly as it is, so "leave
    // unset" would misdescribe what the button does there.
    const dismissLabel = currentTask && isFieldMissing(currentTask, active.id, categories)
      ? `Leave ${field.label.toLowerCase()} unset`
      : `Don't ask again`;
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader
          title={field.label}
          onBack={backToFields}
          backAccessibilityLabel="Back to fields"
          actions={
            <TouchableOpacity
              onPress={confirmStartOver}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Redo ${field.label.toLowerCase()} from scratch`}
            >
              <Ionicons name="refresh-outline" size={iconSize.md} color={colors.textSecondary} />
            </TouchableOpacity>
          }
        />
        {sessionTotal > 0 && (
          <View style={styles.progressRow}>
            {history.length > 0 && (
              <TouchableOpacity
                onPress={goBack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Previous task"
              >
                <Ionicons name="play-skip-back-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <Text style={styles.progress}>{doneCount} of {sessionTotal} done</Text>
            {!!currentId && (
              <TouchableOpacity
                onPress={skip}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Skip this task for now"
              >
                <Ionicons name="play-skip-forward-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {currentTask ? (
          <ScrollView
            contentContainerStyle={[styles.reviewContent, { paddingBottom: tabBarHeight + spacing.lg }]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.itemCard, shadows.card]}>
              <Text style={styles.itemTitle} numberOfLines={3}>{displayTitleFor(currentTask)}</Text>
              {!!currentTask.notes.trim() && (
                <Text style={styles.itemNotes} numberOfLines={2}>{currentTask.notes.trim()}</Text>
              )}
              <TaskContextRow
                task={currentTask}
                categoryLabel={currentTask.category ? categoryLabel(currentTask.category, getCategoryByName) : null}
                projectTitle={currentTask.projectId ? projectNamesById.get(currentTask.projectId) ?? null : null}
                colors={colors}
                styles={styles}
              />
            </View>

            <FieldControl
              field={active.id}
              colors={colors}
              styles={styles}
              onEstimate={e => apply(estimatePatchFor(e), EFFORT_MINUTES[e] != null ? formatDuration(EFFORT_MINUTES[e]!) : EFFORT_LABELS[e])}
              onPriority={p => apply({ priority: p }, PRIORITY_OPTIONS.find(o => o.value === p)?.label ?? 'Priority set')}
              onCategory={name => apply({ category: name }, name ? categoryLabel(name, getCategoryByName) : 'No category')}
              onStreak={() => apply({ showStreak: true }, 'Streak shown')}
              onVacation={() => apply({ vacationPause: true }, 'Paused on vacation')}
              onReminder={() => { haptics.tap(); setReminderPickerOpen(true); }}
              onSuggestions={() => apply({ excludeFromSuggestions: true }, 'Excluded from suggestions')}
              customOpen={customOpen}
              customText={customText}
              customUnit={customUnit}
              onOpenCustom={() => setCustomOpen(true)}
              onCustomTextChange={setCustomText}
              onCustomUnitChange={setCustomUnit}
              onCustomSubmit={applyCustomEstimate}
            />

            <View style={styles.actionRow}>
              <PressableScale
                style={styles.skipButton}
                onPress={skip}
                accessibilityRole="button"
                accessibilityLabel="Skip this task for now"
              >
                <Text style={styles.skipText}>Skip for now</Text>
              </PressableScale>
              <PressableScale
                style={styles.skipButton}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel={`${dismissLabel} for this task`}
              >
                <Text style={styles.skipText}>{dismissLabel}</Text>
              </PressableScale>
            </View>
          </ScrollView>
        ) : sessionLog.length > 0 ? (
          <SessionReview
            entries={sessionLog}
            onUndo={undoSessionEntry}
            onDone={backToFields}
            tabBarHeight={tabBarHeight}
            colors={colors}
            styles={styles}
            itemWord="task"
            itemWordPlural="tasks"
          />
        ) : (
          <EmptyState
            icon="checkmark-circle-outline"
            title="All caught up"
            subtitle={`Every task has a ${field.label.toLowerCase()} now. Pick another field to keep going.`}
            actionLabel="Choose another field"
            onAction={backToFields}
            bottomOffset={tabBarHeight}
          />
        )}
        <RemindMePicker
          visible={reminderPickerOpen}
          value={reminderDefaultDate}
          kind="notification"
          dueDate={currentTask?.dueDate ? new Date(currentTask.dueDate) : null}
          offsetDays={null}
          onConfirm={applyReminder}
          onCancel={() => setReminderPickerOpen(false)}
        />
        <NumberPadAccessory />
      </View>
    );
  }

  if (active.kind === 'category') {
    const categoryField = CATEGORY_BACKFILL_FIELDS.find(f => f.id === active.id)!;
    const currentCategoryTaskCount = currentCategory
      ? tasks.filter(t => t.category === currentCategory.name && !t.completed && !t.archived).length
      : 0;

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader
          title={categoryField.label}
          onBack={backToFields}
          backAccessibilityLabel="Back to fields"
        />
        {sessionTotal > 0 && (
          <View style={styles.progressRow}>
            {history.length > 0 && (
              <TouchableOpacity
                onPress={goBack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Previous category"
              >
                <Ionicons name="play-skip-back-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <Text style={styles.progress}>{doneCount} of {sessionTotal} done</Text>
            {!!currentId && (
              <TouchableOpacity
                onPress={skip}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Skip this category for now"
              >
                <Ionicons name="play-skip-forward-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {currentCategory ? (
          <ScrollView
            contentContainerStyle={[styles.reviewContent, { paddingBottom: tabBarHeight + spacing.lg }]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.itemCard, shadows.card]}>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {currentCategory.emoji ? `${currentCategory.emoji} ${currentCategory.name}` : currentCategory.name}
              </Text>
              <View style={styles.metaRow}>
                <View style={styles.metaChip}>
                  <Ionicons name="checkbox-outline" size={iconSize.xs} color={colors.textSecondary} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {currentCategoryTaskCount} {currentCategoryTaskCount === 1 ? 'task' : 'tasks'}
                  </Text>
                </View>
              </View>
            </View>

            <PressableScale
              style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
              onPress={applyCategory}
              accessibilityRole="button"
              accessibilityLabel={categoryField.label}
            >
              <Ionicons name={CATEGORY_FIELD_ICONS[active.id].button} size={iconSize.md} color={colors.onAccent} />
              <Text style={styles.toggleButtonText}>{categoryField.label}</Text>
            </PressableScale>

            <View style={styles.actionRow}>
              <PressableScale
                style={styles.skipButton}
                onPress={skip}
                accessibilityRole="button"
                accessibilityLabel="Skip this category for now"
              >
                <Text style={styles.skipText}>Skip for now</Text>
              </PressableScale>
              <PressableScale
                style={styles.skipButton}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel={`Leave "${categoryField.label}" off for this category and don't ask again`}
              >
                <Text style={styles.skipText}>Don't ask again</Text>
              </PressableScale>
            </View>
          </ScrollView>
        ) : sessionLog.length > 0 ? (
          <SessionReview
            entries={sessionLog}
            onUndo={undoSessionEntry}
            onDone={backToFields}
            tabBarHeight={tabBarHeight}
            colors={colors}
            styles={styles}
            itemWord="category"
            itemWordPlural="categories"
          />
        ) : (
          <EmptyState
            icon="checkmark-circle-outline"
            title="All caught up"
            subtitle="Every category already has this set. Pick another field to keep going."
            actionLabel="Choose another field"
            onAction={backToFields}
            bottomOffset={tabBarHeight}
          />
        )}
      </View>
    );
  }

  if (active.kind === 'person') {
    const personField = PERSON_BACKFILL_FIELDS.find(f => f.id === active.id)!;
    const cadenceDays = fromCadenceParts(personCadenceDraft);
    const cadenceReady = personCadenceDraft.count !== null;
    const askAboutReady = askAboutText.trim().length > 0;

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader
          title={personField.shortLabel}
          onBack={backToFields}
          backAccessibilityLabel="Back to fields"
        />
        {sessionTotal > 0 && (
          <View style={styles.progressRow}>
            {history.length > 0 && (
              <TouchableOpacity
                onPress={goBack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Previous person"
              >
                <Ionicons name="play-skip-back-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <Text style={styles.progress}>{doneCount} of {sessionTotal} done</Text>
            {!!currentId && (
              <TouchableOpacity
                onPress={skip}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Skip this person for now"
              >
                <Ionicons name="play-skip-forward-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {currentPerson ? (
          <ScrollView
            contentContainerStyle={[styles.reviewContent, { paddingBottom: tabBarHeight + spacing.lg }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* The name, their group if they're in one, and whatever you wrote
                about them — deliberately no other meta chips the way the
                task, category and project cards carry. Every *number*
                available here is one docs/arch/people.md rules out under
                somebody's name: a task count reads as a tally against them,
                and a last-together date or a day count belongs on their own
                screen, which is the one place you go on purpose to be told.
                A group is a fact rather than a count, the same standing a
                birthday or a note already has, and it's what the cadence
                offer and toggle below refer to by name. */}
            <View style={[styles.itemCard, shadows.card]}>
              <Text style={styles.itemTitle} numberOfLines={2}>{displayNameOf(currentPerson)}</Text>
              {!!currentPersonGroup && (
                <View style={styles.metaRow}>
                  <View style={styles.metaChip}>
                    <Ionicons name="people-circle-outline" size={iconSize.xs} color={colors.textSecondary} />
                    <Text style={styles.metaText} numberOfLines={1}>{currentPersonGroup.name}</Text>
                  </View>
                </View>
              )}
              {!!currentPerson.notes.trim() && (
                <Text style={styles.itemNotes} numberOfLines={2}>{currentPerson.notes.trim()}</Text>
              )}
            </View>

            {active.id === 'birthday' && (
              <PressableScale
                style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
                onPress={() => { haptics.tap(); setBirthdayPickerOpen(true); }}
                accessibilityRole="button"
                accessibilityLabel={`Set a birthday for ${displayNameOf(currentPerson)}`}
              >
                <Ionicons name="gift" size={iconSize.md} color={colors.onAccent} />
                <Text style={styles.toggleButtonText}>Set birthday</Text>
              </PressableScale>
            )}

            {active.id === 'cadence' && (
              <View style={styles.cadenceRow}>
                <View style={styles.cadenceStepperRow}>
                  <CountStepper
                    value={personCadenceDraft.count}
                    onChange={next => setPersonCadenceDraft(prev => ({ ...prev, count: next }))}
                    min={1}
                    max={CADENCE_UNIT_MAX[personCadenceDraft.unit]}
                    allowNull
                    emptyLabel="Never"
                    label="Time before a reminder"
                    describeValue={n => (n === null ? 'No reminder' : describeCadence(fromCadenceParts({ ...personCadenceDraft, count: n })))}
                  />
                </View>
                <View style={styles.pillRow}>
                  {CADENCE_UNITS.map(unit => {
                    // Off has no unit — leaving all three unlit is what says so,
                    // same as the editor's own row.
                    const unitSelected = personCadenceDraft.count !== null && personCadenceDraft.unit === unit;
                    return (
                      <PressableScale
                        key={unit}
                        style={[styles.pill, unitSelected && styles.pillActive]}
                        onPress={() => { haptics.tap(); setPersonCadenceDraft(prev => withCadenceUnit(prev, unit)); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: unitSelected }}
                      >
                        <Text style={styles.pillText}>{cadenceUnitLabel(unit)}</Text>
                      </PressableScale>
                    );
                  })}
                </View>
                {/* Rule 5, and the whole reason this field is allowed to be a
                    wizard step at all: picking a frequency for somebody you
                    love is the coldest interaction in the feature, and a number
                    that came out of your own history is not that. It appears
                    only once there is enough history to say so honestly — see
                    observedCadenceDays. */}
                {observedCadence !== null && cadenceDays !== observedCadence && (
                  <TouchableOpacity
                    style={styles.offerRow}
                    onPress={() => { haptics.tap(); animateLayout(); setPersonCadenceDraft(toCadenceParts(observedCadence)); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Use every ${observedCadence} days`}
                  >
                    <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
                    <Text style={styles.offerText}>{describeObservedCadence(observedCadence)}. Use that?</Text>
                  </TouchableOpacity>
                )}
                {/* The other honest source rule 5 lets Backfill offer before
                    there's shared history to read: a groupmate's own cadence,
                    since a couple who already share a reminder in practice
                    usually want the same number. See groupmateCadenceOffer. */}
                {groupmateOffer !== null && cadenceDays !== groupmateOffer.days && (
                  <TouchableOpacity
                    style={styles.offerRow}
                    onPress={() => { haptics.tap(); animateLayout(); setPersonCadenceDraft(toCadenceParts(groupmateOffer.days)); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Use every ${describeCadence(groupmateOffer.days).toLowerCase()}, the same as ${displayNameOf(groupmateOffer.mate)}`}
                  >
                    <Ionicons name="people-circle-outline" size={14} color={colors.accent} />
                    <Text style={styles.offerText}>
                      {displayNameOf(groupmateOffer.mate)} is set for every {describeCadence(groupmateOffer.days).toLowerCase()}. Use that too?
                    </Text>
                  </TouchableOpacity>
                )}
                {/* Opt-in every time (see applyCadenceToGroup's own note):
                    setting a cadence for somebody you weren't asked about
                    yet is a bigger assumption than setting it for the one
                    person this card is about. */}
                {currentGroupmates.length > 0 && (
                  <TouchableOpacity
                    style={styles.groupToggleRow}
                    onPress={() => { haptics.tap(); setApplyCadenceToGroup(v => !v); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: applyCadenceToGroup }}
                    accessibilityLabel={`Also set this reminder for ${currentGroupmates.map(displayNameOf).join(' and ')}`}
                  >
                    <Ionicons
                      name={applyCadenceToGroup ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={applyCadenceToGroup ? colors.accent : colors.textSecondary}
                    />
                    <Text style={styles.groupToggleText}>
                      Also set for {currentGroupmates.map(displayNameOf).join(', ')}
                    </Text>
                  </TouchableOpacity>
                )}
                <PressableScale
                  style={[styles.toggleButton, { backgroundColor: colors.accentFill }, !cadenceReady && styles.toggleButtonIdle]}
                  onPress={applyPersonCadence}
                  disabled={!cadenceReady}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !cadenceReady }}
                  accessibilityLabel={cadenceReady
                    ? `Set a reminder for every ${describeCadence(cadenceDays).toLowerCase()}${applyCadenceToGroup && currentGroupmates.length > 0
                      ? `, also for ${currentGroupmates.map(displayNameOf).join(' and ')}`
                      : ''}`
                    : 'Pick how long before a reminder first'}
                >
                  <Ionicons name="notifications" size={iconSize.md} color={colors.onAccent} />
                  <Text style={styles.toggleButtonText}>Set reminder</Text>
                </PressableScale>
              </View>
            )}

            {active.id === 'askAbout' && (
              <View style={styles.askAboutRow}>
                <TextInput
                  style={styles.askAboutInput}
                  value={askAboutText}
                  onChangeText={setAskAboutText}
                  placeholder="e.g. the new job"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={applyAskAbout}
                  accessibilityLabel={`Something to ask ${displayNameOf(currentPerson)} about`}
                />
                <PressableScale
                  style={[styles.toggleButton, { backgroundColor: colors.accentFill }, !askAboutReady && styles.toggleButtonIdle]}
                  onPress={applyAskAbout}
                  disabled={!askAboutReady}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !askAboutReady }}
                  accessibilityLabel={`Save something to ask ${displayNameOf(currentPerson)} about`}
                >
                  <Ionicons name="chatbubble-ellipses" size={iconSize.md} color={colors.onAccent} />
                  <Text style={styles.toggleButtonText}>Save</Text>
                </PressableScale>
              </View>
            )}

            <View style={styles.actionRow}>
              <PressableScale
                style={styles.skipButton}
                onPress={skip}
                accessibilityRole="button"
                accessibilityLabel="Skip this person for now"
              >
                <Text style={styles.skipText}>Skip for now</Text>
              </PressableScale>
              <PressableScale
                style={styles.skipButton}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel={`Leave "${personField.shortLabel}" unset for this person and don't ask again`}
              >
                <Text style={styles.skipText}>Don't ask again</Text>
              </PressableScale>
            </View>
          </ScrollView>
        ) : sessionLog.length > 0 ? (
          <SessionReview
            entries={sessionLog}
            onUndo={undoSessionEntry}
            onDone={backToFields}
            tabBarHeight={tabBarHeight}
            colors={colors}
            styles={styles}
            itemWord="person"
            itemWordPlural="people"
          />
        ) : (
          <EmptyState
            icon="checkmark-circle-outline"
            title="All caught up"
            subtitle="Nothing left to fill in for this field. Pick another to keep going."
            actionLabel="Choose another field"
            onAction={backToFields}
            bottomOffset={tabBarHeight}
          />
        )}
        <BirthdayPicker
          visible={birthdayPickerOpen}
          month={currentPerson?.birthdayMonth ?? null}
          day={currentPerson?.birthdayDay ?? null}
          year={currentPerson?.birthYear ?? null}
          onConfirm={applyBirthday}
          onClear={clearBirthday}
          onCancel={() => setBirthdayPickerOpen(false)}
        />
      </View>
    );
  }

  if (active.kind === 'project') {
    const projectField = PROJECT_BACKFILL_FIELDS.find(f => f.id === active.id)!;
    const currentProjectTaskCount = currentProject
      ? tasks.filter(t => t.projectId === currentProject.id && !t.completed && !t.archived).length
      : 0;

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader
          title={projectField.label}
          onBack={backToFields}
          backAccessibilityLabel="Back to fields"
        />
        {sessionTotal > 0 && (
          <View style={styles.progressRow}>
            {history.length > 0 && (
              <TouchableOpacity
                onPress={goBack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Previous project"
              >
                <Ionicons name="play-skip-back-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <Text style={styles.progress}>{doneCount} of {sessionTotal} done</Text>
            {!!currentId && (
              <TouchableOpacity
                onPress={skip}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Skip this project for now"
              >
                <Ionicons name="play-skip-forward-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {currentProject ? (
          <ScrollView
            contentContainerStyle={[styles.reviewContent, { paddingBottom: tabBarHeight + spacing.lg }]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.itemCard, shadows.card]}>
              <Text style={styles.itemTitle} numberOfLines={2}>{currentProject.title}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaChip}>
                  <Ionicons name="checkbox-outline" size={iconSize.xs} color={colors.textSecondary} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {currentProjectTaskCount} {currentProjectTaskCount === 1 ? 'task' : 'tasks'}
                  </Text>
                </View>
              </View>
            </View>

            {active.id === 'sequential' ? (
              <PressableScale
                style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
                onPress={applySequential}
                accessibilityRole="button"
                accessibilityLabel={projectField.label}
              >
                <Ionicons name="list" size={iconSize.md} color={colors.onAccent} />
                <Text style={styles.toggleButtonText}>{projectField.label}</Text>
              </PressableScale>
            ) : (
              <View style={styles.cadenceRow}>
                <View style={styles.cadenceStepperRow}>
                  <CountStepper
                    value={nudgeDraft.count}
                    onChange={next => setNudgeDraft(prev => ({ ...prev, count: next }))}
                    min={1}
                    max={CADENCE_UNIT_MAX[nudgeDraft.unit]}
                    label="Review cadence"
                    describeValue={n => describeCadence(fromCadenceParts({ ...nudgeDraft, count: n }))}
                  />
                </View>
                <View style={styles.pillRow}>
                  {CADENCE_UNITS.map(unit => {
                    const unitSelected = nudgeDraft.unit === unit;
                    return (
                      <PressableScale
                        key={unit}
                        style={[styles.pill, unitSelected && styles.pillActive]}
                        onPress={() => { haptics.tap(); setNudgeDraft(prev => withCadenceUnit(prev, unit)); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: unitSelected }}
                      >
                        <Text style={styles.pillText}>{cadenceUnitLabel(unit)}</Text>
                      </PressableScale>
                    );
                  })}
                </View>
                <PressableScale
                  style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
                  onPress={applyNudge}
                  accessibilityRole="button"
                  accessibilityLabel={`Bring this project up every ${describeCadence(fromCadenceParts(nudgeDraft))}`}
                >
                  <Ionicons name="notifications" size={iconSize.md} color={colors.onAccent} />
                  <Text style={styles.toggleButtonText}>Bring it up this often</Text>
                </PressableScale>
              </View>
            )}

            <View style={styles.actionRow}>
              <PressableScale
                style={styles.skipButton}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel={`Leave "${projectField.label}" off for this project and don't ask again`}
              >
                <Text style={styles.skipText}>Don't ask again</Text>
              </PressableScale>
            </View>
          </ScrollView>
        ) : sessionLog.length > 0 ? (
          <SessionReview
            entries={sessionLog}
            onUndo={undoSessionEntry}
            onDone={backToFields}
            tabBarHeight={tabBarHeight}
            colors={colors}
            styles={styles}
            itemWord="project"
            itemWordPlural="projects"
          />
        ) : (
          <EmptyState
            icon="checkmark-circle-outline"
            title="All caught up"
            subtitle="Every project already has this set. Pick another field to keep going."
            actionLabel="Choose another field"
            onAction={backToFields}
            bottomOffset={tabBarHeight}
          />
        )}
      </View>
    );
  }

  const itemField = ITEM_BACKFILL_FIELDS.find(f => f.id === active.id)!;
  const currentItemSubs = currentItem ? substitutesFor(currentItem.id, itemSubs, groceryItems) : [];
  const varietyOptions = currentItem
    ? genericNameSuggestions(currentItem, groceryItems).map(({ key, label }) => ({
        key,
        label,
        selected: key === currentItem.varietyOfKey,
        onPress: () => applyVariety(key),
      }))
    : [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader
        title={itemField.label}
        onBack={backToFields}
        backAccessibilityLabel="Back to fields"
      />
      {sessionTotal > 0 && (
        <View style={styles.progressRow}>
          {history.length > 0 && (
            <TouchableOpacity
              onPress={goBack}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Previous item"
            >
              <Ionicons name="play-skip-back-outline" size={iconSize.sm} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          <Text style={styles.progress}>{doneCount} of {sessionTotal} done</Text>
          {!!currentId && (
            <TouchableOpacity
              onPress={skip}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Skip this item for now"
            >
              <Ionicons name="play-skip-forward-outline" size={iconSize.sm} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {currentItem ? (
        <ScrollView
          contentContainerStyle={[styles.reviewContent, { paddingBottom: tabBarHeight + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.itemCard, shadows.card]}>
            <Text style={styles.itemTitle} numberOfLines={2}>{currentItem.name}</Text>
            <View style={styles.metaRow}>
              <View style={styles.metaChip}>
                <Ionicons name="location-outline" size={iconSize.xs} color={colors.textSecondary} />
                <Text style={styles.metaText} numberOfLines={1}>{currentItem.aisle}</Text>
              </View>
            </View>
            {!!currentItem.note.trim() && (
              <Text style={styles.itemNotes} numberOfLines={2}>{currentItem.note.trim()}</Text>
            )}
          </View>

          {active.id === 'variety' ? (
            <PillGroup
              options={varietyOptions}
              noun="name"
              onCreate={handleCreateVariety}
              createMaxLength={GROCERY_NAME_MAX_LENGTH}
              filterPlaceholder="Find or type a general name…"
            />
          ) : (
            <PressableScale
              style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
              onPress={openSubstituteSheet}
              accessibilityRole="button"
              accessibilityLabel={`Add a substitute for ${currentItem.name}`}
            >
              <Ionicons name="swap-horizontal" size={iconSize.md} color={colors.onAccent} />
              <Text style={styles.toggleButtonText}>
                {currentItemSubs.length > 0 ? 'Add another substitute' : 'Add substitute'}
              </Text>
            </PressableScale>
          )}

          <View style={styles.actionRow}>
            <PressableScale
              style={styles.skipButton}
              onPress={skip}
              accessibilityRole="button"
              accessibilityLabel="Skip this project for now"
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </PressableScale>
            <PressableScale
              style={styles.skipButton}
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel={`Leave "${itemField.label}" unset for this item and don't ask again`}
            >
              <Text style={styles.skipText}>Don't ask again</Text>
            </PressableScale>
          </View>
        </ScrollView>
      ) : sessionLog.length > 0 ? (
        <SessionReview
          entries={sessionLog}
          onUndo={undoSessionEntry}
          onDone={backToFields}
          tabBarHeight={tabBarHeight}
          colors={colors}
          styles={styles}
          itemWord="item"
          itemWordPlural="items"
        />
      ) : (
        <EmptyState
          icon="checkmark-circle-outline"
          title="All caught up"
          subtitle="Nothing left to fill in for this field. Pick another to keep going."
          actionLabel="Choose another field"
          onAction={backToFields}
          bottomOffset={tabBarHeight}
        />
      )}
      <SubstituteSheet
        visible={subSheetOpen}
        itemId={currentItem?.id ?? null}
        onClose={closeSubstituteSheet}
      />
    </View>
  );
}

function categoryLabel(
  category: string,
  getCategoryByName: (name: string) => { emoji?: string | null } | undefined | null,
): string {
  const emoji = getCategoryByName(category)?.emoji;
  return emoji ? `${emoji} ${category}` : category;
}

/**
 * The compact review shown once a field's queue empties, in place of the
 * plain "All caught up" empty state — what got set for what, one line per
 * item, with an Undo that hands the item straight back into the queue (see
 * `undoSessionEntry`).
 *
 * A session can easily run to dozens of items (walking every task missing an
 * estimate, say), so this is a `FlatList`, not a mapped `ScrollView` the way
 * the rest of the screen's one-item-at-a-time cards are — the summary header
 * and the "Choose another field" button are fixed rows around it rather than
 * scrolling with the list, which is why the whole thing takes `flex: 1`
 * instead of the `contentContainerStyle`-only padding those cards use.
 */
function SessionReview({
  entries, onUndo, onDone, tabBarHeight, colors, styles, itemWord, itemWordPlural,
}: {
  entries: SessionEntry[];
  onUndo: (entry: SessionEntry) => void;
  onDone: () => void;
  tabBarHeight: number;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  itemWord: string;
  itemWordPlural: string;
}) {
  return (
    <View style={styles.reviewWrap}>
      <View style={styles.reviewSummary}>
        <Ionicons name="checkmark-circle" size={iconSize.lg} color={colors.accent} />
        <Text style={styles.reviewSummaryTitle}>All caught up</Text>
        <Text style={styles.reviewSummarySubtitle}>
          {entries.length} {entries.length === 1 ? itemWord : itemWordPlural} set this session
        </Text>
      </View>
      <FlatList
        style={styles.reviewList}
        data={entries}
        keyExtractor={entry => entry.itemId}
        renderItem={({ item }) => (
          <View style={styles.reviewRow}>
            <View style={styles.reviewRowBody}>
              <Text style={styles.reviewRowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.reviewRowValue} numberOfLines={1}>{item.valueText}</Text>
            </View>
            <TouchableOpacity
              onPress={() => onUndo(item)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Undo "${item.valueText}" for ${item.title}`}
            >
              <Text style={styles.reviewUndoText}>Undo</Text>
            </TouchableOpacity>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.reviewSeparator} />}
      />
      <View style={[styles.reviewFooter, { paddingBottom: tabBarHeight + spacing.md }]}>
        <PressableScale
          style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Choose another field"
        >
          <Text style={styles.toggleButtonText}>Choose another field</Text>
        </PressableScale>
      </View>
    </View>
  );
}

/**
 * Same schedule/category/project meta chips `ArchivedRow` shows, because a
 * title alone is often not enough to place a task by — "Book activities" only
 * reads once you know it's part of the Iceland trip. Missing every one of
 * these is possible (a plain standalone task) and just means there's nothing
 * more to show; it's not a reason to invent context that isn't on the row.
 *
 * The due date is the one addition beyond ArchivedRow's own set, and it earns
 * its place here specifically: a generated meal task's title and chain step
 * are the same on every day it's unanswered ("Breakfast" / "Choose
 * breakfast"), so a run of them in the queue is otherwise indistinguishable —
 * tapping a value on one and landing on an identical-looking card for the
 * next day reads as the tap having done nothing.
 */
function TaskContextRow({
  task, categoryLabel, projectTitle, colors, styles,
}: {
  task: Task;
  categoryLabel: string | null;
  projectTitle: string | null;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const repeat = task.recurrenceType !== 'none' ? describeTaskRecurrence(task) : null;
  const due = task.dueDate ? format(new Date(task.dueDate), 'EEE, MMM d') : null;
  // Mid-chain, itemTitle above shows the active step (displayTitleFor) rather
  // than the task's own title — so without this, a step like "Gather laundry
  // (check for towels etc.)" gives no hint it's one part of a "Do laundry"
  // routine. Only shown once there's a step swapped in, same gate as
  // activeChainStepTitle itself.
  const chainName = activeChainStepTitle(task) ? task.title : null;
  if (!due && !repeat && !categoryLabel && !projectTitle && !chainName) return null;

  return (
    <View style={styles.metaRow}>
      {chainName && (
        <View style={styles.metaChip}>
          <Ionicons name="git-commit" size={iconSize.xs} color={colors.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>{chainName}</Text>
        </View>
      )}
      {due && (
        <View style={styles.metaChip}>
          <Ionicons name="calendar-outline" size={iconSize.xs} color={colors.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>{due}</Text>
        </View>
      )}
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
    </View>
  );
}

interface FieldControlProps {
  field: BackfillFieldId;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onEstimate: (effort: Effort) => void;
  onPriority: (priority: (typeof PRIORITY_SEGMENTS)[number]['value']) => void;
  onCategory: (name: string | null) => void;
  onStreak: () => void;
  onVacation: () => void;
  onReminder: () => void;
  onSuggestions: () => void;
  customOpen: boolean;
  customText: string;
  customUnit: 'min' | 'hr';
  onOpenCustom: () => void;
  onCustomTextChange: (text: string) => void;
  onCustomUnitChange: (unit: 'min' | 'hr') => void;
  onCustomSubmit: () => void;
}

function FieldControl({
  field, colors, styles, onEstimate, onPriority, onCategory, onStreak, onVacation, onReminder, onSuggestions,
  customOpen, customText, customUnit, onOpenCustom, onCustomTextChange, onCustomUnitChange, onCustomSubmit,
}: FieldControlProps) {
  if (field === 'estimate') {
    return (
      <View>
        <View style={styles.pillRow}>
          {ESTIMATE_OPTIONS.map(e => {
            const mins = EFFORT_MINUTES[e];
            return (
              <PressableScale
                key={e}
                style={styles.pill}
                onPress={() => onEstimate(e)}
                accessibilityRole="button"
                accessibilityLabel={`${EFFORT_LABELS[e]}${mins != null ? `, about ${formatDuration(mins)}` : ''}`}
              >
                <Text style={styles.pillText}>{EFFORT_LABELS[e]}</Text>
                {mins != null && <Text style={styles.pillHint}>{formatDuration(mins)}</Text>}
              </PressableScale>
            );
          })}
          <PressableScale
            style={[styles.pill, customOpen && styles.pillActive]}
            onPress={onOpenCustom}
            accessibilityRole="button"
            accessibilityLabel="Enter an exact time estimate"
          >
            <Text style={styles.pillText}>Custom</Text>
            <Text style={styles.pillHint}>exact</Text>
          </PressableScale>
        </View>
        {customOpen && (
          <View style={styles.customRow}>
            <TextInput
              style={styles.customInput}
              value={customText}
              onChangeText={onCustomTextChange}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
              autoFocus
            />
            <View style={styles.customUnitToggle}>
              <SegmentedControl
                label="Unit"
                value={customUnit}
                onChange={onCustomUnitChange}
                options={DURATION_UNIT_SEGMENTS}
              />
            </View>
            <PressableScale
              style={styles.customSetButton}
              onPress={onCustomSubmit}
              accessibilityRole="button"
              accessibilityLabel="Set this time estimate"
            >
              <Text style={styles.customSetText}>Set</Text>
            </PressableScale>
          </View>
        )}
      </View>
    );
  }

  if (field === 'priority') {
    return (
      <SegmentedControl
        label="Priority"
        value={0}
        onChange={onPriority}
        columns={2}
        options={PRIORITY_OPTIONS}
        surface="page"
      />
    );
  }

  if (field === 'category') {
    return (
      <View style={[styles.categoryCard, { backgroundColor: colors.bgSecondary }]}>
        <CategoryPickerList value={null} onSelect={onCategory} showNone={false} maxHeight={360} />
      </View>
    );
  }

  if (field === 'streak') {
    return (
      <PressableScale
        style={[styles.toggleButton, { backgroundColor: colors.orange }]}
        onPress={onStreak}
        accessibilityRole="button"
        accessibilityLabel="Show streak on row"
      >
        <Ionicons name="flame" size={iconSize.md} color={colors.onAccent} />
        <Text style={styles.toggleButtonText}>Show streak on row</Text>
      </PressableScale>
    );
  }

  if (field === 'vacation') {
    return (
      <PressableScale
        style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
        onPress={onVacation}
        accessibilityRole="button"
        accessibilityLabel="Turn on vacation pause"
      >
        <Ionicons name="airplane" size={iconSize.md} color={colors.onAccent} />
        <Text style={styles.toggleButtonText}>Turn on vacation pause</Text>
      </PressableScale>
    );
  }

  if (field === 'reminder') {
    return (
      <PressableScale
        style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
        onPress={onReminder}
        accessibilityRole="button"
        accessibilityLabel="Set a reminder"
      >
        <Ionicons name="notifications" size={iconSize.md} color={colors.onAccent} />
        <Text style={styles.toggleButtonText}>Set a reminder</Text>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
      onPress={onSuggestions}
      accessibilityRole="button"
      accessibilityLabel="Skip in suggestions"
    >
      <Ionicons name="color-wand" size={iconSize.md} color={colors.onAccent} />
      <Text style={styles.toggleButtonText}>Skip in suggestions</Text>
    </PressableScale>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  entitySwitch: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },

  // Centered as one tight cluster — icon, text, icon — rather than the
  // icons pinned to the row's outer edges, which at screen width left them
  // nowhere near the count they act on.
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  fieldList: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  fieldIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fieldBody: { flex: 1, minWidth: 0, gap: 2 },
  fieldLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  fieldHint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: lineHeight.xs },
  fieldCount: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2 },
  fieldCountDone: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },

  progress: {
    color: colors.textTertiary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },

  reviewContent: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.lg },
  // Shared by both the task card and the category card on the per-item
  // review step — entity-agnostic layout, no task-specific meaning.
  itemCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    gap: spacing.xs,
  },
  itemTitle: { color: colors.text, fontSize: font.lg, lineHeight: lineHeight.lg, fontWeight: fontWeight.semibold },
  itemNotes: { color: colors.textSecondary, fontSize: font.sm, lineHeight: lineHeight.sm },
  // Wraps rather than squeezing, same call ArchivedRow's own meta row makes —
  // a task carrying a schedule, a category and a project has more than fits
  // on one line at 390pt.
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  metaText: { color: colors.textSecondary, fontSize: font.xs },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    minWidth: 68,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  pillText: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  pillHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  pillActive: { backgroundColor: colors.accentSubtle },

  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  customInput: {
    color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold,
    backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 72, textAlign: 'center',
  },
  // A track next to the number it labels, so it takes a width rather than
  // stretching across the row — same call TaskEditor's own unitToggle makes.
  customUnitToggle: { width: 104 },
  customSetButton: {
    paddingVertical: 8, paddingHorizontal: spacing.md,
    borderRadius: radius.sm, backgroundColor: colors.accentFill,
  },
  customSetText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.semibold },

  categoryCard: { borderRadius: radius.md, padding: spacing.sm },

  // The nudge-cadence control on the project field: a stepper, then its
  // unit pills, then the confirm button — stacked rather than crammed into
  // one row the way the estimate field's custom entry is, since a
  // CountStepper plus three pills plus a button doesn't fit one line at
  // 390pt.
  cadenceRow: { gap: spacing.md },
  cadenceStepperRow: { alignItems: 'center' },

  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  toggleButtonText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  // The two person fields whose value is typed or stepped can sit at a state
  // that isn't a value yet (Never, an empty box). The button stays where it is
  // and reads back what it's waiting for rather than disappearing, so the card
  // doesn't reflow as the field is filled in.
  toggleButtonIdle: { opacity: 0.4 },

  // The cadence offer built from this person's own history — see rule 5 in
  // docs/arch/people.md. Same treatment PersonEditor gives the identical offer,
  // so it reads as the same thing in both places.
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.md,
  },
  offerText: { flex: 1, color: colors.accent, fontSize: font.xs, lineHeight: lineHeight.xs },

  groupToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  groupToggleText: { flex: 1, color: colors.text, fontSize: font.sm },

  // Stacked rather than side by side: "e.g. the new job" plus a button doesn't
  // fit one line at 390pt, and the input is the field here rather than a
  // modifier on a row of pills the way the custom estimate is.
  askAboutRow: { gap: spacing.md },
  askAboutInput: {
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    // A height rather than a lineHeight — see the note in CLAUDE.md on what
    // lineHeight does to a TextInput's baseline on iOS.
    height: 48,
  },

  // The compact end-of-queue review — see SessionReview. flex: 1 the whole
  // way down (wrap and list both) is what lets the FlatList size itself
  // against the remaining screen height instead of collapsing to zero, the
  // same requirement any FlatList inside a plain flex column has.
  reviewWrap: { flex: 1 },
  reviewSummary: { alignItems: 'center', gap: 4, paddingVertical: spacing.lg },
  reviewSummaryTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  reviewSummarySubtitle: { color: colors.textSecondary, fontSize: font.sm },
  reviewList: { flex: 1 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  reviewRowBody: { flex: 1, minWidth: 0 },
  reviewRowTitle: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  reviewRowValue: { color: colors.textTertiary, fontSize: font.xs, marginTop: 1 },
  reviewUndoText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  reviewSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
  reviewFooter: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },

  actionRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
  skipButton: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
  },
  skipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
});
