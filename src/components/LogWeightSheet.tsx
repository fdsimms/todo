import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Linking } from 'react-native';
import { format } from 'date-fns/format';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore } from '../store/useHealthStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart, getLogicalToday } from '../utils/dateUtils';
import { logWeightToHealth } from '../utils/healthWeightSync';
import { parseWeightInput } from '../utils/weightLog';
import { EditorSheet } from './EditorSheet';
import { EditorRow } from './EditorRow';
import { SheetHeaderButton } from './SheetHeaderButton';
import { WhenPicker } from './WhenPicker';

/**
 * Recording a weight, which writes a body-mass sample to Apple Health.
 *
 * An `EditorSheet` (full screen) rather than a page sheet, so there is no
 * swipe-down to guard against — the other valid answer to CLAUDE.md's
 * `onRequestClose` rule, and the one `MoodLogSheet` already takes for the same
 * kind of staged-then-saved form.
 *
 * **The date may go backwards but not forwards**, exactly like a mood entry and
 * for the same reason: forgetting to log this morning's weigh-in until the
 * evening is ordinary, and recording a weight against a day nobody has lived
 * yet is not a thing to want.
 *
 * **Every failure says which failure it was.** The water write swallows all of
 * them alike because nobody is watching a task completion; here somebody has
 * typed a number and is waiting to see it land, so "nothing happened" would be
 * the wrong answer to give them — particularly for the common case, which is
 * that Health's own sharing permission was never granted.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function LogWeightSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const unit = useSettingsStore(s => s.weightUnit);
  const refreshWeight = useHealthStore(s => s.refreshWeight);

  const [text, setText] = useState('');
  const [day, setDay] = useState<Date>(() => getLogicalToday());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const kilograms = parseWeightInput(text, unit);
  const canSave = kilograms !== null && !saving;

  const close = () => {
    setText('');
    setDay(getLogicalToday());
    setSaving(false);
    onClose();
  };

  const save = async () => {
    if (kilograms === null || saving) return;
    haptics.tap();
    setSaving(true);

    // A weigh-in recorded for today is stamped with the actual moment; a
    // backdated one lands at noon on its own day, which is what
    // `getLogicalToday` already hands back for any other day. Health files a
    // sample by its instant, so the distinction is the difference between "this
    // morning" and "some time on the 3rd".
    const when = dayKeyOf(day) === dayKeyOf(getCurrentDayStart()) ? new Date() : day;
    const result = await logWeightToHealth(kilograms, when);
    setSaving(false);

    if (result === 'written') {
      haptics.success();
      void refreshWeight();
      close();
      return;
    }

    haptics.error();
    if (result === 'off') {
      Alert.alert(
        'Logging to Health is off',
        'Turn on "Log to Health" in Settings before recording a weight.',
      );
      return;
    }
    if (result === 'refused') {
      Alert.alert(
        'Health would not accept it',
        'Open the Health app, find this app under Sharing, and allow it to write weight.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }
    if (result === 'invalid') {
      Alert.alert('That is not a weight', 'Enter a number your scale could have shown.');
      return;
    }
    Alert.alert('Health is not available', 'This device cannot record a weight.');
  };

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={close}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={close} minWidth={64} />
          <Text style={styles.headerTitle}>Record a weight</Text>
          <SheetHeaderButton label="Save" onPress={save} disabled={!canSave} minWidth={64} />
        </>
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
      <View style={styles.card}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Weight</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              placeholder="e.g. 72.4"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              accessibilityLabel={`Weight in ${unit === 'kg' ? 'kilograms' : 'pounds'}`}
            />
            <Text style={styles.unit}>{unit}</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <EditorRow
          icon="calendar-outline"
          label="Day"
          value={dayKeyOf(day) === dayKeyOf(getCurrentDayStart())
            ? 'Today'
            : format(day, 'EEE d MMM')}
          onPress={() => { haptics.tap(); setPickerOpen(true); }}
        />
      </View>

      <Text style={styles.footnote}>
        Saved to Apple Health. This app keeps no copy of it, so editing or
        removing a weight is done in the Health app.
      </Text>
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
    paddingVertical: spacing.sm,
  },
  headerTitle: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.text },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  field: { paddingVertical: spacing.md },
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
    height: 44,
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
