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
  /**
   * "I'm at this store, now" — a different verb from onCreate, which plans a
   * trip for later. One shop, never a list: you can only stand in one.
   */
  onStart: (shop: Shop) => void;
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
 * **Every number here is a floor, and the copy has to keep saying so.** The
 * app knows where you've *bought* things, which is not the same as what a shop
 * stocks, so a store with nothing recorded against your list is a store you
 * haven't shopped that way — not a store without bread. That's why no string
 * in this file asserts an absence: rows say "seen here", the gap card says
 * these items "haven't come from" the store before, and the total says "at
 * least". The footnote under the list says so plainly, because a ranking that
 * looks authoritative is exactly the one worth undercutting — and the
 * correction flow below is where a hedge gets answered, by the only party who
 * can: "Actually, it has more" writes what the user knows, rather than the app
 * inferring it.
 *
 * **One kind of line here does assert an absence**, and only because the user
 * asserted it first: an item they marked as not stocked when they finished a
 * shop there (`ItemShopLink.unavailableAt`). Those come through as
 * `TripSummary.missing`, are never softened into "you haven't got it here
 * before", and are the strongest reason the sheet has to propose a second stop
 * — they're the one thing on the list this trip definitely won't come back
 * with. The correction mode lists them too, unticked, so changing your mind
 * stays one tap away.
 *
 * No store stays a real answer, same as `FinishShoppingSheet`: it's a row of
 * its own rather than a cancel, and it makes exactly the task this button made
 * before any of this existed.
 */
