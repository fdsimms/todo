import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
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
import { ReorderableList } from './ReorderableList';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyState } from './EmptyState';
import { OTHER_AISLE } from '../utils/groceryAisles';
import { itemCountsByShop } from '../utils/groceryShops';
import { haptics } from '../utils/haptics';
import { SHOP_NAME_MAX_LENGTH, type Shop } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Tab = 'aisles' | 'stores';

/**
 * Where things are: the order you walk an aisle in, and the stores you walk.
 *
 * The two tabs share a sheet because they're the same kind of setting and the
 * grocery header has no room for a fifth 34pt action. The split of labour with
 * Buy again is deliberate — **this sheet manages stores, Buy again browses
 * them.** Putting the "what does Costco carry" list here too would bury the
 * everyday read two taps inside a settings sheet, when the place you want it
 * is the screen where you're picking what to buy.
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
  const shops = useGroceryStore(useShallow(s => s.shops));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const addShop = useGroceryStore(s => s.addShop);
  const renameShop = useGroceryStore(s => s.renameShop);
  const reorderShops = useGroceryStore(s => s.reorderShops);
  const deleteShop = useGroceryStore(s => s.deleteShop);

  const [tab, setTab] = useState<Tab>('aisles');
  const [newAisle, setNewAisle] = useState('');
  const [newShop, setNewShop] = useState('');
  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    if (visible) {
      setTab('aisles');
      setNewAisle('');
      setNewShop('');
      setEditingShopId(null);
    }
  }, [visible]);

  const shopCounts = useMemo(() => itemCountsByShop(items, itemShops), [items, itemShops]);

  const handleAddShop = () => {
    const trimmed = newShop.trim();
    if (!trimmed) return;
    if (!addShop(trimmed)) {
      haptics.error();
      return;
    }
    haptics.success();
    setNewShop('');
  };

  const commitRename = () => {
    if (!editingShopId) return;
    const trimmed = editingName.trim();
    // A no-op or a collision just closes the field rather than trapping the
    // user in it — the old name is still there and still correct.
    if (trimmed) renameShop(editingShopId, trimmed);
    setEditingShopId(null);
  };

  const confirmDeleteShop = (id: string, name: string) => {
    const count = shopCounts.get(id) ?? 0;
    Alert.alert(
      `Delete ${name}?`,
      count > 0
        ? `${count} ${count === 1 ? 'item is' : 'items are'} recorded as coming from here. Deleting the store forgets that — the items themselves stay. This can’t be undone.`
        : 'Nothing is recorded against this store yet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteShop(id);
            haptics.warning();
          },
        },
      ]
    );
  };

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
          <Text style={styles.headerTitle}>Aisles &amp; stores</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

        <View style={styles.segments}>
          {(['aisles', 'stores'] as const).map(t => {
            const active = t === tab;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.segment, active && styles.segmentActive]}
                activeOpacity={interaction.activeOpacity}
                onPress={() => {
                  haptics.tap();
                  setTab(t);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t === 'aisles' ? 'Aisles' : 'Stores'}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {t === 'aisles' ? 'Aisles' : 'Stores'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'stores' ? (
          <StoresTab
            styles={styles}
            colors={colors}
            shops={shops}
            shopCounts={shopCounts}
            newShop={newShop}
            setNewShop={setNewShop}
            onAdd={handleAddShop}
            editingShopId={editingShopId}
            editingName={editingName}
            setEditingName={setEditingName}
            onStartRename={(id, name) => {
              setEditingShopId(id);
              setEditingName(name);
            }}
            onCommitRename={commitRename}
            onReorder={reorderShops}
            onDelete={confirmDeleteShop}
          />
        ) : (
        <>
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
                {/* Not the ellipsis: that means "open this row's editor"
                    app-wide, and Other has nothing to open. */}
                <Ionicons name="arrow-down-outline" size={iconSize.md} color={colors.textTertiary} />
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
        </>
        )}
      </View>
    </Modal>
  );
}

