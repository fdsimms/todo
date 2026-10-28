import React, { useEffect, useMemo, useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { AnimatedNumber } from './AnimatedNumber';
import { HelpText } from './HelpText';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useGroceryStore } from '../store/useGroceryStore';
import { useReminderRemovalStore } from '../store/useReminderRemovalStore';
import { liveReminderRemovals } from '../utils/reminderRemovals';

/** Past this many, the rest wait behind one "N more" pill. */
const SHOWN_BEFORE_MORE = 12;

/**
 * Asks which of the rows the Reminders mirror took off the list were bought,
 * so a list cleared in the Reminders app after a shop still reaches the pantry.
 * The rules, and why nothing here is assumed, are in `reminderRemovals.ts`.
 *
 * One card, one decision: each row is a pill that is on for "bought", the
 * rows that were in the cart start on, and the two buttons answer for every
 * row shown. "Mark as bought" records the ones that are on through
 * `finishShopping` (so they carry a trip's record, and its undo) and forgets
 * the rest; Dismiss forgets them all. It renders nothing when there is
 * nothing to ask, which is almost always.
 *
 * Tinted like `StartTripPrompt` because it sits in the same place for the same
 * reason: it's about the list, not a row of it. The pills sit on the card
 * surface rather than `PillGroup`'s tertiary fill, which is close to the tint
 * in both themes. Checked in mock, both themes.
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

  const count = pickedIds.length;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="list-outline" size={iconSize.sm} color={colors.accent} />
        <Text style={styles.title}>Cleared in Reminders</Text>
      </View>
      <HelpText style={styles.help}>Mark what you bought to add it to the pantry.</HelpText>
      <View style={styles.pills}>
        {shown.map(r => {
          const picked = isPicked(r.itemId, r.inCart);
          const name = nameById.get(r.itemId) ?? '';
          return (
            <TouchableOpacity
              key={r.itemId}
              style={[styles.pill, picked && styles.pillPicked]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => toggle(r.itemId, r.inCart)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: picked }}
              accessibilityLabel={`${name}, bought`}
            >
              {picked && <Ionicons name="checkmark" size={iconSize.xs} color={colors.onAccent} />}
              <Text style={[styles.pillText, picked && styles.pillTextPicked]}>{name}</Text>
            </TouchableOpacity>
          );
        })}
        {hidden > 0 && (
          <TouchableOpacity
            style={styles.pill}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setShowAll(true); }}
            accessibilityRole="button"
            accessibilityLabel={`Show ${hidden} more`}
          >
            <Text style={[styles.pillText, styles.moreText]}>{hidden} more</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.buttons}>
        <PressableScale
          style={styles.dismiss}
          onPress={handleDismiss}
          accessibilityLabel="Dismiss. Nothing is added to the pantry"
        >
          <Text style={styles.dismissText}>Dismiss</Text>
        </PressableScale>
        <PressableScale
          style={[styles.bought, count === 0 && styles.boughtDisabled]}
          onPress={handleBought}
          disabled={count === 0}
          accessibilityLabel={`Mark ${count} as bought`}
        >
          <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />
          <AnimatedNumber text={`Mark ${count} as bought`} value={count} style={styles.boughtText} />
        </PressableScale>
      </View>
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
      paddingVertical: spacing.sm + 2,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
    title: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    help: { color: colors.textSecondary, fontSize: font.sm },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pillPicked: { backgroundColor: colors.accentFill },
    pillText: { fontSize: font.sm, color: colors.text },
    pillTextPicked: { color: colors.onAccent, fontWeight: fontWeight.semibold },
    moreText: { fontWeight: fontWeight.semibold },
    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xxs },
    dismiss: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgSecondary,
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
      minHeight: 32,
      borderRadius: radius.full,
    },
    dismissText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
    bought: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      backgroundColor: colors.accentFill,
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
      minHeight: 32,
      borderRadius: radius.full,
    },
    boughtDisabled: { opacity: 0.5 },
    boughtText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
  });
}
