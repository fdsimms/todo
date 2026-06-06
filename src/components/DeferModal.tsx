import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addHours, setHours, setMinutes, addDays, startOfDay } from 'date-fns';
import { colors, spacing, radius, font } from '../theme';

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
  const [mode, setMode] = useState<'quick' | 'custom'>('quick');
  const [customDate, setCustomDate] = useState(addHours(new Date(), 2));

  const handleQuickSelect = (date: Date) => {
    onConfirm(date);
    setMode('quick');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onCancel} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Defer until…</Text>

        {mode === 'quick' ? (
          <>
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
              themeVariant="dark"
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

        <TouchableOpacity style={[styles.option, styles.cancelOption]} onPress={onCancel}>
          <Text style={[styles.optionText, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  option: {
    paddingVertical: 14,
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
