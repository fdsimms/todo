import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { SpotlightScrim } from './SpotlightOverlay';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, interaction, type Colors } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useMealSkipStore } from '../store/useMealSkipStore';
import { describeProductOfItem } from '../utils/groceryProduct';
import { MEAL_SLOT_ICONS, MEAL_SLOT_LABELS, type FoodLogEntry, type MealPlanEntry, type MealSlot, type Recipe } from '../types';
import { titleForEntry } from '../utils/mealPlan';
import { isMealStripDone, mealStripCells, mealStripSlots, type MealStripCell } from '../utils/mealStrip';
import { recipeLinkUrl } from '../utils/mealSlotTasks';
import { openInAppUrl } from '../utils/deepLinks';
import { resetToFoodLog, resetToMealPlan } from '../navigation/navigationRef';
import { RecipePickerSheet } from './RecipePickerSheet';
import { usePlanMeal } from '../hooks/usePlanMeal';
import { dayKeyToDate } from '../utils/dateUtils';
import { format } from 'date-fns/format';
import { animateLayout } from '../utils/layoutAnimation';
import { haptics } from '../utils/haptics';

interface Props {
  /** The logical day the strip is about (Today's `todayKey`). */
  dayKey: string;
  /**
   * Anything that changes when Today re-reads its day (its minute tick). The
   * plan and the log are read through functions that fall back to SQLite when
   * the day is outside a screen's window, which no subscription can see, so
   * this is what keeps a write made elsewhere from waiting for a remount.
   */
  refreshKey?: unknown;
}

/**
 * The day's meals as one line at the top of Today (`mealsOnToday: 'top'`),
 * standing in for the meal tasks. See `src/utils/mealStrip.ts` for what each
 * cell says and why; this file draws it and owns the menu a tap opens.
 *
 * The menu is a popover off the tapped meal (`CardSheet` with an anchor), and
 * every action it offers already exists elsewhere: the food log's sheet for a
 * meal (`setPendingManualMealLog`), the meal plan's picker (`RecipePickerSheet`,
 * mounted here so choosing a meal leaves you on Today), the meal plan's own cooked toggle (`setCookedPaired`), the
 * recipe link a meal task carried. The strip is a shortcut into those, not a
 * second meal planner. Skip is the one thing it writes of its own
 * (`useMealSkipStore`), since nothing else stores a meal that didn't happen.
 */
