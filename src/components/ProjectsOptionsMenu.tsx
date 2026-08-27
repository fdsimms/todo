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
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { SheetScrim } from './SheetScrim';

export type ProjectFilter = 'active' | 'completed' | 'archived';

interface Props {
  visible: boolean;
  onClose: () => void;
  filter: ProjectFilter;
  onFilterChange: (v: ProjectFilter) => void;
  completedCount: number;
  archivedCount: number;
  /** Opens the sheet that renames, deletes and reorders project categories. */
  onManageCategories: () => void;
  categoryCount: number;
}

/**
 * The Projects screen's overflow ("...") menu: which of the three lists is on
 * screen, and the door to the category pool. The direct toggle button it
 * replaced took a header slot for something reached rarely, the same reason
 * Today's own display options live behind its "..." rather than as buttons.
 *
 * The category row goes here rather than on the header for the same reason.
 * It's the *only* way to rename, delete or reorder a project category —
 * creating one is offered inline wherever a project is filed, which is why the
 * pool was append-only for so long without it being obvious.
 */
export function ProjectsOptionsMenu({
  visible, onClose, filter, onFilterChange, completedCount, archivedCount,
  onManageCategories, categoryCount,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(hiddenY);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.bouncy, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
    });
  };

  const choose = (v: ProjectFilter) => {
    haptics.tap();
    onFilterChange(v);
    dismiss();
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdropDim, { opacity: backdropOpacity }]} pointerEvents="none" />
      <SheetScrim onPress={dismiss} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.optionsCard}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose('active')}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Active projects"
          >
            <Ionicons name="briefcase-outline" size={18} color={filter === 'active' ? colors.accent : colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={[styles.optionLabel, filter === 'active' && styles.optionLabelActive]}>Active projects</Text>
            </View>
            {filter === 'active' && <Ionicons name="checkmark" size={18} color={colors.accent} />}
          </TouchableOpacity>
          <View style={styles.optionSep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose('completed')}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Completed projects"
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={filter === 'completed' ? colors.accent : colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={[styles.optionLabel, filter === 'completed' && styles.optionLabelActive]}>Completed projects</Text>
              <Text style={styles.optionHint}>
                {completedCount > 0 ? `${completedCount} completed` : 'None marked complete yet'}
              </Text>
            </View>
            {filter === 'completed' && <Ionicons name="checkmark" size={18} color={colors.accent} />}
          </TouchableOpacity>
          <View style={styles.optionSep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose('archived')}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Archived projects"
          >
            <Ionicons name="archive-outline" size={18} color={filter === 'archived' ? colors.accent : colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={[styles.optionLabel, filter === 'archived' && styles.optionLabelActive]}>Archived projects</Text>
              <Text style={styles.optionHint}>
                {archivedCount > 0 ? `${archivedCount} archived` : 'None archived yet'}
              </Text>
            </View>
            {filter === 'archived' && <Ionicons name="checkmark" size={18} color={colors.accent} />}
          </TouchableOpacity>
        </View>

        <View style={[styles.optionsCard, styles.secondCard]}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => {
              haptics.tap();
              // Dismissed first, so the two modals don't overlap — a sheet
              // presented from under one that is still animating out inherits
              // the dismissal (see the nested-modal note in ProjectDetail).
              Animated.parallel([
                Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.bouncy, useNativeDriver: true }),
                Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
              ]).start(() => {
                onClose();
                onManageCategories();
              });
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Project categories"
          >
            <Ionicons name="folder-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Project categories</Text>
              <Text style={styles.optionHint}>
                {categoryCount > 0
                  ? `Rename, reorder or delete the ${categoryCount === 1 ? 'one you have' : `${categoryCount} you have`}`
                  : 'Group projects under headings of your own'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
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
  // Its own card, not a fourth row in the one above: those three are one
  // question (which list am I looking at) with a tick on the current answer,
  // and a row that opens somewhere else is not an answer to it.
  secondCard: { marginBottom: spacing.sm },
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
    color: colors.text,
  },
  optionLabelActive: { color: colors.text, fontWeight: fontWeight.semibold },
  optionHint: { color: colors.textTertiary, fontSize: font.sm, marginTop: 2 },
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
