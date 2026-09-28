import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View, type ListRenderItem } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import type { FoodLogEntry, NutrientKey } from '../types';
import { foodLogEntryEdit, nutrientContributions, type NutrientContribution } from '../utils/foodLog';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { haptics } from '../utils/haptics';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';

/**
 * Which of a day's entries put what toward one nutrient.
 *
 * Opened from a tap on a totals row, this is the coverage clause
 * (`describeFoodLogTotals`'s "from 5 of 7 entries") broken back out by entry
 * rather than left as a count with nothing to point at. Nothing is edited
 * here, so there is no dirty state and no confirm on close.
 *
 * **It is not a dead end** (#2916). A row that explains a total is usually the
 * row somebody wants to correct ("that chicken was 170 g, not 200"), so a row
 * the entry editor can reopen hands off to it through `onEdit`. Only those
 * rows are tappable and carry a chevron: `foodLogEntryEdit` decides, the same
 * rule the row's own menu uses, so the two never disagree about which entries
 * can be corrected. The caller closes this sheet and opens the editor in the
 * same commit, which `SheetModal` sequences; the two are siblings, and holding
 * both open at once is the one thing iOS refuses.
 *
 * The day's total heads the list, against its target when there is one, so
 * the rows below can be read against the figure they add up to.
 */

interface Props {
  visible: boolean;
  nutrientKey: NutrientKey | null;
  entries: readonly FoodLogEntry[];
  /**
   * The day's total for this nutrient, already worded (the same text the
   * totals row shows, target included). Omitted or null leaves the line out.
   */
  total?: string | null;
  /** Reopens an entry in the entry editor. Omitted, every row is read-only. */
  onEdit?: (entry: FoodLogEntry) => void;
  onClose: () => void;
}

export function NutrientContributorsSheet({ visible, nutrientKey, entries, total, onEdit, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const contributions = useMemo(
    () => (nutrientKey ? nutrientContributions(entries, nutrientKey) : []),
    [entries, nutrientKey],
  );

  const renderItem: ListRenderItem<NutrientContribution> = ({ item }) => {
    const body = (
      <>
        <Text style={styles.rowLabel} numberOfLines={1}>{item.entry.label}</Text>
        {item.amount === null ? (
          <Text style={styles.rowUnstated}>Not stated</Text>
        ) : (
          <Text style={styles.rowAmount}>
            {Math.round(item.amount)}
            {nutrientKey && NUTRIENT_LABEL[nutrientKey].unit !== 'cal' ? NUTRIENT_LABEL[nutrientKey].unit : ''}
          </Text>
        )}
      </>
    );
    if (!onEdit || !foodLogEntryEdit(item.entry)) {
      // The chevron's width held open beside a row that can't be edited, so
      // the amounts stay in one column down the list.
      return (
        <View style={styles.row}>
          {body}
          {!!onEdit && <View style={styles.chevronSpace} />}
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={interaction.activeOpacity}
        onPress={() => { haptics.tap(); onEdit(item.entry); }}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${item.entry.label}`}
      >
        {body}
        <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  return (
    <SheetModal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <SheetHeader
          title={nutrientKey ? NUTRIENT_LABEL[nutrientKey].label : ''}
          left={<SheetHeaderButton label="Close" role="cancel" onPress={onClose} minWidth={60} />}
          right={<View style={{ minWidth: 60 }} />}
        />
        <FlatList
          data={contributions}
          keyExtractor={c => c.entry.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListHeaderComponent={total ? <Text style={styles.total}>Day total: {total}</Text> : null}
        />
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    list: { padding: spacing.md, gap: spacing.sm },
    total: {
      color: colors.textSecondary,
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      marginBottom: spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    rowLabel: { flex: 1, color: colors.text, fontSize: font.md },
    rowAmount: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    rowUnstated: { color: colors.textSecondary, fontSize: font.sm },
    chevronSpace: { width: iconSize.sm },
  });
}