export function MealStrip({ dayKey, refreshKey }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const enabled = useSettingsStore(useShallow(s => s.mealSlotsEnabled));
  const planWindow = useMealPlanStore(s => s.entries);
  const logCount = useFoodLogStore(s => s.totalCount);
  const logWindow = useFoodLogStore(s => s.entries);
  const recipes = useRecipeStore(s => s.recipes);
  const itemProducts = useGroceryStore(s => s.itemProducts);
  const items = useGroceryStore(s => s.items);
  const skips = useMealSkipStore(s => s.skips);
  const [menu, setMenu] = useState<{ cell: MealStripCell; anchor: CardAnchor } | null>(null);
  // The slot whose picker is open. Mounted here, like a meal task's Choose
  // step does, so picking leaves you on Today rather than the Meal Plan tab.
  const [pickSlot, setPickSlot] = useState<MealSlot | null>(null);
  const planMeal = useMealPlanStore(s => s.planMeal);
  const removeMealPlanEntry = useMealPlanStore(s => s.removeEntry);
  const { offerPrepTasksForEach } = usePlanMeal();

  const recipesById = useMemo(() => new Map<string, Recipe>(recipes.map(r => [r.id, r])), [recipes]);
  const slots = useMemo(() => mealStripSlots(enabled), [enabled]);
  const cells = useMemo(() => {
    const planned = useMealPlanStore.getState().entriesForDayLive(dayKey);
    const logged = useFoodLogStore.getState().recentEntries(dayKey, dayKey);
    // A log entry from a product is labeled "item, product". The strip says
    // one or the other: the product when there is one, else the item.
    const logLabelOf = (e: FoodLogEntry) => {
      const product = e.productId ? itemProducts.find(p => p.id === e.productId) : null;
      const item = e.itemId ? items.find(i => i.id === e.itemId) : null;
      return (product && describeProductOfItem(product, item?.name)) || e.label;
    };
    const skipped = skips.filter(s => s.dayKey === dayKey).map(s => s.slot);
    return mealStripCells(slots, planned, logged, dayKey, e => titleForEntry(e, recipesById), logLabelOf, skipped);
    // The window and count deps aren't read here: they're the signal that a
    // read of the day would now come back different (see `refreshKey`).
  }, [slots, dayKey, recipesById, itemProducts, items, skips, planWindow, logCount, logWindow, refreshKey]);

  const open = (cell: MealStripCell, e: GestureResponderEvent) => {
    haptics.tap();
    setMenu({ cell, anchor: { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY } });
  };

  return (
    <View style={styles.card}>
      {cells.map((cell, i) => {
        const label = MEAL_SLOT_LABELS[cell.slot];
        const done = isMealStripDone(cell);
        return (
          <React.Fragment key={cell.slot}>
            {i > 0 && <View style={styles.sep} />}
            <TouchableOpacity
              style={styles.cell}
              onPress={e => open(cell, e)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={cellAccessibilityLabel(cell)}
              accessibilityHint="Opens options for this meal"
            >
              <View style={styles.labelRow}>
                <Ionicons
                  name={MEAL_SLOT_ICONS[cell.slot] as keyof typeof Ionicons.glyphMap}
                  size={12}
                  color={colors.textSecondary}
                />
                <Text style={styles.label} numberOfLines={1}>{label}</Text>
                {done && <Ionicons name="checkmark-circle" size={14} color={colors.done} />}
                {cell.state === 'skipped' && <Ionicons name="ban-outline" size={13} color={colors.textTertiary} />}
              </View>
              {cell.state === 'skipped'
                ? <Text style={styles.skipped} numberOfLines={1}>Skipped</Text>
                : cell.text
                  ? <Text style={styles.value} numberOfLines={2}>{cell.text}</Text>
                  : <View style={styles.choose}><Text style={styles.chooseText}>Choose</Text></View>}
            </TouchableOpacity>
          </React.Fragment>
        );
      })}
      <MealStripMenu
        dayKey={dayKey}
        cell={menu?.cell ?? null}
        anchor={menu?.anchor ?? null}
        titleOf={e => titleForEntry(e, recipesById)}
        onPick={setPickSlot}
        onClose={() => setMenu(null)}
      />
      <RecipePickerSheet
        visible={pickSlot !== null}
        dayKey={dayKey}
        dayLabel={format(dayKeyToDate(dayKey), 'EEEE')}
        defaultSlot={pickSlot ?? cells[0]?.slot ?? 'breakfast'}
        forceSlot={pickSlot}
        onPlan={planMeal}
        onPlanned={offerPrepTasksForEach}
        onUnplan={removeMealPlanEntry}
        onClose={() => setPickSlot(null)}
      />
      {/* The strip sits in the list header, which is elevated above the spotlight
          overlay, so it has to dim itself like the task rows and headers do. The
          wrapper rounds the scrim to the card's corners. */}
      <View style={styles.scrimClip} pointerEvents="none">
        <SpotlightScrim />
      </View>
    </View>
  );
}

function cellAccessibilityLabel(cell: MealStripCell): string {
  const label = MEAL_SLOT_LABELS[cell.slot];
  switch (cell.state) {
    case 'logged': return `${label}, logged: ${cell.text ?? ''}`;
    case 'eaten': return `${label}, eaten: ${cell.text ?? ''}`;
    case 'skipped': return `${label}, skipped`;
    case 'planned': return `${label}, planned: ${cell.text ?? ''}`;
    case 'empty': return `${label}, not chosen yet`;
  }
}

interface MenuItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  run: () => void;
}

