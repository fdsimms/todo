import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Keyboard,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SheetModal } from './SheetModal';
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
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { PillGroup } from './PillGroup';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { EmptyState } from './EmptyState';
import { OTHER_AISLE, isNonFoodAisle } from '../utils/groceryAisles';
import {
  describeOwnAisleOrders,
  describeShopAisles,
  describeShopDelete,
  itemCountsByShop,
  NO_STORE_LABEL,
  shopWalkOrder,
} from '../utils/groceryShops';
import { resolveActiveTrip } from '../utils/activeTrip';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { AISLE_NAME_MAX_LENGTH, SHOP_NAME_MAX_LENGTH, type GroceryGroupBy, type Shop } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Tab = 'aisles' | 'stores' | 'groupBy';

/**
 * The two states `Shop.aisles` has. Named for what the store does rather than
 * for the field: "Only some aisles" is the answer to "what does this shop
 * sell", where "Scoped" would be the answer to a question about the data.
 */
const RANGE_OPTIONS: SegmentOption<'all' | 'some'>[] = [
  { value: 'all', label: 'Everything' },
  { value: 'some', label: 'Only some aisles' },
];

const TAB_OPTIONS: SegmentOption<Tab>[] = [
  { value: 'aisles', label: 'Aisles' },
  { value: 'stores', label: 'Stores' },
  { value: 'groupBy', label: 'Group by' },
];

