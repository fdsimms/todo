import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRoute } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { flattenOverlay, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { MEAL_SLOTS, MEAL_SLOT_ICONS, MEAL_SLOT_LABELS, type FoodLogEntry, type MealSlot } from '../types';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import {
  describeFoodLogEntry,
  foodLogSections,
  foodLogTotals,
  resolveFoodLogDrop,
  type FoodLogListItem,
} from '../utils/foodLog';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { describeAgainstTarget, targetProgress } from '../utils/nutritionTargets';
import { useSettingsStore } from '../store/useSettingsStore';
import { NUTRIENT_KEYS, type NutrientKey } from '../types';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useGroceryStore } from '../store/useGroceryStore';
import { CatalogLinkSheet } from '../components/CatalogLinkSheet';
import { ScanToLogFlow } from '../components/ScanToLogFlow';
import { EstimateMealSheet } from '../components/EstimateMealSheet';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import { EmptyState } from '../components/EmptyState';
import { HubPills } from '../components/HubPills';
import { InlineAction } from '../components/InlineAction';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { FoodLogEntrySheet } from '../components/FoodLogEntrySheet';
import { NutrientContributorsSheet } from '../components/NutrientContributorsSheet';
import { NutritionTargetsSheet } from '../components/NutritionTargetsSheet';
import { WhenPicker } from '../components/WhenPicker';
import { ReorderableList } from '../components/ReorderableList';
import { SwipeableRow } from '../components/SwipeableRow';
import { SelectionDot } from '../components/SelectionDot';
import { PaintSelectionProvider, usePaintSelectionRow } from '../components/PaintSelection';
import { ListBulkBar } from '../components/ListBulkBar';
import { Fab, FAB_SIZE } from '../components/Fab';
import { useRowSelection } from '../hooks/useRowSelection';

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
 * scan hands over to an amount question rather than logging anything itself.
 * The whole of it is `ScanToLogFlow`, mounted here and by `LogMealEntrySheet`
 * — the header's scan button and the picker sheet's both open the same one.
 *
 * **The day is one draggable list, same shape Today's category sections use.**
 * A meal header and its entries are all one flat `FoodLogListItem[]` handed
 * to `ReorderableList` (`listItems` below), so a drag can carry an entry
 * across a meal boundary in the same
 * gesture that reorders it — `resolveFoodLogDrop` is `resolveDrop`
 * (`taskGrouping.ts`) with tasks and categories swapped for entries and meal
 * slots. Bulk selection is the same `useRowSelection` + swipe-to-select +
 * `ListBulkBar` contract every other selectable list in the app uses; drag
 * and selection share the row's long press the way Templates/Projects/People
 * all resolve it, so dragging is off for the duration of a selection.
 */

