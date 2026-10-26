import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { Alarm, AlarmMission } from '../types';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { MissionPicker } from './MissionPicker';
import { AlarmSoundRows } from './AlarmSoundRows';
import { RingtonePickerSheet } from './RingtonePickerSheet';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useAlarmStore } from '../store/useAlarmStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { describeRepeat } from '../utils/alarms';
import { soundChoiceFrom } from '../utils/alarmSounds';
import { confirmDiscard } from '../utils/confirmDiscard';
import { confirmDelete } from '../utils/confirmDelete';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The alarm to edit, or null for a new one. */
  alarm: Alarm | null;
  onClose: () => void;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Draft {
  hour: number;
  minute: number;
  label: string;
  repeatDays: number[];
  mission: AlarmMission | null;
  sound: string | null;
  soundPool: string[];
}

function draftFor(alarm: Alarm | null): Draft {
  if (alarm) {
    return {
      hour: alarm.hour, minute: alarm.minute, label: alarm.label, repeatDays: alarm.repeatDays,
      mission: alarm.mission, sound: alarm.sound, soundPool: alarm.soundPool,
    };
  }
  return { hour: 7, minute: 0, label: '', repeatDays: [], mission: null, sound: null, soundPool: [] };
}

const sameDraft = (a: Draft, b: Draft) =>
  a.hour === b.hour && a.minute === b.minute && a.label.trim() === b.label.trim()
  && [...a.repeatDays].sort().join() === [...b.repeatDays].sort().join()
  && JSON.stringify(a.mission) === JSON.stringify(b.mission)
  && a.sound === b.sound
  && a.soundPool.join() === b.soundPool.join();

/**
 * Adds or edits an alarm of its own (utils/alarms.ts): the time, the label,
 * the days it repeats on, and its mission. Saving switches it on. A page
 * sheet that stages its fields until Save, so a swipe down asks before
 * throwing an edit away (CLAUDE.md, the pageSheet `onRequestClose` rule).
 */
export function AlarmEditorSheet({ visible, alarm, onClose }: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const [draft, setDraft] = useState<Draft>(() => draftFor(alarm));
  const [opened, setOpened] = useState<Draft>(() => draftFor(alarm));
  const [ringtonesOpen, setRingtonesOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const start = draftFor(alarm);
    setDraft(start);
    setOpened(start);
    setRingtonesOpen(false);
  }, [visible, alarm]);

  const patch = (next: Partial<Draft>) => setDraft(d => ({ ...d, ...next }));
  const time = new Date(2000, 0, 1, draft.hour, draft.minute);
  const dayOrder = [0, 1, 2, 3, 4, 5, 6].map(i => (i + weekStartsOn) % 7);

  const handleCancel = () => {
    if (sameDraft(draft, opened)) {
      onClose();
      return;
    }
    confirmDiscard(onClose);
  };

  const handleSave = () => {
    haptics.success();
    useAlarmStore.getState().saveAlarm({ id: alarm?.id, ...draft });
    onClose();
  };

  const handleDelete = () => {
    if (!alarm) return;
    confirmDelete({
      title: 'Delete this alarm?',
      message: 'It won’t ring again.',
      onConfirm: () => {
        useAlarmStore.getState().deleteAlarm(alarm.id);
        onClose();
      },
    });
  };

  const toggleDay = (day: number) => {
    haptics.tap();
    patch({ repeatDays: draft.repeatDays.includes(day) ? draft.repeatDays.filter(d => d !== day) : [...draft.repeatDays, day] });
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title={alarm ? 'Edit Alarm' : 'New Alarm'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={handleSave} minWidth={64} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <View style={styles.card}>
            <DateTimePicker
              value={time}
              mode="time"
              display="spinner"
              onChange={(_e, d) => { if (d) patch({ hour: d.getHours(), minute: d.getMinutes() }); }}
              themeVariant={isDark ? 'dark' : 'light'}
              style={styles.wheel}
            />
          </View>

          <Text style={styles.label}>Label</Text>
          <View style={styles.card}>
            <TextField
              style={styles.input}
              value={draft.label}
              onChangeText={t => patch({ label: t })}
              placeholder="e.g. Wake up"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              maxLength={60}
              accessibilityLabel="Alarm label"
            />
          </View>

          <View style={styles.labelRow}>
            <Text style={styles.label}>Repeat</Text>
            <Text style={styles.repeatValue}>{describeRepeat(draft.repeatDays, weekStartsOn)}</Text>
          </View>
          <View style={[styles.card, styles.days]}>
            {dayOrder.map(day => {
              const on = draft.repeatDays.includes(day);
              return (
                <TouchableOpacity
                  key={day}
                  style={[styles.day, on && styles.dayOn]}
                  onPress={() => toggleDay(day)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={DAY_NAMES[day]}
                >
                  <Text style={[styles.dayText, on && styles.dayTextOn]}>{DAY_LETTERS[day]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Mission</Text>
          <View style={styles.card}>
            <HelpText style={styles.hint}>
              With a mission, the alarm rings again every 15 seconds after you stop it, until the mission is done.
            </HelpText>
            <MissionPicker value={draft.mission} onChange={mission => patch({ mission })} />
          </View>

          <Text style={styles.label}>Sound</Text>
          <View style={styles.rowsCard}>
            <AlarmSoundRows
              sound={draft.sound}
              soundPool={draft.soundPool}
              onOpenRingtones={() => setRingtonesOpen(true)}
            />
          </View>

          {alarm && (
            <TouchableOpacity
              style={[styles.card, styles.delete]}
              onPress={handleDelete}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
            >
              <Text style={styles.deleteText}>Delete Alarm</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
      {/* Inside this sheet's Modal, never beside it ("Two sibling Modals"). */}
      <RingtonePickerSheet
        visible={visible && ringtonesOpen}
        multiple
        values={draft.soundPool.length > 0 ? draft.soundPool : draft.sound === null ? [] : [draft.sound]}
        onChangeValues={sounds => patch(soundChoiceFrom(sounds))}
        onClose={() => setRingtonesOpen(false)}
      />
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  bodyContent: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  wheel: { alignSelf: 'center' },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.md,
  },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  repeatValue: { color: colors.accentText, fontSize: font.sm, marginRight: spacing.md },
  input: { color: colors.text, fontSize: font.md, minHeight: 24, padding: 0 },
  days: { flexDirection: 'row', justifyContent: 'space-between' },
  day: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOn: { backgroundColor: colors.accentFill },
  dayText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
  dayTextOn: { color: colors.onAccent },
  hint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, marginBottom: spacing.smd },
  rowsCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  delete: { marginTop: spacing.lg, alignItems: 'center' },
  deleteText: { color: colors.redText, fontSize: font.md },
});
