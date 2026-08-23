import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeBlurView } from './SafeBlurView';
import { HighlightedText } from './HighlightedText';
import { SearchField } from './SearchField';
import { InlineAction } from './InlineAction';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { quickSearch, QUICK_SEARCH_LIMIT } from '../utils/quickSearch';
import type { SearchResult } from '../utils/fuzzySearch';
import { formatOccurrenceCount, type CollapsedOccurrence } from '../utils/searchCollapse';
import { displayTitleFor } from '../utils/visibilityUtils';
import { formatTaskDate } from '../utils/dateUtils';
import { format } from 'date-fns/format';
import { TaskCheckbox } from './TaskCheckbox';
import { haptics } from '../utils/haptics';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { Task } from '../types';

// Keeps the field's own value/onChangeText bound to the raw, fast-updating
// `query` state below — only the quickSearch recompute waits on this delay.
// Same fix as SearchScreen's (#1210): an expensive useMemo on every keystroke
// can make the JS thread fall behind, desyncing the controlled TextInput.
const SEARCH_DEBOUNCE_MS = 180;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Tapping a result. The caller decides where it opens (Today opens the editor). */
  onSelectTask: (task: Task) => void;
  /** The footer row — hands the query over to the Search tab rather than growing this card. */
  onOpenFullSearch: (query: string) => void;
}

/**
 * One result in the quick-search card: the task's title, and a second line
 * only when the row has something it must say to be identifiable.
 *
 * The title is `displayTitleFor`, not `task.title` — a chained task is named
 * by its active step everywhere else in the app, and this row was the one
 * surface that disagreed. It also *scored* as its step (see fuzzySearch), so
 * the two disagreeing put the highlight ranges of one string onto another:
 * searching "break" on a meal task titled "Breakfast" whose step reads
 * "Choose breakfast" highlighted the "st", five characters along from where
 * the match was.
 *
 * The date is here for the same reason and against the card's own rule below:
 * a generated task exists once per day, so a search for one matches a stack of
 * rows with the same title, and a card that shows five of them is showing one
 * task five times with nothing to tell them apart. `collapseOccurrences` folds
 * those into a single row, and this line is where that row says which
 * occurrence it is and how many it stands for. Undated one-off results with
 * nothing to count render the single line they always did.
 */
