import React, { useState, useMemo } from 'react';
import { View, Platform } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { UnitSystem } from '../../utils/unitConvert';
import { useGroceryStore } from '../../store/useGroceryStore';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { PillGroup } from '../../components/PillGroup';
import { StandingSwapsSheet } from '../../components/StandingSwapsSheet';
import { standingSwaps } from '../../utils/standingSwaps';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';
import { CURRENCY_SYMBOLS, CURRENCY_SYMBOL_MAX_LENGTH } from '../../types';

/**
 * The groceries/recipes/meal-plan area's own settings — what it puts on Today,
 * how it states amounts, and what it swaps for you.
 *
 * These were five sections at the bottom of Tasks & projects, behind a
 * `{kitchenEnabled && …}` that hid a third of that screen in one go. They are
 * a group of their own now, gated at the group level the way `iosOnly` gates
 * Reminders & Calendar, so the master switch adds and removes a row on the
 * Settings index rather than silently changing the length of another screen.
 *
 * **The master switch itself is deliberately not here.** It stays in Tasks &
 * projects under Feature areas, beside simplified mode, for the reason its
 * index entry is unflagged: a switch that hid itself when switched off would be
 * a setting with no way back. A group that vanishes has to be reached from
 * somewhere that doesn't.
 */
const UNIT_SYSTEM_OPTIONS: SegmentOption<UnitSystem>[] = [
  { value: 'asWritten', label: 'As written' },
  { value: 'metric', label: 'Metric' },
  { value: 'us', label: 'US' },
];

