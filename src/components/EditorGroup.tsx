import React, { useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { filterEditorRows } from '../utils/editorSearch';
import { editorRowShown } from '../utils/simpleMode';
import { foldedRowCount, isRowFolded } from '../utils/editorFold';
import { useSettingsStore } from '../store/useSettingsStore';

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
  /**
   * Rarely needed, so tucked behind the editor's "More options" until the task
   * holds a value for it (`set`), the user opens More, or a search matches it.
   * A folded row is hidden, never removed: it renders exactly as before once
   * revealed. A row that sets itself `fold` must also report `set`, or a task
   * already using it would lose sight of the value.
   */
  fold?: boolean;
  node: React.ReactNode;
}

interface Props {
  /** Uppercase group heading — SCHEDULE, ORGANIZE, … */
  label: string;
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
  /** Is the editor's "More options" open? See `fold` on `EditorGroupRow`. */
  moreOpen?: boolean;
  /**
   * Changes each time the editor loads a task. A folded row that appeared
   * because it held a value stays on screen for the rest of the session (so it
   * can't vanish when cleared); this is what ends that session.
   */
  foldEpoch?: number;
  /** How many folded rows this group holds, reported so the editor can label the toggle. */
  onFoldCount?: (groupKey: string, count: number) => void;
}

/**
 * One card of an editor form: a group label followed by its rows, in order.
 * No group collapses. A row hides in only two ways: Simplified mode drops the
 * ones it covers, and a row tagged `fold` waits behind the editor's "More
 * options" until the task holds a value for it. Either way what a task already
 * holds is on screen.
 */
/** Shared so the not-searching default doesn't mint a new array every render. */
const NO_TERMS: string[] = [];

export function EditorGroup({
  label, rows: allRows, divider = 'icon',
  searchTerms = NO_TERMS, groupKey = label, onMatchCount,
  moreOpen = false, foldEpoch = 0, onFoldCount,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Read here rather than threaded down from TaskEditor: this is the one
  // component that decides which rows are on show. Filtering here rather than
  // at the 23 call sites is what keeps it to one place, and it works because a
  // row already declares whether it holds a value — a chain task keeps its
  // chain, a plain one never sees the option.
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const rows = useMemo(
    () => (simpleMode ? allRows.filter(r => editorRowShown(r.key, true, !!r.set)) : allRows),
    [allRows, simpleMode]
  );

  const searching = searchTerms.length > 0;
  // Search runs over every row, folded or not: a match is shown where it lives.
  const matches = useMemo(() => filterEditorRows(rows, searchTerms), [rows, searchTerms]);

  // A folded row that held a value is remembered for the session, so clearing
  // it doesn't make it vanish under the finger. Rows revealed only by opening
  // More options are deliberately not remembered, or "Fewer options" couldn't
  // fold them again.
  const revealedRef = useRef<{ epoch: number; keys: Set<string> }>({ epoch: foldEpoch, keys: new Set() });
  if (revealedRef.current.epoch !== foldEpoch) revealedRef.current = { epoch: foldEpoch, keys: new Set() };
  for (const r of rows) if (r.fold && r.set) revealedRef.current.keys.add(r.key);

  const foldState = { moreOpen, searching, revealed: revealedRef.current.keys };
  const unfolded = rows.filter(r => !isRowFolded(r, foldState));
  const foldedCount = foldedRowCount(rows);

  useEffect(() => {
    onFoldCount?.(groupKey, foldedCount);
  }, [onFoldCount, groupKey, foldedCount]);

  useEffect(() => {
    onMatchCount?.(groupKey, searching ? matches.length : 0);
  }, [onMatchCount, groupKey, searching, matches.length]);

  // Withdraw the count on unmount. Two groups exist only while editing an
  // existing task (Streaks, Convert), so without this their last count would
  // sit in the tally for a task that doesn't render them and stop "nothing
  // matched" from ever showing. Through a ref so it runs on unmount alone,
  // rather than re-reporting zero every time the query changes.
  const reportRef = useRef({ groupKey, onMatchCount });
  reportRef.current = { groupKey, onMatchCount };
  useEffect(() => () => {
    reportRef.current.onMatchCount?.(reportRef.current.groupKey, 0);
  }, []);
  const foldReportRef = useRef({ groupKey, onFoldCount });
  foldReportRef.current = { groupKey, onFoldCount };
  useEffect(() => () => {
    foldReportRef.current.onFoldCount?.(foldReportRef.current.groupKey, 0);
  }, []);

  // Simplified mode can empty a group outright — "Relationships" is Waiting on
  // and Blocks and nothing else — and a card with no rows in it is worse than
  // no card. The group goes with its last row.
  if (rows.length === 0) return null;

  // A group with no search hit disappears entirely — the rows left on screen
  // are the answer, so a card standing there empty would be noise around it.
  // The same goes for a group whose every row is folded (Task actions): its
  // label and an empty card would stand there for nothing.
  const shown = searching ? matches : unfolded;
  if (shown.length === 0) return null;
  if (searching && shown.length === 0) return null;

  const sep = divider === 'full' ? styles.sepFull : styles.sep;

  return (
    <>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.card}>
        {shown.map((r, i) => (
          <React.Fragment key={r.key}>
            {i > 0 && <View style={sep} />}
            {r.node}
          </React.Fragment>
        ))}
      </View>
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.bold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: spacing.md + spacing.xs, marginBottom: spacing.xs,
  },
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
