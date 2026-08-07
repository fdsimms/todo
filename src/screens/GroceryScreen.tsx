import React, { useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { GroceryAddSheet } from '../components/GroceryAddSheet';
import { FabMenu, FAB_SIZE, type FabDragHandlers, type FabMenuItem } from '../components/Fab';
import {
  FabDropZone,
  FabDropZoneProvider,
  useFabIntentChannel,
  useFabIntentSelector,
  type FabDropZonesHandle,
  type FabIntentChannel,
} from '../components/FabDropZones';
import {
  categoriesByIndex,
  type DragScroller,
  type DropZone,
  type FabDropIntent,
} from '../utils/fabDrop';
import { GroceryRow } from '../components/GroceryRow';
import { BuyAgainSheet } from '../components/BuyAgainSheet';
import { GroceryItemSheet } from '../components/GroceryItemSheet';
import { GroceryAislesSheet } from '../components/GroceryAislesSheet';
import { FinishShoppingSheet } from '../components/FinishShoppingSheet';
import { InlineAction } from '../components/InlineAction';
import { ReorderableList } from '../components/ReorderableList';
import { GroceryAISheet, type GroceryAIMode } from '../components/GroceryAISheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { OTHER_AISLE } from '../utils/groceryAisles';
import { useGroceryStore } from '../store/useGroceryStore';
import { buildGrocerySections } from '../utils/grocerySuggest';
import { resolveGroceryDrop, groceryDragRange, placeNewGroceryItems } from '../utils/groceryReorder';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { GroceryItem } from '../types';

/**
 * A flat stream of tagged rows rather than a SectionList — the same shape
 * TodayScreen uses for its headers and stacks. It keeps one scroll view, it
 * makes the in-cart collapse a matter of which rows are in the array rather
 * than a second animation system, and it is what lets one drag both reorder an
 * item and move it to another aisle: the row lands where it's dropped and takes
 * the aisle of the nearest header above (see resolveGroceryDrop).
 */
type ListRow =
  | { type: 'aisle'; key: string; aisle: string }
  | { type: 'cartHeader'; key: string; count: number }
  | { type: 'item'; key: string; item: GroceryItem; inCart: boolean };

// The add button, naming what a release right now would do.
function AddGroceryFabWithDropLabel({
  channel,
  ...props
}: {
  channel: FabIntentChannel;
} & Omit<React.ComponentProps<typeof FabMenu>, 'dragLabel'>) {
  const label = useFabIntentSelector(channel, intent => {
    if (intent?.kind === 'cancel') return 'Cancel';
    if (intent?.kind !== 'insert') return null;
    return intent.category ? `New item in ${intent.category}` : 'New item here';
  });
  return <FabMenu {...props} dragLabel={label} />;
}

export function GroceryScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const cartHoldIds = useGroceryStore(useShallow(s => s.cartHoldIds));
  const toggleChecked = useGroceryStore(s => s.toggleChecked);
  const finishShopping = useGroceryStore(s => s.finishShopping);
  const clearList = useGroceryStore(s => s.clearList);
  const applyDrop = useGroceryStore(s => s.applyDrop);

  const [cartOpen, setCartOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [buyAgainOpen, setBuyAgainOpen] = useState(false);
  const [aislesOpen, setAislesOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState<GroceryAIMode | null>(null);

  // Every AI affordance is gated on this, so a user without a key never sees
  // an entry point — the offline lexicon carries the feature on its own.
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);

  const { sections, inCart, remaining } = useMemo(
    () => buildGrocerySections(items, aisleOrder, cartHoldIds),
    [items, aisleOrder, cartHoldIds]
  );

  const checkedCount = useMemo(() => items.filter(i => i.onList && i.checked).length, [items]);
  const listCount = remaining + checkedCount;
  const catalogCount = items.length;
  // Only worth offering when the lexicon actually left a gap.
  const unsortedCount = useMemo(
    () => items.filter(i => i.onList && i.aisle === OTHER_AISLE).length,
    [items]
  );

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    for (const section of sections) {
      out.push({ type: 'aisle', key: `aisle:${section.aisle}`, aisle: section.aisle });
      for (const item of section.data) out.push({ type: 'item', key: item.id, item, inCart: false });
    }
    if (inCart.length > 0) {
      out.push({ type: 'cartHeader', key: 'cartHeader', count: inCart.length });
      if (cartOpen) {
        for (const item of inCart) out.push({ type: 'item', key: item.id, item, inCart: true });
      }
    }
    return out;
  }, [sections, inCart, cartOpen]);

  // ——— Dragging the add button into the list ———————————————————————————
  //
  // The same gesture Today and Projects have, over the shape this list has: a
  // drop names an aisle and a spot in it, and the item typed into the sheet
  // that opens lands exactly there. The button reports raw pointer positions,
  // FabDropZoneProvider turns those into an intent, and everything below is
  // what each intent means here.

  const dropZonesRef = useRef<FabDropZonesHandle>(null);
  const [fabDragging, setFabDragging] = useState(false);
  // Lets the drag scroll the list once it reaches either end of the screen.
  const scrollControl = useRef<DragScroller | null>(null);
  // What the drag is aimed at goes through a channel rather than state: it
  // changes as the finger crosses each row, and re-rendering this screen
  // re-runs every row's renderItem. Only the button's label reads it.
  const fabIntentChannel = useFabIntentChannel();
  const [addSeedAisle, setAddSeedAisle] = useState<string | null>(null);
  // The drop the add sheet was opened by, re-anchored after each item so a
  // burst of ten arrives in the order it was typed rather than inside out.
  const pendingDropRef = useRef<Extract<FabDropIntent, { kind: 'insert' }> | null>(null);

  /**
   * Close the add sheet and forget the placement it was opened with. Missing
   * this leaves the placement armed and the next plain tap on the button
   * inherits it — items filed into an aisle because of a drag ten minutes ago.
   */
  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setAddSeedAisle(null);
    pendingDropRef.current = null;
  }, []);

  const zoneByKey = useMemo(() => {
    const aislesFor = categoriesByIndex(rows.map(r => (r.type === 'aisle' ? r.aisle : null)));
    const map = new Map<string, DropZone>();
    rows.forEach((row, i) => {
      if (row.type === 'aisle') {
        map.set(row.key, { kind: 'header', key: row.key, category: row.aisle });
      } else if (row.type === 'cartHeader' || row.inCart) {
        // Registered, but with nothing to say about placement: the cart is a
        // record of the trolley rather than a place to file something, which is
        // the same bound groceryDragRange puts on a row drag. Leaving these out
        // entirely would let a drop over them reach back up to the last aisle
        // row instead of resolving to "nowhere in particular".
        map.set(row.key, { kind: 'rest', key: row.key });
      } else {
        map.set(row.key, { kind: 'task', key: row.key, category: aislesFor[i] ?? null });
      }
    });
    return map;
  }, [rows]);

  /**
   * Give the freshly added items the position the button was dropped at, then
   * re-anchor onto the last of them so the next add in the same burst lands
   * after it rather than back on the original seam.
   */
  const handleItemsAdded = useCallback(
    (created: GroceryItem[]) => {
      const drop = pendingDropRef.current;
      if (!drop || created.length === 0) return;
      // `rows` is this render's list, from before the add — which is exactly
      // what placeNewGroceryItems wants, since it splices the new rows in
      // itself (and drops them from their old spot if they were already there).
      const placements = placeNewGroceryItems(rows, drop.anchorKey, drop.before, created);
      if (placements) applyDrop(placements);
      const last = created[created.length - 1];
      pendingDropRef.current = { ...drop, anchorKey: last.id, before: false };
    },
    [rows, applyDrop]
  );

  const openAddForDrop = useCallback((intent: FabDropIntent) => {
    // Dropped back on the button: the drag is the whole of what happened, so no
    // sheet, and nothing left armed for the next tap (see closeAdd).
    if (intent.kind === 'cancel') {
      pendingDropRef.current = null;
      haptics.tap();
      return;
    }
    // 'insert' and 'plain' are the only two this screen can produce — there are
    // no stacks to join and nothing is pinnable here.
    if (intent.kind === 'insert') {
      pendingDropRef.current = intent;
      setAddSeedAisle(intent.category);
    } else {
      pendingDropRef.current = null;
      setAddSeedAisle(null);
    }
    setAddOpen(true);
  }, []);

  // Rebuilt each render so it closes over fresh state; the button reads it
  // through a ref, and its responder is built once regardless.
  const fabDrag: FabDragHandlers = {
    onStart: () => {
      setFabDragging(true);
      dropZonesRef.current?.begin();
    },
    onMove: (pageY, home) => dropZonesRef.current?.moveTo(pageY, home),
    onEnd: (pageY, home) => {
      setFabDragging(false);
      // end()/cancel() publish a null intent themselves, which is what clears
      // the label.
      openAddForDrop(dropZonesRef.current?.end(pageY, home) ?? { kind: 'plain' });
    },
    onCancel: () => {
      setFabDragging(false);
      dropZonesRef.current?.cancel();
    },
  };

  const handleToggle = useCallback(
    (id: string) => {
      haptics.impactLight();
      animateLayout();
      toggleChecked(id);
    },
    [toggleChecked]
  );

  const handleEdit = useCallback((id: string) => {
    haptics.tap();
    setEditingId(id);
  }, []);

  // The confirm is a sheet rather than an Alert because it now carries a store
  // picker, and an Alert can't hold one. It's still a confirm: nothing is
  // recorded until Finish.
  const handleFinished = useCallback(
    (shopId: string | null) => {
      setFinishOpen(false);
      animateLayout();
      if (finishShopping(shopId) > 0) haptics.success();
      setCartOpen(false);
    },
    [finishShopping]
  );

  const confirmClear = useCallback(() => {
    Alert.alert(
      'Clear the list?',
      'Everything comes off the list without being marked as bought. Nothing is deleted — it all stays in your catalog.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            clearList();
            haptics.warning();
            setCartOpen(false);
          },
        },
      ]
    );
  }, [clearList]);

  const actions = useMemo<ScreenHeaderAction[]>(() => {
    // Nothing that *adds* is here — the three ways onto the list all hang off
    // the FAB, same as every other list screen. What's left is the two things
    // you do to a list that already exists.
    //
    // Clear list is deliberately NOT here either. It's destructive-looking,
    // rarely used, and the header is where you're tapping one-handed while
    // walking — it lives at the foot of the list instead, which is where you
    // look when you're done rather than mid-shop.
    const list: ScreenHeaderAction[] = [];
    list.push({
      icon: 'options-outline',
      onPress: () => setAislesOpen(true),
      accessibilityLabel: 'Aisle order',
    });
    list.push({
      icon: 'bag-check-outline',
      onPress: () => setFinishOpen(true),
      disabled: checkedCount === 0,
      badge: checkedCount || undefined,
      tint: 'accent',
      accessibilityLabel: 'Finish shopping',
    });
    return list;
    // No anthropicApiKey dep any more: the AI entry point moved to the FAB
    // menu, and opening the finish sheet is a setState the memo doesn't close
    // over anything else for.
  }, [checkedCount]);

  // Bottom-up: "Add an item" ends up closest to the button. The recipe entry
  // is gated on a key like every other AI affordance here, so a user without
  // one just gets a two-item menu.
  const addMenuItems = useMemo<FabMenuItem[]>(() => {
    const list: FabMenuItem[] = [];
    if (anthropicApiKey) {
      list.push({ key: 'recipe', label: 'From a recipe', icon: 'sparkles-outline' });
    }
    list.push({ key: 'buyAgain', label: 'Buy again', icon: 'basket-outline' });
    list.push({ key: 'item', label: 'Add an item', icon: 'add-circle-outline' });
    return list;
  }, [anthropicApiKey]);

  const handleAddMenuSelect = useCallback((key: string) => {
    if (key === 'recipe') setAiMode('recipe');
    else if (key === 'buyAgain') setBuyAgainOpen(true);
    else setAddOpen(true);
  }, []);

  const renderRow = useCallback(
    ({ item: row, drag, isActive }: { item: ListRow; drag?: () => void; isActive?: boolean }) => {
      // Every row doubles as a target for the add button being dragged in. The
      // wrapper only measures — no styling, no touches claimed — so a row
      // behaves exactly as it did without one, and the dragged row's floating
      // copy registers nothing (a null zone) rather than claiming the real
      // row's slot under the same key.
      const withZone = (content: React.ReactNode) => (
        <FabDropZone zone={isActive ? null : zoneByKey.get(row.key) ?? null}>{content}</FabDropZone>
      );
      if (row.type === 'aisle') {
        return withZone(
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{row.aisle}</Text>
          </View>
        );
      }
      if (row.type === 'cartHeader') {
        return withZone(
          <TouchableOpacity
            style={styles.cartHeader}
            activeOpacity={interaction.activeOpacity}
            onPress={() => {
              haptics.tap();
              animateLayout();
              setCartOpen(o => !o);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: cartOpen }}
            accessibilityLabel={`In cart, ${row.count} ${row.count === 1 ? 'item' : 'items'}`}
          >
            <Text style={styles.sectionTitle}>In cart ({row.count})</Text>
            <Ionicons
              name={cartOpen ? 'chevron-up' : 'chevron-down'}
              size={iconSize.sm}
              color={colors.textTertiary}
            />
          </TouchableOpacity>
        );
      }
      return withZone(
        <GroceryRow
          item={row.item}
          onToggle={handleToggle}
          onEdit={handleEdit}
          // Nothing in the cart is draggable: that section is a record of the
          // trolley, not a place to file something (see groceryDragRange).
          drag={row.inCart ? undefined : drag}
          isActive={isActive}
        />
      );
    },
    [styles, colors, cartOpen, handleToggle, handleEdit, zoneByKey]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Groceries"
        subtitle={
          listCount > 0
            ? `${remaining} left${checkedCount > 0 ? ` · ${checkedCount} in cart` : ''}`
            : undefined
        }
        actions={actions}
      />

      <FabDropZoneProvider
        ref={dropZonesRef}
        onIntentChange={fabIntentChannel.publish}
        scroller={scrollControl}
      >
      <ReorderableList
        data={rows}
        keyExtractor={row => row.key}
        renderItem={renderRow}
        // The user can't scroll during an add-button drag (the button's
        // responder has the touch); the drag scrolls it instead, through the
        // control below.
        scrollEnabled={!fabDragging}
        scrollControlRef={scrollControl}
        // dragTick, not tap: a fast drag crosses several rows between frames
        // and unthrottled ticks run together into one long buzz. The lift
        // itself is fired by ReorderableList.
        onHoverChange={haptics.dragTick}
        dragRange={groceryDragRange}
        placeholderStyle={styles.dropSlot}
        onReorder={reordered => applyDrop(resolveGroceryDrop(reordered))}
        contentContainerStyle={rows.length === 0 ? styles.emptyContainer : styles.list}
        // Nothing in the footer applies to an empty list, and the tab-bar
        // spacer would take its height off the box the empty state centres in
        // (the empty state clears the tab bar itself, via bottomOffset).
        ListFooterComponent={
          rows.length === 0 ? null : (
          <View>
            {!!anthropicApiKey && unsortedCount > 0 && (
              <View style={styles.clearWrap}>
                <InlineAction
                  label={`Sort ${unsortedCount} into aisles`}
                  icon="sparkles-outline"
                  tint={colors.purple}
                  onPress={() => setAiMode('tidy')}
                />
              </View>
            )}
            {listCount > 0 && (
              <View style={styles.clearWrap}>
                <InlineAction
                  label="Clear the list"
                  icon="trash-outline"
                  variant="neutral"
                  onPress={confirmClear}
                />
              </View>
            )}
            <View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />
          </View>
          )
        }
        ListEmptyComponent={
          <EmptyState
            icon="cart-outline"
            title="Nothing on the list"
            subtitle={
              catalogCount > 0
                ? 'Everything you’ve bought before is a tap away — or start typing and it’ll come up.'
                : 'Tap + to add what you need. Paste a whole list and each line becomes an item.'
            }
            actionLabel={catalogCount > 0 ? 'Buy again' : 'Add an item'}
            onAction={catalogCount > 0 ? () => setBuyAgainOpen(true) : () => setAddOpen(true)}
            bottomOffset={tabBarHeight}
          />
        }
      />
      </FabDropZoneProvider>

      <AddGroceryFabWithDropLabel
        channel={fabIntentChannel}
        items={addMenuItems}
        onSelect={handleAddMenuSelect}
        bottom={insets.bottom + tabBarHeight + spacing.md}
        accessibilityLabel="Add groceries"
        drag={fabDrag}
        dragHint="Drag onto the list to add an item there, or back to the button to cancel"
      />

      <GroceryAddSheet
        visible={addOpen}
        onClose={closeAdd}
        seedAisle={addSeedAisle}
        onAdded={handleItemsAdded}
      />
      <BuyAgainSheet visible={buyAgainOpen} onClose={() => setBuyAgainOpen(false)} />
      <GroceryAislesSheet visible={aislesOpen} onClose={() => setAislesOpen(false)} />
      <FinishShoppingSheet
        visible={finishOpen}
        checkedCount={checkedCount}
        onClose={() => setFinishOpen(false)}
        onFinished={handleFinished}
      />
      <GroceryItemSheet
        visible={editingId !== null}
        itemId={editingId}
        onClose={() => setEditingId(null)}
      />
      <GroceryAISheet
        visible={aiMode !== null}
        mode={aiMode ?? 'tidy'}
        onClose={() => setAiMode(null)}
      />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    list: {
      flexGrow: 1,
      paddingTop: spacing.xs,
    },
    // Full height, and none of the list's padding, so the empty state's
    // `flex: 1` centres on the same line it does everywhere else.
    emptyContainer: { flexGrow: 1 },
    dropSlot: {
      // Matches GroceryRow's own card geometry, so the gap that opens is
      // exactly the shape of the row about to land in it.
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      backgroundColor: colors.bgSecondary,
      opacity: 0.55,
    },
    sectionHeader: {
      paddingHorizontal: spacing.md + spacing.xs,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    cartHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md + spacing.xs,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    clearWrap: {
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    sectionTitle: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textTertiary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
  });
}
