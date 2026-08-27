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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { itemsOnList } from '../utils/groceryLists';
import { useGroceryStore } from '../store/useGroceryStore';
import { ReorderableList } from './ReorderableList';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { EmptyState } from './EmptyState';
import { OTHER_AISLE } from '../utils/groceryAisles';
import { itemCountsByShop } from '../utils/groceryShops';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { AISLE_NAME_MAX_LENGTH, SHOP_NAME_MAX_LENGTH, type Shop } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Tab = 'aisles' | 'stores' | 'groupBy';

const TAB_OPTIONS: SegmentOption<Tab>[] = [
  { value: 'aisles', label: 'Aisles' },
  { value: 'stores', label: 'Stores' },
  { value: 'groupBy', label: 'Group by' },
];

/**
 * Where things are, and how the list itself is organized: the order you walk
 * an aisle in, the stores you walk, and — #1717 — aisle vs. recipe grouping.
 *
 * The tabs share a sheet because they're the same kind of setting and the
 * grocery header has no room for another 34pt action (this one used to be
 * two tabs for exactly that reason; a third only extends the argument). The
 * split of labour with the catalog is deliberate — **this sheet manages
 * stores, the catalog browses them.** Putting the "what does Costco carry"
 * list here too would bury the everyday read two taps inside a settings
 * sheet, when the place you want it is the screen where you're picking what
 * to buy.
 *
 * Uses ReorderableList rather than SortableList on purpose: this sheet owns
 * its own scroll view, so it's immune to the "a JS responder must be an
 * ancestor of the scroll view for it to stand down" trap that a nested list
 * inside the grocery screen would hit.
 *
 * **The whole row is the drag target, not the grip.** Both lists here are
 * screen-style card rows, so they follow the rule every other `ReorderableList`
 * row does (Categories, Templates, `TaskItem`, `GroceryRow`): long-press
 * anywhere on the row. Binding `drag` to the grip glyph alone — the pattern the
 * nested `SortableList` editors use, where a row already spends its own press
 * on something else — left ~36pt of the row live and the rest claiming no JS
 * responder at all, so a long-press on the aisle's name went to the scroll view
 * and the drag simply never started. The grip stays as the affordance that says
 * the row moves; it just isn't a button any more.
 *
 * 'Other' is pinned last and can't be dragged — it's the catch-all every
 * unrecognised item falls into, and a catch-all in the middle of a walk order
 * is never what anyone meant.
 */
