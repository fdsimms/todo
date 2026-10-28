import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { useGroceryStore } from '../store/useGroceryStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import { kitchenInventory } from '../utils/kitchenInventory';
import { groceryNameKey } from '../utils/groceryParse';
import { dayKeyToDate } from '../utils/dateUtils';
import {
  blankChoices,
  defaultBlankPicks,
  lastBlankFill,
  needsUsing,
  togglePick,
  type BlankCandidate,
} from '../utils/blankPicker';
import {
  blankFillOf,
  describeBlankFills,
  describeBlankRule,
  fillBlank,
  recipeBlanksIn,
  shareOfBlank,
  withBlankFill,
} from '../utils/recipeBlanks';
import { entryResolution } from '../utils/recipeComponents';
import { GROCERY_NAME_MAX_LENGTH, GROCERY_QUANTITY_MAX_LENGTH, type MealPlanEntry, type Recipe, type RecipeBlank, type RecipeOverride } from '../types';
import { BUTTON_LABEL } from '../copy/shared';

/**
 * What the picker needs to know about the cooking it fills: a planned meal, or
 * cook mode's own (which has no entry, so it stands one in).
 */
export type BlankPickerSubject = Pick<MealPlanEntry, 'id' | 'recipeId' | 'date' | 'recipeOverrides'>
  & Partial<Pick<MealPlanEntry, 'recipeChoices'>>;

interface Props {
  visible: boolean;
  /** The meal being filled. Read live; the sheet holds the last one while it slides away. */
  entry: BlankPickerSubject | null;
  recipe: Recipe | null;
  recipesById: ReadonlyMap<string, Recipe>;
  /** The meal's whole new list of overrides, with each blank's fill in it. */
  onSave: (overrides: RecipeOverride[]) => void;
  onClose: () => void;
}

/** Per blank: the names picked, and any share changed by hand (keyed by catalog key). */
interface Picks {
  names: Record<string, string[]>;
  amounts: Record<string, Record<string, string>>;
}

/**
 * Picks what fills a planned meal's blanks (`RecipeBlank`) from the kitchen.
 *
 * Each blank offers what the pantry vouches for of its kind first, most urgent
 * first, then the recipe's suggestions and what's usually bought
 * (`blankChoices`). What needs using starts picked (`defaultBlankPicks`), but
 * nothing is written until Done, so it stages and carries the discard guard.
 * A thing past its use-by isn't offered as a pick: it asks whether it's still
 * there, which is answered to the pantry straight away (the same answer the
 * pantry review deck writes) since it's true whether or not this meal is saved.
 *
 * Only what the kitchen has shows at first. The recipe's suggestions and the
 * usual buys sit behind "Suggestions to buy", except those already picked.
 * Long-pressing a chip offers to stop the blank offering it
 * (`RecipeBlank.excluded`), saved on the recipe straight away like the pantry
 * answers.
 */
