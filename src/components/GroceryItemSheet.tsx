import React, { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns/format';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
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
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { haptics } from '../utils/haptics';
import { describeShops, shopsForItem } from '../utils/groceryShops';
import { defaultOnHandUntil, OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import { GROCERY_NAME_MAX_LENGTH, GROCERY_QUANTITY_MAX_LENGTH } from '../types';

interface Props {
  visible: boolean;
  itemId: string | null;
  onClose: () => void;
}

/**
 * Everything about one item that isn't "do I need it". Reached by long-press,
 * which is also where the single destructive action lives — there is no undo
 * anywhere in groceries, so deleting a catalog row is behind a confirm rather
 * than on a swipe.
 */
export function GroceryItemSheet({ visible, itemId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const item = useGroceryStore(s => (itemId ? s.items.find(i => i.id === itemId) ?? null : null));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const renameItem = useGroceryStore(s => s.renameItem);
  const setQuantity = useGroceryStore(s => s.setQuantity);
  const setNote = useGroceryStore(s => s.setNote);
  const setAisle = useGroceryStore(s => s.setAisle);
  const addAisle = useGroceryStore(s => s.addAisle);
  const toggleFavorite = useGroceryStore(s => s.toggleFavorite);
  const setOnHandUntil = useGroceryStore(s => s.setOnHandUntil);
  const removeFromList = useGroceryStore(s => s.removeFromList);
  const deleteItem = useGroceryStore(s => s.deleteItem);
  const shops = useGroceryStore(useShallow(s => s.shops));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const linkItemShop = useGroceryStore(s => s.linkItemShop);
  const unlinkItemShop = useGroceryStore(s => s.unlinkItemShop);
  const addShop = useGroceryStore(s => s.addShop);

  const [name, setName] = useState('');
  const [quantity, setQuantityText] = useState('');
  const [note, setNoteText] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [newAisle, setNewAisle] = useState('');
  const [addingAisle, setAddingAisle] = useState(false);
  const [newShop, setNewShop] = useState('');
  const [addingShop, setAddingShop] = useState(false);

  useEffect(() => {
    if (visible && item) {
      setName(item.name);
      setQuantityText(item.quantity ?? '');
      setNoteText(item.note);
      setNameError(null);
      setNewAisle('');
      setAddingAisle(false);
      setNewShop('');
      setAddingShop(false);
    }
  }, [visible, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) {
    return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} />;
  }

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== item.name) {
      // renameItem refuses a collision rather than merging two catalog rows —
      // merging means choosing whose purchase history survives.
      if (!renameItem(item.id, trimmed)) {
        setNameError('Another item already has that name.');
        haptics.error();
        return;
      }
    }
    setQuantity(item.id, quantity);
    setNote(item.id, note);
    haptics.success();
    onClose();
  };

  /**
   * Creating an aisle here always files this item into it: you're standing in
   * the item's aisle picker, so "Baby" with the item left in Other would be a
   * step that looks like it did nothing. addAisle hands back the existing name
   * on a collision, so typing one that's already there just selects it.
   */
  const handleAddAisle = () => {
    const created = addAisle(newAisle);
    if (!created) return;
    setAisle(item.id, created);
    haptics.success();
    setNewAisle('');
    setAddingAisle(false);
  };

  /**
   * Same reasoning as handleAddAisle: you're here to say where this item can
   * be bought, so a store created from this sheet is linked to the item on
   * the spot rather than left to be found again from the Stores tab.
   * addShop, unlike addAisle, hands back null on a name collision rather than
   * the existing store — a duplicate name just fails quietly here since a
   * store's identity (not just its name) already exists elsewhere to pick.
   */
  const handleAddShop = () => {
    const trimmed = newShop.trim();
    if (!trimmed) return;
    const created = addShop(trimmed);
    if (!created) {
      haptics.error();
      return;
    }
    linkItemShop(item.id, created.id);
    haptics.success();
    setNewShop('');
    setAddingShop(false);
  };

  const linkedCounts = new Map(
    shopsForItem(item.id, itemShops, shops).map(s => [s.shop.id, s.purchaseCount])
  );
  const summary = describeShops(item, itemShops, shops);

  // A future onHandUntil is an active "Got it"; a past one (always
  // OUT_OF_IT_UNTIL in practice) is an active "Out of it"; null leaves the
  // pantry guess deciding — see GroceryItem.onHandUntil.
  const onHandFuture = !!item.onHandUntil && new Date(item.onHandUntil).getTime() >= Date.now();
  const onHandPast = !!item.onHandUntil && !onHandFuture;
  const markGotIt = () => {
    haptics.tap();
    setOnHandUntil(item.id, defaultOnHandUntil(item, new Date()));
  };
  const markOutOfIt = () => {
    haptics.tap();
    setOnHandUntil(item.id, OUT_OF_IT_UNTIL);
  };
  const clearOnHand = () => {
    haptics.tap();
    setOnHandUntil(item.id, null);
  };

  const toggleShop = (shopId: string) => {
    const count = linkedCounts.get(shopId);
    if (count === undefined) {
      haptics.tap();
      linkItemShop(item.id, shopId);
      return;
    }
    // Unlinking a store you've actually bought here destroys a record, and
    // groceries have no undo anywhere — so an observed link asks first while an
    // assertion (count 0, nothing to lose) just goes.
    if (count === 0) {
      haptics.tap();
      unlinkItemShop(item.id, shopId);
      return;
    }
    const shopName = shops.find(s => s.id === shopId)?.name ?? 'this store';
    Alert.alert(
      `Forget buying ${item.name} at ${shopName}?`,
      `${count} ${count === 1 ? 'purchase' : 'purchases'} recorded here. This can’t be undone — the item and its overall count stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            unlinkItemShop(item.id, shopId);
            haptics.warning();
          },
        },
      ]
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      `Forget ${item.name}?`,
      // No pointer at "Remove from list" for a provisional row: it does the
      // same thing there, so offering it as the gentler option is a lie.
      item.inCatalog
        ? 'This removes it from your catalog along with its history, and can’t be undone. To just take it off this week’s list, use "Remove from list".'
        : 'This removes it altogether, and can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            deleteItem(item.id);
            haptics.warning();
            onClose();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>Item</Text>
          <SheetHeaderButton label="Save" onPress={handleSave} minWidth={64} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>NAME</Text>
          <TextInput
            style={[styles.input, !!nameError && styles.inputError]}
            value={name}
            onChangeText={t => {
              setName(t);
              if (nameError) setNameError(null);
            }}
            placeholder="Item name"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_NAME_MAX_LENGTH}
            accessibilityLabel="Item name"
          />
          {!!nameError && <Text style={styles.error}>{nameError}</Text>}

          <Text style={styles.label}>QUANTITY</Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantityText}
            placeholder="2 lb, x3, a bunch…"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_QUANTITY_MAX_LENGTH}
            accessibilityLabel="Quantity"
          />

          <Text style={styles.label}>NOTE</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNoteText}
            placeholder="The blue cap one"
            placeholderTextColor={colors.textTertiary}
            maxLength={GROCERY_NAME_MAX_LENGTH}
            accessibilityLabel="Note"
          />

          <Text style={styles.label}>AISLE</Text>
          <View style={styles.pills}>
            {aisleOrder.map(aisle => {
              const active = aisle === item.aisle;
              return (
                <TouchableOpacity
                  key={aisle}
                  style={[styles.pill, active && styles.pillActive]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => {
                    haptics.tap();
                    setAisle(item.id, aisle);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={aisle}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{aisle}</Text>
                </TouchableOpacity>
              );
            })}
            {/* Neutral, not accent: accent is what marks the *selected* aisle in
                this grid, so a tinted add button would read as one more aisle —
                the same reason the add button beside tag chips is neutral. */}
            {!addingAisle && (
              <InlineAction
                label="New aisle"
                icon="add"
                variant="neutral"
                haptic
                onPress={() => setAddingAisle(true)}
                accessibilityLabel="Add a new aisle"
                style={styles.addButton}
              />
            )}
          </View>

          {addingAisle && (
            <View style={styles.addWrap}>
              <TextInput
                style={styles.addInput}
                value={newAisle}
                onChangeText={setNewAisle}
                placeholder="Aisle name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                onSubmitEditing={handleAddAisle}
                // An empty field is someone who changed their mind, so tapping
                // away closes it rather than leaving a dead row behind.
                onBlur={() => {
                  if (!newAisle.trim()) setAddingAisle(false);
                }}
                autoFocus
                autoCorrect={false}
                maxLength={32}
                accessibilityLabel="New aisle name"
              />
              <InlineAction
                label="Add"
                icon="add"
                variant="neutral"
                onPress={handleAddAisle}
                disabled={!newAisle.trim()}
                style={styles.addButton}
              />
            </View>
          )}

          {/* Unconditional, unlike the pills-only version this replaced: the
              "New store" affordance has to be reachable even before any store
              exists, not just once the picker already has something to tap. */}
          <Text style={styles.label}>STORES</Text>
          <Text style={styles.hint}>
            Tap a store to say you can get this there. Finishing a shop marks it for you.
          </Text>
          <View style={styles.pills}>
            {shops.map(shop => {
              const count = linkedCounts.get(shop.id);
              const active = count !== undefined;
              return (
                <TouchableOpacity
                  key={shop.id}
                  style={[styles.pill, active && styles.pillActive]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => toggleShop(shop.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    active
                      ? count === 0
                        ? `${shop.name}, marked by you. Tap to remove.`
                        : `${shop.name}, bought here ${count} ${count === 1 ? 'time' : 'times'}. Tap to remove.`
                      : `${shop.name}. Tap to mark that you can get this here.`
                  }
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>
                    {shop.name}
                    {/* Only an observed link shows a number. A count of 0
                        on a hand-marked store reads as "never bought here",
                        which is the opposite of what the tap meant. */}
                    {!!count && ` · ${count}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {!addingShop && (
              <InlineAction
                label="New store"
                icon="add"
                variant="neutral"
                haptic
                onPress={() => setAddingShop(true)}
                accessibilityLabel="Add a new store"
                style={styles.addButton}
              />
            )}
          </View>

          {addingShop && (
            <View style={styles.addWrap}>
              <TextInput
                style={styles.addInput}
                value={newShop}
                onChangeText={setNewShop}
                placeholder="Store name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                onSubmitEditing={handleAddShop}
                onBlur={() => {
                  if (!newShop.trim()) setAddingShop(false);
                }}
                autoFocus
                autoCorrect={false}
                maxLength={32}
                accessibilityLabel="New store name"
              />
              <InlineAction
                label="Add"
                icon="add"
                variant="neutral"
                onPress={handleAddShop}
                disabled={!newShop.trim()}
                style={styles.addButton}
              />
            </View>
          )}

          <Text style={styles.label}>PANTRY</Text>
          <Text style={styles.hint}>
            {onHandFuture
              ? `Marked on hand until ${format(new Date(item.onHandUntil!), 'd MMM')}.`
              : onHandPast
                ? 'Marked out of it — won’t show as probably-have until you buy it again.'
                : 'Decided automatically from purchase history when this comes up in a week plan.'}
          </Text>
          <View style={styles.pills}>
            <TouchableOpacity
              style={[styles.pill, onHandFuture && styles.pillActive]}
              activeOpacity={interaction.activeOpacity}
              onPress={onHandFuture ? clearOnHand : markGotIt}
              accessibilityRole="button"
              accessibilityState={{ selected: onHandFuture }}
              accessibilityLabel={onHandFuture ? 'Got it, marked on hand. Tap to clear.' : 'Got it — mark as on hand'}
            >
              <Text style={[styles.pillText, onHandFuture && styles.pillTextActive]}>Got it</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, onHandPast && styles.pillActive]}
              activeOpacity={interaction.activeOpacity}
              onPress={onHandPast ? clearOnHand : markOutOfIt}
              accessibilityRole="button"
              accessibilityState={{ selected: onHandPast }}
              accessibilityLabel={onHandPast ? 'Out of it, marked not on hand. Tap to clear.' : 'Out of it — mark as not on hand'}
            >
              <Text style={[styles.pillText, onHandPast && styles.pillTextActive]}>Out of it</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={() => {
              haptics.tap();
              toggleFavorite(item.id);
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: item.favorite }}
            accessibilityLabel="Star this item"
          >
            <Ionicons
              name={item.favorite ? 'star' : 'star-outline'}
              size={iconSize.md}
              color={item.favorite ? colors.warning : colors.textSecondary}
            />
            <View style={styles.actionBody}>
              <Text style={styles.actionLabel}>Starred</Text>
              <Text style={styles.actionHint}>Floats to the top of Buy again.</Text>
            </View>
          </TouchableOpacity>

          {item.onList && (
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => {
                removeFromList(item.id);
                haptics.tap();
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Remove from list"
            >
              <Ionicons name="remove-circle-outline" size={iconSize.md} color={colors.textSecondary} />
              <View style={styles.actionBody}>
                <Text style={styles.actionLabel}>Remove from list</Text>
                {/* The hint has to say which of the two things this does — a
                    provisional row is deleted outright, and finding that out
                    afterwards is the whole surprise this copy exists to avoid. */}
                <Text style={styles.actionHint}>
                  {item.inCatalog
                    ? 'Keeps it in your catalog for next time.'
                    : 'It isn’t in your catalog yet, so this forgets it entirely.'}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={confirmDelete}
            accessibilityRole="button"
            accessibilityLabel="Forget this item"
          >
            <Ionicons name="trash-outline" size={iconSize.md} color={colors.red} />
            <View style={styles.actionBody}>
              <Text style={[styles.actionLabel, { color: colors.red }]}>Forget this item</Text>
              <Text style={styles.actionHint}>
                Deletes it and its history. There&apos;s no undo.
              </Text>
            </View>
          </TouchableOpacity>

          {/* describeShops owns the wording because it also owns the rule that
              the item's count is the total and the per-store ones are partial —
              a trip finished without naming a store bumps one and not the
              other, so nothing here may reconcile them. */}
          {!!summary && <Text style={styles.footnote}>{summary}.</Text>}
        </ScrollView>
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
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    label: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textTertiary,
      letterSpacing: 0.8,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    input: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      borderWidth: border.sm,
      borderColor: 'transparent',
      paddingHorizontal: spacing.md,
      fontSize: font.md,
      color: colors.text,
      // No lineHeight on a TextInput — RN maps it onto the iOS paragraph style
      // with no baseline compensation, so the glyphs sit low in the box.
      height: 44,
    },
    inputError: { borderColor: colors.red },
    error: { fontSize: font.sm, color: colors.red, marginTop: spacing.xs },
    hint: { fontSize: font.sm, color: colors.textTertiary, marginBottom: spacing.sm },
    pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    addWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    addInput: {
      flex: 1,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: font.md,
      color: colors.text,
      // A height rather than a lineHeight — see the note on `input` above.
      height: 44,
    },
    pill: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    // Both "New aisle" and "Add" sit directly on the sheet's root colors.bg,
    // where the default neutral tint (bgTertiary) is nearly indistinguishable
    // from it.
    addButton: { backgroundColor: colors.bgSecondary },
    pillActive: { backgroundColor: colors.accent },
    pillText: { fontSize: font.sm, color: colors.textSecondary },
    pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
    },
    actionBody: { flex: 1 },
    actionLabel: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    actionHint: { fontSize: font.sm, color: colors.textTertiary, marginTop: 2 },
    footnote: {
      fontSize: font.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: spacing.lg,
    },
  });
}
