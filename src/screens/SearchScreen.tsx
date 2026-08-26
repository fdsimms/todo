import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore, projectProgress } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import { TaskGroupEditor } from '../components/TaskGroupEditor';
import type { Category, Task, TaskGroup } from '../types';
import type { SearchResult, GroupSearchResult, ProjectSearchResult } from '../utils/fuzzySearch';
import { fuzzySearch, searchGroups, searchProjects } from '../utils/fuzzySearch';
import { collapseOccurrences, formatOccurrenceCount, type CollapsedOccurrence } from '../utils/searchCollapse';
import { displayTitleFor, groupRoster, isQuotaPartial } from '../utils/visibilityUtils';
import { peopleOn } from '../utils/peopleRegistry';
import { matchPersonMentions } from '../utils/parseTaskInput';
import { mergeRanges } from '../utils/ranges';
import { asksOnCompletion, formatTaskDeliverable } from '../utils/deliverables';
import { formatQuotaProgress } from '../utils/quotaUnit';
import { tagColor } from '../utils/tagColor';
import { categoryLabel } from '../utils/categoryLabel';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { TaskCheckbox, TASK_CHECKBOX_SIZE } from '../components/TaskCheckbox';
import { SearchField } from '../components/SearchField';
import { EmptyState } from '../components/EmptyState';
import { HighlightedText } from '../components/HighlightedText';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { format } from 'date-fns/format';

// How long the field waits for typing to pause before the expensive
// fuzzySearch recompute runs. The TextInput's own value/onChangeText stay
// bound to the raw `query` state below regardless — this only delays the
// results useMemo, so fast typing never desyncs the controlled input from
// what's on screen while still keeping the recompute off every keystroke.
const SEARCH_DEBOUNCE_MS = 180;

