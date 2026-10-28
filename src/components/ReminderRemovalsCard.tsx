import React, { useEffect, useMemo, useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, border, checkboxRadius, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { AnimatedNumber } from './AnimatedNumber';
import { CheckPop } from './CheckPop';
import { HelpText } from './HelpText';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useGroceryStore } from '../store/useGroceryStore';
import { useReminderRemovalStore } from '../store/useReminderRemovalStore';
import { liveReminderRemovals } from '../utils/reminderRemovals';

/** Past this many, the rest wait behind one "Show N more" row. */
const SHOWN_BEFORE_MORE = 5;

/** GroceryRow's box, so "checked" reads the way it does on the list. */
const CHECKBOX_SIZE = 24;

/**
 * Asks which of the rows the Reminders mirror took off the list were bought,
 * so a list cleared in the Reminders app after a shop still reaches the pantry.
 * The rules, and why nothing here is assumed, are in `reminderRemovals.ts`.
 *
 * One card, one decision. Each row has the grocery list's own checkbox, since
 * checked already means "got it" there, and the rows that were in the cart
 * start checked. "Mark N as bought" records the checked ones through
 * `finishShopping` (so they carry a trip's record, and its undo) and forgets
 * the rest; the ✕ forgets them all. It renders nothing when there is nothing
 * to ask, which is almost always.
 *
 * **Rows, not pills.** It started as pills for the items beside pill buttons,
 * and a card where the choices and the actions are the same shape doesn't say
 * which is which. So the choices are checkbox rows, the one action is the
 * full-width button, and dismissing is the corner ✕ rather than a second
 * button competing with it.
 *
 * Tinted like `StartTripPrompt` because it sits in the same place for the same
 * reason: it's about the list, not a row of it. Checked in mock, both themes.
 */
export function ReminderRemovalsCard() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const removals = useReminderRemovalStore(s => s.removals);
  const hydrate = useReminderRemovalStore(s => s.hydrate);
  const answer = useReminderRemovalStore(s => s.answer);
  const items = useGroceryStore(s => s.items);
  useEffect(() => { hydrate(); }, [hydrate]);

  const live = useMemo(() => liveReminderRemovals(removals, items, new Date()), [removals, items]);
  const nameById = useMemo(() => new Map(items.map(i => [i.id, i.name])), [items]);

  // Only what the person has changed. Everything else reads its default
  // (`inCart`), so a removal arriving while the card is up starts the way the
  // card says it does without resetting the choices already made.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [showAll, setShowAll] = useState(false);

  if (live.length === 0) return null;

  const isPicked = (id: string, inCart: boolean) => overrides.get(id) ?? inCart;
  const pickedIds = live.filter(r => isPicked(r.itemId, r.inCart)).map(r => r.itemId);
  const shown = showAll ? live : live.slice(0, SHOWN_BEFORE_MORE);
  const hidden = live.length - shown.length;

  const toggle = (id: string, inCart: boolean) => {
    haptics.tap();
    setOverrides(prev => new Map(prev).set(id, !isPicked(id, inCart)));
  };

  const finish = (bought: readonly string[]) => {
    animateLayout();
    answer(bought, live.map(r => r.itemId));
    setOverrides(new Map());
    setShowAll(false);
  };

  const handleBought = () => {
    if (pickedIds.length === 0) return;
    haptics.success();
    finish(pickedIds);
  };

  const handleDismiss = () => {
    haptics.tap();
    finish([]);
  };

  const showMore = () => {
    haptics.tap();
    animateLayout();
    setShowAll(true);
  };

  const count = pickedIds.length;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="list-outline" size={iconSize.sm} color={colors.accent} />
        <Text style={styles.title}>Cleared in Reminders</Text>
        <TouchableOpacity
          onPress={handleDismiss}
          activeOpacity={interaction.activeOpacity}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss. Nothing is added to the pantry"
        >
          <Ionicons name="close" size={iconSize.md} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <HelpText style={styles.help}>Check what you bought to add it to the pantry.</HelpText>
      <View style={styles.list}>
        {shown.map((r, index) => {
          const picked = isPicked(r.itemId, r.inCart);
          const name = nameById.get(r.itemId) ?? '';
          const last = index === shown.length - 1 && hidden === 0;
          return (
            <TouchableOpacity
              key={r.itemId}
              style={[styles.row, !last && styles.rowDivider]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => toggle(r.itemId, r.inCart)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: picked }}
              accessibilityLabel={`${name}, bought`}
            >
              <CheckPop checked={picked} style={styles.checkbox} checkedStyle={styles.checkboxChecked}>
                <Ionicons name="checkmark" size={iconSize.sm} color={colors.onDone} />
              </CheckPop>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
            </TouchableOpacity>
          );
        })}
        {hidden > 0 && (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={interaction.activeOpacity}
            onPress={showMore}
            accessibilityRole="button"
          >
            <Ionicons name="chevron-down" size={iconSize.sm} color={colors.textSecondary} />
            <Text style={styles.more}>Show {hidden} more</Text>
          </TouchableOpacity>
        )}
      </View>
      <PressableScale
        style={[styles.bought, count === 0 && styles.boughtDisabled]}
        onPress={handleBought}
        disabled={count === 0}
        accessibilityLabel={`Mark ${count} as bought`}
      >
        <AnimatedNumber text={`Mark ${count} as bought`} value={count} style={styles.boughtText} />
      </PressableScale>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      gap: spacing.sm,
      backgroundColor: colors.accent + '1A',
      borderRadius: radius.md,
      marginHorizontal: spacing.md,
      // StartTripPrompt's margins, for its reason: what precedes this already
      // carries a bottom margin of its own.
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm + 2,
      paddingBottom: spacing.smd,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
    title: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    help: { color: colors.textSecondary, fontSize: font.sm },
    list: { backgroundColor: colors.bgSecondary, borderRadius: radius.sm, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.smd,
      minHeight: 44,
      paddingHorizontal: spacing.smd,
    },
    rowDivider: { borderBottomWidth: border.hairline, borderBottomColor: colors.separator },
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.controlBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: { backgroundColor: colors.done, borderColor: colors.done },
    name: { flex: 1, color: colors.text, fontSize: font.md },
    more: { flex: 1, color: colors.textSecondary, fontSize: font.md, fontWeight: fontWeight.semibold },
    bought: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentFill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      minHeight: 36,
      borderRadius: radius.full,
      marginTop: spacing.xxs,
    },
    boughtDisabled: { opacity: 0.5 },
    boughtText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  });
}
