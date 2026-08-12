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
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { GroceryItemSheet } from './GroceryItemSheet';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Everything the app currently thinks you already have, in one place.
 *
 * It reads and never writes: the set is `probablyHaveReason`'s, the rows show
 * that function's own wording, and correcting one goes through the Pantry
 * pills on GroceryItemSheet rather than a second way to say the same thing.
 * That keeps the model the one #1040 settled on — computed from what you buy,
 * corrected when it's wrong, never an inventory anybody has to keep up.
 */
export function PantrySheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));

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
      accessibilityHint="Opens the item, where you can say you're out of it"
    >
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{entry.item.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {entry.reason}
          {entry.item.onList && ' · on the list'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
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
            placeholder="Do I have…"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Search what you have"
          />
        </View>

        {/* The only in-app explanation of where this list comes from, so it
            says the mechanism rather than describing the feature. */}
        {total > 0 && !query.trim() && (
          <Text style={styles.caption}>
            {total} {total === 1 ? 'thing' : 'things'} you probably have, worked out from what you
            buy and how often. Tap one to say you&apos;re out of it.
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
              title={query.trim() ? 'Nothing matches' : 'Nothing in the pantry yet'}
              subtitle={
                query.trim()
                  ? 'Nothing you probably have goes by that name.'
                  : 'Finish a shop and what you bought turns up here. You can also mark anything as on hand from its own sheet.'
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
      color: colors.textTertiary,
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
  });
}
