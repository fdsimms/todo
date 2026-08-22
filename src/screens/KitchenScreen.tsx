import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SectionList,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  iconSize,
  interaction,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useRecipeStore } from '../store/useRecipeStore';
import {
  buildKitchenSections,
  describeKitchen,
  kitchenInventory,
  useUpEntries,
  type KitchenEntry,
} from '../utils/kitchenInventory';
import { describeUseUpRecipe, useUpRecipes } from '../utils/useUpRecipes';
import { groceryNameKey } from '../utils/groceryParse';
import { ScreenHeader } from '../components/ScreenHeader';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { PressableScale } from '../components/PressableScale';
import { GroceryItemSheet } from '../components/GroceryItemSheet';
import { LeftoverSheet } from '../components/LeftoverSheet';
import { BarcodeScanSheet } from '../components/BarcodeScanSheet';
import type { ReceiptAddDraft } from '../components/ReceiptImportSheet';
import { freshnessColor } from '../components/LeftoversCard';
import { useNowTick } from '../hooks/useNowTick';
import { haptics } from '../utils/haptics';

/**
 * Everything the app currently thinks is in your kitchen, in one place — the
 * pantry it works out from what you buy, and the fridge you've logged
 * containers into.
 *
 * It used to be the pantry alone, and the fridge answered the same question
 * two screens away on the meal plan with its own vocabulary. A bag of spinach
 * going off Thursday and a container of chilli going off Thursday are the same
 * fact to the cook (#1670), so the rows come from one derivation
 * (`utils/kitchenInventory.ts`) with one freshness ladder, and what's about to
 * be wasted sorts to the top of whatever heading it's under.
 *
 * The fourth of the Groceries/Recipes/Meal plan hub (`GroceriesHubPills`),
 * rather than a sheet popped over Groceries — see that component's doc
 * comment for why it moved. Displayed as "Pantry" (`GroceriesHubPills`'
 * label, and this screen's own `ScreenHeader` title) while the route, this
 * file and everything in `kitchenInventory.ts` keep the `Kitchen`/`kitchen*`
 * name — see `GroceriesHubPills`' doc comment for why the two differ.
 *
 * **The corrections stay where the thing lives.** A catalog row's trailing ✕
 * is the one this screen exists for most — it writes exactly what
 * `GroceryItemSheet`'s "Out of it" pill writes (`markOutOfMany`, same call
 * `CookedUseUpSheet` batches), in one tap, with the same undo everything else
 * in that store gets — and the row itself opens `GroceryItemSheet` with the
 * Pantry pills already showing (`initialField`) for anything past that one
 * bit. **A container carries no ✕**, deliberately: closing one out is a
 * two-way question ("Eaten" / "Thrown out") that a single glyph can't ask, and
 * guessing "eaten" would quietly write a fridge-history row the user never
 * chose. Its row opens `LeftoverSheet`, which asks properly.
 *
 * The two things this screen writes by itself are `addToPantry`, off the
 * field at the top, and `addManyToPantry`, off the barcode action in the
 * header — the same one-bit assertion the item sheet's "Got it" pill writes,
 * one name or a whole scan session at a time. They exist because that
 * correction was unreachable for anything with no row yet: you can only open
 * an item's sheet from the list or from Buy again, so "I have flour" was
 * unsayable until flour had been bought through the app at least once. Both
 * add to the pantry and never to the fridge; a container is something you
 * cooked, which is what `LeftoverSheet`'s log flow is for. The scan sheet
 * itself is shared with `GroceryScreen` (`BarcodeScanSheet`, `context` prop)
 * — same camera and lookup, only the row wording and the write path differ.
 *
 * That keeps the model the one #1040 settled on — computed from what you buy,
 * corrected when it's wrong, never an inventory anybody has to keep up.
 * Quantities, per-row expiry editing and checking things back in are the
 * inventory, and stay out.
 */
