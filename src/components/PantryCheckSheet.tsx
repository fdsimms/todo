import React, { Fragment, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet } from './CardSheet';
import { useGroceryStore } from '../store/useGroceryStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, border, iconSize, lineHeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  /** The grocery item the "Check if you still have X" task is about. */
  itemId: string;
  onClose: () => void;
}

interface Row {
  key: 'have' | 'new' | 'low' | 'low-list' | 'out' | 'out-list';
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: 'accent' | 'red';
  label: string;
  detail: string;
  feedback: () => void;
}

const ROWS: Row[] = [
  {
    key: 'have',
    icon: 'checkmark-circle-outline',
    tone: 'accent',
    label: 'Still have it',
    detail: 'Keeps it in your pantry and starts its window over.',
    feedback: haptics.success,
  },
  {
    key: 'new',
    icon: 'bag-add-outline',
    tone: 'accent',
    label: 'Bought more',
    detail: 'You restocked, so the old packet no longer counts. Keeps it in your pantry as a fresh one.',
    feedback: haptics.success,
  },
  {
    key: 'low',
    icon: 'contrast-outline',
    tone: 'accent',
    label: 'Running low',
    detail: 'Keeps it in your pantry as nearly out, without adding it to your grocery list.',
    feedback: haptics.tap,
  },
  {
    key: 'low-list',
    icon: 'cart-outline',
    tone: 'accent',
    label: 'Running low, add to list',
    detail: 'Keeps it in your pantry as nearly out and puts it on your grocery list.',
    feedback: haptics.tap,
  },
  {
    key: 'out',
    icon: 'close-circle-outline',
    tone: 'red',
    label: 'Out of it',
    detail: 'Takes it out of your pantry until you get more.',
    feedback: haptics.tap,
  },
  {
    key: 'out-list',
    icon: 'cart-outline',
    tone: 'accent',
    label: 'Out of it, add to list',
    detail: 'Takes it out of your pantry and puts it on your grocery list.',
    feedback: haptics.tap,
  },
];

/**
 * The card a "Check if you still have X" task opens from its row's link button
 * (`pantryCheckTasks.ts`). It asks the question the task is about and writes
 * the answer with the same call the pantry review deck uses
 * (`answerPantryReview`), so each button writes exactly what the matching pill
 * on the item's own sheet writes. "Out of it, add to list" is that same "out"
 * plus the row joining the home list, and "Running low" comes in the same two
 * forms (running low is the one answer that can reach the list itself, so its
 * rows pass `addToList` rather than following the setting). That answer is also what retires the task:
 * either one makes the item stop wanting a check, and `checkPantryCheckTasks`
 * drops the row, run here so it leaves now rather than at the next sweep.
 *
 * Dismissing the card writes nothing, and neither does ticking the task, so a
 * tick still never claims "yes I still have it".
 */
export function PantryCheckSheet({ visible, itemId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const name = useGroceryStore(s => s.itemById(itemId)?.name ?? null);

  const answer = (key: Row['key']) => {
    const groceries = useGroceryStore.getState();
    if (key === 'low' || key === 'low-list') {
      // Says the list choice outright, so the "Running low adds to the list"
      // setting can't override the row that was tapped. Onto the home list,
      // which `answerPantryReview` does for 'low'.
      groceries.answerPantryReview(itemId, 'low', { addToList: key === 'low-list' });
    } else {
      groceries.answerPantryReview(itemId, key === 'have' ? 'have' : key === 'new' ? 'new' : 'out');
    }
    // The home list, not whichever one is open: this is answered from a task
    // row, and an away list is that trip's own.
    if (key === 'out-list') groceries.addExistingMany([itemId], { listId: null });
    useTaskStore.getState().checkPantryCheckTasks();
  };

  return (
    <CardSheet
      name="PantryCheckSheet"
      visible={visible}
      controller={card}
      onClose={onClose}
      onRequestClose={() => card.close()}
      scrimLabel="Close"
    >
      <View style={styles.header}>
        <Text style={styles.title}>{name ? `Do you still have ${name}?` : 'Do you still have this?'}</Text>
      </View>
      {ROWS.map(row => (
        <Fragment key={row.key}>
          <View style={styles.sep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { row.feedback(); card.close(() => answer(row.key)); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}. ${row.detail}`}
          >
            <Ionicons
              name={row.icon}
              size={iconSize.md}
              color={row.tone === 'red' ? colors.redText : colors.accent}
              style={styles.icon}
            />
            <View style={styles.text}>
              <Text style={[styles.label, row.tone === 'red' && styles.redLabel]}>{row.label}</Text>
              <Text style={styles.detail}>{row.detail}</Text>
            </View>
          </TouchableOpacity>
        </Fragment>
      ))}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.smd,
  },
  title: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.smd,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  icon: { marginTop: spacing.xxs },
  text: { flex: 1 },
  label: {
    color: colors.text,
    fontSize: font.lg,
  },
  redLabel: { color: colors.redText },
  detail: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    marginTop: spacing.xxs,
    fontWeight: fontWeight.regular,
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
  },
});
