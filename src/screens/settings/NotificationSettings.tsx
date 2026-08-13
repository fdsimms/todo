import React, { useState, useMemo } from 'react';
import { View, Alert, AppState, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, DEFAULT_REMINDER_LEAD_OPTIONS, type WeekStart } from '../../store/useSettingsStore';
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
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { InlineTimePicker } from './InlineTimePicker';
import { makeSettingsStyles } from './settingsStyles';

const REMINDER_LEAD_OPTIONS: SegmentOption<number | null>[] =
  DEFAULT_REMINDER_LEAD_OPTIONS.map(o => ({ value: o.value, label: o.label }));

// Full names for the hint sentence and screen reader labels; single letters
// on the segments themselves, same compression buildWeekDays'/weekdayHeaders'
// calendar headers already use to fit all seven across 390pt.
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Weekday segments rotated to start at weekStartsOn, matching the calendar's own header order. */
function weekdayOptions(weekStartsOn: WeekStart): SegmentOption<number>[] {
  return Array.from({ length: 7 }, (_, i) => {
    const value = (weekStartsOn + i) % 7;
    return { value, label: WEEKDAY_LETTERS[value] };
  });
}

export function NotificationSettings() {
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const dailyAgendaEnabled = useSettingsStore(s => s.dailyAgendaEnabled);
  const setDailyAgendaEnabled = useSettingsStore(s => s.setDailyAgendaEnabled);
  const dailyAgendaTime = useSettingsStore(s => s.dailyAgendaTime);
  const setDailyAgendaTime = useSettingsStore(s => s.setDailyAgendaTime);
  const defaultReminderLeadMinutes = useSettingsStore(s => s.defaultReminderLeadMinutes);
  const setDefaultReminderLeadMinutes = useSettingsStore(s => s.setDefaultReminderLeadMinutes);

  const mealPlanNudgeEnabled = useSettingsStore(s => s.mealPlanNudgeEnabled);
  const setMealPlanNudgeEnabled = useSettingsStore(s => s.setMealPlanNudgeEnabled);
  const mealPlanNudgeWeekday = useSettingsStore(s => s.mealPlanNudgeWeekday);
  const setMealPlanNudgeWeekday = useSettingsStore(s => s.setMealPlanNudgeWeekday);
  const mealPlanNudgeTime = useSettingsStore(s => s.mealPlanNudgeTime);
  const setMealPlanNudgeTime = useSettingsStore(s => s.setMealPlanNudgeTime);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);

  const quietHoursStart = useSettingsStore(s => s.quietHoursStart);
  const quietHoursEnd = useSettingsStore(s => s.quietHoursEnd);
  const setQuietHours = useSettingsStore(s => s.setQuietHours);
  const activeHoursStart = useSettingsStore(s => s.activeHoursStart);
  const activeHoursEnd = useSettingsStore(s => s.activeHoursEnd);
  const quietHoursEnabled = quietHoursStart !== null && quietHoursEnd !== null;

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

  const [mealPlanPickerOpen, setMealPlanPickerOpen] = useState(false);
  const [mealPlanPickerDate, setMealPlanPickerDate] = useState<Date>(new Date());
  const weekdaySegmentOptions = useMemo(() => weekdayOptions(weekStartsOn), [weekStartsOn]);

  const [quietPickerKey, setQuietPickerKey] = useState<'start' | 'end' | null>(null);
  const [quietPickerDate, setQuietPickerDate] = useState<Date>(new Date());

  // Defaults a fresh "on" to a plausible sleep window rather than leaving both
  // fields blank — matches the shape dailyAgendaTime's own default takes.
  const onToggleQuietHours = (next: boolean) => {
    if (next) setQuietHours(quietHoursStart ?? '22:00', quietHoursEnd ?? '07:00');
    else setQuietHours(null, null);
    setQuietPickerKey(null);
  };

  const openQuietPicker = (key: 'start' | 'end') => {
    if (quietPickerKey === key) { setQuietPickerKey(null); return; }
    setQuietPickerDate(hhmmToDate((key === 'start' ? quietHoursStart : quietHoursEnd) ?? '00:00'));
    setQuietPickerKey(key);
  };

  const confirmQuietPicker = () => {
    const hhmm = dateToHHMM(quietPickerDate);
    if (quietPickerKey === 'start') setQuietHours(hhmm, quietHoursEnd ?? '07:00');
    else if (quietPickerKey === 'end') setQuietHours(quietHoursStart ?? '22:00', hhmm);
    setQuietPickerKey(null);
  };

  // The mirror of the awake-hours span, not a copy of it: awake hours name
  // when the user is up, so quiet hours run from awake-end to awake-start —
  // asleep is exactly the complement of awake.
  const matchAwakeHours = () => {
    setQuietHours(activeHoursEnd, activeHoursStart);
    setQuietPickerKey(null);
  };

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

  const confirmMealPlanPicker = () => {
    setMealPlanNudgeTime(dateToHHMM(mealPlanPickerDate));
    setMealPlanPickerOpen(false);
  };

  return (
    <>
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

      <View style={styles.sep} />
      <SettingsRow
        icon="moon-outline"
        iconColor={quietHoursEnabled ? colors.accent : undefined}
        label="Quiet hours"
        hint={quietHoursEnabled
          ? 'A reminder in this window waits until it ends; a timer alarm in it is skipped'
          : 'Reminders and timer alarms can arrive at any hour'}
        toggle={quietHoursEnabled}
        onPress={() => onToggleQuietHours(!quietHoursEnabled)}
      />

      {quietHoursEnabled && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="moon-outline"
            iconColor={colors.accent}
            label="From"
            value={formatHHMM(quietHoursStart ?? '00:00')}
            onPress={() => openQuietPicker('start')}
          />
          {quietPickerKey === 'start' && (
            <InlineTimePicker
              value={quietPickerDate}
              onChange={setQuietPickerDate}
              onCancel={() => setQuietPickerKey(null)}
              onConfirm={confirmQuietPicker}
            />
          )}
          <View style={styles.sep} />
          <SettingsRow
            icon="sunny-outline"
            iconColor={colors.accent}
            label="Until"
            value={formatHHMM(quietHoursEnd ?? '00:00')}
            onPress={() => openQuietPicker('end')}
          />
          {quietPickerKey === 'end' && (
            <InlineTimePicker
              value={quietPickerDate}
              onChange={setQuietPickerDate}
              onCancel={() => setQuietPickerKey(null)}
              onConfirm={confirmQuietPicker}
            />
          )}
          <View style={styles.sep} />
          <SettingsRow
            icon="speedometer-outline"
            label="Match my awake hours"
            hint="Sets this to the mirror of Awake from/until, in Day & time"
            value="Use"
            onPress={matchAwakeHours}
          />
        </>
      )}
    </SettingsSection>

    {kitchenEnabled && (
    <SettingsSection
      label="Meal planning"
      footer="Creates one task a week reminding you to plan meals — it opens straight to the Meal Plan screen. Skipped entirely for a week that already has something planned there, so it only ever nudges when it'd actually help."
    >
      <SettingsRow
        icon="restaurant-outline"
        iconColor={mealPlanNudgeEnabled ? colors.accent : undefined}
        label="Plan meals for the week"
        hint={mealPlanNudgeEnabled
          ? `A task appears ${WEEKDAY_NAMES[mealPlanNudgeWeekday]} at ${formatHHMM(mealPlanNudgeTime)} to plan the coming week`
          : 'Off — nothing reminds you to plan meals'}
        toggle={mealPlanNudgeEnabled}
        onPress={() => setMealPlanNudgeEnabled(!mealPlanNudgeEnabled)}
      />

      {mealPlanNudgeEnabled && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="calendar-outline"
            iconColor={colors.accent}
            label="Nudge me on"
            tight
          />
          <SettingsSegments
            attached
            options={weekdaySegmentOptions}
            selected={mealPlanNudgeWeekday}
            onSelect={setMealPlanNudgeWeekday}
            accessibilityLabelFor={o => WEEKDAY_NAMES[o.value]}
          />
          <View style={styles.sep} />
          <SettingsRow
            icon="alarm-outline"
            iconColor={colors.accent}
            label="At"
            value={formatHHMM(mealPlanNudgeTime)}
            onPress={() => {
              if (mealPlanPickerOpen) { setMealPlanPickerOpen(false); return; }
              setMealPlanPickerDate(hhmmToDate(mealPlanNudgeTime));
              setMealPlanPickerOpen(true);
            }}
          />
          {mealPlanPickerOpen && (
            <InlineTimePicker
              value={mealPlanPickerDate}
              onChange={setMealPlanPickerDate}
              onCancel={() => setMealPlanPickerOpen(false)}
              onConfirm={confirmMealPlanPicker}
            />
          )}
        </>
      )}
    </SettingsSection>
    )}

    <SettingsSection
        label="Default reminder"
        footer="Only kicks in when a task is given an actual start time (its time window), not just a due date or a morning/afternoon/evening slot — a reminder before the day even resets isn't useful. Never overrides a reminder you set or cleared yourself."
      >
        <SettingsRow
          icon="alarm-outline"
          iconColor={defaultReminderLeadMinutes === null ? undefined : colors.accent}
          label="Remind me before"
          hint={defaultReminderLeadMinutes === null
            ? 'Off — set Remind Me by hand on each task'
            : `New start times get a reminder ${DEFAULT_REMINDER_LEAD_OPTIONS.find(o => o.value === defaultReminderLeadMinutes)?.label.toLowerCase() ?? ''} early`}
          tight
        />
        <SettingsSegments
          attached
          options={REMINDER_LEAD_OPTIONS}
          selected={defaultReminderLeadMinutes}
          onSelect={setDefaultReminderLeadMinutes}
          accessibilityLabelFor={o => `Default reminder lead time ${o.label}`}
        />
      </SettingsSection>
    </>
  );
}
