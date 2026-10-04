import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NamedIcon } from './CoinIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeBlurView } from './SafeBlurView';
import { HighlightedText } from './HighlightedText';
import { SearchField } from './SearchField';
import { InlineAction } from './InlineAction';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, animation, interaction, type Colors } from '../theme';
import { useShallow } from 'zustand/react/shallow';
import { useTasksWhileOpen } from '../hooks/useTasksWhileOpen';
import { useEventTaskContext } from '../hooks/useEventTaskContext';
import { useProjectStore, projectProgress } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { categoryLabel } from '../utils/categoryLabel';
import { quickSearch, QUICK_SEARCH_LIMIT } from '../utils/quickSearch';
import { allElsewhere, describeElsewhere, quickElsewhere, type ElsewhereResult } from '../utils/searchElsewhere';
import { useElsewhereSearch } from '../hooks/useElsewhereSearch';
import type { SearchResult, GroupSearchResult, ProjectSearchResult } from '../utils/fuzzySearch';
import { formatOccurrenceCount, type CollapsedOccurrence } from '../utils/searchCollapse';
import { displayTitleFor, groupRoster, quotaNextDueLabel } from '../utils/visibilityUtils';
import { peopleOn, groupMentionTokens } from '../utils/peopleRegistry';
import { matchPersonMentions } from '../utils/parseTaskInput';
import { mergeRanges } from '../utils/ranges';
import { formatTaskDate, hoursUnlockLabel } from '../utils/dateUtils';
import { format } from 'date-fns/format';
import { TaskCheckbox } from './TaskCheckbox';
import { SheetScrim } from './SheetScrim';
import { haptics } from '../utils/haptics';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { Task, TaskGroup } from '../types';
import { useFilterField } from '../hooks/useFilterField';

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
  /** Tapping a matched stack. */
  onSelectGroup: (group: TaskGroup) => void;
  /** Tapping a matched project. */
  onSelectProject: (projectId: string) => void;
  /**
   * Tapping anything that isn't a task, stack or project: a screen, a setting,
   * a person, a recipe or a grocery item. `openElsewhereResult` opens it.
   */
  onSelectElsewhere: (result: ElsewhereResult) => void;
  /** The footer row — hands the query over to the Search tab rather than growing this card. */
  onOpenFullSearch: (query: string) => void;
  /** The sheet is on screen (the native modal's `onShow`). */
  onShown?: () => void;
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
 * The meta line under it is here against the card's own rule below, and earns
 * it twice over. A generated task exists once per day, so a search for one
 * matches a stack of rows with the same title: a card showing five of them is
 * showing one task five times. `collapseOccurrences` folds those into a single
 * row, and the **date** is how that row says which occurrence it is and how
 * many it stands for. The **project and category** answer the other half — a
 * title alone is often too generic to place ("Choose breakfast", "Follow up",
 * "Order more"), and which of the two answers it varies by task, so neither
 * one is the one that gets dropped when the other is present.
 *
 * A result with no project, no category, no date and nothing to count renders
 * the single line it always did — most one-off searches look unchanged.
 */