export function KitchenScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  const items = useGroceryStore(useShallow(s => s.items));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const addToPantry = useGroceryStore(s => s.addToPantry);
  const addManyToPantry = useGroceryStore(s => s.addManyToPantry);
  const markOutOfMany = useGroceryStore(s => s.markOutOfMany);

  const recipes = useRecipeStore(useShallow(s => s.recipes));

  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const setLeftoverFrozen = useLeftoverStore(s => s.setFrozen);
  const reopenLeftover = useLeftoverStore(s => s.reopenLeftover);
  const deleteLeftover = useLeftoverStore(s => s.deleteLeftover);

  const [query, setQuery] = useState('');
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [openLeftoverId, setOpenLeftoverId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  // This screen never unmounts once visited (the drawer's tabs stay mounted
  // under `enableScreens(false)`), so a use-by day computed once at mount
  // would go stale the same way an unmemoized LeftoversCard row would — see
  // useNowTick's own doc comment (#1732).
  const nowMs = useNowTick();
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const entries = useMemo(
    () => kitchenInventory(items, leftovers, now),
    [items, leftovers, now]
  );
  const sections = useMemo(
    () => buildKitchenSections(entries, aisleOrder, query),
    [entries, aisleOrder, query]
  );

  // What to cook with what's dying. Off `useUpEntries` rather than the whole
  // kitchen, so this answers "what saves the spinach" and not "what could I
  // make for dinner" — the recipe list is already the second question.
  //
  // Hidden while the field has text: the field filters the list below to what
  // you're looking for, and a suggestion block that ignored the query would be
  // the one part of the screen not answering it.
  const suggestions = useMemo(
    () => (query ? [] : useUpRecipes(useUpEntries(entries), recipes)),
    [entries, recipes, query]
  );
  const shownSuggestions = useMemo(
    // Two, which is what fits above the fold without pushing the pantry itself
    // off screen. The block is an offer, not the content of the screen.
    () => suggestions.slice(0, 2),
    [suggestions]
  );

  // Inside the list's header rather than fixed above it, so it scrolls away
  // with the content it's about. The screen already spends its fixed height on
  // the hub pills and the find-or-add field; two more permanent rows would push
  // the pantry itself off the first screen, which is the thing the user came
  // for.
  const suggestionHeader = shownSuggestions.length === 0 ? null : (
    <View style={styles.suggestWrap}>
      <Text style={styles.sectionTitle}>Cook this before it goes</Text>
      {shownSuggestions.map(suggestion => (
        <TouchableOpacity
          key={suggestion.recipe.id}
          style={styles.suggestRow}
          activeOpacity={interaction.activeOpacity}
          onPress={() => {
            haptics.tap();
            navigation.navigate('RecipeDetail', { recipeId: suggestion.recipe.id });
          }}
          accessibilityRole="button"
          accessibilityLabel={`${suggestion.recipe.name}. ${describeUseUpRecipe(suggestion)}`}
          accessibilityHint="Opens the recipe"
        >
          <Ionicons name="restaurant-outline" size={iconSize.md} color={colors.accent} />
          <View style={styles.suggestBody}>
            <Text style={styles.suggestName} numberOfLines={1}>{suggestion.recipe.name}</Text>
            <Text style={styles.suggestMeta} numberOfLines={1}>
              {describeUseUpRecipe(suggestion)}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  // The grocery/leftover "Use up X" tasks' own link (resetToKitchen in
  // navigationRef.ts) and Today's kitchen context row both name one entry to
  // open straight to, rather than leaving the plain list for the user to find
  // it in. Same stamped-param handoff MealPlanScreen's focusDay/focusStamp
  // uses, so tapping the same link twice in a row still reopens the entry.
  const focusEntryId: string | undefined = route.params?.focusKitchenEntry;
  const focusStamp: number | undefined = route.params?.focusStamp;
  const [handledFocusStamp, setHandledFocusStamp] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (focusStamp === undefined || focusStamp === handledFocusStamp || !focusEntryId) return;
    setHandledFocusStamp(focusStamp);
    // A focus id that no longer resolves — the item was used up before the
    // link was tapped — just falls back to the plain list.
    const focused = entries.find(e => e.id === focusEntryId);
    if (!focused) return;
    if (focused.kind === 'leftover') setOpenLeftoverId(focused.sourceId);
    else setOpenItemId(focused.sourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntryId, focusStamp, handledFocusStamp]);

  // Read live from the store by id so the sheet's caption follows an edit it
  // just made.
  const openLeftover = useMemo(
    () => leftovers.find(l => l.id === openLeftoverId) ?? null,
    [leftovers, openLeftoverId]
  );

  // The field does both jobs, the way PillGroup's filter does: it narrows the
  // list, and what it can't find is what you're offered the chance to add. One
  // field rather than two because the question is the same one either way —
  // "do I have flour" is exactly the moment you find out you never told it.
  const typed = query.trim();
  const typedKey = groceryNameKey(typed);
  // Hidden once the typed name *is* one of these rows, so the add can't be
  // pressed to re-assert something the list is already showing. Matched
  // against every kind: a container called "Chilli" is an answer to "have I
  // got chilli" even though the add would file a catalog row.
  const canAdd =
    !!typed &&
    !entries.some(e => e.matchKey === (typedKey || typed.toLowerCase()));

  const handleAdd = () => {
    if (!addToPantry(typed)) {
      haptics.error();
      return;
    }
    haptics.success();
    // Cleared like every other add field in the app, so the next name can be
    // typed straight in; the row it just made is in the list behind it.
    setQuery('');
  };

  const handleMarkOut = (entry: KitchenEntry) => {
    haptics.tap();
    if (markOutOfMany([entry.sourceId]) > 0) haptics.success();
  };

  // The scan sheet only ever hands back which rows to check off a list
  // (itemIds) and which to mint or promote (toAdd) — shopping-list concepts
  // that don't apply here. What this screen wants out of a session is just
  // the names: an already-matched row's current name, or a new row's shopper
  // name, fed through addManyToPantry exactly like the typed field above.
  // `frozenItemIds`/`draft.frozen` carry the sheet's per-row freezer toggle;
  // both are reduced to the same name strings so addManyToPantry can match
  // them back up (see its own doc comment on why that's safe).
  const handleScanApply = (
    itemIds: string[],
    toAdd: ReceiptAddDraft[],
    frozenItemIds: ReadonlySet<string>
  ) => {
    const names = [
      ...itemIds
        .map(id => items.find(i => i.id === id)?.name)
        .filter((name): name is string => !!name),
      ...toAdd.map(draft => draft.name),
    ];
    const frozenNames = new Set([
      ...itemIds
        .filter(id => frozenItemIds.has(id))
        .map(id => items.find(i => i.id === id)?.name)
        .filter((name): name is string => !!name),
      ...toAdd.filter(draft => draft.frozen).map(draft => draft.name),
    ]);
    setScanOpen(false);
    if (names.length === 0) return;
    if (addManyToPantry(names, frozenNames) > 0) haptics.success();
  };

  const renderItem = ({ item: entry }: { item: KitchenEntry }) => {
    // Three levels for four states, the fridge card's own rule: `fresh` reads
    // as ordinary tertiary text, so most of a kitchen stays quiet and the one
    // thing going off is the one thing coloured.
    const tint = entry.freshness ? freshnessColor(entry.freshness, colors) : colors.textTertiary;
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={interaction.activeOpacity}
        onPress={() => {
          haptics.tap();
          if (entry.kind === 'leftover') setOpenLeftoverId(entry.sourceId);
          else setOpenItemId(entry.sourceId);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${entry.title}, ${entry.caption}`}
        accessibilityHint={
          entry.kind === 'leftover'
            ? 'Opens the container, where you can close it out'
            : 'Opens the item, where you can correct it further'
        }
      >
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{entry.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {entry.reason}
            {entry.onList && ' · on the list'}
            {!!entry.useByCaption && (
              <Text style={{ color: tint }}>{` · ${entry.useByCaption}`}</Text>
            )}
          </Text>
        </View>
        {/* The single most common action on a catalog row, one tap away rather
            than two — see the doc comment above. A container has none: "gone"
            is a two-way question there, and its row's tap asks it properly. */}
        {entry.kind === 'grocery' && (
          <PressableScale
            style={styles.outButton}
            onPress={() => handleMarkOut(entry)}
            hitSlop={8}
            accessibilityLabel={`Mark ${entry.title} out`}
            accessibilityHint="Marks it not on hand, without opening the item"
          >
            <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.textTertiary} />
          </PressableScale>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Pantry"
        subtitle={entries.length > 0 ? describeKitchen(entries) : undefined}
        actions={[
          {
            icon: 'barcode-outline',
            onPress: () => setScanOpen(true),
            accessibilityLabel: 'Scan a barcode into the pantry',
          },
        ]}
      />
      <GroceriesHubPills active="Kitchen" />

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
          onSubmitEditing={canAdd ? handleAdd : undefined}
          accessibilityLabel="Find something in the pantry, or type a name to add it"
        />
      </View>

      {canAdd && (
        <View style={styles.addWrap}>
          <InlineAction
            label={`Add “${typed}”`}
            icon="add"
            onPress={handleAdd}
            accessibilityLabel={`Add ${typed} to the pantry`}
          />
        </View>
      )}

      {/* The only in-app explanation of where this list comes from, so it
          says the mechanism rather than describing the feature. */}
      {entries.length > 0 && !typed && (
        <Text style={styles.caption}>
          Worked out from what you buy, what you&apos;ve marked, and what
          you&apos;ve put in the fridge. Tap ✕ to say you&apos;re out of something.
        </Text>
      )}

      <SectionList
        sections={sections}
        keyExtractor={entry => entry.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.section}</Text>
          </View>
        )}
        ListHeaderComponent={suggestionHeader}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // Full height when empty so the empty state's `flex: 1` has something
        // to centre in, and without the list's padding shifting that centre.
        contentContainerStyle={
          sections.length === 0
            ? styles.emptyContainer
            : [styles.list, { paddingBottom: tabBarHeight + spacing.xl }]
        }
        ListEmptyComponent={
          <EmptyState
            icon="file-tray-stacked-outline"
            title={typed ? 'Nothing matches' : 'Nothing in the pantry yet'}
            subtitle={
              typed
                ? 'Nothing you probably have goes by that name. Add it above to say you do.'
                : 'Finish a shopping trip and what you bought turns up here, along with anything you put in the fridge. Type a name above, or scan a barcode, to add something you already have.'
            }
            bottomOffset={tabBarHeight}
          />
        }
      />

      <GroceryItemSheet
        visible={openItemId !== null}
        itemId={openItemId}
        onClose={() => setOpenItemId(null)}
        // Opened on the Pantry pills, since that's what a catalog row here is:
        // the sheet is dense enough that a collapsed "Pantry" field halfway
        // down it was, in practice, no way to say you're out of something.
        initialField="pantry"
      />

      <BarcodeScanSheet
        visible={scanOpen}
        context="pantry"
        onClose={() => setScanOpen(false)}
        onApply={handleScanApply}
      />

      <LeftoverSheet
        visible={openLeftover !== null}
        leftover={openLeftover}
        // Never called: this sheet only ever opens an existing container, and
        // the log flow that would need it belongs to the meal plan, where a
        // cooking is what leaves something behind.
        onLog={() => {}}
        onRename={title => openLeftover && renameLeftover(openLeftover.id, title)}
        onSetStoredAt={storedAt => openLeftover && setLeftoverStoredAt(openLeftover.id, storedAt)}
        onSetKeepDays={days => openLeftover && setLeftoverKeepDays(openLeftover.id, days)}
        onFinish={outcome => openLeftover && finishLeftover(openLeftover.id, outcome)}
        onSetFrozen={frozen => openLeftover && setLeftoverFrozen(openLeftover.id, frozen)}
        onReopen={() => openLeftover && reopenLeftover(openLeftover.id)}
        onDelete={() => openLeftover && deleteLeftover(openLeftover.id)}
        onClose={() => setOpenLeftoverId(null)}
      />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
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
      // No lineHeight on a TextInput — RN maps it onto the iOS paragraph style
      // with no baseline compensation, so the glyphs sit low in the box.
      height: 40,
      padding: 0,
    },
    // Left-aligned under the field it belongs to, and only as wide as its
    // label — the pill is one option, not a submit button spanning the sheet.
    addWrap: {
      flexDirection: 'row',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    caption: {
      fontSize: font.sm,
      color: colors.textTertiary,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    list: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
    emptyContainer: { flexGrow: 1 },
    suggestWrap: {
      paddingHorizontal: spacing.md,
      // Both sides, not just the one that happened to matter: the caption
      // below has no top margin of its own.
      marginTop: spacing.md,
      marginBottom: spacing.md,
      gap: spacing.xs,
    },
    suggestRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
    },
    suggestBody: { flex: 1, minWidth: 0 },
    suggestName: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    suggestMeta: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
    sectionHeader: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    sectionTitle: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
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
    body: { flex: 1 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
    outButton: { padding: 2 },
  });
}
