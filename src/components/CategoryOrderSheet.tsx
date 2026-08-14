import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, type Colors } from '../theme';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { alphabeticalCategories, sortCategoriesByTaskCount } from '../utils/categoryOrder';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyState } from './EmptyState';
import { SortableList } from './SortableList';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface Row {
  id: string; // the category name
}

/**
 * The order Today's category sections come in, reachable from the screen's "…"
 * menu.
 *
 * This replaces long-pressing a section header and dragging it up the task
 * list. That gesture is gone for good and stays gone *there*: see CLAUDE.md's
 * "Today's category headers are not draggable" note — the floating drag card
 * never lined up with the finger, because the header it was dragging was one
 * row of a list whose other rows were collapsing out from under the
 * measurement to make room, scattered down a list of tasks.
 *
 * This sheet doesn't have that problem. It's a plain one-row-per-category list
 * with nothing else on screen, so every row is already visible and there's
 * nothing to auto-collapse or calibrate against — the exact conditions
 * `SortableList` (a stack's children, subtasks, chain steps) already handles.
 * Its rows sit inside this sheet's own `ScrollView`, so per `SortableList`'s
 * `onDragStateChange` doc, that scroll view's `scrollEnabled` is switched off
 * for the duration of a drag — otherwise the scroll gesture wins on the first
 * finger move and the row never lifts.
 *
 * Every drop writes straight through to reorderCategories, so there's nothing
 * to save and a swipe-down keeps the order rather than discarding it. `order`
 * is still held locally, seeded on each open: it's what the rows render from,
 * so a drop moves its row in the same commit as the release instead of waiting
 * for the store round-trip.
 */
export function CategoryOrderSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const tasksByCategory = useTaskStore(s => s.tasksByCategory);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const reorderCategories = useCategoryStore(s => s.reorderCategories);

  const [order, setOrder] = useState<string[]>(allCategories);
  // Set while a row is being dragged, purely to take this sheet's own
  // ScrollView out of the running for the touch (see SortableList's
  // onDragStateChange) — without it the scroll eats the gesture and the row
  // never moves.
  const [dragging, setDragging] = useState(false);

  // Seeded on open rather than kept in sync with the store: while the sheet is
  // up, this component is the only thing writing the order, and re-seeding on
  // every store change would fight the local commit above.
  useEffect(() => {
    if (visible) setOrder(allCategories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const commit = (next: string[]) => {
    setOrder(next);
    reorderCategories(next);
  };

  const rows: Row[] = order.map(name => ({ id: name }));

  const handleReorder = (next: Row[]) => {
    commit(next.map(r => r.id));
  };

  const sortAlphabetically = () => {
    haptics.success();
    commit(alphabeticalCategories(order));
  };

  const sortByTaskCount = () => {
    haptics.success();
    commit(sortCategoriesByTaskCount(order, name => tasksByCategory(name).length));
  };

  const emojiFor = (name: string) => categories.find(c => c.name === name)?.emoji ?? null;

  // fullScreen, not a page sheet: the sheet's own pull-down pan cancels the JS
  // touches this list's drag runs on. See EditorSheet's note (#1182).
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Category order</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

        {order.length === 0 ? (
          <EmptyState
            icon="folder-open-outline"
            title="No categories yet"
            subtitle="Give a task a category and its section will show up here, ready to be moved."
          />
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            scrollEnabled={!dragging}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.introWrap}>
              <Text style={styles.intro}>
                Today’s sections follow this order. A category with nothing on it today is
                skipped, but keeps its place here.
              </Text>
              <View style={styles.introActions}>
                <InlineAction
                  label="Sort A–Z"
                  icon="swap-vertical"
                  variant="neutral"
                  onPress={sortAlphabetically}
                  accessibilityLabel="Sort categories alphabetically"
                  style={styles.sortButton}
                />
                <InlineAction
                  label="Sort by task count"
                  icon="list"
                  variant="neutral"
                  onPress={sortByTaskCount}
                  accessibilityLabel="Sort categories by task count, most tasks first"
                  style={styles.sortButton}
                />
              </View>
            </View>

            <SortableList<Row>
              data={rows}
              onReorder={handleReorder}
              onDragStateChange={setDragging}
              renderItem={(row, _index, drag) => {
                const name = row.id;
                const count = tasksByCategory(name).length;
                const emoji = emojiFor(name);
                return (
                  <View style={styles.row}>
                    <View style={[styles.rowIcon, { backgroundColor: colors.accentSubtle }]}>
                      {emoji ? (
                        <Text style={styles.rowIconEmoji}>{emoji}</Text>
                      ) : (
                        <Ionicons name="folder" size={16} color={colors.accent} />
                      )}
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowLabel} numberOfLines={1}>{name}</Text>
                      <Text style={styles.rowCount}>
                        {count} {count === 1 ? 'task' : 'tasks'}
                      </Text>
                    </View>
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
          </ScrollView>
        )}
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
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerSpacer: { width: 64 },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  introWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  intro: { color: colors.textTertiary, fontSize: font.sm },
  introActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  // Sits directly on the sheet's root colors.bg, where the default neutral
  // tint (bgTertiary) is nearly indistinguishable from it.
  sortButton: { backgroundColor: colors.bgSecondary },
  list: { paddingTop: spacing.md, paddingBottom: spacing.xl },
  // Same inset-grouped card footprint as the Categories screen's rows.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconEmoji: { fontSize: 16 },
  rowInfo: { flex: 1, gap: 2 },
  rowLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rowCount: { color: colors.textTertiary, fontSize: font.xs },
  dragHandle: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