function QuickSearchRow({ result, onSelect, onTicked, styles, colors }: {
  result: CollapsedOccurrence<SearchResult>;
  onSelect: (task: Task) => void;
  onTicked: (taskId: string) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { task, titleMatches, projectName, projectMatches, occurrenceCount } = result;
  const categories = useCategoryStore(s => s.categories);
  const displayTitle = displayTitleFor(task);
  // An "@name" mention stays literal in the title (see matchPersonMentions'
  // doc comment) and is tinted the same as a matched query term — merged into
  // one range set since the two can overlap, and HighlightedText needs
  // disjoint ranges.
  const titleRanges = useMemo(
    () => mergeRanges([...titleMatches, ...matchPersonMentions(displayTitle, peopleOn(task), groupMentionTokens(task.personIds)).map((m): [number, number] => [m.start, m.end])]),
    [titleMatches, displayTitle, task.personIds]
  );
  const category = categoryLabel(task.category, categories);

  // A completed row is placed by when it was done; a live one by the date it
  // sits on (formatTaskDate reads the defer/due rule, so the label can't name a
  // different day from the one the task actually surfaces on).
  const dateLabel = task.completed
    ? task.completedAt ? `Done ${format(new Date(task.completedAt), 'MMM d')}` : 'Done'
    : formatTaskDate(task);
  // An "every N hours" task's dateLabel above is just "Today" — the date it's
  // on, not the clock time it actually comes back at, which is the fact this
  // row exists to answer (see hoursUnlockLabel's own comment).
  const hoursUnlock = task.completed ? null : hoursUnlockLabel(task);
  // The same gap for a daily target that's on pace: its date is "Today", and
  // what the row is for is when the next unit comes due.
  const quotaNext = quotaNextDueLabel(task);
  const countLabel = formatOccurrenceCount(occurrenceCount);
  // Which calendar event a rule wrote this row for; null on any other task.
  const eventContext = useEventTaskContext(task);

  // Built as a list so the dots between the parts can be interleaved rather
  // than each part having to know what's beside it. A generic-sounding title
  // ("Choose breakfast", "Follow up") is the case this line exists for, and
  // which of the three facts answers it varies by task, so none of them can be
  // the one that's dropped when another is present. The project and the
  // category shrink and truncate; the date doesn't, since a truncated date
  // says nothing and it's the part that tells one occurrence from another.
  const meta: React.ReactNode[] = [];
  if (projectName) {
    meta.push(
      <View style={styles.projectChip}>
        <Ionicons name="briefcase-outline" size={iconSize.xs} color={colors.textSecondary} />
        {/* Highlighted like the title: a result can match on its project's
            name alone, and the row should say why it's in the list. */}
        <HighlightedText
          text={projectName}
          ranges={projectMatches}
          style={styles.projectText}
          highlightStyle={styles.metaHighlight}
          numberOfLines={1}
        />
      </View>
    );
  }
  if (category) {
    // Plain text with its emoji, no icon — the pairing NewTasksBanner and the
    // Search screen's rows already use for a category beside a project chip.
    meta.push(<Text style={styles.categoryText} numberOfLines={1}>{category}</Text>);
  }
  // Shrinks and truncates like the category, so the date stays whole.
  if (eventContext) meta.push(<Text style={styles.categoryText} numberOfLines={1}>{eventContext}</Text>);
  if (dateLabel) meta.push(<Text style={styles.dateText}>{dateLabel}</Text>);
  if (hoursUnlock) meta.push(<Text style={styles.dateText}>Unlocks {hoursUnlock}</Text>);
  if (quotaNext) meta.push(<Text style={styles.dateText}>Next {quotaNext}</Text>);

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
          eventContext,
          projectName ? `in ${projectName}` : null,
          task.category ? `in ${task.category}` : null,
          task.archived ? 'archived' : null,
          task.completed ? 'completed' : null,
          dateLabel,
          hoursUnlock ? `unlocks ${hoursUnlock}` : null,
          quotaNext ? `next ${quotaNext}` : null,
          countLabel ? `and ${countLabel}` : null,
        ].filter(Boolean).join(', ')}
        accessibilityHint="Double tap to open task"
      >
        <View style={styles.resultTitleRow}>
          <HighlightedText
            text={displayTitle}
            ranges={titleRanges}
            style={[styles.resultTitle, styles.resultTitleFill, task.completed && styles.resultTitleDone]}
            highlightStyle={styles.highlight}
            numberOfLines={1}
          />
          {task.archived && <Text style={styles.archivedLabel}>Archived</Text>}
        </View>
        {meta.length > 0 && (
          <View style={styles.resultMeta}>
            {meta.map((node, i) => (
              <React.Fragment key={i}>
                {i > 0 && <Text style={styles.metaDot}>·</Text>}
                {node}
              </React.Fragment>
            ))}
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
 * A stack or project match, in the card's own one-line shape — same icon and
 * layout `StackResultItem`/`ProjectResultItem` use on the Search screen, cut
 * down to the single meta line this card allows (see QuickSearchRow's own
 * note on why it carries no more than that).
 */
function QuickSearchGroupRow({ result, onSelect, styles, colors }: {
  result: GroupSearchResult;
  onSelect: (group: TaskGroup) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { group, titleMatches, memberCount } = result;
  const memberLabel = memberCount === 0 ? 'No tasks yet' : `${memberCount} ${memberCount === 1 ? 'task' : 'tasks'}`;
  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={() => onSelect(group)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${group.title}, stack, ${memberLabel}`}
      accessibilityHint="Double tap to open stack"
    >
      <View style={styles.entityIcon}>
        <Ionicons name="layers-outline" size={iconSize.sm} color={colors.accent} />
      </View>
      <View style={styles.resultTap}>
        <HighlightedText
          text={group.title}
          ranges={titleMatches}
          style={styles.resultTitle}
          highlightStyle={styles.highlight}
          numberOfLines={1}
        />
        <Text style={styles.metaText} numberOfLines={1}>{memberLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

function QuickSearchProjectRow({ result, onSelect, styles, colors }: {
  result: ProjectSearchResult;
  onSelect: (projectId: string) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { project, titleMatches, progress } = result;
  const progressLabel = progress.total === 0 ? 'No tasks yet' : `${progress.done}/${progress.total} done`;
  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={() => onSelect(project.id)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${project.title}, project, ${progressLabel}`}
      accessibilityHint="Double tap to open project"
    >
      <View style={styles.entityIcon}>
        <Ionicons name="briefcase-outline" size={iconSize.sm} color={colors.accent} />
      </View>
      <View style={styles.resultTap}>
        <HighlightedText
          text={project.title}
          ranges={titleMatches}
          style={styles.resultTitle}
          highlightStyle={styles.highlight}
          numberOfLines={1}
        />
        <Text style={styles.metaText} numberOfLines={1}>{progressLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

/**
 * A match that isn't a task: a screen, a setting, a person, a recipe or a
 * grocery item, in the card's one-line shape. The meta line names the kind
 * (the card has no section headers to do it), and for a screen or a setting
 * says where it lives, because a match that came off a keyword ("scale"
 * finding Weight) otherwise has nothing on screen saying why.
 */
function QuickSearchElsewhereRow({ result, onSelect, styles, colors }: {
  result: ElsewhereResult;
  onSelect: (result: ElsewhereResult) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const described = describeElsewhere(result);
  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={() => onSelect(result)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${result.title}, ${described.accessibilityKind}`}
      accessibilityHint="Double tap to open"
    >
      <View style={styles.entityIcon}>
        <NamedIcon name={described.icon} size={iconSize.sm} color={colors.accent} />
      </View>
      <View style={styles.resultTap}>
        <HighlightedText
          text={result.title}
          ranges={result.ranges}
          style={styles.resultTitle}
          highlightStyle={styles.highlight}
          numberOfLines={1}
        />
        <Text style={styles.metaText} numberOfLines={1}>{described.cardMeta}</Text>
      </View>
    </TouchableOpacity>
  );
}

/**
 * The pull-down quick search: a small card over a dimmed screen, holding a
 * field and at most seven results.
 *
 * Deliberately a *narrower* thing than the Search tab rather than a smaller
 * copy of it. The Search screen's rows carry tags, a notes preview and a
 * project chip and split into Active/Completed sections; this carries none of
 * that, and only the one meta line a row needs to be placed and told apart
 * from its own other occurrences (see QuickSearchRow). Anything the cap can't answer goes
 * to the footer row, which is why there's no scrolling here — a card you have
 * to scroll isn't quick.
 *
 * Stacks and projects lead the card, same priority the Search screen gives
 * them and the same reasoning — a title match on either is almost always a
 * navigational lookup, not a task search — and they spend the same seven-row
 * budget the task rows do (see `quickSearch`), rather than getting a budget
 * of their own on top.
 *
 * Everything that isn't a task leads ahead of both: screens, settings, people,
 * recipes and grocery items (`useElsewhereSearch`), so Weight, Tom's page or
 * the tomatoes on the list are a pull and a few letters away rather than the
 * menu, a hub row and a pill. They take at most `QUICK_ELSEWHERE_LIMIT` of the
 * seven slots between them, because the card is mostly for tasks; the
 * footer's count includes all of them, since the Search tab it opens lists
 * every kind.
 */
export function QuickSearchModal({ visible, onClose, onSelectTask, onSelectGroup, onSelectProject, onSelectElsewhere, onOpenFullSearch, onShown }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const tasks = useTasksWhileOpen(visible);
  const projects = useProjectStore(s => s.projects);
  const groups = useTaskGroupStore(s => s.groups);
  const recentSearches = useSettingsStore(useShallow(s => s.recentSearches));
  const pushRecentSearch = useSettingsStore(s => s.pushRecentSearch);
  const clearRecentSearches = useSettingsStore(s => s.clearRecentSearches);

  const searchFilter = useFilterField();
  const query = searchFilter.query;

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

  // Same collapse SearchScreen and StacksScreen use for a stack's own roster
  // (one entry per series, no completion tombstones) — keyed off the task
  // list rather than the debounced query, so it doesn't recompute per
  // keystroke.
  const rosterByGroupId = useMemo(() => {
    const children = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.groupId) continue;
      const list = children.get(t.groupId);
      if (list) list.push(t);
      else children.set(t.groupId, [t]);
    }
    const rosters = new Map<string, Task[]>();
    for (const [groupId, list] of children) {
      rosters.set(groupId, groupRoster(list));
    }
    return rosters;
  }, [tasks]);

  // Same reasoning, over projects: cheap enough to keep for every project
  // (unlike the Search screen, which only bothers for the ones a query
  // actually matched) because this only reruns when the store itself
  // changes, not on every keystroke.
  const progressByProject = useMemo(
    () => new Map(projects.map(p => [p.id, projectProgress(p.id, tasks)])),
    [projects, tasks]
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

  // Screens, settings, people, recipes and groceries: everything that isn't a
  // task. Searchable only where the side menu still offers it (see
  // useElsewhereSearch), and at most QUICK_ELSEWHERE_LIMIT rows of them.
  const elsewhereSections = useElsewhereSearch(debouncedQuery, visible);
  const elsewhereResults = useMemo(() => quickElsewhere(elsewhereSections), [elsewhereSections]);
  const elsewhereTotal = useMemo(() => allElsewhere(elsewhereSections).length, [elsewhereSections]);

  // Those rows spend the card's seven slots rather than adding to them.
  const { groupResults, projectResults, results, total: taskTotal } = useMemo(
    () => quickSearch(
      tasks, debouncedQuery, projectNamesById, QUICK_SEARCH_LIMIT - elsewhereResults.length, heldIds,
      groups, rosterByGroupId, projects, progressByProject
    ),
    [tasks, debouncedQuery, projectNamesById, elsewhereResults.length, heldIds, groups, rosterByGroupId, projects, progressByProject]
  );
  // The footer's count is what the Search screen will show, which is now
  // everything this card found, not just the tasks.
  const total = taskTotal + elsewhereTotal;

  useEffect(() => {
    if (!visible) return;
    searchFilter.clear();
    scaleAnim.setValue(0.94);
    translateYAnim.setValue(-20);
    cardOpacity.setValue(0);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.spring(translateYAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // Focus (and the keyboard's own slide-up) starts alongside the card
    // animation rather than after it, so the keyboard is up sooner —
    // same fix as QuickAddModal's (#1210).
    searchFilter.inputRef.current?.focus();
  }, [visible]);

  const dismiss = (then?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.94, duration: animation.duration.dismiss, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: animation.duration.dismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      scaleAnim.setValue(0.94);
      cardOpacity.setValue(0);
      onClose();
      then?.();
    });
  };

  const handleSelect = (task: Task) => {
    haptics.tap();
    pushRecentSearch(query);
    dismiss(() => onSelectTask(task));
  };

  const handleSelectGroup = (group: TaskGroup) => {
    haptics.tap();
    pushRecentSearch(query);
    dismiss(() => onSelectGroup(group));
  };

  const handleSelectProject = (projectId: string) => {
    haptics.tap();
    pushRecentSearch(query);
    dismiss(() => onSelectProject(projectId));
  };

  const handleSelectElsewhere = (result: ElsewhereResult) => {
    haptics.tap();
    pushRecentSearch(query);
    dismiss(() => onSelectElsewhere(result));
  };

  const handleOpenFull = () => {
    haptics.tap();
    pushRecentSearch(query);
    const handoff = query;
    dismiss(() => onOpenFullSearch(handoff));
  };

  const trimmed = query.trim();
  const hasTaskResults = groupResults.length > 0 || projectResults.length > 0 || results.length > 0;
  const hasResults = hasTaskResults || elsewhereResults.length > 0;
  const showNoMatches = trimmed.length > 0 && !hasResults;

  // Return goes to the Search tab as it always has, unless the query found no
  // task at all: "weight" means the Weight screen, not a Search tab with one
  // row on it.
  const handleSubmit = () => {
    if (!hasTaskResults && elsewhereResults.length > 0) {
      handleSelectElsewhere(elsewhereResults[0]);
      return;
    }
    handleOpenFull();
  };

  return (
    <SheetModal visible={visible} animationType="none" transparent onShow={onShown} onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={() => dismiss()} label="Close quick search" />

      <View style={[styles.topContainer, { paddingTop: insets.top + spacing.md }]} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            shadows.sheet,
            { opacity: cardOpacity, transform: [{ scale: scaleAnim }, { translateY: translateYAnim }] },
          ]}
        >
          <SearchField
            surface="sunken"
            placeholder="Search everything"
            field={searchFilter}
            onSubmitEditing={handleSubmit}
          />

          {/* Looking the same thing up twice is the common case here too — see
              utils/recentSearches. Capped to the card's own quick-search limit
              rather than the full 8 the setting keeps, for the same reason the
              results list caps itself: an uncapped card isn't quick. */}
          {trimmed.length === 0 && recentSearches.length > 0 && (
            <View style={styles.recents}>
              <View style={styles.recentsHeader}>
                <Text style={styles.recentsLabel}>Recent</Text>
                <TouchableOpacity
                  onPress={clearRecentSearches}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel="Clear recent searches"
                >
                  <Text style={styles.recentsClear}>Clear</Text>
                </TouchableOpacity>
              </View>
              {recentSearches.slice(0, QUICK_SEARCH_LIMIT).map(q => (
                <TouchableOpacity
                  key={q}
                  style={styles.resultRow}
                  onPress={() => searchFilter.seed(q)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Search again for ${q}`}
                >
                  <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.recentText} numberOfLines={1}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {hasResults && (
            <View style={styles.results}>
              {elsewhereResults.map(result => (
                <QuickSearchElsewhereRow
                  key={result.key}
                  result={result}
                  onSelect={handleSelectElsewhere}
                  styles={styles}
                  colors={colors}
                />
              ))}
              {/* Stacks and projects lead, same order and reasoning as the
                  Search screen's own sections (see the doc comment above). */}
              {groupResults.map(result => (
                <QuickSearchGroupRow
                  key={result.group.id}
                  result={result}
                  onSelect={handleSelectGroup}
                  styles={styles}
                  colors={colors}
                />
              ))}
              {projectResults.map(result => (
                <QuickSearchProjectRow
                  key={result.project.id}
                  result={result}
                  onSelect={handleSelectProject}
                  styles={styles}
                  colors={colors}
                />
              ))}
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
                  colors={colors}
                />
              ))}
            </View>
          )}

          {showNoMatches && (
            <Text style={styles.noMatches}>No matches for “{trimmed}”</Text>
          )}

          {hasResults && (
            <View style={styles.footer}>
              <InlineAction
                label={total === 1 ? 'See 1 result' : `See all ${total} results`}
                onPress={handleOpenFull}
              />
            </View>
          )}
        </Animated.View>
      </View>
    </SheetModal>
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

  recents: { marginTop: spacing.xs },
  recentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
  },
  recentsLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  recentsClear: {
    color: colors.accent,
    fontSize: font.sm,
  },
  recentText: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
  },

  results: { marginTop: spacing.xs },
  // Same slot TaskCheckbox occupies on a task row, so a stack/project row's
  // icon lines up with the checkboxes above and below it.
  entityIcon: {
    width: 20,
    alignItems: 'center',
  },
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
    gap: spacing.xxs,
  },
  resultTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resultTitle: {
    color: colors.text,
    fontSize: font.md,
  },
  // Only inside `resultTitleRow`, where the title shares a row with the
  // Archived label. Never on `resultTitle` itself: the stack, project and
  // screen rows put their title straight into `resultTap`, a column, where
  // `flex: 1` sizes its *height* from zero and the title vanishes, leaving
  // only the meta line under an icon.
  resultTitleFill: { flex: 1 },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: { color: colors.textSecondary, fontSize: font.xs },
  metaHighlight: { color: colors.accent, fontWeight: fontWeight.semibold },
  // Dots rather than the Search screen's bare gaps: that row separates its
  // parts with an icon, coloured tag dots and a "Due" prefix, and this one has
  // none of those, so "Home Friday" would read as one phrase.
  metaDot: { color: colors.textTertiary, fontSize: font.xs },
  projectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  // flexShrink on the Text itself, not just on the chip around it: RN defaults
  // a Text to flexShrink 0, so a chip that can shrink holding a text that
  // can't just pushes the date off the end of the row instead of truncating.
  projectText: { color: colors.textSecondary, fontSize: font.xs, flexShrink: 1 },
  categoryText: { color: colors.textSecondary, fontSize: font.xs, flexShrink: 1 },
  dateText: { color: colors.textSecondary, fontSize: font.xs, flexShrink: 0 },
  // Enclosed rather than loose in the meta row: "4 more dates" beside a date
  // reads as part of the date otherwise, and the count is a fact about the
  // row rather than about the day it names.
  countPill: {
    paddingHorizontal: spacing.xsm,
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
    paddingVertical: spacing.smd,
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
