import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { MEAL_SLOT_ICONS, MEAL_SLOT_LABELS, type GroceryItem, type MealSlot } from '../types';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import {
  describeFoodLogEntry,
  foodLogSections,
  foodLogTotals,
} from '../utils/foodLog';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { targetProgress } from '../utils/nutritionTargets';
import { useSettingsStore } from '../store/useSettingsStore';
import { NUTRIENT_KEYS } from '../types';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useGroceryStore } from '../store/useGroceryStore';
import { nutritionFor } from '../utils/foodNutrition';
import { describeProduct } from '../utils/groceryProduct';
import { BarcodeScanSheet, type ScanProductDraft } from '../components/BarcodeScanSheet';
import { ScanPortionSheet, type ScannedFood } from '../components/ScanPortionSheet';
import { NutritionPanelSheet } from '../components/NutritionPanelSheet';
import { EstimateMealSheet } from '../components/EstimateMealSheet';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import type { ReceiptAddDraft } from '../components/ReceiptImportSheet';
import type { ScannedGtinLink } from '../utils/scanResolve';
import { EmptyState } from '../components/EmptyState';
import { HubPills } from '../components/HubPills';
import { InlineAction } from '../components/InlineAction';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { FoodLogEntrySheet } from '../components/FoodLogEntrySheet';

/**
 * A day of eating, read back.
 *
 * **One day at a time, not a week.** A food diary is answered by "what did I
 * eat today", and a week of entries is several dozen rows that no total can
 * usefully sit above. The arrows move by a logical day, so the boundary the
 * screen steps across is the same one the entries were stamped under.
 *
 * **Every figure says what it covers.** A day where three entries state fibre
 * and four do not has a fibre total that speaks for three entries, and the
 * count beside it is what stops the number reading as the day's fibre. That is
 * `foodLogTotals`' rule showing up on screen, and it is the whole reason the
 * totals carry a per-nutrient count rather than one number for the day.
 *
 * **Nothing is graded.** No daily-value percentages, no colours, no "good day".
 * Those need an RDA the app has never asked for, and `cookingStats.ts`'s rule
 * holds here: counts, never a score.
 *
 * **A barcode is the third way in**, beside the picker and a finished meal. It
 * answers what a thing is and nothing about how much of it was eaten, so the
 * scan hands over to `ScanPortionSheet` rather than logging anything itself —
 * see `handleScanApply`.
 */