interface StoresTabProps {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  shops: Shop[];
  shopCounts: Map<string, number>;
  newShop: string;
  setNewShop: (s: string) => void;
  onAdd: () => void;
  editingShopId: string | null;
  editingName: string;
  setEditingName: (s: string) => void;
  onStartRename: (id: string, name: string) => void;
  onCommitRename: () => void;
  onReorder: (ids: string[]) => void;
  onDelete: (id: string, name: string) => void;
}

/**
 * Managing the places you shop. Reordering exists for the same reason the aisle
 * list has it — the order here is the order the store pills come up in when
 * you finish a trip, and the shop you go to weekly should be the first tap.
 *
 * The count is *items recorded here*, not items on the list: a store is a fact
 * about your catalog, not about this week.
 */
function StoresTab({
  styles,
  colors,
  shops,
  shopCounts,
  newShop,
  setNewShop,
  onAdd,
  editingShopId,
  editingName,
  setEditingName,
  onStartRename,
  onCommitRename,
  onReorder,
  onDelete,
}: StoresTabProps) {
  return (
    <>
      <Text style={styles.intro}>
        The places you shop. Naming one when you finish a trip is what records which store has
        which items — you can then filter Buy again by store.
      </Text>

      <ReorderableList
        data={shops}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        placeholderStyle={styles.dropSlot}
        onHoverChange={haptics.dragTick}
        onReorder={reordered => onReorder(reordered.map(s => s.id))}
        renderItem={({ item: shop, drag, isActive }) => {
          const count = shopCounts.get(shop.id) ?? 0;
          const editing = shop.id === editingShopId;
          return (
            <View style={[styles.row, isActive && styles.rowActive]}>
              <TouchableOpacity
                onLongPress={drag}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Reorder ${shop.name}`}
              >
                <Ionicons name="reorder-three-outline" size={iconSize.md} color={colors.textTertiary} />
              </TouchableOpacity>

              {editing ? (
                <TextInput
                  style={styles.renameInput}
                  value={editingName}
                  onChangeText={setEditingName}
                  onBlur={onCommitRename}
                  onSubmitEditing={onCommitRename}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="done"
                  maxLength={SHOP_NAME_MAX_LENGTH}
                  accessibilityLabel={`Rename ${shop.name}`}
                />
              ) : (
                <TouchableOpacity
                  style={styles.rowLabelWrap}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => onStartRename(shop.id, shop.name)}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${shop.name}`}
                >
                  <Text style={styles.rowLabel} numberOfLines={1}>{shop.name}</Text>
                </TouchableOpacity>
              )}

              {count > 0 && !editing && <Text style={styles.rowCount}>{count}</Text>}

              <TouchableOpacity
                onPress={() => onDelete(shop.id, shop.name)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${shop.name}`}
              >
                <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="storefront-outline"
            title="No stores yet"
            subtitle="Add the shops you go to. When you finish a trip you can say which one you were at."
          />
        }
        ListFooterComponent={
          <View style={styles.addWrap}>
            <TextInput
              style={styles.addInput}
              value={newShop}
              onChangeText={setNewShop}
              placeholder="Add a store"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={onAdd}
              blurOnSubmit={false}
              autoCorrect={false}
              maxLength={SHOP_NAME_MAX_LENGTH}
              accessibilityLabel="New store name"
            />
            <InlineAction
              label="Add"
              icon="add"
              variant="neutral"
              onPress={onAdd}
              disabled={!newShop.trim()}
            />
          </View>
        }
      />
    </>
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
    rowLabelWrap: { flex: 1 },
    rowLabel: { flex: 1, fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    renameInput: {
      flex: 1,
      fontSize: font.md,
      fontWeight: fontWeight.medium,
      color: colors.text,
      padding: 0,
      // A height rather than a lineHeight, so the row doesn't resize between
      // display and edit mode — RN maps lineHeight onto the iOS paragraph
      // style with no baseline compensation and the glyphs sit low.
      height: 22,
    },
    segments: {
      flexDirection: 'row',
      gap: spacing.xs,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: 3,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
    },
    segment: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
    },
    segmentActive: { backgroundColor: colors.accent },
    segmentText: { fontSize: font.sm, color: colors.textSecondary },
    segmentTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
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
