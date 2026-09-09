import React, { useState, useMemo } from 'react';
import { View, Alert, AppState, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { Calendar as DeviceCalendar } from 'expo-calendar/legacy';
import { useSettingsStore } from '../../store/useSettingsStore';
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
 * Where a task's completion goes when it's logged onto the calendar — the
 * extension of the "write to calendar" family `DeadlineCalendarSettings`
 * started, for a different question: not "when is this due" but "when did
 * I finish this".
 *
 * There is no separate on/off switch: which calendar to write into *is* the
 * switch. With none picked there's nothing for a task's own "Log to
 * calendar" toggle (in the task editor) to write to, so picking one here is
 * what turns the feature on, same as `deadlineCalendarId`.
 */
export function CompletionCalendarSettings() {
  const completionCalendarId = useSettingsStore(s => s.completionCalendarId);
  const setCompletionCalendarId = useSettingsStore(s => s.setCompletionCalendarId);

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

  const selected = (calendars ?? []).find(c => c.id === completionCalendarId) ?? null;
  // The picked calendar isn't writable any more — deleted, or its
  // allowsModifications flag changed underneath the app.
  const missing = !!completionCalendarId && calendars !== null && !selected;

  const summary = completionCalendarId
    ? (selected ? selected.title : missing ? undefined : 'Checking…')
    : undefined;

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
    if (list.length === 0 && !completionCalendarId) {
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
      label="Completions on your calendar"
      footer="Adds a calendar event when a task with “Log to calendar” turned on in its own editor is completed, never every completion in the app. The event is written once, when the task is completed, and isn't updated afterward."
    >
      <SettingsRow
        entryId="completionCalendar"
        icon="calendar-outline"
        iconColor={completionCalendarId ? colors.accent : undefined}
        label="Write completions to"
        hint={summary
          ? `Adds an event to “${summary}” when a task completes`
          : missing ? undefined : 'Off. No completion is added to any calendar'}
        value={summary ?? undefined}
        expanded={pickerOpen}
        onPress={() => { if (permission === 'granted') togglePicker(); else onOpen(); }}
        accessibilityLabel="Which calendar completions are written to"
      />

      {(pickerOpen || permission === 'denied') && (
        <>
          <View style={styles.sep} />
          {permission === 'denied' ? (
            <SettingsRow
              entryId="calendarPermission"
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
              caption="Write to"
              options={[OFF_OPTION, ...(calendars ?? []).map(c => ({ id: c.id, title: c.title }))]}
              selectedId={completionCalendarId ?? OFF_OPTION.id}
              onSelect={option => {
                setCompletionCalendarId(option.id || null);
                togglePicker();
              }}
              emptyText="Every calendar on this device is read-only. Add or unlock one you can edit in the Settings app under Calendar › Accounts."
              accessibilityLabelFor={option => (option.id ? `Write to ${option.title}` : 'Off')}
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
