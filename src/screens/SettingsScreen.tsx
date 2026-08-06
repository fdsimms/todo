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
  writeBackupFile, shareBackupFile, discardBackupFile, pickBackupFile, canShare,
} from '../utils/backupFile';
import { requestNotificationPermissions, scheduleDailyAgenda } from '../utils/notifications';

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

type ActivePicker = 'dayReset' | 'afternoon' | 'evening' | 'night' | 'activeStart' | 'activeEnd' | 'agenda' | null;

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
    resetToDefaults,
  } = useSettingsStore();

  const forgivVacationStreaks = useTaskStore(s => s.forgivVacationStreaks);
  const resetAllStreaks = useTaskStore(s => s.resetAllStreaks);

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

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
              The agenda counts what's due, overdue and deadlined for that day. Nothing is sent on a day with none of those — an empty summary isn't worth a notification. It's rebuilt each time you open the app, so leaving the app closed for days pauses it rather than sending a stale count.
            </Text>
          </View>

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
