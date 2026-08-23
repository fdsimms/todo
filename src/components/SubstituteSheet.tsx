import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { groceryNameKey } from '../utils/groceryParse';
import { describeSubstituteLink, substituteQuantity, substitutesFor } from '../utils/itemSubs';
import { parseQuantity } from '../utils/quantity';
import { scaleQuantity } from '../utils/recipeScale';
import { probablyHaveReason } from '../utils/grocerySuggest';
import type { SuggestedSubstitute } from '../utils/substituteSuggestions';
import { suggestSubstitutes, describeAIError } from '../services/aiSuggestions';
import { GROCERY_NAME_MAX_LENGTH } from '../types';
import { haptics } from '../utils/haptics';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  /** The item being stood in for — "instead of *this*". */
  itemId: string | null;
  /**
   * The substitute already recorded, when this is opened to review one. Null
   * opens the picker instead.
   */
  editingSubItemId?: string | null;
  /**
   * Apply a recorded substitute to the shopping list — the row becomes the
   * margarine, quantity converted through the link's ratio. Passed only where
   * the item is actually *on* a list (the grocery row's swap glyph); without
   * it the recorded rows are review-only, which is what the item sheet and the
   * two recipe sheets want.
   */
  onSwap?: (subItemId: string) => void;
  onClose: () => void;
}

/**
 * "What can I use instead?" — where a substitution is written and reviewed.
 *
 * The picker half is the authoring funnel the whole feature turns on. A
 * substitute is surfaced only where there's a reason to believe it would help
 * (see utils/itemSubs.ts), so links are hand-authored — and nobody
 * hand-authors data for a caption they've never seen. Asking at the moment you
 * care is what fills the table; the item sheet's field is where you *review*
 * what you already answered.
 *
 * The offline half (#1578) is a search over your own catalog that also adds —
 * always there, key or none. **Suggested** sits on top of it, behind an
 * explicit "Suggest alternatives", and is additive by construction: no key or
 * the `substitutes` AI feature off, and the section is simply absent — the app
 * can't require a key, so what remains has to be a working answer to "what
 * instead?", just not a proposed one. It used to fire on open, on the grounds
 * that opening this sheet *was* the ask; the grocery row's swap glyph landing
 * here is what ended that, since half the opens are now someone reaching for
 * an answer they already recorded.
 * Picking a suggestion mints or finds its catalog row the same way typing one
 * in does, and seeds the ratio fields when the model offered one. The two
 * lists never repeat each other — a name already in Suggested is filtered out
 * of the catalog search below it.
 *
 * **Nothing is written until Add**, the shape `GroceryAISheet` and
 * `RecipeExtractSheet` already use.
 *
 * **Already recorded** sits above both, and is why the grocery row's swap
 * glyph opens this rather than the item sheet: the glyph asks "what can I use
 * instead?", and the item sheet answered it with a 900-line editor scrolled to
 * one collapsed field. Tapping a recorded row reviews the link (the same
 * screen a host passing `editingSubItemId` lands on directly); its **Use
 * instead** applies the swap to the list, and exists only where a host passed
 * `onSwap`. Those are two readings of "tap a substitute" and they get two
 * targets — the item sheet's field, which can only mean review, keeps its
 * whole-row tap.
 */