export function BlankPickerSheet({ visible, entry: liveEntry, recipe: liveRecipe, recipesById, onSave, onClose }: Props) {
  const entry = useSheetSubject(liveEntry);
  const recipe = useSheetSubject(liveRecipe);
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const items = useGroceryStore(s => s.items);
  const itemProducts = useGroceryStore(s => s.itemProducts);
  const nonFoodAisles = useGroceryStore(s => s.nonFoodAisles);
  const answerPantryReview = useGroceryStore(s => s.answerPantryReview);
  const updateBlank = useRecipeStore(s => s.updateBlank);
  const entries = useMealPlanStore(s => s.entries);

  // Only the blanks this cooking's picks keep: one on the side of an either/or
  // it isn't cooking would be pre-picked and saved with nobody choosing it.
  const blanks = useMemo(
    () => (recipe
      ? recipeBlanksIn(recipe, recipesById, entryResolution(
        entry && { recipeChoices: entry.recipeChoices ?? [], recipeOverrides: entry.recipeOverrides },
      ))
      : []),
    [recipe, recipesById, entry?.recipeChoices, entry?.recipeOverrides],
  );
  const kitchen = useMemo(() => kitchenInventory(items, [], new Date(), itemProducts), [items, itemProducts]);
  const last = useMemo(() => (entry ? lastBlankFill(entries, entry) : null), [entries, entry]);

  const [picks, setPicks] = useState<Picks>({ names: {}, amounts: {} });
  // Past-use-by things the person said are still there, this visit only: the
  // pantry answer is written, but its use-by may still read as past.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  // Blanks whose "suggestions to buy" are showing. Closed on each open, since
  // the picker starts from what the kitchen has.
  const [buyOpen, setBuyOpen] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [addText, setAddText] = useState('');
  const [amountsOpen, setAmountsOpen] = useState<string | null>(null);
  const [refusedFor, setRefusedFor] = useState<string | null>(null);
  const opened = useRef('');

  const choicesFor = (blank: RecipeBlank, names: readonly string[]) =>
    blankChoices(blank, items, kitchen, nonFoodAisles, names);

  // Seeded on each open: what the meal already filled, else what needs using.
  useEffect(() => {
    if (!visible || !entry) return;
    const seed: Picks = { names: {}, amounts: {} };
    for (const { blank } of blanks) {
      const filled = blankFillOf(entry.recipeOverrides, blank.id);
      if (filled.length > 0) {
        seed.names[blank.id] = filled.map(l => l.name);
        const share = shareOfBlank(blank.quantity, filled.length);
        const edited: Record<string, string> = {};
        for (const line of filled) if (line.quantity !== share) edited[line.nameKey] = line.quantity;
        seed.amounts[blank.id] = edited;
      } else {
        seed.names[blank.id] = defaultBlankPicks(blank, choicesFor(blank, []));
        seed.amounts[blank.id] = {};
      }
    }
    opened.current = JSON.stringify(seed);
    setPicks(seed);
    setKept(new Set());
    setBuyOpen(new Set());
    setAdding(null);
    setAddText('');
    setAmountsOpen(null);
    setRefusedFor(null);
    // Seeded on the open only: a store write mid-pick must not undo the picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry?.id]);

  const dirty = JSON.stringify(picks) !== opened.current;

  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose);
  };

  const built = useMemo(() => {
    let next = entry?.recipeOverrides ?? [];
    for (const { blank } of blanks) {
      const amounts = new Map(Object.entries(picks.amounts[blank.id] ?? {}));
      next = withBlankFill(next, blank.id, fillBlank(blank, picks.names[blank.id] ?? [], amounts));
    }
    return next;
  }, [entry, blanks, picks]);

  const handleDone = () => {
    haptics.success();
    onSave(built);
    onClose();
  };

  const toggle = (blank: RecipeBlank, name: string) => {
    const current = picks.names[blank.id] ?? [];
    const { picks: next, refused } = togglePick(blank, current, name);
    if (refused) {
      haptics.warning();
      setRefusedFor(blank.id);
      return;
    }
    haptics.tap();
    setRefusedFor(null);
    setPicks(p => ({ ...p, names: { ...p.names, [blank.id]: next } }));
  };

  const useLast = () => {
    if (!last) return;
    haptics.tap();
    const names: Record<string, string[]> = { ...picks.names };
    const amounts: Record<string, Record<string, string>> = { ...picks.amounts };
    for (const { blank } of blanks) {
      const filled = blankFillOf(last.recipeOverrides, blank.id);
      if (filled.length === 0) continue;
      names[blank.id] = filled.map(l => l.name);
      amounts[blank.id] = {};
    }
    setPicks({ names, amounts });
  };

  const submitAdd = (blank: RecipeBlank) => {
    const name = addText.trim();
    setAdding(null);
    setAddText('');
    if (!name) return;
    const current = picks.names[blank.id] ?? [];
    if (current.some(n => groceryNameKey(n) === groceryNameKey(name))) return;
    toggle(blank, name);
  };

  /** Long-press: stop this blank offering `candidate`, saved on the recipe the blank sits on. */
  const confirmExclude = (blank: RecipeBlank, owner: Recipe, candidate: BlankCandidate) => {
    haptics.warning();
    Alert.alert(
      `Never offer ${candidate.name}?`,
      `It won’t show up as a choice for ${blank.label}. You can still add it with Other, and bring it back from the blank’s settings in the recipe.`,
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: 'Never offer',
          style: 'destructive',
          onPress: () => {
            updateBlank(owner.id, blank.id, { excluded: [...blank.excluded, candidate.name] });
            // An exclusion that left the pick standing would keep showing it as a chip.
            const key = groceryNameKey(candidate.name);
            setPicks(p => ({
              ...p,
              names: { ...p.names, [blank.id]: (p.names[blank.id] ?? []).filter(n => groceryNameKey(n) !== key) },
            }));
          },
        },
      ],
    );
  };

  const setAmount = (blank: RecipeBlank, nameKey: string, text: string) => {
    setPicks(p => ({ ...p, amounts: { ...p.amounts, [blank.id]: { ...(p.amounts[blank.id] ?? {}), [nameKey]: text } } }));
  };

  if (!entry || !recipe) return null;

  // What the picks would cost a trip: anything not vouched for by the kitchen.
  const inKitchen = new Set<string>();
  const sections = blanks.map(({ blank, recipe: owner }) => {
    const names = picks.names[blank.id] ?? [];
    const choices = choicesFor(blank, names);
    const keptStale = choices.stale.filter(c => kept.has(c.nameKey));
    const offered = [...choices.kitchen, ...keptStale.map(c => ({ ...c, source: 'kitchen' as const }))];
    for (const c of offered) inKitchen.add(c.nameKey);
    // Things to buy stay out of sight until asked for, except what is picked:
    // a pick has to show or there is no way to take it off.
    const buyShown = buyOpen.has(blank.id);
    const toBuyChoices = choices.others;
    const others = toBuyChoices.filter(c => buyShown || names.some(n => groceryNameKey(n) === c.nameKey));
    return { blank, owner, names, offered, others, hiddenToBuy: toBuyChoices.length - others.length, stale: choices.stale.filter(c => !kept.has(c.nameKey)) };
  });
  const allPicked = sections.flatMap(s => s.names);
  const toBuy = allPicked.filter(n => !inKitchen.has(groceryNameKey(n))).length;
  const lastFill = last ? describeBlankFills(recipe, recipesById, last.recipeOverrides) : null;

  const renderChip = (blank: RecipeBlank, owner: Recipe, candidate: BlankCandidate, selected: boolean) => {
    const fromKitchen = candidate.source === 'kitchen';
    return (
      <TouchableOpacity
        key={candidate.nameKey}
        style={[styles.chip, !fromKitchen && styles.chipToBuy, selected && styles.chipOn]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => toggle(blank, candidate.name)}
        onLongPress={() => confirmExclude(blank, owner, candidate)}
        delayLongPress={interaction.delayLongPress}
        accessibilityActions={[{ name: 'exclude', label: `Never offer ${candidate.name}` }]}
        onAccessibilityAction={() => confirmExclude(blank, owner, candidate)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${blank.label}: ${candidate.name}, ${fromKitchen
          ? (needsUsing(candidate) ? 'in your kitchen, use soon' : 'in your kitchen')
          : 'not in your kitchen'}`}
      >
        {fromKitchen && (
          <View style={[styles.dot, needsUsing(candidate) && styles.dotSoon, selected && styles.dotOnFill]} />
        )}
        <Text style={[styles.chipText, selected && styles.chipTextOn]}>{candidate.name}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SheetModal
      name="BlankPickerSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={[styles.root, { paddingTop: spacing.md }]}>
        <SheetHeader
          title={recipe.name}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={handleDone} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.scroll}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {!!last && !!lastFill && (
            <View style={styles.lastCard}>
              <Text style={styles.lastLabel}>Last time ({format(dayKeyToDate(last.date), 'MMM d')})</Text>
              <Text style={styles.lastText}>{lastFill}</Text>
              <View style={styles.lastAction}>
                <InlineAction label="Use these again" icon="refresh" variant="neutral" surface="card" onPress={useLast} />
              </View>
            </View>
          )}

          {sections.map(({ blank, owner, names, offered, others, hiddenToBuy, stale }) => {
            const keys = new Set(names.map(groceryNameKey));
            const share = shareOfBlank(blank.quantity, names.length);
            return (
              <View key={blank.id} style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionLabel}>{blank.label}</Text>
                  <Text style={styles.sectionRule}>{describeBlankRule(blank.max)}</Text>
                </View>

                <View style={styles.chips}>
                  {offered.map(c => renderChip(blank, owner, c, keys.has(c.nameKey)))}
                  {others.map(c => renderChip(blank, owner, c, keys.has(c.nameKey)))}
                  {adding !== blank.id && (
                    <InlineAction
                      label="Other"
                      icon="add"
                      variant="neutral"
                      onPress={() => { setAdding(blank.id); setAddText(''); }}
                      accessibilityLabel={`Add something else to ${blank.label}`}
                    />
                  )}
                </View>
                {(hiddenToBuy > 0 || buyOpen.has(blank.id)) && (
                  <View style={styles.buyToggle}>
                    <InlineAction
                      label={buyOpen.has(blank.id) ? 'Hide suggestions to buy' : `Suggestions to buy (${hiddenToBuy})`}
                      icon={buyOpen.has(blank.id) ? 'chevron-up' : 'cart-outline'}
                      variant="neutral"
                      onPress={() => setBuyOpen(open => {
                        const next = new Set(open);
                        if (next.has(blank.id)) next.delete(blank.id); else next.add(blank.id);
                        return next;
                      })}
                    />
                  </View>
                )}
                {offered.length === 0 && others.length === 0 && (
                  <HelpText style={styles.hint}>
                    {hiddenToBuy > 0
                      ? 'Nothing in your kitchen counts as this yet. Show suggestions to buy, or add what you’re using with Other.'
                      : 'Nothing in your kitchen or your usual shop counts as this yet. Add what you’re using with Other.'}
                  </HelpText>
                )}

                {adding === blank.id && (
                  <TextField
                    style={styles.input}
                    value={addText}
                    onChangeText={setAddText}
                    onSubmitEditing={() => submitAdd(blank)}
                    placeholder={`Add to ${blank.label.toLowerCase()}`}
                    placeholderTextColor={colors.textTertiary}
                    maxLength={GROCERY_NAME_MAX_LENGTH}
                    autoFocus
                    returnKeyType="done"
                    accessibilityLabel={`Add something else to ${blank.label}`}
                  />
                )}

                {refusedFor === blank.id && (
                  <Text style={styles.refused} accessibilityLiveRegion="polite">
                    {describeBlankRule(blank.max)}. Take one off to add another.
                  </Text>
                )}

                {stale.map(c => (
                  <View key={c.nameKey} style={styles.staleRow}>
                    <Text style={styles.staleText}>
                      {c.name}
                      {!!c.caption && <Text style={styles.staleCaption}>{` · ${c.caption}`}</Text>}
                    </Text>
                    <View style={styles.staleActions}>
                      <InlineAction
                        label="Still have it"
                        variant="neutral"
                        surface="card"
                        onPress={() => {
                          if (c.itemId) answerPantryReview(c.itemId, 'have');
                          setKept(prev => new Set(prev).add(c.nameKey));
                        }}
                        accessibilityLabel={`Still have ${c.name}`}
                      />
                      <InlineAction
                        label="Bought more"
                        variant="neutral"
                        surface="card"
                        onPress={() => {
                          if (c.itemId) answerPantryReview(c.itemId, 'new');
                          setKept(prev => new Set(prev).add(c.nameKey));
                        }}
                        accessibilityLabel={`Bought more ${c.name}`}
                      />
                      <InlineAction
                        label="Gone"
                        variant="neutral"
                        surface="card"
                        onPress={() => { if (c.itemId) answerPantryReview(c.itemId, 'out'); }}
                        accessibilityLabel={`${c.name} is gone`}
                      />
                    </View>
                  </View>
                ))}

                {names.length > 0 && !!blank.quantity && (
                  <View style={styles.amountRow}>
                    <Text style={styles.amountText}>
                      {share ? (names.length > 1 ? `${share} each` : share) : `${blank.quantity} between them`}
                    </Text>
                    <InlineAction
                      label={amountsOpen === blank.id ? 'Hide amounts' : 'Change amounts'}
                      variant="neutral"
                      onPress={() => setAmountsOpen(open => (open === blank.id ? null : blank.id))}
                    />
                  </View>
                )}
                {amountsOpen === blank.id && names.map(name => {
                  const key = groceryNameKey(name);
                  const value = picks.amounts[blank.id]?.[key] ?? share;
                  return (
                    <View key={key} style={styles.amountEditRow}>
                      <Text style={styles.amountName} numberOfLines={1}>{name}</Text>
                      <TextField
                        style={[styles.input, styles.amountInput]}
                        value={value}
                        onChangeText={text => setAmount(blank, key, text)}
                        placeholder="e.g. 1 cup"
                        placeholderTextColor={colors.textTertiary}
                        maxLength={GROCERY_QUANTITY_MAX_LENGTH}
                        accessibilityLabel={`Amount of ${name}`}
                      />
                    </View>
                  );
                })}
              </View>
            );
          })}

          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={styles.dot} /><Text style={styles.legendText}>In your kitchen</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, styles.dotSoon]} /><Text style={styles.legendText}>Use soon</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendSwatch, styles.chipToBuy]} /><Text style={styles.legendText}>To buy</Text></View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.smd }]}>
          <Text style={styles.footerMain} numberOfLines={2}>
            {allPicked.length > 0 ? allPicked.join(', ') : 'Nothing picked yet'}
          </Text>
          <Text style={styles.footerSub}>
            {toBuy === 0 ? 'Nothing to buy' : toBuy === 1 ? '1 thing to buy' : `${toBuy} things to buy`}
          </Text>
        </View>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { padding: spacing.md },
  lastCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  lastLabel: { color: colors.textSecondary, fontSize: font.xs },
  lastText: { color: colors.text, fontSize: font.md, marginTop: spacing.xxs },
  lastAction: { flexDirection: 'row', marginTop: spacing.smd },
  section: { marginTop: spacing.lg },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionRule: { color: colors.textTertiary, fontSize: font.xs },
  buyToggle: { flexDirection: 'row', marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsm,
    minHeight: 34,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.bgSecondary,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
  },
  // Not in the kitchen: an outline, so "this means buying it" reads before the label does.
  chipToBuy: { backgroundColor: 'transparent', borderColor: colors.controlBorder, borderStyle: 'dashed' },
  chipOn: { backgroundColor: colors.accentFill, borderColor: colors.accentFill, borderStyle: 'solid' },
  chipText: { color: colors.text, fontSize: font.sm },
  chipTextOn: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  dotSoon: { backgroundColor: colors.orange },
  dotOnFill: { borderWidth: 1, borderColor: colors.bgSecondary },
  hint: { color: colors.textSecondary, fontSize: font.xs, paddingHorizontal: spacing.xs, marginTop: spacing.sm },
  refused: { color: colors.textSecondary, fontSize: font.xs, paddingHorizontal: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    color: colors.text,
    fontSize: font.md,
    marginTop: spacing.sm,
  },
  staleRow: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  staleText: { color: colors.text, fontSize: font.sm },
  staleCaption: { color: colors.warningText, fontSize: font.xs },
  staleActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  amountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  amountText: { color: colors.textSecondary, fontSize: font.xs },
  amountEditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amountName: { flex: 1, color: colors.text, fontSize: font.sm, paddingHorizontal: spacing.xs, marginTop: spacing.sm },
  amountInput: { flex: 1 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.lg,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm },
  legendSwatch: { width: 18, height: 12, borderRadius: radius.full, borderWidth: 1 },
  legendText: { color: colors.textSecondary, fontSize: font.xs },
  footer: {
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.smd,
  },
  footerMain: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  footerSub: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
});
