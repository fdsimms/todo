import React, { createContext, useContext, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { filterEditorRows } from '../utils/editorSearch';
import { editorRowShown } from '../utils/simpleMode';
import { useSettingsStore } from '../store/useSettingsStore';
import type { EditorJumpTracker } from '../utils/editorJump';

/**
 * A second row filter on top of Simplified mode's, set by the editor around
 * its form: `(key, set) => shown`. The task editor uses it for a list item
 * (src/utils/listMode.ts), which shows only the rows an item uses. Null, the
 * default, filters nothing. A context rather than a prop for the same reason
 * Simplified mode is read here: one filter in one component, not a condition
 * at every call site.
 */
export const EditorRowFilterContext = createContext<((key: string, set: boolean) => boolean) | null>(null);

export interface EditorGroupRow {
  key: string;
  /** The row's own name, shown nowhere but useful for future rows to key off. */
  label: string;
  /**
   * Words that should find the row by search but don't appear in its label —
   * "blocked" for Waiting on, "away" for Vacation pause. See `editorSearch.ts`
   * for why these are the point rather than a nicety.
   */
  keywords?: string[];
  /**
   * Does it hold a value? Only read by Simplified mode (`editorRowShown`), to
   * bring a row back for a task that's already using it — e.g. `kind` reports
   * `set: kind !== 'task'`, so a chain task keeps its picker while a plain one
   * loses it. Rows that Simplified mode never removes don't need this.
   */
  set?: boolean;
  node: React.ReactNode;
}

interface Props {
  /**
   * Uppercase group heading — WHEN, FILED UNDER, … Left out for a card whose
   * one row already names it (the task editor's Kind), which then needs a
   * `groupKey`.
   */
  label?: string;
  rows: EditorGroupRow[];
  /**
   * Where the dividers start. `icon` clears the 18pt icon column the
   * `EditorRow` groups have; `full` runs edge to edge, for the cards of
   * `CollapsibleField`s, which have no icon to clear.
   */
  divider?: 'icon' | 'full';
  /**
   * Search terms from the editor's field search, already split by
   * `editorSearchTerms`. Empty means not searching and the group behaves
   * exactly as it did before search existed.
   */
  searchTerms?: string[];
  /** Identifies this group in the editor's match tally. */
  groupKey?: string;
  /**
   * How many rows survived the search, reported so the editor can tell that
   * *nothing* matched — a form that silently empties itself is worse than one
   * that says why.
   */
  onMatchCount?: (groupKey: string, count: number) => void;
  /**
   * Told, under `groupKey`, where this card and each of its rows sit in the
   * scroll and whether any row holds a value: what the jump bar reads, and what
   * the task editor's summary scrolls to a row by. The positions come from
   * wrapping the group and each row in a plain View, which happens only with
   * this set.
   */
  jump?: EditorJumpTracker;
  /**
   * Draw each row as an empty slot of a row's height, and mount its content
   * once this turns false. For the cards below the fold while a sheet slides
   * in: the card, its label and everything it reports (its place, whether a
   * row holds a value, its search matches) are exactly as they would be, so
   * nothing above it moves when the rows arrive. Ignored while searching.
   */
  deferRows?: boolean;
}

/**
 * One card of an editor form: a group label followed by its rows, in order.
 * No group collapses. A row hides only when Simplified mode drops it, and a
 * task that already holds a value for one keeps it on screen.
 */
/** Shared so the not-searching default doesn't mint a new array every render. */
const NO_TERMS: string[] = [];

export function EditorGroup({
  label, rows: allRows, divider = 'icon',
  searchTerms = NO_TERMS, groupKey = label ?? '', onMatchCount, jump, deferRows = false,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Read here rather than threaded down from TaskEditor: this is the one
  // component that decides which rows are on show. Filtering here rather than
  // at the 23 call sites is what keeps it to one place, and it works because a
  // row already declares whether it holds a value — a chain task keeps its
  // chain, a plain one never sees the option.
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const rowFilter = useContext(EditorRowFilterContext);
  const rows = useMemo(
    () => (!simpleMode && !rowFilter ? allRows : allRows.filter(r =>
      (!simpleMode || editorRowShown(r.key, true, !!r.set))
      && (!rowFilter || rowFilter(r.key, !!r.set)))),
    [allRows, simpleMode, rowFilter]
  );

  const searching = searchTerms.length > 0;
  // Search runs over every row: a match is shown where it lives.
  const matches = useMemo(() => filterEditorRows(rows, searchTerms), [rows, searchTerms]);

  useEffect(() => {
    onMatchCount?.(groupKey, searching ? matches.length : 0);
  }, [onMatchCount, groupKey, searching, matches.length]);

  // Withdraw the count on unmount. Two groups exist only while editing an
  // existing task (Streaks, Convert), so without this their last count would
  // sit in the tally for a task that doesn't render them and stop "nothing
  // matched" from ever showing. Through a ref so it runs on unmount alone,
  // rather than re-reporting zero every time the query changes.
  const reportRef = useRef({ groupKey, onMatchCount, jump });
  reportRef.current = { groupKey, onMatchCount, jump };
  useEffect(() => () => {
    reportRef.current.onMatchCount?.(reportRef.current.groupKey, 0);
    reportRef.current.jump?.setSectionY(reportRef.current.groupKey, null);
  }, []);

  // A group with no search hit disappears entirely — the rows left on screen
  // are the answer, so a card standing there empty would be noise around it.
  const shown = searching ? matches : rows;
  // Simplified mode drops rows by key, so it can empty a group outright, and a
  // card with no rows in it is worse than no card. The group goes with its
  // last row.
  const rendered = rows.length > 0 && shown.length > 0;
  const hasValue = rows.some(r => r.set);
  useEffect(() => { jump?.setHasValue(groupKey, hasValue); }, [jump, groupKey, hasValue]);
  // A card that stops rendering has no place in the bar. One that renders
  // reports its place from onLayout, below.
  useEffect(() => { if (!rendered) jump?.setSectionY(groupKey, null); }, [jump, groupKey, rendered]);
  if (!rendered) return null;

  const sep = divider === 'full' ? styles.sepFull : styles.sep;
  const placeholders = deferRows && !searching;

  const content = (
    <>
      {!!label && <Text style={styles.groupLabel}>{label}</Text>}
      <View style={styles.card} onLayout={jump ? e => jump.setCardY(groupKey, e.nativeEvent.layout.y) : undefined}>
        {shown.map((r, i) => (
          <React.Fragment key={r.key}>
            {i > 0 && <View style={sep} />}
            {placeholders
              ? <View style={styles.rowPlaceholder} />
              : jump
                ? <View onLayout={e => jump.setRowY(groupKey, r.key, e.nativeEvent.layout.y)}>{r.node}</View>
                : r.node}
          </React.Fragment>
        ))}
      </View>
    </>
  );
  if (!jump) return content;
  return (
    <View onLayout={e => jump.setSectionY(groupKey, e.nativeEvent.layout.y)}>
      {content}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.bold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: spacing.md + spacing.xs, marginBottom: spacing.xs,
  },
  // About one EditorRow's resting height, so the card is close to its final
  // size before its rows mount.
  rowPlaceholder: { minHeight: spacing.md * 3 },
  card: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  // Matches the separator inset the rows use, so the divider starts at the
  // label rather than under the icon column.
  sep: {
    height: StyleSheet.hairlineWidth, backgroundColor: colors.separator,
    marginLeft: spacing.md + 18 + spacing.md,
  },
  sepFull: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
});
