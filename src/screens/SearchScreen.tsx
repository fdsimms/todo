import React, { useState, useMemo, useRef } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../store/useTaskStore';
import { TaskEditor } from '../components/TaskEditor';
import type { Task } from '../types';
import type { SearchResult } from '../utils/fuzzySearch';
import { fuzzySearch } from '../utils/fuzzySearch';
import { tagColor } from '../utils/tagColor';
import { colors, spacing, font, radius } from '../theme';
import { format } from 'date-fns';

function HighlightedText({
  text,
  ranges,
  style,
  highlightStyle,
  numberOfLines,
}: {
  text: string;
  ranges: [number, number][];
  style?: object;
  highlightStyle?: object;
  numberOfLines?: number;
}) {
  if (ranges.length === 0) {
    return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  }

  // Merge and sort ranges
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const segments: { text: string; highlight: boolean }[] = [];
  let cursor = 0;

  for (const [start, end] of sorted) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlight: false });
    segments.push({ text: text.slice(start, end), highlight: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlight: false });

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((seg, i) =>
        seg.highlight
          ? <Text key={i} style={highlightStyle}>{seg.text}</Text>
          : <Text key={i}>{seg.text}</Text>
      )}
    </Text>
  );
}

function SearchResultItem({ result, onPress }: { result: SearchResult; onPress: () => void }) {
  const { task, titleMatches } = result;
  const isCompleted = task.completed;

  const completedDate = task.completedAt
    ? format(new Date(task.completedAt), 'MMM d')
    : null;

  return (
    <TouchableOpacity style={styles.resultRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.statusIcon}>
        {isCompleted
          ? <Ionicons name="checkmark-circle" size={22} color={colors.green} />
          : <View style={styles.circle} />
        }
      </View>

      <View style={styles.resultContent}>
        <HighlightedText
          text={task.title}
          ranges={titleMatches}
          style={[styles.resultTitle, isCompleted && styles.resultTitleDone]}
          highlightStyle={styles.highlight}
          numberOfLines={2}
        />

        <View style={styles.resultMeta}>
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
  const tasks = useTaskStore(s => s.tasks);

  const [query, setQuery] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const results: SearchResult[] = useMemo(
    () => fuzzySearch(tasks, query),
    [tasks, query]
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
      />
    );
  };

  const showEmpty = query.trim().length > 0 && results.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textTertiary} style={styles.searchIcon} />
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          placeholder="Search todos…"
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && Platform.OS !== 'ios' && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {showEmpty ? (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={48} color={colors.bgQuaternary} />
          <Text style={styles.emptyText}>No results</Text>
          <Text style={styles.emptySubtext}>No todos match "{query}"</Text>
        </View>
      ) : query.trim().length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={48} color={colors.bgQuaternary} />
          <Text style={styles.emptyText}>Find any todo</Text>
          <Text style={styles.emptySubtext}>Search active and completed todos</Text>
        </View>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    gap: spacing.xs,
  },
  searchIcon: { marginRight: 2 },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    padding: 0,
  },

  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionHeaderText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSecondary,
    paddingVertical: 12,
    paddingRight: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    gap: spacing.sm,
  },
  statusIcon: {
    marginLeft: spacing.md,
    paddingTop: 1,
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.bgQuaternary,
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
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  metaText: { color: colors.textSecondary, fontSize: font.xs },
  completedLabel: { color: colors.green, fontSize: font.xs },
  notesPreview: {
    color: colors.textTertiary,
    fontSize: font.xs,
    flex: 1,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: font.lg,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  emptySubtext: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