export function ShoppingTripSheet({ visible, onClose, onCreate, onStart }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const shops = useGroceryStore(useShallow(s => s.shops));
  const lastShopId = useGroceryStore(s => s.lastShopId);

  const plan = useMemo(() => planTrip(items, itemShops, shops), [items, itemShops, shops]);
  const total = plan.itemIds.length;

  const linkItemShopMany = useGroceryStore(s => s.linkItemShopMany);

  // Selection order is task order, so it's an array rather than a Set.
  const [selected, setSelected] = useState<string[]>([]);
  // The store whose record is being corrected, if any — the sheet's second
  // mode. A mode rather than a nested sheet or an expanding card: the list of
  // things to tick is as long as the trip is, so it wants the whole height,
  // and a sheet over a sheet is a stack of two dismiss gestures.
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);

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
    setCorrecting(null);
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

  // The one store a "start shopping" offer could name, or null. Resolved from
  // live shops rather than trusted, same as handleCreate does.
  const startable = useMemo(
    () => (selected.length === 1 ? shops.find(s => s.id === selected[0]) ?? null : null),
    [selected, shops]
  );

  /**
   * The correction, and the reason this sheet can afford to be uncertain out
   * loud: "at least 9 of 12" invites "no, it has the other three too", and
   * without somewhere to say that, the hedging is just the app being vague at
   * you. What it writes is the ordinary hand-assertion the item sheet already
   * writes — a link with no purchase behind it — so the trip's numbers move
   * the moment it's saved, and everywhere else that reads the links agrees.
   *
   * Only the store's *missing* items are listed, so this can only ever add.
   * Taking a wrong link back off stays where it already lives, in the item
   * sheet's own store picker: a bulk gesture that silently unlinks is how you
   * lose a filing you made months ago and never notice.
   */
  const correctingShop = correcting ? (shops.find(s => s.id === correcting) ?? null) : null;
  const correctingEntry = correcting
    ? (plan.coverage.find(c => c.shop.id === correcting) ?? null)
    : null;
  const candidates = useMemo(() => {
    if (!correctingEntry) return [];
    const known = new Set(correctingEntry.itemIds);
    return plan.itemIds.filter(id => !known.has(id));
  }, [correctingEntry, plan]);
  // Rows in that list the user has already answered for — shown, labelled, and
  // left unticked. Ticking one is how you say the store has it after all, and
  // linkItemShopMany takes the "not stocked" off when it writes.
  const correctingAbsent = useMemo(
    () => new Set(correctingEntry?.unavailableItemIds ?? []),
    [correctingEntry]
  );

  const startCorrection = (shopId: string) => {
    const entry = plan.coverage.find(c => c.shop.id === shopId);
    const known = new Set(entry?.itemIds ?? []);
    const absent = new Set(entry?.unavailableItemIds ?? []);
    haptics.tap();
    // Everything pre-ticked: the button that got here said the store has more
    // than the app thinks, so the work left is unticking the exceptions.
    // Everything, that is, except what the user themselves marked as not
    // stocked here — those are listed (this is a fine place to change your
    // mind) but never pre-ticked, or Save would quietly undo a deliberate
    // answer they gave at the checkout.
    setTicked(plan.itemIds.filter(id => !known.has(id) && !absent.has(id)));
    setCorrecting(shopId);
  };

  const saveCorrection = () => {
    if (!correcting) return;
    if (ticked.length > 0) {
      linkItemShopMany(ticked, correcting);
      haptics.success();
    }
    setCorrecting(null);
  };

  // The one store a correction could be about. With several picked there's no
  // answer to "which of them has it", and guessing is the thing this sheet is
  // for not doing.
  const correctable =
    selected.length === 1
      ? (plan.coverage.find(c => c.shop.id === selected[0] && c.itemIds.length < total) ?? null)
      : null;

  const next = summary.suggestion;
  const gapGain = next.length > 0 ? countIn(next[0].itemIds, summary.gap) : 0;
  const missingGain = next.length > 0 ? countIn(next[0].itemIds, summary.missing) : 0;
  const withoutBrandGain = next.length > 0 ? countIn(next[0].itemIds, summary.withoutBrand) : 0;
  // What the whole suggested itinerary would come to — everything already
  // covered, plus the gap it closes.
  const plannedTotal =
    summary.covered.length + summary.gap.length - remaining(next, summary.gap);

  const selectedNames = joinNames(
    selected.map(id => shops.find(s => s.id === id)?.name ?? '').filter(Boolean)
  );

  const addLabel = selected.length > 1 ? `Add ${selected.length}` : 'Add';

  if (correctingShop) {
    const known = correctingEntry?.itemIds.length ?? 0;
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCorrecting(null)}
      >
        <View style={styles.root}>
          <View style={styles.header}>
            <SheetHeaderButton
              label="Back"
              role="cancel"
              onPress={() => setCorrecting(null)}
              minWidth={72}
            />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {correctingShop.name}
            </Text>
            <SheetHeaderButton label="Save" onPress={saveCorrection} minWidth={72} />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.intro}>
              Check off what you can get at {correctingShop.name}. It’s filed against the store for next
              time, and this trip’s numbers update as soon as you save.
            </Text>
            {known > 0 && (
              <Text style={styles.hint}>
                {known} {known === 1 ? 'item is' : 'items are'} already recorded there, so{' '}
                {known === 1 ? "it isn't" : "they aren't"} listed here.
              </Text>
            )}

            <View style={styles.card}>
              {candidates.map((id, i) => (
                <Row
                  key={id}
                  first={i === 0}
                  styles={styles}
                  colors={colors}
                  title={nameOf.get(id) ?? 'an item'}
                  subtitle={
                    correctingAbsent.has(id) ? 'You marked this as not stocked here' : null
                  }
                  selected={ticked.includes(id)}
                  onPress={() => {
                    haptics.tap();
                    setTicked(prev =>
                      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                    );
                  }}
                />
              ))}
            </View>

            <Text style={styles.footerNote}>
              This records that the store has them, not that you’ve bought them there — so it
              counts towards what a trip covers without pretending to be history. To take one back
              off, open the item and use its store list.
            </Text>
          </ScrollView>
        </View>
      </Modal>
    );
  }

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
                      You’ve got {next[0].itemIds.length} of these {total} at {next[0].shop.name}{' '}
                      before — more than anywhere else.
                    </Text>
                    {next.length > 1 && (
                      <Text style={styles.suggestionSub}>
                        With {joinNames(next.slice(1).map(s => s.shop.name))} too, that’s{' '}
                        {plannedTotal} of {total}.
                      </Text>
                    )}
                  </>
                ) : summary.missing.length > 0 ? (
                  <>
                    {/* The one card here that states an absence outright, and
                        it can, because it's quoting the user back to them:
                        these are items they marked as not stocked when they
                        finished a shop there. */}
                    <Text style={styles.suggestionTitle}>
                      {selectedNames} {selected.length > 1 ? 'don’t' : 'doesn’t'} have{' '}
                      {namesFor(summary.missing)}.
                    </Text>
                    <Text style={styles.suggestionSub}>
                      {missingGain > 0
                        ? `${next[0].shop.name} has ${
                            missingGain === summary.missing.length
                              ? summary.missing.length === 1
                                ? 'it'
                                : 'them all'
                              : `${missingGain} of them`
                          }.`
                        : // Nothing suggested closes the marked items, so the
                          // stop is worth making for the rest of the gap
                          // instead — the greedy walk only ever picks a store
                          // that covers something on record.
                          `${next[0].shop.name} doesn’t, but it has ${gapGain} of the rest.`}
                    </Text>
                  </>
                ) : summary.withoutBrand.length > 0 ? (
                  <>
                    {/* Also quoting the user back to them, and also allowed to
                        be flat about it — but it is a different claim from the
                        card above and has to read as one. The shop has the
                        thing; it hasn't got the one that was asked for, and
                        saying "doesn't have it" here would be false. */}
                    <Text style={styles.suggestionTitle}>
                      {selectedNames} {selected.length > 1 ? 'haven’t' : 'hasn’t'} got your brand of{' '}
                      {namesFor(summary.withoutBrand)}.
                    </Text>
                    <Text style={styles.suggestionSub}>
                      {withoutBrandGain > 0
                        ? `${next[0].shop.name} has ${
                            withoutBrandGain === summary.withoutBrand.length
                              ? summary.withoutBrand.length === 1
                                ? 'yours'
                                : 'all of yours'
                              : `${withoutBrandGain} of them`
                          }.`
                        : `${next[0].shop.name} doesn’t, but it has ${gapGain} of the rest.`}
                    </Text>
                  </>
                ) : (
                  <>
                    {/* A fact about your history, not about the shop's shelves:
                        the app has no idea whether the selected store stocks
                        these, only that you've never got them there. */}
                    <Text style={styles.suggestionTitle}>
                      {capitalize(namesFor(summary.gap))}{' '}
                      {summary.gap.length === 1 ? 'hasn’t' : 'haven’t'} come from {selectedNames}{' '}
                      before.
                    </Text>
                    {/* Reached only when there's a gap and nothing marked as
                        not stocked, and the walk only suggests a store that
                        covers some of it — so this count is never zero. */}
                    <Text style={styles.suggestionSub}>
                      {`${next[0].shop.name} has ${
                        gapGain === summary.gap.length
                          ? summary.gap.length === 1
                            ? 'it'
                            : 'them all'
                          : `${gapGain} of them`
                      }.`}
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
              ? 'In your own order. There’s nothing on the list to rank them by.'
              : 'Ranked by what you’ve bought where. Pick as many as the trip needs.'}
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
                subtitle={describeShopCoverage(entry, total)}
                progress={total > 0 ? entry.itemIds.length / total : 0}
                selected={selected.includes(entry.shop.id)}
                onPress={() => toggle(entry.shop.id)}
              />
            ))}
          </View>

          {/* The other verb. The confirm in the header plans a trip — a task
              for Today, possibly for tomorrow — and this says you're standing
              in the place right now, which is what lets the list start naming
              stores. Offered only for a single pick, because that's the only
              selection the claim can be true of; a two-stop plan is still a
              plan, and you start the trip when you get to the first one. */}
          {startable && (
            <>
              <Text style={styles.label}>SHOPPING NOW?</Text>
              <Text style={styles.hint}>
                Sets the store you’re at. Your list will say when something isn’t one you
                usually get there.
              </Text>
              <InlineAction
                label={`Start shopping at ${startable.name}`}
                icon="storefront-outline"
                onPress={() => onStart(startable)}
                style={styles.startAction}
              />
            </>
          )}

          {total > 0 && (
            <View style={styles.footer}>
              {/* "At least" is the whole disclaimer in one word, and it needs
                  to sit on the number the sheet states most loudly: a store
                  may perfectly well have the other three, the app just has no
                  way to know. */}
              <Text style={styles.footerLine}>
                {selected.length === 0
                  ? 'No store picked. The task won’t name one.'
                  : summary.covered.length === total
                    ? `${selectedNames} covers your whole list.`
                    : `${selectedNames} covers at least ${summary.covered.length} of ${total}.`}
              </Text>
              {summary.missing.length > 0 && (
                // Stated flatly, unlike every other line in this footer: this
                // one is the user's own answer from a finished shop, not the
                // app reading absence as evidence.
                <Text style={styles.footerNote}>
                  You’ve marked {namesFor(summary.missing)} as not stocked{' '}
                  {selected.length > 1 ? 'at those stores' : `at ${selectedNames}`}, so{' '}
                  {summary.missing.length === 1 ? 'it needs' : 'they need'} another stop.
                </Text>
              )}
              {summary.withoutBrand.length > 0 && (
                <Text style={styles.footerNote}>
                  You’ve marked {namesFor(summary.withoutBrand)} as the wrong brand here, so{' '}
                  {summary.withoutBrand.length === 1 ? 'it needs' : 'they need'} another stop.
                </Text>
              )}
              {summary.unknown.length > 0 && (
                <Text style={styles.footerNote}>
                  Nothing’s on record about {namesFor(summary.unknown)} anywhere, so no store here
                  gets credit for {summary.unknown.length === 1 ? 'it' : 'them'}.
                </Text>
              )}
              {/* The reply to "at least", sitting directly under it. A hedge
                  with nowhere to answer it is just the app being vague at you —
                  this is where the user gets to be the authority on their own
                  shops, and the numbers above move the moment they are. */}
              {correctable && (
                <InlineAction
                  label="Actually, it has more"
                  icon="pricetag-outline"
                  variant="neutral"
                  surface="page"
                  onPress={() => startCorrection(correctable.shop.id)}
                  accessibilityLabel={`Record what else ${correctable.shop.name} has`}
                  style={styles.correctAction}
                />
              )}
              <Text style={styles.footerNote}>
                These counts are only what you’ve bought or noted — a store may well carry more.
              </Text>
            </View>
          )}

          {shops.length === 0 && (
            <View style={styles.emptyNote}>
              <Ionicons name="storefront-outline" size={iconSize.md} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                No stores yet. Name one when you finish a trip and this starts telling you which of
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
        // One fill, and only ever what's on record here: a bar you can rank
        // the stores by at a glance. It used to carry a second faded segment
        // for the aisle guess, which is gone — see shoppingTrip.ts.
        <View style={styles.bar}>
          <View style={[styles.barFill, { flex: clamp(progress) }]} />
          <View style={{ flex: Math.max(0, 1 - clamp(progress)) }} />
        </View>
      )}
    </TouchableOpacity>
  );
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
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
    startAction: { alignSelf: 'flex-start', marginTop: spacing.xs },
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
    bar: {
      width: 44,
      height: 4,
      flexDirection: 'row',
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
      overflow: 'hidden',
    },
    barFill: { backgroundColor: colors.accent },
    // Same hue, half-present — a guess reading as a quieter version of the
    // fact it sits next to, rather than as a different measurement.
    footer: { marginTop: spacing.lg },
    // alignSelf rather than aligning the whole footer: the notes around it are
    // full-width paragraphs and must keep wrapping at the sheet's width.
    correctAction: { alignSelf: 'flex-start', marginTop: spacing.md, marginBottom: spacing.sm },
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
