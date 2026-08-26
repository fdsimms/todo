import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  Keyboard,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import { SheetScrim } from './SheetScrim';
import { EmptyState } from './EmptyState';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useProjectStore } from '../store/useProjectStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { fuzzySearch } from '../utils/fuzzySearch';
import { canBeBlockedBy, canBeBlockerOf, resolverFor, sortByBlockerAffinity, type BlockerContext } from '../utils/blocking';
import { displayTitleFor } from '../utils/visibilityUtils';
import { categoryLabel } from '../utils/categoryLabel';
import type { Task } from '../types';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

/**
 * Which end of the relationship is being filled in: the task being edited is
 * either the one waiting, or the one everything else is waiting on.
 */
export type TaskRelation = 'waitingOn' | 'blocks';

interface Props {
  visible: boolean;
  onClose: () => void;
  relation: TaskRelation;
  /** The task being edited — excluded from the list, along with anything that would loop back to it. */
  taskId: string | null;
  /**
   * Where the task being edited sits, from the editor's unsaved draft.
   * Candidates sharing its stack, then project, then category are floated to
   * the top.
   */
  context?: BlockerContext;
  /**
   * Anything the open editor has already spoken for — the tasks it's staged as
   * blocked, and the blocker it's staged as waiting on. Both are draft state
   * the store can't see yet, and each would be a one-hop loop from the other
   * side, so they're kept out of the list here rather than caught on save.
   */
  excludeIds?: string[];
  onSelect: (taskId: string) => void;
}

/** Enough to scan, few enough to render without virtualizing. Search reaches the rest. */
const MAX_ROWS = 40;

/** Kept clear above the lifted sheet so its title never slides under the status bar. */
const TOP_INSET = 72;

/**
 * The words for each end. One table rather than a ternary per string, so the
 * two directions read side by side and neither can quietly lose a line.
 */
const COPY: Record<TaskRelation, {
  title: string;
  hint: string;
  emptyTitle: string;
  emptySub: string;
  action: (title: string) => string;
}> = {
  waitingOn: {
    title: 'Waiting on',
    hint: 'This task stays out of your lists until the one you pick is done.',
    emptyTitle: 'Nothing to wait on',
    emptySub: 'Tasks that would end up waiting on each other are left out.',
    action: title => `Wait on ${title}`,
  },
  blocks: {
    title: 'Blocks',
    hint: 'The task you pick stays out of your lists until this one is done.',
    emptyTitle: 'Nothing to block',
    // Says why the list is short rather than leaving it a mystery: a task
    // waits on one thing at a time, so anything already waiting on another
    // task is set from that task's own editor instead.
    emptySub: 'A task can wait on only one thing, so tasks already waiting on something else are left out.',
    action: title => `Block ${title}`,
  },
};

/**
 * Picks the other end of a blocking relationship (see Task.blockedById) —
 * either the task this one waits on, or a task this one holds back.
 *
 * One sheet for both directions because the pointer is one field: only the
 * eligibility rule and the words change, and a second copy of the list,
 * ranking, search and keyboard handling is how the two ends would come to
 * disagree about which tasks can be picked.
 *
 * The list is filtered by the cycle check, not just by id: a loop makes every
 * task in it permanently invisible, since each is waiting on something that
 * can never complete. Filtering here is what stops one being made in the first
 * place — and it's why neither end can be offered as a free-text field.
 */
