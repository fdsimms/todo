import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { HolidayRule, RecurrenceType } from '../types';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { ORDINAL_OPTIONS, MONTH_ABBREVIATIONS, recurrenceUnitLabel } from '../utils/recurrenceLabels';
import { WeekdaySelector } from './WeekdaySelector';
import { CountStepper } from './CountStepper';
import { SegmentedControl } from './SegmentedControl';
import { haptics } from '../utils/haptics';
import { ordinal } from '../utils/ordinal';
import { useSettingsStore } from '../store/useSettingsStore';
import { HOLIDAY_SET_LABELS, hasAnyHolidays } from '../utils/holidays';
import { formatRain, rainSkipOptions, rainUnitFor } from '../utils/rainSkip';

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  none: 'Never',
  hours: 'Hours',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

// Every N days/weeks/… — 99 is well past any real schedule, and a stepper
// needs a ceiling. The occurrence count gets a looser one: "after 200 times"
// is an ordinary way to bound a daily habit.
const MAX_INTERVAL = 99;
const MAX_COUNT = 999;

// WeekdaySelector toggles a day in/out of an array; the Nth-weekday-of-month
// picker needs exactly one day selected at a time, so this wraps its
// onChange to always keep the most recently tapped day (ignoring a tap that
// would deselect the only day, since a weekday must stay chosen).
export function onlyNewestWeekday(current: number[], setDays: (days: number[]) => void): (days: number[]) => void {
  return (days: number[]) => {
    if (days.length === 0) return;
    const added = days.find(d => !current.includes(d));
    setDays(added !== undefined ? [added] : [days[days.length - 1]]);
  };
}

/** Nth-weekday-of-month monthly mode ("every 2nd Tuesday") — TaskEditor only. */
interface WeekOrdinalProps {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Weekday (0 = Sunday) to seed `recurrenceDays` with the first time "On a weekday" is picked. */
  seedWeekday: () => number;
}

/** "Ends: … On date" option — TaskEditor only; omit to fall back to a plain Never/After-N toggle. */
interface EndDateProps {
  value: Date | null;
  /** Fired when the "On date" pill is tapped: seed a default date if unset, switch mode, and open the picker. */
  onSelect: () => void;
  /** Fired when the date chip itself is tapped, to re-open the picker without touching the seeded value. */
  onOpenPicker: () => void;
}

interface Props {
  recurrenceType: RecurrenceType;
  onChangeType: (type: RecurrenceType) => void;
  recurrenceInterval: number;
  onChangeInterval: (interval: number) => void;
  recurrenceDays: number[];
  onChangeDays: (days: number[]) => void;
  recurrenceMonthDay: number | null;
  onChangeMonthDay: (day: number | null) => void;
  /** Value to seed `recurrenceMonthDay` with the first time "On a day" is picked (TaskEditor seeds from the due date; TemplateItemEditor has none, so uses 1). */
  seedMonthDay: () => number;
  /** Month (1-12) a yearly rule is pinned to. Null = whatever month the due date falls in. Ignored for every other `recurrenceType`. */
  recurrenceMonth: number | null;
  onChangeMonth: (month: number | null) => void;
  /** Value to seed `recurrenceMonth` with the first time "On a month" is picked (TaskEditor seeds from the due date; TemplateItemEditor has none, so uses January). */
  seedMonth: () => number;
  recurrenceFromCompletion: boolean;
  onChangeFromCompletion: (fromCompletion: boolean) => void;
  recurrenceCount: number | null;
  onChangeCount: (updater: number | null | ((c: number | null) => number | null)) => void;
  /** How to phrase the occurrence-count stepper's unit — TaskEditor pluralizes ("time"/"times"), TemplateItemEditor always says "times". */
  countUnitLabel?: (count: number) => string;

  /** Week-ordinal monthly mode ("2nd Tuesday") — omit to hide the option entirely (TemplateItemEditor). */
  weekOrdinal?: WeekOrdinalProps;

  /** "Never" pill label; TemplateItemEditor uses "Never ends". */
  neverEndsLabel?: string;
  /** "After" pill label; TemplateItemEditor uses "After N". */
  afterCountLabel?: string;
  /** Fired when the "Never"/"Never ends" pill is tapped. */
  onSelectEndNever: () => void;
  /** Fired when the "After"/"After N" pill is tapped. */
  onSelectEndCount: () => void;
  /** "On date" end option — omit to fall back to the plain Never/After-N toggle (TemplateItemEditor). */
  endDate?: EndDateProps;