export function FoodLogScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tabBarHeight = useBottomTabBarHeight();
  const route = useRoute<{ key: string; name: string; params?: { openAdd?: number } }>();

  const entries = useFoodLogStore(useShallow(s => s.entries));
  const loadRange = useFoodLogStore(s => s.loadRange);
  const removeEntry = useFoodLogStore(s => s.removeEntry);
  const updateEntry = useFoodLogStore(s => s.updateEntry);
  const removeEntries = useFoodLogStore(s => s.removeEntries);
  const moveEntries = useFoodLogStore(s => s.moveEntries);
  const reorderEntries = useFoodLogStore(s => s.reorderEntries);
  const nutritionTargets = useSettingsStore(useShallow(s => s.nutritionTargets));
  // Only for the catalog picker below; the scan flow keeps its own reads.
  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  // Gated so the button can't exist for a call that would refuse — the pairing
  // rule `aiRouting.ts` states. This feature has no on-device engine, so the
  // route is 'claude' or 'unavailable' and nothing renders for the second.
  const estimateRoute = useAiRoute('nutritionEstimate');

  const [dayKey, setDayKey] = useState(() => dayKeyOf(getCurrentDayStart()));
  const [addingSlot, setAddingSlot] = useState<MealSlot | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  /**
   * The entry whose catalog row is being chosen, or null.
   *
   * An entry's `itemId` is set once, by whichever path logged it, and until now
   * could never be corrected: a scan that read the wrong row, or a food found
   * in a database before the catalog had it, left the entry pointing at the
   * wrong thing or at nothing, and deleting and re-logging was the only way
   * back. This is only ever provenance — see `FoodLogPatch` — so nothing about
   * the meal's own figures moves with it.
   */
  const [linkingEntry, setLinkingEntry] = useState<FoodLogEntry | null>(null);
  const [seedRecipeId, setSeedRecipeId] = useState<string | null>(null);
  // Plain useRowSelection, same as Templates/Projects/People: there is
  // nothing recurrence- or meal-plan-aware to reuse useTaskSelection's delete
  // flow for, only a confirm.
  const {
    selectionMode, selectedIds, enterSelectionMode, toggleSelection,
    exitSelection, selectAll, deselectAll, painting, paintProps,
  } = useRowSelection();
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  // Which nutrient rows are on screen. Collapsed by default: calories and
  // protein answer the question most days, and ten rows above the meals would
  // push the day itself below the fold.
  const [allNutrients, setAllNutrients] = useState(false);
  // Which nutrient's contributors are open in the breakdown sheet, or null
  // while it's closed.
  const [contributorsKey, setContributorsKey] = useState<NutrientKey | null>(null);
  // The day picker, opened from the date in the header. The arrows step one
  // day; reaching a day last month through them alone was twenty-odd taps.
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  // Daily targets, which drive the bars on this card and used to be reachable
  // only from Settings, Kitchen — a page away from the only figures they mean
  // anything against.
  const [targetsOpen, setTargetsOpen] = useState(false);

  useEffect(() => {
    loadRange(dayKey, dayKey);
  }, [dayKey, loadRange]);

  // The stamped-param handoff `resetToMood`/`resetToWeight` use for the same
  // job: a caller that wants the add sheet open on arrival (Meal plan's
  // "Log food" header action) stamps a fresh timestamp so a second tap opens
  // it again rather than reading as no change.
  const [handledOpenAdd, setHandledOpenAdd] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openAdd === undefined || route.params.openAdd === handledOpenAdd) return;
    setHandledOpenAdd(route.params.openAdd);
    setAddingSlot(null);
    setAddOpen(true);
  }, [route.params?.openAdd, handledOpenAdd]);

  const dayEntries = useMemo(() => entries.filter(e => e.dayKey === dayKey), [entries, dayKey]);
  const sections = useMemo(() => foodLogSections(dayEntries), [dayEntries]);
  // Keyed once rather than searched per header row: `renderItem` ran a `find`
  // over the sections for every header it drew.
  const sectionBySlot = useMemo(
    () => new Map(sections.map(s => [s.slot, s])),
    [sections],
  );
  const totals = useMemo(() => foodLogTotals(dayEntries), [dayEntries]);

  // The flat row list ReorderableList actually drags — a header opens each
  // section's entries, same shape `CategoryListItem` gives Today's own
  // sections. Only 'entry' rows are ever handed a drag handle (see renderItem
  // below); the header rides along as a fixed landmark a drop is resolved
  // against.
  const listItems = useMemo<FoodLogListItem[]>(() => {
    const out: FoodLogListItem[] = [];
    for (const section of sections) {
      out.push({ type: 'header', slot: section.slot });
      for (const entry of section.entries) out.push({ type: 'entry', entry });
    }
    return out;
  }, [sections]);

  // "Breakfast"/"Lunch"/… for the bulk bar's Move panel — its built-in "None"
  // chip (`allowNone`) already covers the unslotted "Other" section, so it's
  // not repeated here. The reverse lookup turns a tapped chip back into a
  // MealSlot.
  const mealSlotOptions = useMemo(() => MEAL_SLOTS.map(s => MEAL_SLOT_LABELS[s]), []);
  const mealSlotLabelToSlot = useMemo(
    () => new Map(MEAL_SLOTS.map(s => [MEAL_SLOT_LABELS[s], s])),
    []
  );

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
    exitSelection();
    setDayKey(k => {
      const next = dayKeyOf(addDays(dayKeyToDate(k), days));
      // A food log entry records what was eaten, which a future day has no
      // answer for yet — same reasoning MoodLogSheet's allowFuture={false}
      // rests on. The next-day chevron is already disabled on today, this is
      // the belt to that pair of braces.
      return next > todayKey ? todayKey : next;
    });
  }, [exitSelection, todayKey]);


  const handleDelete = useCallback((id: string, label: string) => {
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
  }, [removeEntry]);

  // The "…" on a row is a real menu, not a synonym for delete: an accidental
  // tap must not open a destructive confirm with nothing to say what's about
  // to happen. Move reuses the same slot list the bulk bar's own panel does.
  const handleOpenMenu = useCallback((entry: FoodLogEntry) => {
    const moveButtons = MEAL_SLOTS
      .filter(s => s !== entry.slot)
      .map(s => ({
        text: MEAL_SLOT_LABELS[s],
        onPress: () => { haptics.tap(); moveEntries([entry.id], s); },
      }));
    if (entry.slot !== null) {
      moveButtons.push({ text: 'Other', onPress: () => { haptics.tap(); moveEntries([entry.id], null); } });
    }
    Alert.alert(entry.label, undefined, [
      {
        text: 'Move to meal',
        onPress: () => Alert.alert('Move to meal', undefined, [
          ...moveButtons,
          { text: 'Cancel', style: 'cancel' as const },
        ]),
      },
      {
        text: entry.itemId ? 'File as a different item' : 'File as an item',
        onPress: () => setLinkingEntry(entry),
      },
      ...(entry.itemId
        ? [{
          text: 'Stop filing it as an item',
          onPress: () => {
            // The box goes with the row: a product is one of an item's boxes,
            // so an entry pointing at a box and not at the item is a pointer
            // with nothing above it.
            updateEntry(entry.id, { itemId: null, productId: null });
            haptics.tap();
          },
        }]
        : []),
      { text: 'Forget', style: 'destructive', onPress: () => handleDelete(entry.id, entry.label) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [moveEntries, updateEntry, handleDelete]);

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    Alert.alert(
      `Forget ${count} ${count === 1 ? 'entry' : 'entries'}?`,
      'This removes them from the day\'s totals.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            haptics.warning();
            animateLayout();
            removeEntries(ids);
            exitSelection();
          },
        },
      ],
    );
  };

  const handleBulkMove = (label: string | null) => {
    animateLayout();
    moveEntries(Array.from(selectedIds), label === null ? null : mealSlotLabelToSlot.get(label) ?? null);
    haptics.tap();
    exitSelection();
  };

  const handleReorder = (reordered: FoodLogListItem[]) => {
    const resolved = resolveFoodLogDrop(reordered);
    reorderEntries(resolved.map(e => ({ id: e.id, slot: e.slot, sortOrder: e.sortOrder })));
  };

  // Extra bottom padding so the last rows aren't hidden behind the floating
  // bar — same arithmetic every other bulk-selecting list uses.
  const selectionListPadding = tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm;

  // Every nutrient the day actually stated, and the two the card leads with.
  // Absent stays absent in both — see foodLogTotals.
  const statedKeys = NUTRIENT_KEYS.filter(k => totals.total[k] !== undefined);
  const shownKeys = allNutrients
    ? statedKeys
    : statedKeys.filter(k => k === 'calorieKcal' || k === 'proteinG');

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title="Food log"
        overline={format(dayDate, 'EEEE, MMMM d')}
        subtitle={
          dayEntries.length === 0
            ? undefined
            : `${dayEntries.length} ${dayEntries.length === 1 ? 'entry' : 'entries'}`
        }
        // Hidden while selecting, same as every other bulk-selecting list —
        // the bar below takes over the bottom of the screen and these three
        // aren't things you're doing mid-selection anyway.
        actions={selectionMode ? undefined : [
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
            icon: 'flag-outline',
            onPress: () => { haptics.tap(); setTargetsOpen(true); },
            accessibilityLabel: 'Daily targets',
          },
          // Plain logging moved to the FAB below, same as every other
          // primary-add list screen — selecting is reached by swiping a row.
        ]}
      />
      <HubPills hub="kitchen" active="FoodLog" />

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
        {/* The date itself, not "Back to today" — that text said which of two
            states you were in but never which day you were actually looking
            at, so reading it meant checking the header instead. This is
            always the answer to "what day is this", at a glance. */}
        <TouchableOpacity
          style={styles.dayNavCenter}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); setDayPickerOpen(true); }}
          accessibilityRole="button"
          accessibilityLabel={isToday ? 'Today. Pick a day' : `${format(dayDate, 'EEEE, MMMM d')}. Pick a day`}
        >
          <Text style={styles.dayNavDateText}>
            {isToday ? 'Today' : format(dayDate, 'EEE, MMM d')}
          </Text>
          {!isToday && (
            <TouchableOpacity
              hitSlop={{ top: 4, bottom: 8, left: 8, right: 8 }}
              onPress={() => { haptics.tap(); exitSelection(); setDayKey(todayKey); }}
              accessibilityRole="button"
              accessibilityLabel="Back to today"
            >
              <Text style={styles.dayNavBackText}>Back to today</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dayNavButton}
          activeOpacity={interaction.activeOpacity}
          onPress={() => step(1)}
          disabled={isToday}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: isToday }}
        >
          <Ionicons name="chevron-forward" size={iconSize.sm} color={isToday ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
      </View>

      {dayEntries.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title={isToday ? 'Nothing logged today' : 'Nothing logged that day'}
          subtitle="A food can be logged once it has nutrition on it, so its figures are the food's own rather than a guess."
          actionLabel="Log something"
          onAction={() => { haptics.tap(); setAddingSlot(null); setAddOpen(true); }}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <PaintSelectionProvider {...paintProps}>
          <ReorderableList
            data={listItems}
            keyExtractor={item =>
              item.type === 'entry' ? `entry-${item.entry.id}` : `${item.type}-${item.slot ?? 'none'}`
            }
            // A paint gesture owns the touch for its duration, same reason
            // every other selectable list turns scrolling off for one.
            scrollEnabled={!painting}
            contentContainerStyle={[styles.scrollContent, { paddingTop: spacing.sm }]}
            placeholderStyle={styles.dropSlot}
            onHoverChange={haptics.dragTick}
            onReorder={handleReorder}
            ListHeaderComponent={
              <View style={styles.totalsCard}>
                {shownKeys.map(key => (
                  <View key={key} style={styles.totalBlock}>
                  <TouchableOpacity
                    style={styles.totalRow}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => { haptics.tap(); setContributorsKey(key); }}
                    accessibilityRole="button"
                    accessibilityLabel={`See which entries contributed to ${NUTRIENT_LABEL[key].label.toLowerCase()}`}
                  >
                    <Text style={styles.totalLabel}>{NUTRIENT_LABEL[key].label}</Text>
                    <View style={styles.totalRight}>
                      {/* The target, when there is one, and nothing suggested
                          when there isn't — see nutritionTargets.ts. Reported
                          flat beside the figure rather than as a percentage or
                          a verdict: counts, never a score.

                          `describeAgainstTarget` writes both halves rather than
                          this file writing one and that module the other: the
                          hand-rolled pair here rounded the total with
                          `Math.round` and the target with `toLocaleString`, so
                          a heavy day read "1840 of 2,000 cal" — two number
                          formats on one line. */}
                      <Text style={styles.totalValue}>
                        {describeAgainstTarget(key, totals.total[key], nutritionTargets)
                          ?? `${Math.round(totals.total[key] as number).toLocaleString()}${NUTRIENT_LABEL[key].unit === 'cal' ? '' : NUTRIENT_LABEL[key].unit}`}
                      </Text>
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
                  </TouchableOpacity>
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
                {/* Withheld when expanding would add nothing. The list is
                    filtered to nutrients the day actually stated, so on a day
                    of calories-and-protein-only entries the toggle used to sit
                    there doing visibly nothing when tapped. */}
                {(allNutrients || statedKeys.length > shownKeys.length) && (
                  <InlineAction
                    label={allNutrients ? 'Show less' : 'Show every nutrient'}
                    variant="neutral"
                    onPress={() => { haptics.tap(); animateLayout(); setAllNutrients(v => !v); }}
                  />
                )}
              </View>
            }
            ListFooterComponent={
              <View style={{ height: selectionMode ? selectionListPadding : tabBarHeight + FAB_SIZE + spacing.xl }} />
            }
            renderItem={({ item, drag, isActive }) => {
              if (item.type === 'header') {
                const section = sectionBySlot.get(item.slot);
                const slotLabel = item.slot ? MEAL_SLOT_LABELS[item.slot] : 'Other';
                return (
                  <View style={styles.sectionHeader}>
                    <Ionicons
                      name={(item.slot ? MEAL_SLOT_ICONS[item.slot] : 'ellipsis-horizontal') as keyof typeof Ionicons.glyphMap}
                      size={iconSize.sm}
                      color={colors.textSecondary}
                    />
                    <Text style={styles.sectionTitle}>{slotLabel}</Text>
                    {section && section.totals.total.calorieKcal !== undefined && (
                      <Text style={styles.sectionTotal}>
                        {Math.round(section.totals.total.calorieKcal)} cal
                      </Text>
                    )}
                    <InlineAction
                      icon="add"
                      onPress={() => { haptics.tap(); setAddingSlot(item.slot); setAddOpen(true); }}
                      accessibilityLabel={`Add to ${slotLabel}`}
                    />
                  </View>
                );
              }
              return (
                <FoodLogRow
                  entry={item.entry}
                  isActive={isActive}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.entry.id)}
                  drag={selectionMode ? undefined : drag}
                  styles={styles}
                  colors={colors}
                  onToggleSelect={toggleSelection}
                  onSwipeSelect={enterSelectionMode}
                  onOpenMenu={handleOpenMenu}
                />
              );
            }}
          />
        </PaintSelectionProvider>
      )}

      {/* The bulk bar sits where the FAB does, and logging a new entry isn't
          something you're doing mid-selection anyway. */}
      {!selectionMode && (
        <Fab
          onPress={() => { setAddingSlot(null); setAddOpen(true); }}
          accessibilityLabel="Log something you ate"
          bottom={tabBarHeight + spacing.md}
        />
      )}

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={dayEntries.length}
          category={{
            title: 'Move to Meal',
            options: mealSlotOptions,
            onSet: handleBulkMove,
          }}
          actions={[
            { key: 'delete', icon: 'trash', label: 'Delete', tone: 'destructive', onPress: handleBulkDelete },
          ]}
          onSelectAll={() => selectAll(dayEntries.map(e => e.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <FoodLogEntrySheet
        visible={addOpen}
        slot={addingSlot}
        at={loggingAt}
        seedRecipeId={seedRecipeId}
        onClose={() => { setAddOpen(false); setSeedRecipeId(null); }}
        onEstimate={estimateRoute !== 'unavailable' ? () => { setAddOpen(false); setEstimateOpen(true); } : undefined}
        onScan={() => { setAddOpen(false); setScanOpen(true); }}
      />
      <ScanToLogFlow
        visible={scanOpen}
        slot={addingSlot}
        at={loggingAt}
        onClose={() => setScanOpen(false)}
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
      {/* Provenance only: the entry's own figures are a snapshot of what was
          eaten and must not follow the pointer. See `FoodLogPatch`. */}
      <CatalogLinkSheet
        visible={linkingEntry !== null}
        subject={linkingEntry?.label ?? ''}
        items={items}
        products={itemProducts}
        initialQuery={linkingEntry?.label ?? ''}
        currentItemId={linkingEntry?.itemId ?? null}
        currentProductId={linkingEntry?.productId ?? null}
        onClose={() => setLinkingEntry(null)}
        onPick={(item, product) => {
          // Both, together. The sheet has just asked each question in turn, so
          // a box left over from the previous item can't survive here — and
          // where the item has no boxes at all, `product` is null, which is the
          // same answer the old single-step pick wrote.
          if (linkingEntry) {
            updateEntry(linkingEntry.id, { itemId: item.id, productId: product?.id ?? null });
          }
          setLinkingEntry(null);
        }}
      />
      <NutrientContributorsSheet
        visible={contributorsKey !== null}
        nutrientKey={contributorsKey}
        entries={dayEntries}
        onClose={() => setContributorsKey(null)}
      />
      <NutritionTargetsSheet
        visible={targetsOpen}
        onClose={() => setTargetsOpen(false)}
      />
      {/* The app's own date picker, as CLAUDE.md's note on it says to reach for
          any time a feature asks "what date?". Time of day and Suggest are off:
          this picks which day to read, not a task's schedule. allowFuture is
          off too — a food log entry records what was eaten, which a day that
          hasn't happened yet has no answer for, same reasoning
          MoodLogSheet's own allowFuture={false} rests on. */}
      <WhenPicker
        visible={dayPickerOpen}
        value={dayDate}
        title="Which day"
        showTimeOfDay={false}
        showSuggest={false}
        allowFuture={false}
        onConfirm={date => {
          setDayPickerOpen(false);
          if (!date) return;
          haptics.tap();
          exitSelection();
          setDayKey(dayKeyOf(date));
        }}
        onCancel={() => setDayPickerOpen(false)}
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
    dayNavCenter: { alignItems: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
    dayNavDateText: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    dayNavBackText: { color: colors.accent, fontSize: font.xs, marginTop: 2 },
    scrollContent: { flexGrow: 1, paddingHorizontal: spacing.md },
    totalsCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    totalBlock: { gap: spacing.xs },
    totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    targetTrack: { height: 4, borderRadius: 2, backgroundColor: colors.separator, overflow: 'hidden' },
    targetFill: { height: '100%', borderRadius: 2, backgroundColor: colors.accent },
    totalLabel: { color: colors.text, fontSize: font.sm },
    totalRight: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    totalValue: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    totalCoverage: { color: colors.textSecondary, fontSize: font.xs },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    sectionTotal: { color: colors.textSecondary, fontSize: font.xs },
    entryRowSwipe: { borderRadius: radius.md, marginBottom: spacing.sm },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgSecondary,
    },
    // Opaque, not `colors.accentSubtle` directly: this can be applied the
    // instant a swipe-select commits, while `SwipeableRow`'s own panel is
    // still open behind this row mid-close-animation. A translucent
    // background there lets the panel's solid color bleed through for the
    // whole close, then vanish abruptly when the panel finally snaps shut —
    // reading as a transparency glitch rather than the row settling into its
    // selected tint. Flattening it against the row's own resting background
    // keeps the same look in the normal (non-swiping) selected state.
    entryRowSelected: { backgroundColor: flattenOverlay(colors.accentSubtle, colors.bgSecondary) },
    entryRowActive: { backgroundColor: colors.bgTertiary },
    entryContent: {
      flex: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    entryText: { gap: 2 },
    entryTitle: { color: colors.text, fontSize: font.md },
    entryMeta: { color: colors.textSecondary, fontSize: font.sm },
    entryMenuButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
    entrySelectDot: { paddingHorizontal: spacing.md },
    dropSlot: { borderRadius: radius.md, backgroundColor: colors.bgTertiary, marginBottom: spacing.sm },
  });
}

/**
 * One entry's row. Swipe left enters bulk selection (same contract every
 * other list in the app uses); long press drags it — across a meal boundary
 * as readily as within one — and is off for the duration of a selection, the
 * same trade Templates/Projects/People all make. The "…" button that takes
 * the checkbox's place outside selection mode is the one surviving way to
 * forget a single entry: deleting doesn't belong on a swipe (see
 * `SwipeableRow`'s own doc comment), and there's no per-entry editor to hang
 * it off, so the bulk bar is the only other route.
 */
const FoodLogRow = React.memo(function FoodLogRow({
  entry, isActive, selectionMode, selected, drag, styles, colors, onToggleSelect, onSwipeSelect, onOpenMenu,
}: {
  entry: FoodLogEntry;
  isActive: boolean;
  selectionMode: boolean;
  selected: boolean;
  drag?: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  // Each takes what it acts on rather than being closed over it, so the screen
  // can hand every row the same stable function and the memo above holds. An
  // inline arrow per row is a fresh identity per render and defeats it, which
  // is the same rule `renderTaskRow`'s `rowKey` exists for on Today.
  onToggleSelect: (entryId: string) => void;
  onSwipeSelect: (entryId: string) => void;
  onOpenMenu: (entry: FoodLogEntry) => void;
}) {
  const paintRef = usePaintSelectionRow(entry.id);
  // Bound once per row rather than per render of the list above it.
  const toggleSelect = () => onToggleSelect(entry.id);
  const rowBody = (
    <View
      ref={paintRef}
      style={[styles.entryRow, selectionMode && selected && styles.entryRowSelected, isActive && styles.entryRowActive]}
    >
      <TouchableOpacity
        style={styles.entryContent}
        activeOpacity={interaction.activeOpacity}
        // Outside selection mode the row has never been tappable — the "…"
        // button is the affordance and there's no per-entry editor to open —
        // but the touchable itself must stay enabled so onLongPress still
        // starts a drag; a `disabled` row swallows every gesture, drag
        // included, not just the tap.
        onPress={selectionMode ? toggleSelect : undefined}
        onLongPress={drag}
        delayLongPress={interaction.delayLongPress}
        accessibilityRole={selectionMode ? 'checkbox' : undefined}
        accessibilityState={selectionMode ? { checked: selected } : undefined}
        accessibilityLabel={`${entry.label}. ${describeFoodLogEntry(entry)}`}
      >
        <View style={styles.entryText}>
          <Text style={styles.entryTitle}>{entry.label}</Text>
          <Text style={styles.entryMeta}>{describeFoodLogEntry(entry)}</Text>
        </View>
      </TouchableOpacity>
      {selectionMode ? (
        <View style={styles.entrySelectDot}>
          <SelectionDot selected={selected} onPress={toggleSelect} />
        </View>
      ) : (
        <TouchableOpacity
          style={styles.entryMenuButton}
          onPress={() => onOpenMenu(entry)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${entry.label}`}
        >
          <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </View>
  );
  return (
    <SwipeableRow
      style={styles.entryRowSwipe}
      enabled={!selectionMode}
      selectAction={{ onSelect: () => onSwipeSelect(entry.id), accessibilityLabel: `Select ${entry.label}` }}
    >
      {rowBody}
    </SwipeableRow>
  );
});
