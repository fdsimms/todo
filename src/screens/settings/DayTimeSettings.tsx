import React, { useState, useMemo } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSettingsStore, type WeekStart } from '../../store/useSettingsStore';
import { dateToHHMM, hhmmToDate } from '../../utils/clockTime';
import { applyDaySegmentTime, type DaySegmentKey, type DaySegmentTimes } from '../../utils/daySegments';
import { formatHHMM } from '../../utils/dateUtils';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { InlineTimePicker } from './InlineTimePicker';
import { makeSettingsStyles } from './settingsStyles';
import { getCurrentDayStart } from '../../utils/dateUtils';
import { dateToHHMM as clockOf } from '../../utils/clockTime';
import { sunEventsForDay } from '../../utils/sunTimes';
import { getCurrentLocation, requestLocationPermission } from '../../utils/weatherLocation';

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
    sunLocation, setSunLocation,
  } = useSettingsStore();
  const [sunLocationStatus, setSunLocationStatus] = useState<'idle' | 'asking' | 'failed'>('idle');

  // Read only from this tap (and the task editor's), never in the background.
  // Stored rounded to about a kilometer (setSunLocation).
  const saveCurrentLocation = async () => {
    setSunLocationStatus('asking');
    const granted = await requestLocationPermission();
    const loc = granted ? await getCurrentLocation() : null;
    if (!loc) { setSunLocationStatus('failed'); return; }
    setSunLocation(loc);
    setSunLocationStatus('idle');
  };

  const sunToday = sunLocation ? sunEventsForDay(getCurrentDayStart(), sunLocation) : null;
  const sunLocationHint = sunLocationStatus === 'failed'
    ? 'Couldn\u2019t read your location. Allow Location for dundundun in the Settings app, then try again.'
    : !sunLocation
      ? 'Not set yet. Tap to use where you are now.'
      : sunToday?.sunrise && sunToday.sunset
        ? `Today: sunrise ${formatHHMM(clockOf(sunToday.sunrise))}, sunset ${formatHHMM(clockOf(sunToday.sunset))}. Tap to update it to where you are now.`
        : 'The sun doesn\u2019t rise or set there today. Tap to update it to where you are now.';

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

  /**
   * The four boundaries as they stand. `dayResetTime` is Morning's, since
   * `setDayResetTime` writes both it and `morningStart` (see that setter).
   */
  const segmentTimes = (): DaySegmentTimes => ({
    morning: dayResetTime!,
    afternoon: afternoonStart!,
    evening: eveningStart!,
    night: nightStart!,
  });

  /**
   * Writes a segment boundary and whichever of the later ones it carries with
   * it, so the four can't be left out of order — see `applyDaySegmentTime` for
   * what that broke. Only the values that actually changed are written, so a
   * confirm that moves nothing else touches nothing else.
   */
  const setSegment = (key: DaySegmentKey, hhmm: string) => {
    const before = segmentTimes();
    const after = applyDaySegmentTime(before, key, hhmm);
    if (after.morning !== before.morning) setDayResetTime(after.morning);
    if (after.afternoon !== before.afternoon) setAfternoonStart(after.afternoon);
    if (after.evening !== before.evening) setEveningStart(after.evening);
    if (after.night !== before.night) setNightStart(after.night);
  };

  const confirmPicker = () => {
    const hhmm = dateToHHMM(pickerDate);
    if (openPickerKey === 'dayReset') setSegment('morning', hhmm);
    else if (openPickerKey === 'afternoon') setSegment('afternoon', hhmm);
    else if (openPickerKey === 'evening') setSegment('evening', hhmm);
    else if (openPickerKey === 'night') setSegment('night', hhmm);
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
          { first: true, hint: 'The new day starts and streaks reset at this time' })}
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
        label="Sunrise and sunset"
        footer="A task's time window can start or end at sunrise or sunset, or up to three hours either side. The times are worked out on this phone from the location saved here, which is never sent anywhere. On the days of a trip, the destination's times are used instead once its page has looked it up (with Destination forecast on)."
      >
        <SettingsRow
          entryId="sunLocation"
          icon="sunny-outline"
          iconColor={colors.accent}
          label="Location for sun times"
          hint={sunLocationHint}
          alwaysShowHint
          value={sunLocation ? 'Saved' : 'Not set'}
          busy={sunLocationStatus === 'asking'}
          onPress={saveCurrentLocation}
        />
        {sunLocation && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              icon="close-circle-outline"
              label="Clear location"
              hint="A window set to follow the sun keeps the last clock time it was set to."
              onPress={() => { setSunLocation(null); setSunLocationStatus('idle'); }}
            />
          </>
        )}
      </SettingsSection>

      <SettingsSection
        label="How times read"
        footer={'Week start decides which day each week begins on in the calendar, and what "this week" counts in Stats.'}
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
