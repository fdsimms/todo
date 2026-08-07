import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
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
import { GroceryAddField } from '../components/GroceryAddField';
import { GroceryRow } from '../components/GroceryRow';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useGroceryStore } from '../store/useGroceryStore';
import { buildGrocerySections } from '../utils/grocerySuggest';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { GroceryItem } from '../types';

/**
 * A flat stream of tagged rows rather than a SectionList — the same shape
 * TodayScreen uses for its headers and stacks. It keeps one scroll view (so
 * useKeyboardInsetScroll's FlatList handle applies directly), and it makes the
 * in-cart collapse a matter of which rows are in the array rather than a
 * second animation system.
 */
type ListRow =
  | { type: 'aisle'; key: string; aisle: string }
  | { type: 'cartHeader'; key: string; count: number }
  | { type: 'item'; key: string; item: GroceryItem };

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

  const [cartOpen, setCartOpen] = useState(false);
  // Wired from day one even though phase 1 ships no within-aisle drag: a
  // SortableList added later is a *descendant* of this list's scroll view, and
  // RN only stands a native scroll view down for an *ancestor* JS responder —
  // so without this the drag would be silently dead on this screen.
  const [draggingRow, setDraggingRow] = useState(false);

  const keyboardScroll = useKeyboardInsetScroll<FlatList>();

  const { sections, inCart, remaining } = useMemo(
    () => buildGrocerySections(items, aisleOrder, cartHoldIds),
    [items, aisleOrder, cartHoldIds]
  );

  const checkedCount = useMemo(() => items.filter(i => i.onList && i.checked).length, [items]);
  const listCount = remaining + checkedCount;
  const catalogCount = items.length;

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    for (const section of sections) {
      out.push({ type: 'aisle', key: `aisle:${section.aisle}`, aisle: section.aisle });
      for (const item of section.data) out.push({ type: 'item', key: item.id, item });
    }
    if (inCart.length > 0) {
      out.push({ type: 'cartHeader', key: 'cartHeader', count: inCart.length });
      if (cartOpen) {
        for (const item of inCart) out.push({ type: 'item', key: item.id, item });
      }
    }
    return out;
  }, [sections, inCart, cartOpen]);

  const handleToggle = useCallback(
    (id: string) => {
      haptics.impactLight();
      animateLayout();
      toggleChecked(id);
    },
    [toggleChecked]
  );

  const handleEdit = useCallback((id: string) => {
    // The item sheet lands next; long-press is wired now so the row's gesture
    // surface doesn't change under the user when it does.
    void id;
  }, []);

  const confirmFinish = useCallback(() => {
    Alert.alert(
      'Finish shopping?',
      `${checkedCount} ${checkedCount === 1 ? 'item comes' : 'items come'} off the list. Everything stays in your catalog for next time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish',
          onPress: () => {
            animateLayout();
            if (finishShopping() > 0) haptics.success();
            setCartOpen(false);
          },
        },
      ]
    );
  }, [checkedCount, finishShopping]);

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
    const list: ScreenHeaderAction[] = [];
    if (listCount > 0) {
      list.push({
        icon: 'trash-outline',
        onPress: confirmClear,
        accessibilityLabel: 'Clear the list',
      });
    }
    list.push({
      icon: 'bag-check-outline',
      onPress: confirmFinish,
      disabled: checkedCount === 0,
      badge: checkedCount || undefined,
      tint: 'accent',
      accessibilityLabel: 'Finish shopping',
    });
    return list;
  }, [listCount, checkedCount, confirmClear, confirmFinish]);

  const renderRow = useCallback(
    ({ item: row }: { item: ListRow }) => {
      if (row.type === 'aisle') {
        return (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{row.aisle}</Text>
          </View>
        );
      }
      if (row.type === 'cartHeader') {
        return (
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
      return <GroceryRow item={row.item} onToggle={handleToggle} onEdit={handleEdit} />;
    },
    [styles, colors, cartOpen, handleToggle, handleEdit]
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

      <GroceryAddField />

      <FlatList
        ref={keyboardScroll.ref}
        {...keyboardScroll.props}
        data={rows}
        keyExtractor={row => row.key}
        renderItem={renderRow}
        scrollEnabled={!draggingRow}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        ListFooterComponent={<View style={{ height: tabBarHeight + spacing.xl }} />}
        ListEmptyComponent={
          <EmptyState
            icon="cart-outline"
            title="Nothing on the list"
            subtitle={
              catalogCount > 0
                ? 'Start typing above — everything you’ve bought before will come up.'
                : 'Type what you need above. Paste a whole list and each line becomes an item.'
            }
            bottomOffset={tabBarHeight}
          />
        }
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
    sectionTitle: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textTertiary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
  });
}
