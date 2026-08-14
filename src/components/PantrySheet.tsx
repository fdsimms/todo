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
import { buildPantrySections, pantryEntries, type PantryEntry } from '../utils/grocerySuggest';
import { groceryNameKey } from '../utils/groceryParse';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { PressableScale } from './PressableScale';
import { GroceryItemSheet } from './GroceryItemSheet';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Everything the app currently thinks you already have, in one place.
 *
 * The set is `probablyHaveReason`'s and the rows show that function's own
 * wording. The one thing it writes from the field at the top is the assertion
 * the item sheet's "Got it" pill already writes — `addToPantry` — because
 * that correction was unreachable for anything with no row yet: you can only
 * open an item's sheet from the list or from Buy again, so "I have flour" was
 * unsayable until flour had been bought through the app at least once.
 *
 * A row's trailing button is the other correction, and the one this screen
 * exists for most: it writes exactly what `GroceryItemSheet`'s "Out of it"
 * pill writes (`markOutOfMany`, same call `CookedUseUpSheet` batches), in one
 * tap, with the same undo everything else in that store gets. The full row
 * still opens `GroceryItemSheet` with the Pantry pills already showing
 * (`initialField`) for anything past that one bit — correcting quantity,
 * re-marking "got it," always-have-it.
 *
 * That keeps the model the one #1040 settled on — computed from what you buy,
 * corrected when it's wrong, never an inventory anybody has to keep up. The
 * add field says *that you have something*, which is the same one-bit fact the
 * pills say; quantities, expiry dates and checking things back in are the
 * inventory, and stay out.
 */
export function PantrySheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const addToPantry = useGroceryStore(s => s.addToPantry);
  const markOutOfMany = useGroceryStore(s => s.markOutOfMany);

  const [query, setQuery] = useState('');
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setOpenItemId(null);
    }
  }, [visible]);

  // Fixed for the life of one opening, like Buy again's: a `new Date()` per
  // render would recompute every cadence guess on each keystroke, and the
  // answer can't change while you're looking at it.
  const now = useMemo(() => new Date(), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(
    () => buildPantrySections(items, aisleOrder, now, query),
    [items, aisleOrder, now, query]
  );
  const total = useMemo(() => pantryEntries(items, now).length, [items, now]);

  // The field does both jobs, the way PillGroup's filter does: it narrows the
  // list, and what it can't find is what you're offered the chance to add. One
  // field rather than two because the question is the same one either way —
  // "do I have flour" is exactly the moment you find out you never told it.
  const typed = query.trim();
  const typedKey = groceryNameKey(typed);
  // Hidden once the typed name *is* one of these rows, so the add can't be
  // pressed to re-assert something the list is already showing.
  const canAdd =
    !!typed &&
    !sections.some(section =>
      section.data.some(e => e.item.nameKey === (typedKey || typed.toLowerCase()))
    );

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

  const handleMarkOut = (entry: PantryEntry) => {
    haptics.tap();
    if (markOutOfMany([entry.item.id]) > 0) haptics.success();
  };

  const renderItem = ({ item: entry }: { item: PantryEntry }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={interaction.activeOpacity}
      onPress={() => {
        haptics.tap();
        setOpenItemId(entry.item.id);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${entry.item.name}, ${entry.reason}`}
      accessibilityHint="Opens the item, where you can correct it further"
    >
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{entry.item.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {entry.reason}
          {entry.item.onList && ' · on the list'}
        </Text>
      </View>
      {/* The single most common action on this screen, one tap away rather
          than two — see the doc comment above. Replaces the chevron, which
          named a destination ("more is behind here") this row's tap still
          reaches; the destination doesn't need naming twice. */}
      <PressableScale
        style={styles.outButton}
        onPress={() => handleMarkOut(entry)}
        hitSlop={8}
        accessibilityLabel={`Mark ${entry.item.name} out`}
        accessibilityHint="Marks it not on hand, without opening the item"
      >
        <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.textTertiary} />
      </PressableScale>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          {/* Nothing to cancel — this sheet changes nothing by itself — so the
              left side is the spacer that keeps the title centred. */}
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Pantry</Text>
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
        {total > 0 && !typed && (
          <Text style={styles.caption}>
            {total} {total === 1 ? 'thing' : 'things'} you probably have, worked out from what you
            buy and what you&apos;ve marked. Tap ✕ on one to say you&apos;re out of it.
          </Text>
        )}

        <SectionList
          sections={sections}
          keyExtractor={entry => entry.item.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.aisle}</Text>
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
              title={typed ? 'Nothing matches' : 'Nothing in the pantry yet'}
              subtitle={
                typed
                  ? 'Nothing you probably have goes by that name. Add it above to say you do.'
                  : 'Finish a shopping trip and what you bought turns up here. Type a name above to add something you already have.'
              }
            />
          }
        />
      </View>

      {/* Rendered inside this Modal rather than beside it, which is what lets
          it stack: a Modal presents from the view controller its React parent
          belongs to, so a sibling would be asking the screen's controller to
          present a second sheet while this one is already up. Keeping the
          pantry mounted underneath is the point — correcting one item drops
          you back into the list rather than back to the shopping list. */}
      <GroceryItemSheet
        visible={openItemId !== null}
        itemId={openItemId}
        onClose={() => setOpenItemId(null)}
        // Opened on the Pantry pills, since that's what a row here is: the
        // sheet is dense enough that a collapsed "Pantry" field halfway down
        // it was, in practice, no way to say you're out of something at all.
        initialField="pantry"
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
