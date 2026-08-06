import React, { useRef, useEffect, useMemo } from 'react';
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
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  hideCategories: boolean;
  onHideCategoriesChange: (v: boolean) => void;
  /** Opens the "lighten today" sheet. Omitted when there's nothing on the day to move. */
  onLightenDay?: () => void;
  /** Summary of the day's planned time, shown as the action's hint. */
  plannedLabel?: string;
}

/**
 * Bottom action sheet for the Today screen's overflow ("...") menu, separate
 * from the Sort & Filter sheet since it holds display options rather than
 * filters.
 */
export function TodayOptionsMenu({
  visible,
  onClose,
  hideCategories,
  onHideCategoriesChange,
  onLightenDay,
  plannedLabel,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const translateY = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(400);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 500, ...animation.spring.bouncy, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(400);
      onClose();
    });
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdropDim, { opacity: backdropOpacity }]} pointerEvents="none" />
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.optionsCard}>
          {onLightenDay && (
            <>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => {
                  haptics.tap();
                  onLightenDay();
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Lighten today"
              >
                <Ionicons name="leaf-outline" size={18} color={colors.accent} />
                <View style={styles.optionContent}>
                  <Text style={[styles.optionLabel, styles.optionLabelActive]}>Lighten today</Text>
                  <Text style={styles.optionHint}>
                    {plannedLabel
                      ? `${plannedLabel} planned — move some of it to a better day`
                      : 'Move some of today to a better day'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
              <View style={styles.optionSep} />
            </>
          )}
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => {
              haptics.tap();
              onHideCategoriesChange(!hideCategories);
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityState={{ checked: hideCategories }}
            accessibilityLabel="Hide category headers"
          >
            <Ionicons
              name="list-outline"
              size={18}
              color={hideCategories ? colors.accent : colors.textSecondary}
            />
            <View style={styles.optionContent}>
              <Text style={[styles.optionLabel, hideCategories && styles.optionLabelActive]}>
                Hide categories
              </Text>
              <Text style={styles.optionHint}>
                {hideCategories ? 'Showing one flat list of tasks' : 'Group tasks under category headers'}
              </Text>
            </View>
            <View style={[styles.toggle, hideCategories && styles.toggleOn]}>
              <View style={[styles.toggleKnob, hideCategories && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Close</Text>
        </TouchableOpacity>
      </Animated.View>
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
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  optionSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  optionContent: { flex: 1 },
  optionLabel: {
    fontSize: font.md,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
  },
  optionLabelActive: { color: colors.text, fontWeight: fontWeight.semibold },
  optionHint: { color: colors.textTertiary, fontSize: font.sm, marginTop: 2 },
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
