import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { DetailHeader } from '../components/DetailHeader';
import { ReorderableList } from '../components/ReorderableList';
import { EmptyState } from '../components/EmptyState';
import { SavedViewEditorSheet } from '../components/SavedViewEditorSheet';
import { useSavedViewStore } from '../store/useSavedViewStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { getCurrentDayStart } from '../utils/dateUtils';
import { isHeldBack } from '../utils/visibilityUtils';
import { describeSavedView, filterTasksForView } from '../utils/savedViews';
import type { SavedView } from '../types';

/**
 * The saved views someone has kept (#2679), one row each.
 *
 * A pushed RootStack card rather than a menu destination: the menu is twelve
 * rows because that is what fits on a phone, and this did not earn a
 * thirteenth. It is opened from Today's filter sheet, where filtering already
 * happens, and by name from the drawer's find field (see
 * NAV_EXTRA_DESTINATIONS). Tapping a row pushes `SavedViewDetail`, the same
 * shape Categories has with CategoryDetail.
 *
 * Each row counts its own matches, which is the one thing here that is not
 * free: every row runs the whole predicate over every task. That is fine at
 * the scale a hand-built list of views reaches (a handful of views over a few
 * thousand tasks, once per render of this screen) and it is what makes the
 * list worth looking at — a view whose count is zero is the one you want to
 * see before you tap it.
 */
export function SavedViewsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const views = useSavedViewStore(useShallow(s => s.views));
  const allTasks = useTaskStore(s => s.tasks);
  const projects = useProjectStore(useShallow(s => s.projects));

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingView, setEditingView] = useState<SavedView | null>(null);

  const projectNames = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects],
  );

  const counts = useMemo(() => {
    const ctx = { todayStart: getCurrentDayStart(), heldBack: isHeldBack };
    const map = new Map<string, number>();
    for (const view of views) {
      map.set(view.id, filterTasksForView(allTasks, view.clauses, ctx).length);
    }
    return map;
  }, [views, allTasks]);

  const openView = useCallback((viewId: string) => {
    navigation.navigate({ name: 'SavedViewDetail', params: { viewId } } as never);
  }, [navigation]);

  const reorderViews = useSavedViewStore(s => s.reorderViews);
  const handleReorder = useCallback((next: SavedView[]) => {
    reorderViews(next.map(v => v.id));
  }, [reorderViews]);

  const handleCreate = () => {
    setEditingView(null);
    setEditorVisible(true);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <DetailHeader
        title="Saved views"
        onBack={() => navigation.goBack()}
        actions={
          <TouchableOpacity
            onPress={handleCreate}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="New saved view"
          >
            <Ionicons name="add" size={24} color={colors.accent} />
          </TouchableOpacity>
        }
      />

      <ReorderableList
        data={views}
        keyExtractor={v => v.id}
        onReorder={handleReorder}
        contentContainerStyle={[styles.listContent, views.length === 0 && styles.emptyContent]}
        renderItem={({ item, drag, isActive }) => {
          const count = counts.get(item.id) ?? 0;
          return (
            <TouchableOpacity
              // Opaque while dragging rather than a translucent tint: the drag
              // overlay paints no background of its own, so a see-through row
              // shows whatever is behind it for the length of the animation.
              style={[styles.row, isActive && styles.rowActive]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => openView(item.id)}
              onLongPress={drag}
              delayLongPress={interaction.delayLongPress}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${count} ${count === 1 ? 'task' : 'tasks'}. Hold to reorder.`}
            >
              <View style={[styles.rowIcon, { backgroundColor: colors.accentSubtle }]}>
                <Ionicons name={item.icon as never} size={18} color={colors.accent} />
              </View>
              {/* The name gets its own full-width line above the meta row: a
                  name sharing a row with a count and a chevron is the shape
                  that truncates the one piece of information the row is for. */}
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.rowSubtitle} numberOfLines={2}>
                  {describeSavedView(item.clauses, { projectNames })}
                </Text>
              </View>
              <Text style={styles.rowCount}>{count}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="bookmark-outline"
            title="No saved views"
            subtitle="A view is a filter you keep. Save one for the tasks you look for often, like everything tagged errand that has slipped."
            actionLabel="New view"
            onAction={handleCreate}
          />
        }
      />

      <SavedViewEditorSheet
        visible={editorVisible}
        view={editingView}
        onClose={() => setEditorVisible(false)}
        onCreated={openView}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.md, gap: spacing.sm },
  emptyContent: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.hairline,
    borderColor: colors.separator,
    padding: spacing.md,
  },
  rowActive: {
    backgroundColor: colors.bgTertiary,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  rowSubtitle: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  rowCount: {
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    minWidth: 20,
    textAlign: 'right',
  },
});
