import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { LazySheet } from './LazySheet';
import { FoodLogEntrySheet } from './FoodLogEntrySheet';
import { TextField } from './TextField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { savedMealCalories } from '../utils/foodLog';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import type { MealSlot, SavedMealItem } from '../types';

interface Props {
  visible: boolean;
  slot: MealSlot | null;
  at: Date;
  /** Saves the meal and returns whether it was written (the store refuses a blank name). */
  onSave: (name: string, items: SavedMealItem[]) => boolean;
  onClose: () => void;
}

/**
 * A saved meal built from scratch: a name and the foods in it, with nothing
 * logged. The other way to make one is selecting entries already on the food
 * log, which needs the food eaten first.
 *
 * Foods come from `FoodLogEntrySheet` in its `onPickFood` mode, the same picker
 * `SavedMealReviewSheet` uses to add a food, rendered inside this sheet's Modal
 * so it presents from it (the sibling Modal rule). Everything stages here until
 * Save, so this is a `pageSheet` with a `handleCancel` wired to both
 * `onRequestClose` and Cancel.
 */
export function NewSavedMealSheet({ visible, slot, at, onSave, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const [name, setName] = useState('');
  const [items, setItems] = useState<SavedMealItem[]>([]);
  const [picking, setPicking] = useState(false);
  const wasVisible = useRef(false);

  // Starts empty each time it opens.
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setName('');
      setItems([]);
      setPicking(false);
    }
    wasVisible.current = visible;
  }, [visible]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && items.length > 0;
  const calories = savedMealCalories(items);

  const handleSave = () => {
    if (!canSave) return;
    if (onSave(trimmed, items)) haptics.success();
    else haptics.error();
  };

  const handleCancel = () => {
    if (!trimmed && items.length === 0) { onClose(); return; }
    confirmDiscard(onClose);
  };

  return (
    <SheetModal
      name="New saved meal"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <SheetHeader
          title="New saved meal"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label="Save" onPress={handleSave} disabled={!canSave} minWidth={64} />}
        />

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <Text style={styles.fieldLabel}>NAME</Text>
          <TextField
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Meal name"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            accessibilityLabel="Meal name"
          />

          <Text style={[styles.fieldLabel, styles.foodsLabel]}>FOODS</Text>
          {items.length === 0 ? (
            <Text style={styles.empty}>Add the foods that make up this meal. Nothing is logged until the meal is used.</Text>
          ) : (
            <View style={styles.card}>
              {items.map((item, i) => (
                <View key={`${i}-${item.label}`}>
                  {i > 0 && <View style={styles.sep} />}
                  <View style={styles.row}>
                    <View style={styles.rowBody}>
                      <Text style={styles.foodName}>{item.label}</Text>
                      <Text style={styles.meta}>{item.quantity}</Text>
                    </View>
                    <TouchableOpacity
                      hitSlop={8}
                      onPress={() => { haptics.tap(); setItems(prev => prev.filter((_, n) => n !== i)); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.label}`}
                    >
                      <Ionicons name="close-circle" size={iconSize.sm} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={styles.addRow}>
            <InlineAction
              label="Add a food"
              icon="add"
              onPress={() => { haptics.tap(); setPicking(true); }}
            />
          </View>

          {items.length > 0 && (
            <View style={styles.summary}>
              <Ionicons name="flame-outline" size={iconSize.sm} color={colors.textSecondary} />
              <Text style={styles.summaryText}>
                {items.length} {items.length === 1 ? 'food' : 'foods'}
                {calories !== null ? ` · ${calories} cal` : ''}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Inside this sheet's Modal, not beside it: see the note on `overlays` in FoodLogEntrySheet. */}
        <LazySheet open={picking}>
          <FoodLogEntrySheet
            visible={picking}
            slot={slot}
            at={at}
            onPickFood={item => { setItems(prev => [...prev, item]); setPicking(false); }}
            onClose={() => setPicking(false)}
          />
        </LazySheet>
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    fieldLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginBottom: spacing.xs,
    },
    foodsLabel: { marginTop: spacing.md },
    input: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
    },
    empty: { color: colors.textSecondary, fontSize: font.sm },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
    rowBody: { flex: 1 },
    foodName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    meta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs },
    addRow: { flexDirection: 'row', marginTop: spacing.smd, marginBottom: spacing.md },
    summary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xsm,
      paddingTop: spacing.smd,
      borderTopWidth: border.hairline,
      borderTopColor: colors.separator,
    },
    summaryText: { color: colors.textSecondary, fontSize: font.sm },
  });
}
