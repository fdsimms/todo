import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
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
  checkboxRadius,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { buyAgainItems, catalogPruneCandidates, rankGrocerySuggestions } from '../utils/grocerySuggest';
import { itemIdsForShop, itemCountsByShop, primaryShopFor } from '../utils/groceryShops';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { PillGroup } from './PillGroup';
import { GroceryItemSheet } from './GroceryItemSheet';
import { haptics } from '../utils/haptics';
import type { GroceryItem } from '../types';

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Everything you've bought before that isn't on the list right now, best-first.
 *
 * This is what the catalog is *for*: a weekly shop is mostly the same forty
 * things, and picking them off a ranked list beats typing them. Selection is a
 * local Set rather than useTaskSelection — that hook is Task-typed, and
 * generifying it for one caller costs more than the twenty lines here.
 */
export function BuyAgainSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const shops = useGroceryStore(useShallow(s => s.shops));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const addExistingMany = useGroceryStore(s => s.addExistingMany);
  const deleteItems = useGroceryStore(s => s.deleteItems);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [shopFilter, setShopFilter] = useState<string | null>(null);
  // Nested rather than a sibling — a Modal presents from its React parent's
  // view controller, so a sibling would ask this sheet's own presenter for a
  // second presentation while this one is up. Same call PantrySheet makes.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Nothing carries over between openings — a stale selection from last week
  // is a way to add things you didn't mean to.
  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setQuery('');
      setShopFilter(null);
      setEditingId(null);
    }
  }, [visible]);

  const now = useMemo(() => new Date(), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const shopCounts = useMemo(() => itemCountsByShop(items, itemShops), [items, itemShops]);
  // Only stores with something in them: a chip reading "Aldi (0)" is a filter
  // whose only outcome is an empty list.
  const filterShops = useMemo(
    () => shops.filter(s => (shopCounts.get(s.id) ?? 0) > 0),
    [shops, shopCounts]
  );

  // Wrapping pills, not a horizontal scroll row — the same call
  // LogbookFilterSheet/RecipeTagFilterSheet made for the same reason: a
  // scroll row hides options past what fits on screen behind a swipe nobody
  // is prompted to make. "All" is pinned so the no-filter option is never
  // buried behind PillGroup's "N more".
  const shopFilterOptions = useMemo(() => [
    {
      key: '__all__',
      label: 'All',
      selected: shopFilter === null,
      pinned: true,
      accessibilityLabel: 'All stores',
      onPress: () => {
        haptics.tap();
        setShopFilter(null);
      },
    },
    ...filterShops.map(shop => {
      const active = shop.id === shopFilter;
      const count = shopCounts.get(shop.id) ?? 0;
      return {
        key: shop.id,
        label: shop.name,
        suffix: ` ${count}`,
        selected: active,
        accessibilityLabel: `${shop.name}, ${count} ${count === 1 ? 'item' : 'items'}`,
        onPress: () => {
          haptics.tap();
          setShopFilter(active ? null : shop.id);
        },
      };
    }),
  ], [filterShops, shopFilter, shopCounts]);

  // Filter first, then rank. Ranking a filtered set is the same function on
  // fewer rows; filtering a ranked set would silently shrink the 50-row cap.
  const scoped = useMemo(() => {
    if (!shopFilter) return items;
    const ids = itemIdsForShop(shopFilter, itemShops, items);
    return items.filter(i => ids.has(i.id));
  }, [items, itemShops, shopFilter]);

  const rows = useMemo(() => {
    if (query.trim()) {
      return rankGrocerySuggestions(query, scoped, now, 50)
        .filter(s => !s.onList)
        .map(s => s.item);
    }
    return buyAgainItems(scoped, now);
  }, [query, scoped, now]);

  // Deliberately over `items` and not `scoped`: the prune offer is about the
  // whole catalog, and scoping it to a store would offer to forget a subset
  // while the button still said how many were unused overall.
  const pruneable = useMemo(() => catalogPruneCandidates(items, now), [items, now]);

  const toggle = useCallback((id: string) => {
    haptics.tap();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAdd = () => {
    if (selected.size === 0) return;
    addExistingMany([...selected]);
    haptics.success();
    onClose();
  };

  /**
   * The catalog's only per-item delete. The pruner beside it is a heuristic
   * sweep — never bought, months stale — and it can't reach the thing you
   * bought twice in March and never want to see suggested again. Same
   * selection the Add button uses, so a clean-up is the gesture you already
   * know with a different verb.
   */
  const confirmForget = () => {
    const names = items.filter(i => selected.has(i.id)).map(i => i.name);
    if (names.length === 0) return;
    Alert.alert(
      `Forget ${names.length} ${names.length === 1 ? 'item' : 'items'}?`,
      `${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}\n\nThis removes them from your catalog along with their purchase history, and can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            deleteItems([...selected]);
            setSelected(new Set());
            haptics.warning();
          },
        },
      ]
    );
  };

  const confirmPrune = () => {
    Alert.alert(
      `Forget ${pruneable.length} unused ${pruneable.length === 1 ? 'item' : 'items'}?`,
      `${pruneable.map(i => i.name).slice(0, 6).join(', ')}${pruneable.length > 6 ? '…' : ''}\n\nThese have never been bought and haven't been added in months — usually typos. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            deleteItems(pruneable.map(i => i.id));
            haptics.warning();
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: GroceryItem }) => {
    const isSelected = selected.has(item.id);
    // Suppressed while a store filter is on: every row would name the store
    // you just filtered to, which is a column of the same word.
    const usual = shopFilter ? null : primaryShopFor(item, itemShops, shops);
    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.rowTapZone}
          activeOpacity={interaction.activeOpacity}
          onPress={() => toggle(item.id)}
          // Long-press still opens the same edit sheet as the ellipsis beside
          // it — same convention GroceryRow uses for its own rows, so a
          // catalog item is reachable for editing (brand, aisle, substitutes,
          // pantry) without leaving this sheet to do it from the list first.
          onLongPress={() => { haptics.tap(); setEditingId(item.id); }}
          delayLongPress={interaction.delayLongPress}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={item.name}
          accessibilityHint="Long press to edit"
        >
          <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
            {isSelected && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
          </View>
          <View style={styles.body}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {item.aisle}
              {item.purchaseCount > 0 && ` · bought ${item.purchaseCount}×`}
              {!!usual && ` · ${usual.name}`}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Long-press still opens the same sheet, but nothing on screen says
            so — same quiet trailing target GroceryRow uses for its rows. */}
        <TouchableOpacity
          onPress={() => { haptics.tap(); setEditingId(item.id); }}
          activeOpacity={interaction.activeOpacity}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.name}`}
        >
          <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={72} />
          <Text style={styles.headerTitle}>Buy again</Text>
          <SheetHeaderButton
            label={selected.size > 0 ? `Add ${selected.size}` : 'Add'}
            onPress={handleAdd}
            disabled={selected.size === 0}
            minWidth={72}
          />
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search everything you've bought"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Search your grocery catalog"
          />
        </View>

        {/* The everyday "what do I get at Costco" read, and the reason it lives
            here rather than on the shopping list: this is the catalog browser,
            and it's open exactly when you're deciding what to buy where. */}
        {filterShops.length > 0 && (
          <View style={styles.filterWrap}>
            <PillGroup options={shopFilterOptions} noun="store" surface="page" />
          </View>
        )}

        {/* Directly under the search rather than in the footer: a catalog is
            forty rows deep, and a destructive action you have to scroll to the
            bottom to find isn't one anybody uses. */}
        {selected.size > 0 && (
          <View style={styles.selectionBar}>
            <Text style={styles.selectionCount}>{selected.size} selected</Text>
            <InlineAction
              label="Forget"
              icon="trash-outline"
              tint={colors.red}
              onPress={confirmForget}
              accessibilityLabel={`Forget ${selected.size} selected ${selected.size === 1 ? 'item' : 'items'}`}
            />
          </View>
        )}

        <FlatList
          data={rows}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Full height when empty so the empty state's `flex: 1` has something
          // to centre in, and without the list's padding shifting that centre.
          contentContainerStyle={rows.length === 0 ? styles.emptyContainer : styles.list}
          ListFooterComponent={
            // An offer, never a sweep: there's no undo anywhere in groceries,
            // so an automatic delete would be unrecoverable in a way the task
            // side's retention purge isn't.
            // Hidden while selecting: one destructive action on screen at a
            // time, and the selection bar's is the one being aimed.
            !query.trim() && selected.size === 0 && pruneable.length > 0 ? (
              <View style={styles.pruneWrap}>
                <InlineAction
                  label={`Forget ${pruneable.length} unused`}
                  // color-wand, not sparkles: sparkles means "calls
                  // api.anthropic.com / needs a key" app-wide, and this is a
                  // local heuristic over purchase counts.
                  icon="color-wand-outline"
                  variant="neutral"
                  onPress={confirmPrune}
                  style={styles.pruneButton}
                />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="basket-outline"
              title={query.trim() ? 'Nothing matches' : 'Nothing to buy again yet'}
              subtitle={
                shopFilter
                  ? 'Everything you buy at this store is already on the list.'
                  : query.trim()
                    ? 'Everything matching is already on the list.'
                    : 'Finish a shop and the things you bought turn up here, best-first.'
              }
            />
          }
        />

        <GroceryItemSheet
          visible={!!editingId}
          itemId={editingId}
          onClose={() => setEditingId(null)}
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
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
    },
    search: {
      flex: 1,
      fontSize: font.md,
      color: colors.text,
      height: 40,
      padding: 0,
    },
    filterWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
    selectionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    selectionCount: {
      fontSize: font.sm,
      fontWeight: fontWeight.medium,
      color: colors.textSecondary,
    },
    list: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
    emptyContainer: { flexGrow: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
    },
    rowTapZone: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    body: { flex: 1 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
    pruneWrap: { alignItems: 'center', marginTop: spacing.lg },
    // Sits directly on the sheet's root colors.bg, where the default neutral
    // tint (bgTertiary) is nearly indistinguishable from it.
    pruneButton: { backgroundColor: colors.bgSecondary },
  });
}
