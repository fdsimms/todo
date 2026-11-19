import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { InlineAction } from './InlineAction';
import { SearchField } from './SearchField';
import { EmptyNote } from './EmptyNote';
import { useFilterField } from '../hooks/useFilterField';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { WISH_UNFILED, wishListView } from '../utils/rewardWishList';
import type { Task } from '../types';

/** Rows shown before "Show more" while nothing is searched or chosen. */
const PREVIEW_ROWS = 8;

interface Props {
  /** The project's open tasks not yet priced, in the project's order. */
  items: readonly Task[];
  onPrice: (taskId: string) => void;
}

/**
 * The wish list on the Rewards screen: a search field, one chip per category,
 * and the items grouped under their category. A long list stays short by
 * showing a few rows, but searching or choosing a category shows every match,
 * since a capped result list hides the thing you looked for.
 */
export function RewardWishList({ items, onPrice }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const filter = useFilterField();
  const [chosen, setChosen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // A category that emptied out (its last item was priced) stops filtering.
  const firstPass = useMemo(() => wishListView(items, '', null), [items]);
  const category = chosen !== null && firstPass.categories.some(c => c.name === chosen) ? chosen : null;
  const view = useMemo(() => wishListView(items, filter.query, category), [items, filter.query, category]);

  const searching = filter.query.trim().length > 0;
  const narrowed = searching || category !== null;
  const capped = !narrowed && !expanded && view.matches.length > PREVIEW_ROWS;
  const shown = capped ? view.matches.slice(0, PREVIEW_ROWS) : view.matches;
  // Searching reads as a flat result list with each row's category under it;
  // otherwise the rows sit under category headers.
  const sections = useMemo(() => {
    if (searching || !view.grouped) return [{ name: null as string | null, items: shown }];
    return wishListView(shown, '', null).groups.map(g => ({ name: g.name as string | null, items: g.items }));
  }, [searching, view.grouped, shown]);

  const renderRow = (item: Task, first: boolean) => (
    <View key={item.id} style={[styles.row, !first && styles.divider]}>
      <View style={styles.text}>
        <Text style={styles.title}>{item.title}</Text>
        {searching && view.grouped && (
          <Text style={styles.meta}>{item.category?.trim() || WISH_UNFILED}</Text>
        )}
      </View>
      <InlineAction
        label="Price it"
        icon="pricetag-outline"
        onPress={() => onPrice(item.id)}
        accessibilityLabel={`Make ${item.title} a reward`}
      />
    </View>
  );

  return (
    <>
      <View style={styles.searchWrap}>
        <SearchField field={filter} placeholder="Search wish list" accessibilityLabel="Search wish list" />
      </View>
      {view.grouped && firstPass.categories.length > 1 && (
        <View style={styles.chips}>
          {[{ name: null as string | null, label: 'All' }, ...firstPass.categories.map(c => ({ name: c.name as string | null, label: c.name }))].map(c => {
            const on = c.name === category;
            return (
              <TouchableOpacity
                key={c.label}
                activeOpacity={interaction.activeOpacity}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => { haptics.tap(); animateLayout(); setChosen(c.name); }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={c.name === null ? 'Show every category' : `Show only ${c.name}`}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {view.matches.length === 0 ? (
        <View style={styles.empty}>
          <EmptyNote icon="search">{searching ? `Nothing in the wish list matches “${filter.query.trim()}”.` : 'Nothing in this category.'}</EmptyNote>
        </View>
      ) : (
        <View style={styles.card}>
          {sections.map((section, s) => (
            <View key={section.name ?? 'all'}>
              {section.name !== null && (
                <Text style={[styles.groupHeader, s > 0 && styles.divider]}>{`${section.name} · ${view.groups.find(g => g.name === section.name)?.items.length ?? section.items.length}`}</Text>
              )}
              {section.items.map((item, i) => renderRow(item, i === 0))}
            </View>
          ))}
          {(capped || (!narrowed && expanded && view.matches.length > PREVIEW_ROWS)) && (
            <View style={[styles.row, styles.divider, styles.more]}>
              <InlineAction
                label={capped ? `Show ${view.matches.length - PREVIEW_ROWS} more` : 'Show less'}
                variant="neutral"
                onPress={() => { haptics.tap(); animateLayout(); setExpanded(open => !open); }}
              />
            </View>
          )}
        </View>
      )}
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  searchWrap: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xsm, marginHorizontal: spacing.md, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.smd, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: colors.bgTertiary },
  chipOn: { backgroundColor: colors.accentSubtle },
  chipText: { color: colors.textSecondary, fontSize: font.sm },
  chipTextOn: { color: colors.accentText, fontWeight: fontWeight.semibold },
  card: { marginHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSecondary, overflow: 'hidden' },
  groupHeader: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.smd,
    paddingTop: spacing.smd,
    paddingBottom: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.smd, paddingHorizontal: spacing.smd, gap: spacing.smd },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  text: { flex: 1 },
  title: { color: colors.text, fontSize: font.md },
  meta: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  more: { justifyContent: 'center' },
  empty: { marginHorizontal: spacing.md },
});