function SearchResultItem({ result, onPress, onTicked, categories, styles, colors }: {
  result: CollapsedOccurrence<SearchResult>;
  onPress: () => void;
  onTicked: (taskId: string) => void;
  categories: Category[];
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { task, titleMatches, projectName, projectMatches, occurrenceCount } = result;
  const isCompleted = task.completed;
  // A daily target closed out short of its count (see rolloverQuotas) is still
  // `completed`, but a plain green checkmark would read as the same full
  // finish an on-target row gets. Same distinction Logbook's row draws.
  const partial = isQuotaPartial(task);

  const completedDate = task.completedAt
    ? format(new Date(task.completedAt), 'MMM d')
    : null;

  const displayTitle = displayTitleFor(task);
  // An "@name" mention stays literal in the title (see matchPersonMentions'
  // doc comment) and is tinted the same as a matched query term — merged
  // into one range set since the two can overlap (searching "brittany" with
  // "@Brittany" in the title), and HighlightedText needs disjoint ranges.
  const titleRanges = useMemo(
    () => mergeRanges([...titleMatches, ...matchPersonMentions(displayTitle, peopleOn(task)).map((m): [number, number] => [m.start, m.end])]),
    [titleMatches, displayTitle, task.personIds]
  );
  const answer = formatTaskDeliverable(task);
  const category = categoryLabel(task.category, categories);
  // What this row stands for besides itself, when it's one date of a repeat
  // (see collapseOccurrences). Null on an ordinary one-off, which is most rows.
  const countLabel = formatOccurrenceCount(occurrenceCount);

  const a11yLabel = [
    displayTitle,
    projectName ? `in ${projectName}` : null,
    task.category ? `in ${task.category}` : null,
    task.archived ? 'archived' : null,
    isCompleted
      ? partial
        ? `fell short at ${formatQuotaProgress(task.progressCount, task.targetCount!, task.targetUnit)}${completedDate ? `, ${completedDate}` : ''}`
        : `completed${completedDate ? ` ${completedDate}` : ''}`
      : null,
    isCompleted && asksOnCompletion(task) ? (answer !== null ? `answered ${answer}` : 'no answer') : null,
    !isCompleted && task.dueDate ? `due ${format(new Date(task.dueDate), 'MMM d')}` : null,
    countLabel ? `and ${countLabel}` : null,
  ].filter(Boolean).join(', ');

  return (
    // The card itself is a plain View with two touchables inside it, rather
    // than one touchable wrapping the box — same shape the Logbook row uses,
    // and for the same reason: a TouchableOpacity is `accessible` by default,
    // so a checkbox nested inside one is collapsed into the row's single
    // element and never announced. They also do different things (tick vs.
    // open), which is exactly what two elements are for.
    <View style={styles.resultRow}>
      <View style={styles.statusIcon}>
        <TaskCheckbox task={task} taskLabel={displayTitle} onTicked={onTicked} />
      </View>

      <TouchableOpacity
        style={styles.resultContent}
        onPress={onPress}
        activeOpacity={interaction.activeOpacity}
        // The content column only hugs its own text, so this puts the row's
        // vertical padding and its trailing inset back into the tap target.
        // Nothing on the left: that side is the checkbox's, which claims out to
        // the card edge.
        hitSlop={{ top: 12, bottom: 12, right: spacing.md }}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint="Double tap to open task"
      >
        <HighlightedText
          text={displayTitle}
          ranges={titleRanges}
          style={[styles.resultTitle, isCompleted && styles.resultTitleDone]}
          highlightStyle={styles.highlight}
          numberOfLines={2}
        />

        <View style={styles.resultMeta}>
          {task.archived && (
            <Text style={styles.archivedLabel}>Archived</Text>
          )}
          {/* Ahead of the tags and dates, and highlighted like the title: a
              result can match on its project's name alone (fuzzySearch scores
              it), and until now that row gave no hint why it was in the list. */}
          {projectName && (
            <View style={styles.projectChip}>
              <Ionicons name="briefcase-outline" size={iconSize.xs} color={colors.textSecondary} />
              <HighlightedText
                text={projectName}
                ranges={projectMatches}
                style={styles.metaText}
                highlightStyle={styles.highlight}
                numberOfLines={1}
              />
            </View>
          )}
          {/* Plain text with its emoji rather than a chip of its own: the
              project-chip-then-category pairing NewTasksBanner already uses.
              A title can be too generic to place on its own ("Follow up"),
              and a task with no project has only this to say where it lives. */}
          {category !== '' && (
            <Text style={styles.metaText} numberOfLines={1}>{category}</Text>
          )}
          {task.tags.slice(0, 3).map(tag => (
            <View key={tag} style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
          ))}
          {task.tags.length > 0 && (
            <Text style={styles.metaText}>{task.tags.slice(0, 2).join(', ')}</Text>
          )}
          {isCompleted && completedDate && (
            <Text style={styles.completedLabel}>Done {completedDate}</Text>
          )}
          {/* What the task was completed with, for a decision task (see
              Task.deliverableKind). Search is how anyone finds a task they
              finished months ago, so without this the row you came for is
              found and still doesn't tell you what you decided. Same pill the
              Logbook entry uses, including the "No answer" fallback and the
              lack of a "?" in an answered one (#1735: it read as the decision
              still being open) — gated on isCompleted, since an *outstanding*
              decision task hasn't failed to answer anything, it just hasn't
              run yet. */}
          {isCompleted && asksOnCompletion(task) && (
            answer !== null ? (
              <View style={styles.answerPill}>
                <Text style={styles.answerText} numberOfLines={1}>{answer}</Text>
              </View>
            ) : (
              <Text style={styles.metaText}>No answer</Text>
            )
          )}
          {!isCompleted && task.dueDate && (
            <Text style={styles.metaText}>Due {format(new Date(task.dueDate), 'MMM d')}</Text>
          )}
          {/* Last of the chips and first of the wrapping ones: it's the least
              specific fact on the row, but it's the one that explains why the
              other twenty occurrences aren't here. */}
          {countLabel && (
            <View style={styles.countPill}>
              <Text style={styles.countText}>{countLabel}</Text>
            </View>
          )}
          {task.notes.length > 0 && (
            <Text style={styles.notesPreview} numberOfLines={1}>{task.notes}</Text>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}

function StackResultItem({ result, onPress, styles, colors }: {
  result: GroupSearchResult;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { group, titleMatches, memberTitles, memberCount } = result;
  const memberLabel = memberCount === 0
    ? 'No tasks yet'
    : `${memberCount} ${memberCount === 1 ? 'task' : 'tasks'}`;
  // The rest of the roster, past the three memberTitles already fetched —
  // never rendered as a hard count past that many, since fuzzySearch's own
  // preview is already capped there.
  const preview = memberTitles.length > 0
    ? memberTitles.join(', ') + (memberCount > memberTitles.length ? '…' : '')
    : null;

  const a11yLabel = [group.title, memberLabel, preview ? `including ${preview}` : null]
    .filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Double tap to open stack"
    >
      <View style={styles.statusIcon}>
        <View style={[styles.stackIcon, { backgroundColor: colors.accentSubtle }]}>
          <Ionicons name="layers-outline" size={iconSize.sm} color={colors.accent} />
        </View>
      </View>

      <View style={styles.resultContent}>
        <HighlightedText
          text={group.title}
          ranges={titleMatches}
          style={styles.resultTitle}
          highlightStyle={styles.highlight}
          numberOfLines={2}
        />

        <View style={styles.resultMeta}>
          <Text style={styles.metaText}>{memberLabel}</Text>
          {preview && (
            <Text style={styles.notesPreview} numberOfLines={1}>{preview}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function ProjectResultItem({ result, onPress, styles, colors }: {
  result: ProjectSearchResult;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { project, titleMatches, progress } = result;
  // Same sentence the Projects page's own row says, so a project found here
  // and the same project found there read alike.
  const progressLabel = progress.total === 0
    ? 'No tasks yet'
    : `${progress.done}/${progress.total} done`;
  const state = project.archived ? 'Archived' : project.completed ? 'Completed' : null;

  const a11yLabel = [project.title, progressLabel, state].filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Double tap to open project"
    >
      <View style={styles.statusIcon}>
        <View style={[styles.stackIcon, { backgroundColor: colors.accentSubtle }]}>
          <Ionicons name="briefcase-outline" size={iconSize.sm} color={colors.accent} />
        </View>
      </View>

      <View style={styles.resultContent}>
        <HighlightedText
          text={project.title}
          ranges={titleMatches}
          style={styles.resultTitle}
          highlightStyle={styles.highlight}
          numberOfLines={2}
        />

        <View style={styles.resultMeta}>
          <Text style={styles.metaText}>{progressLabel}</Text>
          {project.category !== null && (
            <Text style={styles.metaText} numberOfLines={1}>{project.category}</Text>
          )}
          {/* Why an archived or completed project is down here rather than at
              the top, said on the row instead of left to be inferred from the
              order. */}
          {state !== null && <Text style={styles.metaText}>{state}</Text>}
          {project.notes.length > 0 && (
            <Text style={styles.notesPreview} numberOfLines={1}>{project.notes}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function SearchScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const tabBarHeight = useBottomTabBarHeight();
  const tasks = useTaskStore(s => s.tasks);
  const projects = useProjectStore(s => s.projects);
  const groups = useTaskGroupStore(s => s.groups);
  const categories = useCategoryStore(s => s.categories);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [groupEditorVisible, setGroupEditorVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Handed a query by quick search (see QuickSearchModal's footer row).
  // `at` is stamped fresh on every handoff, so searching the same term twice
  // still lands — same trick as resetToToday in navigationRef.ts.
  //
  // Applied during render rather than from an effect because this screen
  // stays mounted in the tab navigator: an effect only runs after the frame
  // is committed, so the user would see one frame of the previous query
  // before it swapped.
  const [handledQueryAt, setHandledQueryAt] = useState<number | undefined>(undefined);
  if (route.params?.at !== undefined && route.params.at !== handledQueryAt) {
    setHandledQueryAt(route.params.at);
    setQuery(route.params.query ?? '');
  }

  // Retyping a query you just typed would make the handoff a net loss, so the
  // field arrives focused and ready to be refined.
  useEffect(() => {
    if (handledQueryAt === undefined) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [handledQueryAt]);

  // This screen stays mounted in the tab navigator, so a query left over from
  // the last visit would otherwise still be sitting there next time the tab
  // opens — same "reset on the way out" CalendarScreen uses for its expanded
  // row. Cleared on blur rather than on focus so a handoff from quick search
  // (the `at` effect above) never races this and gets its own query wiped.
  useFocusEffect(useCallback(() => () => setQuery(''), []));

  // KeyboardAvoidingView only checks the keyboard's real state once, in its
  // own componentDidMount — after that it trusts keyboardWillShow/
  // keyboardWillHide to stay correctly paired for as long as it's mounted.
  // This screen never unmounts (it's a persistent tab), and iOS can drop or
  // duplicate one of those notifications across a background/foreground
  // cycle, leaving its bottom padding stuck applied for a keyboard that
  // isn't actually up any more — which shoves the results/EmptyState area
  // up under the search bar, sometimes for a frame and sometimes for good,
  // since nothing else ever tells it to recheck. Remounting on resume
  // re-runs that mount-time check against the keyboard's real state.
  const [keyboardResyncKey, setKeyboardResyncKey] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') setKeyboardResyncKey(k => k + 1);
    });
    return () => sub.remove();
  }, []);

  const projectNamesById = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects]
  );

  // Same collapse StacksScreen uses for its own rows: the roster (one entry
  // per series, no completion tombstones), never the raw groupId-matching
  // rows — see groupRoster.
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

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  // Tasks ticked from these results, kept in the Active section so the tick
  // reads as one — the same hold Today's list keeps over a just-completed row
  // (completionHoldIds). Without it a task ticked near the top of a long list
  // jumps to a Completed section that may be several screens down, which looks
  // like the row vanished rather than like it got done. Dropped when the query
  // moves on: those are new results, and nothing is being held in them.
  const [heldIds, setHeldIds] = useState<ReadonlySet<string>>(new Set());
  const hold = useCallback(
    (taskId: string) => setHeldIds(prev => new Set(prev).add(taskId)),
    []
  );
  useEffect(() => setHeldIds(new Set()), [debouncedQuery]);

  // Collapsed the same way the quick-search card collapses, and for the same
  // reason: a daily task is one thing on many days, and reading its rows back
  // one per line buried the rest of the matches under thirty copies of it.
  // The Logbook's own search is deliberately left uncollapsed — history is
  // where every occurrence should be its own line.
  const results: CollapsedOccurrence<SearchResult>[] = useMemo(
    () => collapseOccurrences(
      fuzzySearch(tasks, debouncedQuery, projectNamesById, heldIds),
      tasks,
      heldIds
    ),
    [tasks, debouncedQuery, projectNamesById, heldIds]
  );

  const groupResults: GroupSearchResult[] = useMemo(
    () => searchGroups(groups, debouncedQuery, rosterByGroupId),
    [groups, debouncedQuery, rosterByGroupId]
  );

  // Only computed for the projects that actually matched, rather than for the
  // whole board on every keystroke: projectProgress filters the entire task
  // list and walks a previousOccurrenceId chain per member, and a search runs
  // on every debounced change.
  const projectResults: ProjectSearchResult[] = useMemo(() => {
    const matched = searchProjects(projects, debouncedQuery, new Map());
    const progress = new Map(matched.map(r => [r.project.id, projectProgress(r.project.id, tasks)]));
    return matched.map(r => ({ ...r, progress: progress.get(r.project.id)! }));
  }, [projects, debouncedQuery, tasks]);

  const isActive = (r: SearchResult) => !r.task.completed || heldIds.has(r.task.id);
  const activeResults = results.filter(isActive);
  const completedResults = results.filter(r => !isActive(r));

  type ListItem =
    | { type: 'sectionHeader'; label: string }
    | { type: 'result'; result: CollapsedOccurrence<SearchResult> }
    | { type: 'groupResult'; result: GroupSearchResult }
    | { type: 'projectResult'; result: ProjectSearchResult };

  const listData: ListItem[] = useMemo(() => {
    if (results.length === 0 && groupResults.length === 0 && projectResults.length === 0) return [];
    const items: ListItem[] = [];
    // Stacks lead: a title match on a stack is almost always a navigational
    // lookup ("where's my packing list"), so it surfaces before the task
    // results rather than being buried under Active/Completed.
    if (groupResults.length > 0) {
      items.push({ type: 'sectionHeader', label: 'Stacks' });
      groupResults.forEach(r => items.push({ type: 'groupResult', result: r }));
    }
    // Same argument as the stacks above, one container out: a title match on a
    // project is a navigational lookup ("where did I put the kitchen stuff"),
    // and its own tasks are almost certainly in the Active section below.
    if (projectResults.length > 0) {
      items.push({ type: 'sectionHeader', label: 'Projects' });
      projectResults.forEach(r => items.push({ type: 'projectResult', result: r }));
    }
    if (activeResults.length > 0) {
      items.push({ type: 'sectionHeader', label: 'Active' });
      activeResults.forEach(r => items.push({ type: 'result', result: r }));
    }
    if (completedResults.length > 0) {
      items.push({ type: 'sectionHeader', label: 'Completed' });
      completedResults.forEach(r => items.push({ type: 'result', result: r }));
    }
    return items;
    // heldIds too: it's what decides which section a completed row sits in.
  }, [results, groupResults, projectResults, heldIds]);

  const openTask = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const openGroup = (group: TaskGroup) => {
    setEditingGroup(group);
    setGroupEditorVisible(true);
  };

  const handleQuickAddOpenFull = (draft: TaskDraft) => {
    setQuickAddVisible(false);
    setEditingTask(null);
    setEditorInitialDraft(draft);
    setEditorVisible(true);
  };

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'sectionHeader') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{item.label}</Text>
        </View>
      );
    }
    if (item.type === 'groupResult') {
      return (
        <StackResultItem
          result={item.result}
          onPress={() => openGroup(item.result.group)}
          styles={styles}
          colors={colors}
        />
      );
    }
    if (item.type === 'projectResult') {
      return (
        <ProjectResultItem
          result={item.result}
          onPress={() => (navigation as any).navigate('ProjectDetail', { projectId: item.result.project.id })}
          styles={styles}
          colors={colors}
        />
      );
    }
    return (
      <SearchResultItem
        result={item.result}
        onPress={() => openTask(item.result.task)}
        onTicked={hold}
        categories={categories}
        styles={styles}
        colors={colors}
      />
    );
  };

  const showEmpty = query.trim().length > 0 && results.length === 0
    && groupResults.length === 0 && projectResults.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Search" />

      <SearchField
        ref={inputRef}
        style={styles.searchBar}
        placeholder="Search tasks"
        value={query}
        onChangeText={setQuery}
      />

      {/* EmptyState centers its "Create task" button vertically in whatever
          height it's given — on iOS that height doesn't shrink for the
          keyboard on its own, so with the search field still focused (the
          common case: you typed a query, got no results) the button centered
          on the full screen height landed underneath the keyboard, out of
          reach. KeyboardAvoidingView pads the bottom by the keyboard's
          height, so EmptyState re-centers above it instead. */}
      <KeyboardAvoidingView
        key={keyboardResyncKey}
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {showEmpty ? (
          <EmptyState
            key="no-results"
            icon="search-outline"
            title="No results"
            subtitle={`Nothing matches "${query}"`}
            actionLabel="New task"
            onAction={() => setQuickAddVisible(true)}
            bottomOffset={tabBarHeight}
          />
        ) : query.trim().length === 0 ? (
          <EmptyState key="prompt" icon="search-outline" title="Find any task" subtitle="Search active tasks, completed tasks, stacks and projects" bottomOffset={tabBarHeight} />
        ) : (
          <FlatList
            data={listData}
            keyExtractor={(item, i) => {
              if (item.type === 'sectionHeader') return `h-${item.label}`;
              if (item.type === 'groupResult') return `g-${item.result.group.id}`;
              if (item.type === 'projectResult') return `p-${item.result.project.id}`;
              return item.result.task.id;
            }}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          />
        )}
      </KeyboardAvoidingView>

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        initialDraft={editorInitialDraft}
        onClose={() => { setEditorVisible(false); setEditorInitialDraft(null); }}
      />

      <TaskGroupEditor
        visible={groupEditorVisible}
        group={editingGroup}
        onClose={() => { setGroupEditorVisible(false); setEditingGroup(null); }}
      />

      <QuickAddModal
        visible={quickAddVisible}
        onClose={() => setQuickAddVisible(false)}
        onOpenFull={handleQuickAddOpenFull}
        initialTitle={query}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  keyboardAvoiding: { flex: 1 },

  searchBar: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },

  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionHeaderText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Same inset-grouped card footprint as TaskItem rows.
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingRight: spacing.md,
    gap: spacing.sm,
  },
  statusIcon: {
    marginLeft: spacing.md,
    paddingTop: 1,
  },
  // Same slot the checkbox sits in, for a stack result's icon badge.
  stackIcon: {
    width: TASK_CHECKBOX_SIZE,
    height: TASK_CHECKBOX_SIZE,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultContent: { flex: 1, gap: 3 },
  resultTitle: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: 21,
  },
  resultTitleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  highlight: {
    color: colors.accent,
    fontWeight: '700',
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  // Same icon + label pairing TaskItem's meta chips use, at this row's own
  // meta colour. flexShrink so a long project name gives way to the tags and
  // dates rather than wrapping the row on its own.
  projectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  metaText: { color: colors.textSecondary, fontSize: font.xs },
  // The same tinted pill the Logbook entry wears, so a decision looks like one
  // wherever it's read back. The "?" needs the enclosure: loose in a meta row
  // it reads as uncertainty about the value beside it rather than as a label
  // on it.
  answerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    flexShrink: 1,
  },
  answerText: { color: colors.accent, fontSize: font.xs, fontWeight: fontWeight.medium, flexShrink: 1 },
  completedLabel: { color: colors.green, fontSize: font.xs },
  // The neutral twin of answerPill, and the same shape the quick-search card's
  // count wears. Enclosed rather than loose: "4 more dates" sitting next to
  // "Due Aug 26" otherwise reads as a qualifier on that date.
  countPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: colors.bgSunken,
  },
  countText: { color: colors.textSecondary, fontSize: font.xs },
  archivedLabel: { color: colors.orange, fontSize: font.xs, fontWeight: fontWeight.semibold },
  notesPreview: {
    color: colors.textTertiary,
    fontSize: font.xs,
    flex: 1,
  },
});
