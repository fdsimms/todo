import React, { useState, useMemo } from 'react';
import { View, Alert, AppState, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTaskStore } from '../../store/useTaskStore';
import {
  getNotificationPermission,
  requestNotificationPermissions,
  pendingReminderStats,
  scheduleDailyAgenda,
  MAX_PENDING_REMINDERS,
  type NotificationPermission,
} from '../../utils/notifications';
import { dateToHHMM, hhmmToDate } from '../../utils/clockTime';
import { formatHHMM } from '../../utils/dateUtils';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { InlineTimePicker } from './InlineTimePicker';
import { makeSettingsStyles } from './settingsStyles';

export function NotificationSettings() {
  const dailyAgendaEnabled = useSettingsStore(s => s.dailyAgendaEnabled);
  const setDailyAgendaEnabled = useSettingsStore(s => s.setDailyAgendaEnabled);
  const dailyAgendaTime = useSettingsStore(s => s.dailyAgendaTime);
  const setDailyAgendaTime = useSettingsStore(s => s.setDailyAgendaTime);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  const allTasks = useTaskStore(useShallow(s => s.tasks));
  const reminderStats = useMemo(() => pendingReminderStats(allTasks), [allTasks]);

  // Both ways reminders can quietly not happen. The permission is re-read on
  // focus *and* on foreground: sending someone to the system Settings app to
  // flip it doesn't unfocus this screen, so focus alone would come back and
  // still show the stale state.
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const refreshNotifPermission = React.useCallback(() => {
    getNotificationPermission().then(setNotifPermission).catch(() => setNotifPermission(null));
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refreshNotifPermission();
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') refreshNotifPermission();
      });
      return () => sub.remove();
    }, [refreshNotifPermission])
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());

  const askForNotifications = async () => {
    await requestNotificationPermissions();
    refreshNotifPermission();
  };

  /**
   * Turning the agenda on is the one place the app needs notification
   * permission for something the user just explicitly asked for, so it's the
   * one place worth telling them when permission is missing. Everything else
   * (reminders, timer alarms) is set up long before it fires, where a
   * permission alert would be noise.
   */
  const onToggleDailyAgenda = async (next: boolean) => {
    if (next && !(await requestNotificationPermissions())) {
      // The Reminders row sits directly above this one and would otherwise
      // still be showing whatever it read on focus — including the "Allow"
      // affordance for a prompt that has now been answered.
      refreshNotifPermission();
      Alert.alert(
        'Notifications are turned off',
        'The daily agenda needs notification permission. Turn it on for this app in the Settings app, then try again.'
      );
      return;
    }
    setDailyAgendaEnabled(next);
    // Reads the flag it just set, so this both schedules and cancels.
    scheduleDailyAgenda(useTaskStore.getState().tasks);
  };

  const confirmPicker = () => {
    setDailyAgendaTime(dateToHHMM(pickerDate));
    // The pending agenda was scheduled against the old time.
    scheduleDailyAgenda(useTaskStore.getState().tasks);
    setPickerOpen(false);
  };

  return (
    <SettingsSection
      label="Notifications"
      footer="Reminders and the agenda are delivered by the system, so they need its permission. The agenda counts what's due, carried over from earlier days, and deadlined for that day. Nothing is sent on a day with none of those — an empty summary isn't worth a notification. It's rebuilt each time you open the app, so leaving the app closed for days pauses it rather than sending a stale count."
    >
      {/* Nothing surfaced the permission before, so a declined prompt
          just looked like reminders were broken. */}
      <SettingsRow
        icon={notifPermission === 'granted' ? 'notifications' : 'notifications-off-outline'}
        iconColor={
          notifPermission === 'granted' ? colors.accent
          : notifPermission === 'denied' ? colors.warning
          : undefined
        }
        label="Reminders"
        hint={
          notifPermission === 'granted' ? 'Allowed — reminders will arrive'
          : notifPermission === 'denied' ? 'Blocked. Reminders you set will never arrive until you turn them back on for this app.'
          : notifPermission === 'undetermined' ? 'Not enabled yet — reminders you set won’t arrive until you allow them'
          : notifPermission === 'unsupported' ? 'Not available on this platform'
          : 'Checking…'
        }
        value={
          notifPermission === 'denied' ? 'Open Settings'
          : notifPermission === 'undetermined' ? 'Allow'
          : undefined
        }
        onPress={
          notifPermission === 'denied' ? () => Linking.openSettings()
          : notifPermission === 'undetermined' ? askForNotifications
          : undefined
        }
        accessibilityLabel={
          notifPermission === 'granted' ? 'Reminders are allowed'
          : notifPermission === 'denied' ? 'Reminders are blocked. Opens the system Settings app.'
          : notifPermission === 'undetermined' ? 'Reminders not enabled yet. Double tap to allow.'
          : 'Reminder permission'
        }
      />

      {/* Only worth saying once it's actually biting — the cap is
          invisible and irrelevant until something is being dropped. */}
      {reminderStats.dropped > 0 && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="alert-circle-outline"
            iconColor={colors.warning}
            label={`${reminderStats.scheduled} of ${reminderStats.wanted} reminders scheduled`}
            hint={`iOS only holds ${MAX_PENDING_REMINDERS} at once, so the ${reminderStats.dropped} furthest out ${reminderStats.dropped === 1 ? 'is' : 'are'} waiting. They’re scheduled automatically as nearer ones pass.`}
          />
        </>
      )}

      <View style={styles.sep} />
      <SettingsRow
        icon="newspaper-outline"
        iconColor={dailyAgendaEnabled ? colors.accent : undefined}
        label="Daily agenda"
        hint={dailyAgendaEnabled
          ? 'One notification each morning with the day’s count'
          : 'Nothing arrives unless a task has its own reminder'}
        toggle={dailyAgendaEnabled}
        onPress={() => onToggleDailyAgenda(!dailyAgendaEnabled)}
      />

      {dailyAgendaEnabled && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="alarm-outline"
            iconColor={colors.accent}
            label="Send it at"
            value={formatHHMM(dailyAgendaTime)}
            onPress={() => {
              if (pickerOpen) { setPickerOpen(false); return; }
              setPickerDate(hhmmToDate(dailyAgendaTime!));
              setPickerOpen(true);
            }}
          />
          {pickerOpen && (
            <InlineTimePicker
              value={pickerDate}
              onChange={setPickerDate}
              onCancel={() => setPickerOpen(false)}
              onConfirm={confirmPicker}
            />
          )}
        </>
      )}
    </SettingsSection>
  );
}
