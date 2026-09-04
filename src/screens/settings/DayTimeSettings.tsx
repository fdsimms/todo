import React, { useState, useMemo } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSettingsStore, type WeekStart } from '../../store/useSettingsStore';
import { dateToHHMM, hhmmToDate } from '../../utils/clockTime';
import { formatHHMM } from '../../utils/dateUtils';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { InlineTimePicker } from './InlineTimePicker';
import { makeSettingsStyles } from './settingsStyles';

type SegmentKey = 'dayReset' | 'afternoon' | 'evening' | 'night' | 'activeStart' | 'activeEnd';

const WEEK_START_OPTIONS: SegmentOption<WeekStart>[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

export function DayTimeSettings() {
  const {
    dayResetTime, setDayResetTime,
    afternoonStart, setAfternoonStart,
    eveningStart, setEveningStart,
    nightStart, setNightStart,
    activeHoursStart, setActiveHoursStart,
    activeHoursEnd, setActiveHoursEnd,
    use24HourTime, setUse24HourTime,
    weekStartsOn, setWeekStartsOn,
  } = useSettingsStore();

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  const [openPickerKey, setOpenPickerKey] = useState<SegmentKey | null>(null);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());

  // Coming back to the screen shouldn't find a spinner still hanging open
  // under a row from last time.
  useFocusEffect(React.useCallback(() => { setOpenPickerKey(null); }, []));

  const currentOf = (key: SegmentKey): string => (
    key === 'dayReset' ? dayResetTime!
    : key === 'afternoon' ? afternoonStart!
    : key === 'evening' ? eveningStart!
    : key === 'night' ? nightStart!
    : key === 'activeStart' ? activeHoursStart!
    : activeHoursEnd!
  );

  const openPicker = (key: SegmentKey) => {
    if (openPickerKey === key) { setOpenPickerKey(null); return; }
    setPickerDate(hhmmToDate(currentOf(key)));
    setOpenPickerKey(key);
  };

  const confirmPicker = () => {
    const hhmm = dateToHHMM(pickerDate);
    if (openPickerKey === 'dayReset') setDayResetTime(hhmm);
    else if (openPickerKey === 'afternoon') setAfternoonStart(hhmm);
    else if (openPickerKey === 'evening') setEveningStart(hhmm);
    else if (openPickerKey === 'night') setNightStart(hhmm);
    else if (openPickerKey === 'activeStart') setActiveHoursStart(hhmm);
    else if (openPickerKey === 'activeEnd') setActiveHoursEnd(hhmm);
    setOpenPickerKey(null);
  };

  /** Separator goes *before* each row but the first, so no hairline is left
   *  hanging on the card's bottom edge. */
  const segment = (
    key: SegmentKey, label: string, icon: string, value: string,
    opts: { first?: boolean; hint?: string } = {}
  ) => (
    <React.Fragment key={key}>
      {!opts.first && <View style={styles.sep} />}
      <SettingsRow
        entryId={key}
        icon={icon}
        iconColor={colors.accent}
        label={label}
        hint={opts.hint}
        value={value}
        onPress={() => openPicker(key)}
      />
      {openPickerKey === key && (
        <InlineTimePicker
          value={pickerDate}
          onChange={setPickerDate}
          onCancel={() => setOpenPickerKey(null)}
          onConfirm={confirmPicker}
        />
      )}
    </React.Fragment>
  );

  return (
    <>
      <SettingsSection
        label="When the day turns over"
        footer={'Set Morning to 2:00 AM or later if you’re often up past midnight and don’t want today’s tasks to vanish before you’re done. A task with a time-of-day segment appears once its part of the day begins.'}
      >
        {/* dayResetTime, which is what this row's picker opens on, what its
            confirm writes and what its hint describes. It used to display
            morningStart instead, and the two are only equal because
            setDayResetTime writes both — so out of the box, where the defaults
            are 00:00 and 06:00, the row read "6:00 AM" over a day that flipped
            at midnight, and stayed wrong until the row was touched once. A
            restore or a sync merge can part them the same way. */}
        {segment('dayReset', 'Morning', 'sunny', formatHHMM(dayResetTime!),
          { first: true, hint: '"Today" flips and streaks reset at this time' })}
        {segment('afternoon', 'Afternoon starts', 'partly-sunny', formatHHMM(afternoonStart))}
        {segment('evening', 'Evening starts', 'moon-outline', formatHHMM(eveningStart))}
        {segment('night', 'Night starts', 'moon', formatHHMM(nightStart))}
      </SettingsSection>

      <SettingsSection
        label="Awake hours"
        footer="A daily target's progress is measured against these hours, so one you haven't started by 8am isn't counted as behind for the whole day."
      >
        {segment('activeStart', 'Awake from', 'speedometer-outline', formatHHMM(activeHoursStart), { first: true })}
        {segment('activeEnd', 'Awake until', 'speedometer-outline', formatHHMM(activeHoursEnd))}
      </SettingsSection>

      <SettingsSection
        label="How times read"
        footer={'Week start decides which day the month grids begin on, and what "this week" counts in Stats.'}
      >
        <SettingsRow
          entryId="use24HourTime"
          icon="time-outline"
          iconColor={use24HourTime ? colors.accent : undefined}
          label="24-hour time"
          toggle={use24HourTime}
          onPress={() => setUse24HourTime(!use24HourTime)}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="weekStartsOn"
          icon="calendar-outline"
          iconColor={colors.accent}
          label="Week starts on"
          tight
        />
        <SettingsSegments
          attached
          options={WEEK_START_OPTIONS}
          selected={weekStartsOn}
          onSelect={setWeekStartsOn}
          accessibilityLabelFor={o => `Week starts on ${o.label}`}
        />
      </SettingsSection>
    </>
  );
}