// Map of this file (one component holding most of it, and its three tabs;
// `grep -n '// ===='` is the table of contents of the main one):
//   bindings       theme, and every store value and action the tabs use
//   state          the tab, the add and rename drafts, the open store range,
//                  and the focus each tab takes when it opens
//   stores         adding, renaming and deleting a store
//   trip           the store being arranged during a trip (#2938): its walk,
//                  the reorder that writes it, and "Use the usual order"
//   aisles         the counts, renaming, deleting and adding an aisle
//   render         Done, then the sheet: the tab control, StoresTab or
//                  GroupByTab, or the Aisles tab inline (the trip card, the
//                  intro and the draggable walk with Other pinned under it)
// Below the component: StoresTab, GroupByTab, then styles.

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
 *
 * **During a trip the Aisles tab arranges that store's walk, not the usual
 * one** (#2938, `Shop.aisleOrder`). Standing in the store is the one moment
 * anybody knows its layout, and it is the order the list is following right
 * then, so it is the order a drag here should change. A card above the rows
 * says so, and carries the way back ("Use the usual order") once the store
 * has an order of its own. Rename, delete and the non-food flag stay about
 * the aisle itself and apply at every store, which the tab also says. With no
 * trip running the tab arranges the usual order, and names any store that
 * keeps its own so a reorder that "didn't take" there isn't a mystery.
 */
export function GroceryAislesSheet({ visible, onClose }: Props) {
  // ==== bindings ====
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const setAisleOrder = useGroceryStore(s => s.setAisleOrder);
  const addAisle = useGroceryStore(s => s.addAisle);
  const renameAisle = useGroceryStore(s => s.renameAisle);
  const deleteAisle = useGroceryStore(s => s.deleteAisle);
  const nonFoodAisles = useGroceryStore(useShallow(s => s.nonFoodAisles));
  const setAisleNonFood = useGroceryStore(s => s.setAisleNonFood);
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
  const setShopAisles = useGroceryStore(s => s.setShopAisles);
  const setShopAisleOrder = useGroceryStore(s => s.setShopAisleOrder);
  const tripShopId = useGroceryStore(s => s.tripShopId);
  const tripStartedAt = useGroceryStore(s => s.tripStartedAt);
  const groceryGroupBy = useGroceryStore(s => s.groceryGroupBy);
  const setGroceryGroupBy = useGroceryStore(s => s.setGroceryGroupBy);

  // ==== state ====
  const [tab, setTab] = useState<Tab>('aisles');
  const [newAisle, setNewAisle] = useState('');
  const [newShop, setNewShop] = useState('');
  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  // The aisle being renamed is identified by its name — an aisle *is* its name
  // here, which is exactly why renaming one has to rewrite every row filed
  // under it. Only one tab renders at a time, so the two share the draft text.
  const [editingAisle, setEditingAisle] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  // Which store has its aisle range open, and which stores are mid-answer with
  // nothing picked yet. Both are sheet-local: the range itself is committed the
  // moment an aisle is tapped, like everything else here, and what these hold
  // is only where the user is in the form. See StoresTabProps.scopedDrafts.
  const [rangeShopId, setRangeShopId] = useState<string | null>(null);
  const [scopedDrafts, setScopedDrafts] = useState<ReadonlySet<string>>(() => new Set());

  const newAisleInputRef = useRef<TextInput>(null);
  const newShopInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setTab('aisles');
      setNewAisle('');
      setNewShop('');
      setEditingShopId(null);
      setEditingAisle(null);
      setRangeShopId(null);
      // An unfinished answer doesn't survive the sheet closing: reopening to a
      // store showing "Only some aisles" with nothing ticked, and no memory of
      // having said so, is a form that looks broken. The store itself is
      // unchanged either way, which is what makes dropping it safe.
      setScopedDrafts(new Set());
    }
  }, [visible]);

  // Fires on open (tab is forced to 'aisles' above) and on every manual tab
  // switch. Unlike the rename fields above (which remount fresh because
  // they're conditional on `editing`), this sheet stays mounted across opens,
  // so a bare `autoFocus` on the add fields would only ever fire once.
  //
  // The aisles tab focuses its add field only while it has no aisles yet.
  // With a list to reorder, which is what the sheet is usually opened for,
  // the keyboard came up over the bottom half of it and the list scrolled to
  // the field in its footer. Read at the moment of opening rather than kept
  // in the deps, so adding the first aisle doesn't pull focus back.
  const hasAisleRows = aisleOrder.some(a => a !== OTHER_AISLE);
  useEffect(() => {
    if (!visible) return;
    if (tab === 'aisles') {
      if (!hasAisleRows) newAisleInputRef.current?.focus();
    } else if (tab === 'stores') newShopInputRef.current?.focus();
  }, [visible, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==== stores ====
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
    // user in it — the old name is still there and still correct. A collision
    // still needs a haptic, or a real rename attempt looks identical to
    // changing your mind (see GroceryRow's own commitRename).
    if (trimmed && !renameShop(editingShopId, trimmed)) haptics.error();
    setEditingShopId(null);
  };

  const confirmDeleteShop = (id: string, name: string) => {
    // Read at the tap: the aliases and the trip matter to this message only.
    const { storeAliases, tripShopId } = useGroceryStore.getState();
    confirmDelete({
      title: `Delete ${name}?`,
      message: describeShopDelete(id, items, itemShops, storeAliases, tripShopId),
      onConfirm: () => {
        deleteShop(id);
        haptics.warning();
      },
    });
  };

  // ==== trip ====
  // The store you're standing in, if you've said: while there, the Aisles tab
  // arranges its walk rather than the usual one (#2938). Only a trip
  // resolveActiveTrip still honors, and re-read on every open (`visible` in the
  // deps), so a trip that aged out while the sheet was closed isn't arranged.
  const tripShop = useMemo(
    () => (visible ? resolveActiveTrip(tripShopId, tripStartedAt, shops, new Date()) : null),
    [visible, tripShopId, tripStartedAt, shops]
  );
  const ownOrders = useMemo(() => describeOwnAisleOrders(shops), [shops]);

  // 'Other' rides along at the bottom outside the draggable set, so a drag can
  // never land something below it. During a trip this is the store's own walk
  // (shopWalkOrder, so an aisle it was never arranged with still has a row).
  const draggable = useMemo(
    () =>
      shopWalkOrder(tripShop?.aisleOrder ?? null, aisleOrder).filter(a => a !== OTHER_AISLE),
    [tripShop, aisleOrder]
  );

  const handleReorder = (reordered: string[]) => {
    if (tripShop) setShopAisleOrder(tripShop.id, reordered);
    else setAisleOrder(reordered);
  };

  const confirmUsualOrder = () => {
    if (!tripShop) return;
    const { id, name } = tripShop;
    confirmDelete({
      title: `Use the usual order at ${name}?`,
      message: `The order you set for ${name} is removed, and the list follows the usual order there.`,
      confirmLabel: 'Use usual order',
      onConfirm: () => {
        setShopAisleOrder(id, null);
        haptics.success();
      },
    });
  };

  // ==== aisles ====
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
        ? `${filed} ${filed === 1 ? 'item moves' : 'items move'} to ${OTHER_AISLE}. You can file them somewhere else afterward.`
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
    if (!aisleOrder.includes(created)) {
      haptics.success();
      // Arranging a store, a new aisle goes where the field is: at the bottom
      // of the walk on screen. Left to shopWalkOrder it would sit after the
      // usual order's last aisle, which in this store's walk can be anywhere.
      // A store still on the usual order needs nothing, since that already is
      // the bottom.
      if (tripShop?.aisleOrder) setShopAisleOrder(tripShop.id, [...draggable, created]);
    }
    setNewAisle('');
  };

  // ==== render ====
  // Both renames commit on blur, but tapping Done can beat that blur — flush
  // whichever one is mid-edit instead of dropping it, same fix as
  // GroceryItemSheet's Done button.
  const handleDone = () => {
    Keyboard.dismiss();
    commitRename();
    commitAisleRename();
    onClose();
  };

  // fullScreen, not a page sheet: the sheet's own pull-down pan cancels the JS
  // touches this list's drag runs on. See EditorSheet's note (#1182).
  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={handleDone}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SheetHeader
          title="List settings"
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label="Done" onPress={handleDone} minWidth={64} />}
        />

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
            newShopInputRef={newShopInputRef}
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
            aisleOrder={aisleOrder}
            rangeShopId={rangeShopId}
            onToggleRange={id => {
              haptics.tap();
              setRangeShopId(cur => (cur === id ? null : id));
            }}
            scopedDrafts={scopedDrafts}
            onSetScoped={(id, scoped) => {
              setScopedDrafts(cur => {
                const next = new Set(cur);
                if (scoped) next.add(id);
                else next.delete(id);
                return next;
              });
              // Switching back to Everything clears the range outright. The
              // other direction writes nothing: there is no range to write
              // until an aisle is picked, and a store scoped to none of them
              // would have to mean "sells nothing".
              if (!scoped) setShopAisles(id, null);
            }}
            onSetAisles={(id, aisles) => {
              // Unticking the last aisle empties the range, which normalises
              // back to null in the store. The draft above is what keeps the
              // pills on screen so the next tap has somewhere to land.
              setScopedDrafts(cur => {
                const next = new Set(cur);
                next.add(id);
                return next;
              });
              setShopAisles(id, aisles);
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
        {tripShop ? (
          <>
            <View style={styles.tripCard}>
              <View style={styles.tripCardHead}>
                <Ionicons name="storefront-outline" size={iconSize.sm} color={colors.accent} />
                <Text style={styles.tripCardTitle} numberOfLines={2}>
                  Order at {tripShop.name}
                </Text>
              </View>
              <Text style={styles.tripCardText}>
                {tripShop.aisleOrder
                  ? 'You\u2019re shopping here, so the list follows this order. Dragging below changes it for this store only.'
                  : 'You\u2019re shopping here, so dragging below changes the order for this store only. Until you move something, it follows the usual order.'}
              </Text>
              {tripShop.aisleOrder && (
                <InlineAction
                  label="Use the usual order"
                  icon="refresh"
                  variant="neutral"
                  surface="card"
                  onPress={confirmUsualOrder}
                  accessibilityLabel={`Use the usual order at ${tripShop.name}`}
                  style={styles.tripCardAction}
                />
              )}
            </View>
            <Text style={styles.intro}>
              Tap a name to rename it. Mark an aisle not food to keep it out of nutrition and food
              log prompts. Both apply at every store.
            </Text>
          </>
        ) : (
          <Text style={styles.intro}>
            Hold a row and drag it into the order you walk your store. Your list follows the same
            order. Tap a name to rename it. Mark an aisle not food to keep it out of nutrition and
            food log prompts.{ownOrders ? ` ${ownOrders}` : ''}
          </Text>
        )}

        <ReorderableList
          data={draggable}
          keyExtractor={a => a}
          contentContainerStyle={styles.list}
          placeholderStyle={styles.dropSlot}
          // dragTick, not tap: a fast drag crosses several rows between frames
          // and unthrottled ticks run together into one long buzz. The lift
          // itself is fired by ReorderableList.
          onHoverChange={haptics.dragTick}
          onReorder={handleReorder}
          renderItem={({ item: aisle, drag, isActive }) => {
            const count = countFor(aisle);
            const editing = aisle === editingAisle;
            const nonFood = isNonFoodAisle(aisle, nonFoodAisles);
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
                    // Off on every name field down here, for the reason
                    // GroceryRow's inline rename spells out: the correction
                    // lands on blur, and blur is what commits the name.
                    autoCorrect={false}
                    spellCheck={false}
                    returnKeyType="done"
                    maxLength={AISLE_NAME_MAX_LENGTH}
                    accessibilityLabel={`Rename ${aisle}`}
                  />
                ) : (
                  <Text style={styles.rowLabel} numberOfLines={1}>{aisle}</Text>
                )}

                {count > 0 && !editing && <Text style={styles.rowCount}>{count}</Text>}

                {!editing && (
                  <TouchableOpacity
                    onPress={() => setAisleNonFood(aisle, !nonFood)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: nonFood }}
                    accessibilityLabel={`Not food: ${aisle}`}
                    accessibilityHint="Keeps this aisle out of nutrition and food log prompts"
                  >
                    <Ionicons
                      name={nonFood ? 'nutrition' : 'nutrition-outline'}
                      size={iconSize.md}
                      color={nonFood ? colors.accent : colors.textTertiary}
                    />
                  </TouchableOpacity>
                )}

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
                  ref={newAisleInputRef}
                  style={styles.addInput}
                  value={newAisle}
                  onChangeText={setNewAisle}
                  placeholder="Add an aisle"
                  placeholderTextColor={colors.textTertiary}
                  autoCorrect={false}
                  spellCheck={false}
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
    </SheetModal>
  );
}

