import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
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
import { InlineAction } from './InlineAction';
import { ProgressBar } from './ProgressBar';
import { haptics } from '../utils/haptics';
import {
  planTrip,
  summarizeTrip,
  describeShopCoverage,
  joinNames,
  type ShopCoverage,
} from '../utils/shoppingTrip';
import type { Shop } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Empty means "no store" — one plain "Get groceries" task. */
  onCreate: (shops: Shop[]) => void;
}

/**
 * Where this trip is going.
 *
 * This replaced an `Alert.alert` listing every store alphabetically, which
 * asked the right question and gave the user nothing to answer it with: with
 * eleven stores on file, "which store is this trip for?" is a memory test
 * about what's on the list two screens away.
 *
 * So the sheet answers it. Stores are ranked by how much of the list they're
 * known to carry, and the best one is picked for you on opening. **The gap is
 * the other half** — one store rarely has everything, and a plan of "Trader
 * Joe's, then the pharmacy for shampoo" is the thing worth surfacing, so the
 * card names the second stop and what it adds. Naming the missing items rather
 * than counting them is deliberate: "3 items aren't there" can't be acted on,
 * whereas seeing that it's just cilantro is what makes you skip the stop.
 *
 * Selecting several stores creates one task per store, not one task naming
 * them all — they're two errands, separately schedulable and separately
 * completable, which a single title can't be.
 *
 * No store stays a real answer, same as `FinishShoppingSheet`: it's a row of
 * its own rather than a cancel, and it makes exactly the task this button made
 * before any of this existed.
 */
export function ShoppingTripSheet({ visible, onClose, onCreate }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const shops = useGroceryStore(useShallow(s => s.shops));
  const lastShopId = useGroceryStore(s => s.lastShopId);

  const plan = useMemo(() => planTrip(items, itemShops, shops), [items, itemShops, shops]);
  const total = plan.itemIds.length;

  // Selection order is task order, so it's an array rather than a Set.
  const [selected, setSelected] = useState<string[]>([]);

  // Read through refs so the reset fires on opening only. The list can't
  // change while the sheet is up, but re-deriving the default from a store
  // update would silently undo a choice the user had already made.
  const planRef = useRef(plan);
  planRef.current = plan;
  const lastShopRef = useRef(lastShopId);
  lastShopRef.current = lastShopId;

  useEffect(() => {
    if (!visible) return;
    const current = planRef.current;
    // The best store, or — with nothing on the list to rank by — wherever the
    // last trip was finished, which is FinishShoppingSheet's default and right
    // more often than it's wrong.
    const best = summarizeTrip([], current).suggestion[0]?.shop.id ?? null;
    const last = lastShopRef.current;
    const fallback = last && current.coverage.some(c => c.shop.id === last) ? last : null;
    const initial = best ?? fallback;
    setSelected(initial ? [initial] : []);
  }, [visible]);

  const summary = useMemo(() => summarizeTrip(selected, plan), [selected, plan]);

  const nameOf = useMemo(() => new Map(items.map(i => [i.id, i.name])), [items]);
  const namesFor = useCallback(
    (ids: readonly string[]) => joinNames(ids.map(id => nameOf.get(id) ?? 'an item')),
    [nameOf]
  );

  const toggle = useCallback((shopId: string) => {
    haptics.tap();
    setSelected(prev =>
      prev.includes(shopId) ? prev.filter(id => id !== shopId) : [...prev, shopId]
    );
  }, []);

  const pickSuggestion = useCallback((suggestion: readonly ShopCoverage[]) => {
    haptics.tap();
    setSelected(prev => [...prev, ...suggestion.map(s => s.shop.id).filter(id => !prev.includes(id))]);
  }, []);

  const handleCreate = () => {
    const byId = new Map(shops.map(s => [s.id, s]));
    onCreate(selected.map(id => byId.get(id)).filter((s): s is Shop => !!s));
  };

  const next = summary.suggestion;
  const gapGain = next.length > 0 ? countIn(next[0].itemIds, summary.gap) : 0;
  // What the whole suggested itinerary would come to — everything already
  // covered, plus the gap it closes.
  const plannedTotal =
    summary.covered.length + summary.gap.length - remaining(next, summary.gap);

  const selectedNames = joinNames(
    selected.map(id => shops.find(s => s.id === id)?.name ?? '').filter(Boolean)
  );

  const addLabel = selected.length > 1 ? `Add ${selected.length}` : 'Add';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={72} />
          <Text style={styles.headerTitle}>Shopping trip</Text>
          <SheetHeaderButton label={addLabel} onPress={handleCreate} minWidth={72} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.intro}>
            {total === 0
              ? 'Nothing on your list right now.'
              : `${total} ${total === 1 ? 'item' : 'items'} on your list.`}
            {' '}
            {selected.length > 1
              ? `You'll get one task per store — ${selectedNames}.`
              : 'You’ll get a task on Today that opens straight back here.'}
          </Text>

          {next.length > 0 && (
            <View style={styles.suggestion}>
              <View style={styles.suggestionIcon}>
                <Ionicons name="sparkles" size={iconSize.sm} color={colors.accent} />
              </View>
              <View style={styles.suggestionBody}>
                {selected.length === 0 ? (
                  <>
                    <Text style={styles.suggestionTitle}>
                      {next[0].shop.name} has the most of your list — {next[0].itemIds.length} of{' '}
                      {total}.
                    </Text>
                    {next.length > 1 && (
                      <Text style={styles.suggestionSub}>
                        With {joinNames(next.slice(1).map(s => s.shop.name))} too, that’s{' '}
                        {plannedTotal} of {total}.
                      </Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.suggestionTitle}>
                      {capitalize(namesFor(summary.gap))} {summary.gap.length === 1 ? 'isn’t' : 'aren’t'}{' '}
                      at {selectedNames}.
                    </Text>
                    <Text style={styles.suggestionSub}>
                      {next[0].shop.name} has{' '}
                      {gapGain === summary.gap.length
                        ? summary.gap.length === 1
                          ? 'it'
                          : 'them all'
                        : `${gapGain} of them`}
                      .
                    </Text>
                  </>
                )}
                <InlineAction
                  label={
                    selected.length === 0
                      ? next.length > 1
                        ? `Pick all ${next.length}`
                        : `Pick ${next[0].shop.name}`
                      : next.length > 1
                        ? `Add ${next.length} stores`
                        : `Add ${next[0].shop.name}`
                  }
                  icon="add"
                  onPress={() => pickSuggestion(next)}
                  style={styles.suggestionAction}
                />
              </View>
            </View>
          )}

          <Text style={styles.label}>WHICH STORES?</Text>
          <Text style={styles.hint}>
            {total === 0
              ? 'In your own order — there’s nothing on the list to rank them by.'
              : 'Most of your list first. Pick as many as the trip needs.'}
          </Text>

          <View style={styles.card}>
            <Row
              first
              styles={styles}
              colors={colors}
              title="No store"
              subtitle="Just “Get groceries”"
              selected={selected.length === 0}
              onPress={() => {
                haptics.tap();
                setSelected([]);
              }}
            />
            {plan.coverage.map(entry => (
              <Row
                key={entry.shop.id}
                styles={styles}
                colors={colors}
                title={entry.shop.name}
                subtitle={describeShopCoverage(entry.itemIds.length, total)}
                progress={total > 0 ? entry.itemIds.length / total : 0}
                selected={selected.includes(entry.shop.id)}
                onPress={() => toggle(entry.shop.id)}
              />
            ))}
          </View>

          {total > 0 && (
            <View style={styles.footer}>
              <Text style={styles.footerLine}>
                {selected.length === 0
                  ? 'No store picked — the task won’t name one.'
                  : summary.covered.length === total
                    ? `${selectedNames} covers your whole list.`
                    : `${selectedNames} covers ${summary.covered.length} of ${total}.`}
              </Text>
              {summary.unknown.length > 0 && (
                <Text style={styles.footerNote}>
                  You haven’t recorded a store for {namesFor(summary.unknown)} yet, so nothing here
                  counts {summary.unknown.length === 1 ? 'it' : 'them'}.
                </Text>
              )}
            </View>
          )}

          {shops.length === 0 && (
            <View style={styles.emptyNote}>
              <Ionicons name="storefront-outline" size={iconSize.md} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                No stores yet. Name one when you finish a shop and this starts telling you which of
                them has what.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A store row: tick, name, what it covers, and a bar you can rank by eye. */
function Row({
  styles,
  colors,
  title,
  subtitle,
  progress,
  selected,
  first = false,
  onPress,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  title: string;
  subtitle: string | null;
  progress?: number;
  selected: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, !first && styles.rowDivided]}
      activeOpacity={interaction.activeOpacity}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
    >
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && <Text style={styles.rowSub}>{subtitle}</Text>}
      </View>
      {progress !== undefined && progress > 0 && (
        <View style={styles.bar}>
          <ProgressBar progress={progress} height={4} />
        </View>
      )}
    </TouchableOpacity>
  );
}

