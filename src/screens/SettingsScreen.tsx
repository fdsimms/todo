import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { format } from 'date-fns';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import type { ThemeMode } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Light', icon: 'sunny' },
  { mode: 'dark', label: 'Dark', icon: 'moon' },
  { mode: 'darkPurple', label: 'Purple', icon: 'color-palette' },
  { mode: 'system', label: 'System', icon: 'phone-portrait' },
];

type ActivePicker = 'dayReset' | 'morning' | 'afternoon' | 'evening' | null;

function hhmmToDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function dateToHhmm(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function SettingsScreen({ visible, onClose }: Props) {
  const {
    dayResetTime, setDayResetTime,
    afternoonStart, setAfternoonStart,
    eveningStart, setEveningStart,
    themeMode, setThemeMode,
    anthropicApiKey, setAnthropicApiKey,
    vacationMode, setVacationMode,
    autoRemoveExpiredTasks, setAutoRemoveExpiredTasks,
  } = useSettingsStore();

  const forgivVacationStreaks = useTaskStore(s => s.forgivVacationStreaks);
  const resetAllStreaks = useTaskStore(s => s.resetAllStreaks);

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    if (visible) {
      setActivePicker(null);
      setApiKeyDraft(anthropicApiKey);
    }
  }, [visible]);

  const openPicker = (which: ActivePicker) => {
    if (activePicker === which) { setActivePicker(null); return; }
    const current = which === 'dayReset' ? dayResetTime
      : which === 'afternoon' ? afternoonStart
      : eveningStart;
    setPickerDate(hhmmToDate(current!));
    setActivePicker(which);
  };

  const confirmPicker = () => {
    const hhmm = dateToHhmm(pickerDate);
    if (activePicker === 'dayReset') setDayResetTime(hhmm);
    else if (activePicker === 'afternoon') setAfternoonStart(hhmm);
    else if (activePicker === 'evening') setEveningStart(hhmm);
    setActivePicker(null);
  };

  const formatTime = (hhmm: string) => format(hhmmToDate(hhmm), 'h:mm a');

  const confirmResetStreaks = () => {
    Alert.alert(
      'Reset All Streaks',
      'This sets every task\'s streak back to 0. You can undo this right after from the toast that appears.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => resetAllStreaks() },
      ]
    );
  };

  const segmentRows: { key: ActivePicker & string; label: string; icon: string; value: string }[] = [
    { key: 'afternoon', label: 'Afternoon starts', icon: 'sunny', value: formatTime(afternoonStart) },
    { key: 'evening', label: 'Evening starts', icon: 'moon-outline', value: formatTime(eveningStart) },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ width: 44 }} />
          <Text style={styles.title}>Settings</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.doneBtn} accessibilityRole="button" accessibilityLabel="Done">
            <Text style={styles.done}>Done</Text>
          </TouchableOpacity>
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

          {/* Day segments */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Afternoon & Evening</Text>
            <View style={styles.card}>
              {segmentRows.map((row, i) => (
                <React.Fragment key={row.key}>
                  {i > 0 && <View style={styles.sep} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => openPicker(row.key as ActivePicker)}
                  >
                    <Ionicons name={row.icon as never} size={18} color={colors.accent} />
                    <Text style={styles.rowLabel}>{row.label}</Text>
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
              Morning starts at the same time as your day reset below. Tasks with a time category only appear after that part of the day begins.
            </Text>
          </View>

          {/* Day reset time */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Day reset</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => openPicker('dayReset')}
              >
                <Ionicons name="moon" size={18} color={colors.accent} />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>New day starts at</Text>
                  <Text style={styles.rowHint}>
                    "Today" flips and streaks reset at this time
                  </Text>
                </View>
                <Text style={styles.rowValue}>{formatTime(dayResetTime)}</Text>
              </TouchableOpacity>

              {activePicker === 'dayReset' && (
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
                    <TouchableOpacity
                      style={styles.pickerBtn}
                      onPress={() => setActivePicker(null)}
                    >
                      <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pickerBtn, styles.pickerBtnPrimary]}
                      onPress={confirmPicker}
                    >
                      <Text style={[styles.pickerBtnText, { color: colors.text }]}>Set</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
            <Text style={styles.sectionFooter}>
              Default is midnight (12:00 AM). Set to 2:00 AM or later if you're often up past midnight and don't want your "today" tasks to vanish before you're done.
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
            </View>
            <Text style={styles.sectionFooter}>
              While on, tasks with "vacation pause" enabled are hidden everywhere and their streaks are protected. You can also hide whole categories on vacation from the Categories screen. Turn it off when you return and streaks will be forgiven automatically.
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
              Asks for confirmation first. Undoable from the toast that appears right after.
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

          {/* AI Suggestions */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>AI Suggestions</Text>
            <View style={styles.card}>
              <View style={[styles.row, { alignItems: 'flex-start', paddingVertical: spacing.md }]}>
                <Ionicons name="sparkles-outline" size={18} color={colors.purple} style={{ marginTop: 2 }} />
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Anthropic API Key</Text>
                  <Text style={styles.rowHint}>Enables auto-tag and effort suggestions in the task editor</Text>
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
              Get a key at console.anthropic.com. Stored locally on device only.
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
                <Text style={styles.rowValue}>{Constants.expoConfig?.version || '1.0.0'}</Text>
              </View>
            </View>
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  title: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  doneBtn: { width: 44, alignItems: 'flex-end' },
  done: { color: colors.accent, fontSize: font.md, fontWeight: '600' },
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
  rowContent: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: font.md, flex: 1 },
  rowHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  rowValue: { color: colors.accent, fontSize: font.md, fontWeight: '500' },
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
