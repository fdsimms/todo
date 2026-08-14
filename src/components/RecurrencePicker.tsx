import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { RecurrenceType } from '../types';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { ORDINAL_OPTIONS, recurrenceUnitLabel } from '../utils/recurrenceLabels';
import { WeekdaySelector } from './WeekdaySelector';
import { CountStepper } from './CountStepper';
import { SegmentedControl } from './SegmentedControl';
import { haptics } from '../utils/haptics';
import { ordinal } from '../utils/ordinal';

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  none: 'Never',
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
  recurrenceFromCompletion: boolean;
  onChangeFromCompletion: (fromCompletion: boolean) => void;
  recurrenceCount: number | null;
  onChangeCount: (updater: number | null | ((c: number | null) => number | null)) => void;
  /** How to phrase the occurrence-count stepper's unit — TaskEditor pluralizes ("occurrence"/"occurrences"), TemplateItemEditor always says "occurrences". */
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
}

/** The monthly day-anchor modes, as one closed set the picker can switch on. */
type MonthAnchor = 'dueDate' | 'monthDay' | 'lastDay' | 'weekday';

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
 * stepper, the weekly weekday selector, the monthly sub-picker (same day as
 * due date / on a day / last day / on a weekday), the day-of-month stepper,
 * the on-schedule/after-completion pills, and the ends never/date/count
 * pills with the occurrence-count stepper.
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
  recurrenceFromCompletion, onChangeFromCompletion,
  recurrenceCount, onChangeCount,
  countUnitLabel = (count) => (count === 1 ? 'occurrence' : 'occurrences'),
  weekOrdinal,
  neverEndsLabel = 'Never',
  afterCountLabel = 'After',
  onSelectEndNever, onSelectEndCount,
  endDate,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const endMode: 'never' | 'date' | 'count' =
    endDate?.value ? 'date' : recurrenceCount !== null ? 'count' : 'never';

  const monthDaySelected = recurrenceMonthDay !== null && recurrenceMonthDay > 0;

  const monthAnchor: MonthAnchor =
    weekOrdinal?.value != null ? 'weekday'
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
        onChangeMonthDay(null);
        weekOrdinal?.onChange(weekOrdinal.value ?? 1);
        if (recurrenceDays.length === 0 && weekOrdinal) onChangeDays([weekOrdinal.seedWeekday()]);
        break;
    }
  };

  return (
    <>
      <Group first styles={styles}>
        <SegmentedControl
          label="Repeats"
          value={recurrenceType}
          onChange={onChangeType}
          options={(['daily', 'weekly', 'monthly', 'yearly'] as RecurrenceType[])
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
      </Group>

      {recurrenceType === 'weekly' && (
        <Group label="On these days" styles={styles}>
          <WeekdaySelector value={recurrenceDays} onChange={onChangeDays} />
        </Group>
      )}

      {recurrenceType === 'monthly' && (
        <Group label="On which day" styles={styles}>
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
              ...(weekOrdinal ? [{ value: 'weekday' as MonthAnchor, label: 'On a weekday' }] : []),
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
          {weekOrdinal && weekOrdinal.value !== null && (
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
      </Group>

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
              label="Occurrence count"
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
  groupFirst: { borderTopWidth: 0, paddingTop: 2 },
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