export function TaskRelationPickerSheet({ visible, onClose, relation, taskId, context, excludeIds, onSelect }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();

  const tasks = useTaskStore(useShallow(s => s.tasks));
  const groups = useTaskGroupStore(useShallow(s => s.groups));
  const projects = useProjectStore(useShallow(s => s.projects));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const [query, setQuery] = useState('');

  const ctx: BlockerContext = context ?? {};
  const copy = COPY[relation];

  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  const candidates = useMemo(() => {
    const resolve = resolverFor(tasks);
    const eligible = tasks.filter(t =>
      !excluded.has(t.id) &&
      (relation === 'waitingOn'
        ? canBeBlockerOf(t, taskId, resolve)
        : canBeBlockedBy(t, taskId, resolve))
    );
    // Rank before truncating, so a neighbour buried deep in the list still
    // reaches the visible rows.
    if (!query.trim()) {
      return sortByBlockerAffinity(eligible, ctx).slice(0, MAX_ROWS);
    }
    const ids = new Set(eligible.map(t => t.id));
    const matches = fuzzySearch(eligible, query)
      .filter(r => ids.has(r.task.id))
      .map(r => r.task);
    return sortByBlockerAffinity(matches, ctx).slice(0, MAX_ROWS);
  }, [tasks, taskId, relation, excluded, query, ctx.groupId, ctx.projectId, ctx.category]);

  /**
   * The one-line "where this lives" under a candidate's title — the category
   * (with its emoji, if it has one) plus whatever stack or project the task
   * belongs to. Several rows can share a title ("Book flights"), so both are
   * shown together rather than one eclipsing the other, for the same reason
   * the ordering already floats a task's stack/project neighbours to the top.
   */
  const subtitleFor = (task: Task): string | null => {
    const parts: string[] = [];
    const catLabel = categoryLabel(task.category, categories);
    if (catLabel) parts.push(catLabel);
    const group = task.groupId ? groups.find(g => g.id === task.groupId) : undefined;
    if (group) {
      parts.push(group.title);
    } else {
      const project = task.projectId ? projects.find(p => p.id === task.projectId) : undefined;
      if (project) parts.push(project.title);
    }
    return parts.length ? parts.join(' · ') : null;
  };

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  /**
   * The sheet is bottom-anchored, so with a short list the whole thing — rows
   * and Cancel both — sits behind the keyboard the search field just raised.
   * Lifting it clear needs the height cap below as well as this offset: the
   * lift alone would push a full list's title off the top of the screen.
   */
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      setKeyboardHeight(height);
      Animated.spring(keyboardOffset, {
        toValue: -height, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      Animated.spring(keyboardOffset, {
        toValue: 0, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (visible) {
      setQuery('');
      translateY.setValue(hiddenY);
      backdropOpacity.setValue(0);
      keyboardOffset.setValue(0);
      setKeyboardHeight(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          ...animation.spring.smooth,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const dismiss = (after?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: hiddenY,
        ...animation.spring.sheetDismiss,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
      after?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            ...animation.spring.snappy,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleSelect = (task: Task) => {
    haptics.tap();
    dismiss(() => onSelect(task.id));
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={() => dismiss()} />

      <Animated.View
        style={[
          styles.sheetOuter,
          // Capped against what's left above the keyboard; the card and its list
          // both shrink, so no chrome constant has to be kept in sync with the
          // header's real height.
          { maxHeight: windowHeight - keyboardHeight - TOP_INSET },
          { transform: [{ translateY: Animated.add(translateY, keyboardOffset) }] },
        ]}
      >
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sheetTitle}>{copy.title}</Text>
          <Text style={styles.sheetHint}>{copy.hint}</Text>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={15} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search tasks"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>

          {candidates.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="hourglass-outline"
                title={query.trim() ? 'No matches' : copy.emptyTitle}
                subtitle={query.trim() ? 'No open task matches that.' : copy.emptySub}
              />
            </View>
          ) : (
            <ScrollView style={styles.list} bounces={false} keyboardShouldPersistTaps="handled">
              {candidates.map((task, idx) => (
                <React.Fragment key={task.id}>
                  {idx > 0 && <View style={styles.inlineSep} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => handleSelect(task)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={copy.action(displayTitleFor(task))}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: colors.accent + '22' }]}>
                      <Ionicons name="checkbox-outline" size={16} color={colors.accent} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName} numberOfLines={1}>{displayTitleFor(task)}</Text>
                      {!!subtitleFor(task) && <Text style={styles.rowHint} numberOfLines={1}>{subtitleFor(task)}</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </ScrollView>
          )}
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // EmptyState brings its own centring, icon circle and type — this only has
  // to keep it off the sheet's edges.
  emptyWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  backdropDim: {
    backgroundColor: colors.backdrop,
  },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    flexShrink: 1,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  sheetHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingTop: 2,
    paddingBottom: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 8,
  },
  list: {
    maxHeight: 320,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: font.md, fontWeight: '500' },
  rowHint: { color: colors.textTertiary, fontSize: font.xs },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 32 + spacing.md,
  },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
