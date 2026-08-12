import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, interaction, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { CalendarPicker } from './CalendarPicker';

interface Props {
  visible: boolean;
  /** Current completion date/time of the entry the menu was opened for. */
  value: Date | null;
  onMarkIncomplete: () => void;
  onChangeDate: (date: Date) => void;
  /**
   * Opens the answer prompt again for a decision task (see
   * Task.deliverableKind). Omitted for every ordinary entry, which is what
   * keeps this row off the menu for tasks that never asked anything.
   */
  onEditAnswer?: () => void;
  /** Whether this entry was completed *with* an answer — the row's wording. */
  hasAnswer?: boolean;
  /** Deletes the entry outright. The caller confirms — see LogbookScreen. */
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Bottom action sheet for a Logbook entry: marking it incomplete, editing the
 * completion date/time via CalendarPicker, or deleting it.
 *
 * Delete sits in its own card below the others, iOS-style: it's the one
 * destructive option here, and grouping it with them would put it a stray tap
 * away from "Mark Incomplete".
 */
export function LogbookEntryMenu({
  visible, value, onMarkIncomplete, onChangeDate, onEditAnswer, hasAnswer = false, onDelete, onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [showCalendar, setShowCalendar] = useState(false);

  const translateY = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      setShowCalendar(false);
      translateY.setValue(400);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const closeThen = (cb: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 500, ...animation.spring.bouncy, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(400);
      cb();
    });
  };

  const dismiss = () => closeThen(onClose);

  const markIncomplete = () => {
    haptics.tap();
    closeThen(onMarkIncomplete);
  };

  const deleteEntry = () => {
    haptics.warning();
    closeThen(onDelete);
  };

  const openCalendar = () => {
    haptics.tap();
    Animated.spring(translateY, { toValue: 500, ...animation.spring.bouncy, useNativeDriver: true }).start(() => {
      setShowCalendar(true);
    });
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdropDim, { opacity: backdropOpacity }]} pointerEvents="none" />
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.optionsCard}>
          <TouchableOpacity style={styles.optionRow} onPress={markIncomplete} activeOpacity={interaction.activeOpacity}>
            <Ionicons name="arrow-undo-outline" size={18} color={colors.accent} />
            <Text style={styles.optionLabel}>Mark Incomplete</Text>
          </TouchableOpacity>
          <View style={styles.inlineSep} />
          <TouchableOpacity style={styles.optionRow} onPress={openCalendar} activeOpacity={interaction.activeOpacity}>
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <Text style={styles.optionLabel}>Change Completion Date</Text>
          </TouchableOpacity>
          {onEditAnswer && (
            <>
              <View style={styles.inlineSep} />
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => { haptics.tap(); closeThen(onEditAnswer); }}
                activeOpacity={interaction.activeOpacity}
              >
                <Ionicons name="help" size={18} color={colors.accent} />
                <Text style={styles.optionLabel}>{hasAnswer ? 'Edit Answer' : 'Add Answer'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.optionsCard}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={deleteEntry}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Delete entry"
          >
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <Text style={[styles.optionLabel, styles.destructiveLabel]}>Delete Entry</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>

      <CalendarPicker
        visible={showCalendar}
        value={value}
        mode="datetime"
        title="Completion Date"
        onConfirm={date => {
          // Close the pageSheet first and let its dismiss animation finish
          // before hiding the outer sheet Modal — closing both native Modals
          // in the same tick can deadlock the iOS modal transition and
          // freeze the app.
          setShowCalendar(false);
          closeTimeoutRef.current = setTimeout(() => onChangeDate(date), animation.duration.slow);
        }}
        onCancel={() => {
          setShowCalendar(false);
          closeTimeoutRef.current = setTimeout(() => onClose(), animation.duration.slow);
        }}
      />
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: {
    backgroundColor: colors.backdrop,
  },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
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
    gap: spacing.sm,
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  optionLabel: {
    color: colors.accent,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  destructiveLabel: {
    color: colors.red,
  },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
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
