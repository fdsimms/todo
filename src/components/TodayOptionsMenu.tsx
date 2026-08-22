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
  /**
   * Opens the "look ahead" sheet — everything landing before a date, and
   * whether it fits. Passed unconditionally like onPullFromProjects: an empty
   * today says nothing about the fortnight ahead, which is the whole point of
   * looking past it.
   */
  onLookAhead: () => void;
  /**
   * Opens the "pull from projects" sheet. Passed unconditionally, unlike
   * onLightenDay — it's how you go looking for a quiet project rather than
   * waiting to be offered one, and it explains itself when nothing is quiet.
   */
  onPullFromProjects: () => void;
  /**
   * Opens the sheet that orders Today's category sections. This is the only way
   * to reorder them — dragging a section header on the list itself is gone.
   */
  onReorderCategories: () => void;
  /** How many categories there are to order, shown as the action's hint. */
  categoryCount: number;
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
  onLookAhead,
  onPullFromProjects,
  onReorderCategories,
  categoryCount,
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
                      ? `${plannedLabel} planned. Move some of it to a better day`
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
              onLookAhead();
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Look ahead"
          >
            <Ionicons name="telescope-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Look ahead</Text>
              <Text style={styles.optionHint}>
                See what lands before a date, and whether it fits
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.optionSep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => {
              haptics.tap();
              onPullFromProjects();
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Pull from projects"
          >
            {/* No accent tint or count any more: a quiet project announces
                itself with a task on the list now, so a second, quieter claim
                buried in a menu would be the app saying it twice. This row is
                the way *in* when you go looking. */}
            <Ionicons name="albums-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Pull from projects</Text>
              <Text style={styles.optionHint}>
                Bring the next thing from a quiet project into today
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.optionSep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => {
              haptics.tap();
              onReorderCategories();
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Category order"
          >
            <Ionicons name="swap-vertical-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Category order</Text>
              <Text style={styles.optionHint}>
                {categoryCount > 0
                  ? `Choose what order your ${categoryCount} ${categoryCount === 1 ? 'category comes' : 'categories come'} in`
                  : 'Add a category to break today into sections'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.optionSep} />
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
              name="eye-off-outline"
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
  toggleKnobOn: { backgroundColor: colors.onAccent, alignSelf: 'flex-end' },
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