interface StoresTabProps {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  shops: Shop[];
  shopCounts: Map<string, number>;
  newShop: string;
  setNewShop: (s: string) => void;
  newShopInputRef: React.RefObject<TextInput | null>;
  onAdd: () => void;
  editingShopId: string | null;
  editingName: string;
  setEditingName: (s: string) => void;
  onStartRename: (id: string, name: string) => void;
  onCommitRename: () => void;
  onReorder: (ids: string[]) => void;
  onDelete: (id: string, name: string) => void;
  onToggleExcluded: (id: string, excluded: boolean) => void;
  /** The walk order, which is the set of aisles a range can be drawn from. */
  aisleOrder: string[];
  /** Which store has its range open. One at a time, like the rename field. */
  rangeShopId: string | null;
  onToggleRange: (id: string) => void;
  /**
   * True while a store is being scoped but has no aisle picked yet. The store
   * itself has no such state — an empty range normalises to `null`, which is
   * "sells everything" (see Shop.aisles) — so the half-finished answer lives
   * here in the sheet rather than being written as a range nobody gave.
   */
  scopedDrafts: ReadonlySet<string>;
  onSetScoped: (id: string, scoped: boolean) => void;
  onSetAisles: (id: string, aisles: string[] | null) => void;
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
  newShopInputRef,
  onAdd,
  editingShopId,
  editingName,
  setEditingName,
  onStartRename,
  onCommitRename,
  onReorder,
  onDelete,
  onToggleExcluded,
  aisleOrder,
  rangeShopId,
  onToggleRange,
  scopedDrafts,
  onSetScoped,
  onSetAisles,
}: StoresTabProps) {
  return (
    <>
      <Text style={styles.intro}>
        The places you shop. Naming one when you finish a trip is what records which store has
        which items, so you can filter the catalog by store. Set a store's aisles if it only sells
        some of them, and it stops being asked about the rest.
      </Text>

      <ReorderableList
        data={shops}
        keyExtractor={s => s.id}
        contentContainerStyle={shops.length === 0 ? styles.listEmpty : styles.list}
        placeholderStyle={styles.dropSlot}
        onHoverChange={haptics.dragTick}
        onReorder={reordered => onReorder(reordered.map(s => s.id))}
        renderItem={({ item: shop, drag, isActive }) => {
          const count = shopCounts.get(shop.id) ?? 0;
          const editing = shop.id === editingShopId;
          const rangeOpen = shop.id === rangeShopId && !editing;
          // An empty draft is not a range — the store still sells everything
          // until an aisle is picked — so the control reads scoped while the
          // shop does not. That gap is the point: it is what lets somebody pick
          // the first aisle at all.
          const scoped = shop.aisles !== null || scopedDrafts.has(shop.id);
          const range = describeShopAisles(shop);
          return (
            <View>
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
                  autoCorrect={false}
                  spellCheck={false}
                  returnKeyType="done"
                  maxLength={SHOP_NAME_MAX_LENGTH}
                  accessibilityLabel={`Rename ${shop.name}`}
                />
              ) : (
                // The name gets the row's flexible width on its own line and
                // the range sits under it, rather than the two sharing a row
                // with three icon buttons: a store's name is what the row
                // exists to show, and it must not be the thing that truncates.
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{shop.name}</Text>
                  {!!range && (
                    <Text style={styles.rowRange} numberOfLines={1}>Only {range}</Text>
                  )}
                </View>
              )}

              {count > 0 && !editing && <Text style={styles.rowCount}>{count}</Text>}

              {!editing && (
                <TouchableOpacity
                  onPress={() => onToggleRange(shop.id)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: rangeOpen }}
                  accessibilityLabel={`Aisles ${shop.name} sells`}
                  accessibilityHint="Limits this store to certain aisles, so it isn't asked about the rest"
                >
                  <Ionicons
                    // Stacked trays rather than a list glyph: the row already
                    // opens with `reorder-three-outline`, and two sets of
                    // horizontal lines side by side read as one control that
                    // has been drawn twice. Shelves are also what the thing
                    // being picked actually is.
                    name={shop.aisles !== null ? 'file-tray-stacked' : 'file-tray-stacked-outline'}
                    size={iconSize.md}
                    color={shop.aisles !== null ? colors.accent : colors.textTertiary}
                  />
                </TouchableOpacity>
              )}

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

            {rangeOpen && (
              <View style={styles.rangePanel}>
                <Text style={styles.rangeHint}>
                  {scoped && !range
                    ? `Pick the aisles ${shop.name} sells. Until you pick one it still sells everything.`
                    : `A store set to certain aisles isn’t asked whether it had things from the others, and isn’t suggested for them when you plan a trip.`}
                </Text>
                <SegmentedControl
                  label={`What ${shop.name} sells`}
                  value={scoped ? 'some' : 'all'}
                  onChange={v => {
                    haptics.tap();
                    onSetScoped(shop.id, v === 'some');
                  }}
                  options={RANGE_OPTIONS}
                  surface="card"
                />
                {scoped && (
                  <View style={styles.rangePills}>
                    <PillGroup
                      noun="aisle"
                      surface="card"
                      options={aisleOrder.map(aisle => ({
                        key: aisle,
                        label: aisle,
                        selected: shop.aisles?.includes(aisle) ?? false,
                        onPress: () => {
                          haptics.tap();
                          const current = shop.aisles ?? [];
                          onSetAisles(
                            shop.id,
                            current.includes(aisle)
                              ? current.filter(a => a !== aisle)
                              : [...current, aisle]
                          );
                        },
                      }))}
                    />
                  </View>
                )}
              </View>
            )}
            </View>
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
              ref={newShopInputRef}
              style={styles.addInput}
              value={newShop}
              onChangeText={setNewShop}
              placeholder="Add a store"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              spellCheck={false}
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
  groupBy: GroceryGroupBy;
  onChange: (groupBy: GroceryGroupBy) => void;
}

/**
 * Aisle, recipe or store grouping (#1717, #2938) — a closed choice, so
 * SegmentedControl rather than another draggable list. Wrapped in a card:
 * the control's own track is bgTertiary, which is close to invisible sitting
 * directly on this sheet's bg (see SegmentedControl's doc comment).
 *
 * The store hint names the away-list exception because it is the one place
 * the choice is not honored: GroceryScreen shows an away list by aisle
 * whatever is picked here, since every store on record is one near home.
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
            { value: 'store', label: 'Store' },
          ]}
        />
        <Text style={styles.groupByHint}>
          {groupBy === 'recipe'
            ? 'Items are grouped by the recipe they were added from. Anything typed by hand, or added from more than one recipe at once, is under "No recipe."'
            : groupBy === 'store'
              ? `Items are grouped by the store you usually buy them at, or the one store you\u2019ve linked them to. Each store keeps its own aisle order if it has one, or your usual order. Anything else is under "${NO_STORE_LABEL}." Away lists stay grouped by aisle.`
              : 'Items are grouped by aisle, in the walk order set on the Aisles tab. A store with its own order uses it while you\u2019re shopping there.'}
        </Text>
      </View>
    </>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    headerSpacer: { width: 64 },
    intro: {
      color: colors.textTertiary,
      fontSize: font.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    list: { paddingTop: spacing.md, paddingBottom: spacing.xl },
    // Full-height content container so the Stores tab's EmptyState centres
    // in the space above the add row, instead of collapsing to its natural
    // height at the top of the list.
    listEmpty: { flexGrow: 1, paddingTop: spacing.md, paddingBottom: spacing.xl },
    dropSlot: {
      marginHorizontal: spacing.md,
      marginVertical: spacing.xxs,
      borderRadius: radius.md,
      backgroundColor: colors.bgTertiary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: spacing.xxs,
      borderRadius: radius.md,
      paddingVertical: 14,
      paddingHorizontal: spacing.md,
    },
    rowActive: { backgroundColor: colors.bgTertiary },
    rowPinned: { opacity: 0.6 },
    rowText: { flex: 1, gap: spacing.xxs },
    rowLabel:{ fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    rowRange: { fontSize: font.xs, color: colors.textSecondary },
    // Sits under its store's card and inside the same horizontal margin, with
    // a gap on both sides: the row above has none below it and the next row
    // has none above.
    rangePanel: {
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      padding: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      gap: spacing.md,
    },
    rangeHint: { fontSize: font.sm, color: colors.textTertiary, lineHeight: 19 },
    rangePills: { marginTop: -spacing.xs },
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
    // The store being arranged, above its walk. A card on the sheet's bg like
    // the Group by one, spaced on both sides: the tab control above has no
    // bottom margin and the intro below only its own top padding.
    tripCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      gap: spacing.sm,
    },
    tripCardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    tripCardTitle: {
      flexShrink: 1,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
      color: colors.text,
    },
    // textSecondary rather than the intro's tertiary: this says which walk a
    // drag changes, which is information, not an aside.
    tripCardText: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 19 },
    tripCardAction: { alignSelf: 'flex-start', marginTop: spacing.xxs },
  });
}
