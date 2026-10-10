import React, { useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSettingsStore, type WeekStart } from '../../store/useSettingsStore';
import { useTaskStore } from '../../store/useTaskStore';
import { setGeneratorEnabled } from '../../store/generatorSwitch';
import { useCalendarStore } from '../../store/useCalendarStore';
import { HEALTH_CATEGORY, useCategoryStore } from '../../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { categoryLabel } from '../../utils/categoryLabel';
import { LIMIT_ROW_NAME, activeLimits } from '../../utils/nutritionTargets';
import { NUTRIENT_LABEL } from '../../utils/foodNutrition';
import { haptics } from '../../utils/haptics';
import {
  CALENDAR_READ_KINDS,
  generatorSwitchedOn,
  listedGeneratedKinds,
  type GeneratedKind,
  type GeneratedKindSpec,
} from '../../utils/generatedTasks';
import {
  MEAL_SLOTS,
  MEAL_SLOT_ICONS,
  MEAL_SLOT_LABELS,
  GROCERY_USE_UP_LEAD_DAYS_DEFAULT,
  GROCERY_USE_UP_LEAD_DAYS_MAX,
  GROCERY_USE_UP_LEAD_DAYS_MIN,
  MEAL_SHORTFALL_LEAD_DAYS_DEFAULT,
  MEAL_SHORTFALL_LEAD_DAYS_MAX,
  MEAL_SHORTFALL_LEAD_DAYS_MIN,
  USE_UP_TASK_CAP_MAX,
  USE_UP_TASK_CAP_MIN,
  WEEKEND_NUDGE_LEAD_DAYS_DEFAULT,
  WEEKEND_NUDGE_LEAD_DAYS_MAX,
  WEEKEND_NUDGE_LEAD_DAYS_MIN,
  WEEKEND_NUDGE_PLAN_THRESHOLD_DEFAULT,
  WEEKEND_NUDGE_PLAN_THRESHOLD_MAX,
  WEEKEND_NUDGE_PLAN_THRESHOLD_MIN,
  type TimeOfDay,
} from '../../types';
import {
  DEFAULT_WEIGH_IN_EVERY_DAYS,
  WEIGH_IN_EVERY_DAYS_MAX,
  WEIGH_IN_EVERY_DAYS_MIN,
} from '../../utils/weightTasks';
import {
  DEFAULT_SNACK_NUDGE_FROM_HOUR,
  DEFAULT_SNACK_NUDGE_SHARE_PERCENT,
  SNACK_NUDGE_FROM_HOUR_MAX,
  SNACK_NUDGE_FROM_HOUR_MIN,
  SNACK_NUDGE_SHARE_PERCENT_MAX,
  SNACK_NUDGE_SHARE_PERCENT_MIN,
  SNACK_NUDGE_SHARE_PERCENT_STEP,
  describeSnackNudgeHour,
} from '../../utils/snackNudgeTasks';
import { MEAL_PLAN_NUDGE_SLOTS } from '../../utils/mealPlanNudge';
import { dateToHHMM, hhmmToDate } from '../../utils/clockTime';
import { formatHHMM } from '../../utils/dateUtils';
import { useColors } from '../../theme/ThemeContext';
import { interaction, spacing, type Colors } from '../../theme';
import { CountStepper } from '../../components/CountStepper';
import {
  DEFAULT_MOOD_NUDGE_AFTER_DAYS, MOOD_NUDGE_AFTER_DAYS_MAX, MOOD_NUDGE_AFTER_DAYS_MIN,
} from '../../utils/moodTasks';
import {
  DEFAULT_BIRTHDAY_LEAD_DAYS,
  DEFAULT_BIRTHDAY_GIFT_LEAD_DAYS,
  MAX_BIRTHDAY_LEAD_DAYS,
} from '../../utils/birthdayTasks';
import { describeWeekendNudgeLead, describeWeekendNudgePlanThreshold } from '../../utils/weekendTasks';
import {
  TRAVEL_LEAD_MINUTES_DEFAULT,
  TRAVEL_LEAD_MINUTES_MAX,
  TRAVEL_LEAD_MINUTES_MIN,
  TRAVEL_LEAD_MINUTES_STEP,
  originCandidates,
  travelOriginFor,
  type TravelMode,
} from '../../utils/travelTasks';
import { readSavedPlaces, savedPlaceKey, type SavedPlace } from '../../utils/savedPlaces';
import { TRANSIT_LINES } from '../../utils/transitAlerts';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { TaskFieldDefaultsFields } from '../../components/TaskFieldDefaultsFields';
import { describeTaskFieldDefaults } from '../../utils/taskFieldDefaults';
import { SettingsSegments } from './SettingsSegments';
import { InlineTimePicker } from './InlineTimePicker';
import { requestLocationPermission } from '../../utils/weatherLocation';

type TravelOriginChoice = 'current' | 'place';
const TRAVEL_ORIGIN_OPTIONS: SegmentOption<TravelOriginChoice>[] = [
  { value: 'current', label: 'Where I am', icon: 'locate-outline' },
  { value: 'place', label: 'A saved place', icon: 'home-outline' },
];
const TRAVEL_MODE_OPTIONS: SegmentOption<TravelMode>[] = [
  { value: 'driving', label: 'Driving', icon: 'car-outline' },
  { value: 'transit', label: 'Transit', icon: 'subway-outline' },
  { value: 'walking', label: 'Walking', icon: 'walk-outline' },
];
import { WeatherRulesSheet } from '../../components/WeatherRulesSheet';
import { EventRulesSheet } from '../../components/EventRulesSheet';
import { ScreenTimeRulesSheet } from '../../components/ScreenTimeRulesSheet';
import { HealthRulesSheet } from '../../components/HealthRulesSheet';
import { PillGroup, type PillGroupOption } from '../../components/PillGroup';
import { type SegmentOption } from '../../components/SegmentedControl';
import { makeSettingsStyles } from './settingsStyles';
import { useSettingsFocus } from './SettingsFocus';
import { navigateToSettingsEntry } from '../../navigation/openSettings';
import { alertPermissionOff } from '../../utils/permissionAlert';

// Map of this file (one component holding most of it; `grep -n '// ===='` is
// the table of contents):
//   state          settings, categories, and the shared category pill grid
//   listing        which generators show, and the rule counts their rows quote
//   rows           each row's switch, what blocks it, its category and its hint
//   extras         the controls only one generator has (extrasFor)
//   render         the section: one row per listed generator, extras under it
// Above the component: the weekday and time-of-day choices. Below it: styles.

/**
 * Every task the app writes without being asked, in one section.
 *
 * These used to be four unrelated rows in four places — "Meals on Today",
 * "Use-up reminders" and "Leftovers" in Tasks & projects, and "Meal planning"
 * over in Notifications — each with its own header, its own footer paragraph
 * and its own copy of the same on/off + "file them under" pair. Nowhere did the
 * app answer the one question a person actually has about them, which is *what
 * writes tasks into my list*. It does now, in the order `GENERATED_KIND_LIST`
 * declares (#1524).
 *
 * **The list is the registry, but the controls are still JSX**, which is the
 * same line `settingsIndex.ts` draws and for the same reason: a config able to
 * express a toggle, a category grid, a day-count stepper, a weekday pill row
 * and an inline time picker would be harder to read than the rows it replaced.
 * So the registry supplies what a *listing* needs — which generators exist,
 * what each is called, what its two hint states say — and `extrasFor` below
 * hand-writes the handful of controls that are genuinely one generator's own.
 * A fifth generator gets a row here by being added to the registry, and needs
 * an `extrasFor` case only if it has a knob nobody else has.
 *
 * The nudge is in the list despite having no source row to opt out of, because
 * from the user's side it is exactly the same kind of thing: a task that
 * appears in the list because the app put it there. So is the project review
 * task, which is the first entry here that has nothing to do with the kitchen —
 * and which arrived needing no `extrasFor` case at all, which is the claim
 * above being cashed.
 */

