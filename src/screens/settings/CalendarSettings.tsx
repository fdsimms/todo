import React, { useState, useMemo } from 'react';
import { View, Alert, AppState, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { addDays } from 'date-fns/addDays';
import type { Calendar as DeviceCalendar } from 'expo-calendar';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useCalendarStore } from '../../store/useCalendarStore';
import {
  getCalendarPermission,
  listEventCalendars,
  requestCalendarPermission,
  type CalendarPermission,
} from '../../utils/calendarSync';
import { busyMinutesIn, eventsIn, nextEventAfter } from '../../utils/calendarBusy';
import { formatDuration } from '../../utils/effort';
import { getDayStart, formatTimeOfDay } from '../../utils/dateUtils';
import { useColors } from '../../theme/ThemeContext';
import { animateLayout } from '../../utils/layoutAnimation';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsChoiceTray } from './SettingsChoiceTray';
import { makeSettingsStyles } from './settingsStyles';

/**
 * Reading the device calendar.
 *
 * Sits beside the Apple Reminders import because they're the same integration
 * surface — both are EventKit, both are iOS-only, both are a permission the
 * user grants to a specific list — but it is the opposite kind of feature:
 * that one moves things and deletes them, this one only ever looks. So there is
 * no confirmation alert here and no count to name. Nothing is written, so
 * nothing needs guarding.
 *
 * "Google Calendar" is what most people are after, and a Google account added
 * on the device surfaces its calendars here like any other. The app never asks
 * which service is behind one — see #1495.
 */
