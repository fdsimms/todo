import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { moveCategory, alphabeticalCategories } from '../utils/categoryOrder';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyState } from './EmptyState';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The order Today's category sections come in, reachable from the screen's "…"
 * menu.
 *
 * This replaces long-pressing a section header and dragging it up the task
 * list. That gesture is gone for good: the floating drag card never lined up
 * with the finger holding it, and the header it was dragging was one row of a
 * list whose other rows were collapsing out from under the measurement to make
 * room. Moving a category a step at a time needs no measurement at all, and it
 * shows the whole order at once — which the drag never could, since the
 * headers it reordered were scattered down a list of tasks.
 *
 * Every tap writes straight through to reorderCategories, so there's nothing to
 * save and a swipe-down keeps the order rather than discarding it. `order` is
 * still held locally, seeded on each open: it's what the rows render from, so
 * an arrow moves its row in the same commit as the tap instead of waiting for
 * the store round-trip.
 */
export function CategoryOrderSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const tasksByCategory = useTaskStore(s => s.tasksByCategory);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const reorderCategories = useCategoryStore(s => s.reorderCategories);

  const [order, setOrder] = useState<string[]>(allCategories);

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

  const move = (name: string, delta: number) => {
    const next = moveCategory(order, name, delta);
    // moveCategory hands back the same array when the move can't happen (a
    // category already at the end it's being pushed towards), so an edge tap
    // stays silent instead of buzzing and rewriting the same order.
    if (next === order) return;
    haptics.tap();
    commit(next);
  };

  const sortAlphabetically = () => {
    haptics.success();
    commit(alphabeticalCategories(order));
  };

  const emojiFor = (name: string) => categories.find(c => c.name === name)?.emoji ?? null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
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
          <FlatList
            data={order}
            keyExtractor={name => name}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
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
                  />
                </View>
              </View>
            }
            renderItem={({ item: name, index }) => {
              const count = tasksByCategory(name).length;
              const emoji = emojiFor(name);
              const isFirst = index === 0;
              const isLast = index === order.length - 1;
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
                    style={[styles.moveButton, isFirst && styles.moveButtonDisabled]}
                    onPress={() => move(name, -1)}
                    disabled={isFirst}
                    activeOpacity={interaction.activeOpacity}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${name} up`}
                    accessibilityState={{ disabled: isFirst }}
                  >
                    <Ionicons name="arrow-up" size={iconSize.md} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.moveButton, isLast && styles.moveButtonDisabled]}
                    onPress={() => move(name, 1)}
                    disabled={isLast}
                    activeOpacity={interaction.activeOpacity}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${name} down`}
                    accessibilityState={{ disabled: isLast }}
                  >
                    <Ionicons name="arrow-down" size={iconSize.md} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              );
            }}
          />
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
  introActions: { flexDirection: 'row', marginTop: spacing.md },
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
  moveButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveButtonDisabled: { opacity: 0.35 },
});
