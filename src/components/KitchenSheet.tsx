import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SectionList,
  StyleSheet,
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
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import {
  buildKitchenSections,
  describeKitchen,
  kitchenInventory,
  type KitchenEntry,
} from '../utils/kitchenInventory';
import { groceryNameKey } from '../utils/groceryParse';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { PressableScale } from './PressableScale';
import { GroceryItemSheet } from './GroceryItemSheet';
import { LeftoverSheet } from './LeftoverSheet';
import { freshnessColor } from './LeftoversCard';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

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
 * The one thing this screen writes by itself is `addToPantry`, off the field
 * at the top — the same one-bit assertion the item sheet's "Got it" pill
 * writes. It exists because that correction was unreachable for anything with
 * no row yet: you can only open an item's sheet from the list or from Buy
 * again, so "I have flour" was unsayable until flour had been bought through
 * the app at least once. It adds to the pantry and never to the fridge; a
 * container is something you cooked, which is what `LeftoverSheet`'s log flow
 * is for.
 *
 * That keeps the model the one #1040 settled on — computed from what you buy,
 * corrected when it's wrong, never an inventory anybody has to keep up.
 * Quantities, per-row expiry editing and checking things back in are the
 * inventory, and stay out.
 */
export function KitchenSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const addToPantry = useGroceryStore(s => s.addToPantry);
  const markOutOfMany = useGroceryStore(s => s.markOutOfMany);

  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const reopenLeftover = useLeftoverStore(s => s.reopenLeftover);
  const deleteLeftover = useLeftoverStore(s => s.deleteLeftover);

  const [query, setQuery] = useState('');
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [openLeftoverId, setOpenLeftoverId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setOpenItemId(null);
      setOpenLeftoverId(null);
    }
  }, [visible]);

  // Fixed for the life of one opening, like Buy again's: a `new Date()` per
  // render would recompute every cadence guess on each keystroke, and the
  // answer can't change while you're looking at it.
  const now = useMemo(() => new Date(), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = useMemo(
    () => kitchenInventory(items, leftovers, now),
    [items, leftovers, now]
  );
  const sections = useMemo(
    () => buildKitchenSections(entries, aisleOrder, query),
    [entries, aisleOrder, query]
  );

  // Read live from the store by id so the sheet's caption follows an edit it
  // just made — same discipline MealPlanScreen keeps for this sheet.
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          {/* Nothing to cancel — this sheet changes nothing by itself — so the
              left side is the spacer that keeps the title centred. */}
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Kitchen</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

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
            accessibilityLabel="Find something in the kitchen, or type a name to add it"
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
            {describeKitchen(entries)}. Worked out from what you buy, what you&apos;ve marked,
            and what you&apos;ve put in the fridge. Tap ✕ to say you&apos;re out of something.
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
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Full height when empty so the empty state's `flex: 1` has something
          // to centre in, and without the list's padding shifting that centre.
          contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="file-tray-stacked-outline"
              title={typed ? 'Nothing matches' : 'Nothing in the kitchen yet'}
              subtitle={
                typed
                  ? 'Nothing you probably have goes by that name. Add it above to say you do.'
                  : 'Finish a shopping trip and what you bought turns up here, along with anything you put in the fridge. Type a name above to add something you already have.'
              }
            />
          }
        />
      </View>

      {/* Both rendered inside this Modal rather than beside it, which is what
          lets them stack: a Modal presents from the view controller its React
          parent belongs to, so a sibling would be asking the screen's
          controller to present a second sheet while this one is already up.
          Keeping the kitchen mounted underneath is the point — correcting one
          row drops you back into the list rather than back to the shopping
          list. */}
      <GroceryItemSheet
        visible={openItemId !== null}
        itemId={openItemId}
        onClose={() => setOpenItemId(null)}
        // Opened on the Pantry pills, since that's what a catalog row here is:
        // the sheet is dense enough that a collapsed "Pantry" field halfway
        // down it was, in practice, no way to say you're out of something.
        initialField="pantry"
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
        onReopen={() => openLeftover && reopenLeftover(openLeftover.id)}
        onDelete={() => openLeftover && deleteLeftover(openLeftover.id)}
        onClose={() => setOpenLeftoverId(null)}
      />
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
    headerSpacer: { minWidth: 64 },
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