export function SubstituteSheet({ visible, itemId, editingSubItemId = null, onSwap, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const linkItemSub = useGroceryStore(s => s.linkItemSub);
  const unlinkItemSub = useGroceryStore(s => s.unlinkItemSub);
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const apiKey = useSettingsStore(s => s.anthropicApiKey);
  const substitutesFeature = useSettingsStore(s => s.aiFeatureConfig.substitutes);

  const item = items.find(i => i.id === itemId) ?? null;

  /**
   * The recorded substitute being reviewed because it was tapped *here*, as
   * opposed to `editingSubItemId`, which is a host opening this sheet straight
   * onto one. Same screen either way — the difference is only whether the left
   * header button goes back to the list or closes the sheet.
   */
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const activeSubId = reviewingId ?? editingSubItemId;
  const editing = activeSubId !== null;

  const [query, setQuery] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [bothWays, setBothWays] = useState(false);
  const [standing, setStanding] = useState(false);
  const [ratioFrom, setRatioFrom] = useState('');
  const [ratioTo, setRatioTo] = useState('');
  const [suggested, setSuggested] = useState<SuggestedSubstitute[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestAsked, setSuggestAsked] = useState(false);

  const existing = useMemo(
    () => (itemId ? substitutesFor(itemId, itemSubs, items) : []),
    [itemId, itemSubs, items]
  );
  const editingSub = editing ? existing.find(s => s.item.id === activeSubId) ?? null : null;

  // Cleared as the sheet goes away rather than as it opens, so the seeding
  // effect below sees a settled value on open instead of running twice.
  useEffect(() => {
    if (!visible) setReviewingId(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setPickedId(activeSubId);
    // Seeded from the link being reviewed, so the fields say what's recorded
    // rather than presenting a blank form over an answer that already exists.
    setNote(editingSub?.link.note ?? '');
    setBothWays(editingSub?.isMutual ?? false);
    setStanding(editingSub?.link.standing ?? false);
    setRatioFrom(editingSub?.link.ratioFrom ?? '');
    setRatioTo(editingSub?.link.ratioTo ?? '');
    // Seeding is a one-shot on open: re-running it as the store changes would
    // wipe what's being typed the moment the write lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingSubItemId, reviewingId]);

  // Cleared whenever the sheet opens or the item changes, so a previous item's
  // proposals can't be read as this one's.
  useEffect(() => {
    setSuggested([]);
    setSuggestError(null);
    setSuggestLoading(false);
    setSuggestAsked(false);
  }, [visible, itemId]);

  // Asked for, never fired on open. This sheet is now the grocery row's swap
  // glyph as well as the authoring funnel, so opening it stopped meaning "I
  // want a proposal" — half the opens are someone reaching for the substitute
  // they recorded months ago, and every one of those was spending a request.
  // The key and the feature switch still gate it; the button is simply absent
  // without them, so "no key, no traffic" needs no second reading here.
  const handleSuggest = () => {
    if (!item) return;
    haptics.tap();
    setSuggestError(null);
    setSuggestAsked(true);
    setSuggestLoading(true);
    const excluded = [item.name, ...existing.map(s => s.item.name)];
    suggestSubstitutes(item.name, excluded)
      .then(setSuggested)
      .catch(e => setSuggestError(describeAIError(e)))
      .finally(() => setSuggestLoading(false));
  };

  const picked = items.find(i => i.id === pickedId) ?? null;

  const typed = query.trim();
  const typedKey = groceryNameKey(typed) || typed.toLowerCase();

  // What Suggested is already offering, so From your items doesn't repeat it
  // — the same two items in both sections read as a bug, not a coincidence.
  const suggestedKeys = useMemo(
    () => new Set(suggested.map(s => groceryNameKey(s.name) || s.name.toLowerCase())),
    [suggested]
  );

  // Everything already linked is out, and so is the item itself — offering
  // butter as a substitute for butter, or margarine a second time, reads as
  // the app not knowing what it already holds.
  const taken = useMemo(
    () => new Set([itemId, ...existing.map(s => s.item.id)].filter(Boolean) as string[]),
    [itemId, existing]
  );

  const results = useMemo(() => {
    if (!itemId) return [];
    const pool = items.filter(i => !taken.has(i.id) && !suggestedKeys.has(i.nameKey));
    const matches = typed
      ? pool.filter(i => i.nameKey.includes(typedKey) || i.name.toLowerCase().includes(typed.toLowerCase()))
      : pool;
    return matches.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [items, itemId, taken, typed, typedKey, suggestedKeys]);

  // The field both filters and adds, the way `KitchenScreen`'s and `PillGroup`'s
  // do: what the search can't find is exactly what you're offered the chance
  // to add, and "what about ghee" is the moment you find out ghee has no row.
  const canAdd = !!typed && !items.some(i => i.nameKey === typedKey);

  const handleAddTyped = () => {
    const created = ensureCatalogItem(typed);
    if (!created) {
      haptics.error();
      return;
    }
    haptics.success();
    setPickedId(created.id);
    setQuery('');
  };

  // Picking a suggestion mints or finds its catalog row exactly like typing
  // it in would, then seeds the ratio fields if the model offered one — a
  // suggested ratio is a starting point, not applied until Add, same as
  // everything else on this sheet.
  const handlePickSuggested = (s: SuggestedSubstitute) => {
    const created = ensureCatalogItem(s.name);
    if (!created) {
      haptics.error();
      return;
    }
    haptics.success();
    setPickedId(created.id);
    if (s.ratioFrom && s.ratioTo) {
      setRatioFrom(s.ratioFrom);
      setRatioTo(s.ratioTo);
    }
  };

  // The unit the ratio actually constrains on — named back at the user so the
  // "only applies to a recipe line measured in X" hint states the constraint
  // it's *actually* enforcing rather than a canned sentence. Null while the
  // left field hasn't produced a usable amount+unit yet.
  const fromUnit = parseQuantity(ratioFrom).rest || null;

  // Two illustrative outcomes rather than the three the mock shows for
  // garlic specifically: a believable "wrong but plausible unit" example
  // (garlic's cloves-vs-bulbs) can't be synthesized generically for whatever
  // item the user is naming a ratio for without guessing at units the way
  // every refusal rule in this app already declines to. Doubling the typed
  // `ratioFrom` itself demonstrates the arithmetic; a fixed unparseable
  // amount demonstrates the refusal — both true for any ratio, not just this
  // one's motivating example.
  const previewRows = useMemo(() => {
    if (!item || !picked || !ratioFrom.trim() || !ratioTo.trim()) return null;
    const doubled = scaleQuantity(ratioFrom, 2);
    if (!doubled.scaled) return null;

    const build = (quantity: string, label: string) => {
      const result = substituteQuantity(quantity, ratioFrom, ratioTo);
      return {
        quantity: label,
        outcome: result.converted ? `≈${result.text} ${picked.name.toLowerCase()}` : 'left as written',
        converted: result.converted,
      };
    };

    return [
      build(doubled.text, `${doubled.text} ${item.name.toLowerCase()}`),
      build('a pinch', `a pinch of ${item.name.toLowerCase()}`),
    ];
  }, [item, picked, ratioFrom, ratioTo]);

  const handleConfirm = () => {
    if (!item || !picked) return;
    linkItemSub(item.id, picked.id, { note, bothWays, ratioFrom, ratioTo, standing });
    // The reverse row is written by `bothWays` and taken back here, rather than
    // left standing: unticking it in this sheet has to mean the same thing as
    // never ticking it, or reviewing a link is a way to add one you can't undo.
    if (!bothWays && editingSub?.isMutual) unlinkItemSub(picked.id, item.id);
    haptics.success();
    onClose();
  };

  // Back out of a substitute opened from the list above, rather than out of
  // the sheet. `pickedId` is cleared alongside because it's what chooses the
  // detail branch over the picker; the seeding effect clears it too, and doing
  // it here as well is what stops a frame of the detail form on the way out.
  const handleBack = () => {
    haptics.tap();
    setReviewingId(null);
    setPickedId(null);
  };

  // "Use instead", on a substitute already recorded: the answer to the
  // question the swap glyph asks mid-shop, so the sheet has nothing left to
  // do once it's applied.
  const handleSwap = (subItemId: string) => {
    onSwap?.(subItemId);
    onClose();
  };

  const handleRemove = () => {
    if (!item || !picked) return;
    unlinkItemSub(item.id, picked.id);
    haptics.tap();
    onClose();
  };

  // Nothing to be instead *of*. The one caller always passes a live id, so this
  // is the deleted-out-from-under case rather than a state worth rendering.
  if (!item) return null;

  const renderRow = ({ item: row }: { item: typeof items[number] }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={interaction.activeOpacity}
      onPress={() => {
        haptics.tap();
        setPickedId(row.id);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Use ${row.name} instead of ${item.name}`}
    >
      <Text style={styles.rowName} numberOfLines={1}>{row.name}</Text>
      <Text style={styles.rowMeta} numberOfLines={1}>{row.aisle}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton
            label={reviewingId ? 'Back' : 'Cancel'}
            role="cancel"
            onPress={reviewingId ? handleBack : onClose}
            minWidth={64}
          />
          <Text style={styles.headerTitle} numberOfLines={1}>Instead of {item.name}</Text>
          <SheetHeaderButton
            label={editing ? 'Save' : 'Add'}
            onPress={handleConfirm}
            disabled={!picked}
            minWidth={64}
          />
        </View>

        {picked ? (
          <View style={styles.body}>
            <View style={styles.pickedRow}>
              <View style={styles.pickedBody}>
                <Text style={styles.pickedName} numberOfLines={1}>{picked.name}</Text>
                <Text style={styles.pickedMeta}>
                  Use this when there&apos;s no {item.name.toLowerCase()}.
                </Text>
              </View>
              {/* Only while picking: in review mode the substitute is what the
                  sheet is about, and changing which item a recorded link names
                  is a different link, not an edit of this one. */}
              {!editing && (
                <TouchableOpacity
                  onPress={() => {
                    haptics.tap();
                    setPickedId(null);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Pick a different item"
                >
                  <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.label}>HOW MUCH</Text>
            <View style={styles.ratioLabelRow}>
              <Text style={styles.ratioFieldLabel} numberOfLines={1}>{item.name}</Text>
              <View style={styles.ratioArrowSpacer} />
              <Text style={styles.ratioFieldLabel} numberOfLines={1}>{picked.name}</Text>
            </View>
            <View style={styles.ratioRow}>
              <TextInput
                style={[styles.input, styles.ratioInput]}
                value={ratioFrom}
                onChangeText={setRatioFrom}
                placeholder="e.g. 1/4 tsp"
                placeholderTextColor={colors.textTertiary}
                maxLength={GROCERY_NAME_MAX_LENGTH}
                accessibilityLabel={`Amount of ${item.name} this ratio is written for`}
              />
              <Ionicons name="arrow-forward" size={iconSize.sm} color={colors.textTertiary} />
              <TextInput
                style={[styles.input, styles.ratioInput]}
                value={ratioTo}
                onChangeText={setRatioTo}
                placeholder="e.g. 1 clove"
                placeholderTextColor={colors.textTertiary}
                maxLength={GROCERY_NAME_MAX_LENGTH}
                accessibilityLabel={`Equivalent amount of ${picked.name}`}
              />
            </View>
            <Text style={styles.hint}>
              {fromUnit
                // With the swap applied for you, a line the ratio can't be
                // read against isn't renamed either — see standingSwaps.ts for
                // why a swapped name over an unconverted amount is the one
                // outcome worse than leaving the line alone.
                ? standing
                  ? `Only applies to a recipe line measured in ${fromUnit}. A line measured any other way isn’t swapped.`
                  : `Only applies to a recipe line measured in ${fromUnit}. Anything else is left as written.`
                : `Optional. For a substitute that needs a different amount, not just a different name.`}
            </Text>

            <Text style={styles.label}>NOTE</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Fine for frying, not for baking"
              placeholderTextColor={colors.textTertiary}
              maxLength={GROCERY_NAME_MAX_LENGTH}
              accessibilityLabel="Note about this substitute"
            />
            <Text style={styles.hint}>
              Where a swap that only works sometimes says so — fine for frying, wrong for
              baking.
            </Text>

            <TouchableOpacity
              style={styles.toggleRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => {
                haptics.tap();
                setBothWays(v => !v);
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: bothWays }}
              accessibilityLabel="Both ways"
            >
              <Ionicons
                name={bothWays ? 'checkbox' : 'square-outline'}
                size={iconSize.md}
                color={bothWays ? colors.accent : colors.textSecondary}
              />
              <View style={styles.toggleBody}>
                <Text style={styles.toggleLabel}>Both ways</Text>
                <Text style={styles.toggleHint}>
                  Also use {item.name.toLowerCase()} when there&apos;s no {picked.name.toLowerCase()}.
                </Text>
              </View>
            </TouchableOpacity>

            {/* The standing swap (#1571) — the one substitute setting that
                changes what lands in the trolley. Below Both ways rather than
                above it: that one is about which directions are recorded, this
                one is about what the app does with the direction you're
                writing. */}
            <TouchableOpacity
              style={styles.toggleRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => {
                haptics.tap();
                setStanding(v => !v);
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: standing }}
              accessibilityLabel="Always use this instead"
            >
              <Ionicons
                name={standing ? 'checkbox' : 'square-outline'}
                size={iconSize.md}
                color={standing ? colors.accent : colors.textSecondary}
              />
              <View style={styles.toggleBody}>
                <Text style={styles.toggleLabel}>Always use this instead</Text>
                <Text style={styles.toggleHint}>
                  Recipes calling for {item.name.toLowerCase()} show and shop for{' '}
                  {picked.name.toLowerCase()}. Swapped lines say what the recipe wrote, and
                  no recipe is changed.
                </Text>
              </View>
            </TouchableOpacity>

            {/* Outcomes, not rules — showing what "3 cloves" and "a pinch" turn
                into is what should stop "the ratio doesn't work on my bulb"
                being filed as a bug, rather than stating the refusal as a
                sentence someone has to read and remember. */}
            {!!previewRows && (
              <View style={styles.previewCard}>
                <Text style={styles.label}>PREVIEW</Text>
                {previewRows.map((row, i) => (
                  <View key={i} style={styles.previewRow}>
                    <Text style={styles.previewQuantity} numberOfLines={1}>{row.quantity}</Text>
                    <Text
                      style={[styles.previewOutcome, !row.converted && styles.previewOutcomeMuted]}
                      numberOfLines={1}
                    >
                      {row.outcome}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {editing && (
              <TouchableOpacity
                style={styles.actionRow}
                activeOpacity={interaction.activeOpacity}
                onPress={handleRemove}
                accessibilityRole="button"
                accessibilityLabel="Remove this substitute"
              >
                <Ionicons name="trash-outline" size={iconSize.md} color={colors.red} />
                <View style={styles.toggleBody}>
                  <Text style={[styles.toggleLabel, { color: colors.red }]}>Remove</Text>
                  <Text style={styles.toggleHint}>
                    Forgets this swap. Neither item is deleted.
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {/* The one place the item-level model is explained, said at the
                moment it makes sense — you're about to answer for butter, and
                the answer is going to turn up in every recipe calling for it. */}
            <Text style={styles.caption}>
              Pick what you&apos;d use instead. It&apos;s saved on {item.name.toLowerCase()}, so every
              recipe calling for it can use your answer.
            </Text>

            {/* What's already recorded, before anything is proposed: the
                answer you wrote yourself outranks a suggestion, and mid-shop
                it's usually the only section that matters. Rows, not pills,
                for the reason the item sheet's field is rows — a substitute
                carries a note and a direction, and a pill can only express
                membership. */}
            {existing.length > 0 && (
              <View style={styles.recordedSection}>
                <Text style={styles.label}>ALREADY RECORDED</Text>
                {existing.map(sub => {
                  const meta = describeSubstituteLink(sub, probablyHaveReason(sub.item, new Date()));
                  return (
                    <View key={sub.item.id} style={styles.recordedRow}>
                      <TouchableOpacity
                        style={styles.recordedBody}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => {
                          haptics.tap();
                          setReviewingId(sub.item.id);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${sub.item.name}${meta ? `, ${meta}` : ''}`}
                        accessibilityHint="Opens this substitute, where you can edit or remove it"
                      >
                        <Text style={styles.rowName} numberOfLines={1}>{sub.item.name}</Text>
                        {!!meta && <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>}
                      </TouchableOpacity>
                      {/* Only where the item is on a list to be swapped — see
                          the `onSwap` prop. The tap target for reviewing the
                          link is the row body beside it, so the two readings
                          of "tap a substitute" don't share one target. */}
                      {!!onSwap && (
                        <InlineAction
                          label="Use instead"
                          icon="swap-horizontal"
                          onPress={() => handleSwap(sub.item.id)}
                          accessibilityLabel={`Put ${sub.item.name} on the list instead of ${item.name}`}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* AI is additive, never required: absent with no key or the
                feature off, and never the only way to answer even when it's
                there. Behind a tap rather than fired on open, because this
                sheet is the swap glyph's destination now — see handleSuggest. */}
            {!!apiKey && !!substitutesFeature?.enabled && (
              <View style={styles.suggestedSection}>
                {suggested.length > 0 ? (
                  <>
                    <Text style={styles.label}>SUGGESTED</Text>
                    {suggested.map(s => {
                      const resolvedKey = groceryNameKey(s.name) || s.name.toLowerCase();
                      const resolved = items.find(it => it.nameKey === resolvedKey);
                      const onHand = resolved ? probablyHaveReason(resolved, new Date()) : null;
                      return (
                        <TouchableOpacity
                          key={s.name}
                          style={styles.row}
                          activeOpacity={interaction.activeOpacity}
                          onPress={() => handlePickSuggested(s)}
                          accessibilityRole="button"
                          accessibilityLabel={`Use ${s.name} instead of ${item.name}`}
                        >
                          <Text style={styles.rowName} numberOfLines={1}>{s.name}</Text>
                          {!!s.ratioFrom && !!s.ratioTo && (
                            <Text style={styles.rowMeta} numberOfLines={1}>
                              {s.ratioFrom} → {s.ratioTo}
                            </Text>
                          )}
                          {!!onHand && (
                            <Text style={styles.rowMeta} numberOfLines={1}>
                              {onHand}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                ) : (
                  <View style={styles.suggestAsk}>
                    {!!suggestError && <Text style={styles.suggestError}>{suggestError}</Text>}
                    {/* An answered ask that came back empty says so, rather than
                        leaving a button that looks like it did nothing. */}
                    {suggestAsked && !suggestLoading && !suggestError && (
                      <Text style={styles.suggestError}>
                        Nothing to suggest for {item.name.toLowerCase()}.
                      </Text>
                    )}
                    {suggestLoading ? (
                      <ActivityIndicator style={styles.suggestSpinner} color={colors.textTertiary} />
                    ) : (
                      <InlineAction
                        label="Suggest alternatives"
                        icon="sparkles-outline"
                        tint={colors.purple}
                        onPress={handleSuggest}
                        accessibilityLabel={`Suggest what to use instead of ${item.name}`}
                      />
                    )}
                  </View>
                )}
              </View>
            )}

            <View style={styles.searchWrap}>
              <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                placeholder="Find or add an item…"
                placeholderTextColor={colors.textTertiary}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType={canAdd ? 'done' : 'search'}
                onSubmitEditing={canAdd ? handleAddTyped : undefined}
                accessibilityLabel="Find an item, or type a name to add it"
              />
            </View>

            {canAdd && (
              <View style={styles.addWrap}>
                <InlineAction
                  label={`Add “${typed}”`}
                  icon="add"
                  onPress={handleAddTyped}
                  accessibilityLabel={`Add ${typed} to your items`}
                />
              </View>
            )}

            <FlatList
              data={results}
              keyExtractor={row => row.id}
              renderItem={renderRow}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={results.length === 0 ? styles.emptyContainer : styles.list}
              ListEmptyComponent={
                <EmptyState
                  icon="swap-horizontal-outline"
                  title={typed ? 'Nothing matches' : 'Nothing to pick from yet'}
                  subtitle={
                    typed
                      ? 'Nothing in your items goes by that name. Add it above.'
                      : 'Type a name above to add something you’d use instead.'
                  }
                />
              }
            />

            {/* The refusal, stated where someone will actually wonder about it:
                "buttermilk → milk + lemon juice" is two items both required,
                which is a recipe rather than a swap. */}
            <Text style={styles.footnote}>
              Swaps needing a second ingredient aren&apos;t offered — those are a recipe, not a
              substitute.
            </Text>
          </>
        )}
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
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    caption: {
      color: colors.textSecondary,
      fontSize: font.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
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
    // No lineHeight on a TextInput — RN maps it onto the iOS paragraph style
    // with no compensating baseline offset, so the glyphs sit low in the field
    // while the caret stays centered.
    search: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: spacing.sm + 2 },
    addWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.md, alignItems: 'flex-start' },
    list: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },
    emptyContainer: { flexGrow: 1, paddingHorizontal: spacing.md },
    row: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      marginBottom: spacing.sm,
    },
    rowName: { color: colors.text, fontSize: font.md },
    rowMeta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    recordedSection: { paddingHorizontal: spacing.md },
    recordedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      marginBottom: spacing.sm,
    },
    recordedBody: { flex: 1 },
    suggestedSection: { paddingHorizontal: spacing.md },
    // The label carries the top margin when there are results; without one
    // this block is the first thing under the section above and needs its own.
    suggestAsk: { marginTop: spacing.lg, alignItems: 'flex-start' },
    suggestSpinner: { marginBottom: spacing.sm },
    suggestError: { color: colors.textTertiary, fontSize: font.sm, marginBottom: spacing.sm },
    footnote: {
      color: colors.textTertiary,
      fontSize: font.xs,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.lg,
    },
    body: { padding: spacing.md },
    pickedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    pickedBody: { flex: 1 },
    pickedName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    pickedMeta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    input: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: font.md,
      color: colors.text,
    },
    hint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm },
    // Mirrors ratioRow's layout exactly (same flex/gap/spacer width) so each
    // label sits directly above the box it names, rather than a floating
    // caption — the arrow icon has no label of its own, hence the spacer.
    ratioLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
    ratioFieldLabel: { flex: 1, color: colors.textTertiary, fontSize: font.xs },
    ratioArrowSpacer: { width: iconSize.sm },
    ratioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    // bgTertiary rather than the note field's bgSecondary — a step down, to
    // read as a pair of small numeric fields rather than a paragraph field.
    ratioInput: { flex: 1, backgroundColor: colors.bgTertiary },
    previewCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.lg,
    },
    previewRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    previewQuantity: { flex: 1, color: colors.text, fontSize: font.sm },
    // Accent, not textTertiary — a working conversion is the answer someone
    // opened this sheet for, so it should read at the same weight as the
    // quantity naming it.
    previewOutcome: { flexShrink: 1, color: colors.accent, fontSize: font.sm, textAlign: 'right' },
    // Refused lines recede so the working case reads first, the same call the
    // issue's own preview mock makes.
    previewOutcomeMuted: { color: colors.textTertiary },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    toggleBody: { flex: 1 },
    toggleLabel: { color: colors.text, fontSize: font.md },
    toggleHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginTop: spacing.lg,
    },
  });
}