export function FoodLogScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const entries = useFoodLogStore(useShallow(s => s.entries));
  const loadRange = useFoodLogStore(s => s.loadRange);
  const removeEntry = useFoodLogStore(s => s.removeEntry);
  const nutritionTargets = useSettingsStore(useShallow(s => s.nutritionTargets));
  const items = useGroceryStore(useShallow(s => s.items));
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const addProduct = useGroceryStore(s => s.addProduct);
  const setItemNutrition = useGroceryStore(s => s.setItemNutrition);
  const setProductNutrition = useGroceryStore(s => s.setProductNutrition);
  const linkScannedGtins = useGroceryStore(s => s.linkScannedGtins);
  const gtinProductFor = useGroceryStore(s => s.gtinProductFor);
  // Gated so the button can't exist for a call that would refuse — the pairing
  // rule `aiRouting.ts` states. This feature has no on-device engine, so the
  // route is 'claude' or 'unavailable' and nothing renders for the second.
  const estimateRoute = useAiRoute('nutritionEstimate');

  const [dayKey, setDayKey] = useState(() => dayKeyOf(getCurrentDayStart()));
  const [addingSlot, setAddingSlot] = useState<MealSlot | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [seedRecipeId, setSeedRecipeId] = useState<string | null>(null);
  const [scanned, setScanned] = useState<ScannedFood[]>([]);
  /**
   * The scanned food whose label is being typed or photographed in, or null.
   *
   * Held here rather than pushed onto the grocery screens because this is where
   * the person hit the wall: a barcode that carried no figures is discovered
   * while logging, and sending them off to find the catalog row is how a
   * two-tap fix becomes an errand.
   */
  const [panelFor, setPanelFor] = useState<{ itemId: string; productId: string | null; name: string } | null>(null);
  // Which nutrient rows are on screen. Collapsed by default: calories and
  // protein answer the question most days, and ten rows above the meals would
  // push the day itself below the fold.
  const [allNutrients, setAllNutrients] = useState(false);

  useEffect(() => {
    loadRange(dayKey, dayKey);
  }, [dayKey, loadRange]);

  const dayEntries = useMemo(() => entries.filter(e => e.dayKey === dayKey), [entries, dayKey]);
  const sections = useMemo(() => foodLogSections(dayEntries), [dayEntries]);
  const totals = useMemo(() => foodLogTotals(dayEntries), [dayEntries]);

  const todayKey = dayKeyOf(getCurrentDayStart());
  const isToday = dayKey === todayKey;
  const dayDate = dayKeyToDate(dayKey);
  // The instant a new entry is stamped with. Today logs at the real moment;
  // another day logs at midday, which is inside that logical day whichever way
  // the reset time falls. Same reasoning `getLogicalToday` uses for noon.
  const loggingAt = useMemo(() => {
    if (isToday) return new Date();
    const noon = new Date(dayDate);
    noon.setHours(12, 0, 0, 0);
    return noon;
  }, [isToday, dayDate]);

  const step = useCallback((days: number) => {
    haptics.tap();
    setDayKey(k => dayKeyOf(addDays(dayKeyToDate(k), days)));
  }, []);

  /**
   * A scan session, confirmed. Resolved to catalog rows, then handed on.
   *
   * **Nothing is logged here.** A barcode says what a thing is and never how
   * much of it was eaten, so this does the resolving a code *can* answer and
   * `ScanPortionSheet` asks the one it can't. Defaulting to a serving would put
   * a number nobody stated into a day's totals.
   *
   * The catalog write is deliberately `ensureCatalogItem` rather than
   * `addByName`, which is the same restraint `KitchenScreen`'s own scan handler
   * takes: eating something is not a plan to buy it, so a row minted here
   * arrives off the list. Everything else is `GroceryScreen.handleScanApply`'s
   * sequence and has to stay in that order — the boxes first, so a link finds
   * one, and `linkScannedGtins` last, since that is what carries the label
   * panel off the barcode cache and onto the box this is about to read.
   *
   * A row whose panel is still null after all that is dropped rather than
   * offered: a source that stated no nutrients has nothing a total could use,
   * and an entry built from it would record a name and no figures.
   */
  const handleScanApply = (
    itemIds: string[],
    toAdd: ReceiptAddDraft[],
    _frozenItemIds: ReadonlySet<string>,
    products: ScanProductDraft[],
    gtinLinks: ScannedGtinLink[]
  ) => {
    // Keyed rather than looked up in `items`, which is a render snapshot: a row
    // `ensureCatalogItem` mints two lines down isn't in it, and reading through
    // it would silently drop exactly the rows this scan just created.
    const resolved = new Map<string, GroceryItem>();
    for (const id of itemIds) {
      const item = items.find(i => i.id === id);
      if (item) resolved.set(id, item);
    }
    const mintedLinks: ScannedGtinLink[] = [];
    const packSizes = new Map<string, string>();
    for (const product of products) {
      if (product.packSize) packSizes.set(product.itemId, product.packSize);
    }
    for (const draft of toAdd) {
      const item = draft.existingItemId
        ? items.find(i => i.id === draft.existingItemId)
        : ensureCatalogItem(draft.name);
      if (!item) continue;
      const id = item.id;
      resolved.set(id, item);
      if (draft.quantity) packSizes.set(id, draft.quantity);
      if (!draft.existingItemId && draft.gtin) {
        // Brand-only, matching what a minted row is named after: there is no
        // existing item name left for a variant to be the residue of.
        if (draft.brand) addProduct(id, { brand: draft.brand, variant: null });
        mintedLinks.push({ gtin: draft.gtin, itemId: id, brand: draft.brand, variant: null });
      }
    }
    for (const product of products) {
      addProduct(product.itemId, { brand: product.brand, variant: product.variant });
    }
    linkScannedGtins([...gtinLinks, ...mintedLinks]);

    const gtinByItemId = new Map(
      [...gtinLinks, ...mintedLinks].map(link => [link.itemId, link.gtin])
    );
    const foods: ScannedFood[] = [];
    const unpanelled: { itemId: string; productId: string | null; name: string }[] = [];
    for (const [id, item] of resolved) {
      // The box this barcode names, which `linkScannedGtins` has just given the
      // panel to. Its own figures outrank the catalog row's, for the reason
      // `nutritionFor` gives: a specific pot is a better answer than the food.
      const linked = gtinProductFor(gtinByItemId.get(id) ?? null);
      const box = linked?.itemId === id ? linked : null;
      const panel = nutritionFor(item, box);
      // Nothing to log, rather than a panel written somewhere it doesn't
      // belong. A scanned code whose source stated figures but no brand has no
      // box to hang them on, and filing a specific loaf's label onto the "Bread"
      // row would make every future helping of bread claim that loaf's numbers.
      // Refuse rather than approximate, same as everywhere else in this tree.
      if (!panel) {
        // Remembered rather than merely skipped: this is the exact moment a
        // person learns the barcode carried no figures, and the packet is
        // still in their hand. See `unpanelled` below.
        unpanelled.push({ itemId: id, productId: box?.id ?? null, name: item.name });
        continue;
      }
      const boxWords = describeProduct(box);
      foods.push({
        key: id,
        label: boxWords ? `${item.name}, ${boxWords}` : item.name,
        panel,
        packSize: packSizes.get(id) ?? null,
        itemId: id,
        productId: box?.id ?? null,
      });
    }
    setScanOpen(false);
    if (foods.length === 0) {
      // The packet is in their hand and it has the figures printed on it, so
      // the honest answer here is an offer rather than only a refusal. It takes
      // the first, since the panel sheet edits one food and doing several means
      // doing them one at a time regardless — the copy says so when there are
      // more.
      const first = unpanelled[0];
      const rest = unpanelled.length - 1;
      Alert.alert(
        'No nutrition on it yet',
        `A food can be logged once its figures are the food's own rather than a guess.${
          first ? ` You can read them off the packet for ${first.name}${
            rest > 0 ? `, then the other ${rest === 1 ? 'one' : `${rest}`} the same way` : ''
          }.` : ''
        }`,
        first
          ? [
            { text: 'Not now', style: 'cancel' },
            { text: 'Add its label', onPress: () => setPanelFor(first) },
          ]
          : undefined,
      );
      return;
    }
    setScanned(foods);
  };

  const handleDelete = (id: string, label: string) => {
    Alert.alert(
      `Forget ${label}?`,
      'This removes it from the day\'s totals.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            haptics.warning();
            animateLayout();
            removeEntry(id);
          },
        },
      ],
    );
  };

  const shownKeys = allNutrients
    ? NUTRIENT_KEYS.filter(k => totals.total[k] !== undefined)
    : NUTRIENT_KEYS.filter(k => totals.total[k] !== undefined && (k === 'calorieKcal' || k === 'proteinG'));

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title="Food log"
        overline={format(dayDate, 'EEEE, d MMMM')}
        subtitle={
          dayEntries.length === 0
            ? undefined
            : `${dayEntries.length} ${dayEntries.length === 1 ? 'entry' : 'entries'}`
        }
        actions={[
          // sparkles means "calls api.anthropic.com, needs a key" app-wide —
          // see the note in GroceryCatalogSheet on why a local heuristic uses
          // color-wand instead.
          ...(estimateRoute !== 'unavailable' ? [{
            icon: 'sparkles-outline',
            onPress: () => { haptics.tap(); setAddingSlot(null); setEstimateOpen(true); },
            accessibilityLabel: 'Estimate a meal from a description',
          } satisfies ScreenHeaderAction] : []),
          {
            icon: 'barcode-outline',
            onPress: () => { haptics.tap(); setAddingSlot(null); setScanOpen(true); },
            accessibilityLabel: 'Scan a barcode to log',
          },
          {
            icon: 'add-circle-outline',
            onPress: () => { haptics.tap(); setAddingSlot(null); setAddOpen(true); },
            accessibilityLabel: 'Log something you ate',
          },
        ]}
      />
      <HubPills hub="history" active="FoodLog" />

      <View style={styles.dayNav}>
        <TouchableOpacity
          style={styles.dayNavButton}
          activeOpacity={interaction.activeOpacity}
          onPress={() => step(-1)}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
        >
          <Ionicons name="chevron-back" size={iconSize.sm} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dayNavToday}
          activeOpacity={interaction.activeOpacity}
          disabled={isToday}
          onPress={() => { haptics.tap(); setDayKey(todayKey); }}
          accessibilityRole="button"
          accessibilityLabel="Back to today"
        >
          <Text style={[styles.dayNavTodayText, isToday && styles.dayNavTodayTextOff]}>
            {isToday ? 'Today' : 'Back to today'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dayNavButton}
          activeOpacity={interaction.activeOpacity}
          onPress={() => step(1)}
          accessibilityRole="button"
          accessibilityLabel="Next day"
        >
          <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {dayEntries.length === 0 ? (
          <EmptyState
            icon="restaurant-outline"
            title={isToday ? 'Nothing logged today' : 'Nothing logged that day'}
            subtitle="A food can be logged once it has nutrition on it, so its figures are the food's own rather than a guess."
            actionLabel="Log something"
            onAction={() => { haptics.tap(); setAddingSlot(null); setAddOpen(true); }}
          />
        ) : (
          <>
            <View style={styles.totalsCard}>
              {shownKeys.map(key => (
                <View key={key} style={styles.totalBlock}>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{NUTRIENT_LABEL[key].label}</Text>
                  <View style={styles.totalRight}>
                    <Text style={styles.totalValue}>
                      {Math.round(totals.total[key] as number)}{nutritionTargets[key] !== undefined || NUTRIENT_LABEL[key].unit === 'cal' ? '' : NUTRIENT_LABEL[key].unit}
                    </Text>
                    {/* The target, when there is one, and nothing suggested when
                        there isn't — see nutritionTargets.ts. Reported flat
                        beside the figure rather than as a percentage or a
                        verdict: counts, never a score. */}
                    {nutritionTargets[key] !== undefined && (
                      <Text style={styles.totalTarget}>
                        of {nutritionTargets[key]!.toLocaleString()}{NUTRIENT_LABEL[key].unit === 'cal' ? ' cal' : NUTRIENT_LABEL[key].unit}
                      </Text>
                    )}
                    {/* What the figure speaks for. Without it a total built from
                        three of seven entries reads as the day's — and against a
                        target it would overstate the day rather than merely
                        being vague. */}
                    {(totals.reported[key] ?? 0) < totals.entries && (
                      <Text style={styles.totalCoverage}>
                        from {totals.reported[key] ?? 0} of {totals.entries}
                      </Text>
                    )}
                  </View>
                </View>
                {/* One colour at both ends, because whether being over a target
                    is good or bad is not knowable: somebody tracking protein
                    wants to reach it and somebody tracking sodium wants to stay
                    under, and nothing here is told which. */}
                {nutritionTargets[key] !== undefined && (
                  <View style={styles.targetTrack}>
                    <View
                      style={[
                        styles.targetFill,
                        { width: `${targetProgress(key, totals.total[key], nutritionTargets) * 100}%` },
                      ]}
                    />
                  </View>
                )}
                </View>
              ))}
              <InlineAction
                label={allNutrients ? 'Show less' : 'Show every nutrient'}
                variant="neutral"
                onPress={() => { haptics.tap(); animateLayout(); setAllNutrients(v => !v); }}
              />
            </View>

            {sections.map(section => (
              <View key={section.slot ?? 'none'} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons
                    name={(section.slot ? MEAL_SLOT_ICONS[section.slot] : 'ellipsis-horizontal') as keyof typeof Ionicons.glyphMap}
                    size={iconSize.sm}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.sectionTitle}>
                    {section.slot ? MEAL_SLOT_LABELS[section.slot] : 'Other'}
                  </Text>
                  {section.totals.total.calorieKcal !== undefined && (
                    <Text style={styles.sectionTotal}>
                      {Math.round(section.totals.total.calorieKcal)} cal
                    </Text>
                  )}
                </View>
                {section.entries.map(entry => (
                  <TouchableOpacity
                    key={entry.id}
                    style={styles.entryRow}
                    activeOpacity={interaction.activeOpacity}
                    onLongPress={() => handleDelete(entry.id, entry.label)}
                    delayLongPress={interaction.delayLongPress}
                    accessibilityRole="button"
                    accessibilityLabel={`${entry.label}. Hold to forget.`}
                  >
                    <View style={styles.entryText}>
                      <Text style={styles.entryTitle}>{entry.label}</Text>
                      <Text style={styles.entryMeta}>{describeFoodLogEntry(entry)}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                <InlineAction
                  label="Add to this meal"
                  onPress={() => { haptics.tap(); setAddingSlot(section.slot); setAddOpen(true); }}
                />
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <FoodLogEntrySheet
        visible={addOpen}
        slot={addingSlot}
        at={loggingAt}
        seedRecipeId={seedRecipeId}
        onClose={() => { setAddOpen(false); setSeedRecipeId(null); }}
      />
      <BarcodeScanSheet
        visible={scanOpen}
        context="log"
        onClose={() => setScanOpen(false)}
        onApply={handleScanApply}
      />
      <NutritionPanelSheet
        visible={panelFor !== null}
        foodName={panelFor?.name ?? ''}
        nutrition={null}
        onClose={() => setPanelFor(null)}
        onSave={panel => {
          if (!panelFor) return;
          // Onto the box when the scan named one, onto the catalog row when it
          // didn't — the same precedence `nutritionFor` reads them back in, so
          // a specific packet's figures never become every future helping of
          // the generic food's.
          if (panelFor.productId) setProductNutrition(panelFor.productId, panel);
          else setItemNutrition(panelFor.itemId, panel);
        }}
      />
      <EstimateMealSheet
        visible={estimateOpen}
        slot={addingSlot}
        at={loggingAt}
        onClose={() => setEstimateOpen(false)}
        onPickRecipe={recipeId => {
          // Handed to the picker rather than logged here: a recipe is logged in
          // servings, which is a question this sheet has not asked. Seeded, so
          // the offer lands on the dish rather than on a list to search again.
          setEstimateOpen(false);
          setSeedRecipeId(recipeId);
          setAddOpen(true);
        }}
      />
      <ScanPortionSheet
        visible={scanned.length > 0}
        foods={scanned}
        slot={addingSlot}
        at={loggingAt}
        onClose={() => setScanned([])}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    dayNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    dayNavButton: { padding: spacing.sm },
    dayNavToday: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    dayNavTodayText: { color: colors.accent, fontSize: font.sm },
    dayNavTodayTextOff: { color: colors.textSecondary },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
    totalsCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    totalBlock: { gap: spacing.xs },
    totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    totalTarget: { color: colors.textSecondary, fontSize: font.sm },
    targetTrack: { height: 4, borderRadius: 2, backgroundColor: colors.separator, overflow: 'hidden' },
    targetFill: { height: '100%', borderRadius: 2, backgroundColor: colors.accent },
    totalLabel: { color: colors.text, fontSize: font.sm },
    totalRight: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    totalValue: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    totalCoverage: { color: colors.textSecondary, fontSize: font.xs },
    section: { marginBottom: spacing.lg, gap: spacing.sm },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    sectionTitle: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    sectionTotal: { color: colors.textSecondary, fontSize: font.xs },
    entryRow: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    entryText: { gap: 2 },
    entryTitle: { color: colors.text, fontSize: font.md },
    entryMeta: { color: colors.textSecondary, fontSize: font.sm },
  });
}
