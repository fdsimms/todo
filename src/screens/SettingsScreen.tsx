import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
  Alert,
  ActivityIndicator,
  AppState,
  Linking,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { format } from 'date-fns/format';
import { dateToHHMM, hhmmToDate } from '../utils/clockTime';
import { formatHHMM } from '../utils/dateUtils';
import { useSettingsStore, type WeekStart } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import {
  getNotificationPermission,
  requestNotificationPermissions,
  pendingReminderStats,
  scheduleDailyAgenda,
  MAX_PENDING_REMINDERS,
  type NotificationPermission,
} from '../utils/notifications';
import {
  countImportableReminders,
  getRemindersPermission,
  importReminders,
  lastImportOutcome,
  listReminderLists,
  requestRemindersPermission,
  type RemindersPermission,
} from '../utils/remindersImportSync';
import { findReminderList } from '../utils/remindersImport';
import type { Calendar as ReminderList } from 'expo-calendar';
import { useDemoStore } from '../store/useDemoStore';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import type { ThemeMode } from '../theme';
import { APP_FONT_OPTIONS, resolveFontFace } from '../theme/fonts';
import { useFontPreviewsLoaded } from '../theme/AppFont';
import { disclosureValue } from '../theme/textStyles';
import { PatchNotesModal } from '../components/PatchNotesModal';
import { CalendarPicker } from '../components/CalendarPicker';
import { dbExportTables, dbReplaceAllData } from '../db/database';
import {
  buildBackup, serializeBackup, parseBackup, summarizeBackup, backupFileName, type Backup,
} from '../utils/backup';
import {
  RETENTION_OPTIONS, retentionCutoff, retentionLabel, selectPurgeableTaskIds, type RetentionDays,
} from '../utils/retention';
import {
  writeBackupFile, shareBackupFile, discardBackupFile, pickBackupFile, canShare,
} from '../utils/backupFile';

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Light', icon: 'sunny' },
  { mode: 'dark', label: 'Dark', icon: 'moon' },
  { mode: 'darkPurple', label: 'Purple', icon: 'color-palette' },
  { mode: 'system', label: 'System', icon: 'phone-portrait' },
];

