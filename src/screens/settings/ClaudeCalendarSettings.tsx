import React, { useState, useMemo } from 'react';
import { View, Alert, AppState, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { Calendar as DeviceCalendar } from 'expo-calendar/legacy';
import { useSettingsStore } from '../../store/useSettingsStore';
import { dbGetDeviceId } from '../../db/database';
import { drainCalendarRequests } from '../../utils/calendarRequestDrain';
import { isCalendarRequestWriter } from '../../utils/calendarRequests';
import {
  getCalendarPermission,
  listWritableCalendars,
  requestCalendarPermission,
  type CalendarPermission,
} from '../../utils/calendarSync';
import { useColors } from '../../theme/ThemeContext';
import { animateLayout } from '../../utils/layoutAnimation';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsChoiceTray } from './SettingsChoiceTray';
import { makeSettingsStyles } from './settingsStyles';

/** The tray's explicit "no calendar" option — `''` because ids are never empty. */
const OFF_OPTION = { id: '', title: 'Off' };

/**
 * Which calendar the events Claude asks for go into, and whether this is the
 * device that writes them (`calendarRequestDrain.ts`, `docs/arch/mcp-server.md`).
 *
 * Same shape as `DeadlineCalendarSettings`: picking a calendar is the switch.
 * It also makes this the one device that writes them, which is a synced
 * setting, so picking one here switches off whichever device had it before.
 * Two devices writing the same request would put it on a shared calendar twice.
 */
export function ClaudeCalendarSettings() {
  const writerId = useSettingsStore(s => s.calendarRequestDeviceId);
  const requestCalendarId = useSettingsStore(s => s.calendarRequestCalendarId);
  const setCalendarRequestCalendar = useSettingsStore(s => s.setCalendarRequestCalendar);
  const selfId = useMemo(() => dbGetDeviceId(), []);
  const here = isCalendarRequestWriter(writerId, selfId);
  // Only this device's own choice counts: a calendar id left behind from
  // before another device took over names nothing that is being written to.
  const chosenCalendarId = here ? requestCalendarId : null;
  const elsewhere = !!writerId && !here;

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  const [permission, setPermission] = useState<CalendarPermission | null>(null);
  const [calendars, setCalendars] = useState<DeviceCalendar[] | null>(null);
  const refreshState = React.useCallback(() => {
    getCalendarPermission()
      .then(async result => {
        setPermission(result);
        setCalendars(result === 'granted' ? await listWritableCalendars() : null);
      })
      .catch(() => setPermission(null));
  }, []);

  // Same reasoning as CalendarSettings: the permission row can send someone
  // to the system Settings app, which doesn't unfocus this screen, and which
  // calendars are writable can change while they're over there.
  useFocusEffect(
    React.useCallback(() => {
      refreshState();
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') refreshState();
      });
      return () => sub.remove();
    }, [refreshState])
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const togglePicker = () => {
    animateLayout();
    setPickerOpen(!pickerOpen);
  };

  const selected = (calendars ?? []).find(c => c.id === chosenCalendarId) ?? null;
  // The picked calendar isn't writable any more — deleted, or its
  // allowsModifications flag changed underneath the app.
  const missing = !!chosenCalendarId && calendars !== null && !selected;

  const summary = chosenCalendarId
    ? (selected ? selected.title : missing ? undefined : 'Checking…')
    : undefined;
  const offHint = elsewhere
    ? 'Another device adds them. Pick a calendar to add them on this one instead'
    : 'Off. Claude can’t add events to your calendar';

  /**
   * First tap: permission, then the calendar list, then the picker. Nothing
   * is written until a calendar is actually chosen in the tray below —
   * asking here and then showing an empty list would be a dead end.
   */
  const onOpen = async () => {
    if (permission === 'denied') {
      Linking.openSettings();
      return;
    }
    if (permission !== 'granted' && !(await requestCalendarPermission())) {
      refreshState();
      Alert.alert(
        'Calendar access is off',
        'This needs permission to write to your calendar. Turn it on for this app in the Settings app, then try again.'
      );
      return;
    }
    refreshState();
    const list = await listWritableCalendars();
    setCalendars(list);
    if (list.length === 0 && !chosenCalendarId) {
      // Every calendar on the device is read-only — a shared or subscribed
      // one, most often. There's genuinely nothing to pick.
      Alert.alert(
        'No calendar you can write to',
        'Every calendar on this device is read-only. Add or unlock one you can edit in the Settings app under Calendar › Accounts.'
      );
      return;
    }
    animateLayout();
    setPickerOpen(true);
  };

  return (
    <SettingsSection
      label="Claude’s events on your calendar"
      footer="When Claude is connected through your sync server and you ask it to add an event, this device adds it to the calendar you pick here the next time it syncs. Only one device adds them, so picking a calendar here turns this off on any other device. Claude can’t see your calendar, and it never changes or deletes an event once it’s added."
    >
      <SettingsRow
        entryId="claudeCalendar"
        icon="calendar-outline"
        iconColor={chosenCalendarId ? colors.accent : undefined}
        label="Add Claude’s events to"
        hint={summary
          ? `Adds the events Claude asks for to “${summary}”`
          : missing ? undefined : offHint}
        value={summary ?? undefined}
        expanded={pickerOpen}
        onPress={() => { if (permission === 'granted') togglePicker(); else onOpen(); }}
        accessibilityLabel="Which calendar the events Claude asks for are added to"
      />

      {(pickerOpen || permission === 'denied') && (
        <>
          <View style={styles.sep} />
          {permission === 'denied' ? (
            <SettingsRow
              icon="lock-closed-outline"
              iconColor={colors.warning}
              label="Calendar access"
              hint="Blocked. Nothing can be written until you turn it back on for this app."
              value="Open Settings"
              onPress={() => Linking.openSettings()}
              accessibilityLabel="Calendar access is blocked. Opens the system Settings app."
            />
          ) : (
            <SettingsChoiceTray
              caption="Add to"
              options={[OFF_OPTION, ...(calendars ?? []).map(c => ({ id: c.id, title: c.title }))]}
              selectedId={chosenCalendarId ?? OFF_OPTION.id}
              onSelect={option => {
                setCalendarRequestCalendar(option.id || null);
                togglePicker();
                // Anything already waiting is written now, not at the next sync.
                if (option.id) void drainCalendarRequests();
              }}
              emptyText="Every calendar on this device is read-only. Add or unlock one you can edit in the Settings app under Calendar › Accounts."
              accessibilityLabelFor={option => (option.id ? `Add to ${option.title}` : 'Off')}
            />
          )}
        </>
      )}

      {/* Only worth saying once it's biting: the picked calendar went away
          and the feature is now silently writing nothing. */}
      {missing && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="alert-circle-outline"
            iconColor={colors.warning}
            label="That calendar isn’t on this device"
            hint="Pick again above, or turn this off."
          />
        </>
      )}
    </SettingsSection>
  );
}
