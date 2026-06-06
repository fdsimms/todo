import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addHours, setHours, setMinutes, addDays, startOfDay } from 'date-fns';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, type Colors } from '../theme';
import { parseNaturalDate } from '../utils/parseNaturalDate';
import { formatDeferUntil } from '../utils/dateUtils';

interface Props {
  visible: boolean;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}

function quickOptions(): { label: string; date: Date }[] {
  const now = new Date();
  const todayAt = (h: number, m = 0) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };
  const options = [];

  const tonight = todayAt(20, 0);
  if (now < tonight) options.push({ label: 'Tonight (8 PM)', date: tonight });

  const lateNight = todayAt(22, 0);
  if (now < lateNight) options.push({ label: 'Late night (10 PM)', date: lateNight });

  options.push({ label: 'Tomorrow morning (8 AM)', date: setMinutes(setHours(addDays(startOfDay(now), 1), 8), 0) });
  options.push({ label: 'Tomorrow evening (6 PM)', date: setMinutes(setHours(addDays(startOfDay(now), 1), 18), 0) });
  options.push({ label: 'In 1 hour', date: addHours(now, 1) });
  options.push({ label: 'In 3 hours', date: addHours(now, 3) });

  return options;
}

export function DeferModal({ visible, onConfirm, onCancel }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<'quick' | 'custom'>('quick');
  const [customDate, setCustomDate] = useState(addHours(new Date(), 2));
  const [nlText, setNlText] = useState('');

  const parsed = useMemo(() => parseNaturalDate(nlText), [nlText]);
  const showNlHint = nlText.trim().length > 0 && !parsed;

  const handleQuickSelect = (date: Date) => {
    onConfirm(date);
    setNlText('');
    setMode('quick');
  };

  const submitNl = () => {
    if (parsed) handleQuickSelect(parsed);
  };

  const handleCancel = () => {
    setNlText('');
    setMode('quick');
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleCancel}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleCancel} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Defer until…</Text>

        {mode === 'quick' ? (
          <>
            <View style={styles.nlWrap}>
              <TextInput
                style={styles.nlInput}
                value={nlText}
                onChangeText={setNlText}
                onSubmitEditing={submitNl}
                placeholder='Type a time — "tomorrow at 3pm", "in 2 weeks"…'
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {parsed && (
                <TouchableOpacity style={styles.nlConfirm} onPress={submitNl} hitSlop={6}>
                  <Text style={styles.nlConfirmText}>{formatDeferUntil(parsed.toISOString())}</Text>
                </TouchableOpacity>
              )}
            </View>
            {showNlHint && (
              <Text style={styles.nlError}>Couldn't read that — pick a time below.</Text>
            )}
            {quickOptions().map(opt => (
              <TouchableOpacity
                key={opt.label}
                style={styles.option}
                onPress={() => handleQuickSelect(opt.date)}
              >
                <Text style={styles.optionText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.option, styles.customOption]} onPress={() => setMode('custom')}>
              <Text style={[styles.optionText, { color: colors.accent }]}>Pick a custom time…</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <DateTimePicker
              value={customDate}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_e, date) => date && setCustomDate(date)}
              themeVariant={isDark ? 'dark' : 'light'}
              style={styles.picker}
            />
            <View style={styles.customButtons}>
              <TouchableOpacity onPress={() => setMode('quick')} style={styles.btn}>
                <Text style={[styles.btnText, { color: colors.textSecondary }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { onConfirm(customDate); setMode('quick'); }}
                style={[styles.btn, styles.btnPrimary]}
              >
                <Text style={[styles.btnText, { color: colors.text }]}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <TouchableOpacity style={[styles.option, styles.cancelOption]} onPress={handleCancel}>
          <Text style={[styles.optionText, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: 40,
    paddingHorizontal: spacing.md,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  nlWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  nlInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 13,
  },
  nlConfirm: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  nlConfirmText: {
    color: '#FFFFFF',
    fontSize: font.sm,
    fontWeight: '600',
  },
  nlError: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  option: {
    paddingVertical: 15,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  optionText: {
    color: colors.text,
    fontSize: font.md,
  },
  customOption: {
    borderBottomWidth: 0,
  },
  cancelOption: {
    marginTop: spacing.sm,
    borderBottomWidth: 0,
    alignItems: 'center',
  },
  picker: {
    height: 200,
  },
  customButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnText: {
    fontSize: font.md,
    fontWeight: '600',
  },
});
