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
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
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
  const addExistingMany = useGroceryStore(s => s.addExistingMany);
  const toggleFavorite = useGroceryStore(s => s.toggleFavorite);
  const deleteItems = useGroceryStore(s => s.deleteItems);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // Nothing carries over between openings — a stale selection from last week
  // is a way to add things you didn't mean to.
  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setQuery('');
    }
  }, [visible]);

  const now = useMemo(() => new Date(), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (query.trim()) {
      return rankGrocerySuggestions(query, items, now, 50)
        .filter(s => !s.onList)
        .map(s => s.item);
    }
    return buyAgainItems(items, now);
  }, [query, items, now]);

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
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={interaction.activeOpacity}
        onPress={() => toggle(item.id)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected }}
        accessibilityLabel={item.name}
      >
        <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
          {isSelected && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
        </View>
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.aisle}
            {item.purchaseCount > 0 && ` · bought ${item.purchaseCount}×`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            toggleFavorite(item.id);
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={item.favorite ? `Unstar ${item.name}` : `Star ${item.name}`}
        >
          <Ionicons
            name={item.favorite ? 'star' : 'star-outline'}
            size={iconSize.md}
            color={item.favorite ? colors.warning : colors.textTertiary}
          />
        </TouchableOpacity>
      </TouchableOpacity>
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

        <FlatList
          data={rows}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          ListFooterComponent={
            // An offer, never a sweep: there's no undo anywhere in groceries,
            // so an automatic delete would be unrecoverable in a way the task
            // side's retention purge isn't.
            !query.trim() && pruneable.length > 0 ? (
              <View style={styles.pruneWrap}>
                <InlineAction
                  label={`Forget ${pruneable.length} unused`}
                  // color-wand, not sparkles: sparkles means "calls
                  // api.anthropic.com / needs a key" app-wide, and this is a
                  // local heuristic over purchase counts.
                  icon="color-wand-outline"
                  variant="neutral"
                  onPress={confirmPrune}
                />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="basket-outline"
              title={query.trim() ? 'Nothing matches' : 'Nothing to buy again yet'}
              subtitle={
                query.trim()
                  ? 'Everything matching is already on the list.'
                  : 'Finish a shop and the things you bought turn up here, best-first.'
              }
            />
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
    list: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
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
  });
}
