import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSettingsStore, type WeekStart } from '../../store/useSettingsStore';
import {
  GENERATED_KIND_LIST,
  type GeneratedKind,
  type GeneratedKindSpec,
} from '../../utils/generatedTasks';
import {
  GROCERY_USE_UP_LEAD_DAYS_DEFAULT,
  GROCERY_USE_UP_LEAD_DAYS_MAX,
  GROCERY_USE_UP_LEAD_DAYS_MIN,
} from '../../types';
import { dateToHHMM, hhmmToDate } from '../../utils/clockTime';
import { formatHHMM } from '../../utils/dateUtils';
import { useColors } from '../../theme/ThemeContext';
import { spacing, type Colors } from '../../theme';
import { CountStepper } from '../../components/CountStepper';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { InlineTimePicker } from './InlineTimePicker';
import { PillGroup, type PillGroupOption } from '../../components/PillGroup';
import { type SegmentOption } from '../../components/SegmentedControl';
import { makeSettingsStyles } from './settingsStyles';

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
 * The nudge is in the list despite having no category to file under and no
 * source row to opt out of, because from the user's side it is exactly the same
 * kind of thing: a task that appears in the list because the app put it there.
 */

// Full names for the hint sentence and screen reader labels; single letters on
// the segments themselves, the same compression the calendar's own header uses
// to fit all seven across 390pt. Moved here with the nudge's controls.
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Weekday segments rotated to start at weekStartsOn, matching the calendar's header order. */
function weekdayOptions(weekStartsOn: WeekStart): SegmentOption<number>[] {
  return Array.from({ length: 7 }, (_, i) => {
    const value = (weekStartsOn + i) % 7;
    return { value, label: WEEKDAY_LETTERS[value] };
  });
}

interface Props {
  /** For naming the current value in each generator's disclosure row. */
  categoryOptions: { value: string | null; label: string }[];
  /**
   * The parent screen's own pill builder, shared rather than rebuilt: a closed
   * set gets a segmented control, but categories are the user's own and there
   * can be fifteen, which is `PillGroup`'s job. See newTaskCategoryOptions.
   */
  categoryPills: (
    selected: string | null,
    onSelect: (value: string | null) => void,
    describe: (label: string) => string,
  ) => PillGroupOption[];
}

export function GeneratedTasksSection({ categoryOptions, categoryPills }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const sectionStyles = useMemo(() => makeStyles(colors), [colors]);

  const s = useSettingsStore();
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(() => hhmmToDate(s.mealPlanNudgeTime));

  const weekdaySegmentOptions = useMemo(() => weekdayOptions(s.weekStartsOn), [s.weekStartsOn]);

  // Each generator's on/off answer and its category still live under their own
  // settings keys. Renaming them to a generic pair would be a migration over
  // preferences people have already set, for no gain a person can see — the
  // consolidation people asked for is the one in front of them, not in SQLite.
  const enabledOf = (kind: GeneratedKind): boolean => (
    kind === 'mealCook' ? s.mealCookTasks
    : kind === 'groceryUseUp' ? s.groceryUseUpTasks
    : kind === 'leftoverUseUp' ? s.leftoverUseUpTasks
    : s.mealPlanNudgeEnabled
  );

  const toggle = (kind: GeneratedKind): void => {
    const next = !enabledOf(kind);
    if (kind === 'mealCook') s.setMealCookTasks(next);
    else if (kind === 'groceryUseUp') s.setGroceryUseUpTasks(next);
    else if (kind === 'leftoverUseUp') s.setLeftoverUseUpTasks(next);
    else s.setMealPlanNudgeEnabled(next);
  };

  const categoryOf = (kind: GeneratedKind): string | null => (
    kind === 'mealCook' ? s.mealCookTaskCategory
    : kind === 'groceryUseUp' ? s.groceryUseUpTaskCategory
    : s.leftoverUseUpTaskCategory
  );

  // No haptic here: `categoryPills` fires one in its own onPress, and two for
  // one tap reads as a stutter.
  const setCategory = (kind: GeneratedKind, category: string | null): void => {
    if (kind === 'mealCook') s.setMealCookTaskCategory(category);
    else if (kind === 'groceryUseUp') s.setGroceryUseUpTaskCategory(category);
    else s.setLeftoverUseUpTaskCategory(category);
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
    if (!enabledOf(spec.kind)) return spec.offHint;
    if (spec.kind === 'mealPlanNudge') {
      return `A task appears ${WEEKDAY_NAMES[s.mealPlanNudgeWeekday]} at ${formatHHMM(s.mealPlanNudgeTime)} to plan the coming week`;
    }
    return spec.onHint;
  };

  /** The controls only one generator has. Everything else is the same two rows. */
  const extrasFor = (kind: GeneratedKind): React.ReactNode => {
    if (kind === 'groceryUseUp') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="calendar-outline"
            label="Show the task"
            hint="How many days before the use-by date the task falls due"
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

    if (kind === 'mealPlanNudge') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow icon="calendar-outline" iconColor={colors.accent} label="Nudge me on" tight />
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
        </>
      );
    }

    return null;
  };

  return (
    <SettingsSection
      label="Tasks the app adds"
      footer="These are the only things that put a task in your list without you typing it. Each one can be turned off here, and deleting a task the app added tells it not to add that one again — the meal, the grocery item or the leftover it came from remembers your answer."
    >
      {GENERATED_KIND_LIST.map((spec, i) => {
        const on = enabledOf(spec.kind);
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
              icon={spec.icon}
              iconColor={on ? colors.accent : undefined}
              label={spec.label}
              hint={hintFor(spec)}
              toggle={on}
              onPress={() => toggle(spec.kind)}
            />
            {on && extrasFor(spec.kind)}
            {on && spec.categorized && (
              <>
                <View style={styles.sep} />
                <SettingsRow
                  icon="pricetag-outline"
                  label="File them under"
                  hint="With none, they sit loose at the top of Today above your categories"
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
    </SettingsSection>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // The screen's own ground showing through the card, which is what an inset
  // group already uses to separate one card from the next — borrowed here to
  // separate one generator from the next inside a single card.
  groupBreak: { height: spacing.sm, backgroundColor: colors.bg },
});
