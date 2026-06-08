import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { addDays, addWeeks, addMonths, startOfDay } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, type Colors } from '../theme';
import type { SnoozeSuggestion } from '../utils/snoozeEngine';
import { CalendarPicker } from './CalendarPicker';

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
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const options = useMemo(() => dayOptions(), []);
  const [showCalendar, setShowCalendar] = useState(false);

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(600);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          damping: 26,
          stiffness: 220,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 700,
        damping: 28,
        stiffness: 320,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      translateY.setValue(600);
      onCancel();
    });
  };

  const openCalendar = () => {
    Animated.spring(translateY, {
      toValue: 700,
      damping: 28,
      stiffness: 320,
      useNativeDriver: true,
    }).start(() => {
      setShowCalendar(true);
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
        if (dy > 80 || vy > 1.2) {
          Animated.parallel([
            Animated.spring(translateY, {
              toValue: 700,
              damping: 28,
              stiffness: 320,
              useNativeDriver: true,
            }),
            Animated.timing(backdropOpacity, {
              toValue: 0,
              duration: 150,
              useNativeDriver: true,
            }),
          ]).start(() => {
            translateY.setValue(600);
            onCancel();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            damping: 22,
            stiffness: 300,
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
      {/* Blur backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <BlurView
          intensity={isDark ? 20 : 15}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        {/* Handle for drag */}
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        {/* Options card — iOS action sheet style */}
        <View style={styles.optionsCard}>
          {snoozeSuggestion != null && (
            <>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => {
                  Haptics.selectionAsync();
                  onConfirm(snoozeSuggestion.date);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.optionLeft}>
                  <Text style={[styles.optionLabel, { color: colors.accent }]}>
                    {snoozeSuggestion.dayLabel}
                  </Text>
                  <Text style={styles.snoozeReason}>{snoozeSuggestion.reason}</Text>
                </View>
                <Text style={[styles.optionSub, { color: colors.accent, opacity: 0.7 }]}>Snooze</Text>
              </TouchableOpacity>
              <View style={styles.inlineSep} />
            </>
          )}

          {options.map((opt, idx) => (
            <React.Fragment key={opt.label}>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => {
                  Haptics.selectionAsync();
                  onConfirm(opt.date);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.optionLabel}>{opt.label}</Text>
                <Text style={styles.optionSub}>{opt.sublabel}</Text>
              </TouchableOpacity>
              {idx < options.length - 1 && <View style={styles.inlineSep} />}
            </React.Fragment>
          ))}

          <View style={styles.inlineSep} />
          <TouchableOpacity style={styles.optionRow} onPress={openCalendar} activeOpacity={0.7}>
            <View style={styles.customDateRow}>
              <Ionicons name="calendar-outline" size={16} color={colors.accent} />
              <Text style={[styles.optionLabel, { color: colors.accent }]}>Pick a date…</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* Cancel card — iOS-style separate rounded block */}
        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={0.7}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>

      <CalendarPicker
        visible={showCalendar}
        value={null}
        mode="date"
        title="Defer Until"
        onConfirm={date => {
          setShowCalendar(false);
          const noon = new Date(date);
          noon.setHours(12, 0, 0, 0);
          onConfirm(noon);
        }}
        onCancel={() => {
          setShowCalendar(false);
          onCancel();
        }}
      />
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: {
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheetOuter: {
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,120,128,0.5)',
  },
  optionsCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  optionLeft: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
  },
  optionSub: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  customDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  snoozeReason: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
