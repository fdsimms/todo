import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { addDays, addWeeks, addMonths, startOfDay } from 'date-fns';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, type Colors } from '../theme';

interface Props {
  visible: boolean;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}

function dayOptions(): { label: string; sublabel: string; date: Date }[] {
  const now = new Date();
  const noonOf = (d: Date) => {
    const result = startOfDay(d);
    result.setHours(12, 0, 0, 0);
    return result;
  };

  return [
    {
      label: 'Tomorrow',
      sublabel: addDays(now, 1).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      date: noonOf(addDays(now, 1)),
    },
    {
      label: 'In 2 days',
      sublabel: addDays(now, 2).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      date: noonOf(addDays(now, 2)),
    },
    {
      label: 'Next week',
      sublabel: addWeeks(now, 1).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      date: noonOf(addWeeks(now, 1)),
    },
    {
      label: 'In 2 weeks',
      sublabel: addWeeks(now, 2).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      date: noonOf(addWeeks(now, 2)),
    },
    {
      label: 'Next month',
      sublabel: addMonths(now, 1).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
      date: noonOf(addMonths(now, 1)),
    },
  ];
}

export function DeferModal({ visible, onConfirm, onCancel }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const options = useMemo(() => dayOptions(), []);

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
        <Text style={styles.title}>Defer to…</Text>

        {options.map(opt => (
          <TouchableOpacity
            key={opt.label}
            style={styles.option}
            onPress={() => onConfirm(opt.date)}
          >
            <Text style={styles.optionText}>{opt.label}</Text>
            <Text style={styles.optionSub}>{opt.sublabel}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={[styles.option, styles.cancelOption]} onPress={onCancel}>
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
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  optionText: {
    color: colors.text,
    fontSize: font.md,
  },
  optionSub: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  cancelOption: {
    marginTop: spacing.sm,
    borderBottomWidth: 0,
    justifyContent: 'center',
  },
});