  /**
   * What `getNextDueDate()` returns for the rule as currently configured —
   * TaskEditor only, since TemplateItemEditor has no due date to anchor a
   * schedule to. Rendered under the On schedule / After completion pills so
   * the choice reads as an actual date rather than an abstract mechanism.
   */
  previewNextDate?: Date | null;

  /**
   * What an occurrence the rule lands on a holiday does (Task.recurrenceHolidays).
   * Omit `onChangeHolidays` to leave the group out.
   */
  recurrenceHolidays?: HolidayRule | null;
  onChangeHolidays?: (rule: HolidayRule | null) => void;
  /**
   * The rain that skips an occurrence, in millimetres (Task.rainSkipMm), or
   * null for never. Omit `onChangeRainSkip` to leave the group out.
   */
  rainSkipMm?: number | null;
  onChangeRainSkip?: (mm: number | null) => void;
}

const HOLIDAY_OPTIONS: { value: HolidayRule | null; label: string }[] = [
  { value: null, label: 'As usual' },
  { value: 'skip', label: 'Skip it' },
  { value: 'move', label: 'Next day' },
];

/** The monthly day-anchor modes, as one closed set the picker can switch on. */
type MonthAnchor = 'dueDate' | 'monthDay' | 'lastDay' | 'weekday';

/** The yearly month-anchor modes: pinned to a fixed month, or riding the due date's. */
type YearMonthAnchor = 'dueDate' | 'month';

/**
 * One labelled block of the rule. Every block but the first states its own
 * name, because unlabelled pill rows stacked four deep read as one field of
 * blue-and-grey blobs — which is the whole reason this section was hard to
 * scan. The first block needs no label: the "Repeat" row sits directly above
 * it and names it.
 */
function Group({
  label, hint, first, styles, children,
}: { label?: string; hint?: string; first?: boolean; styles: Styles; children: React.ReactNode }) {
  return (
    <View style={[styles.group, first && styles.groupFirst]}>
      {!!label && <Text style={styles.groupLabel}>{label}</Text>}
      {children}
      {!!hint && <Text style={styles.groupHint}>{hint}</Text>}
    </View>
  );
}

/**
 * The recurrence rule picker shared by TaskEditor and TemplateItemEditor:
 * daily/weekly/monthly/yearly type pills, the "Every N <unit>" interval
 * stepper, the weekly weekday selector, the monthly/yearly "on which day"
 * sub-picker (same day as due date / on a day / last day / on a weekday),
 * the day-of-month stepper, the on-schedule/after-completion pills, and the
 * ends never/date/count pills with the occurrence-count stepper.
 *
 * Yearly shares the monthly sub-picker's day options rather than getting its
 * own, minus "on a weekday" — the engine (`getNextYearDayOccurrence`) has no
 * notion of a week-ordinal anchor, so there's nothing for that option to
 * mean here. It also gets an "In which month" group above the day picker,
 * which monthly has no equivalent of: only a yearly rule has a month of its
 * own to pin independently of the due date's.
 *
 * Those are six independent settings, so the controls are cut into labelled
 * groups separated by hairlines rather than run together as one column of
 * pill rows — see `Group`. The read-back for the whole rule is the Repeat
 * row's own value (`describeRecurrence`), which is why there's no summary
 * line in here: it would be the same sentence twice, 40pt apart.
 *
 * Callers own all the state — this component is pure render + callbacks —
 * because TaskEditor and TemplateItemEditor each fold recurrence into their
 * own save payload differently (deadlineMonthDay coupling, chain interplay,
 * etc). The week-ordinal and end-date branches are TaskEditor-only features;
 * they're gated behind the `weekOrdinal`/`endDate` props rather than always
 * rendered, since TemplateItemEditor has no due date to anchor them to.
 */
