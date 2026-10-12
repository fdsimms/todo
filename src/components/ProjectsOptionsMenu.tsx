import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
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
  /** Where the "…" was tapped, so the menu opens from it. See `CardSheet`. */
  anchor?: CardAnchor | null;
  /**
   * Jumps into Settings at the Projects page's first setting, with
   * `settingsHint` naming the ones beside it. Omitted when none are on show.
   */
  onOpenSettings?: () => void;
  settingsHint?: string;
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
  onManageCategories, categoryCount, sort, onSortChange, anchor, onOpenSettings, settingsHint,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const card = useCardSheet();

  // Closes, then runs `then` once the sheet is off screen. A row that opens
  // another sheet goes through here so the two modals don't overlap — a sheet
  // presented from under one that is still animating out inherits the
  // dismissal (see the nested-modal note in ProjectDetail).
  const dismissThen = (then?: () => void) => card.close(then);
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
    <CardSheet
      name="ProjectsOptionsMenu"
      visible={visible}
      onClose={onClose}
      controller={card}
      anchor={anchor}
      popoverWidth={300}
      scrimLabel="Close menu"
    >
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
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
                {completedCount > 0 ? `${completedCount} completed` : 'None completed yet'}
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
            be changed by dragging, so the others say that a drag is off.
            The label lives inside the card (not floating above it like a
            Settings section header) because this sheet sits over the
            translucent backdrop dim rather than an opaque screen — an
            unbacked label there let whatever's dimmed behind it (a project
            category header, most often) read straight through and collide
            with it. */}
        <View style={[styles.optionsCard, styles.secondCard]}>
          <Text style={styles.cardLabel}>Sort by</Text>
          <View style={styles.optionSep} />
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
                  : 'Group projects under your own headings'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          {onOpenSettings && (
            <>
              <View style={styles.optionSep} />
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => {
                  haptics.tap();
                  dismissThen(onOpenSettings);
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Project settings"
              >
                <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
                <View style={styles.optionContent}>
                  <Text style={styles.optionLabel}>Project settings</Text>
                  {!!settingsHint && <Text style={styles.optionHint}>{settingsHint}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  optionsCard: {},
  // Its own group, not a fourth row in the one above: those three are one
  // question (which list am I looking at) with a tick on the current answer,
  // and a row that opens somewhere else is not an answer to it. The band is
  // the iOS menu's group break. It is a translucent separator tint rather than
  // the opaque screen colour, which read as a white bar across the blurred card.
  secondCard: { borderTopWidth: spacing.xsm, borderTopColor: colors.separator + '66' },
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
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs,
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
});
