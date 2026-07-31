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
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { TaskEditor } from '../components/TaskEditor';
import type { Task } from '../types';
import type { SearchResult } from '../utils/fuzzySearch';
import { fuzzySearch } from '../utils/fuzzySearch';
import { tagColor } from '../utils/tagColor';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { HighlightedText } from '../components/HighlightedText';
import { format } from 'date-fns';

function SearchResultItem({ result, onPress, styles, colors }: {
  result: SearchResult;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { task, titleMatches } = result;
  const isCompleted = task.completed;

  const completedDate = task.completedAt
    ? format(new Date(task.completedAt), 'MMM d')
    : null;

  const a11yLabel = [
    task.title,
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
        styles={styles}
        colors={colors}
      />
    );
  };

  const showEmpty = query.trim().length > 0 && results.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Search" />

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
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {showEmpty ? (
        <EmptyState icon="search-outline" title="No results" subtitle={`No todos match "${query}"`} />
      ) : query.trim().length === 0 ? (
        <EmptyState icon="search-outline" title="Find any todo" subtitle="Search active and completed todos" />
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
    lineHeight: 20,
    height: 20,
    padding: 0,
    textAlignVertical: 'center',
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
});
