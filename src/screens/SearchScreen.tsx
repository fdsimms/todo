import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { TaskEditor } from '../components/TaskEditor';
import type { Task } from '../types';
import type { SearchResult } from '../utils/fuzzySearch';
import { fuzzySearch } from '../utils/fuzzySearch';
import { displayTitleFor } from '../utils/visibilityUtils';
import { tagColor } from '../utils/tagColor';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, iconSize, interaction, checkboxRadius, type Colors } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
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

const CHECKBOX_SIZE = 20;

function SearchResultItem({ result, onPress, styles, colors }: {
  result: SearchResult;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { task, titleMatches, projectName, projectMatches } = result;
  const isCompleted = task.completed;

  const completedDate = task.completedAt
    ? format(new Date(task.completedAt), 'MMM d')
    : null;

  const displayTitle = displayTitleFor(task);

  const a11yLabel = [
    displayTitle,
    projectName ? `in ${projectName}` : null,
    task.archived ? 'archived' : null,
    isCompleted ? `completed${completedDate ? ` ${completedDate}` : ''}` : null,
    !isCompleted && task.dueDate ? `due ${format(new Date(task.dueDate), 'MMM d')}` : null,
  ].filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Double tap to open task"
    >
      <View style={styles.statusIcon}>
        <View style={[styles.checkbox, isCompleted && styles.checkboxDone]}>
          {isCompleted && <Ionicons name="checkmark" size={12} color={colors.onAccent} />}
        </View>
      </View>

      <View style={styles.resultContent}>
        <HighlightedText
          text={displayTitle}
          ranges={titleMatches}
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
          {task.tags.slice(0, 3).map(tag => (
            <View key={tag} style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
          ))}
          {task.tags.length > 0 && (
            <Text style={styles.metaText}>{task.tags.slice(0, 2).join(', ')}</Text>
          )}
          {isCompleted && completedDate && (
            <Text style={styles.completedLabel}>Done {completedDate}</Text>
          )}
          {!isCompleted && task.dueDate && (
            <Text style={styles.metaText}>Due {format(new Date(task.dueDate), 'MMM d')}</Text>
          )}
          {task.notes.length > 0 && (
            <Text style={styles.notesPreview} numberOfLines={1}>{task.notes}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function SearchScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const tabBarHeight = useBottomTabBarHeight();
  const tasks = useTaskStore(s => s.tasks);
  const projects = useProjectStore(s => s.projects);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
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

  const projectNamesById = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects]
  );

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const results: SearchResult[] = useMemo(
    () => fuzzySearch(tasks, debouncedQuery, projectNamesById),
    [tasks, debouncedQuery, projectNamesById]
  );

  const activeResults = results.filter(r => !r.task.completed);
  const completedResults = results.filter(r => r.task.completed);

  type ListItem =
    | { type: 'sectionHeader'; label: string }
    | { type: 'result'; result: SearchResult };

  const listData: ListItem[] = useMemo(() => {
    if (results.length === 0) return [];
    const items: ListItem[] = [];
    if (activeResults.length > 0) {
      items.push({ type: 'sectionHeader', label: 'Active' });
      activeResults.forEach(r => items.push({ type: 'result', result: r }));
    }
    if (completedResults.length > 0) {
      items.push({ type: 'sectionHeader', label: 'Completed' });
      completedResults.forEach(r => items.push({ type: 'result', result: r }));
    }
    return items;
  }, [results]);

  const openTask = (task: Task) => {
    setEditingTask(task);
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
    return (
      <SearchResultItem
        result={item.result}
        onPress={() => openTask(item.result.task)}
        styles={styles}
        colors={colors}
      />
    );
  };

  const showEmpty = query.trim().length > 0 && results.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Search" />

      <SearchField
        ref={inputRef}
        style={styles.searchBar}
        placeholder="Search todos…"
        value={query}
        onChangeText={setQuery}
      />

      {showEmpty ? (
        <EmptyState key="no-results" icon="search-outline" title="No results" subtitle={`No todos match "${query}"`} bottomOffset={tabBarHeight} />
      ) : query.trim().length === 0 ? (
        <EmptyState key="prompt" icon="search-outline" title="Find any todo" subtitle="Search active and completed todos" bottomOffset={tabBarHeight} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, i) =>
            item.type === 'sectionHeader' ? `h-${item.label}` : item.result.task.id
          }
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

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
    color: colors.textTertiary,
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
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: checkboxRadius(CHECKBOX_SIZE),
    borderCurve: 'continuous',
    borderWidth: border.md,
    borderColor: colors.bgQuaternary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: colors.green,
    borderColor: colors.green,
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
  completedLabel: { color: colors.green, fontSize: font.xs },
  archivedLabel: { color: colors.orange, fontSize: font.xs, fontWeight: fontWeight.semibold },
  notesPreview: {
    color: colors.textTertiary,
    fontSize: font.xs,
    flex: 1,
  },
});
