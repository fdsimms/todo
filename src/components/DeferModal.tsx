import React, { useRef, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import { addDays, addWeeks, addMonths, startOfDay } from 'date-fns';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, type Colors } from '../theme';
import type { SnoozeSuggestion } from '../utils/snoozeEngine';

interface Props {
  visible: boolean;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
  snoozeSuggestion?: SnoozeSuggestion | null;
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

export function DeferModal({ visible, onConfirm, onCancel, snoozeSuggestion }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const options = useMemo(() => dayOptions(), []);

  const translateY = useRef(new Animated.Value(600)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(600);
      Animated.spring(translateY, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.timing(translateY, {
      toValue: 600,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      translateY.setValue(600);
      onCancel();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 0.5) {
          Animated.timing(translateY, {
            toValue: 600,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            translateY.setValue(600);
            onCancel();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            tension: 65,
            friction: 11,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={dismiss} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>
        <Text style={styles.title}>Defer to…</Text>

        {snoozeSuggestion != null && (
          <>
            <TouchableOpacity
              style={[styles.option, styles.snoozeOption]}
              onPress={() => onConfirm(snoozeSuggestion.date)}
            >
              <View style={styles.snoozeLeft}>
                <Text style={[styles.optionText, { color: colors.accent }]}>
                  {snoozeSuggestion.dayLabel}
                </Text>
                <Text style={styles.snoozeReason}>{snoozeSuggestion.reason}</Text>
              </View>
              <Text style={[styles.optionSub, { color: colors.accent, opacity: 0.7 }]}>Snooze</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
          </>
        )}

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

        <TouchableOpacity style={[styles.option, styles.cancelOption]} onPress={dismiss}>
          <Text style={[styles.optionText, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
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
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
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
  snoozeOption: {
    borderBottomWidth: 0,
  },
  snoozeLeft: {
    flex: 1,
    gap: 2,
  },
  snoozeReason: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
});