// Full names for the hint sentence and screen reader labels; single letters on
// the segments themselves, the same compression the calendar's own header uses
// to fit all seven across 390pt. Moved here with the nudge's controls.
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// The calendar review task's own "Time of day" choice — pinned "Any time"
// alongside the same four segments a task's own Time of day field offers, in
// the same order. Pills, not a SegmentedControl, matching the app's rule for
// time-of-day segments generally, even though only one is ever chosen here.
const timeSegmentChoices: { value: TimeOfDay | null; label: string }[] = [
  { value: null, label: 'Any time' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
];

/** Weekday segments rotated to start at weekStartsOn, matching the calendar's header order. */
function describeLowDays(days: number): string {
  return days === 1 ? '1 low day' : `${days} low days in a row`;
}

function weekdayOptions(weekStartsOn: WeekStart): SegmentOption<number>[] {
  return Array.from({ length: 7 }, (_, i) => {
    const value = (weekStartsOn + i) % 7;
    return { value, label: WEEKDAY_LETTERS[value] };
  });
}

export function GeneratedTasksSection() {
  // ==== state ====
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const sectionStyles = useMemo(() => makeStyles(colors), [colors]);

  const s = useSettingsStore();
  const navigation = useNavigation();
  const categories = useCategoryStore(useShallow(state => state.categories));
  // Names for the per-calendar leave-by rows. Filled by the calendar read, so a
  // picked calendar it hasn't reached yet shows a plain fallback.
  const calendarsById = useCalendarStore(state => state.calendarsById);

  // Built here rather than handed down, now that this is a screen of its own
  // rather than a section inside Tasks & projects. Not a segmented control: the
  // categories are the user's own and there can be fifteen, which is
  // `PillGroup`'s job (it caps and filters) and not a track's. `None` is
  // `pinned` — the option meaning "no choice" is never buried behind "N more".
  const categoryOptions: { value: string | null; label: string }[] = useMemo(() => [
    { value: null, label: 'None' },
    ...categories.map(c => ({ value: c.name, label: categoryLabel(c.name, categories) })),
  ], [categories]);

  const categoryPills = (
    selected: string | null,
    onSelect: (value: string | null) => void,
    describe: (label: string) => string,
  ): PillGroupOption[] => categoryOptions.map(o => ({
    key: String(o.value),
    label: o.label,
    selected: o.value === selected,
    pinned: o.value === null,
    accessibilityLabel: describe(o.label),
    onPress: () => { haptics.tap(); onSelect(o.value); },
  }));

  // ==== listing ====
  // The kitchen's generators go with the area, the way every other kitchen row
  // does — but the other six stay, which is the whole point of the flag living
  // on the registry. This section used to sit inside Tasks & projects' own
  // `{kitchenEnabled && …}` block, so switching the area off took all twelve
  // rows away while six of the generators behind them kept writing tasks.
  const listed = useMemo(() => listedGeneratedKinds(s.kitchenEnabled), [s.kitchenEnabled]);
  // A generator's own controls fold away behind a chevron on its row, so the
  // page is a list of names rather than forty controls. Closed by default; a
  // visit that came from search opens them all, since the matched row may be
  // inside any one of them and has to be mounted to be scrolled to.
  const { focusedEntryId } = useSettingsFocus();
  const [openKinds, setOpenKinds] = useState<Set<GeneratedKind>>(() => new Set());
  const isOpen = (kind: GeneratedKind): boolean => focusedEntryId !== null || openKinds.has(kind);
  const toggleOpen = (kind: GeneratedKind): void => {
    haptics.tap();
    setOpenKinds(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  };
  // Turning the Today rows on files them under the Health reading's own
  // section when there is one, so the day's readings sit together, and
  // otherwise under a category made for it. Same default the nutrition
  // sheet's own toggle uses.
  const toggleLimitsOnToday = (): void => {
    haptics.tap();
    if (s.limitsTodayCategory !== null) { s.setLimitsTodayCategory(null); return; }
    const category = s.healthCategory ?? HEALTH_CATEGORY;
    useCategoryStore.getState().addCategory(category);
    s.setLimitsTodayCategory(category);
  };
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  // The saved places a leave-by trip can start from. A plain setting read on
  // focus, as SavedPlacesRows does: places are added from the new-event card.
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(readSavedPlaces);
  useFocusEffect(React.useCallback(() => { setSavedPlaces(readSavedPlaces()); }, []));
  const travelOrigin = travelOriginFor(s.travelOriginPlaceId, savedPlaces);
  const [pickerDate, setPickerDate] = useState<Date>(() => hhmmToDate(s.mealPlanNudgeTime));
  const [weatherRulesVisible, setWeatherRulesVisible] = useState(false);
  const activeWeatherRuleCount = useMemo(
    () => s.weatherRules.filter(r => r.enabled).length,
    [s.weatherRules],
  );
  const [eventRulesVisible, setEventRulesVisible] = useState(false);
  const activeEventRuleCount = useMemo(
    () => s.eventRules.filter(r => r.enabled).length,
    [s.eventRules],
  );

  const [screenTimeRulesVisible, setScreenTimeRulesVisible] = useState(false);
  const [healthRulesVisible, setHealthRulesVisible] = useState(false);
  const activeScreenTimeRuleCount = useMemo(
    () => s.screenTimeRules.filter(r => r.enabled).length,
    [s.screenTimeRules],
  );
  const activeHealthRuleCount = useMemo(
    () => s.healthRules.filter(r => r.enabled).length,
    [s.healthRules],
  );

  const weekdaySegmentOptions = useMemo(() => weekdayOptions(s.weekStartsOn), [s.weekStartsOn]);

  // ==== rows ====
  // Each generator's on/off answer and its category still live under their own
  // settings keys. Renaming them to a generic pair would be a migration over
  // preferences people have already set, for no gain a person can see — the
  // consolidation people asked for is the one in front of them, not in SQLite.
  // A switch per kind rather than a ternary chain ending in a default: with
  // four generators the last arm was the nudge's, and a fifth added to the
  // registry would silently have read and written the nudge's own setting
  // instead of its own. An exhaustive switch makes that a typecheck failure.
  // One answer, shared with useCategoryStore and the settings-search index —
  // see generatorSwitchedOn. It used to be a switch per kind here and a second
  // switch per kind there, which is how calendarReview came to be missing the
  // read gate in both while health had it in both.
  const enabledOf = (kind: GeneratedKind): boolean => generatorSwitchedOn(kind, s);

  /**
   * What a generator needs turned on before its own switch can mean anything,
   * or null for the rest, which need nothing.
   *
   * Five of them read a source the app has to be allowed into first (Apple
   * Health for two, the calendar for the three that read its window), and
   * `enabledOf` refuses to show any of them as on while that read is shut. That is
   * right (a row reading "on" over a closed read would be lying about itself)
   * and it left the switch untappable: `toggle` computes `!enabledOf(kind)`, so
   * the tap wrote true, `enabledOf` still answered false, and the switch sprang
   * back with nothing said. Naming the prerequisite is what turns a dead tap
   * into an answer.
   */
  // `entryId` is the prerequisite's own row in Settings, which the alert opens:
  // these generators live on Automations, so "turn it on in Settings, then
  // come back" was a trip to another part of the app with no way there.
  const blockedBy = (kind: GeneratedKind): { setting: string; entryId: string } | null => {
    if (kind === 'health' && !s.healthReadEnabled) {
      return { setting: 'Read Apple Health', entryId: 'healthRead' };
    }
    if (CALENDAR_READ_KINDS.includes(kind) && !s.calendarReadEnabled) {
      return { setting: 'Read my calendar', entryId: 'calendarRead' };
    }
    // The weigh-in needs both Health switches — see generatorSwitchedOn.
    if (kind === 'weighIn' && !s.healthReadEnabled) {
      return { setting: 'Read Apple Health', entryId: 'healthRead' };
    }
    if (kind === 'weighIn' && !s.healthWriteEnabled) {
      return { setting: 'Log to Health', entryId: 'healthWrite' };
    }
    return null;
  };

  const toggle = (kind: GeneratedKind): void => {
    const blocker = blockedBy(kind);
    if (blocker) {
      Alert.alert(
        `Turn on “${blocker.setting}” first`,
        `This needs “${blocker.setting}”, which is off in Settings.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => navigateToSettingsEntry(navigation, blocker.entryId) },
        ],
      );
      return;
    }
    setGeneratorEnabled(kind, !enabledOf(kind));
  };

  const categoryOf = (kind: GeneratedKind): string | null => {
    switch (kind) {
      case 'mealSlot':
      case 'mealCook': return s.mealCookTaskCategory;
      case 'groceryUseUp': return s.groceryUseUpTaskCategory;
      case 'leftoverUseUp': return s.leftoverUseUpTaskCategory;
      case 'mealPlanNudge': return s.mealPlanNudgeTaskCategory;
      case 'projectReview': return s.projectReviewTaskCategory;
      case 'pantryCheck': return s.pantryCheckTaskCategory;
      case 'pantryReview': return s.pantryReviewTaskCategory;
      case 'mealShortfall': return s.mealShortfallTaskCategory;
      case 'mealThaw': return s.mealThawTaskCategory;
      case 'mealLogNudge': return s.mealLogNudgeTaskCategory;
      case 'calendarReview': return s.calendarReviewTaskCategory;
      case 'birthday': return s.birthdayTaskCategory;
      case 'birthdayGift': return s.birthdayGiftTaskCategory;
      case 'supplyReorder': return s.supplyReorderTaskCategory;
      case 'reachOut': return s.reachOutTaskCategory;
      case 'waitingFollowUp': return s.waitingFollowUpTaskCategory;
      case 'weather': return s.weatherTaskCategory;
      case 'eventTask': return s.eventTaskCategory;
      case 'travel': return s.travelTaskCategory;
      case 'screenTime': return s.screenTimeTaskCategory;
      case 'health': return s.healthTaskCategory;
      case 'moodLog': return s.moodLogTaskCategory;
      case 'moodNudge': return s.moodNudgeTaskCategory;
      case 'journalLog': return s.journalLogTaskCategory;
      case 'dreamLog': return s.dreamLogTaskCategory;
      case 'weekendNudge': return s.weekendNudgeTaskCategory;
      case 'weighIn': return s.weighInTaskCategory;
      case 'waterShortfall': return s.waterShortfallTaskCategory;
      case 'snackNudge': return s.snackNudgeTaskCategory;
      case 'limitWarning': return s.limitWarningTaskCategory;
      case 'bookEvent': return s.bookEventTaskCategory;
    }
  };

  // No haptic here: `categoryPills` fires one in its own onPress, and two for
  // one tap reads as a stutter.
  const setCategory = (kind: GeneratedKind, category: string | null): void => {
    switch (kind) {
      case 'mealSlot':
      case 'mealCook': s.setMealCookTaskCategory(category); break;
      case 'groceryUseUp': s.setGroceryUseUpTaskCategory(category); break;
      case 'leftoverUseUp': s.setLeftoverUseUpTaskCategory(category); break;
      case 'mealPlanNudge': s.setMealPlanNudgeTaskCategory(category); break;
      case 'projectReview': s.setProjectReviewTaskCategory(category); break;
      case 'pantryCheck': s.setPantryCheckTaskCategory(category); break;
      case 'pantryReview': s.setPantryReviewTaskCategory(category); break;
      case 'mealShortfall': s.setMealShortfallTaskCategory(category); break;
      case 'mealThaw': s.setMealThawTaskCategory(category); break;
      case 'mealLogNudge': s.setMealLogNudgeTaskCategory(category); break;
      case 'birthday': s.setBirthdayTaskCategory(category); break;
      case 'birthdayGift': s.setBirthdayGiftTaskCategory(category); break;
      case 'calendarReview': s.setCalendarReviewTaskCategory(category); break;
      case 'reachOut': s.setReachOutTaskCategory(category); break;
      case 'waitingFollowUp': s.setWaitingFollowUpTaskCategory(category); break;
      case 'weather': s.setWeatherTaskCategory(category); break;
      case 'eventTask': s.setEventTaskCategory(category); break;
      case 'travel': s.setTravelTaskCategory(category); break;
      case 'screenTime': s.setScreenTimeTaskCategory(category); break;
      case 'health': s.setHealthTaskCategory(category); break;
      case 'moodLog': s.setMoodLogTaskCategory(category); break;
      case 'moodNudge': s.setMoodNudgeTaskCategory(category); break;
      case 'journalLog': s.setJournalLogTaskCategory(category); break;
      case 'dreamLog': s.setDreamLogTaskCategory(category); break;
      case 'weekendNudge': s.setWeekendNudgeTaskCategory(category); break;
      case 'weighIn': s.setWeighInTaskCategory(category); break;
      case 'waterShortfall': s.setWaterShortfallTaskCategory(category); break;
      case 'snackNudge': s.setSnackNudgeTaskCategory(category); break;
      case 'limitWarning': s.setLimitWarningTaskCategory(category); break;
      case 'bookEvent': s.setBookEventTaskCategory(category); break;
      case 'supplyReorder': s.setSupplyReorderTaskCategory(category); break;
      // Exhaustive, unlike the switches above it, which are only exhaustive
      // because they return a value. This one returns void, so a missing arm is
      // not a typecheck failure but a silently dead category picker — which is
      // exactly how screenTime shipped: its pills rendered (categorized: true)
      // and tapping one did nothing at all. A default arm assigning to `never`
      // turns the next omission into a compile error.
      default: {
        const exhaustive: never = kind;
        void exhaustive;
      }
    }
  };

  const confirmTime = () => {
    s.setMealPlanNudgeTime(dateToHHMM(pickerDate));
    setTimePickerOpen(false);
  };

  /**
   * The line under a generator's name, which says what it currently does rather
   * than what it is. The nudge's on-state names the day and time it fires,
   * because those are two more rows down and the answer is the point.
   */
  const hintFor = (spec: GeneratedKindSpec): string => {
    // Ahead of the off-hint, which describes what turning this on would do —
    // true of the other sixteen, and a promise the switch can't keep while its
    // prerequisite is off.
    const blocker = blockedBy(spec.kind);
    if (blocker) return `Needs “${blocker.setting}”, which is off`;
    if (!enabledOf(spec.kind)) return spec.offHint;
    if (spec.kind === 'mealPlanNudge') {
      return `A stack appears ${WEEKDAY_NAMES[s.mealPlanNudgeWeekday]} at ${formatHHMM(s.mealPlanNudgeTime)}, with a task for each day of that week to plan its meals`;
    }
    if (spec.kind === 'calendarReview' && s.calendarReviewTimeSegment) {
      return `Adds a task each day, held back until ${s.calendarReviewTimeSegment}, to review tomorrow’s events`;
    }
    if (spec.kind === 'moodLog' && s.moodLogTimeSegments.length > 0) {
      const segmentNames = s.moodLogTimeSegments.map(seg =>
        timeSegmentChoices.find(o => o.value === seg)?.label.toLowerCase() ?? seg
      );
      return s.moodLogTimeSegments.length === 1
        ? `Adds one task a day, held back until ${segmentNames[0]}, to log how you’re feeling`
        : `Adds a task at each of these times to log how you’re feeling: ${segmentNames.join(', ')}`;
    }
    if (spec.kind === 'journalLog' && s.journalLogTimeSegments.length > 0) {
      const segmentNames = s.journalLogTimeSegments.map(seg =>
        timeSegmentChoices.find(o => o.value === seg)?.label.toLowerCase() ?? seg
      );
      return s.journalLogTimeSegments.length === 1
        ? `Adds one task a day, held back until ${segmentNames[0]}, to write in your journal`
        : `Adds a task at each of these times to write in your journal: ${segmentNames.join(', ')}`;
    }
    return spec.onHint;
  };

  /**
   * The "Show the task" row and its pills, for a generator that holds its
   * single task back until one part of the day — single-select, unlike
   * `moodLogTimeSegmentsExtra` below, which is the same row and pills for a
   * generator whose check-in can fire more than once a day.
   *
   * It stays a local helper rather than a registry field for the reason the
   * header states: `extrasFor` is JSX precisely so the knobs one generator has
   * don't have to be expressible in config.
   */
  // ==== extras ====
  const timeSegmentExtra = (
    entryId: string,
    value: TimeOfDay | null,
    onChange: (segment: TimeOfDay | null) => void,
  ): React.ReactNode => (
    <>
      <View style={styles.sep} />
      <SettingsRow
        entryId={entryId}
        icon="time-outline"
        label="Show the task"
        hint="Held back until this part of the day arrives, like a task’s Time of day field."
        value={timeSegmentChoices.find(o => o.value === value)?.label ?? 'Any time'}
        tight
      />
      <View style={styles.pillGroupRow}>
        <PillGroup
          noun="time of day"
          options={timeSegmentChoices.map(o => ({
            key: String(o.value),
            label: o.label,
            selected: o.value === value,
            pinned: o.value === null,
            accessibilityLabel: `Show the task ${o.value === null ? 'any time of day' : `in the ${o.label.toLowerCase()}`}`,
            onPress: () => { haptics.tap(); onChange(o.value); },
          }))}
        />
      </View>
    </>
  );

  /**
   * The "Show the task" row for a check-in that can fire more than once a day
   * (the mood log and the journal). Multi-select, unlike `timeSegmentExtra`
   * above: a segment toggles independently rather than replacing whichever
   * was picked, and "Any time" clears the set back to the single any-time
   * task rather than being one more mutually-exclusive option.
   */
  const multiSegmentExtra = (
    entryId: string,
    selected: TimeOfDay[],
    onChange: (segments: TimeOfDay[]) => void,
    hint: string,
  ): React.ReactNode => {
    const summary = selected.length === 0
      ? 'Any time'
      : timeSegmentChoices
          .filter((o): o is { value: TimeOfDay; label: string } => o.value !== null && selected.includes(o.value))
          .map(o => o.label)
          .join(', ');
    return (
      <>
        <View style={styles.sep} />
        <SettingsRow
          entryId={entryId}
          icon="time-outline"
          label="Show the task"
          hint={hint}
          value={summary}
          tight
        />
        <View style={styles.pillGroupRow}>
          <PillGroup
            noun="time of day"
            options={timeSegmentChoices.map(o => ({
              key: String(o.value),
              label: o.label,
              selected: o.value === null ? selected.length === 0 : selected.includes(o.value),
              pinned: o.value === null,
              accessibilityLabel: o.value === null
                ? 'Show the task any time of day'
                : `Show the task in the ${o.label.toLowerCase()}`,
              onPress: () => {
                haptics.tap();
                if (o.value === null) { onChange([]); return; }
                const value = o.value;
                onChange(
                  selected.includes(value) ? selected.filter(seg => seg !== value) : [...selected, value]
                );
              },
            }))}
          />
        </View>
      </>
    );
  };

  /** The controls only one generator has. Everything else is the same two rows. */
  const extrasFor = (kind: GeneratedKind): React.ReactNode => {
    if (kind === 'groceryUseUp') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="groceryUseUpLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="How many days before the use-by date the task falls due."
            value={
              s.groceryUseUpLeadDays === 0
                ? 'On the day'
                : `${s.groceryUseUpLeadDays} ${s.groceryUseUpLeadDays === 1 ? 'day' : 'days'} before`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.groceryUseUpLeadDays}
              onChange={next => s.setGroceryUseUpLeadDays(next ?? GROCERY_USE_UP_LEAD_DAYS_DEFAULT)}
              min={GROCERY_USE_UP_LEAD_DAYS_MIN}
              max={GROCERY_USE_UP_LEAD_DAYS_MAX}
              format={n => (n === 0 ? 'Day of' : `${n}d`)}
              label="Days before the use-by date"
              describeValue={n =>
                n === 0 ? 'On the use-by day' : `${n} ${n === 1 ? 'day' : 'days'} before`
              }
            />
          </View>
        </>
      );
    }

    if (kind === 'mealShortfall') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="mealShortfallLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="How many days before the meal the shopping task falls due."
            value={
              s.mealShortfallLeadDays === 0
                ? 'On the day'
                : `${s.mealShortfallLeadDays} ${s.mealShortfallLeadDays === 1 ? 'day' : 'days'} before`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.mealShortfallLeadDays}
              onChange={next => s.setMealShortfallLeadDays(next ?? MEAL_SHORTFALL_LEAD_DAYS_DEFAULT)}
              min={MEAL_SHORTFALL_LEAD_DAYS_MIN}
              max={MEAL_SHORTFALL_LEAD_DAYS_MAX}
              format={n => (n === 0 ? 'Day of' : `${n}d`)}
              label="Days before the meal"
              describeValue={n =>
                n === 0 ? 'On the day of the meal' : `${n} ${n === 1 ? 'day' : 'days'} before`
              }
            />
          </View>
        </>
      );
    }

    if (kind === 'birthday') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="birthdayLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="How many days before the birthday the task falls due."
            value={
              s.birthdayLeadDays === 0
                ? 'On the day'
                : `${s.birthdayLeadDays} ${s.birthdayLeadDays === 1 ? 'day' : 'days'} before`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.birthdayLeadDays}
              onChange={next => s.setBirthdayLeadDays(next ?? DEFAULT_BIRTHDAY_LEAD_DAYS)}
              min={0}
              max={MAX_BIRTHDAY_LEAD_DAYS}
              format={n => (n === 0 ? 'Day of' : `${n}d`)}
              label="Days before the birthday"
              describeValue={n =>
                n === 0 ? 'On the birthday itself' : `${n} ${n === 1 ? 'day' : 'days'} before`
              }
            />
          </View>
          {/* Only ever moves when the row *surfaces*. The birthday itself rides
              the task's deadline, so changing this never moves anybody's
              birthday, and it deliberately doesn't re-date a row already on the
              list — see birthdayDrift. */}
        </>
      );
    }

    if (kind === 'weekendNudge') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="weekendNudgeLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="Which day the task appears on. It never appears once the weekend has started."
            value={describeWeekendNudgeLead(s.weekendNudgeLeadDays)}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.weekendNudgeLeadDays}
              onChange={next => s.setWeekendNudgeLeadDays(next ?? WEEKEND_NUDGE_LEAD_DAYS_DEFAULT)}
              min={WEEKEND_NUDGE_LEAD_DAYS_MIN}
              max={WEEKEND_NUDGE_LEAD_DAYS_MAX}
              format={n => `${n}d`}
              label="Days before Saturday"
              describeValue={n => describeWeekendNudgeLead(n ?? WEEKEND_NUDGE_LEAD_DAYS_DEFAULT)}
            />
          </View>
          <View style={styles.sep} />
          <SettingsRow
            entryId="weekendNudgePlanThreshold"
            icon="checkmark-done-outline"
            label="How much counts as open"
            hint="How many things can already be planned for Friday evening, Saturday or Sunday while the weekend still counts as open."
            value={describeWeekendNudgePlanThreshold(s.weekendNudgePlanThreshold)}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.weekendNudgePlanThreshold}
              onChange={next => s.setWeekendNudgePlanThreshold(next ?? WEEKEND_NUDGE_PLAN_THRESHOLD_DEFAULT)}
              min={WEEKEND_NUDGE_PLAN_THRESHOLD_MIN}
              max={WEEKEND_NUDGE_PLAN_THRESHOLD_MAX}
              label="Things already planned"
              describeValue={n => describeWeekendNudgePlanThreshold(n ?? WEEKEND_NUDGE_PLAN_THRESHOLD_DEFAULT)}
            />
          </View>
        </>
      );
    }

    if (kind === 'weighIn') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="weighInEveryDays"
            icon="calendar-outline"
            label="Ask after"
            hint="How long without a weight in Apple Health before the task appears. It doesn’t appear on a day you’ve already recorded one."
            value={s.weighInEveryDays === 1 ? '1 day' : `${s.weighInEveryDays} days`}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.weighInEveryDays}
              onChange={next => s.setWeighInEveryDays(next ?? DEFAULT_WEIGH_IN_EVERY_DAYS)}
              min={WEIGH_IN_EVERY_DAYS_MIN}
              max={WEIGH_IN_EVERY_DAYS_MAX}
              format={n => `${n}d`}
              label="Days without a weigh-in"
              describeValue={n => (n === 1 ? '1 day' : `${n ?? DEFAULT_WEIGH_IN_EVERY_DAYS} days`)}
            />
          </View>
        </>
      );
    }

    if (kind === 'snackNudge') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="snackNudgeFromHour"
            icon="time-outline"
            label="Start suggesting at"
            hint="The task never appears before this time of day."
            value={describeSnackNudgeHour(s.snackNudgeFromHour)}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.snackNudgeFromHour}
              onChange={next => s.setSnackNudgeFromHour(next ?? DEFAULT_SNACK_NUDGE_FROM_HOUR)}
              min={SNACK_NUDGE_FROM_HOUR_MIN}
              max={SNACK_NUDGE_FROM_HOUR_MAX}
              format={describeSnackNudgeHour}
              label="Hour to start suggesting"
              describeValue={n => describeSnackNudgeHour(n ?? DEFAULT_SNACK_NUDGE_FROM_HOUR)}
            />
          </View>
          <View style={styles.sep} />
          <SettingsRow
            entryId="snackNudgeSharePercent"
            icon="nutrition-outline"
            label="Suggest when below"
            hint="Adds the task when the calories logged today are under this share of your calorie target."
            value={`${s.snackNudgeSharePercent}% of target`}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.snackNudgeSharePercent}
              onChange={next => s.setSnackNudgeSharePercent(next ?? DEFAULT_SNACK_NUDGE_SHARE_PERCENT)}
              min={SNACK_NUDGE_SHARE_PERCENT_MIN}
              max={SNACK_NUDGE_SHARE_PERCENT_MAX}
              step={SNACK_NUDGE_SHARE_PERCENT_STEP}
              format={n => `${n}%`}
              label="Percent of calorie target"
              describeValue={n => `${n ?? DEFAULT_SNACK_NUDGE_SHARE_PERCENT}% of target`}
            />
          </View>
        </>
      );
    }

    if (kind === 'birthdayGift') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="birthdayGiftLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="How many days before the birthday the gift task falls due."
            value={
              s.birthdayGiftLeadDays === 0
                ? 'On the day'
                : `${s.birthdayGiftLeadDays} ${s.birthdayGiftLeadDays === 1 ? 'day' : 'days'} before`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.birthdayGiftLeadDays}
              onChange={next => s.setBirthdayGiftLeadDays(next ?? DEFAULT_BIRTHDAY_GIFT_LEAD_DAYS)}
              min={0}
              max={MAX_BIRTHDAY_LEAD_DAYS}
              format={n => (n === 0 ? 'Day of' : `${n}d`)}
              label="Days before the birthday"
              describeValue={n =>
                n === 0 ? 'On the birthday itself' : `${n} ${n === 1 ? 'day' : 'days'} before`
              }
            />
          </View>
        </>
      );
    }

    if (kind === 'mealSlot') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="mealSlotsEnabled"
            icon="restaurant-outline"
            iconColor={s.mealSlotsEnabled.length > 0 ? colors.accent : undefined}
            label="Meals you eat"
            hint={
              s.mealSlotsEnabled.length === 0
                ? "No meals picked, so no tasks are added. Planned meals still show as plain rows if Show the day’s meals is on under Groceries & meals."
                : "A task each day for each of these, planned or not. Other planned meals still show as plain rows if Show the day’s meals is on under Groceries & meals."
            }
            tight
          />
          {/* Four toggles rather than one row of pills: these are four
              independent yes/no answers, not one field with four values, and a
              row of toggles is what the rest of this card already is. The
              segmented control next door is single-choice by construction. */}
          {MEAL_SLOTS.map(slot => {
            const on = s.mealSlotsEnabled.includes(slot);
            return (
              <SettingsRow
                key={slot}
                icon={MEAL_SLOT_ICONS[slot]}
                iconColor={on ? colors.accent : undefined}
                label={MEAL_SLOT_LABELS[slot]}
                toggle={on}
                onPress={() => {
                  s.setMealSlotsEnabled(
                    on
                      ? s.mealSlotsEnabled.filter(x => x !== slot)
                      : [...s.mealSlotsEnabled, slot]
                  );
                  // Switching a meal *on* fills it into the days already
                  // written, so the answer takes effect now rather than when
                  // the horizon rolls forward a week from here. Scoped to this
                  // slot alone — rewinding the generator's mark instead would
                  // rewrite the whole window and resurrect rows the user has
                  // deleted. Switching one off writes nothing: the tasks
                  // already there stay, the same restraint setMealCookTasks
                  // keeps. Nothing to undo on the off path, hence no else.
                  if (!on) useTaskStore.getState().backfillMealSlotTasks([slot]);
                }}
                accessibilityLabel={`A task for ${MEAL_SLOT_LABELS[slot].toLowerCase()} each day`}
              />
            );
          })}
        </>
      );
    }

    if (kind === 'mealPlanNudge') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow entryId="mealPlanNudgeTime" icon="calendar-outline" iconColor={colors.accent} label="Add the task on" tight />
          <SettingsSegments
            attached
            options={weekdaySegmentOptions}
            selected={s.mealPlanNudgeWeekday}
            onSelect={s.setMealPlanNudgeWeekday}
            accessibilityLabelFor={o => WEEKDAY_NAMES[o.value]}
          />
          <View style={styles.sep} />
          <SettingsRow
            icon="alarm-outline"
            iconColor={colors.accent}
            label="At"
            value={formatHHMM(s.mealPlanNudgeTime)}
            onPress={() => {
              if (timePickerOpen) { setTimePickerOpen(false); return; }
              setPickerDate(hhmmToDate(s.mealPlanNudgeTime));
              setTimePickerOpen(true);
            }}
          />
          {timePickerOpen && (
            <InlineTimePicker
              value={pickerDate}
              onChange={setPickerDate}
              onCancel={() => setTimePickerOpen(false)}
              onConfirm={confirmTime}
            />
          )}
          <View style={styles.sep} />
          <SettingsRow
            entryId="mealPlanNudgeIgnoresVacation"
            icon="airplane-outline"
            iconColor={s.mealPlanNudgeIgnoresVacation ? colors.accent : undefined}
            label="Also during vacation"
            hint="Vacation mode pauses this along with other automatic tasks. Turn this on to keep adding the weekly task."
            toggle={s.mealPlanNudgeIgnoresVacation}
            onPress={() => s.setMealPlanNudgeIgnoresVacation(!s.mealPlanNudgeIgnoresVacation)}
          />
          <View style={styles.sep} />
          <SettingsRow
            entryId="mealPlanNudgeSlots"
            icon="restaurant-outline"
            iconColor={s.mealPlanNudgeSlots.length > 0 ? colors.accent : undefined}
            label="Meals to plan for"
            hint={
              s.mealPlanNudgeSlots.length === 0
                ? 'No meals picked, so a day never reads as fully planned.'
                : "Each day’s task counts down against these. Planning only these meals is enough to mark the day done."
            }
            tight
          />
          {MEAL_PLAN_NUDGE_SLOTS.map(slot => {
            const on = s.mealPlanNudgeSlots.includes(slot);
            return (
              <SettingsRow
                key={slot}
                icon={MEAL_SLOT_ICONS[slot]}
                iconColor={on ? colors.accent : undefined}
                label={MEAL_SLOT_LABELS[slot]}
                toggle={on}
                onPress={() => {
                  s.setMealPlanNudgeSlots(
                    on
                      ? s.mealPlanNudgeSlots.filter(x => x !== slot)
                      : [...s.mealPlanNudgeSlots, slot]
                  );
                }}
                accessibilityLabel={`Count ${MEAL_SLOT_LABELS[slot].toLowerCase()} toward a planned day`}
              />
            );
          })}
        </>
      );
    }

    if (kind === 'calendarReview') {
      return timeSegmentExtra('calendarReviewTimeSegment', s.calendarReviewTimeSegment, s.setCalendarReviewTimeSegment);
    }

    if (kind === 'moodLog') {
      return multiSegmentExtra('moodLogTimeSegments', s.moodLogTimeSegments, s.setMoodLogTimeSegments,
        'Held back until each part of the day arrives. Pick more than one for several check-ins a day, and an unanswered one is cleared when the next arrives.',
      );
    }

    if (kind === 'moodNudge') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="moodNudgeAfterDays"
            icon="trending-down-outline"
            label="Low days before the task"
            hint="How many low-mood days in a row before the task is offered, at most once a week."
            value={describeLowDays(s.moodNudgeAfterDays)}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.moodNudgeAfterDays}
              onChange={next => s.setMoodNudgeAfterDays(next ?? DEFAULT_MOOD_NUDGE_AFTER_DAYS)}
              min={MOOD_NUDGE_AFTER_DAYS_MIN}
              max={MOOD_NUDGE_AFTER_DAYS_MAX}
              format={n => `${n}d`}
              label="Low days in a row"
              describeValue={n => describeLowDays(n ?? DEFAULT_MOOD_NUDGE_AFTER_DAYS)}
            />
          </View>
        </>
      );
    }

    if (kind === 'journalLog') {
      return multiSegmentExtra('journalLogTimeSegments', s.journalLogTimeSegments, s.setJournalLogTimeSegments,
        'Any time means one task a day. Pick parts of the day to get a task in each, and an unanswered one is cleared when the next arrives.',
      );
    }

    if (kind === 'weather') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="weatherRules"
            icon="list-outline"
            iconColor={activeWeatherRuleCount > 0 ? colors.accent : undefined}
            label="Rules"
            hint="What weather adds which task, like sunscreen on a sunny day."
            value={
              activeWeatherRuleCount === 0
                ? 'None'
                : activeWeatherRuleCount === 1 ? '1 rule' : `${activeWeatherRuleCount} rules`
            }
            onPress={() => { haptics.tap(); setWeatherRulesVisible(true); }}
          />
        </>
      );
    }

    if (kind === 'eventTask') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="eventRules"
            icon="list-outline"
            iconColor={activeEventRuleCount > 0 ? colors.accent : undefined}
            label="Rules"
            hint="Which word in an event’s title adds which task, and how far ahead."
            value={
              activeEventRuleCount === 0
                ? 'None'
                : activeEventRuleCount === 1 ? '1 rule' : `${activeEventRuleCount} rules`
            }
            onPress={() => { haptics.tap(); setEventRulesVisible(true); }}
          />
        </>
      );
    }

    if (kind === 'travel') {
      const lines = s.transitLines;
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="travelLeadMinutes"
            icon="time-outline"
            label="Remind me"
            hint={s.travelEstimates
              ? "Used for events where Apple Maps can’t estimate the trip."
              : 'How long before the event the reminder goes off. Set it to how long the trip takes.'}
            value={`${s.travelLeadMinutes} min before`}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.travelLeadMinutes}
              onChange={next => s.setTravelLeadMinutes(next ?? TRAVEL_LEAD_MINUTES_DEFAULT)}
              min={TRAVEL_LEAD_MINUTES_MIN}
              max={TRAVEL_LEAD_MINUTES_MAX}
              step={TRAVEL_LEAD_MINUTES_STEP}
              format={n => `${n}m`}
              label="Minutes before the event"
              describeValue={n => `${n ?? TRAVEL_LEAD_MINUTES_DEFAULT} minutes before the event`}
            />
          </View>
          <View style={styles.sep} />
          <SettingsRow
            entryId="travelEstimates"
            icon="navigate-outline"
            iconColor={s.travelEstimates ? colors.accent : undefined}
            label="Estimate travel time"
            hint={s.travelEstimates
              ? "Sets each reminder from Apple Maps’ estimate of the trip, plus 5 minutes. Sends the event’s address and where the trip starts to Apple while the app is open."
              : 'Reminders use the time above. Nothing is sent anywhere.'}
            toggle={s.travelEstimates}
            onPress={async () => {
              if (s.travelEstimates) { s.setTravelEstimates(false); return; }
              // The estimate starts from where the phone is, so it needs
              // location access; asked here, on the tap that wants it.
              if (await requestLocationPermission()) {
                s.setTravelEstimates(true);
                return;
              }
              alertPermissionOff(
                'Location access is off',
                'Estimating the trip needs your location. Turn on location access in Settings, then try again.',
              );
            }}
            tight={s.travelEstimates}
          />
          {s.travelEstimates && (
            <SettingsSegments
              attached
              options={TRAVEL_MODE_OPTIONS}
              selected={s.travelMode}
              onSelect={s.setTravelMode}
              accessibilityLabelFor={o => `Estimate the trip ${o.label.toLowerCase()}`}
            />
          )}
          {s.travelEstimates && (
            <>
              <View style={styles.sep} />
              <SettingsRow
                entryId="travelOrigin"
                icon="home-outline"
                label="Start from"
                hint={travelOrigin
                  ? `Estimates the trip from ${travelOrigin.name}, whatever time the app checks. Sends that place’s coordinates to Apple.`
                  : "Estimates the trip from where your phone is when the app checks, which may not be where you’ll leave from."}
                value={travelOrigin?.name ?? 'Where I am'}
                tight
              />
              <SettingsSegments
                attached
                options={TRAVEL_ORIGIN_OPTIONS}
                selected={travelOrigin ? 'place' : 'current'}
                onSelect={async choice => {
                  if (choice === 'current') {
                    // The phone's position is read under location access, so
                    // it is asked for here if it was never granted.
                    if (!(await requestLocationPermission())) {
                      alertPermissionOff(
                        'Location access is off',
                        'Estimating from where you are needs location access. Turn it on in Settings, then try again.',
                      );
                      return;
                    }
                    s.setTravelOriginPlaceId(null);
                    return;
                  }
                  const candidates = originCandidates(savedPlaces);
                  if (candidates.length === 0) {
                    Alert.alert(
                      'No saved places with a map pin',
                      'In a new event, type an address and pick it from the suggestions, then save it as a place. Only places picked that way can be a starting point.',
                    );
                    return;
                  }
                  const home = candidates.find(p => savedPlaceKey(p.name) === 'home') ?? candidates[0];
                  s.setTravelOriginPlaceId(home.id);
                }}
                accessibilityLabelFor={o => `Estimate the trip from ${o.label.toLowerCase()}`}
              />
              {travelOrigin && (
                <View style={styles.pillGroupRow}>
                  <PillGroup
                    noun="place"
                    options={originCandidates(savedPlaces).map(p => ({
                      key: p.id,
                      label: p.name,
                      selected: p.id === s.travelOriginPlaceId,
                      accessibilityLabel: `Start trips from ${p.name}`,
                      onPress: () => { haptics.tap(); s.setTravelOriginPlaceId(p.id); },
                    }))}
                  />
                </View>
              )}
            </>
          )}
          {s.calendarIds.length > 1 && (
            <>
              <View style={styles.sep} />
              <SettingsRow
                entryId="travelLeadByCalendar"
                icon="calendar-outline"
                label="Per calendar"
                hint="A different reminder time for events on one calendar. A calendar left on Default uses the time above."
                tight
              />
              {s.calendarIds.map(calendarId => {
                const calendar = calendarsById[calendarId];
                const title = calendar?.title || 'Calendar';
                const override = s.travelLeadByCalendar[calendarId] ?? null;
                return (
                  <SettingsRow
                    key={calendarId}
                    icon="ellipse"
                    iconColor={calendar?.color}
                    label={title}
                    tight
                    trailing={
                      <CountStepper
                        value={override}
                        onChange={next => s.setTravelLeadForCalendar(calendarId, next)}
                        min={TRAVEL_LEAD_MINUTES_MIN}
                        max={TRAVEL_LEAD_MINUTES_MAX}
                        step={TRAVEL_LEAD_MINUTES_STEP}
                        allowNull
                        start={s.travelLeadMinutes}
                        emptyLabel="Default"
                        format={n => `${n}m`}
                        label={`Minutes before events on ${title}`}
                        describeValue={n => n === null
                          ? `Default, ${s.travelLeadMinutes} minutes before`
                          : `${n} minutes before events on ${title}`}
                      />
                    }
                  />
                );
              })}
            </>
          )}
          <View style={styles.sep} />
          <SettingsRow
            entryId="transitAlerts"
            icon="subway-outline"
            label="Subway alerts"
            hint="Adds MTA delays and planned work on your lines to the task, like “L delayed”. Reads the MTA’s service alerts over the internet while the app is open."
            toggle={s.transitAlerts}
            onPress={() => s.setTransitAlerts(!s.transitAlerts)}
          />
          {s.transitAlerts && (
            <>
              <View style={styles.sep} />
              <SettingsRow
                entryId="transitLines"
                icon="train-outline"
                label="Lines"
                hint="Only alerts on these lines are added to a task."
                value={lines.length === 0 ? 'None' : lines.join(', ')}
                tight
              />
              <View style={styles.pillGroupRow}>
                <PillGroup
                  noun="line"
                  limit={TRANSIT_LINES.length}
                  options={TRANSIT_LINES.map(line => ({
                    key: line.key,
                    label: line.key,
                    selected: lines.includes(line.key),
                    accessibilityLabel: `${line.key} train`,
                    onPress: () => {
                      haptics.tap();
                      s.setTransitLines(
                        lines.includes(line.key) ? lines.filter(l => l !== line.key) : [...lines, line.key],
                      );
                    },
                  }))}
                />
              </View>
            </>
          )}
        </>
      );
    }

    if (kind === 'screenTime') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="screenTimeRules"
            icon="list-outline"
            iconColor={activeScreenTimeRuleCount > 0 ? colors.accent : undefined}
            label="Rules"
            hint="How long on which apps adds which task. The apps are picked in here too."
            value={
              activeScreenTimeRuleCount === 0
                ? 'None'
                : activeScreenTimeRuleCount === 1 ? '1 rule' : `${activeScreenTimeRuleCount} rules`
            }
            onPress={() => { haptics.tap(); setScreenTimeRulesVisible(true); }}
          />
        </>
      );
    }

    if (kind === 'health') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="healthRules"
            icon="list-outline"
            iconColor={activeHealthRuleCount > 0 ? colors.accent : undefined}
            label="Rules"
            hint="Which reading falling under which number adds which task."
            value={
              activeHealthRuleCount === 0
                ? 'None'
                : activeHealthRuleCount === 1 ? '1 rule' : `${activeHealthRuleCount} rules`
            }
            onPress={() => { haptics.tap(); setHealthRulesVisible(true); }}
          />
        </>
      );
    }

    return null;
  };

  // ==== render ====
  return (
    <>
    <SettingsSection
      // No label: this is the whole of the screen, so its own header is
      // already saying "Automations" directly above it.
      footer="Deleting an added task stops it from being added again, except meal tasks, which stay gone for the rest of the day. Activity shows what each one added."
    >
      {/* Above the generators rather than inside any one of them, because it
          applies to all of them at once: it changes when the whole list below
          gets a chance to run, not what any of them do. */}
      <SettingsRow
        entryId="backgroundRefreshEnabled"
        icon="moon-outline"
        iconColor={s.backgroundRefreshEnabled ? colors.accent : undefined}
        label="Add tasks while the app is closed"
        hint="iOS can wake the app in the background to add the tasks below, refresh reminders and update the widget, but iOS chooses the timing and can skip it. Everything below still runs when you open the app."
        toggle={s.backgroundRefreshEnabled}
        onPress={() => s.setBackgroundRefreshEnabled(!s.backgroundRefreshEnabled)}
      />
      <View style={sectionStyles.groupBreak} />
      {listed.map((spec, i) => {
        const on = enabledOf(spec.kind);
        const open = on && isOpen(spec.kind);
        return (
          <React.Fragment key={spec.kind}>
            {/* A band, not the hairline the rows inside a generator use. With
                two generators switched on, the card runs to four rows apiece and
                a hairline between "File them under" and the next generator's
                name reads exactly like the hairline above it — so the list
                stops saying where one generator ends. Four separate cards would
                say it too, but then the section header stops covering them all,
                which is the whole point of gathering them. */}
            {i > 0 && <View style={sectionStyles.groupBreak} />}
            <SettingsRow
              // Built the same way settingsIndex builds its ids, for the reason
              // the AI rows are: both sides map over the same registry, so
              // neither can name a row the other hasn't got.
              entryId={`gen:${spec.kind}`}
              icon={spec.icon}
              iconColor={on ? colors.accent : undefined}
              label={spec.label}
              hint={hintFor(spec)}
              toggle={on}
              onPress={() => toggle(spec.kind)}
              trailing={on ? (
                <TouchableOpacity
                  onPress={() => toggleOpen(spec.kind)}
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${open ? 'Hide' : 'Show'} ${spec.label} options`}
                  accessibilityState={{ expanded: open }}
                >
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              ) : undefined}
            />
            {open && extrasFor(spec.kind)}
            {open && (
              <>
                <View style={styles.sep} />
                <SettingsRow
                  entryId={`gen:${spec.kind}:defaults`}
                  icon="options-outline"
                  label="Task defaults"
                  hint="Priority, difficulty and time estimate these tasks start with. Not set uses your app-wide default, and anything still unanswered shows up in Backfill."
                  value={describeTaskFieldDefaults(s.generatedTaskDefaults[spec.kind]) ?? 'Not set'}
                  tight
                />
                <View style={styles.pillGroupRow}>
                  <TaskFieldDefaultsFields
                    value={s.generatedTaskDefaults[spec.kind]}
                    onChange={next => s.setGeneratedTaskDefaults(spec.kind, next)}
                    showDifficulty={s.rewardsEnabled}
                  />
                </View>
              </>
            )}
            {open && spec.categorized && (
              <>
                <View style={styles.sep} />
                <SettingsRow
                  entryId={`gen:${spec.kind}:category`}
                  icon="pricetag-outline"
                  label="File them under"
                  hint="With none, they appear at the top of Today, above your categories."
                  value={categoryOptions.find(o => o.value === categoryOf(spec.kind))?.label ?? 'None'}
                  tight
                />
                <View style={styles.pillGroupRow}>
                  <PillGroup
                    noun="category"
                    options={categoryPills(
                      categoryOf(spec.kind),
                      category => setCategory(spec.kind, category),
                      label => `${spec.label} category: ${label}`,
                    )}
                  />
                </View>
              </>
            )}
          </React.Fragment>
        );
      })}
      {(s.groceryUseUpTasks || s.leftoverUseUpTasks) && (
        <>
          {/* Spans both use-up generators, so it sits below the loop rather
              than inside either generator's own extras — see useUpTaskCap. */}
          <View style={sectionStyles.groupBreak} />
          <SettingsRow
            entryId="useUpTaskCap"
            icon="layers-outline"
            label="Limit use-up tasks"
            hint={
              s.useUpTaskCap === null
                ? 'No limit: every qualifying item and leftover gets a task'
                : `At most ${s.useUpTaskCap} use-up ${s.useUpTaskCap === 1 ? 'task' : 'tasks'} at a time, closest date first`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.useUpTaskCap}
              onChange={s.setUseUpTaskCap}
              min={USE_UP_TASK_CAP_MIN}
              max={USE_UP_TASK_CAP_MAX}
              allowNull
              emptyLabel="No limit"
              label="Use-up task limit"
              describeValue={n => (n === null ? 'No limit' : `At most ${n}`)}
            />
          </View>
        </>
      )}
      {s.kitchenEnabled && (
        <>
          {/* Not a generator: these are read-only rows computed from the food
              log, so they have no registry entry and no task defaults. They
              answer to their own switch (limitsTodayCategory, null = off),
              independent of the "don't do" task above. */}
          <View style={sectionStyles.groupBreak} />
          <SettingsRow
            entryId="limitsToday"
            icon="nutrition-outline"
            iconColor={s.limitsTodayCategory !== null ? colors.accent : undefined}
            label="Stay under limits on Today"
            hint={
              s.limitsTodayCategory !== null
                ? 'Shows how much of each Stay under limit is used so far today.'
                : 'Shows nothing on Today for Stay under limits.'
            }
            toggle={s.limitsTodayCategory !== null}
            onPress={toggleLimitsOnToday}
          />
          {s.limitsTodayCategory !== null && (
            <>
              <View style={styles.sep} />
              <SettingsRow
                entryId="limitsTodayCategory"
                icon="pricetag-outline"
                label="Show them under"
                hint="The category these rows sit in on Today."
                value={categoryOptions.find(o => o.value === s.limitsTodayCategory)?.label ?? s.limitsTodayCategory}
                tight
              />
              <View style={styles.pillGroupRow}>
                <PillGroup
                  noun="category"
                  options={categoryPills(
                    s.limitsTodayCategory,
                    category => { if (category !== null) s.setLimitsTodayCategory(category); },
                    label => `Stay under limits category: ${label}`,
                  ).filter(o => !o.pinned)}
                />
              </View>
              {activeLimits(s.nutritionTargets, s.nutritionLimits).length > 0 && (
                <>
                  <View style={styles.sep} />
                  <SettingsRow
                    entryId="limitsTodayNutrients"
                    icon="list-outline"
                    label="Nutrients shown"
                    hint="Turn off a nutrient to leave its row off Today. Its limit still applies everywhere else."
                    tight
                  />
                  <View style={styles.pillGroupRow}>
                    <PillGroup
                      noun="nutrient"
                      options={activeLimits(s.nutritionTargets, s.nutritionLimits).map(key => {
                        const label = LIMIT_ROW_NAME[key] ?? NUTRIENT_LABEL[key].label;
                        const shown = !s.limitsTodayHidden.includes(key);
                        return {
                          key,
                          label,
                          selected: shown,
                          accessibilityLabel: `${label} on Today: ${shown ? 'shown' : 'hidden'}`,
                          onPress: () => {
                            haptics.tap();
                            s.setLimitsTodayHidden(
                              shown ? [...s.limitsTodayHidden, key] : s.limitsTodayHidden.filter(k => k !== key),
                            );
                          },
                        };
                      })}
                    />
                  </View>
                </>
              )}
            </>
          )}
        </>
      )}
    </SettingsSection>
    <WeatherRulesSheet visible={weatherRulesVisible} onClose={() => setWeatherRulesVisible(false)} />
    <EventRulesSheet visible={eventRulesVisible} onClose={() => setEventRulesVisible(false)} />
    <ScreenTimeRulesSheet visible={screenTimeRulesVisible} onClose={() => setScreenTimeRulesVisible(false)} />
    <HealthRulesSheet visible={healthRulesVisible} onClose={() => setHealthRulesVisible(false)} />
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // The screen's own ground showing through the card, which is what an inset
  // group already uses to separate one card from the next — borrowed here to
  // separate one generator from the next inside a single card.
  groupBreak: { height: spacing.sm, backgroundColor: colors.bg },
});
