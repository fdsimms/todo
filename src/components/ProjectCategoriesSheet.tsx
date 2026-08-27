import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Alert,
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, interaction, type Colors } from '../theme';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyState } from './EmptyState';
import { SortableList } from './SortableList';
import { confirmDelete } from '../utils/confirmDelete';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface Row {
  /** The category name, which is also its identity — see renameCategory. */
  id: string;
}

/**
 * Rename, delete, reorder and add the categories the Projects page groups by.
 *
 * The pool was append-only for as long as it existed: `useProjectCategoryStore`
 * had `initialize` and `addCategory` and nothing else. A name typed with a typo
 * was permanent, a section that emptied stayed in every picker for good, and
 * the `sort_order` column was written once at insert, so the sections sat in
 * permanent creation order however the board actually grew.
 *
 * One sheet for all four operations rather than a per-category editor, because
 * a project category is only a name and a position — `CategoryEditor` earns a
 * sheet of its own by also holding an emoji, a schedule, vacation and
 * suggestion flags and a default time of day, and a whole sheet for one text
 * field would be that shape without the reason for it. What this needs from
 * that editor is its two flows, and it reuses both: `confirmDelete` (so the
 * "ask before deleting" setting is honoured) and the taken-name alert.
 *
 * Reordering is `CategoryOrderSheet`'s design, for its reasons, and the two
 * inherit the same constraint: `fullScreen` rather than a page sheet, because a
 * page sheet's own pull-down pan cancels the JS touches a drag runs on (see
 * `EditorSheet`, #1182), and the enclosing `ScrollView` has to stand down for
 * the duration of a drag or it eats the gesture on the first finger move (see
 * `SortableList`'s `onDragStateChange`).
 *
 * Every edit writes straight through, so there is nothing to save and a
 * swipe-down keeps the changes rather than discarding them.
 */
