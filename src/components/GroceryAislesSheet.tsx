import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
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
import { ReorderableList } from './ReorderableList';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { OTHER_AISLE } from '../utils/groceryAisles';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The order you walk the store in.
 *
 * Uses ReorderableList rather than SortableList on purpose: this sheet owns
 * its own scroll view, so it's immune to the "a JS responder must be an
 * ancestor of the scroll view for it to stand down" trap that a nested list
 * inside the grocery screen would hit.
 *
 * 'Other' is pinned last and can't be dragged — it's the catch-all every
 * unrecognised item falls into, and a catch-all in the middle of a walk order
 * is never what anyone meant.
 */
export function GroceryAislesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const setAisleOrder = useGroceryStore(s => s.setAisleOrder);
  const items = useGroceryStore(useShallow(s => s.items));

  const [newAisle, setNewAisle] = useState('');

  useEffect(() => {
    if (visible) setNewAisle('');
  }, [visible]);

  // 'Other' rides along at the bottom outside the draggable set, so a drag can
  // never land something below it.
  const draggable = useMemo(() => aisleOrder.filter(a => a !== OTHER_AISLE), [aisleOrder]);

  const countFor = (aisle: string) => items.filter(i => i.aisle === aisle && i.onList).length;

  const handleAdd = () => {
    const trimmed = newAisle.trim();
    if (!trimmed) return;
    if (aisleOrder.some(a => a.toLowerCase() === trimmed.toLowerCase())) {
      setNewAisle('');
      return;
    }
    setAisleOrder([...draggable, trimmed]);
    haptics.success();
    setNewAisle('');
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Aisles</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

        <Text style={styles.intro}>
          Drag these into the order you walk your store. Your list follows the same order.
        </Text>

        <ReorderableList
          data={draggable}
          keyExtractor={a => a}
          contentContainerStyle={styles.list}
          placeholderStyle={styles.dropSlot}
          // dragTick, not tap: a fast drag crosses several rows between frames
          // and unthrottled ticks run together into one long buzz. The lift
          // itself is fired by ReorderableList.
          onHoverChange={haptics.dragTick}
          onReorder={reordered => setAisleOrder(reordered)}
          renderItem={({ item: aisle, drag, isActive }) => {
            const count = countFor(aisle);
            return (
              <View style={[styles.row, isActive && styles.rowActive]}>
                <TouchableOpacity
                  onLongPress={drag}
                  delayLongPress={interaction.delayLongPress}
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Reorder ${aisle}`}
                >
                  <Ionicons name="reorder-three-outline" size={iconSize.md} color={colors.textTertiary} />
                </TouchableOpacity>
                <Text style={styles.rowLabel} numberOfLines={1}>{aisle}</Text>
                {count > 0 && <Text style={styles.rowCount}>{count}</Text>}
              </View>
            );
          }}
          ListFooterComponent={
            <View style={styles.footer}>
              <View style={[styles.row, styles.rowPinned]}>
                <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={colors.textTertiary} />
                <Text style={styles.rowLabel}>{OTHER_AISLE}</Text>
                <Text style={styles.rowPinnedNote}>always last</Text>
              </View>

              <View style={styles.addWrap}>
                <TextInput
                  style={styles.addInput}
                  value={newAisle}
                  onChangeText={setNewAisle}
                  placeholder="Add an aisle"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={handleAdd}
                  blurOnSubmit={false}
                  autoCorrect={false}
                  maxLength={32}
                  accessibilityLabel="New aisle name"
                />
                <InlineAction
                  label="Add"
                  icon="add"
                  variant="neutral"
                  onPress={handleAdd}
                  disabled={!newAisle.trim()}
                />
              </View>
            </View>
          }
        />
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
    headerSpacer: { width: 64 },
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    intro: {
      color: colors.textTertiary,
      fontSize: font.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    list: { paddingTop: spacing.md, paddingBottom: spacing.xl },
    dropSlot: {
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      backgroundColor: colors.bgTertiary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      paddingVertical: 14,
      paddingHorizontal: spacing.md,
    },
    rowActive: { backgroundColor: colors.bgTertiary },
    rowPinned: { opacity: 0.6 },
    rowLabel: { flex: 1, fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    rowCount: { fontSize: font.sm, color: colors.textTertiary },
    rowPinnedNote: { fontSize: font.xs, color: colors.textTertiary },
    footer: { marginTop: spacing.md },
    addWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.lg,
    },
    addInput: {
      flex: 1,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: font.md,
      color: colors.text,
      height: 44,
    },
  });
}
