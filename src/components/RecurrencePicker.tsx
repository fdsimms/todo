import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { RecurrenceType } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { recurrenceUnitLabel } from '../utils/recurrenceLabels';
import { WeekdaySelector } from './WeekdaySelector';
import { ordinal } from '../utils/ordinal';

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  none: 'Never',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

// Nth-weekday-of-month picker options ("every 2nd Tuesday", "every last Friday").
export const ORDINAL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
];

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

/**
 * The recurrence rule picker shared by TaskEditor and TemplateItemEditor:
 * daily/weekly/monthly/yearly type pills, the "Every N <unit>" interval
 * stepper, the weekly weekday selector, the monthly sub-picker (same day as
 * due date / on a day / last day / on a weekday), the day-of-month stepper,
 * the on-schedule/after-completion pills, and the ends never/date/count
 * pills with the occurrence-count stepper.
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

  return (
    <>
      <View style={styles.pillRow}>
        {(['daily', 'weekly', 'monthly', 'yearly'] as RecurrenceType[]).map(type => (
          <TouchableOpacity
            key={type}
            style={[styles.pill, recurrenceType === type && styles.pillActive]}
            onPress={() => onChangeType(type)}
          >
            <Text style={[styles.pillText, recurrenceType === type && styles.pillTextActive]}>
              {RECURRENCE_LABELS[type]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.intervalRow}>
        <Text style={styles.intervalLabel}>Every</Text>
        <TouchableOpacity
          style={styles.intervalBtn}
          onPress={() => onChangeInterval(Math.max(1, recurrenceInterval - 1))}
          accessibilityRole="button"
          accessibilityLabel="Decrease recurrence interval"
        >
          <Ionicons name="remove" size={16} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.intervalValue}>{recurrenceInterval}</Text>
        <TouchableOpacity
          style={styles.intervalBtn}
          onPress={() => onChangeInterval(recurrenceInterval + 1)}
          accessibilityRole="button"
          accessibilityLabel="Increase recurrence interval"
        >
          <Ionicons name="add" size={16} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.intervalLabel}>{recurrenceUnitLabel(recurrenceType, recurrenceInterval)}</Text>
      </View>
      {recurrenceType === 'weekly' && (
        <View style={styles.weekdayRow}>
          <WeekdaySelector value={recurrenceDays} onChange={onChangeDays} />
        </View>
      )}
      {recurrenceType === 'monthly' && (
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={[styles.pill, recurrenceMonthDay === null && (weekOrdinal ? weekOrdinal.value === null : true) && styles.pillActive]}
            onPress={() => { onChangeMonthDay(null); weekOrdinal?.onChange(null); }}
          >
            <Text style={[styles.pillText, recurrenceMonthDay === null && (weekOrdinal ? weekOrdinal.value === null : true) && styles.pillTextActive]}>
              Same day as due date
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, recurrenceMonthDay !== null && recurrenceMonthDay > 0 && styles.pillActive]}
            onPress={() => {
              weekOrdinal?.onChange(null);
              onChangeMonthDay(recurrenceMonthDay && recurrenceMonthDay > 0 ? recurrenceMonthDay : seedMonthDay());
            }}
          >
            <Text style={[styles.pillText, recurrenceMonthDay !== null && recurrenceMonthDay > 0 && styles.pillTextActive]}>
              On a day
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, recurrenceMonthDay === -1 && styles.pillActive]}
            onPress={() => { weekOrdinal?.onChange(null); onChangeMonthDay(-1); }}
          >
            <Text style={[styles.pillText, recurrenceMonthDay === -1 && styles.pillTextActive]}>
              Last day
            </Text>
          </TouchableOpacity>
          {weekOrdinal && (
            <TouchableOpacity
              style={[styles.pill, weekOrdinal.value !== null && styles.pillActive]}
              onPress={() => {
                onChangeMonthDay(null);
                weekOrdinal.onChange(weekOrdinal.value ?? 1);
                if (recurrenceDays.length === 0) onChangeDays([weekOrdinal.seedWeekday()]);
              }}
            >
              <Text style={[styles.pillText, weekOrdinal.value !== null && styles.pillTextActive]}>
                On a weekday
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {recurrenceType === 'monthly' && recurrenceMonthDay !== null && recurrenceMonthDay > 0 && (
        <View style={styles.intervalRow}>
          <Text style={styles.intervalLabel}>On the</Text>
          <TouchableOpacity
            style={styles.intervalBtn}
            onPress={() => onChangeMonthDay(Math.max(1, recurrenceMonthDay - 1))}
            accessibilityRole="button"
            accessibilityLabel="Decrease day of month"
          >
            <Ionicons name="remove" size={16} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.intervalValue}>{ordinal(recurrenceMonthDay)}</Text>
          <TouchableOpacity
            style={styles.intervalBtn}
            onPress={() => onChangeMonthDay(Math.min(31, recurrenceMonthDay + 1))}
            accessibilityRole="button"
            accessibilityLabel="Increase day of month"
          >
            <Ionicons name="add" size={16} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}
      {weekOrdinal && recurrenceType === 'monthly' && weekOrdinal.value !== null && (
        <>
          <View style={styles.pillRow}>
            {ORDINAL_OPTIONS.map(({ value, label }) => (
              <TouchableOpacity
                key={value}
                style={[styles.pill, weekOrdinal.value === value && styles.pillActive]}
                onPress={() => weekOrdinal.onChange(value)}
              >
                <Text style={[styles.pillText, weekOrdinal.value === value && styles.pillTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.weekdayRow}>
            <WeekdaySelector value={recurrenceDays} onChange={onlyNewestWeekday(recurrenceDays, onChangeDays)} />
          </View>
        </>
      )}
      <View style={styles.pillRow}>
        <TouchableOpacity
          style={[styles.pill, !recurrenceFromCompletion && styles.pillActive]}
          onPress={() => onChangeFromCompletion(false)}
        >
          <Text style={[styles.pillText, !recurrenceFromCompletion && styles.pillTextActive]}>
            On schedule
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, recurrenceFromCompletion && styles.pillActive]}
          onPress={() => onChangeFromCompletion(true)}
        >
          <Text style={[styles.pillText, recurrenceFromCompletion && styles.pillTextActive]}>
            After completion
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.pillRow}>
        {endDate && <Text style={[styles.intervalLabel, styles.endsLabel]}>Ends</Text>}
        <TouchableOpacity
          style={[styles.pill, endMode === 'never' && styles.pillActive]}
          onPress={onSelectEndNever}
        >
          <Text style={[styles.pillText, endMode === 'never' && styles.pillTextActive]}>
            {neverEndsLabel}
          </Text>
        </TouchableOpacity>
        {endDate && (
          <TouchableOpacity
            style={[styles.pill, endMode === 'date' && styles.pillActive]}
            onPress={endDate.onSelect}
          >
            <Text style={[styles.pillText, endMode === 'date' && styles.pillTextActive]}>
              On date
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.pill, endMode === 'count' && styles.pillActive]}
          onPress={onSelectEndCount}
        >
          <Text style={[styles.pillText, endMode === 'count' && styles.pillTextActive]}>
            {afterCountLabel}
          </Text>
        </TouchableOpacity>
      </View>
      {endDate && endMode === 'date' && endDate.value && (
        <View style={styles.endDateRow}>
          <TouchableOpacity
            style={styles.endDateChip}
            onPress={endDate.onOpenPicker}
            activeOpacity={interaction.activeOpacity}
          >
            <Ionicons name="calendar-outline" size={14} color={colors.accent} />
            <Text style={styles.endDateChipText}>{format(endDate.value, 'MMM d, yyyy')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {endMode === 'count' && (
        <View style={styles.intervalRow}>
          <Text style={styles.intervalLabel}>After</Text>
          <TouchableOpacity
            style={styles.intervalBtn}
            onPress={() => onChangeCount(c => Math.max(1, (c ?? 1) - 1))}
            accessibilityRole="button"
            accessibilityLabel="Decrease occurrence count"
          >
            <Ionicons name="remove" size={16} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.intervalValue}>{recurrenceCount ?? 1}</Text>
          <TouchableOpacity
            style={styles.intervalBtn}
            onPress={() => onChangeCount(c => (c ?? 0) + 1)}
            accessibilityRole="button"
            accessibilityLabel="Increase occurrence count"
          >
            <Ionicons name="add" size={16} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.intervalLabel}>{countUnitLabel(recurrenceCount ?? 1)}</Text>
        </View>
      )}
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  pillRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    // Without an explicit width, a wrapping row's own width is sized to fit
    // its content rather than stretched to the sheet's width — so it never
    // hits a boundary to wrap against and just runs past the card's edge
    // instead (clipped there by the card's `overflow: hidden`). This row is
    // usually short enough not to show it, but the monthly day-anchor row
    // (four pills, one of them long) is wide enough to need the wrap.
    alignSelf: 'stretch',
  },
  pill: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  pillActive: { backgroundColor: colors.accent },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.bg },
  intervalRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  intervalLabel: { color: colors.textSecondary, fontSize: font.sm },
  intervalBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  intervalValue: {
    color: colors.text, fontSize: font.md, fontWeight: '600',
    minWidth: 24, textAlign: 'center',
  },
  weekdayRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  endsLabel: { marginRight: spacing.xs },
  endDateRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  endDateChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  endDateChipText: { color: colors.accent, fontSize: font.sm, fontWeight: '500' },
});