/** The menu's rows for one meal, most likely first. */
function menuItems(
  dayKey: string,
  cell: MealStripCell,
  titleOf: (entry: MealPlanEntry) => string,
  onPick: (slot: MealSlot) => void,
): MenuItem[] {
  const slot: MealSlot = cell.slot;
  const lower = MEAL_SLOT_LABELS[slot].toLowerCase();
  const entry = cell.planned[0] ?? null;
  // The food log's own sheet for this meal, empty or seeded with what's
  // planned, so logging something other than the plan is the same tap.
  const logManually = (label = ''): MenuItem => ({
    key: 'log',
    icon: 'create-outline',
    label: cell.state === 'logged' ? `Log more for ${lower}` : 'Log what I ate',
    run: () => useFoodLogStore.getState().setPendingManualMealLog({ label, slot, dayKey, mealPlanEntryId: null }),
  });
  const plan: MenuItem = { key: 'plan', icon: 'calendar-outline', label: 'Plan it', run: () => onPick(slot) };
  const openPlan: MenuItem = { key: 'openPlan', icon: 'calendar-outline', label: 'Open meal plan', run: () => resetToMealPlan(dayKey) };
  // A skip is the strip's own record (`useMealSkipStore`), undone from the
  // same toast an Ate it is.
  const skip: MenuItem = {
    key: 'skip',
    icon: 'ban-outline',
    label: `Skip ${lower}`,
    run: () => {
      const undo = useMealSkipStore.getState().setSkipped(dayKey, slot, true);
      if (!undo) return;
      useMealPlanStore.getState().setLastAction({ label: `Skipped ${lower}`, undo });
    },
  };
  const openRecipe: MenuItem | null = entry?.recipeId && !entry.leftoverId
    ? { key: 'recipe', icon: 'restaurant-outline', label: 'Open recipe', run: () => { openInAppUrl(recipeLinkUrl(entry.recipeId as string, entry.id)); } }
    : null;

  switch (cell.state) {
    case 'empty':
      return [logManually(), plan, skip];
    case 'skipped':
      return [
        {
          key: 'unskip',
          icon: 'arrow-undo-outline',
          label: 'Not skipped',
          run: () => { useMealSkipStore.getState().setSkipped(dayKey, slot, false); },
        },
        logManually(),
      ];
    case 'planned': {
      if (!entry) return [logManually(), plan, skip];
      const title = titleOf(entry);
      const ateIt: MenuItem = {
        key: 'ate',
        icon: 'checkmark-circle-outline',
        label: 'Ate it',
        run: () => {
          // The meal plan's own cooked toggle, so everything a ticked meal
          // task set off follows from setCooked: the recipe's counters, the
          // cook recap, the log offer, the leftover ask and the coins
          // (syncMealStripCoins).
          const undo = useMealPlanStore.getState().setCookedPaired(entry.id, true);
          if (!undo) return;
          animateLayout();
          useMealPlanStore.getState().setLastAction({ label: `Ate “${title}”`, undo });
        },
      };
      return [ateIt, ...(openRecipe ? [openRecipe] : []), logManually(), skip, openPlan];
    }
    case 'eaten': {
      const items: MenuItem[] = [];
      // The planned meal's own log offer: the auto-computed helping for a
      // recipe, the search sheet seeded with its name for anything else.
      if (entry) items.push({
        key: 'logPlanned',
        icon: 'create-outline',
        label: `Log ${titleOf(entry)}`,
        run: () => useFoodLogStore.getState().offerMealLog(entry, { asked: true }),
      });
      items.push(logManually());
      if (entry) items.push({
        key: 'notEaten',
        icon: 'arrow-undo-outline',
        label: 'Not eaten yet',
        run: () => { useMealPlanStore.getState().setCookedPaired(entry.id, false); },
      });
      items.push(openPlan);
      return items;
    }
    case 'logged':
      return [
        { key: 'foodLog', icon: 'nutrition-outline', label: 'Open food log', run: () => resetToFoodLog() },
        logManually(),
      ];
  }
}

function MealStripMenu({ dayKey, cell, anchor, titleOf, onPick, onClose }: {
  dayKey: string;
  cell: MealStripCell | null;
  anchor: CardAnchor | null;
  titleOf: (entry: MealPlanEntry) => string;
  onPick: (slot: MealSlot) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  // Kept through the fade-out, so the rows don't vanish while the card does.
  const [shown, setShown] = useState<MealStripCell | null>(cell);
  if (cell && cell !== shown) setShown(cell);
  const items = shown ? menuItems(dayKey, shown, titleOf, onPick) : [];

  return (
    <CardSheet
      name="MealStripMenu"
      visible={!!cell}
      onClose={onClose}
      controller={card}
      anchor={anchor}
      popoverWidth={250}
      scrimLabel="Close menu"
    >
      {shown && <Text style={styles.menuTitle}>{MEAL_SLOT_LABELS[shown.slot]}</Text>}
      {items.map(item => (
        <React.Fragment key={item.key}>
          <View style={styles.menuSep} />
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => {
              haptics.tap();
              // After the fade, so a sheet the action raises (the food log's)
              // doesn't ask to present while this one still is.
              card.close(item.run);
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <Ionicons name={item.icon} size={18} color={colors.accent} />
            <Text style={styles.menuLabel} numberOfLines={2}>{item.label}</Text>
          </TouchableOpacity>
        </React.Fragment>
      ))}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  scrimClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  card: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    paddingVertical: spacing.smd,
    // Tall enough for a label plus a two-line meal, so the strip doesn't change
    // height as meals are chosen. A minimum, so a larger text size can still grow it.
    minHeight: 80,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.bgSecondary,
  },
  sep: { width: border.hairline, backgroundColor: colors.separator },
  cell: { flex: 1, paddingHorizontal: spacing.smd, gap: spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: { flexShrink: 1, fontSize: font.xs, color: colors.textSecondary },
  value: { fontSize: font.sm, lineHeight: 18, color: colors.text },
  skipped: { fontSize: font.sm, lineHeight: 18, color: colors.textTertiary },
  choose: {
    alignSelf: 'flex-start',
    // Sits on the card's bottom edge, level with the last line of a filled cell.
    marginTop: 'auto',
    backgroundColor: colors.accentFill,
    borderRadius: radius.full,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xxs + 1,
  },
  chooseText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.onAccent },
  menuTitle: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.xsm,
  },
  menuSep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  menuLabel: { flex: 1, fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
});
