import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns/format';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore } from '../store/useHealthStore';
import { useDemoStore } from '../store/useDemoStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart, getLogicalToday } from '../utils/dateUtils';
import { logBloodPressureToHealth } from '../utils/healthBloodPressureSync';
import { openHealthApp } from '../utils/healthBridge';
import { parseBloodPressureInput } from '../utils/bloodPressureLog';
import { navigateToSettingsEntry } from '../navigation/openSettings';
import { isDemoModeActive } from '../utils/demoState';
import { EditorSheet } from './EditorSheet';
import { EditorRow } from './EditorRow';
import { InlineAction } from './InlineAction';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { WhenPicker } from './WhenPicker';
import { TextField } from './TextField';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { BUTTON_LABEL } from '../copy/shared';

/**
 * Recording a blood pressure reading, which writes a systolic and diastolic
 * pair to Apple Health as one reading.
 *
 * `LogBloodPressureSheet`'s shape for `LogBloodPressureSheet`'s reasons: a full-screen
 * `EditorSheet` (no swipe-down to guard), a date that may go backwards but not
 * forwards, and every failure saying which failure it was, since somebody has
 * just typed two numbers and is waiting to see them land. Nothing is judged:
 * the sheet accepts any pair a cuff could show and says nothing about it.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function LogBloodPressureSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();
  const healthWriteEnabled = useSettingsStore(s => s.healthWriteEnabled);
  const demoActive = useDemoStore(s => s.active);
  const refreshBloodPressure = useHealthStore(s => s.refreshBloodPressure);

  const [systolicText, setSystolicText] = useState('');
  const [diastolicText, setDiastolicText] = useState('');
  const [pulseText, setPulseText] = useState('');
  const [day, setDay] = useState<Date>(() => getLogicalToday());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const systolicRef = useRef<TextInput>(null);
  const diastolicRef = useRef<TextInput>(null);
  const pulseRef = useRef<TextInput>(null);

  // The sheet stays mounted across opens (see `onShow` below), so the day it
  // was seeded with, or reset to on the last close, can be yesterday's by the
  // time it opens again: tomorrow morning's weigh-in then saved to the day
  // before, at midnight. A fresh open starts on today. A draft still holding a
  // typed reading (the "Open Settings" detour below keeps it) keeps its day too.
  useEffect(() => {
    if (visible && systolicText === '' && diastolicText === '' && pulseText === '') setDay(getLogicalToday());
  }, [visible]);

  const reading = parseBloodPressureInput(systolicText, diastolicText, pulseText);
  const canSave = reading !== null && !saving;

  const close = () => {
    setSystolicText('');
    setDiastolicText('');
    setPulseText('');
    setDay(getLogicalToday());
    setSaving(false);
    onClose();
  };

  // `onClose` rather than `close`: the numbers just typed stay in the sheet for
  // when they come back from turning the switch on, instead of having to be
  // typed a second time. The sheet closes first: it is full screen, and
  // Settings would arrive behind it.
  const openWriteSetting = () => {
    onClose();
    navigateToSettingsEntry(navigation, 'healthWrite');
  };

  const save = async () => {
    if (reading === null || saving) return;
    haptics.tap();
    setSaving(true);

    // A reading recorded for today is stamped with the actual moment; a
    // backdated one lands at noon on its own day, which is what
    // `getLogicalToday` already hands back for any other day. Health files a
    // sample by its instant, so the distinction is the difference between "this
    // morning" and "some time on the 3rd".
    const when = dayKeyOf(day) === dayKeyOf(getCurrentDayStart()) ? new Date() : day;
    const result = await logBloodPressureToHealth(reading.systolic, reading.diastolic, reading.pulse, when);
    setSaving(false);

    if (result === 'writtenWithoutPulse') {
      // The reading is in Health; only the optional pulse was refused. Said
      // rather than dropped, and the sheet closes because the reading is saved.
      haptics.warning();
      void refreshBloodPressure();
      close();
      Alert.alert(
        'Saved without pulse',
        'Your reading was saved, but this app isn’t allowed to write heart rate. In Health, go to Sharing, find this app and turn on heart rate.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Health', onPress: () => { void openHealthApp(); } },
        ],
      );
      return;
    }
    if (result === 'written') {
      haptics.success();
      void refreshBloodPressure();
      close();
      return;
    }

    haptics.error();
    if (result === 'off') {
      // The switch this names is one of ours, so the button goes to that row
      // rather than to the Health app the refusal below opens. The sheet
      // closes first: it is full screen, and Settings would arrive behind it.
      Alert.alert(
        'Logging to Health is off',
        'Turn on “Log to Health” in Settings to record a reading.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: openWriteSetting },
        ],
      );
      return;
    }
    if (result === 'refused') {
      Alert.alert(
        'Couldn’t save to Health',
        'This app isn’t allowed to write your blood pressure. In Health, go to Sharing, find this app and turn on blood pressure.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Health', onPress: () => { void openHealthApp(); } },
        ],
      );
      return;
    }
    if (result === 'invalid') {
      Alert.alert('Check the numbers', 'Enter the top and bottom numbers as whole numbers, with the top one higher. A pulse, if you add one, is beats per minute.');
      return;
    }
    // Demo mode refuses the write before the device is ever asked (see
    // logBloodPressureToHealth), so "this device cannot" would blame the phone for a
    // refusal that is ours.
    if (isDemoModeActive()) {
      Alert.alert('Not available in demo mode', 'Demo mode doesn’t use Apple Health, so a reading can’t be saved here.');
      return;
    }
    Alert.alert('Health isn’t available', 'This device can’t record blood pressure.');
  };

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={close}
      // The sheet stays mounted across opens, so a bare `autoFocus` on the
      // field would only ever fire once.
      onShow={() => systolicRef.current?.focus()}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title="Record blood pressure"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={close} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} disabled={!canSave} minWidth={64} />}
        />
      }
      footer={
        <WhenPicker
          visible={pickerOpen}
          value={day}
          title="Which day?"
          showTimeOfDay={false}
          showSuggest={false}
          allowFuture={false}
          onConfirm={date => { if (date) setDay(date); setPickerOpen(false); }}
          onCancel={() => setPickerOpen(false)}
        />
      }
    >
      {/* Said before any typing rather than only after Save: a reading can only
          be recorded by writing it to Health, so with the write switch off
          (or in demo mode, where no Health write happens at all) the number
          has nowhere to go. */}
      {demoActive ? (
        <View style={[styles.card, styles.notice]}>
          <Text style={styles.noticeText}>
            Demo mode doesn’t use Apple Health, so a reading
            can’t be saved here.
          </Text>
        </View>
      ) : !healthWriteEnabled ? (
        <View style={[styles.card, styles.notice]}>
          <Text style={styles.noticeText}>
            Log to Health is off. Turn it on in Settings to
            save a reading.
          </Text>
          <InlineAction
            label="Open Settings"
            icon="settings-outline"
            onPress={openWriteSetting}
            style={styles.noticeAction}
          />
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Top number (systolic)</Text>
          <View style={styles.inputRow}>
            <TextField
              ref={systolicRef}
              style={styles.input}
              value={systolicText}
              onChangeText={setSystolicText}
              keyboardType="number-pad"
              maxLength={3}
              inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
              placeholder="e.g. 118"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Systolic, the top number"
            />
            <Text style={styles.unit}>mmHg</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Bottom number (diastolic)</Text>
          <View style={styles.inputRow}>
            <TextField
              ref={diastolicRef}
              style={styles.input}
              value={diastolicText}
              onChangeText={setDiastolicText}
              keyboardType="number-pad"
              maxLength={3}
              inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
              placeholder="e.g. 76"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Diastolic, the bottom number"
            />
            <Text style={styles.unit}>mmHg</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Pulse (optional)</Text>
          <View style={styles.inputRow}>
            <TextField
              ref={pulseRef}
              style={styles.input}
              value={pulseText}
              onChangeText={setPulseText}
              keyboardType="number-pad"
              maxLength={3}
              inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
              placeholder="e.g. 64"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Pulse in beats per minute, optional"
            />
            <Text style={styles.unit}>bpm</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <EditorRow
          icon="calendar-outline"
          label="Day"
          value={dayKeyOf(day) === dayKeyOf(getCurrentDayStart())
            ? 'Today'
            : format(day, 'EEE, MMM d')}
          onPress={() => { haptics.tap(); setPickerOpen(true); }}
        />
      </View>

      <Text style={styles.footnote}>
        Saved to Apple Health. Edit or delete it
        in the Health app.
      </Text>
      <NumberPadAccessory />
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  field: { paddingVertical: spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  notice: { paddingVertical: spacing.md, gap: spacing.sm },
  noticeAction: { alignSelf: 'flex-start' },
  noticeText: { fontSize: font.sm, lineHeight: 18, color: colors.textSecondary },
  fieldLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // No lineHeight here, deliberately: RN maps it onto the iOS paragraph style
  // with no baseline compensation, which drops the glyphs a full line below the
  // top of the box while the caret stays centred. A height keeps the row stable
  // instead. See CLAUDE.md.
  input: {
    flex: 1,
    minHeight: 44,
    fontSize: font.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  unit: { fontSize: font.lg, fontWeight: fontWeight.medium, color: colors.textSecondary },
  footnote: {
    fontSize: font.xs,
    color: colors.textTertiary,
    paddingHorizontal: spacing.xs,
  },
});
