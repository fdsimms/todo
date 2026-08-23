import React, { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { standingSwaps, type StandingSwap } from '../utils/standingSwaps';
import { EmptyState } from './EmptyState';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Every swap the app is currently applying on its own, in one list.
 *
 * The bit itself lives on the link, next to the pair it's about
 * (`ItemSubLink.standing`) — this is not a second place it's stored. What it
 * is is the answer to the other half of #1571's question: a rule that rewrites
 * what lands in the trolley without being asked has to be reviewable
 * somewhere that isn't "open every grocery item and check". Writing one is
 * still done where the pair is, in `SubstituteSheet`.
 *
 * The one write here is turning a rule off, and it leaves the substitute
 * recorded — that's the whole of "unticking it restores every recipe", and
 * it's why the row's control isn't a delete.
 */
export function StandingSwapsSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const setItemSubStanding = useGroceryStore(s => s.setItemSubStanding);

  const swaps = useMemo(() => standingSwaps(itemSubs, items), [itemSubs, items]);

  const turnOff = (swap: StandingSwap) => {
    haptics.tap();
    setItemSubStanding(swap.link.itemId, swap.link.subItemId, false);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Standing swaps</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />
        </View>

        {swaps.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="swap-horizontal-outline"
              title="No standing swaps"
              subtitle="Add a substitute to an item and check “Always use this instead” to have every recipe calling for it shop for what you actually use."
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.caption}>
              Recipes calling for the item on the left show and shop for the one on the right.
              Swapped lines say what the recipe wrote, and no recipe is changed.
            </Text>
            <View style={styles.card}>
              {swaps.map((swap, i) => (
                <View key={`${swap.link.itemId}|${swap.link.subItemId}`}>
                  {i > 0 && <View style={styles.sep} />}
                  <View style={styles.row}>
                    <View style={styles.body}>
                      <Text style={styles.name} numberOfLines={1}>
                        {swap.from.name} → {swap.to.name}
                      </Text>
                      {!!captionFor(swap) && (
                        <Text style={styles.meta} numberOfLines={1}>{captionFor(swap)}</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.off}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => turnOff(swap)}
                      accessibilityRole="button"
                      accessibilityLabel={`Stop always using ${swap.to.name} for ${swap.from.name}`}
                      accessibilityHint="Keeps it as a substitute"
                    >
                      <Text style={styles.offText}>Turn off</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
            <Text style={styles.footnote}>
              Turning one off keeps it as a substitute — the recipes it was rewriting go back to
              their own words. A single line can opt out on its own from the recipe, under
              “Keep as written”.
            </Text>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/**
 * The ratio, then the caveat — the two things that decide whether a rule
 * behaves the way its two names suggest. A ratio the line can't be measured
 * against leaves that line alone entirely (see standingSwaps.ts), which is
 * exactly what someone reviewing a rule that "didn't work" needs to see.
 */
function captionFor(swap: StandingSwap): string | null {
  const ratio = swap.link.ratioFrom && swap.link.ratioTo
    ? `${swap.link.ratioFrom} → ${swap.link.ratioTo}`
    : null;
  const parts = [ratio, swap.link.note].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
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
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    // Matches Done's own minWidth, so the title stays optically centred.
    headerSpacer: { width: 56 },
    emptyWrap: { flex: 1, paddingHorizontal: spacing.md },
    list: { padding: spacing.md, paddingBottom: spacing.xl },
    caption: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.md },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    body: { flex: 1 },
    name: { color: colors.text, fontSize: font.md },
    meta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    off: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    offText: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.medium },
    footnote: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.md },
  });
}
