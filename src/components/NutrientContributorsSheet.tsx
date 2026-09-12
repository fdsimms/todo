import React, { useMemo } from 'react';
import { FlatList, Modal, StyleSheet, Text, View, type ListRenderItem } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import type { FoodLogEntry, NutrientKey } from '../types';
import { nutrientContributions, type NutrientContribution } from '../utils/foodLog';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';

/**
 * Which of a day's entries put what toward one nutrient.
 *
 * Opened from a tap on a totals row, this is the coverage clause
 * (`describeFoodLogTotals`'s "from 5 of 7 entries") broken back out by entry
 * rather than left as a count with nothing to point at. Read-only: nothing
 * here edits an entry, so there is no dirty state and no confirm on close.
 */

interface Props {
  visible: boolean;
  nutrientKey: NutrientKey | null;
  entries: readonly FoodLogEntry[];
  onClose: () => void;
}

export function NutrientContributorsSheet({ visible, nutrientKey, entries, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const contributions = useMemo(
    () => (nutrientKey ? nutrientContributions(entries, nutrientKey) : []),
    [entries, nutrientKey],
  );

  const renderItem: ListRenderItem<NutrientContribution> = ({ item }) => (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>{item.entry.label}</Text>
      {item.amount === null ? (
        <Text style={styles.rowUnstated}>Not stated</Text>
      ) : (
        <Text style={styles.rowAmount}>
          {Math.round(item.amount)}
          {nutrientKey && NUTRIENT_LABEL[nutrientKey].unit !== 'cal' ? NUTRIENT_LABEL[nutrientKey].unit : ''}
        </Text>
      )}
    </View>
  );

  return (
    <Modal
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
        />
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    list: { padding: spacing.md, gap: spacing.sm },
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
  });
}
