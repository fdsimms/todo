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
import { alertPermissionOff } from '../../utils/permissionAlert';

/** The tray's explicit "no calendar" option — `''` because ids are never empty. */
const OFF_OPTION = { id: '', title: 'Off' };

/**
 * Where the week's planned meals go when they're mirrored onto a calendar
 * (#1494) — the household's shared answer to "what's for dinner Thursday".
 *
 * Its own section rather than a second row in `DeadlineCalendarSettings`,
 * even though the two are the same shape, because they answer to different
 * people: a deadline is yours, and the whole point of this one is the people
 * you share a calendar with. One "write to" calendar for both would put work
 * deadlines on the family fridge.
 *
 * Same switch rule as the deadline section above it: picking a calendar *is*
 * the on switch, so there's no separate toggle to disagree with it. Rendered
 * only while `kitchenEnabled` is on, like every other row in the area.
 */
export function MealCalendarSettings() {
  const mealCalendarId = useSettingsStore(s => s.mealCalendarId);
  const setMealCalendarId = useSettingsStore(s => s.setMealCalendarId);

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

  // Same reasoning as the two calendar sections above: the permission row can
  // send someone to the system Settings app, which doesn't unfocus this
  // screen, and which calendars are writable can change while they're there.
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

  const selected = (calendars ?? []).find(c => c.id === mealCalendarId) ?? null;
  // The picked calendar isn't writable any more — deleted, or its
  // allowsModifications flag changed underneath the app.
  const missing = !!mealCalendarId && calendars !== null && !selected;

  const summary = mealCalendarId
    ? (selected ? selected.title : missing ? undefined : 'Checking…')
    : undefined;

  /**
   * First tap: permission, then the calendar list, then the picker. Nothing
   * is written until a calendar is actually chosen in the tray below — asking
   * here and then showing an empty list would be a dead end.
   */
  const onOpen = async () => {
    if (permission === 'denied') {
      Linking.openSettings();
      return;
    }
    if (permission !== 'granted' && !(await requestCalendarPermission())) {
      refreshState();
      alertPermissionOff(
        'Calendar access is off',
        'Writing to your calendar needs permission. Turn it on in Settings, then try again.',
      );
      return;
    }
    refreshState();
    const list = await listWritableCalendars();
    setCalendars(list);
    if (list.length === 0 && !mealCalendarId) {
      Alert.alert(
        'No calendar you can write to',
        'Every calendar on this device is read-only. Add or unlock one in Settings under Calendar › Accounts.',
      );
      return;
    }
    animateLayout();
    setPickerOpen(true);
  };

  return (
    <SettingsSection
      label="Meals on your calendar"
      footer="Adds an all-day event to the calendar you pick for each meal you plan from now on, named for its slot, e.g. “Dinner: Lemon garlic salmon”. If you pick a different calendar, a meal’s event moves there the next time that meal changes. Moving or deleting the event doesn’t change the meal plan."
    >
      <SettingsRow
        entryId="mealCalendar"
        icon="calendar-outline"
        iconColor={mealCalendarId ? colors.accent : undefined}
        label="Write meals to"
        hint={summary
          ? `Adds an all-day event to “${summary}”`
          : missing ? undefined : 'Off. No meal is added to any calendar'}
        value={summary ?? undefined}
        expanded={pickerOpen}
        onPress={() => { if (permission === 'granted') togglePicker(); else onOpen(); }}
        accessibilityLabel="Which calendar planned meals are written to"
      />

      {(pickerOpen || permission === 'denied') && (
        <>
          <View style={styles.sep} />
          {permission === 'denied' ? (
            <SettingsRow
              icon="lock-closed-outline"
              iconColor={colors.warningText}
              label="Calendar access"
              hint="Blocked. Nothing can be written until you turn it back on in Settings."
              value="Open Settings"
              onPress={() => Linking.openSettings()}
              accessibilityLabel="Calendar access is blocked. Opens Settings."
            />
          ) : (
            <SettingsChoiceTray
              caption="Write to"
              options={[OFF_OPTION, ...(calendars ?? []).map(c => ({ id: c.id, title: c.title }))]}
              selectedId={mealCalendarId ?? OFF_OPTION.id}
              onSelect={option => {
                setMealCalendarId(option.id || null);
                togglePicker();
              }}
              emptyText="Every calendar on this device is read-only. Add or unlock one in Settings under Calendar › Accounts."
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
            iconColor={colors.warningText}
            label="That calendar isn’t on this device"
            hint="Pick again above, or turn this off."
          />
        </>
      )}
    </SettingsSection>
  );
}