function countIn(ids: readonly string[], within: readonly string[]): number {
  const set = new Set(within);
  let n = 0;
  for (const id of ids) if (set.has(id)) n++;
  return n;
}

/** Gap items the suggested stops still wouldn't cover. */
function remaining(suggestion: readonly ShopCoverage[], gap: readonly string[]): number {
  const open = new Set(gap);
  for (const entry of suggestion) for (const id of entry.itemIds) open.delete(id);
  return open.size;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
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
    intro: { color: colors.textSecondary, fontSize: font.md, lineHeight: 21 },
    suggestion: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: colors.accent + '1A',
      borderRadius: radius.lg,
      padding: spacing.md,
      marginTop: spacing.lg,
    },
    suggestionIcon: { paddingTop: 1 },
    suggestionBody: { flex: 1, alignItems: 'flex-start' },
    suggestionTitle: {
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
      lineHeight: 21,
    },
    suggestionSub: { color: colors.textSecondary, fontSize: font.sm, marginTop: 2, lineHeight: 19 },
    suggestionAction: { marginTop: spacing.md },
    label: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textTertiary,
      letterSpacing: 0.8,
      marginTop: spacing.xl,
    },
    hint: { fontSize: font.sm, color: colors.textTertiary, marginTop: spacing.xs },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      marginTop: spacing.md,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    rowDivided: { borderTopWidth: border.hairline, borderTopColor: colors.separator },
    check: {
      width: 22,
      height: 22,
      borderRadius: radius.full,
      borderWidth: border.md,
      borderColor: colors.textTertiary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    rowText: { flex: 1 },
    rowTitle: { color: colors.text, fontSize: font.md },
    rowSub: { color: colors.textTertiary, fontSize: font.sm, marginTop: 1 },
    bar: { width: 44 },
    footer: { marginTop: spacing.lg },
    footerLine: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 19 },
    footerNote: { color: colors.textTertiary, fontSize: font.sm, marginTop: spacing.xs, lineHeight: 19 },
    emptyNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.lg,
    },
    emptyText: { flex: 1, fontSize: font.sm, color: colors.textTertiary },
  });
}