const WEEK_START_OPTIONS: { value: WeekStart; label: string }[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

type ActivePicker = 'dayReset' | 'afternoon' | 'evening' | 'night' | 'activeStart' | 'activeEnd' | 'agenda' | 'remindersList' | null;

/**
 * Writes a parsed backup over everything and brings the app back up on it.
 *
 * The reload is the same sequence exitDemoMode uses, and for the same reason:
 * every store has just had the file underneath it replaced, and useTaskStore's
 * initialize() is what cascades into categories, templates, stacks, projects
 * and both category pools — and reschedules reminders from the tasks it loads,
 * so the restored data's notifications replace the old data's. Settings goes
 * last because it isn't part of that cascade.
 */
function applyBackup(backup: Backup): void {
  dbReplaceAllData(backup.tables);
  useTaskStore.getState().initialize();
  useSettingsStore.getState().initialize();
}

export function SettingsScreen() {
  const navigation = useNavigation();
  const onClose = () => navigation.goBack();

  const demoActive = useDemoStore(s => s.active);
  const enterDemoMode = useDemoStore(s => s.enterDemoMode);
  const exitDemoMode = useDemoStore(s => s.exitDemoMode);
  const onToggleDemo = () => {
    if (demoActive) {
      exitDemoMode();
      return;
    }
    Alert.alert(
      'Turn on demo mode?',
      'Your tasks are hidden and replaced everywhere with a sample list. Nothing of yours is changed or deleted — turn it off to get it all back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: enterDemoMode },
      ]
    );
  };

  const {
    dayResetTime, setDayResetTime,
    morningStart,
    afternoonStart, setAfternoonStart,
    eveningStart, setEveningStart,
    nightStart, setNightStart,
    activeHoursStart, setActiveHoursStart,
    activeHoursEnd, setActiveHoursEnd,
    themeMode, setThemeMode,
    appFont, setAppFont,
    use24HourTime, setUse24HourTime,
    weekStartsOn, setWeekStartsOn,
    hapticsEnabled, setHapticsEnabled,
    dailyAgendaEnabled, setDailyAgendaEnabled,
    dailyAgendaTime, setDailyAgendaTime,
    anthropicApiKey, setAnthropicApiKey,
    vacationMode, setVacationMode,
    vacationStart,
    vacationEnd, setVacationEnd,
    autoRemoveExpiredTasks, setAutoRemoveExpiredTasks,
    autoArchiveProjectsOnComplete, setAutoArchiveProjectsOnComplete,
    completedRetentionDays, setCompletedRetentionDays,
    remindersImportEnabled, setRemindersImportEnabled,
    remindersImportListId, setRemindersImportListId,
    setRemindersImportConfirmedListId,
    resetToDefaults,
  } = useSettingsStore();

  const forgivVacationStreaks = useTaskStore(s => s.forgivVacationStreaks);
  const resetAllStreaks = useTaskStore(s => s.resetAllStreaks);

  // Both ways reminders can quietly not happen. The permission is re-read on
  // focus *and* on foreground: sending someone to the system Settings app to
  // flip it doesn't unfocus this screen, so focus alone would come back and
  // still show the stale state.
  const allTasks = useTaskStore(useShallow(s => s.tasks));
  const reminderStats = useMemo(() => pendingReminderStats(allTasks), [allTasks]);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const refreshNotifPermission = React.useCallback(() => {
    getNotificationPermission().then(setNotifPermission).catch(() => setNotifPermission(null));
  }, []);

  // Same two states for the Reminders import below, refreshed by the same
  // effect for the same reason — its permission row also sends people to the
  // system Settings app, and the list of Reminders lists can change while
  // they're over there too.
  const [remindersPermission, setRemindersPermission] = useState<RemindersPermission | null>(null);
  const [reminderLists, setReminderLists] = useState<ReminderList[] | null>(null);
  const refreshRemindersState = React.useCallback(() => {
    getRemindersPermission()
      .then(async permission => {
        setRemindersPermission(permission);
        setReminderLists(permission === 'granted' ? await listReminderLists() : null);
      })
      .catch(() => setRemindersPermission(null));
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refreshNotifPermission();
      refreshRemindersState();
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') {
          refreshNotifPermission();
          refreshRemindersState();
        }
      });
      return () => sub.remove();
    }, [refreshNotifPermission, refreshRemindersState])
  );

  const askForNotifications = async () => {
    await requestNotificationPermissions();
    refreshNotifPermission();
  };

  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const selectedReminderList = findReminderList(reminderLists ?? [], remindersImportListId);
  const lastImport = lastImportOutcome();

  /**
   * The gate in front of everything destructive. Naming the count *and* the
   * list is what makes it a real decision rather than a dialog to dismiss —
   * and it's raised here, at the tap, never from the drain, which can run on a
   * cold launch with no screen mounted to answer it.
   *
   * Keyed on the list id, so switching list asks again instead of quietly
   * swallowing whatever has piled up in the new one.
   */
  const confirmList = async (list: ReminderList) => {
    setActivePicker(null);
    const count = await countImportableReminders(list.id);
    if (count === null) {
      Alert.alert('Couldn’t read that list', 'Try again in a moment, or pick a different list.');
      return;
    }
    const enable = () => {
      setRemindersImportListId(list.id);
      setRemindersImportConfirmedListId(list.id);
      setRemindersImportEnabled(true);
      setImportResult(null);
    };
    Alert.alert(
      count === 0
        ? `Import from “${list.title}”?`
        : `Import ${count} reminder${count === 1 ? '' : 's'} from “${list.title}”?`,
      count === 0
        ? 'Anything you add to this list will be added to your Inbox and then deleted from the Reminders app. Only the title comes across.'
        : `The ${count} thing${count === 1 ? '' : 's'} already in this list will be added to your Inbox and deleted from the Reminders app, along with anything you add later. Only the title comes across — dates, notes and alarms are dropped. Completed reminders are left alone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import', style: 'destructive', onPress: enable },
      ]
    );
  };

  /**
   * Turning it on never flips the switch by itself — permission first, then a
   * list, then the confirmation, and only its Import button enables anything.
   * Turning it off is immediate: stopping a destructive thing needs no gate.
   */
  const onToggleRemindersImport = async () => {
    if (remindersImportEnabled) {
      setRemindersImportEnabled(false);
      return;
    }
    if (remindersPermission === 'denied') {
      Linking.openSettings();
      return;
    }
    if (remindersPermission !== 'granted' && !(await requestRemindersPermission())) {
      refreshRemindersState();
      Alert.alert(
        'Reminders access is off',
        'Importing needs permission to read and delete reminders. Turn it on for this app in the Settings app, then try again.'
      );
      return;
    }
    refreshRemindersState();
    const lists = await listReminderLists();
    setReminderLists(lists);
    if (lists.length === 0) {
      Alert.alert(
        'No lists to import from',
        'There are no Reminders lists on this device that can be changed from here.'
      );
      return;
    }
    // No API tells us which list Siri writes to, and probing for it would mean
    // creating a reminder in someone's Reminders app just to look — so picking
    // is the first step rather than a correction to a guess.
    setActivePicker('remindersList');
  };

  const onImportNow = async () => {
    if (importBusy) return;
    setImportBusy(true);
    setImportResult(null);
    try {
      const outcome = await importReminders();
      setImportResult(outcome.imported > 0 ? `Imported ${outcome.imported}` : 'Nothing new');
    } finally {
      setImportBusy(false);
    }
  };

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const purgeOldCompletedTasks = useTaskStore(s => s.purgeOldCompletedTasks);

  /**
   * Picking a retention window applies it to the backlog immediately rather
   * than leaving it to take effect at the next launch — a setting that deletes
   * has to show what it costs at the moment it's chosen, not silently later.
   * So the count comes from the same selection the purge itself runs, and the
   * setting is only written once the user has said yes to that number.
   *
   * Shortening to a window nothing falls outside of, or lengthening one (up to
   * and including Forever), takes nothing and so just saves.
   */
  const onPickRetention = (days: RetentionDays) => {
    if (days === completedRetentionDays) return;
    const cutoff = retentionCutoff(days, new Date(), dayResetTime);
    const doomed = cutoff ? selectPurgeableTaskIds(allTasks, cutoff) : [];
    if (doomed.length === 0) {
      setCompletedRetentionDays(days);
      return;
    }
    Alert.alert(
      `Delete ${doomed.length} completed task${doomed.length === 1 ? '' : 's'}?`,
      `${doomed.length === 1 ? 'One task was' : `${doomed.length} tasks were`} completed more than ${retentionLabel(days).toLowerCase()} ago. They'll be deleted now, along with their Logbook entries and their share of Stats, and every completion that ages past ${retentionLabel(days).toLowerCase()} from here on goes the same way. This can't be undone, so export first if you want to keep them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setCompletedRetentionDays(days);
            purgeOldCompletedTasks();
          },
        },
      ]
    );
  };

  // Guards both backup rows against a second tap while the first is still
  // going. Export walks every table and restore rewrites them, and neither is
  // safe to have two of in flight.
  const [backupBusy, setBackupBusy] = useState<'export' | 'restore' | null>(null);

  const onExport = async () => {
    if (backupBusy) return;
    setBackupBusy('export');
    let uri: string | null = null;
    try {
      const now = new Date();
      const backup = buildBackup(dbExportTables(), {
        appVersion: Constants.expoConfig?.version || '1.0.0',
        exportedAt: now,
      });
      uri = writeBackupFile(serializeBackup(backup), backupFileName(now));
      if (!(await canShare())) {
        Alert.alert('Can’t share from this device', `Your backup was written to ${uri}.`);
        uri = null; // left in place — it's the only copy the user has
        return;
      }
      await shareBackupFile(uri);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Something went wrong writing the backup.');
    } finally {
      // The share sheet has already copied the file wherever it was going, so
      // the cache copy is done either way.
      if (uri) discardBackupFile(uri);
      setBackupBusy(null);
    }
  };

  const onRestore = async () => {
    if (backupBusy) return;
    setBackupBusy('restore');
    try {
      const text = await pickBackupFile();
      if (text == null) return; // user backed out of the picker

      const result = parseBackup(text);
      if (!result.ok) {
        Alert.alert('That backup can’t be read', result.error);
        return;
      }

      const backup = result.backup;
      Alert.alert(
        'Replace everything with this backup?',
        `The backup holds ${summarizeBackup(backup)}. Everything currently in the app — tasks, projects, stacks, templates, categories and settings — is deleted and replaced by it. This can't be undone, so export what you have first if you haven't.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: () => {
              try {
                applyBackup(backup);
                Alert.alert('Restored', `Your data now matches the backup — ${summarizeBackup(backup)}.`);
              } catch (e) {
                Alert.alert(
                  'Restore failed',
                  `${e instanceof Error ? e.message : 'Something went wrong.'} Nothing was changed — the restore is a single transaction, so your existing data is still there.`
                );
              }
            },
          },
        ]
      );
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : 'Something went wrong reading the file.');
    } finally {
      setBackupBusy(null);
    }
  };

  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  // The Reminders list row is also shown while its picker is open with the
  // import still off — that's the first-enable sequence, where choosing a list
  // comes *before* the switch flips (nothing turns on until the confirmation
  // is accepted).
  const showReminderListRow =
    remindersPermission === 'granted' && (remindersImportEnabled || activePicker === 'remindersList');
  const [pickerDate, setPickerDate] = useState<Date>(new Date());
  const [showPatchNotes, setShowPatchNotes] = useState(false);
  const [showVacationEndPicker, setShowVacationEndPicker] = useState(false);
  const fontPreviewsLoaded = useFontPreviewsLoaded();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useFocusEffect(
    React.useCallback(() => {
      setActivePicker(null);
      setApiKeyDraft(anthropicApiKey);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const openPicker = (which: ActivePicker) => {
    if (activePicker === which) { setActivePicker(null); return; }
    const current = which === 'dayReset' ? dayResetTime
      : which === 'afternoon' ? afternoonStart
      : which === 'evening' ? eveningStart
      : which === 'activeStart' ? activeHoursStart
      : which === 'activeEnd' ? activeHoursEnd
      : which === 'agenda' ? dailyAgendaTime
      : nightStart;
    setPickerDate(hhmmToDate(current!));
    setActivePicker(which);
  };

  const confirmPicker = () => {
    const hhmm = dateToHHMM(pickerDate);
    if (activePicker === 'dayReset') setDayResetTime(hhmm);
    else if (activePicker === 'afternoon') setAfternoonStart(hhmm);
    else if (activePicker === 'evening') setEveningStart(hhmm);
    else if (activePicker === 'night') setNightStart(hhmm);
    else if (activePicker === 'activeStart') setActiveHoursStart(hhmm);
    else if (activePicker === 'activeEnd') setActiveHoursEnd(hhmm);
    else if (activePicker === 'agenda') {
      setDailyAgendaTime(hhmm);
      // The pending agenda was scheduled against the old time.
      scheduleDailyAgenda(useTaskStore.getState().tasks);
    }
    setActivePicker(null);
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

  const confirmResetStreaks = () => {
    Alert.alert(
      'Reset All Streaks',
      'This sets every task\'s streak back to 0. You can undo this right after by shaking your phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => resetAllStreaks() },
      ]
    );
  };

  const confirmResetToDefaults = () => {
    Alert.alert(
      'Reset Settings to Defaults',
      'This resets appearance, formatting, haptics, the daily agenda, day segments, active hours, and the time-limited tasks and auto-archive toggles back to their defaults. Your tasks, API key, and vacation mode are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => resetToDefaults() },
      ]
    );
  };

  const segmentRows: { key: ActivePicker & string; label: string; icon: string; value: string; hint?: string }[] = [
    {
      key: 'dayReset',
      label: 'Morning',
      icon: 'sunny',
      value: formatHHMM(morningStart),
      hint: '"Today" flips and streaks reset at this time',
    },
    { key: 'afternoon', label: 'Afternoon starts', icon: 'partly-sunny', value: formatHHMM(afternoonStart) },
    { key: 'evening', label: 'Evening starts', icon: 'moon-outline', value: formatHHMM(eveningStart) },
    { key: 'night', label: 'Night starts', icon: 'moon', value: formatHHMM(nightStart) },
    {
      key: 'activeStart',
      label: 'Awake from',
      icon: 'speedometer-outline',
      value: formatHHMM(activeHoursStart),
      hint: 'Daily targets pace themselves across these hours',
    },
    { key: 'activeEnd', label: 'Awake until', icon: 'speedometer-outline', value: formatHHMM(activeHoursEnd) },
  ];

  return (
    <>
      <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.title}>Settings</Text>
          <View style={{ width: 24 }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        >
          {/* Appearance */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Appearance</Text>
            <View style={styles.card}>
              <View style={styles.themeRow}>
                {THEME_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.mode}
                    style={[
                      styles.themeBtn,
                      themeMode === opt.mode && styles.themeBtnActive,
                    ]}
                    onPress={() => setThemeMode(opt.mode)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: themeMode === opt.mode }}
                    accessibilityLabel={`${opt.label} theme`}
                  >
                    <Ionicons
                      name={opt.icon as never}
                      size={18}
                      color={themeMode === opt.mode ? colors.accent : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.themeBtnText,
                        themeMode === opt.mode && styles.themeBtnTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Typeface */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Typeface</Text>
            <View style={styles.card}>
              {APP_FONT_OPTIONS.map((opt, i) => {
                const selected = appFont === opt.id;
                // Naming a family here is what stops the patched Text applying
                // the *selected* font to this row, so each option previews
                // itself. Undefined for System, which flattens over the
                // injected family and lands back on the real platform default.
                const family = fontPreviewsLoaded
                  ? resolveFontFace(opt.id, '400')
                  : undefined;
                return (
                  <React.Fragment key={opt.id}>
                    {i > 0 && <View style={styles.sep} />}
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => setAppFont(opt.id)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${opt.label} typeface`}
                    >
                      <Text
                        style={[
                          styles.fontSample,
                          selected && styles.fontSampleActive,
                          { fontFamily: family },
                        ]}
                      >
                        Aa
                      </Text>
                      <View style={styles.rowContent}>
                        <Text
                          style={[
                            styles.fontName,
                            selected && styles.fontNameActive,
                            { fontFamily: family },
                          ]}
                        >
                          {opt.label}
                        </Text>
                        <Text style={styles.rowHint}>{opt.hint}</Text>
                      </View>
                      {selected && (
                        <Ionicons name="checkmark" size={18} color={colors.accent} />
                      )}
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })}
            </View>
            <Text style={styles.sectionFooter}>
              Changes every screen at once. These all ship with the OS, so nothing downloads.
            </Text>
          </View>

          {/* Feedback */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Feedback</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => setHapticsEnabled(!hapticsEnabled)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityState={{ checked: hapticsEnabled }}
                accessibilityLabel="Haptic feedback"
              >
                <Ionicons
                  name="phone-portrait-outline"
                  size={18}
                  color={hapticsEnabled ? colors.accent : colors.textSecondary}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Haptic feedback</Text>
                  <Text style={styles.rowHint}>
                    {hapticsEnabled
                      ? 'On — the phone taps back on completions, drags and swipes'
                      : 'Off — nothing in the app vibrates'}
                  </Text>
                </View>
                <View style={[styles.toggle, hapticsEnabled && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, hapticsEnabled && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Notifications */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notifications</Text>
            <View style={styles.card}>
              {/* Nothing surfaced the permission before, so a declined prompt
                  just looked like reminders were broken. */}
              <TouchableOpacity
                style={styles.row}
                onPress={
                  notifPermission === 'denied' ? () => Linking.openSettings()
                  : notifPermission === 'undetermined' ? askForNotifications
                  : undefined
                }
                disabled={notifPermission !== 'denied' && notifPermission !== 'undetermined'}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole={
                  notifPermission === 'denied' || notifPermission === 'undetermined' ? 'button' : undefined
                }
                accessibilityLabel={
                  notifPermission === 'granted' ? 'Reminders are allowed'
                  : notifPermission === 'denied' ? 'Reminders are blocked. Opens the system Settings app.'
                  : notifPermission === 'undetermined' ? 'Reminders not enabled yet. Double tap to allow.'
                  : 'Reminder permission'
                }
              >
                <Ionicons
                  name={notifPermission === 'granted' ? 'notifications' : 'notifications-off-outline'}
                  size={18}
                  color={notifPermission === 'granted' ? colors.accent : notifPermission === 'denied' ? colors.warning : colors.textSecondary}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Reminders</Text>
                  <Text style={styles.rowHint}>
                    {notifPermission === 'granted' ? 'Allowed — reminders will arrive'
                      : notifPermission === 'denied' ? 'Blocked. Reminders you set will never arrive until you turn them back on for this app.'
                      : notifPermission === 'undetermined' ? 'Not enabled yet — reminders you set won’t arrive until you allow them'
                      : notifPermission === 'unsupported' ? 'Not available on this platform'
                      : 'Checking…'}
                  </Text>
                </View>
                {notifPermission === 'denied' && <Text style={styles.rowValue}>Open Settings</Text>}
                {notifPermission === 'undetermined' && <Text style={styles.rowValue}>Allow</Text>}
              </TouchableOpacity>

              {/* Only worth saying once it's actually biting — the cap is
                  invisible and irrelevant until something is being dropped. */}
              {reminderStats.dropped > 0 && (
                <>
                  <View style={styles.sep} />
                  <View style={styles.row}>
                    <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                    <View style={styles.rowContent}>
                      <Text style={styles.rowLabel}>
                        {reminderStats.scheduled} of {reminderStats.wanted} reminders scheduled
                      </Text>
                      <Text style={styles.rowHint}>
                        iOS only holds {MAX_PENDING_REMINDERS} at once, so the {reminderStats.dropped} furthest
                        out {reminderStats.dropped === 1 ? 'is' : 'are'} waiting. They’re scheduled
                        automatically as nearer ones pass.
                      </Text>
                    </View>
                  </View>
                </>
              )}
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => onToggleDailyAgenda(!dailyAgendaEnabled)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityState={{ checked: dailyAgendaEnabled }}
                accessibilityLabel="Daily agenda"
              >
                <Ionicons
                  name="newspaper-outline"
                  size={18}
                  color={dailyAgendaEnabled ? colors.accent : colors.textSecondary}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Daily agenda</Text>
                  <Text style={styles.rowHint}>
                    {dailyAgendaEnabled
                      ? 'One notification each morning with the day’s count'
                      : 'Off — nothing arrives unless a task has its own reminder'}
                  </Text>
                </View>
                <View style={[styles.toggle, dailyAgendaEnabled && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, dailyAgendaEnabled && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
              {dailyAgendaEnabled && (
                <>
                  <View style={styles.sep} />
                  <TouchableOpacity style={styles.row} onPress={() => openPicker('agenda')}>
                    <Ionicons name="alarm-outline" size={18} color={colors.accent} />
                    <View style={styles.rowContent}>
                      <Text style={styles.rowLabel}>Send it at</Text>
                    </View>
                    <Text style={styles.rowValue}>{formatHHMM(dailyAgendaTime)}</Text>
                  </TouchableOpacity>
                  {activePicker === 'agenda' && (
                    <>
                      <View style={styles.sep} />
                      <DateTimePicker
                        value={pickerDate}
                        mode="time"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={(_e, d) => d && setPickerDate(d)}
                        themeVariant={isDark ? 'dark' : 'light'}
                        style={styles.picker}
                      />
                      <View style={styles.pickerButtons}>
                        <TouchableOpacity style={styles.pickerBtn} onPress={() => setActivePicker(null)}>
                          <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.pickerBtn, styles.pickerBtnPrimary]} onPress={confirmPicker}>
                          <Text style={[styles.pickerBtnText, { color: colors.text }]}>Set</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </>
              )}
            </View>
            <Text style={styles.sectionFooter}>
              Reminders and the agenda are delivered by the system, so they need its permission. The agenda counts what's due, overdue and deadlined for that day. Nothing is sent on a day with none of those — an empty summary isn't worth a notification. It's rebuilt each time you open the app, so leaving the app closed for days pauses it rather than sending a stale count.
            </Text>
          </View>

          {/* Apple Reminders — labelled in full throughout, because "reminders"
              already means the per-task notification in the section above. */}
          {Platform.OS === 'ios' && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Apple Reminders</Text>
              <View style={styles.card}>
                <TouchableOpacity
                  style={styles.row}
                  onPress={onToggleRemindersImport}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: remindersImportEnabled }}
                  accessibilityLabel="Import from the Reminders app"
                >
                  <Ionicons
                    name="arrow-down-circle-outline"
                    size={18}
                    color={remindersImportEnabled ? colors.accent : colors.textSecondary}
                  />
                  <View style={styles.rowContent}>
                    <Text style={styles.rowLabel}>Import from Reminders</Text>
                    <Text style={styles.rowHint}>
                      {remindersImportEnabled
                        ? selectedReminderList
                          ? `On — anything in “${selectedReminderList.title}” is added to your Inbox and removed from the Reminders app`
                          : 'On — but the list it was importing from is no longer available'
                        : 'Off — nothing is read from the Reminders app'}
                    </Text>
                  </View>
                  <View style={[styles.toggle, remindersImportEnabled && styles.toggleOn]}>
                    <View style={[styles.toggleKnob, remindersImportEnabled && styles.toggleKnobOn]} />
                  </View>
                </TouchableOpacity>

                {/* Denied stays visible even with the import off — that's the
                    state where the switch above looks broken. */}
                {(remindersImportEnabled || remindersPermission === 'denied') && (
                  <>
                    <View style={styles.sep} />
                    <TouchableOpacity
                      style={styles.row}
                      onPress={
                        remindersPermission === 'denied' ? () => Linking.openSettings()
                        : remindersPermission === 'undetermined' ? async () => {
                            await requestRemindersPermission();
                            refreshRemindersState();
                          }
                        : undefined
                      }
                      disabled={remindersPermission !== 'denied' && remindersPermission !== 'undetermined'}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole={
                        remindersPermission === 'denied' || remindersPermission === 'undetermined' ? 'button' : undefined
                      }
                      accessibilityLabel={
                        remindersPermission === 'granted' ? 'Reminders access is allowed'
                        : remindersPermission === 'denied' ? 'Reminders access is blocked. Opens the system Settings app.'
                        : remindersPermission === 'undetermined' ? 'Reminders access not enabled yet. Double tap to allow.'
                        : 'Reminders access'
                      }
                    >
                      <Ionicons
                        name={remindersPermission === 'granted' ? 'lock-open-outline' : 'lock-closed-outline'}
                        size={18}
                        color={remindersPermission === 'granted' ? colors.accent : remindersPermission === 'denied' ? colors.warning : colors.textSecondary}
                      />
                      <View style={styles.rowContent}>
                        <Text style={styles.rowLabel}>Reminders access</Text>
                        <Text style={styles.rowHint}>
                          {remindersPermission === 'granted' ? 'Allowed — this app can read and remove reminders in the list below'
                            : remindersPermission === 'denied' ? 'Blocked. Nothing can be imported until you turn it back on for this app.'
                            : remindersPermission === 'undetermined' ? 'Not enabled yet — nothing can be imported until you allow it'
                            : remindersPermission === 'unsupported' ? 'Not available on this platform'
                            : 'Checking…'}
                        </Text>
                      </View>
                      {remindersPermission === 'denied' && <Text style={styles.rowValue}>Open Settings</Text>}
                      {remindersPermission === 'undetermined' && <Text style={styles.rowValue}>Allow</Text>}
                    </TouchableOpacity>
                  </>
                )}

                {showReminderListRow && (
                  <>
                    <View style={styles.sep} />
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => setActivePicker(activePicker === 'remindersList' ? null : 'remindersList')}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel="Choose the list to import from"
                    >
                      <Ionicons name="list-outline" size={18} color={colors.accent} />
                      <View style={styles.rowContent}>
                        <Text style={styles.rowLabel}>List</Text>
                      </View>
                      <Text style={styles.rowValue}>
                        {selectedReminderList?.title ?? (remindersImportListId ? 'Unavailable' : 'Choose')}
                      </Text>
                    </TouchableOpacity>
                    {activePicker === 'remindersList' && (reminderLists ?? []).map(list => {
                      const selected = list.id === remindersImportListId;
                      return (
                        <React.Fragment key={list.id}>
                          <View style={styles.sep} />
                          <TouchableOpacity
                            style={styles.row}
                            onPress={() => confirmList(list)}
                            activeOpacity={interaction.activeOpacity}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            accessibilityLabel={`Import from ${list.title}`}
                          >
                            <View style={styles.rowContent}>
                              <Text style={styles.rowLabel}>{list.title}</Text>
                            </View>
                            {selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                          </TouchableOpacity>
                        </React.Fragment>
                      );
                    })}
                  </>
                )}

                {/* Only worth saying once they're actually biting — each of
                    these is a way the import stops without any other symptom. */}
                {remindersImportEnabled && remindersPermission === 'granted' && reminderLists !== null
                  && remindersImportListId !== null && !selectedReminderList && (
                  <>
                    <View style={styles.sep} />
                    <View style={styles.row}>
                      <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                      <View style={styles.rowContent}>
                        <Text style={styles.rowLabel}>That list isn’t on this device</Text>
                        <Text style={styles.rowHint}>
                          Nothing is being imported. Pick another list above, or turn this off.
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                {remindersImportEnabled && (lastImport?.deleteFailed ?? 0) > 0 && (
                  <>
                    <View style={styles.sep} />
                    <View style={styles.row}>
                      <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                      <View style={styles.rowContent}>
                        <Text style={styles.rowLabel}>
                          {lastImport!.deleteFailed} reminder{lastImport!.deleteFailed === 1 ? '' : 's'} couldn’t be removed
                        </Text>
                        <Text style={styles.rowHint}>
                          {lastImport!.deleteFailed === 1 ? 'Its task is' : 'Their tasks are'} in your Inbox and
                          {lastImport!.deleteFailed === 1 ? ' it is' : ' they are'} skipped for now. Delete
                          {lastImport!.deleteFailed === 1 ? ' it' : ' them'} in the Reminders app so nothing comes back next time.
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                {/* There's no change notification to subscribe to, so a reminder
                    that syncs in from a Mac or Watch while the app is already
                    open has nothing to wake the import. */}
                {remindersImportEnabled && remindersPermission === 'granted' && selectedReminderList && (
                  <>
                    <View style={styles.sep} />
                    <TouchableOpacity
                      style={styles.row}
                      onPress={onImportNow}
                      disabled={importBusy}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel="Import waiting reminders now"
                    >
                      <Ionicons name="refresh-outline" size={18} color={colors.accent} />
                      <View style={styles.rowContent}>
                        <Text style={styles.rowLabel}>Import now</Text>
                        {importResult && <Text style={styles.rowHint}>{importResult}</Text>}
                      </View>
                      {importBusy && <ActivityIndicator size="small" color={colors.textSecondary} />}
                    </TouchableOpacity>
                  </>
                )}
              </View>
              <Text style={styles.sectionFooter}>
                Say “Hey Siri, remind me to…” and it lands here. Siri adds to whichever list is set as Default in Settings › Apps › Reminders, so point that at the list above. Only the title comes across — dates, notes and alarms are dropped, so everything waits in your Inbox until you file it. Each reminder is deleted from the list once its task exists, and completed reminders are left alone.
              </Text>
            </View>
          )}

          {/* Day segments */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Day</Text>
            <View style={styles.card}>
              {segmentRows.map((row, i) => (
                <React.Fragment key={row.key}>
                  {i > 0 && <View style={styles.sep} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => openPicker(row.key as ActivePicker)}
                  >
                    <Ionicons name={row.icon as never} size={18} color={colors.accent} />
                    {row.hint ? (
                      <View style={styles.rowContent}>
                        <Text style={styles.rowLabel}>{row.label}</Text>
                        <Text style={styles.rowHint}>{row.hint}</Text>
                      </View>
                    ) : (
                      <Text style={styles.rowLabel}>{row.label}</Text>
                    )}
                    <Text style={styles.rowValue}>{row.value}</Text>
                  </TouchableOpacity>
                  {activePicker === row.key && (
                    <>
                      <View style={styles.sep} />
                      <DateTimePicker
                        value={pickerDate}
                        mode="time"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={(_e, d) => d && setPickerDate(d)}
                        themeVariant={isDark ? 'dark' : 'light'}
                        style={styles.picker}
                      />
                      <View style={styles.pickerButtons}>
                        <TouchableOpacity style={styles.pickerBtn} onPress={() => setActivePicker(null)}>
                          <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.pickerBtn, styles.pickerBtnPrimary]} onPress={confirmPicker}>
                          <Text style={[styles.pickerBtnText, { color: colors.text }]}>Set</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </React.Fragment>
              ))}
            </View>
            <Text style={styles.sectionFooter}>
              Default day start is midnight (12:00 AM). Set it to 2:00 AM or later if you're often up past midnight and don't want your "today" tasks to vanish before you're done. Tasks with a time category only appear once their part of the day begins.
            </Text>
          </View>

          {/* Formatting */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Formatting</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => setUse24HourTime(!use24HourTime)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityState={{ checked: use24HourTime }}
                accessibilityLabel="24-hour time"
              >
                <Ionicons
                  name="time-outline"
                  size={18}
                  color={use24HourTime ? colors.accent : colors.textSecondary}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>24-hour time</Text>
                  <Text style={styles.rowHint}>
                    {use24HourTime ? 'Times read as 17:30' : 'Times read as 5:30 PM'}
                  </Text>
                </View>
                <View style={[styles.toggle, use24HourTime && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, use24HourTime && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
              <View style={styles.sep} />
              <View style={[styles.row, { paddingBottom: spacing.xs }]}>
                <Ionicons name="calendar-outline" size={18} color={colors.accent} />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Week starts on</Text>
                  <Text style={styles.rowHint}>Used by the calendars, Later and Stats</Text>
                </View>
              </View>
              <View style={[styles.themeRow, { paddingTop: 0 }]}>
                {WEEK_START_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.themeBtn, weekStartsOn === opt.value && styles.themeBtnActive]}
                    onPress={() => setWeekStartsOn(opt.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: weekStartsOn === opt.value }}
                    accessibilityLabel={`Week starts on ${opt.label}`}
                  >
                    <Text
                      style={[
                        styles.themeBtnText,
                        weekStartsOn === opt.value && styles.themeBtnTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={styles.sectionFooter}>
              Week start decides which day the month grids begin on and what "this week" counts in Stats — those disagreed with each other until now.
            </Text>
          </View>

          {/* Vacation mode */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Vacation</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  if (vacationMode) {
                    forgivVacationStreaks();
                    setVacationMode(false);
                  } else {
                    setVacationMode(true);
                  }
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityState={{ checked: vacationMode }}
                accessibilityLabel="Vacation mode"
              >
                <Ionicons
                  name="airplane-outline"
                  size={18}
                  color={vacationMode ? colors.accent : colors.textSecondary}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Vacation mode</Text>
                  <Text style={styles.rowHint}>
                    {vacationMode ? 'On — tasks marked for vacation pause are hidden' : 'Hides tasks marked for vacation pause'}
                  </Text>
                </View>
                <View style={[styles.toggle, vacationMode && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, vacationMode && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
              {vacationMode && (
                <>
                  <View style={styles.sep} />
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => setShowVacationEndPicker(true)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel="Vacation end date"
                  >
                    <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                    <View style={styles.rowContent}>
                      <Text style={styles.rowLabel}>End date</Text>
                      <Text style={styles.rowHint}>
                        {vacationEnd ? 'Turns off automatically on this day' : 'Optional — turn off manually if not set'}
                      </Text>
                    </View>
                    <Text style={styles.rowValue}>
                      {vacationEnd ? format(new Date(vacationEnd), 'MMM d, yyyy') : 'None'}
                    </Text>
                    {vacationEnd && (
                      <TouchableOpacity onPress={() => setVacationEnd(null)} hitSlop={8} style={{ marginLeft: spacing.xs }}>
                        <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
            <Text style={styles.sectionFooter}>
              {vacationMode && vacationStart ? `On since ${format(new Date(vacationStart), 'MMM d')}. ` : ''}
              While on, tasks with "vacation pause" enabled are hidden everywhere and their streaks are protected. You can also hide whole categories on vacation from the Categories screen. Turn it off when you return and streaks will be forgiven automatically, or set an end date to have it happen for you.
            </Text>
          </View>

          {/* Streaks */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Streaks</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={confirmResetStreaks}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Reset all streaks"
              >
                <Ionicons name="refresh-outline" size={18} color={colors.red} />
                <View style={styles.rowContent}>
                  <Text style={[styles.rowLabel, { color: colors.red }]}>Reset all streaks</Text>
                  <Text style={styles.rowHint}>Sets every task's streak count back to 0</Text>
                </View>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionFooter}>
              Asks for confirmation first. Undoable right after by shaking your phone.
            </Text>
          </View>

          {/* Time-limited tasks */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Time-limited tasks</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => setAutoRemoveExpiredTasks(!autoRemoveExpiredTasks)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityState={{ checked: autoRemoveExpiredTasks }}
                accessibilityLabel="Auto-remove expired tasks"
              >
                <Ionicons
                  name="time-outline"
                  size={18}
                  color={autoRemoveExpiredTasks ? colors.accent : colors.textSecondary}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Auto-remove expired tasks</Text>
                  <Text style={styles.rowHint}>
                    {autoRemoveExpiredTasks
                      ? 'On — tasks are deleted once their time window closes'
                      : 'Off — expired tasks stay in an Expired section until you delete them'}
                  </Text>
                </View>
                <View style={[styles.toggle, autoRemoveExpiredTasks && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, autoRemoveExpiredTasks && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionFooter}>
              A task with a time window (like "farmers market, 8am–1pm") moves to Expired once its window closes, whether or not it repeats.
            </Text>
          </View>

          {/* Projects */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Projects</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => setAutoArchiveProjectsOnComplete(!autoArchiveProjectsOnComplete)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityState={{ checked: autoArchiveProjectsOnComplete }}
                accessibilityLabel="Auto-archive projects"
              >
                <Ionicons
                  name="briefcase-outline"
                  size={18}
                  color={autoArchiveProjectsOnComplete ? colors.accent : colors.textSecondary}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Auto-archive projects</Text>
                  <Text style={styles.rowHint}>
                    {autoArchiveProjectsOnComplete
                      ? 'On — a project archives itself once every task in it is done'
                      : 'Off — a finished project just sits at 100% until you archive it'}
                  </Text>
                </View>
                <View style={[styles.toggle, autoArchiveProjectsOnComplete && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, autoArchiveProjectsOnComplete && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* AI Suggestions */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>AI Suggestions</Text>
            <View style={styles.card}>
              <View style={[styles.row, { alignItems: 'flex-start', paddingVertical: spacing.md }]}>
                <Ionicons name="sparkles-outline" size={18} color={colors.purple} style={{ marginTop: 2 }} />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Anthropic API Key</Text>
                  <Text style={styles.rowHint}>Enables auto-tag, effort, and date suggestions in the task editor, plus template drafting</Text>
                  <TextInput
                    style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
                    value={apiKeyDraft}
                    onChangeText={setApiKeyDraft}
                    onFocus={() => {
                      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
                    }}
                    onBlur={() => setAnthropicApiKey(apiKeyDraft.trim())}
                    placeholder="sk-ant-..."
                    placeholderTextColor={colors.textTertiary}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                  />
                </View>
              </View>
            </View>
            <Text style={styles.sectionFooter}>
              Get a key at console.anthropic.com. The key stays on this device; using a suggestion sends that task's (or template's) title, notes, and your tag/category names to Anthropic.
            </Text>
          </View>

          {/* Backup */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Backup</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={onExport}
                disabled={demoActive || backupBusy !== null}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Export all data"
                accessibilityState={{ disabled: demoActive || backupBusy !== null }}
              >
                <Ionicons
                  name="download-outline"
                  size={18}
                  color={demoActive ? colors.textTertiary : colors.accent}
                />
                <View style={styles.rowContent}>
                  <Text style={[styles.rowLabel, demoActive && { color: colors.textTertiary }]}>
                    Export all data
                  </Text>
                  <Text style={styles.rowHint}>
                    {demoActive
                      ? 'Unavailable while demo mode is on'
                      : 'Saves everything to a JSON file you can send anywhere'}
                  </Text>
                </View>
                {backupBusy === 'export' && <ActivityIndicator size="small" color={colors.accent} />}
              </TouchableOpacity>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.row}
                onPress={onRestore}
                disabled={demoActive || backupBusy !== null}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Restore from a backup"
                accessibilityState={{ disabled: demoActive || backupBusy !== null }}
              >
                <Ionicons
                  name="cloud-upload-outline"
                  size={18}
                  color={demoActive ? colors.textTertiary : colors.red}
                />
                <View style={styles.rowContent}>
                  <Text
                    style={[styles.rowLabel, { color: demoActive ? colors.textTertiary : colors.red }]}
                  >
                    Restore from a backup
                  </Text>
                  <Text style={styles.rowHint}>
                    {demoActive
                      ? 'Unavailable while demo mode is on'
                      : 'Replaces everything in the app with a backup file'}
                  </Text>
                </View>
                {backupBusy === 'restore' && <ActivityIndicator size="small" color={colors.accent} />}
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionFooter}>
              Everything lives on this device and nowhere else, so a backup is the only copy that survives losing the phone. The file holds your tasks, projects, stacks, templates, categories and settings — but never your API key, since a backup is a file you send places. Restoring replaces what's in the app rather than merging into it.
            </Text>
          </View>

          {/* History — deliberately directly under Backup, since exporting is
              the thing that makes choosing a window here safe. */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>History</Text>
            <View style={styles.card}>
              <View style={[styles.row, { paddingBottom: spacing.xs }]}>
                <Ionicons
                  name="hourglass-outline"
                  size={18}
                  color={completedRetentionDays === null ? colors.textSecondary : colors.accent}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Keep completed tasks for</Text>
                  <Text style={styles.rowHint}>
                    {completedRetentionDays === null
                      ? 'Forever — nothing is ever deleted on its own'
                      : `Completions older than ${retentionLabel(completedRetentionDays).toLowerCase()} are deleted at launch`}
                  </Text>
                </View>
              </View>
              <View style={[styles.themeRow, { paddingTop: 0 }]}>
                {RETENTION_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.themeBtn, completedRetentionDays === opt.value && styles.themeBtnActive]}
                    onPress={() => onPickRetention(opt.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: completedRetentionDays === opt.value }}
                    accessibilityLabel={`Keep completed tasks for ${opt.label}`}
                  >
                    <Text
                      style={[
                        styles.themeBtnText,
                        completedRetentionDays === opt.value && styles.themeBtnTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={styles.sectionFooter}>
              A task you repeat daily leaves a completed copy behind every time, and by default those are kept forever. A window trims them — permanently, along with their Logbook entries and their share of Stats, so export before shortening one. Streaks aren't affected: a streak count lives on the task still running it. Archived tasks are never touched.
            </Text>
          </View>

          {/* Demo */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Demo</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={onToggleDemo}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityState={{ checked: demoActive }}
                accessibilityLabel="Demo mode"
              >
                <Ionicons
                  name={demoActive ? 'sparkles' : 'sparkles-outline'}
                  size={18}
                  color={demoActive ? colors.accent : colors.textSecondary}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Demo mode</Text>
                  <Text style={styles.rowHint}>
                    {demoActive
                      ? 'On — you are looking at sample data; your own tasks are hidden'
                      : 'Off — swap your whole list for sample data, so you can show the app to someone'}
                  </Text>
                </View>
                <View style={[styles.toggle, demoActive && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, demoActive && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionFooter}>
              Every screen — Today, Search, Projects, Stats — switches to a sample list you can edit
              freely. Nothing you do while it's on touches your real tasks, and turning it off
              discards the sample list and brings yours back.
            </Text>
          </View>

          {/* About */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>About</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Version</Text>
                </View>
                <Text style={styles.rowValue}>
                  {Constants.expoConfig?.version || '1.0.0'}
                  {Constants.nativeBuildVersion ? ` (${Constants.nativeBuildVersion})` : ''}
                </Text>
              </View>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => setShowPatchNotes(true)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="What's New"
              >
                <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>What's New</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Reset */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Reset</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={confirmResetToDefaults}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Reset settings to defaults"
              >
                <Ionicons name="refresh-circle-outline" size={18} color={colors.red} />
                <View style={styles.rowContent}>
                  <Text style={[styles.rowLabel, { color: colors.red }]}>Reset to defaults</Text>
                  <Text style={styles.rowHint}>Restores appearance and day/time settings on this screen</Text>
                </View>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionFooter}>
              Asks for confirmation first. Your tasks, API key, and vacation mode are not affected.
            </Text>
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <PatchNotesModal visible={showPatchNotes} onDismiss={() => setShowPatchNotes(false)} />

      <CalendarPicker
        visible={showVacationEndPicker}
        value={vacationEnd ? new Date(vacationEnd) : null}
        mode="date"
        title="Vacation End Date"
        onConfirm={date => {
          const endOfDay = new Date(date);
          endOfDay.setHours(23, 59, 59, 999);
          setVacationEnd(endOfDay.toISOString());
          setShowVacationEndPicker(false);
        }}
        onCancel={() => setShowVacationEndPicker(false)}
      />
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  title: { color: colors.text, fontSize: font.lg, fontWeight: '600' },
  section: { paddingHorizontal: spacing.md, marginTop: spacing.xl },
  sectionLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: spacing.sm, paddingHorizontal: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  themeRow: {
    flexDirection: 'row', padding: spacing.sm, gap: spacing.sm,
  },
  themeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  themeBtnActive: {
    backgroundColor: colors.accent + '22',
  },
  themeBtnText: {
    color: colors.textSecondary, fontSize: font.sm, fontWeight: '500',
  },
  themeBtnTextActive: {
    color: colors.accent, fontWeight: '600',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  // Fixed width so the "Aa" specimens line up down the column even though the
  // faces are different widths — a condensed sample is much narrower than a mono one.
  fontSample: {
    width: 34, color: colors.textSecondary, fontSize: font.xl, textAlign: 'center',
  },
  fontSampleActive: { color: colors.accent },
  fontName: { color: colors.text, fontSize: font.md },
  fontNameActive: { color: colors.accent, fontWeight: '600' },
  rowContent: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: font.md, flex: 1 },
  rowHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  rowValue: disclosureValue(colors),
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  picker: { height: 180 },
  pickerButtons: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  pickerBtn: {
    flex: 1, paddingVertical: 11, borderRadius: radius.md,
    alignItems: 'center', backgroundColor: colors.bgTertiary,
  },
  pickerBtnPrimary: { backgroundColor: colors.accent },
  pickerBtnText: { fontSize: font.md, fontWeight: '600' },
  toggle: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: colors.bgTertiary,
    justifyContent: 'center', padding: 2,
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.textSecondary,
  },
  toggleKnobOn: { backgroundColor: colors.text, alignSelf: 'flex-end' },
  sectionFooter: {
    color: colors.textTertiary, fontSize: font.sm,
    paddingHorizontal: spacing.sm, marginTop: spacing.sm, lineHeight: 19,
    marginBottom: spacing.sm,
  },
  apiKeyInput: {
    fontSize: font.sm, marginTop: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 6, paddingTop: 2,
  },
});
