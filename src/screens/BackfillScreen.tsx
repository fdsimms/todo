import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
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
import { InlineAction } from '../components/InlineAction';
import { SubstituteSheet } from '../components/SubstituteSheet';
import { NutritionPanelSheet } from '../components/NutritionPanelSheet';
import { NutritionSearchSheet } from '../components/NutritionSearchSheet';
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
  isFieldMissing, ESTIMATE_EFFORTS, type BackfillFieldId,
} from '../utils/fieldBackfill';
import {
  isSuggestibleBackfillField, suggestionTasks, suggestionExamples, type BackfillSuggestion,
} from '../utils/backfillSuggest';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import { describeAIError, suggestBackfillValues } from '../services/aiSuggestions';
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
  RECIPE_BACKFILL_FIELDS, recipeBackfillCandidates, recipeBackfillFieldCounts, dismissRecipeBackfillField,
  type RecipeBackfillFieldId,
} from '../utils/recipeBackfill';
import { useRecipeStore } from '../store/useRecipeStore';
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
import { shorterNameSuggestions } from '../utils/scanResolve';
import { describeFoodPanel } from '../utils/foodNutrition';
import {
  EFFORT_LABELS, GROCERY_NAME_MAX_LENGTH,
  type Effort, type FoodNutrition, type Person, type ReminderKind, type Task,
} from '../types';

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
  // Matches the generator's own Settings row and the ProjectEditor toggle: one
  // idea wearing one glyph, rather than a third for the same switch.
  weekendSource: 'sunny-outline',
};

// Neither person field with a value picker has a filled/outline pair to
// switch between, same as the project side — their "on" action is a birthday,
// a cadence or a sentence, not a tap.
const PERSON_FIELD_ICONS: Record<PersonBackfillFieldId, keyof typeof Ionicons.glyphMap> = {
  birthday: 'gift-outline',
  cadence: 'notifications-outline',
  askAbout: 'chatbubble-ellipses-outline',
  location: 'airplane-outline',
};

// No item field is a plain toggle — `variety` opens a name picker,
// `substitutes` opens the same sheet the grocery row's swap glyph does,
// `nutrition` opens either of the two the item sheet offers, and
// `scannedName` is a text field — so, like the project/person maps above,
// there's no filled/outline pair to switch between.
const ITEM_FIELD_ICONS: Record<ItemBackfillFieldId, keyof typeof Ionicons.glyphMap> = {
  scannedName: 'pricetag-outline',
  substitutes: 'swap-horizontal-outline',
  variety: 'layers-outline',
  nutrition: 'nutrition-outline',
};

// Every recipe field is a count somebody types, so there is no filled/outline
// pair here either — see the item map's note.
const RECIPE_FIELD_ICONS: Record<RecipeBackfillFieldId, keyof typeof Ionicons.glyphMap> = {
  servings: 'people-outline',
  cookTime: 'flame-outline',
  prepTime: 'cut-outline',
  cookedWeight: 'scale-outline',
};

/**
 * The stepper each recipe field puts up.
 *
 * A stepper rather than a row of preset chips for the reason `CountStepper`'s
 * own doc comment gives: every one of these is an open-ended number, and
 * presets have to pick a granularity and a ceiling for everybody. The two time
 * fields take `step: 5`, which is what that prop exists for — stepping a cook
 * time from 15 to 90 is fifteen presses at 5 and seventy-five at 1.
 */
const RECIPE_FIELD_STEPPERS: Record<
  RecipeBackfillFieldId,
  { min: number; max: number; step: number; format: (n: number) => string }
> = {
  // The same 1..99 clamp `setServings` applies, so the control can't offer a
  // number the store would quietly round back.
  servings: { min: 1, max: 99, step: 1, format: n => `${n}` },
  cookTime: { min: 5, max: 480, step: 5, format: formatDuration },
  prepTime: { min: 5, max: 240, step: 5, format: formatDuration },
  // 25g a press for the same reason the times take 5: a pot of stew is
  // measured in hundreds of grams, and stepping to 1,600 one gram at a time is
  // not a control. The floor is well above `COOKED_WEIGHT_MIN_G` because a
  // finished dish weighing less than 50g is not a thing this queue is for; the
  // store still clamps whatever arrives.
  cookedWeight: { min: 50, max: 5000, step: 25, format: n => `${n} g` },
};

