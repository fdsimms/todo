import React, { useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import type { SavedMeal } from '../types';
import { savedMealCalories } from '../utils/foodLog';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  meals: SavedMeal[];
  /** Logs the meal at whichever slot/moment the caller already knows about — this sheet asks neither. */
  onLog: (meal: SavedMeal) => void;
  onDelete: (meal: SavedMeal) => void;
  /**
   * Opens a meal for changes before it is logged (`SavedMealReviewSheet`),
   * which is what tapping a row does. Omitted by a caller with nowhere to send
   * it, in which case a tap logs the meal as saved.
   */
  onReview?: (meal: SavedMeal) => void;
  /**
   * Sheets raised from this one (the review), rendered **inside** its Modal so
   * they present from it rather than from the root, which is already
   * presenting this sheet. See `overlays` on `FoodLogEntrySheet`.
   */
  overlays?: ReactNode;
  onClose: () => void;
}

/**
 * Every saved meal, one tap to log the whole thing again.
 *
 * Reached from the ordinary add-food sheet the same way Scan and Describe
 * are (see `FoodLogEntrySheet`'s `onSavedMeal`) and from the Food log's header.
 *
 * A row's body opens the meal for changes first (a different amount, a food
 * swapped or left out), and the staging that needs lives in the review sheet it
 * raises, not here. The Log button on the row is the one-tap path for a meal
 * eaten exactly as saved. Opening was made the tap because the other way round
 * hid it: a row that logged on tap left changing an amount behind a small icon
 * nobody found. Nothing here is staged, so there is no unsaved-changes guard
 * to wire (see the `onRequestClose` rule in CLAUDE.md): logging and deleting
 * both commit the moment they're tapped, same as `StandingSwapsSheet`.
 */
export function SavedMealsSheet({ visible, meals, onLog, onDelete, onReview, overlays, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const handleLog = (meal: SavedMeal) => {
    haptics.success();
    onLog(meal);
  };

  const handleDelete = (meal: SavedMeal) => {
    confirmDelete({
      title: `Forget “${meal.name}”?`,
      message: 'Only the shortcut to log it again is removed. Anything already logged stays.',
      confirmLabel: 'Forget',
      onConfirm: () => { haptics.warning(); onDelete(meal); },
    });
  };

  return (
    <SheetModal name="Saved meals" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title="Saved meals"
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={56} />}
        />

        {meals.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="bookmark-outline"
              title="No saved meals yet"
              subtitle={
                'Select entries on the food log, then choose “Save as meal” to log them together in one tap.'
              }
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <View style={styles.card}>
              {meals.map((meal, i) => {
                const calories = savedMealCalories(meal.items);
                const itemWord = meal.items.length === 1 ? 'item' : 'items';
                return (
                  <View key={meal.id}>
                    {i > 0 && <View style={styles.sep} />}
                    <View style={styles.row}>
                      {/* The name wraps rather than truncating: it is what the row is for. */}
                      <TouchableOpacity
                        style={styles.body}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => { if (onReview) { haptics.tap(); onReview(meal); } else handleLog(meal); }}
                        accessibilityRole="button"
                        accessibilityLabel={onReview ? `Change ${meal.name} before logging` : `Log ${meal.name}`}
                      >
                        <Text style={styles.name}>{meal.name}</Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          {meal.items.length} {itemWord}
                          {calories !== null ? ` · ${calories} cal` : ''}
                        </Text>
                      </TouchableOpacity>
                      {!!onReview && (
                        <InlineAction
                          label="Log"
                          icon="add"
                          onPress={() => handleLog(meal)}
                          accessibilityLabel={`Log ${meal.name} as saved`}
                        />
                      )}
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        hitSlop={8}
                        onPress={() => handleDelete(meal)}
                        accessibilityRole="button"
                        accessibilityLabel={`Forget ${meal.name}`}
                      >
                        <Ionicons name="trash-outline" size={iconSize.sm} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
        {overlays}
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    headerSpacer: { width: 56 },
    emptyWrap: { flex: 1, paddingHorizontal: spacing.md },
    list: { padding: spacing.md, paddingBottom: spacing.xl },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    body: { flex: 1 },
    name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    meta: { color: colors.textSecondary, fontSize: font.sm, marginTop: 2 },
    deleteBtn: { padding: spacing.xs },
  });
}