export function CalendarSettings() {
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const setCalendarReadEnabled = useSettingsStore(s => s.setCalendarReadEnabled);
  const calendarIds = useSettingsStore(s => s.calendarIds);
  const setCalendarIds = useSettingsStore(s => s.setCalendarIds);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const use24HourTime = useSettingsStore(s => s.use24HourTime);
  const events = useCalendarStore(s => s.events);
  const loaded = useCalendarStore(s => s.loaded);
  const refreshEvents = useCalendarStore(s => s.refresh);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  // Re-read on focus *and* on foreground, for the reason the Reminders screen
  // gives: the permission row sends people to the system Settings app, which
  // doesn't unfocus this screen, and the set of calendars can change while
  // they're over there — adding the Google account is exactly that.
  const [permission, setPermission] = useState<CalendarPermission | null>(null);
  const [calendars, setCalendars] = useState<DeviceCalendar[] | null>(null);
  const refreshState = React.useCallback(() => {
    getCalendarPermission()
      .then(async result => {
        setPermission(result);
        setCalendars(result === 'granted' ? await listEventCalendars() : null);
      })
      .catch(() => setPermission(null));
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refreshState();
      refreshEvents();
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') refreshState();
      });
      return () => sub.remove();
    }, [refreshState, refreshEvents])
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const togglePicker = () => {
    animateLayout();
    setPickerOpen(!pickerOpen);
  };

  const selected = (calendars ?? []).filter(c => calendarIds.includes(c.id));
  const missingCount = calendarIds.length - selected.length;
  const summary =
    selected.length === 0 ? undefined
    : selected.length === 1 ? selected[0].title
    : `${selected.length} calendars`;
  const readingHint =
    selected.length === 0 ? undefined
    : selected.length === 1 ? `Events in “${selected[0].title}” are read`
    : `Events in ${selected.length} calendars are read`;

  /**
   * What the app can currently see, said back. The one row that proves the
   * whole thing is working — every other consumer of this read is on another
   * screen, so without it turning the switch on shows nothing at all.
   */
  const todaySummary = (): string => {
    if (!loaded) return 'Checking…';
    const start = getDayStart(new Date(), dayResetTime);
    const end = addDays(start, 1);
    const today = eventsIn(events, start, end);
    if (today.length === 0) return 'Nothing on today';
    const busy = busyMinutesIn(events, start, end);
    const next = nextEventAfter(events, new Date(), end);
    const count = `${today.length} event${today.length === 1 ? '' : 's'}`;
    // Busy can be zero with events on — an all-day birthday, or something
    // marked Free. Saying "0m booked" there would read as a bug.
    const booked = busy > 0 ? ` · ${formatDuration(busy)} booked` : '';
    const upcoming = next ? ` · next ${next.title || 'event'} at ${formatTimeOfDay(new Date(next.start), use24HourTime)}` : '';
    return `${count}${booked}${upcoming}`;
  };

  const toggleCalendar = (item: DeviceCalendar) => {
    const next = calendarIds.includes(item.id)
      ? calendarIds.filter(id => id !== item.id)
      : [...calendarIds, item.id];
    setCalendarIds(next);
    // The switch follows the set both ways. Picking the first calendar is the
    // moment the feature has something to do, and un-picking the last leaves it
    // claiming to read something it isn't — turning it off is what makes the
    // row above tell the truth.
    if (next.length > 0 && !calendarReadEnabled) setCalendarReadEnabled(true);
    if (next.length === 0 && calendarReadEnabled) setCalendarReadEnabled(false);
  };

  /**
   * Turning it on: permission, then calendars, then the picker. Nothing is
   * enabled until a calendar is chosen — with none picked the feature reads
   * nothing, so the switch would be on and inert.
   */
  const onToggle = async () => {
    if (calendarReadEnabled) {
      setCalendarReadEnabled(false);
      return;
    }
    if (permission === 'denied') {
      Linking.openSettings();
      return;
    }
    if (permission !== 'granted' && !(await requestCalendarPermission())) {
      refreshState();
      Alert.alert(
        'Calendar access is off',
        'This needs permission to read your calendars. Turn it on for this app in the Settings app, then try again.'
      );
      return;
    }
    refreshState();
    const list = await listEventCalendars();
    setCalendars(list);
    if (list.length === 0) {
      // The failure this feature will actually hit: someone who reads their
      // calendar in the Google Calendar app and has never added the account to
      // the device. There is nothing to pick, and no other screen will say why.
      Alert.alert(
        'No calendars on this device',
        'To read a Google calendar here, add the account in the Settings app under Calendar › Accounts. Calendars from any account you add there show up in the list.'
      );
      return;
    }
    // Calendars picked before it was last switched off — nothing to choose
    // again.
    if (calendarIds.length > 0) {
      setCalendarReadEnabled(true);
      return;
    }
    animateLayout();
    setPickerOpen(true);
  };

  const showCalendarsRow = permission === 'granted' && (calendarReadEnabled || pickerOpen);

  return (
    <SettingsSection
      label="Calendar"
      footer="Reads the calendars you pick, so the app knows what else is on a day. Nothing is added, changed or deleted — this is read-only. A Google calendar shows up here once the account is added in the Settings app under Calendar › Accounts; it's read the same way as any other calendar. An event marked Free, and anything lasting all day, doesn't count as time taken."
    >
      <SettingsRow
        icon="calendar-outline"
        iconColor={calendarReadEnabled ? colors.accent : undefined}
        label="Read my calendar"
        hint={calendarReadEnabled
          ? readingHint ?? 'The calendars it was reading are no longer on this device'
          : 'Nothing is read from your calendar'}
        toggle={calendarReadEnabled}
        onPress={onToggle}
        accessibilityLabel="Read my calendar"
      />

      {/* Denied stays visible with the feature off — that's the state where
          the switch above looks broken. */}
      {(calendarReadEnabled || permission === 'denied') && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon={permission === 'granted' ? 'lock-open-outline' : 'lock-closed-outline'}
            iconColor={
              permission === 'granted' ? colors.accent
              : permission === 'denied' ? colors.warning
              : undefined
            }
            label="Calendar access"
            hint={
              permission === 'granted' ? 'Allowed — this app can read the calendars below'
              : permission === 'denied' ? 'Blocked. Nothing can be read until you turn it back on for this app.'
              : permission === 'undetermined' ? 'Not enabled yet — nothing can be read until you allow it'
              : permission === 'unsupported' ? 'Not available on this platform'
              : 'Checking…'
            }
            value={
              permission === 'denied' ? 'Open Settings'
              : permission === 'undetermined' ? 'Allow'
              : undefined
            }
            onPress={
              permission === 'denied' ? () => Linking.openSettings()
              : permission === 'undetermined' ? async () => {
                  await requestCalendarPermission();
                  refreshState();
                }
              : undefined
            }
            accessibilityLabel={
              permission === 'granted' ? 'Calendar access is allowed'
              : permission === 'denied' ? 'Calendar access is blocked. Opens the system Settings app.'
              : permission === 'undetermined' ? 'Calendar access not enabled yet. Double tap to allow.'
              : 'Calendar access'
            }
          />
        </>
      )}

      {showCalendarsRow && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="list-outline"
            iconColor={colors.accent}
            label="Calendars"
            hint={summary ? undefined : 'Which calendars to read'}
            value={summary}
            expanded={pickerOpen}
            onPress={togglePicker}
            accessibilityLabel="Choose which calendars to read"
          />
          {pickerOpen && (
            <SettingsChoiceTray
              caption="Read"
              options={(calendars ?? []).map(c => ({ id: c.id, title: c.title }))}
              selectedIds={calendarIds}
              onSelect={option => {
                const match = (calendars ?? []).find(c => c.id === option.id);
                if (match) toggleCalendar(match);
              }}
              emptyText="There are no calendars on this device. Add an account in the Settings app under Calendar › Accounts."
              accessibilityLabelFor={option => `Read ${option.title}`}
            />
          )}
        </>
      )}

      {/* Only worth saying once it's biting: a calendar removed from the
          device leaves its id here, and the feature quietly reads less. */}
      {calendarReadEnabled && permission === 'granted' && calendars !== null && missingCount > 0 && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="alert-circle-outline"
            iconColor={colors.warning}
            label={missingCount === calendarIds.length
              ? 'Those calendars aren’t on this device'
              : `${missingCount} chosen calendar${missingCount === 1 ? ' isn’t' : 's aren’t'} on this device`}
            hint="Pick again above, or turn this off."
          />
        </>
      )}

      {calendarReadEnabled && permission === 'granted' && selected.length > 0 && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="today-outline"
            iconColor={colors.accent}
            label="Today"
            hint={todaySummary()}
            accessibilityLabel={`Today: ${todaySummary()}`}
          />
        </>
      )}
    </SettingsSection>
  );
}
