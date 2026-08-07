import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  border,
  iconSize,
  interaction,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { SheetHeaderButton } from './SheetHeaderButton';
import { haptics } from '../utils/haptics';
import { GROCERY_NAME_MAX_LENGTH, GROCERY_QUANTITY_MAX_LENGTH } from '../types';

interface Props {
  visible: boolean;
  itemId: string | null;
  onClose: () => void;
}

/**
 * Everything about one item that isn't "do I need it". Reached by long-press,
 * which is also where the single destructive action lives — there is no undo
 * anywhere in groceries, so deleting a catalog row is behind a confirm rather
 * than on a swipe.
 */
export function GroceryItemSheet({ visible, itemId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const item = useGroceryStore(s => (itemId ? s.items.find(i => i.id === itemId) ?? null : null));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const renameItem = useGroceryStore(s => s.renameItem);
  const setQuantity = useGroceryStore(s => s.setQuantity);
  const setNote = useGroceryStore(s => s.setNote);
  const setAisle = useGroceryStore(s => s.setAisle);
  const toggleFavorite = useGroceryStore(s => s.toggleFavorite);
  const removeFromList = useGroceryStore(s => s.removeFromList);
  const deleteItem = useGroceryStore(s => s.deleteItem);

  const [name, setName] = useState('');
  const [quantity, setQuantityText] = useState('');
  const [note, setNoteText] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && item) {
      setName(item.name);
      setQuantityText(item.quantity ?? '');
      setNoteText(item.note);
      setNameError(null);
    }
  }, [visible, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) {
    return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} />;
  }

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== item.name) {
      // renameItem refuses a collision rather than merging two catalog rows —
      // merging means choosing whose purchase history survives.
      if (!renameItem(item.id, trimmed)) {
        setNameError('Another item already has that name.');
        haptics.error();
        return;
      }
    }
    setQuantity(item.id, quantity);
    setNote(item.id, note);
    haptics.success();
    onClose();
  };

  const confirmDelete = () => {
    Alert.alert(
      `Forget ${item.name}?`,
      'This removes it from your catalog along with its history, and can’t be undone. To just take it off this week’s list, use "Remove from list".',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            deleteItem(item.id);
            haptics.warning();
            onClose();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>Item</Text>
          <SheetHeaderButton label="Save" onPress={handleSave} minWidth={64} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>NAME</Text>
          <TextInput
            style={[styles.input, !!nameError && styles.inputError]}
            value={name}
            onChangeText={t => {
              setName(t);
              if (nameError) setNameError(null);
            }}
            placeholder="Item name"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_NAME_MAX_LENGTH}
            accessibilityLabel="Item name"
          />
          {!!nameError && <Text style={styles.error}>{nameError}</Text>}

          <Text style={styles.label}>QUANTITY</Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantityText}
            placeholder="2 lb, x3, a bunch…"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_QUANTITY_MAX_LENGTH}
            accessibilityLabel="Quantity"
          />

          <Text style={styles.label}>NOTE</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNoteText}
            placeholder="The blue cap one"
            placeholderTextColor={colors.textTertiary}
            maxLength={GROCERY_NAME_MAX_LENGTH}
            accessibilityLabel="Note"
          />

          <Text style={styles.label}>AISLE</Text>
          <View style={styles.pills}>
            {aisleOrder.map(aisle => {
              const active = aisle === item.aisle;
              return (
                <TouchableOpacity
                  key={aisle}
                  style={[styles.pill, active && styles.pillActive]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => {
                    haptics.tap();
                    setAisle(item.id, aisle);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={aisle}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{aisle}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={() => {
              haptics.tap();
              toggleFavorite(item.id);
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: item.favorite }}
            accessibilityLabel="Star this item"
          >
            <Ionicons
              name={item.favorite ? 'star' : 'star-outline'}
              size={iconSize.md}
              color={item.favorite ? colors.warning : colors.textSecondary}
            />
            <View style={styles.actionBody}>
              <Text style={styles.actionLabel}>Starred</Text>
              <Text style={styles.actionHint}>Floats to the top of Buy again.</Text>
            </View>
          </TouchableOpacity>

          {item.onList && (
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => {
                removeFromList(item.id);
                haptics.tap();
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Remove from list"
            >
              <Ionicons name="remove-circle-outline" size={iconSize.md} color={colors.textSecondary} />
              <View style={styles.actionBody}>
                <Text style={styles.actionLabel}>Remove from list</Text>
                <Text style={styles.actionHint}>Keeps it in your catalog for next time.</Text>
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={confirmDelete}
            accessibilityRole="button"
            accessibilityLabel="Forget this item"
          >
            <Ionicons name="trash-outline" size={iconSize.md} color={colors.red} />
            <View style={styles.actionBody}>
              <Text style={[styles.actionLabel, { color: colors.red }]}>Forget this item</Text>
              <Text style={styles.actionHint}>
                Deletes it and its history. There&apos;s no undo.
              </Text>
            </View>
          </TouchableOpacity>

          {item.purchaseCount > 0 && (
            <Text style={styles.footnote}>
              Bought {item.purchaseCount} {item.purchaseCount === 1 ? 'time' : 'times'}.
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    label: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textTertiary,
      letterSpacing: 0.8,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    input: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      borderWidth: border.sm,
      borderColor: 'transparent',
      paddingHorizontal: spacing.md,
      fontSize: font.md,
      color: colors.text,
      // No lineHeight on a TextInput — RN maps it onto the iOS paragraph style
      // with no baseline compensation, so the glyphs sit low in the box.
      height: 44,
    },
    inputError: { borderColor: colors.red },
    error: { fontSize: font.sm, color: colors.red, marginTop: spacing.xs },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    pill: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pillActive: { backgroundColor: colors.accent },
    pillText: { fontSize: font.sm, color: colors.textSecondary },
    pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
    },
    actionBody: { flex: 1 },
    actionLabel: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    actionHint: { fontSize: font.sm, color: colors.textTertiary, marginTop: 2 },
    footnote: {
      fontSize: font.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: spacing.lg,
    },
  });
}