export function RecurrencePicker({
  recurrenceType, onChangeType,
  recurrenceInterval, onChangeInterval,
  recurrenceDays, onChangeDays,
  recurrenceMonthDay, onChangeMonthDay, seedMonthDay,
  recurrenceMonth, onChangeMonth, seedMonth,
  recurrenceFromCompletion, onChangeFromCompletion,
  recurrenceCount, onChangeCount,
  countUnitLabel = (count) => (count === 1 ? 'time' : 'times'),
  weekOrdinal,
  neverEndsLabel = 'Never',
  afterCountLabel = 'After',
  onSelectEndNever, onSelectEndCount,
  endDate,
  previewNextDate,
  recurrenceHolidays, onChangeHolidays,
  rainSkipMm, onChangeRainSkip,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Which days count, said where the choice is: with none set up the choice
  // does nothing, and the hint says so rather than letting it look armed.
  const holidaySet = useSettingsStore(s => s.holidaySet);
  const customHolidays = useSettingsStore(s => s.customHolidays);
  const holidayHint = !hasAnyHolidays({ set: holidaySet, custom: customHolidays })
    ? 'No holidays are set up, so this does nothing yet. Choose them in Settings, Day & time.'
    : `Uses ${[
        holidaySet !== 'none' ? `${HOLIDAY_SET_LABELS[holidaySet]} holidays` : null,
        customHolidays.length > 0 ? `${customHolidays.length} day${customHolidays.length === 1 ? '' : 's'} off of your own` : null,
      ].filter(Boolean).join(' and ')}, set in Settings, Day & time.`;

  // The rain thresholds in the user's own unit. A stored value that isn't a
  // preset (one picked under the other unit) keeps a segment of its own, so
  // the track never shows a selection the task doesn't have.
  const weatherTasksOn = useSettingsStore(s => s.weatherTasks);
  const rainUnit = rainUnitFor(useSettingsStore(s => s.unitSystem));
  const rainOptions = useMemo(() => {
    const presets = rainSkipOptions(rainUnit);
    const extra = typeof rainSkipMm === 'number' && rainSkipMm > 0 && !presets.some(p => p.mm === rainSkipMm)
      ? [{ mm: rainSkipMm, label: formatRain(rainSkipMm, rainUnit) }] : [];
    return [
      { value: null as number | null, label: 'Off' },
      ...[...presets, ...extra].sort((a, b) => a.mm - b.mm).map(p => ({ value: p.mm as number | null, label: p.label })),
    ];
  }, [rainUnit, rainSkipMm]);
  const rainHint = weatherTasksOn
    ? 'Skips the day\'s occurrence when this much rain fell yesterday and today, counting today\'s forecast.'
    : 'Turn on Weather-based tasks in Settings, with location access, so the app can read rainfall. Until then this does nothing.';

  const endMode: 'never' | 'date' | 'count' =
    endDate?.value ? 'date' : recurrenceCount !== null ? 'count' : 'never';

  const monthDaySelected = recurrenceMonthDay !== null && recurrenceMonthDay > 0;

  // Week-ordinal anchoring ("2nd Tuesday") only exists in the recurrence
  // engine for monthly (getNextYearDayOccurrence has no notion of it), so a
  // yearly rule never offers or reads that option even if a prior monthly
  // choice left weekOrdinal.value set behind the scenes.
  const showWeekdayOption = recurrenceType === 'monthly' && !!weekOrdinal;

  // Sub-day recurrence only means anything measured from the moment you
  // check the task off — there's no calendar grid for "every 8 hours" to
  // sit on, so switching to it forces the On schedule/After completion
  // choice below rather than leaving a toggle that would otherwise do
  // nothing (see RecurrenceType's own doc comment on 'hours'). Daily gets
  // the same nudge for a different reason: most daily tasks are habits
  // ("drink water", "stretch") where what matters is that a day passed
  // since the last one, not that today's date matches a grid — so picking
  // Daily defaults to After completion, same as Hours. Either default is
  // just a starting point; the pills below still let it be switched back.
  const handleTypeChange = (type: RecurrenceType) => {
    if ((type === 'hours' || type === 'daily') && !recurrenceFromCompletion) onChangeFromCompletion(true);
    onChangeType(type);
  };

  const monthAnchor: MonthAnchor =
    showWeekdayOption && weekOrdinal?.value != null ? 'weekday'
      : recurrenceMonthDay === -1 ? 'lastDay'
        : monthDaySelected ? 'monthDay'
          : 'dueDate';

  const selectMonthAnchor = (anchor: MonthAnchor) => {
    switch (anchor) {
      case 'dueDate':
        weekOrdinal?.onChange(null);
        onChangeMonthDay(null);
        break;
      case 'monthDay':
        weekOrdinal?.onChange(null);
        onChangeMonthDay(monthDaySelected ? recurrenceMonthDay : seedMonthDay());
        break;
      case 'lastDay':
        weekOrdinal?.onChange(null);
        onChangeMonthDay(-1);
        break;
      case 'weekday':
        if (!showWeekdayOption) break;
        onChangeMonthDay(null);
        weekOrdinal?.onChange(weekOrdinal.value ?? 1);
        if (recurrenceDays.length === 0 && weekOrdinal) onChangeDays([weekOrdinal.seedWeekday()]);
        break;
    }
  };

  const yearMonthAnchor: YearMonthAnchor = recurrenceMonth !== null ? 'month' : 'dueDate';

  const selectYearMonthAnchor = (anchor: YearMonthAnchor) => {
    onChangeMonth(anchor === 'month' ? (recurrenceMonth ?? seedMonth()) : null);
  };

  return (
    <>
      <Group first styles={styles}>
        <SegmentedControl
          label="Repeats"
          value={recurrenceType}
          onChange={handleTypeChange}
          options={(['hours', 'daily', 'weekly', 'monthly', 'yearly'] as RecurrenceType[])
            .map(type => ({ value: type, label: RECURRENCE_LABELS[type] }))}
        />
        <View style={styles.stepperRow}>
          <Text style={styles.stepperLabel}>Every</Text>
          <CountStepper
            value={recurrenceInterval}
            onChange={n => onChangeInterval(n ?? 1)}
            min={1}
            max={MAX_INTERVAL}
            label="Repeat interval"
          />
          <Text style={styles.stepperLabel}>{recurrenceUnitLabel(recurrenceType, recurrenceInterval)}</Text>
        </View>
        {recurrenceType === 'hours' && (
          <Text style={styles.groupHint}>
            Hidden until this many hours after you check it off, not on a fixed calendar day.
          </Text>
        )}
      </Group>

      {recurrenceType === 'weekly' && (
        <Group label="On these days" styles={styles}>
          <WeekdaySelector value={recurrenceDays} onChange={onChangeDays} />
        </Group>
      )}

      {recurrenceType === 'yearly' && (
        <Group label="In which month" styles={styles}>
          <SegmentedControl
            label="In which month"
            value={yearMonthAnchor}
            onChange={selectYearMonthAnchor}
            // Two columns: "Same month as due date" has no one-row spelling that
            // isn't confusable with "On a month".
            columns={2}
            options={[
              { value: 'dueDate' as YearMonthAnchor, label: 'Same month as due date' },
              { value: 'month' as YearMonthAnchor, label: 'On a month' },
            ]}
          />
          {recurrenceMonth !== null && (
            <View style={styles.controlSpaced}>
              <SegmentedControl
                label="Month"
                value={recurrenceMonth}
                onChange={onChangeMonth}
                columns={4}
                options={MONTH_ABBREVIATIONS.map((label, i) => ({ value: i + 1, label }))}
              />
            </View>
          )}
        </Group>
      )}

      {(recurrenceType === 'monthly' || recurrenceType === 'yearly') && (
        <Group
          label="On which day"
          hint={recurrenceType === 'yearly' && recurrenceMonth === null
            ? 'The month stays whatever month the due date falls in; this only sets the day within it.'
            : undefined}
          styles={styles}
        >
          <SegmentedControl
            label="On which day"
            value={monthAnchor}
            onChange={selectMonthAnchor}
            // Two columns: "Same day as due date" has no one-row spelling that
            // isn't confusable with "On a day".
            columns={2}
            options={[
              { value: 'dueDate' as MonthAnchor, label: 'Same day as due date' },
              { value: 'monthDay' as MonthAnchor, label: 'On a day' },
              { value: 'lastDay' as MonthAnchor, label: 'Last day' },
              ...(showWeekdayOption ? [{ value: 'weekday' as MonthAnchor, label: 'On a weekday' }] : []),
            ]}
          />
          {monthDaySelected && (
            <View style={styles.stepperRow}>
              <Text style={styles.stepperLabel}>On the</Text>
              <CountStepper
                value={recurrenceMonthDay}
                onChange={n => onChangeMonthDay(n ?? 1)}
                min={1}
                max={31}
                format={ordinal}
                label="Day of month"
              />
            </View>
          )}
          {showWeekdayOption && weekOrdinal && weekOrdinal.value !== null && (
            <>
              <View style={styles.controlSpaced}>
                <SegmentedControl
                  label="Which week"
                  value={weekOrdinal.value}
                  onChange={weekOrdinal.onChange}
                  options={ORDINAL_OPTIONS.map(({ value, label }) => ({
                    value,
                    label,
                    accessibilityLabel: `${label} week of the month`,
                  }))}
                />
              </View>
              <View style={styles.weekdayRow}>
                <WeekdaySelector value={recurrenceDays} onChange={onlyNewestWeekday(recurrenceDays, onChangeDays)} />
              </View>
            </>
          )}
        </Group>
      )}

      {recurrenceType !== 'hours' && (
        <Group
          label="Next due date"
          hint="After completion counts from the day you check it off, so a late task moves the whole schedule."
          styles={styles}
        >
          <SegmentedControl
            label="Next due date"
            value={recurrenceFromCompletion}
            onChange={onChangeFromCompletion}
            options={[
              { value: false, label: 'On schedule' },
              { value: true, label: 'After completion' },
            ]}
          />
          {!!previewNextDate && (
            <Text style={styles.previewText}>
              {recurrenceFromCompletion
                ? `If checked off today, falls on ${format(previewNextDate, 'EEEE, MMMM d, yyyy')}.`
                : `Falls on ${format(previewNextDate, 'EEEE, MMMM d, yyyy')}.`}
            </Text>
          )}
        </Group>
      )}

      {recurrenceType !== 'hours' && !!onChangeHolidays && (
        <Group label="On a holiday" hint={holidayHint} styles={styles}>
          <SegmentedControl
            label="On a holiday"
            value={recurrenceHolidays ?? null}
            onChange={onChangeHolidays}
            options={HOLIDAY_OPTIONS}
          />
        </Group>
      )}
      {recurrenceType !== 'hours' && !!onChangeRainSkip && (
        <Group label="When it rains" hint={rainHint} styles={styles}>
          <SegmentedControl
            label="Skip after this much rain"
            value={typeof rainSkipMm === 'number' && rainSkipMm > 0 ? rainSkipMm : null}
            onChange={onChangeRainSkip}
            options={rainOptions}
          />
        </Group>
      )}

      <Group label="Ends" styles={styles}>
        <SegmentedControl
          label="Ends"
          value={endMode}
          onChange={mode => {
            if (mode === 'never') onSelectEndNever();
            else if (mode === 'count') onSelectEndCount();
            else endDate?.onSelect();
          }}
          options={[
            { value: 'never' as const, label: neverEndsLabel },
            ...(endDate ? [{ value: 'date' as const, label: 'On date' }] : []),
            { value: 'count' as const, label: afterCountLabel },
          ]}
        />
        {endDate && endMode === 'date' && endDate.value && (
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.endDateChip}
              onPress={() => { haptics.tap(); endDate.onOpenPicker(); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Ends on ${format(endDate.value, 'MMMM d, yyyy')}. Change`}
            >
              <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.accent} />
              <Text style={styles.endDateChipText}>{format(endDate.value, 'MMM d, yyyy')}</Text>
            </TouchableOpacity>
          </View>
        )}
        {endMode === 'count' && (
          <View style={styles.stepperRow}>
            <CountStepper
              value={recurrenceCount ?? 1}
              onChange={n => onChangeCount(n ?? 1)}
              min={1}
              max={MAX_COUNT}
              label="How many times it repeats"
            />
            <Text style={styles.stepperLabel}>{countUnitLabel(recurrenceCount ?? 1)}</Text>
          </View>
        )}
      </Group>
    </>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (colors: Colors) => StyleSheet.create({
  group: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + spacing.xs,
    borderTopWidth: border.thin, borderTopColor: colors.separator,
  },
  // The Repeat row is its own separator, and there's nothing above the group
  // to divide it from.
  groupFirst: { borderTopWidth: 0, paddingTop: spacing.xxs },
  // The app-wide section-header treatment (see the note in CLAUDE.md on
  // uppercase headers), so a group inside the card labels itself the same way
  // a group of cards does.
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.bold,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  groupHint: {
    color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, marginTop: spacing.sm,
  },
  previewText: {
    color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm,
  },
  controlSpaced: { marginTop: spacing.sm + 2 },
  stepperRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm + 2,
  },
  stepperLabel: { color: colors.textSecondary, fontSize: font.md },
  weekdayRow: { marginTop: spacing.sm + 2 },
  endDateChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: 14, minHeight: interaction.pillHeight,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  endDateChipText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
});
