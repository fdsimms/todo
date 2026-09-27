import React, { useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { SheetScrim } from './SheetScrim';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProjectSortOption } from '../types';
import { PROJECT_SORT_LABEL, PROJECT_SORT_OPTIONS, type ProjectListFilter } from '../utils/projectList';

export type ProjectFilter = ProjectListFilter;

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
  sort: ProjectSortOption;
  onSortChange: (sort: ProjectSortOption) => void;
  /** Opens `CookbookChecklistSheet` — a photo of a table of contents in, a list-kind project out. */
  onScanCookbook: () => void;
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
  onManageCategories, categoryCount, onScanCookbook, sort, onSortChange,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

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

  // Closes, then runs `then` once the sheet is off screen. A row that opens
  // another sheet goes through here so the two modals don't overlap — a sheet
  // presented from under one that is still animating out inherits the
  // dismissal (see the nested-modal note in ProjectDetail).
  const dismissThen = (then?: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.bouncy, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
      then?.();
    });
  };
  const dismiss = () => dismissThen();

  const choose = (v: ProjectFilter) => {
    haptics.tap();
    onFilterChange(v);
    dismiss();
  };

  const chooseSort = (v: ProjectSortOption) => {
    haptics.tap();
    onSortChange(v);
    dismiss();
  };

  return (
    <SheetModal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdropDim, { opacity: backdropOpacity }]} pointerEvents="none" />
      <SheetScrim onPress={dismiss} />

      <Animated.View
        style={[
          styles.sheetOuter,
          { paddingBottom: insets.bottom + spacing.sm, transform: [{ translateY }] },
        ]}
      >
        <View style={styles.optionsCard}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose('active')}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Active projects"
            accessibilityState={{ selected: filter === 'active' }}
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
            accessibilityState={{ selected: filter === 'completed' }}
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
            accessibilityState={{ selected: filter === 'archived' }}
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

        {/* Its own card for the same reason the categories row below is: this
            is a second question (in what order), with its own tick. The order
            is applied inside each category section, and only "Your order" can
            be changed by dragging, so the others say that a drag is off. */}
        <Text style={styles.cardLabel}>Sort by</Text>
        <View style={styles.optionsCard}>
          {PROJECT_SORT_OPTIONS.map((option, i) => (
            <React.Fragment key={option}>
              {i > 0 && <View style={styles.optionSep} />}
              <TouchableOpacity
                style={[styles.optionRow, styles.optionRowCompact]}
                onPress={() => chooseSort(option)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Sort by ${PROJECT_SORT_LABEL[option]}`}
                accessibilityState={{ selected: sort === option }}
              >
                <View style={styles.optionContent}>
                  <Text style={[styles.optionLabel, sort === option && styles.optionLabelActive]}>
                    {PROJECT_SORT_LABEL[option]}
                  </Text>
                  {option === 'manual' && (
                    <Text style={styles.optionHint}>Long press a project to move it</Text>
                  )}
                </View>
                {sort === option && <Ionicons name="checkmark" size={18} color={colors.accent} />}
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>

        <View style={[styles.optionsCard, styles.secondCard]}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => {
              haptics.tap();
              dismissThen(onManageCategories);
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
          <View style={styles.optionSep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => {
              haptics.tap();
              dismissThen(onScanCookbook);
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Scan a cookbook"
          >
            <Ionicons name="camera-outline" size={18} color={colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Scan a cookbook</Text>
              <Text style={styles.optionHint}>Photograph its table of contents to build a checklist</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={interaction.activeOpacity} accessibilityRole="button">
          <Text style={styles.cancelLabel}>Close</Text>
        </TouchableOpacity>
      </Animated.View>
    </SheetModal>
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
  // The sort rows carry no icon and at most one hint line, so they sit tighter
  // than the list rows above; four of them at full height pushed the sheet
  // most of the way up a small phone.
  optionRowCompact: { paddingVertical: spacing.smd, minHeight: 48 },
  cardLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: spacing.md, marginTop: spacing.xs, marginBottom: spacing.xs,
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
  optionHint: { color: colors.textTertiary, fontSize: font.sm, marginTop: spacing.xxs },
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
