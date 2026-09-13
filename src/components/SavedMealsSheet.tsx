import React, { useMemo } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import type { SavedMeal } from '../types';
import { savedMealCalories } from '../utils/foodLog';
import { haptics } from '../utils/haptics';
import { EmptyState } from './EmptyState';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  meals: SavedMeal[];
  /** Logs the meal at whichever slot/moment the caller already knows about — this sheet asks neither. */
  onLog: (meal: SavedMeal) => void;
  onDelete: (meal: SavedMeal) => void;
  onClose: () => void;
}

/**
 * Every saved meal, one tap to log the whole thing again.
 *
 * Reached from the ordinary add-food sheet the same way Scan and Describe
 * are — see `FoodLogEntrySheet`'s `onSavedMeal` — and each row logs
 * immediately rather than opening a picker of its own: a saved meal exists
 * to skip re-finding and re-amounting each food, so tapping it is the whole
 * interaction. Nothing here is staged, so there is no unsaved-changes guard
 * to wire (see the `onRequestClose` rule in CLAUDE.md) — logging and
 * deleting both commit the moment they're tapped, same as `StandingSwapsSheet`.
 */
export function SavedMealsSheet({ visible, meals, onLog, onDelete, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const handleLog = (meal: SavedMeal) => {
    haptics.success();
    onLog(meal);
  };

  const handleDelete = (meal: SavedMeal) => {
    Alert.alert(
      `Forget "${meal.name}"?`,
      'This does not touch anything already logged with it — only the shortcut to log it again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => { haptics.warning(); onDelete(meal); },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title="Saved meals"
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />}
        />

        {meals.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="bookmark-outline"
              title="No saved meals yet"
              subtitle={
                'Select a few entries on the food log and choose "Save as meal" to build a combination you can log again in one tap.'
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
                    <TouchableOpacity
                      style={styles.row}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => handleLog(meal)}
                      accessibilityRole="button"
                      accessibilityLabel={`Log ${meal.name}`}
                    >
                      <View style={styles.body}>
                        <Text style={styles.name} numberOfLines={1}>{meal.name}</Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          {meal.items.length} {itemWord}
                          {calories !== null ? ` · ${calories} cal` : ''}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        hitSlop={8}
                        onPress={() => handleDelete(meal)}
                        accessibilityRole="button"
                        accessibilityLabel={`Forget ${meal.name}`}
                      >
                        <Ionicons name="trash-outline" size={iconSize.sm} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
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