type EntityKind = 'task' | 'category' | 'project' | 'person' | 'item' | 'recipe';
// Six is past what fits on one line at 390pt ("Categories" alone is most of a
// sixth of it), so this is a grid rather than a track — see SegmentedControl's
// `columns`. Three by two keeps every label at full width.
const ENTITY_KIND_COLUMNS = 3;
const ENTITY_KIND_SEGMENTS = [
  { value: 'task' as const, label: 'Tasks' },
  { value: 'category' as const, label: 'Categories' },
  { value: 'project' as const, label: 'Projects' },
  { value: 'person' as const, label: 'People' },
  { value: 'item' as const, label: 'Items' },
  { value: 'recipe' as const, label: 'Recipes' },
];

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
 * **None of the Items pool's fields is a toggle either**, same shape as the
 * project/person value-picker fields. `variety` opens the same generic-name
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
 * `nutrition` reuses that pool's other two real sheets the same way
 * (`NutritionSearchSheet` and `NutritionPanelSheet`, the pair the item sheet's
 * own Nutrition field offers), but both of those *return* a value, so
 * `applyNutrition` is an ordinary apply. The pair is deliberately kept rather
 * than reduced to the lookup: the lookup needs `productLookupEnabled` and a key
 * and can still not know the food, and a queue whose only answer is one that
 * may refuse is a queue you cannot finish.
 *
 * **The Recipes pool is three counts and one control**, so its card is a
 * `CountStepper` plus a commit button rather than a value picker. It commits on
 * the button and not on each step, which is the one thing to keep: a stepper
 * passes through every number on the way to the one you want, so writing on
 * change would file "serves 1" and drop the card out of the live queue before
 * you reached four. `servings` leads the three because it is the one that
 * unblocks anything — see `recipeBackfill.ts` for why, and for why the recipe's
 * other dozen nullable fields are deliberately not here.
 *
 * **`scannedName` is the one field in any pool that is already filled in.**
 * Everything else here queues on an absent value; this queues on
 * `GroceryItem.nameFromScan`, which says the row is wearing a barcode
 * database's words rather than anybody's choice — recorded at the scan, never
 * read out of the text (see that field, and `nameFromScanFor`). Two things
 * follow. Its "Don't ask again" is worded as keeping the name rather than
 * leaving a field unset, because there is nothing unset. And a rename that
 * collides with an existing row is offered as a merge instead of refused:
 * `renameItem` returns false there, and the collision is the *common* case in
 * a queue full of rows that all want to be called "Yogurt". See `applyRename`.
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
  | { kind: 'item'; id: ItemBackfillFieldId }
  | { kind: 'recipe'; id: RecipeBackfillFieldId };

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
  // A hidden tab (see AppNavigator), so the real bottom tab bar sits behind
  // this screen and its height has to be cleared like any other hidden-tab
  // screen — insets.bottom alone leaves the CTA sitting under the tab bar.
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
  const nonFoodAisles = useGroceryStore(useShallow(s => s.nonFoodAisles));
  const setVarietyOfKey = useGroceryStore(s => s.setVarietyOfKey);
  const unlinkItemSub = useGroceryStore(s => s.unlinkItemSub);
  const setItemBackfillDismissedFields = useGroceryStore(s => s.setItemBackfillDismissedFields);
  const renameItem = useGroceryStore(s => s.renameItem);
  const mergeItems = useGroceryStore(s => s.mergeItems);
  const setNameFromScan = useGroceryStore(s => s.setNameFromScan);
  const setItemNutrition = useGroceryStore(s => s.setItemNutrition);
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const setServings = useRecipeStore(s => s.setServings);
  const setEstimatedMinutes = useRecipeStore(s => s.setEstimatedMinutes);
  const setPrepMinutes = useRecipeStore(s => s.setPrepMinutes);
  const setCookedWeight = useRecipeStore(s => s.setCookedWeight);
  const setRecipeBackfillDismissedFields = useRecipeStore(s => s.setRecipeBackfillDismissedFields);

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
  const [locationText, setLocationText] = useState('');
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
  // The items pool's two `nutrition` pickers, which are the same pair
  // GroceryItemSheet's own Nutrition field offers: look the food up, or type
  // its label in. Both are real sheets for the reason the substitutes one is.
  const [nutritionSearchOpen, setNutritionSearchOpen] = useState(false);
  const [nutritionPanelOpen, setNutritionPanelOpen] = useState(false);
  // The `scannedName` field's draft. Seeded from the item's current name
  // rather than left blank, because most of the work here is deleting words
  // somebody else wrote rather than typing a name from nothing.
  const [renameText, setRenameText] = useState('');
  // The recipe pool's own draft — one number, since only one of its three
  // fields is ever on screen. Separate from the item drafts above for the
  // reason personCadenceDraft is separate from nudgeDraft: they are different
  // settings that happen to share a control.
  const [recipeCountDraft, setRecipeCountDraft] = useState<number | null>(null);

  // AI suggestions for the two task fields a title can actually answer — see
  // `backfillSuggest.ts` for which, and why the other five (and the whole
  // People pool) are deliberately not among them. Session-only state, held
  // here rather than on the task: a suggestion is something offered while you
  // are looking at the card, and a stale one written to the row would outlive
  // both the queue and any reason to trust it.
  const [suggestions, setSuggestions] = useState<Map<string, BackfillSuggestion>>(new Map());
  // Tasks a request has actually covered, which is *not* the key set above:
  // the model is told to leave out anything it can't place honestly, so a
  // task can be asked about and come back with nothing. Without this the card
  // would offer to fetch a suggestion it has already been refused, and asking
  // again would spend a request to be refused identically.
  const [suggestAskedIds, setSuggestAskedIds] = useState<Set<string>>(new Set());
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const clearSuggestions = () => {
    setSuggestions(new Map());
    setSuggestAskedIds(new Set());
    setSuggestLoading(false);
    setSuggestError(null);
  };

  // Read here rather than inside the service so the entry point can't exist
  // for a call that would only apologise — the pairing `useAiRoute`'s own doc
  // comment describes.
  const suggestRoute = useAiRoute('backfillSuggestions');

  const taskCounts = useMemo(() => backfillFieldCounts(tasks, categories), [tasks, categories]);
  const categoryCounts = useMemo(() => categoryBackfillFieldCounts(categories), [categories]);
  const projectCounts = useMemo(() => projectBackfillFieldCounts(projects), [projects]);
  const personCounts = useMemo(() => personBackfillFieldCounts(people), [people]);
  const itemCounts = useMemo(
    () => itemBackfillFieldCounts(groceryItems, itemSubs, nonFoodAisles),
    [groceryItems, itemSubs, nonFoodAisles]
  );
  const recipeCounts = useMemo(() => recipeBackfillFieldCounts(recipes), [recipes]);

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
    () => active?.kind === 'item'
      ? itemBackfillCandidates(groceryItems, active.id, itemSubs, nonFoodAisles).filter(i => !skippedIds.has(i.id))
      : [],
    [groceryItems, active, skippedIds, itemSubs, nonFoodAisles]
  );
  const recipeQueue = useMemo(
    () => active?.kind === 'recipe' ? recipeBackfillCandidates(recipes, active.id).filter(r => !skippedIds.has(r.id)) : [],
    [recipes, active, skippedIds]
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
  const currentRecipe = active?.kind === 'recipe'
    ? (manualCurrentId ? recipes.find(r => r.id === manualCurrentId) ?? (recipeQueue[0] ?? null) : (recipeQueue[0] ?? null))
    : null;
  // Every arm is tested, including the last: this used to fall through to the
  // item queue, which was right only for as long as items were the final kind
  // and would have read a stale length for the pool added after them.
  const queueLength = active?.kind === 'task' ? taskQueue.length
    : active?.kind === 'category' ? categoryQueue.length
    : active?.kind === 'project' ? projectQueue.length
    : active?.kind === 'person' ? personQueue.length
    : active?.kind === 'item' ? itemQueue.length
    : active?.kind === 'recipe' ? recipeQueue.length
    : 0;
  const currentId =
    currentTask?.id ?? currentCategory?.id ?? currentProject?.id ?? currentPerson?.id
    ?? currentItem?.id ?? currentRecipe?.id ?? null;

  // What "Apply all" would actually write: read off the *live* queue rather
  // than the suggestion map, so a task answered, skipped or dismissed since
  // the request drops out of the count on its own — the same reason the
  // queues themselves are recomputed every render rather than snapshotted.
  const suggestedQueue = useMemo(
    () => taskQueue.filter(t => suggestions.has(t.id)),
    [taskQueue, suggestions]
  );
  const canSuggest = active?.kind === 'task' && isSuggestibleBackfillField(active.id)
    && suggestRoute !== 'unavailable';
  const currentSuggestion = currentTask ? suggestions.get(currentTask.id) ?? null : null;

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
    setNutritionSearchOpen(false);
    setNutritionPanelOpen(false);
  }, [currentId]);

  // Whatever the recipe already says, so the Previous button doesn't hand back
  // a blank stepper for a value that was just set — the same call the person
  // drafts above make, and the reason they make it.
  useEffect(() => {
    if (!currentRecipe || active?.kind !== 'recipe') return;
    setRecipeCountDraft(
      active.id === 'servings' ? currentRecipe.servings
      : active.id === 'cookTime' ? currentRecipe.estimatedMinutes
      : currentRecipe.prepMinutes
    );
  }, [currentRecipe?.id, active?.kind === 'recipe' ? active.id : null]);

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
    setLocationText(currentPerson.location ?? '');
  }, [currentPerson?.id]);

  // Same reasoning one pool over: show what the row actually says. Keyed on
  // the item rather than on `currentId` so it re-seeds when the card changes
  // and not when some other pool's card does.
  useEffect(() => {
    if (!currentItem) return;
    setRenameText(currentItem.name);
  }, [currentItem?.id]);

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
    clearSuggestions();
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
    clearSuggestions();
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
    clearSuggestions();
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
    clearSuggestions();
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
    clearSuggestions();
    setSessionTotal(itemBackfillCandidates(groceryItems, id, itemSubs, nonFoodAisles).length);
  };

  const chooseRecipeField = (id: RecipeBackfillFieldId) => {
    haptics.tap();
    animateLayout();
    setActive({ kind: 'recipe', id });
    setSkippedIds(new Set());
    setHistory([]);
    setManualCurrentId(null);
    setSessionLog([]);
    clearSuggestions();
    setSessionTotal(recipeBackfillCandidates(recipes, id).length);
  };

  const backToFields = () => {
    haptics.tap();
    animateLayout();
    setActive(null);
    setFromScratch(false);
    setHistory([]);
    setManualCurrentId(null);
    setSessionLog([]);
    clearSuggestions();
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
    // A from-scratch run asks a different question of the same tasks ("is this
    // value still right?" rather than "what should it be?"), and the batch was
    // built to exclude tasks that already had one — so the answers that batch
    // came back with are about a queue this one isn't.
    clearSuggestions();
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
  // don't go through setLastAction/shake-to-undo yet — see applyCategory
  // and applyNudge below.
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

  // The two task fields the suggestion feature answers, factored out so the
  // ordinary pills and a suggested value write through exactly the same call —
  // a suggestion accepted has to be indistinguishable from the same value
  // tapped, in the row it writes and in the session-review line it leaves.
  const applyEstimate = (e: Effort) =>
    apply(estimatePatchFor(e), EFFORT_MINUTES[e] != null ? formatDuration(EFFORT_MINUTES[e]!) : EFFORT_LABELS[e]);
  const applyTaskCategory = (name: string | null) =>
    apply({ category: name }, name ? categoryLabel(name, getCategoryByName) : 'No category');

  const describeSuggestion = (s: BackfillSuggestion): string =>
    s.field === 'category'
      ? categoryLabel(s.category, getCategoryByName)
      : (EFFORT_MINUTES[s.effort] != null ? formatDuration(EFFORT_MINUTES[s.effort]!) : EFFORT_LABELS[s.effort]);

  const applySuggestion = (suggestion: BackfillSuggestion) => {
    if (suggestion.field === 'category') applyTaskCategory(suggestion.category);
    else applyEstimate(suggestion.effort);
  };

  /**
   * Asks for the whole visible queue at once rather than for the card on
   * screen — one request per sitting instead of one per card, which is what
   * keeps a suggestion from costing a second of waiting every time the queue
   * advances. `suggestionTasks` caps the batch; a queue longer than that is
   * answered a batch at a time, since the button comes back for any card the
   * request didn't reach.
   *
   * Results are merged rather than replacing, so a second batch doesn't
   * discard the first one's unanswered cards.
   */
  const runSuggest = async () => {
    if (active?.kind !== 'task' || !isSuggestibleBackfillField(active.id) || suggestLoading) return;
    const field = active.id;
    const batch = suggestionTasks(taskQueue, displayTitleFor);
    if (batch.length === 0) return;
    haptics.tap();
    setSuggestLoading(true);
    setSuggestError(null);
    try {
      const asking = new Set(batch.map(t => t.id));
      const examples = suggestionExamples(tasks, field, displayTitleFor, asking);
      const result = await suggestBackfillValues(field, batch, examples, categories.map(c => c.name));
      animateLayout();
      setSuggestions(prev => new Map([...prev, ...result]));
      setSuggestAskedIds(prev => new Set([...prev, ...asking]));
      if (result.size === 0) {
        // Not an error — the model was told to leave out anything it couldn't
        // place, and every task in a small batch being unplaceable is a real
        // answer. Said in the error slot because it is the only slot that says
        // anything, and saying nothing would read as a button that did nothing.
        setSuggestError('Nothing here could be suggested. Fill these in yourself.');
      } else {
        haptics.success();
      }
    } catch (e) {
      haptics.error();
      setSuggestError(describeAIError(e));
    } finally {
      setSuggestLoading(false);
    }
  };

  /**
   * Writes every pending suggestion in the queue at once.
   *
   * The one place this screen commits more than the card in front of you, so
   * it is the one place that asks first (see `confirmApplyAll`). Two recoveries
   * are left behind rather than one: a single `setLastAction` reverting the
   * whole batch, since a shake after a bulk action means "not that", and a
   * per-task row in the session review with its own Undo, for the far commoner
   * case where 28 of 30 were right.
   */
  const applyAllSuggestions = () => {
    if (active?.kind !== 'task') return;
    const batch = suggestedQueue;
    if (batch.length === 0) return;
    haptics.success();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const fieldLabel = BACKFILL_FIELDS.find(f => f.id === active.id)!.label;
    // One copy per task, shared by both recoveries below: the shake undo puts
    // the whole array back, each session-review row puts its own one back.
    const snapshots = batch.map(t => ({ ...t }));
    batch.forEach((task, i) => {
      const suggestion = suggestions.get(task.id)!;
      const snapshot = snapshots[i];
      let valueText: string;
      if (suggestion.field === 'category') {
        updateTask(task.id, { category: suggestion.category });
        valueText = categoryLabel(suggestion.category, getCategoryByName);
      } else {
        const patch = estimatePatchFor(suggestion.effort);
        updateTask(task.id, patch);
        // Same carry-forward the single-task apply does — see apply()'s note
        // on mealSlotStepEstimates.
        if (patch.estimatedMinutes != null) {
          const stepId = activeMealSlotStepId(task);
          if (stepId) useSettingsStore.getState().setMealSlotStepEstimate(stepId, patch.estimatedMinutes);
        }
        valueText = patch.estimatedMinutes != null
          ? formatDuration(patch.estimatedMinutes)
          : EFFORT_LABELS[suggestion.effort];
      }
      logSession({
        itemId: task.id,
        title: displayTitleFor(task),
        valueText,
        undo: () => updateTask(snapshot.id, snapshot),
      });
    });
    setLastAction({
      label: `${fieldLabel} set on ${batch.length} ${batch.length === 1 ? 'task' : 'tasks'}`,
      undo: () => { for (const snapshot of snapshots) updateTask(snapshot.id, snapshot); },
    });
    // One write rather than `advance` per task: in a from-scratch run the
    // candidate filter doesn't drop a task that now has a value, so this is
    // what actually moves the queue past all of them.
    setSkippedIds(prev => {
      const next = new Set(prev);
      for (const task of batch) next.add(task.id);
      return next;
    });
  };

  const confirmApplyAll = () => {
    if (active?.kind !== 'task') return;
    const count = suggestedQueue.length;
    if (count === 0) return;
    const label = BACKFILL_FIELDS.find(f => f.id === active.id)!.label.toLowerCase();
    Alert.alert(
      `Apply ${count} ${count === 1 ? 'suggestion' : 'suggestions'}?`,
      `Sets the suggested ${label} on ${count} ${count === 1 ? 'task' : 'tasks'} at once. Each one is listed with its own Undo when the queue finishes, and a shake takes the whole batch back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Apply all', onPress: applyAllSuggestions },
      ]
    );
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

  // A plain flag, so unlike applyNudge above there is no draft to commit and
  // the undo is the one field. Doesn't call advance() either: setting the value
  // is what drops the project out of the live queue.
  const applyWeekendSource = () => {
    if (!currentProject) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const projectId = currentProject.id;
    const before = { weekendSource: currentProject.weekendSource };
    updateProject(projectId, { weekendSource: true });
    logSession({
      itemId: projectId,
      title: currentProject.title,
      valueText: 'Suggested for a free weekend',
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

  const applyLocation = () => {
    const text = locationText.trim();
    if (!currentPerson || !text) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const personId = currentPerson.id;
    const before = { location: currentPerson.location };
    updatePerson(personId, { location: text });
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
    } else if (active.kind === 'item') {
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
    } else {
      if (!currentRecipe) return;
      const recipeId = currentRecipe.id;
      const before = currentRecipe.backfillDismissedFields;
      setRecipeBackfillDismissedFields(
        recipeId,
        dismissRecipeBackfillField(currentRecipe, active.id).backfillDismissedFields
      );
      logSession({
        itemId: recipeId,
        title: currentRecipe.name,
        valueText: "Won't ask again",
        undo: () => setRecipeBackfillDismissedFields(recipeId, before),
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

  // The item pool's `nutrition` field. Both pickers land here, so the session
  // entry and the undo are written once rather than per sheet. No advance()
  // for the same reason applyVariety has none: a row with figures no longer
  // satisfies isItemFieldMissing and leaves the queue by itself.
  const applyNutrition = (nutrition: FoodNutrition | null, description?: string) => {
    if (!currentItem || active?.kind !== 'item') return;
    // Null is a real answer from the panel sheet — every figure cleared — and
    // is written rather than dropped. Reachable only through the Previous
    // button, since a row with no figures is what put the item in this queue,
    // and the card simply stays put afterwards: the gap is still a gap.
    if (nutrition === null && currentItem.nutrition === null) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const itemId = currentItem.id;
    const title = currentItem.name;
    // Snapshotted rather than assumed null: the Previous button can land on an
    // item that already has a panel, and undo has to put that one back.
    const before = currentItem.nutrition;
    setItemNutrition(itemId, nutrition);
    logSession({
      itemId,
      title,
      // The database's own name for the food when the search supplied one,
      // since "Milk, whole, 3.25% milkfat" is what tells you which of the
      // twelve hits got picked. A typed panel has no such name, so it falls
      // back to the same one-line summary the item sheet's row shows.
      valueText: nutrition
        ? description ?? describeFoodPanel(nutrition) ?? 'Figures saved'
        : 'Figures cleared',
      undo: () => setItemNutrition(itemId, before),
    });
  };

  /**
   * The item pool's `scannedName` field: the row keeps its id and history and
   * only its words change.
   *
   * **A collision is offered as a merge rather than refused.** `renameItem`
   * returns false when the new key belongs to another row, and that case is
   * the common one here rather than an edge: three scanned yogurts all want to
   * be called "Yogurt", and the second and third would otherwise hit a dead
   * end in the middle of a queue built to clear exactly them. `mergeItems`
   * confirms first (its own doc comment argues for the double coverage) and
   * files its revert under the store's shake-to-undo, which is what the
   * session entry borrows so this card's Undo does the same thing every other
   * card's does.
   */
  const applyRename = (name: string) => {
    if (!currentItem || active?.kind !== 'item') return;
    const trimmed = name.trim();
    const key = groceryNameKey(trimmed);
    if (!trimmed || !key) return;
    const itemId = currentItem.id;
    const title = currentItem.name;
    const clash = groceryItems.find(i => i.id !== itemId && i.nameKey === key);
    if (clash) {
      Alert.alert(
        `Merge into "${clash.name}"?`,
        `You already have an item called "${clash.name}". Merging keeps that one and folds this row's history, boxes and stores into it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Merge',
            style: 'destructive',
            onPress: () => {
              haptics.success();
              animateLayout();
              recordVisited();
              setManualCurrentId(null);
              if (!mergeItems(itemId, clash.id)) return;
              // The revert mergeItems just filed for itself. Read straight
              // back out rather than rebuilt here: folding two rows together
              // touches products, store links, substitutes, aliases and
              // recipe keys, and a second, thinner undo written at this call
              // site would put back less than the merge took.
              const revert = useGroceryStore.getState().lastAction?.undo;
              logSession({
                itemId,
                title,
                valueText: `Merged into "${clash.name}"`,
                undo: () => revert?.(),
              });
            },
          },
        ]
      );
      return;
    }
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    if (!renameItem(itemId, trimmed)) return;
    logSession({
      itemId,
      title,
      valueText: trimmed,
      // Both halves, because renameItem clears nameFromScan on its way past
      // (that is what takes a row out of this queue) and an undone rename has
      // to land back in it. See setNameFromScan.
      undo: () => {
        renameItem(itemId, title);
        setNameFromScan(itemId, true);
      },
    });
  };

  /**
   * The recipe pool's three fields, which are one handler because they are one
   * control: a number is stepped and then committed, the same shape the
   * project cadence and the person cadence already use here.
   *
   * Committed on a button rather than on each step, unlike the value pickers
   * above. A stepper passes through every number between where it started and
   * where it is going, so writing on change would file "serves 1", "serves 2",
   * "serves 3" on the way to four and drop the card out of the queue at the
   * first of them.
   */
  const applyRecipeCount = () => {
    if (!currentRecipe || active?.kind !== 'recipe' || recipeCountDraft == null) return;
    haptics.tap();
    animateLayout();
    recordVisited();
    setManualCurrentId(null);
    const recipeId = currentRecipe.id;
    const title = currentRecipe.name;
    const value = recipeCountDraft;
    if (active.id === 'servings') {
      const before = currentRecipe.servings;
      // Restored as a pair: the max is only ever meaningful alongside the
      // count (see Recipe.servingsMax), and putting one back without the other
      // would leave a range half-undone.
      const beforeMax = currentRecipe.servingsMax;
      setServings(recipeId, value);
      logSession({
        itemId: recipeId,
        title,
        valueText: `Serves ${value}`,
        undo: () => setServings(recipeId, before, beforeMax),
      });
    } else if (active.id === 'cookTime') {
      const before = currentRecipe.estimatedMinutes;
      setEstimatedMinutes(recipeId, value);
      logSession({
        itemId: recipeId,
        title,
        valueText: formatDuration(value),
        undo: () => setEstimatedMinutes(recipeId, before),
      });
    } else if (active.id === 'prepTime') {
      const before = currentRecipe.prepMinutes;
      setPrepMinutes(recipeId, value);
      logSession({
        itemId: recipeId,
        title,
        valueText: formatDuration(value),
        undo: () => setPrepMinutes(recipeId, before),
      });
    } else {
      const before = currentRecipe.cookedWeightG;
      setCookedWeight(recipeId, value);
      logSession({
        itemId: recipeId,
        title,
        valueText: `${value} g`,
        undo: () => setCookedWeight(recipeId, before),
      });
    }
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
          <SegmentedControl
            label="What to fill in"
            surface="page"
            value={entityKind}
            onChange={next => { animateLayout(); setEntityKind(next); }}
            options={ENTITY_KIND_SEGMENTS}
            columns={ENTITY_KIND_COLUMNS}
          />
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
              subtitle="Items you add on the Groceries screen show up here, so you can fill in varieties, substitutes and nutrition for them a few at a time."
              bottomOffset={tabBarHeight}
            />
          )
        )}
        {entityKind === 'recipe' && (
          recipes.length > 0 ? (
            <ScrollView contentContainerStyle={[styles.fieldList, { paddingBottom: tabBarHeight + spacing.lg }]}>
              {RECIPE_BACKFILL_FIELDS.map(field => {
                const count = recipeCounts[field.id];
                return (
                  <TouchableOpacity
                    key={field.id}
                    style={[styles.fieldRow, shadows.card]}
                    onPress={() => chooseRecipeField(field.id)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${field.label}, ${count === 0 ? 'every recipe already has one' : `${count} ${count === 1 ? 'recipe needs' : 'recipes need'} one`}`}
                  >
                    <View style={styles.fieldIcon}>
                      <Ionicons name={RECIPE_FIELD_ICONS[field.id]} size={iconSize.md} color={colors.accent} />
                    </View>
                    <View style={styles.fieldBody}>
                      <Text style={styles.fieldLabel}>{field.label}</Text>
                      <Text style={styles.fieldHint}>{field.hint}</Text>
                      <Text style={count === 0 ? styles.fieldCountDone : styles.fieldCount}>
                        {count === 0 ? 'Every recipe already has one' : `${count} ${count === 1 ? 'recipe needs' : 'recipes need'} one`}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            // Same call the People and Items pools make above, for the same
            // reason: three rows all reading "every recipe already has one"
            // over an empty cookbook says the wrong thing.
            <EmptyState
              icon="restaurant-outline"
              title="No recipes yet"
              subtitle="Recipes you save show up here, so you can fill in how many they serve and how long they take a few at a time."
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

            {canSuggest && (
              <SuggestionBar
                suggestionText={currentSuggestion ? describeSuggestion(currentSuggestion) : null}
                asked={suggestAskedIds.has(currentTask.id)}
                loading={suggestLoading}
                error={suggestError}
                applyAllCount={suggestedQueue.length}
                fieldLabel={field.label.toLowerCase()}
                colors={colors}
                styles={styles}
                onSuggest={runSuggest}
                onAccept={() => currentSuggestion && applySuggestion(currentSuggestion)}
                onApplyAll={confirmApplyAll}
              />
            )}

            <FieldControl
              field={active.id}
              colors={colors}
              styles={styles}
              onEstimate={applyEstimate}
              onPriority={p => apply({ priority: p }, PRIORITY_OPTIONS.find(o => o.value === p)?.label ?? 'Priority set')}
              onCategory={applyTaskCategory}
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
    const locationReady = locationText.trim().length > 0;

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

            {active.id === 'location' && (
              <View style={styles.askAboutRow}>
                <TextInput
                  style={styles.askAboutInput}
                  value={locationText}
                  onChangeText={setLocationText}
                  placeholder="e.g. Austin, TX"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={applyLocation}
                  accessibilityLabel={`Where ${displayNameOf(currentPerson)} lives`}
                />
                <PressableScale
                  style={[styles.toggleButton, { backgroundColor: colors.accentFill }, !locationReady && styles.toggleButtonIdle]}
                  onPress={applyLocation}
                  disabled={!locationReady}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !locationReady }}
                  accessibilityLabel={`Save where ${displayNameOf(currentPerson)} lives`}
                >
                  <Ionicons name="airplane" size={iconSize.md} color={colors.onAccent} />
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

            {/* `nudge` commits a value, so it needs the stepper and its unit
                pills; `weekendSource` is a plain flag and gets the one button
                the task-side toggle fields use. Branching here rather than
                giving every project field a stepper it has no use for. */}
            {active.id === 'nudge' ? (
              <View style={styles.cadenceRow}>
                <View style={styles.cadenceStepperRow}>
                  <CountStepper
                    value={nudgeDraft.count}
                    onChange={next => setNudgeDraft(prev => ({ ...prev, count: next }))}
                    min={1}
                    max={CADENCE_UNIT_MAX[nudgeDraft.unit]}
                    label="Bring this project up every"
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
            ) : (
              <View style={styles.cadenceRow}>
                <PressableScale
                  style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
                  onPress={applyWeekendSource}
                  accessibilityRole="button"
                  accessibilityLabel={`Let the weekend task name "${currentProject.title}"`}
                >
                  <Ionicons name="sunny" size={iconSize.md} color={colors.onAccent} />
                  <Text style={styles.toggleButtonText}>Suggest it for a free weekend</Text>
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

  if (active.kind === 'recipe') {
    const recipeField = RECIPE_BACKFILL_FIELDS.find(f => f.id === active.id)!;
    const stepper = RECIPE_FIELD_STEPPERS[active.id];
    const recipeReady = recipeCountDraft != null;

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader
          title={recipeField.label}
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
                accessibilityLabel="Previous recipe"
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
                accessibilityLabel="Skip this recipe for now"
              >
                <Ionicons name="play-skip-forward-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {currentRecipe ? (
          <ScrollView
            contentContainerStyle={[styles.reviewContent, { paddingBottom: tabBarHeight + spacing.lg }]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.itemCard, shadows.card]}>
              <Text style={styles.itemTitle} numberOfLines={2}>{currentRecipe.name}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaChip}>
                  <Ionicons name="list-outline" size={iconSize.xs} color={colors.textSecondary} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {currentRecipe.ingredients.length}{' '}
                    {currentRecipe.ingredients.length === 1 ? 'ingredient' : 'ingredients'}
                  </Text>
                </View>
                {/* What the recipe says it makes, when it says anything. It is
                    free text and independent of the count (see
                    Recipe.recipeYield), so it is context for the answer rather
                    than the answer: "makes 1 loaf" is exactly what somebody
                    needs in front of them to say how many that serves. */}
                {!!currentRecipe.recipeYield && (
                  <View style={styles.metaChip}>
                    <Ionicons name="cube-outline" size={iconSize.xs} color={colors.textSecondary} />
                    <Text style={styles.metaText} numberOfLines={1}>{currentRecipe.recipeYield}</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.stepperField}>
              <CountStepper
                value={recipeCountDraft}
                onChange={setRecipeCountDraft}
                min={stepper.min}
                max={stepper.max}
                step={stepper.step}
                allowNull
                format={stepper.format}
                emptyLabel="Not set"
                label={recipeField.label}
              />
              <PressableScale
                style={[
                  styles.toggleButton,
                  { backgroundColor: colors.accentFill },
                  !recipeReady && styles.toggleButtonIdle,
                ]}
                onPress={applyRecipeCount}
                disabled={!recipeReady}
                accessibilityRole="button"
                accessibilityLabel={`Set ${recipeField.label.toLowerCase()} for ${currentRecipe.name}`}
              >
                <Ionicons name="checkmark" size={iconSize.md} color={colors.onAccent} />
                <Text style={styles.toggleButtonText}>Set {recipeField.label.toLowerCase()}</Text>
              </PressableScale>
            </View>

            <View style={styles.actionRow}>
              <PressableScale
                style={styles.skipButton}
                onPress={skip}
                accessibilityRole="button"
                accessibilityLabel="Skip this recipe for now"
              >
                <Text style={styles.skipText}>Skip for now</Text>
              </PressableScale>
              <PressableScale
                style={styles.skipButton}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel={`Leave "${recipeField.label}" unset for this recipe and don't ask again`}
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
            itemWord="recipe"
            itemWordPlural="recipes"
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
  // Suffixes of the row's own name, one tap each — see shorterNameSuggestions
  // for why they can only ever be words already printed on the box.
  const renameOptions = currentItem
    ? shorterNameSuggestions(currentItem.name).map(label => ({
        key: label,
        label,
        selected: false,
        onPress: () => applyRename(label),
      }))
    : [];
  // Blank, or the name it already has: neither is an answer, so the button
  // that commits them is off rather than doing nothing when tapped.
  const renameReady =
    !!currentItem && !!renameText.trim() && renameText.trim() !== currentItem.name;

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

          {active.id === 'variety' && (
            <PillGroup
              options={varietyOptions}
              noun="name"
              onCreate={handleCreateVariety}
              createMaxLength={GROCERY_NAME_MAX_LENGTH}
              filterPlaceholder="Find or type a general name…"
            />
          )}

          {active.id === 'substitutes' && (
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

          {active.id === 'scannedName' && (
            <View style={styles.renameField}>
              {renameOptions.length > 0 && (
                <>
                  <Text style={styles.renameHint}>
                    Tap a shorter name, or edit the full one below.
                  </Text>
                  <PillGroup options={renameOptions} noun="name" />
                </>
              )}
              <View style={styles.askAboutRow}>
                <TextInput
                  style={styles.askAboutInput}
                  value={renameText}
                  onChangeText={text => setRenameText(text.slice(0, GROCERY_NAME_MAX_LENGTH))}
                  placeholder="e.g. Milk"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={() => applyRename(renameText)}
                  accessibilityLabel={`New name for ${currentItem.name}`}
                />
                <PressableScale
                  style={[
                    styles.toggleButton,
                    { backgroundColor: colors.accentFill },
                    !renameReady && styles.toggleButtonIdle,
                  ]}
                  onPress={() => applyRename(renameText)}
                  disabled={!renameReady}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${currentItem.name}`}
                >
                  <Ionicons name="pricetag" size={iconSize.md} color={colors.onAccent} />
                  <Text style={styles.toggleButtonText}>Rename</Text>
                </PressableScale>
              </View>
            </View>
          )}

          {active.id === 'nutrition' && (
            <View style={styles.nutritionField}>
              <Text style={styles.renameHint}>
                Look the food up, or copy the figures off the packet. Either way you
                confirm what gets saved.
              </Text>
              <PressableScale
                style={[styles.toggleButton, { backgroundColor: colors.accentFill }]}
                onPress={() => { haptics.tap(); setNutritionSearchOpen(true); }}
                accessibilityRole="button"
                accessibilityLabel={`Find ${currentItem.name} in the food database`}
              >
                <Ionicons name="search" size={iconSize.md} color={colors.onAccent} />
                <Text style={styles.toggleButtonText}>Find this food</Text>
              </PressableScale>
              {/* The quieter half of the pair, and neutral rather than a dimmed
                  accent: two accent buttons stacked read as one control drawn
                  twice, and typing a label is the answer whenever the lookup
                  can't be asked (no key, no network) or doesn't know the food. */}
              <PressableScale
                style={styles.neutralButton}
                onPress={() => { haptics.tap(); setNutritionPanelOpen(true); }}
                accessibilityRole="button"
                accessibilityLabel={`Type in a nutrition label for ${currentItem.name}`}
              >
                <Ionicons name="create-outline" size={iconSize.md} color={colors.text} />
                <Text style={styles.neutralButtonText}>Type in a label</Text>
              </PressableScale>
            </View>
          )}

          <View style={styles.actionRow}>
            <PressableScale
              style={styles.skipButton}
              onPress={skip}
              accessibilityRole="button"
              accessibilityLabel="Skip this item for now"
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </PressableScale>
            <PressableScale
              style={styles.skipButton}
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel={
                // `scannedName` is the one field here that already has a value,
                // so "leave it unset" would describe the wrong thing.
                active.id === 'scannedName'
                  ? `Keep the name "${currentItem.name}" and don't ask again`
                  : `Leave "${itemField.label}" unset for this item and don't ask again`
              }
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
      <NutritionSearchSheet
        visible={nutritionSearchOpen}
        itemName={currentItem?.name ?? ''}
        onClose={() => setNutritionSearchOpen(false)}
        onPick={(nutrition, description) => applyNutrition(nutrition, description)}
      />
      <NutritionPanelSheet
        visible={nutritionPanelOpen}
        foodName={currentItem?.name ?? ''}
        nutrition={currentItem?.nutrition ?? null}
        onClose={() => setNutritionPanelOpen(false)}
        onSave={nutrition => applyNutrition(nutrition)}
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
          {ESTIMATE_EFFORTS.map(e => {
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

/**
 * The AI half of a task card: ask for suggestions, accept the one for this
 * task, or write the whole queue's at once.
 *
 * Sits above `FieldControl` rather than inside it, and offers the value as its
 * own control rather than pre-selecting a pill, because those are two different
 * claims. A highlighted pill would say "this is the value" — `CategoryPickerList`'s
 * `value` tick means exactly that — when what is true is "something proposed
 * this and nothing has been written". Keeping it separate is also what lets the
 * card say where the value came from, which a lit-up pill cannot.
 *
 * Four states, and the third is the one worth keeping: a request that reached
 * this task and declined to answer it says so and does not offer to ask again.
 * The model is told to leave out anything it cannot place honestly, so a second
 * identical request would spend a call to be refused identically.
 */
function SuggestionBar({
  suggestionText, asked, loading, error, applyAllCount, fieldLabel, colors, styles,
  onSuggest, onAccept, onApplyAll,
}: {
  suggestionText: string | null;
  asked: boolean;
  loading: boolean;
  error: string | null;
  applyAllCount: number;
  fieldLabel: string;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onSuggest: () => void;
  onAccept: () => void;
  onApplyAll: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.suggestStatusRow}>
        <ActivityIndicator size="small" color={colors.purple} />
        <Text style={styles.suggestNote}>Reading the tasks in this queue…</Text>
      </View>
    );
  }

  return (
    <View style={styles.suggestBar}>
      {suggestionText != null && (
        <>
          <Text style={styles.suggestCaption}>Suggested</Text>
          <PressableScale
            style={styles.suggestValue}
            onPress={onAccept}
            accessibilityRole="button"
            accessibilityLabel={`Set ${fieldLabel} to ${suggestionText}`}
          >
            <Ionicons name="sparkles" size={iconSize.sm} color={colors.purple} />
            {/* flex: 1 with only two fixed icons beside it, so a long category
                name keeps the row rather than being squeezed out of it. */}
            <Text style={styles.suggestValueText} numberOfLines={1}>{suggestionText}</Text>
            <Ionicons name="checkmark-circle" size={iconSize.md} color={colors.purple} />
          </PressableScale>
        </>
      )}
      {suggestionText == null && asked && !error && (
        <Text style={styles.suggestNote}>No suggestion for this one.</Text>
      )}
      {!!error && <Text style={styles.suggestError}>{error}</Text>}
      <View style={styles.suggestActions}>
        {(!asked || !!error) && (
          <InlineAction
            label={error ? 'Try again' : 'Suggest with AI'}
            icon={error ? 'refresh' : 'sparkles-outline'}
            tint={colors.purple}
            surface="page"
            onPress={onSuggest}
            accessibilityLabel={error
              ? 'Ask for suggestions again'
              : `Suggest a ${fieldLabel} for the tasks left in this queue`}
          />
        )}
        {/* Only past one, since at exactly one the chip above already is the
            whole batch and "Apply all 1" would be the same tap twice. */}
        {applyAllCount > 1 && (
          <InlineAction
            label={`Apply all ${applyAllCount}`}
            icon="checkmark-done-outline"
            variant="neutral"
            surface="page"
            onPress={onApplyAll}
            accessibilityLabel={`Set the suggested ${fieldLabel} on all ${applyAllCount} tasks at once`}
          />
        )}
      </View>
    </View>
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

  // toggleButton's neutral twin, for the second of a pair of actions — same
  // box, a surface instead of the accent fill. See `InlineAction`'s own
  // neutral variant, which makes the same distinction one component over.
  neutralButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    // One surface step up from the page, which is the same call `PillGroup`
    // makes for its own controls on a `page` surface. `bgTertiary` was the
    // first guess and is nearly invisible in light: #EFEFF4 on a #F2F2F7 page.
    backgroundColor: colors.bgSecondary,
  },
  neutralButtonText: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },

  // The three cards whose control is more than one button. The gap is
  // spacing.md between stacked blocks, per the design-system note on giving a
  // new element margin on both sides it needs.
  renameField: { gap: spacing.md },
  nutritionField: { gap: spacing.md },
  stepperField: { gap: spacing.md },
  renameHint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: lineHeight.sm },

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

  suggestBar: { gap: spacing.sm, alignItems: 'flex-start' },
  suggestCaption: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  suggestValue: {
    alignSelf: 'stretch',
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    // Built from the token with an alpha suffix, the way InlineAction and the
    // tag chips build theirs rather than adding a token per hue. Purple is the
    // app's AI colour (see InlineAction's `tint`), and it stays in the tint and
    // the icons: the value itself is `text`, because it is the thing being read.
    backgroundColor: colors.purple + '26',
  },
  suggestValueText: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  suggestActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  suggestStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestNote: { color: colors.textSecondary, fontSize: font.sm, lineHeight: lineHeight.sm },
  suggestError: { color: colors.red, fontSize: font.sm, lineHeight: lineHeight.sm },

  actionRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
  skipButton: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
  },
  skipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
});
