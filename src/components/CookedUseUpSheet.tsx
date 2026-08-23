import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
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
  checkboxRadius,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { convertQuantity } from '../utils/unitConvert';
import { useSettingsStore } from '../store/useSettingsStore';
import type { ClassifiedIngredient } from '../utils/mealPlanGroceries';
import { SheetHeaderButton } from './SheetHeaderButton';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
  /** The dish just cooked — named in the title, since that's what's being asked about. */
  recipeName: string;
  /** `consumedRows`' answer, recomputed by the caller. Never empty when visible. */
  rows: readonly ClassifiedIngredient[];
  onClose: () => void;
}

/**
 * "Out of anything?" — what one cook used up.
 *
 * This is the app's only consumption signal. Everything else it knows about a
 * kitchen comes from what was *bought*: `finishShopping` stamps `onHandUntil`,
 * `probablyHaveReason` guesses from purchase cadence, and nothing anywhere
 * says a thing was used. Cooking is the one moment that's knowable, and it was
 * being spent asking about shopping instead (#1482).
 *
 * **It writes exactly the bit `GroceryItemSheet`'s "Out of it" pill writes**,
 * for several rows at once (`markOutOfMany`). That's the whole feature, and the
 * restraint is the design: this is a batch entry point to a correction that
 * already existed one long-press at a time, not a second model. What it
 * deliberately does *not* record is how much of anything is left, when it runs
 * out, or that a cook happened at all — quantities and check-ins are the
 * maintained inventory this app has ruled out, and they die in week three.
 *
 * Three rules keep it a correction you can ignore rather than a step:
 *
 * - **Nothing is ticked when it opens.** The default answer is "no", because
 *   the usual truth after a cook is that you still have most of it. A
 *   pre-ticked sheet would make silence mean "out of everything", which is the
 *   mistake the auto-opening restock sheet made in the other direction.
 * - **Only lines the app already claims you have** are here (`consumedRows`),
 *   so it can't ask about a kitchen it knows nothing about.
 * - **It is reached from a banner, never raised over you**, and closing it
 *   without ticking anything writes nothing at all.
 *
 * The buy question isn't asked here and doesn't need to be: marking something
 * out moves it into `restockRows`, so the restock banner behind this one picks
 * it up by itself.
 */
export function CookedUseUpSheet({ visible, recipeName, rows, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const markOutOfMany = useGroceryStore(s => s.markOutOfMany);
  const unitSystem = useSettingsStore(s => s.unitSystem);

  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Cleared on every opening. A sheet that hands back last cook's answers
  // pre-ticked would be asserting them about this one.
  useEffect(() => {
    if (visible) setTicked(new Set());
  }, [visible]);

  const itemsByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(item.nameKey, item.id);
    return map;
  }, [items]);

  const toggle = (row: ClassifiedIngredient) => {
    haptics.tap();
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(row.nameKey)) next.delete(row.nameKey);
      else next.add(row.nameKey);
      return next;
    });
  };

  const handleConfirm = () => {
    // Resolved back to catalog ids here rather than carried on the row: a
    // ClassifiedIngredient is keyed by name, and the id is what the pantry
    // assertion lives on. A key with no live row is dropped rather than
    // minting one — this sheet only ever corrects rows that already exist.
    const ids = Array.from(ticked)
      .map(key => itemsByKey.get(key))
      .filter((id): id is string => !!id);

    // 'usedUp' rather than a question: this sheet's whole subject is what the
    // cooking consumed, so the answer is already in the tap. It's also the one
    // caller that reports several rows at once, and asking per row would be the
    // "recall five kitchens" the offer declines for bulkSetCooked.
    const marked = markOutOfMany(ids, 'usedUp');
    if (marked > 0) haptics.success();
    onClose();
  };

  const count = ticked.size;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={80} />
          <Text style={styles.headerTitle} numberOfLines={1}>Out of anything?</Text>
          <SheetHeaderButton
            label={count > 0 ? `Mark ${count}` : 'Done'}
            onPress={handleConfirm}
            minWidth={80}
          />
        </View>

        {/* Says the mechanism, since this is the only place it's explained:
            what ticking does, and what happens next because of it. */}
        <Text style={styles.caption}>
          Things you probably had before cooking {recipeName}. Tick whatever it used up — they&apos;ll
          stop counting as on hand, and turn up when you next shop.
        </Text>

        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.card}>
            {rows.map((row, i) => {
              const on = ticked.has(row.nameKey);
              const shownQuantity = convertQuantity(row.quantity, unitSystem).text;
              return (
                <React.Fragment key={row.nameKey}>
                  {i > 0 && <View style={styles.sep} />}
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => toggle(row)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={[row.name, shownQuantity, row.reason].filter(Boolean).join(', ')}
                    accessibilityHint="Marks it as used up"
                  >
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>
                      {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
                    </View>
                    <View style={styles.body}>
                      <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
                      {/* probablyHaveReason's own words — the same line the
                          pantry and the item sheet show, so why the app thought
                          you had it is answered where you're being asked. */}
                      {!!row.reason && (
                        <Text style={styles.reason} numberOfLines={1}>{row.reason}</Text>
                      )}
                    </View>
                    {!!shownQuantity && (
                      <View style={styles.qtyPill}>
                        <Text style={styles.qtyText} numberOfLines={1}>{shownQuantity}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
  caption: {
    fontSize: font.sm,
    color: colors.textTertiary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    lineHeight: font.sm * 1.35,
  },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + CHECKBOX_SIZE + spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: checkboxRadius(CHECKBOX_SIZE),
    borderWidth: border.md,
    borderColor: colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  body: { flex: 1, gap: 2 },
  name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  reason: { fontSize: font.xs, color: colors.textTertiary },
  qtyPill: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: 90,
  },
  qtyText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
});