export function KitchenSettings() {
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const mealsOnToday = useSettingsStore(s => s.mealsOnToday);
  const setMealsOnToday = useSettingsStore(s => s.setMealsOnToday);
  const kitchenOnToday = useSettingsStore(s => s.kitchenOnToday);
  const setKitchenOnToday = useSettingsStore(s => s.setKitchenOnToday);
  const cookRecapEnabled = useSettingsStore(s => s.cookRecapEnabled);
  const setCookRecapEnabled = useSettingsStore(s => s.setCookRecapEnabled);
  const restockOfferEnabled = useSettingsStore(s => s.restockOfferEnabled);
  const setRestockOfferEnabled = useSettingsStore(s => s.setRestockOfferEnabled);
  const tripLiveActivity = useSettingsStore(s => s.tripLiveActivity);
  const setTripLiveActivity = useSettingsStore(s => s.setTripLiveActivity);
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const setUnitSystem = useSettingsStore(s => s.setUnitSystem);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const setCurrencySymbol = useSettingsStore(s => s.setCurrencySymbol);

  // How many substitutes the app is currently applying on its own (#1571) —
  // the count on the Standing swaps row, and the reason it reads as active.
  // The resolved list, not a raw `standing` count: a rule whose other half has
  // gone isn't being applied to anything.
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const standingSwapCount = useMemo(
    () => standingSwaps(itemSubs, groceryItems).length,
    [itemSubs, groceryItems]
  );

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const [standingSwapsVisible, setStandingSwapsVisible] = useState(false);

  return (
    <>
      <SettingsSection
        label="Meals on Today"
        footer="A planned meal that doesn't have one of the tasks from Automatic tasks shows as a plain row here instead, filed under the same category as meal tasks, and so does anything in the pantry about to go off, above it. Neither can be checked off; tapping opens the meal plan or the pantry."
      >
        {/* A toggle rather than a track of two: one bounded choice with two
            answers is what a switch is for, and the two shapes this used to
            pick between (a tray above the tasks, a one-line strip) are both
            gone. */}
        <SettingsRow
          entryId="mealsOnToday"
          icon="restaurant-outline"
          iconColor={mealsOnToday === 'inline' ? colors.accent : undefined}
          label="Show the day's meals"
          hint={mealsOnToday === 'inline'
            ? "As rows in the task list, for planned meals without a task from Automatic tasks"
            : 'Nothing. Meals stay on the Meal plan tab'}
          toggle={mealsOnToday === 'inline'}
          onPress={() => setMealsOnToday(mealsOnToday === 'inline' ? 'off' : 'inline')}
          accessibilityLabel="Show the day's meals"
        />
        {/* Filed in this section rather than under Automatic tasks, because
            it is not a task the app adds: nothing is written, and the row
            leaves when the food does. What it shares with the meals is where
            it lands — the same category, at the top of the same section. */}
        {!simpleMode && (
        <SettingsRow
          entryId="kitchenOnToday"
          icon="nutrition-outline"
          iconColor={kitchenOnToday ? colors.accent : undefined}
          label="Show what needs using up"
          hint="A row on the day something in the pantry is down to its last day, unless it already has a use-up task."
          toggle={kitchenOnToday}
          onPress={() => setKitchenOnToday(!kitchenOnToday)}
          accessibilityLabel="Show what needs using up"
        />
        )}
        <SettingsRow
          entryId="cookRecapEnabled"
          icon="restaurant-outline"
          iconColor={cookRecapEnabled ? colors.accent : undefined}
          label="Ask after cooking"
          hint="When you mark a meal cooked, ask how it was, whether there are leftovers, and what it used up."
          toggle={cookRecapEnabled}
          onPress={() => setCookRecapEnabled(!cookRecapEnabled)}
          accessibilityLabel="Ask after cooking"
        />
        {/* Indented under nothing, but it only does anything while the row
            above is on: it governs one section of that sheet. Left as its own
            row rather than folded in because "never shop from a recipe" and
            "don't ask me anything" are different wants. */}
        <SettingsRow
          entryId="restockOfferEnabled"
          icon="basket-outline"
          iconColor={restockOfferEnabled ? colors.accent : undefined}
          label="Restock after cooking"
          hint="Include what the meal used that isn't on your shopping list, with a button to add it."
          toggle={restockOfferEnabled}
          onPress={() => setRestockOfferEnabled(!restockOfferEnabled)}
          accessibilityLabel="Restock after cooking"
        />
      </SettingsSection>

      {Platform.OS === 'ios' && !simpleMode && (
        <SettingsSection
          label="Shopping trip"
          footer="Requires iOS 17. Ends when you clear or finish the trip, or automatically after about 6 hours."
        >
          <SettingsRow
            entryId="tripLiveActivity"
            icon="phone-portrait-outline"
            iconColor={tripLiveActivity ? colors.accent : undefined}
            label="Live Activity while shopping"
            hint={tripLiveActivity
              ? 'The store you\'re at and how long you\'ve been there shows on the Lock Screen and Dynamic Island'
              : 'A trip stays in the app only'}
            toggle={tripLiveActivity}
            onPress={() => setTripLiveActivity(!tripLiveActivity)}
          />
        </SettingsSection>
      )}

      <SettingsSection
        label="Recipe & grocery amounts"
        footer="Only what's shown changes. Recipes and the grocery list keep the amounts that were typed, and editing one shows it as written. Converted amounts are rounded, and marked with ≈. Counts, container sizes like “14 oz can”, and amounts with no number are left alone."
      >
        <SettingsRow
          entryId="unitSystem"
          icon="swap-horizontal-outline"
          iconColor={unitSystem === 'asWritten' ? undefined : colors.accent}
          label="Units"
          hint={
            unitSystem === 'metric'
              ? 'Ounces, pounds, cups and spoons show in grams and millilitres'
              : unitSystem === 'us'
                ? 'Grams, kilograms and millilitres show in ounces, pounds and cups'
                : 'Amounts show exactly as they were typed'
          }
          tight
        />
        <SettingsSegments
          attached
          options={UNIT_SYSTEM_OPTIONS}
          selected={unitSystem}
          onSelect={setUnitSystem}
          accessibilityLabelFor={o => `Units: ${o.label}`}
        />
        <SettingsRow
          entryId="currencySymbol"
          icon="pricetag-outline"
          label="Currency"
          hint="The symbol grocery prices are shown with."
          tight
        />
        <View style={styles.pillGroupRow}>
          <PillGroup
            noun="symbol"
            filterPlaceholder="Find or type a symbol…"
            createMaxLength={CURRENCY_SYMBOL_MAX_LENGTH}
            onCreate={raw => {
              const trimmed = raw.trim();
              if (!trimmed) return 'Enter a symbol.';
              if (/\s/.test(trimmed)) return 'No spaces in a symbol.';
              setCurrencySymbol(trimmed);
            }}
            options={[
              // A custom symbol already in use has no pill of its own among
              // the presets below, so it gets a pinned one — otherwise
              // setting it once would make it vanish from its own picker.
              ...(CURRENCY_SYMBOLS.includes(currencySymbol) ? [] : [{
                key: '__current__',
                label: currencySymbol,
                pinned: true,
                selected: true,
                onPress: () => {},
              }]),
              ...CURRENCY_SYMBOLS.map(symbol => ({
                key: symbol,
                label: symbol,
                selected: currencySymbol === symbol,
                accessibilityLabel: `Currency: ${symbol}`,
                onPress: () => { haptics.tap(); setCurrencySymbol(symbol); },
              })),
            ]}
          />
        </View>
      </SettingsSection>

      {/* The review surface for the one substitute setting that changes what
          lands in the trolley (#1571). The rule itself is written where the
          pair is, on the item's Substitutes field — this is the "what is the
          app currently rewriting for me" read, which is the thing a link-level
          bit on its own can't answer. */}
      {!simpleMode && (
      <SettingsSection
        label="Substitutes"
        footer="A substitute normally just says what you could use instead. One marked “always use this instead” is applied for you: recipes calling for the original show and shop for the substitute, marked with what the recipe said. Nothing is written to the recipe, and a single line can opt out under “Keep as written”."
      >
        <SettingsRow
          entryId="standingSwaps"
          icon="swap-horizontal-outline"
          iconColor={standingSwapCount > 0 ? colors.accent : undefined}
          label="Standing swaps"
          hint={standingSwapCount > 0
            ? 'Substitutes being applied to every recipe that calls for the original'
            : 'Nothing is being swapped for you'}
          value={standingSwapCount > 0 ? String(standingSwapCount) : undefined}
          chevron
          onPress={() => { haptics.tap(); setStandingSwapsVisible(true); }}
        />
      </SettingsSection>
      )}

      <StandingSwapsSheet
        visible={standingSwapsVisible}
        onClose={() => setStandingSwapsVisible(false)}
      />
    </>
  );
}
