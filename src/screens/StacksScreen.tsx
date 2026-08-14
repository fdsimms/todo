import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Task, TaskGroup } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { TaskGroupEditor } from '../components/TaskGroupEditor';
import { Fab, FAB_SIZE } from '../components/Fab';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { groupRoster, isRelevantToGroupToday } from '../utils/visibilityUtils';
import { categoryLabel } from '../utils/categoryLabel';

/**
 * Every stack, whether or not it has work today.
 *
 * The stack rows on Today only render for stacks with something due
 * (see visibleGroupItems in TodayScreen), which is right for that screen and
 * leaves a stack whose members are all scheduled for next week — or one with
 * no members at all — with no way in. This is that way in: the peer of
 * Categories/Tags/Templates for the one organizing entity that didn't have a
 * list of its own.
 */
export function StacksScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const groups = useTaskGroupStore(s => s.groups);
  const createGroup = useTaskGroupStore(s => s.createGroup);
  const removeGroupRow = useTaskGroupStore(s => s.removeGroupRow);
  const allTasks = useTaskStore(s => s.tasks);
  const categories = useCategoryStore(useShallow(s => s.categories));

  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  // Set while the editor is showing a stack this screen just created, so an
  // abandoned one can be cleaned up on close — same as TodayScreen's add menu.
  const newStackIdRef = useRef<string | null>(null);

  // The roster, never the raw child rows: a recurring member leaves a
  // completed row behind on every completion and they all keep the stack's
  // groupId, so counting rows makes an 8-task stack climb without bound (see
  // groupRoster). Built once for every stack rather than per row, since each
  // pass is a scan of the full task list.
  const rostersByGroupId = useMemo(() => {
    const children = new Map<string, Task[]>();
    for (const t of allTasks) {
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
  }, [allTasks]);

  const openEditor = (group: TaskGroup) => {
    setEditingGroup(group);
    setEditorVisible(true);
  };

  const createStack = () => {
    animateLayout();
    const group = createGroup('', null);
    newStackIdRef.current = group.id;
    openEditor(group);
  };

  const closeEditor = () => {
    setEditorVisible(false);
    // An untitled brand-new stack is one the user backed out of — drop it
    // rather than leaving a nameless row here forever.
    if (newStackIdRef.current) {
      const id = newStackIdRef.current;
      newStackIdRef.current = null;
      const current = useTaskGroupStore.getState().getGroupById(id);
      if (current && current.title.trim() === '') removeGroupRow(id);
    }
    setEditingGroup(null);
  };

  const renderStack = ({ item: group }: { item: TaskGroup }) => {
    const roster = rostersByGroupId.get(group.id) ?? [];
    // Two different counts, kept labelled: the roster is membership, and
    // today's slice is the work. A member that isn't due today is still a
    // member, so a stack can honestly read "8 tasks · nothing due today".
    const dueToday = roster.filter(isRelevantToGroupToday).length;
    const memberLabel = roster.length === 0
      ? 'No tasks yet'
      : `${roster.length} ${roster.length === 1 ? 'task' : 'tasks'}`;
    const todayLabel = dueToday > 0 ? `${dueToday} due today` : 'Nothing due today';
    const catLabel = group.category ? categoryLabel(group.category, categories) : null;
    const spokenMeta = [memberLabel, todayLabel, catLabel].filter(Boolean).join('. ');

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => { haptics.tap(); openEditor(group); }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`${group.title}. ${spokenMeta}`}
        accessibilityHint="Double tap to edit this stack."
      >
        <View style={[styles.icon, { backgroundColor: colors.accentSubtle }]}>
          <Ionicons name="layers-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{group.title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{memberLabel}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{todayLabel}</Text>
            {catLabel && (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Text style={[styles.metaText, styles.metaCategory]} numberOfLines={1}>
                  {catLabel}
                </Text>
              </>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Stacks"
        subtitle={groups.length > 0
          ? `${groups.length} ${groups.length === 1 ? 'stack' : 'stacks'}`
          : undefined}
      />

      {groups.length === 0 ? (
        <EmptyState
          icon="layers-outline"
          title="No stacks yet"
          subtitle="A stack is a label several separately-scheduled tasks hang off (a morning routine, a trip to pack for) so they show up together on Today"
          actionLabel="New stack"
          onAction={createStack}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={g => g.id}
          renderItem={renderStack}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />}
        />
      )}

      <Fab
        onPress={createStack}
        accessibilityLabel="Add stack"
        bottom={insets.bottom + tabBarHeight + spacing.md}
      />

      <TaskGroupEditor
        visible={editorVisible}
        group={editingGroup}
        isNew={newStackIdRef.current !== null}
        onClose={closeEditor}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    paddingTop: spacing.sm,
  },
  // Same inset-grouped card footprint as TaskItem / the Categories rows.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  // Only the category can get long enough to need truncating.
  metaCategory: {
    flexShrink: 1,
  },
  metaDot: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
});