export function GroceryAislesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const setAisleOrder = useGroceryStore(s => s.setAisleOrder);
  const addAisle = useGroceryStore(s => s.addAisle);
  const renameAisle = useGroceryStore(s => s.renameAisle);
  const deleteAisle = useGroceryStore(s => s.deleteAisle);
  const items = useGroceryStore(useShallow(s => s.items));
  const listEntries = useGroceryStore(useShallow(s => s.listEntries));
  const activeListId = useGroceryStore(s => s.activeListId);
  const shops = useGroceryStore(useShallow(s => s.shops));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const addShop = useGroceryStore(s => s.addShop);
  const renameShop = useGroceryStore(s => s.renameShop);
  const reorderShops = useGroceryStore(s => s.reorderShops);
  const deleteShop = useGroceryStore(s => s.deleteShop);
  const setShopExcludedFromSuggestions = useGroceryStore(s => s.setShopExcludedFromSuggestions);
  const groceryGroupBy = useGroceryStore(s => s.groceryGroupBy);
  const setGroceryGroupBy = useGroceryStore(s => s.setGroceryGroupBy);

  const [tab, setTab] = useState<Tab>('aisles');
  const [newAisle, setNewAisle] = useState('');
  const [newShop, setNewShop] = useState('');
  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  // The aisle being renamed is identified by its name — an aisle *is* its name
  // here, which is exactly why renaming one has to rewrite every row filed
  // under it. Only one tab renders at a time, so the two share the draft text.
  const [editingAisle, setEditingAisle] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    if (visible) {
      setTab('aisles');
      setNewAisle('');
      setNewShop('');
      setEditingShopId(null);
      setEditingAisle(null);
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
    confirmDelete({
      title: `Delete ${name}?`,
      message: count > 0
        ? `${count} ${count === 1 ? 'item is' : 'items are'} recorded as coming from here. Deleting the store forgets that. The items themselves stay. This can’t be undone.`
        : 'Nothing is recorded against this store yet.',
      onConfirm: () => {
        deleteShop(id);
        haptics.warning();
      },
    });
  };

  // 'Other' rides along at the bottom outside the draggable set, so a drag can
  // never land something below it.
  const draggable = useMemo(() => aisleOrder.filter(a => a !== OTHER_AISLE), [aisleOrder]);

  // On the active list, like every other count the Groceries tab shows.
  const listRows = useMemo(
    () => itemsOnList(items, listEntries, activeListId),
    [items, listEntries, activeListId]
  );
  const countFor = (aisle: string) => listRows.filter(i => i.aisle === aisle).length;

  const commitAisleRename = () => {
    if (!editingAisle) return;
    const trimmed = editingName.trim();
    // A blank, a no-op or a collision just closes the field rather than
    // trapping the user in it — the old name is still there and still works.
    if (trimmed) renameAisle(editingAisle, trimmed);
    setEditingAisle(null);
  };

  const confirmDeleteAisle = (aisle: string) => {
    // Everything filed here, not just what's on the list this week — the aisle
    // lives on the catalog row, so an off-list item moves too.
    const filed = items.filter(i => i.aisle === aisle).length;
    confirmDelete({
      title: `Delete ${aisle}?`,
      message: filed > 0
        ? `${filed} ${filed === 1 ? 'item moves' : 'items move'} to ${OTHER_AISLE}. You can file them somewhere else afterwards.`
        : `Nothing is filed here. You can add it back at any time.`,
      onConfirm: () => {
        deleteAisle(aisle);
        haptics.warning();
      },
    });
  };

  const handleAdd = () => {
    // addAisle owns the dedupe (and the write), so a name that's already in the
    // order just clears the field — the aisle the user asked for is there, and
    // there's nothing to celebrate. `aisleOrder` is the pre-call snapshot.
    const created = addAisle(newAisle);
    if (!created) return;
    if (!aisleOrder.includes(created)) haptics.success();
    setNewAisle('');
  };

  // Both renames commit on blur, but tapping Done can beat that blur — flush
  // whichever one is mid-edit instead of dropping it, same fix as
  // GroceryItemSheet's Done button.
  const handleDone = () => {
    commitRename();
    commitAisleRename();
    onClose();
  };

  // fullScreen, not a page sheet: the sheet's own pull-down pan cancels the JS
  // touches this list's drag runs on. See EditorSheet's note (#1182).
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={handleDone}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>List settings</Text>
          <SheetHeaderButton label="Done" onPress={handleDone} minWidth={64} />
        </View>

        {/* `surface="page"` because this sheet's root is `colors.bg`, the same
            reason the Group by control below is wrapped in a card. */}
        <View style={styles.segments}>
          <SegmentedControl
            label="List settings section"
            value={tab}
            onChange={t => {
              // Every tab shares the draft text, and the field that owns it
              // unmounts with the tab — so its onBlur never fires.
              setEditingAisle(null);
              setEditingShopId(null);
              setTab(t);
            }}
            options={TAB_OPTIONS}
            surface="page"
          />
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
            onToggleExcluded={(id, excluded) => {
              haptics.tap();
              setShopExcludedFromSuggestions(id, excluded);
            }}
          />
        ) : tab === 'groupBy' ? (
          <GroupByTab
            styles={styles}
            groupBy={groceryGroupBy}
            onChange={setGroceryGroupBy}
          />
        ) : (
        <>
        <Text style={styles.intro}>
          Hold a row and drag it into the order you walk your store. Your list follows the same
          order. Tap a name to rename it.
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
            const editing = aisle === editingAisle;
            return (
              <TouchableOpacity
                style={[styles.row, isActive && styles.rowActive]}
                // Same shape as a store row: the row itself is the drag target
                // and the rename tap both, and only the delete button claims a
                // corner of its own. Wrapping the *label* in a touchable
                // instead would put the dead zone back — a long press starting
                // on the name would go to a child with no onLongPress, and the
                // drag would never start across most of the row's width.
                onPress={editing ? undefined : () => {
                  setEditingAisle(aisle);
                  setEditingName(aisle);
                }}
                onLongPress={drag}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={count > 0 ? `${aisle}, ${count} on the list` : aisle}
                accessibilityHint="Double tap to rename. Long press to reorder."
              >
                <Ionicons name="reorder-three-outline" size={iconSize.md} color={colors.textTertiary} />

                {editing ? (
                  <TextInput
                    style={styles.renameInput}
                    value={editingName}
                    onChangeText={setEditingName}
                    onBlur={commitAisleRename}
                    onSubmitEditing={commitAisleRename}
                    autoFocus
                    returnKeyType="done"
                    maxLength={AISLE_NAME_MAX_LENGTH}
                    accessibilityLabel={`Rename ${aisle}`}
                  />
                ) : (
                  <Text style={styles.rowLabel} numberOfLines={1}>{aisle}</Text>
                )}

                {count > 0 && !editing && <Text style={styles.rowCount}>{count}</Text>}

                <TouchableOpacity
                  onPress={() => confirmDeleteAisle(aisle)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${aisle}`}
                >
                  <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
                </TouchableOpacity>
              </TouchableOpacity>
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
                  maxLength={AISLE_NAME_MAX_LENGTH}
                  accessibilityLabel="New aisle name"
                />
                <InlineAction
                  label="Add"
                  icon="add"
                  variant="neutral"
                  onPress={handleAdd}
                  disabled={!newAisle.trim()}
                  style={styles.addButton}
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
  onToggleExcluded: (id: string, excluded: boolean) => void;
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
  onToggleExcluded,
}: StoresTabProps) {
  return (
    <>
      <Text style={styles.intro}>
        The places you shop. Naming one when you finish a trip is what records which store has
        which items, so you can filter the catalog by store.
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
            <TouchableOpacity
              style={[styles.row, isActive && styles.rowActive]}
              // The row is the drag target and the rename tap both, the way a
              // category row on its screen is; the delete button is a nested
              // touchable and claims its own corner.
              onPress={editing ? undefined : () => onStartRename(shop.id, shop.name)}
              onLongPress={drag}
              delayLongPress={interaction.delayLongPress}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={count > 0 ? `${shop.name}, ${count} items` : shop.name}
              accessibilityHint="Double tap to rename. Long press to reorder."
            >
              <Ionicons name="reorder-three-outline" size={iconSize.md} color={colors.textTertiary} />

              {editing ? (
                <TextInput
                  style={styles.renameInput}
                  value={editingName}
                  onChangeText={setEditingName}
                  onBlur={onCommitRename}
                  onSubmitEditing={onCommitRename}
                  autoFocus
                  returnKeyType="done"
                  maxLength={SHOP_NAME_MAX_LENGTH}
                  accessibilityLabel={`Rename ${shop.name}`}
                />
              ) : (
                <Text style={styles.rowLabel} numberOfLines={1}>{shop.name}</Text>
              )}

              {count > 0 && !editing && <Text style={styles.rowCount}>{count}</Text>}

              {!editing && (
                <TouchableOpacity
                  onPress={() => onToggleExcluded(shop.id, !shop.excludeFromSuggestions)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: shop.excludeFromSuggestions }}
                  accessibilityLabel={`Don't suggest ${shop.name}`}
                  accessibilityHint="Keeps this store out of suggestions, but it stays available to pick by hand"
                >
                  <Ionicons
                    name={shop.excludeFromSuggestions ? 'eye-off' : 'eye-off-outline'}
                    size={iconSize.md}
                    color={shop.excludeFromSuggestions ? colors.accent : colors.textTertiary}
                  />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() => onDelete(shop.id, shop.name)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${shop.name}`}
              >
                <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="storefront-outline"
            title="No stores yet"
            subtitle="Add the stores you go to. When you finish a trip you can say which one you were at."
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
              maxLength={SHOP_NAME_MAX_LENGTH}
              accessibilityLabel="New store name"
            />
            <InlineAction
              label="Add"
              icon="add"
              variant="neutral"
              onPress={onAdd}
              disabled={!newShop.trim()}
              style={styles.addButton}
            />
          </View>
        }
      />
    </>
  );
}

interface GroupByTabProps {
  styles: ReturnType<typeof makeStyles>;
  groupBy: 'aisle' | 'recipe';
  onChange: (groupBy: 'aisle' | 'recipe') => void;
}

/**
 * Aisle vs. recipe grouping (#1717) — a closed two-way choice, so
 * SegmentedControl rather than another draggable list. Wrapped in a card:
 * the control's own track is bgTertiary, which is close to invisible sitting
 * directly on this sheet's bg (see SegmentedControl's doc comment).
 */
function GroupByTab({ styles, groupBy, onChange }: GroupByTabProps) {
  return (
    <>
      <Text style={styles.intro}>
        How the shopping list sorts what's still to buy.
      </Text>
      <View style={styles.groupByCard}>
        <SegmentedControl
          label="Group by"
          value={groupBy}
          onChange={onChange}
          options={[
            { value: 'aisle', label: 'Aisle' },
            { value: 'recipe', label: 'Recipe' },
          ]}
        />
        <Text style={styles.groupByHint}>
          {groupBy === 'recipe'
            ? 'Items are grouped by the recipe they were added from. Anything typed by hand, or added from more than one recipe at once, is under "No recipe."'
            : 'Items are grouped by aisle, in the walk order set on the Aisles tab.'}
        </Text>
      </View>
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
    rowLabel:{ flex: 1, fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
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
    // SegmentedControl brings its own track — this only positions it.
    segments: {
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
    },
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
    // Both "Add" buttons sit directly on the sheet's root colors.bg, where
    // the default neutral tint (bgTertiary) is nearly indistinguishable
    // from it.
    addButton: { backgroundColor: colors.bgSecondary },
    // A card, for the same reason addButton needs one: SegmentedControl's
    // track is bgTertiary, and this sheet's root sits on bg.
    groupByCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.lg,
      gap: spacing.sm,
    },
    groupByHint: { fontSize: font.sm, color: colors.textTertiary },
  });
}
