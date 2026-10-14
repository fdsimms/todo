import React, { useMemo } from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, View, type SectionListRenderItem } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import type { FoodLogEntry } from '../types';
import { foodLogEntryEdit } from '../utils/foodLog';
import { haptics } from '../utils/haptics';
import {
  formatServings,
  produceContributions,
  type RecipeProduceResolver,
} from '../utils/produceServings';

/**
 * Which of a day's entries counted toward its vegetable or fruit servings, and
 * which were left out because they could not be weighed.
 *
 * `NutrientContributorsSheet`'s shape for the Food log's produce card: opened
 * from a tap on the Vegetables or Fruit row, nothing is edited here, and a row
 * the entry editor can reopen hands off to it through `onEdit` (the same
 * `foodLogEntryEdit` rule). The rows come from `produceContributions`, which
 * shares its per-entry rule with `dayProduce`, so they add up to the figure
 * on the card.
 */

interface Props {
  visible: boolean;
  kind: 'vegetable' | 'fruit' | null;
  entries: readonly FoodLogEntry[];
  recipeGrams: RecipeProduceResolver;
  /** The card's figure for this kind, already worded. */
  total: string | null;
  onEdit?: (entry: FoodLogEntry) => void;
  onClose: () => void;
}

interface Row {
  entry: FoodLogEntry;
  /** Null on a row that could not be weighed. */
  servings: number | null;
}

interface Section {
  key: 'counted' | 'unmeasured';
  title: string;
  data: Row[];
}

export function ProduceContributorsSheet({ visible, kind, entries, recipeGrams, total, onEdit, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const sections = useMemo<Section[]>(() => {
    if (!kind) return [];
    const { counted, unmeasured } = produceContributions(entries, kind, recipeGrams);
    const out: Section[] = [];
    if (counted.length > 0) {
      out.push({
        key: 'counted',
        title: 'Counted',
        data: counted.map(c => ({ entry: c.entry, servings: c.servings })),
      });
    }
    if (unmeasured.length > 0) {
      out.push({
        key: 'unmeasured',
        title: 'Not counted: could not be measured',
        data: unmeasured.map(entry => ({ entry, servings: null })),
      });
    }
    return out;
  }, [entries, kind, recipeGrams]);

  const renderItem: SectionListRenderItem<Row, Section> = ({ item }) => {
    const body = (
      <>
        <Text style={styles.rowLabel} numberOfLines={1}>{item.entry.label}</Text>
        {item.servings === null ? (
          <Text style={styles.rowUnstated}>Not measured</Text>
        ) : (
          <Text style={styles.rowAmount}>{`about ${formatServings(item.servings)}`}</Text>
        )}
      </>
    );
    if (!onEdit || !foodLogEntryEdit(item.entry)) {
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
          title={kind === 'fruit' ? 'Fruit' : 'Vegetables'}
          left={<SheetHeaderButton label="Close" role="cancel" onPress={onClose} minWidth={60} />}
          right={<View style={{ minWidth: 60 }} />}
        />
        <SectionList
          sections={sections}
          keyExtractor={r => r.entry.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => <Text style={styles.sectionLabel}>{section.title}</Text>}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          ListHeaderComponent={total ? <Text style={styles.total}>{`Day total: ${total}`}</Text> : null}
          ListEmptyComponent={<Text style={styles.rowUnstated}>No entries counted.</Text>}
        />
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    list: { padding: spacing.md },
    total: {
      color: colors.textSecondary,
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      marginBottom: spacing.sm,
    },
    sectionLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
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
