import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
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
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { haptics } from '../utils/haptics';
import { SHOP_NAME_MAX_LENGTH } from '../types';

interface Props {
  visible: boolean;
  /** How many rows are in the trolley — the sheet doesn't recount. */
  checkedCount: number;
  onClose: () => void;
  onFinished: (shopId: string | null) => void;
}

/**
 * Where the trip gets its store.
 *
 * This replaced an Alert.alert confirm, for the obvious reason that an alert
 * can't hold a picker — but the confirm is still the job, and the sheet keeps
 * its shape: one sentence saying what's about to happen, then the commit.
 *
 * **No store is a real answer, not a skipped step.** It's a first-class pill
 * rather than a "later" escape hatch, it's the default until a trip has ever
 * named a store, and picking nothing finishes the trip exactly as every trip
 * did before stores existed. That's what keeps this additive: nobody standing
 * at a checkout is made to answer a question to tick their list off.
 */
export function FinishShoppingSheet({ visible, checkedCount, onClose, onFinished }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const shops = useGroceryStore(useShallow(s => s.shops));
  const lastShopId = useGroceryStore(s => s.lastShopId);
  const addShop = useGroceryStore(s => s.addShop);

  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Reset on every opening rather than on mount: the sheet outlives a trip,
  // and last week's selection is a way to file a shop against the wrong store.
  // The default is the store you finished at last, which is right far more
  // often than it's wrong — most people shop the same two places.
  useEffect(() => {
    if (visible) {
      setSelected(lastShopId);
      setAdding(false);
      setNewName('');
      setAddError(null);
    }
  }, [visible, lastShopId]);

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const shop = addShop(trimmed);
    if (!shop) {
      setAddError('You already have a store with that name.');
      haptics.error();
      return;
    }
    haptics.success();
    setSelected(shop.id);
    setAdding(false);
    setNewName('');
    setAddError(null);
  };

  const handleFinish = () => {
    onFinished(selected);
  };

  const countLabel = `${checkedCount} ${checkedCount === 1 ? 'item comes' : 'items come'} off the list`;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>Finish shopping</Text>
          <SheetHeaderButton label="Finish" onPress={handleFinish} minWidth={64} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            {countLabel}. Everything stays in your catalog for next time.
          </Text>

          <Text style={styles.label}>WHERE DID YOU SHOP?</Text>
          <Text style={styles.hint}>
            Optional. Naming a store is what lets you see which shop has which items later.
          </Text>

          <View style={styles.pills}>
            <TouchableOpacity
              style={[styles.pill, selected === null && styles.pillActive]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => {
                haptics.tap();
                setSelected(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === null }}
              accessibilityLabel="No store"
            >
              <Text style={[styles.pillText, selected === null && styles.pillTextActive]}>
                No store
              </Text>
            </TouchableOpacity>

            {shops.map(shop => {
              const active = shop.id === selected;
              return (
                <TouchableOpacity
                  key={shop.id}
                  style={[styles.pill, active && styles.pillActive]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => {
                    haptics.tap();
                    setSelected(shop.id);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={shop.name}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>
                    {shop.name}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {!adding && (
              // neutral, not accent: this sits at the end of a row of already
              // tinted pills, where an accent fill reads as one more store
              // rather than as the control that makes one. It sits directly on
              // the sheet's root background rather than a card, where the
              // default neutral tint (bgTertiary) is nearly indistinguishable
              // from colors.bg — so it's pinned to bgSecondary here, matching
              // the sibling store pills' surface instead.
              <InlineAction
                label="New store"
                icon="add"
                variant="neutral"
                onPress={() => setAdding(true)}
                style={styles.newStorePill}
              />
            )}
          </View>

          {adding && (
            <View style={styles.addWrap}>
              <TextInput
                style={[styles.addInput, !!addError && styles.addInputError]}
                value={newName}
                onChangeText={t => {
                  setNewName(t);
                  if (addError) setAddError(null);
                }}
                placeholder="Store name"
                placeholderTextColor={colors.textTertiary}
                autoFocus
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleAdd}
                maxLength={SHOP_NAME_MAX_LENGTH}
                accessibilityLabel="New store name"
              />
              <InlineAction
                label="Add"
                icon="checkmark"
                variant="neutral"
                onPress={handleAdd}
                disabled={!newName.trim()}
              />
            </View>
          )}
          {!!addError && <Text style={styles.error}>{addError}</Text>}

          {shops.length === 0 && !adding && (
            <View style={styles.emptyNote}>
              <Ionicons name="storefront-outline" size={iconSize.md} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                No stores yet. Add one and this trip gets filed against it — after a shop or two,
                Buy again can show you what each store carries.
              </Text>
            </View>
          )}
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
    intro: { color: colors.textSecondary, fontSize: font.md, marginBottom: spacing.md },
    label: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textTertiary,
      letterSpacing: 0.8,
      marginTop: spacing.md,
    },
    hint: { fontSize: font.sm, color: colors.textTertiary, marginTop: spacing.xs },
    pills: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    pill: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    newStorePill: { backgroundColor: colors.bgSecondary },
    pillActive: { backgroundColor: colors.accent },
    pillText: { fontSize: font.sm, color: colors.textSecondary },
    pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
    addWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    addInput: {
      flex: 1,
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
    addInputError: { borderColor: colors.red },
    error: { fontSize: font.sm, color: colors.red, marginTop: spacing.xs },
    emptyNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.lg,
    },
    emptyText: { flex: 1, fontSize: font.sm, color: colors.textTertiary },
  });
}