export function ProjectCategoriesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const categories = useProjectCategoryStore(useShallow(s => s.categories));
  const addCategory = useProjectCategoryStore(s => s.addCategory);
  const renameCategory = useProjectCategoryStore(s => s.renameCategory);
  const reorderCategories = useProjectCategoryStore(s => s.reorderCategories);
  const deleteProjectCategory = useTaskStore(s => s.deleteProjectCategory);
  const projects = useProjectStore(useShallow(s => s.projects));

  // Local, seeded on open: it's what the rows render from, so a drop moves its
  // row in the same commit as the release rather than waiting for the store
  // round-trip. Same call CategoryOrderSheet makes.
  const [order, setOrder] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  // Which row is being renamed, and the text so far. Held by name rather than
  // index so a reorder underneath can't move the editing state onto a
  // different row.
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  // Guards the blur handler from running after submit already committed —
  // TextInput fires both, and the second one would re-read a name that has
  // just been renamed out from under it.
  const committedRef = useRef(false);

  const storeOrder = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder).map(c => c.name),
    [categories]
  );

  useEffect(() => {
    if (!visible) return;
    setOrder(storeOrder);
    setEditingName(null);
    setDraft('');
    setAddingNew(false);
    setNewName('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A rename, delete or add changes the *set*, not just the order, and the
  // local copy above would otherwise keep rendering the old names. Reordering
  // is excluded on purpose: it already wrote the local copy.
  useEffect(() => {
    if (!visible || dragging) return;
    setOrder(prev => (prev.length === storeOrder.length && prev.every((n, i) => n === storeOrder[i]) ? prev : storeOrder));
  }, [storeOrder, visible, dragging]);

  const countFor = (name: string) => projects.filter(p => p.category === name).length;

  const handleReorder = (next: Row[]) => {
    const names = next.map(r => r.id);
    setOrder(names);
    reorderCategories(names);
  };

  const startRename = (name: string) => {
    committedRef.current = false;
    setEditingName(name);
    setDraft(name);
  };

  const commitRename = (name: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    setEditingName(null);
    setDraft('');
    // Unchanged or emptied: the field closes and nothing is written. Blanking
    // a name is not a way to delete a category — the trash button is.
    if (!trimmed || trimmed === name) return;
    if (!renameCategory(name, trimmed)) {
      Alert.alert('That name is taken', `A project category named "${trimmed}" already exists.`);
      return;
    }
    haptics.tap();
  };

  const handleDelete = (name: string) => {
    const count = countFor(name);
    haptics.warning();
    confirmDelete({
      title: 'Delete project category',
      message: count > 0
        ? `Remove "${name}" from ${count} ${count === 1 ? 'project' : 'projects'}? They'll go back to being ungrouped, and keep all of their tasks. This can be undone with shake-to-undo.`
        : `Delete "${name}"? This can be undone with shake-to-undo.`,
      onConfirm: () => { animateLayout(); deleteProjectCategory(name); },
    });
  };

  const commitNew = () => {
    const trimmed = newName.trim();
    setNewName('');
    setAddingNew(false);
    if (!trimmed) return;
    animateLayout();
    addCategory(trimmed);
    haptics.tap();
  };

  const rows: Row[] = order.map(name => ({ id: name }));

  // fullScreen, not a page sheet: the sheet's own pull-down pan cancels the JS
  // touches this list's drag runs on. See EditorSheet's note (#1182).
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Project categories</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

        <ScrollView
          contentContainerStyle={styles.list}
          scrollEnabled={!dragging}
          keyboardShouldPersistTaps="handled"
        >
          {order.length === 0 ? (
            <EmptyState
              icon="folder-open-outline"
              title="No project categories yet"
              subtitle="Group projects under headings like Travel or Around the house. Add one below, then file a project into it from its editor."
            />
          ) : (
            <>
              <Text style={styles.intro}>
                The Projects page groups projects under these, in this order. A category with no
                projects in it is skipped there, but keeps its place here.
              </Text>

              <SortableList<Row>
                data={rows}
                onReorder={handleReorder}
                onDragStateChange={setDragging}
                renderItem={(row, _index, drag) => {
                  const name = row.id;
                  const count = countFor(name);
                  const editing = editingName === name;
                  return (
                    <View style={styles.row}>
                      <View style={[styles.rowIcon, { backgroundColor: colors.accentSubtle }]}>
                        <Ionicons name="folder" size={16} color={colors.accent} />
                      </View>
                      <View style={styles.rowInfo}>
                        {editing ? (
                          <TextInput
                            autoFocus
                            style={styles.rowInput}
                            value={draft}
                            onChangeText={setDraft}
                            onSubmitEditing={() => commitRename(name)}
                            onBlur={() => commitRename(name)}
                            placeholder="Category name"
                            placeholderTextColor={colors.textTertiary}
                            autoCapitalize="words"
                            returnKeyType="done"
                            accessibilityLabel={`Rename ${name}`}
                          />
                        ) : (
                          <TouchableOpacity
                            onPress={() => startRename(name)}
                            activeOpacity={interaction.activeOpacity}
                            accessibilityRole="button"
                            accessibilityLabel={`Rename ${name}`}
                          >
                            <Text style={styles.rowLabel} numberOfLines={1}>{name}</Text>
                          </TouchableOpacity>
                        )}
                        <Text style={styles.rowCount}>
                          {count} {count === 1 ? 'project' : 'projects'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleDelete(name)}
                        hitSlop={8}
                        style={styles.rowButton}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete category ${name}`}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.red} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onLongPress={drag}
                        delayLongPress={150}
                        hitSlop={8}
                        style={styles.dragHandle}
                        accessibilityRole="button"
                        accessibilityLabel={`Reorder ${name}`}
                      >
                        <Ionicons name="reorder-three" size={20} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
            </>
          )}

          <View style={styles.addRow}>
            {addingNew ? (
              <TextInput
                autoFocus
                style={styles.addInput}
                value={newName}
                onChangeText={setNewName}
                onSubmitEditing={commitNew}
                onBlur={commitNew}
                placeholder="e.g. Travel"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="done"
                accessibilityLabel="New project category name"
              />
            ) : (
              <InlineAction
                icon="add"
                label="New category"
                onPress={() => setAddingNew(true)}
                accessibilityLabel="New project category"
              />
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerSpacer: { width: 64 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  intro: {
    color: colors.textSecondary,
    fontSize: font.sm,
    // Both sides: the first row starts immediately below with no top margin of
    // its own (see CLAUDE.md on stacked blocks).
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginVertical: 2,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rowInput: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: 2,
    // A height rather than a lineHeight: RN maps lineHeight onto the iOS
    // paragraph style with no baseline offset, so the glyphs sit low in the
    // field while the caret stays centred. See CLAUDE.md.
    minHeight: 24,
  },
  rowCount: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  rowButton: { padding: 2 },
  dragHandle: { padding: 2 },
  addRow: { marginTop: spacing.md, flexDirection: 'row' },
  addInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: 4,
    minHeight: 32,
  },
});