function QuickSearchRow({ result, onSelect, onTicked, styles }: {
  result: CollapsedOccurrence<SearchResult>;
  onSelect: (task: Task) => void;
  onTicked: (taskId: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { task, titleMatches, occurrenceCount } = result;
  const displayTitle = displayTitleFor(task);

  // A completed row is placed by when it was done; a live one by the date it
  // sits on (formatTaskDate reads the defer/due rule, so the label can't name a
  // different day from the one the task actually surfaces on).
  const dateLabel = task.completed
    ? task.completedAt ? `Done ${format(new Date(task.completedAt), 'MMM d')}` : 'Done'
    : formatTaskDate(task);
  const countLabel = formatOccurrenceCount(occurrenceCount);

  return (
    // A plain View holding two touchables, not one touchable wrapping the
    // box: a TouchableOpacity is `accessible` by default, so a checkbox
    // nested inside one is folded into the row's single element and never
    // announced on its own.
    <View style={styles.resultRow}>
      <TaskCheckbox task={task} taskLabel={displayTitle} onTicked={onTicked} />
      <TouchableOpacity
        style={styles.resultTap}
        onPress={() => onSelect(task)}
        activeOpacity={interaction.activeOpacity}
        // Puts the row's own padding back into the tap target, which
        // the title alone doesn't cover. Nothing on the left: that
        // side belongs to the checkbox.
        hitSlop={{ top: 9, bottom: 9, right: spacing.xs }}
        accessibilityRole="button"
        accessibilityLabel={[
          displayTitle,
          task.archived ? 'archived' : null,
          task.completed ? 'completed' : null,
          dateLabel,
          countLabel ? `and ${countLabel}` : null,
        ].filter(Boolean).join(', ')}
        accessibilityHint="Double tap to open task"
      >
        <View style={styles.resultTitleRow}>
          <HighlightedText
            text={displayTitle}
            ranges={titleMatches}
            style={[styles.resultTitle, task.completed && styles.resultTitleDone]}
            highlightStyle={styles.highlight}
            numberOfLines={1}
          />
          {task.archived && <Text style={styles.archivedLabel}>Archived</Text>}
        </View>
        {(dateLabel || countLabel) && (
          <View style={styles.resultMeta}>
            {dateLabel && <Text style={styles.metaText}>{dateLabel}</Text>}
            {countLabel && (
              <View style={styles.countPill}>
                <Text style={styles.countText}>{countLabel}</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

/**
 * The pull-down quick search: a small card over a dimmed screen, holding a
 * field and at most five results.
 *
 * Deliberately a *narrower* thing than the Search tab rather than a smaller
 * copy of it. The Search screen's rows carry tags, a notes preview and a
 * project chip and split into Active/Completed sections; this carries none of
 * that, and only the one meta line a row needs to be told apart from its own
 * other occurrences (see QuickSearchRow). Anything the cap can't answer goes
 * to the footer row, which is why there's no scrolling here — a card you have
 * to scroll isn't quick.
 */
export function QuickSearchModal({ visible, onClose, onSelectTask, onOpenFullSearch }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);

  const tasks = useTaskStore(s => s.tasks);
  const projects = useProjectStore(s => s.projects);

  const [query, setQuery] = useState('');

  const scaleAnim = useRef(new Animated.Value(0.94)).current;
  // Enters from *above* its resting place, unlike QuickAddModal — the card is
  // answering a downward pull, so it should arrive travelling the same way.
  const translateYAnim = useRef(new Animated.Value(-20)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const projectNamesById = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects]
  );

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  // Tasks ticked from this card, held in their slot so the tick is visible
  // rather than re-sorting the row past the cap and out of the card (see
  // quickSearch). Dropped whenever the query moves on, since that's a new set
  // of results and nothing is being held in place any more.
  const [heldIds, setHeldIds] = useState<ReadonlySet<string>>(new Set());
  const hold = useCallback(
    (taskId: string) => setHeldIds(prev => new Set(prev).add(taskId)),
    []
  );
  useEffect(() => setHeldIds(new Set()), [debouncedQuery]);

  const { results, total } = useMemo(
    () => quickSearch(tasks, debouncedQuery, projectNamesById, QUICK_SEARCH_LIMIT, heldIds),
    [tasks, debouncedQuery, projectNamesById, heldIds]
  );

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    scaleAnim.setValue(0.94);
    translateYAnim.setValue(-20);
    cardOpacity.setValue(0);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.spring(translateYAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start(() => {
      // Focus after the card settles so its spring and the keyboard's own
      // slide-up don't overlap — same reasoning as QuickAddModal.
      inputRef.current?.focus();
    });
  }, [visible]);

  const dismiss = (then?: () => void) => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.94, duration: 120, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      scaleAnim.setValue(0.94);
      cardOpacity.setValue(0);
      onClose();
      then?.();
    });
  };

  const handleSelect = (task: Task) => {
    haptics.tap();
    dismiss(() => onSelectTask(task));
  };

  const handleOpenFull = () => {
    haptics.tap();
    const handoff = query;
    dismiss(() => onOpenFullSearch(handoff));
  };

  const trimmed = query.trim();
  const showNoMatches = trimmed.length > 0 && results.length === 0;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={() => dismiss()}
        accessibilityRole="button"
        accessibilityLabel="Close quick search"
      />

      <View style={[styles.topContainer, { paddingTop: insets.top + spacing.md }]} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            shadows.sheet,
            { opacity: cardOpacity, transform: [{ scale: scaleAnim }, { translateY: translateYAnim }] },
          ]}
        >
          <SearchField
            ref={inputRef}
            surface="sunken"
            placeholder="Search todos…"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleOpenFull}
          />

          {results.length > 0 && (
            <View style={styles.results}>
              {/* A plain View holding two touchables, not one touchable
                  wrapping the box: a TouchableOpacity is `accessible` by
                  default, so a checkbox nested inside one is folded into the
                  row's single element and never announced on its own. */}
              {results.map(result => (
                <QuickSearchRow
                  key={result.task.id}
                  result={result}
                  onSelect={handleSelect}
                  onTicked={hold}
                  styles={styles}
                />
              ))}
            </View>
          )}

          {showNoMatches && (
            <Text style={styles.noMatches}>No todos match “{trimmed}”</Text>
          )}

          {results.length > 0 && (
            <View style={styles.footer}>
              <InlineAction
                label={total === 1 ? 'See 1 result' : `See all ${total} results`}
                onPress={handleOpenFull}
              />
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },

  topContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.md,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    padding: spacing.sm,
  },

  results: { marginTop: spacing.xs },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  // A column, not a row: the meta line sits under the title. The title's own
  // row keeps the horizontal arrangement the Archived label needs.
  resultTap: {
    flex: 1,
    gap: 2,
  },
  resultTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resultTitle: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: { color: colors.textSecondary, fontSize: font.xs },
  // Enclosed rather than loose in the meta row: "4 more dates" beside a date
  // reads as part of the date otherwise, and the count is a fact about the
  // row rather than about the day it names.
  countPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: colors.bgSunken,
  },
  countText: { color: colors.textSecondary, fontSize: font.xs },
  resultTitleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  highlight: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
  archivedLabel: {
    color: colors.orange,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },

  noMatches: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.xs,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    paddingTop: 10,
    paddingHorizontal: spacing.xs,
    borderTopWidth: border.hairline,
    borderTopColor: colors.separator,
  },
});
