import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, type LayoutChangeEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { Task, TaskGroup } from '../types';
import { InlineAction } from './InlineAction';
import { InlineNameField } from './InlineNameField';
import { useDragToDay } from '../hooks/useDragToDay';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, checkboxRadius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { isHeldBack } from '../utils/visibilityUtils';
import type { ProjectListItem } from '../utils/projectStacks';
import { RotatingChevron } from './RotatingChevron';
import { animateLayout } from '../utils/layoutAnimation';
import {
  boardColumns, boardMove, columnIndexAt, insertIndexAt, LOOSE_COLUMN_KEY,
  type BoardColumn, type BoardMove,
} from '../utils/projectBoard';

const COLUMN_WIDTH = 280;
const CHECK_SIZE = 20;
/** How close to the board's side edge a dragged card has to be to scroll it. */
const EDGE_ZONE = 48;
const EDGE_SPEED = 12;

interface Props {
  /** The project's open rows, as the list draws them (`buildProjectListItems`). */
  items: ProjectListItem[];
  /** Whether new rows are list items (`sectionIsList`), for the placeholder. */
  columnIsList: (group: TaskGroup | null) => boolean;
  /** Each column's completed tasks, by column key, one row per member (projectCompletedRows). */
  completed: ReadonlyMap<string, Task[]>;
  onOpenTask: (task: Task) => void;
  onCheck: (task: Task) => void;
  onUncheck: (task: Task) => void;
  onOpenSection: (group: TaskGroup) => void;
  /** Runs a drop's writes. See `boardMove` for what each field asks. */
  onMove: (move: Extract<BoardMove, { kind: 'move' }>) => void;
  /**
   * The screen's own new-line field (`NewLineField`), so a line typed on the
   * board parses exactly as one typed in the list does.
   */
  renderNewLine: (group: TaskGroup | null, close: () => void, next: () => void) => React.ReactNode;
  onAddSection: (name: string) => void;
  /** Bumped by the add button's New task: opens the no-section column's field. */
  openLineSignal: number | null;
  /**
   * Whether the new-section field is open. The screen's state, so the add
   * button's New section and the board's own button open the same field.
   */
  namingSection: boolean;
  onStartNaming: () => void;
  onNamingDone: () => void;
  /** Keeps the columns' ends clear of the add button. */
  bottomPadding: number;
}

/**
 * A project page drawn as a board (`Project.boardView`): a column for the
 * tasks in no section, one per section, and a last one for naming a new
 * section. A card is ticked off with its box, opened with a tap, and moved by
 * holding it and dragging it to another column or another place in its own.
 *
 * The drag is `useDragToDay`'s responder over the whole board, with every
 * column and card measured once when a card lifts. Where it is aimed is never
 * state (the rule in CLAUDE.md under Drag and drop): the floating card and the
 * drop line are Animated values set from the gesture, so nothing re-renders
 * while the finger moves. Columns hold still under the finger; held near the
 * board's side edges the card scrolls the board sideways, and near a column's
 * top or bottom it scrolls that column, with the measured card positions moved
 * by however far it went.
 *
 * Each column ends on a count of its completed tasks, which opens to show them
 * checked off, so a board isn't the one place a finished task can't be found.
 */
export function ProjectBoard({
  items, completed, columnIsList, onOpenTask, onCheck, onUncheck, onOpenSection, onMove, renderNewLine,
  onAddSection, openLineSignal, namingSection, onStartNaming, onNamingDone, bottomPadding,
}: Props) {
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const columns = useMemo(() => boardColumns(items), [items]);
  const [lineColumn, setLineColumn] = useState<string | null>(null);
  const [lineKey, setLineKey] = useState(0);
  // Which columns are showing their completed tasks. Session-only, like the
  // list's own completed toggle.
  const [doneShown, setDoneShown] = useState<ReadonlySet<string>>(new Set());
  const toggleDone = useCallback((key: string) => {
    animateLayout();
    setDoneShown(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (openLineSignal === null) return;
    setLineColumn(LOOSE_COLUMN_KEY);
    setLineKey(k => k + 1);
    boardScroll.current?.scrollTo({ x: 0, animated: true });
  }, [openLineSignal]);
  useEffect(() => {
    if (namingSection) boardScroll.current?.scrollToEnd({ animated: true });
  }, [namingSection]);

  // ==== measurement ====
  const rootRef = useRef<View>(null);
  const boardScroll = useRef<ScrollView>(null);
  const columnViews = useRef(new Map<string, View>());
  const cardViews = useRef(new Map<string, View>());
  const columnScrolls = useRef(new Map<string, ColumnScroll>());
  const scrollX = useRef(0);
  const viewportWidth = useRef(0);
  const contentWidth = useRef(0);
  // Filled at the lift. Column x is stored against the scroll offset it was
  // measured at, so a sideways autoscroll mid-drag only has to subtract.
  const measured = useRef<{
    rootX: number; rootY: number; scrollX: number;
    columns: Array<{
      key: string; x: number; width: number; top: number; bottom: number;
      /** The column's own scroll offset when its cards were measured. */
      scrollY: number;
      cards: Array<{ id: string; top: number; height: number }>;
    }>;
  } | null>(null);

  // ==== the floating card and the drop line ====
  const [lifted, setLifted] = useState<Task | null>(null);
  const cardPos = useRef(new Animated.ValueXY()).current;
  const linePos = useRef(new Animated.ValueXY()).current;
  const lineOpacity = useRef(new Animated.Value(0)).current;
  const liftOrigin = useRef({ x: 0, y: 0 });
  const lastPage = useRef<{ x: number; y: number } | null>(null);
  const edgeVelocity = useRef(0);
  const columnVelocity = useRef(0);
  const edgeFrame = useRef<number | null>(null);
  const aim = useRef<{ key: string; index: number } | null>(null);
  const draggedIdRef = useRef<string | null>(null);

  const measureAll = (onDone: () => void) => {
    const root = rootRef.current;
    if (!root) return;
    root.measureInWindow((rootX, rootY) => {
      const keys = columns.map(c => c.key);
      const result: NonNullable<typeof measured.current>['columns'] = [];
      let pending = 0;
      const finish = () => {
        if (pending > 0) return;
        result.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
        result.forEach(c => c.cards.sort((a, b) => a.top - b.top));
        measured.current = { rootX, rootY, scrollX: scrollX.current, columns: result };
        onDone();
      };
      for (const column of columns) {
        const view = columnViews.current.get(column.key);
        if (!view) continue;
        pending++;
        const entry = {
          key: column.key, x: 0, width: 0, top: 0, bottom: 0,
          scrollY: columnScrolls.current.get(column.key)?.y() ?? 0,
          cards: [] as Array<{ id: string; top: number; height: number }>,
        };
        result.push(entry);
        view.measureInWindow((x, y, width, height) => {
          entry.x = x; entry.width = width; entry.top = y; entry.bottom = y + height;
          pending--;
          finish();
        });
        for (const task of column.tasks) {
          const card = cardViews.current.get(task.id);
          if (!card) continue;
          pending++;
          card.measureInWindow((_x, y, _w, height) => {
            entry.cards.push({ id: task.id, top: y, height });
            pending--;
            finish();
          });
        }
      }
      if (pending === 0) finish();
    });
  };

  /** Where a drop at this point would land, and the line that says so. */
  const updateAim = (page: { x: number; y: number }, draggedId: string) => {
    const m = measured.current;
    if (!m) return;
    const shift = scrollX.current - m.scrollX;
    const frames = m.columns.map(c => ({ x: c.x - shift, width: c.width }));
    const at = columnIndexAt(frames, page.x);
    if (at === null) return;
    const column = m.columns[at];
    const scrolled = (columnScrolls.current.get(column.key)?.y() ?? column.scrollY) - column.scrollY;
    const cards = column.cards
      .filter(c => c.id !== draggedId)
      .map(c => ({ ...c, top: c.top - scrolled }));
    const index = insertIndexAt(cards, page.y);
    const before = aim.current;
    aim.current = { key: column.key, index };
    if (before?.key !== column.key || before.index !== index) haptics.impactLight();
    // Between two cards, under the last, or under the header of an empty column.
    const y = cards.length === 0
      ? column.top + spacing.xl + spacing.sm
      : index < cards.length
        ? cards[index].top - spacing.xs
        : cards[cards.length - 1].top + cards[cards.length - 1].height + spacing.xs;
    // Kept inside the column, for a slot scrolled out of its view.
    const shown = Math.max(column.top + spacing.lg, Math.min(column.bottom - spacing.xs, y));
    linePos.setValue({ x: frames[at].x - m.rootX + spacing.sm, y: shown - m.rootY - 1 });
    lineOpacity.setValue(1);
  };

  const stopEdgeScroll = () => {
    edgeVelocity.current = 0;
    columnVelocity.current = 0;
    if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current);
    edgeFrame.current = null;
  };

  const edgeTick = useCallback(() => {
    let moved = false;
    const v = edgeVelocity.current;
    if (v !== 0) {
      const max = Math.max(0, contentWidth.current - viewportWidth.current);
      const next = Math.max(0, Math.min(max, scrollX.current + v));
      if (next !== scrollX.current) {
        scrollX.current = next;
        boardScroll.current?.scrollTo({ x: next, animated: false });
        moved = true;
      }
    }
    const vy = columnVelocity.current;
    const column = aim.current ? columnScrolls.current.get(aim.current.key) : undefined;
    if (vy !== 0 && column) {
      const next = Math.max(0, Math.min(column.maxY(), column.y() + vy));
      if (next !== column.y()) { column.scrollTo(next); moved = true; }
    }
    if (!moved) { edgeFrame.current = null; return; }
    const page = lastPage.current;
    const id = draggedIdRef.current;
    if (page && id) updateAim(page, id);
    edgeFrame.current = requestAnimationFrame(edgeTick);
    // updateAim reads only refs, so the first render's copy is as good as any.
  }, []);

  const drag = useDragToDay<Task>({
    onStart: (task, frame) => {
      draggedIdRef.current = task.id;
      aim.current = null;
      measureAll(() => {
        // Released before the measurements came back: nothing to float.
        if (draggedIdRef.current !== task.id) return;
        const m = measured.current;
        const card = m?.columns.flatMap(c => c.cards.map(k => ({ k, c }))).find(e => e.k.id === task.id);
        if (!m || !card) return;
        liftOrigin.current = { x: card.c.x - m.rootX + spacing.sm, y: frame.top - m.rootY };
        cardPos.setValue(liftOrigin.current);
        setLifted(task);
      });
    },
    onMove: (page, translation) => {
      lastPage.current = page;
      cardPos.setValue({ x: liftOrigin.current.x + translation.x, y: liftOrigin.current.y + translation.y });
      const id = draggedIdRef.current;
      if (id) updateAim(page, id);
      const m = measured.current;
      if (!m) return;
      const left = page.x - m.rootX;
      const velocity = left < EDGE_ZONE ? -EDGE_SPEED : left > viewportWidth.current - EDGE_ZONE ? EDGE_SPEED : 0;
      edgeVelocity.current = velocity;
      // Near the top or bottom of the column it's over, that column scrolls.
      const over = aim.current ? m.columns.find(c => c.key === aim.current!.key) : undefined;
      columnVelocity.current = !over ? 0
        : page.y < over.top + EDGE_ZONE ? -EDGE_SPEED
          : page.y > over.bottom - EDGE_ZONE ? EDGE_SPEED : 0;
      if ((velocity !== 0 || columnVelocity.current !== 0) && edgeFrame.current === null) {
        edgeFrame.current = requestAnimationFrame(edgeTick);
      }
    },
    onEnd: () => {
      const id = draggedIdRef.current;
      const target = aim.current;
      finishDrag();
      if (!id || !target) return;
      const move = boardMove(items, id, target.key, target.index);
      if (move.kind === 'move') { haptics.success(); onMove(move); }
    },
    onCancel: () => finishDrag(),
  });

  const finishDrag = () => {
    stopEdgeScroll();
    draggedIdRef.current = null;
    aim.current = null;
    lastPage.current = null;
    measured.current = null;
    lineOpacity.setValue(0);
    setLifted(null);
  };

  useEffect(() => () => stopEdgeScroll(), []);

  // Ref callbacks cached per id, so a re-render doesn't hand every card a new one.
  const cardRefs = useRef(new Map<string, (view: View | null) => void>());
  const cardRef = (id: string) => {
    let ref = cardRefs.current.get(id);
    if (!ref) {
      const register = drag.registerRow(id);
      ref = (view: View | null) => {
        register(view);
        if (view) cardViews.current.set(id, view);
        else cardViews.current.delete(id);
      };
      cardRefs.current.set(id, ref);
    }
    return ref;
  };
  const columnRefs = useRef(new Map<string, (view: View | null) => void>());
  const columnRef = (key: string) => {
    let ref = columnRefs.current.get(key);
    if (!ref) {
      ref = (view: View | null) => {
        if (view) columnViews.current.set(key, view);
        else columnViews.current.delete(key);
      };
      columnRefs.current.set(key, ref);
    }
    return ref;
  };

  const scrollRefs = useRef(new Map<string, (handle: ColumnScroll | null) => void>());
  const scrollRef = (key: string) => {
    let ref = scrollRefs.current.get(key);
    if (!ref) {
      ref = (handle: ColumnScroll | null) => {
        if (handle) columnScrolls.current.set(key, handle);
        else columnScrolls.current.delete(key);
      };
      scrollRefs.current.set(key, ref);
    }
    return ref;
  };

  const dragging = drag.draggingId !== null;

  return (
    <View
      ref={rootRef}
      style={styles.root}
      collapsable={false}
      {...drag.panHandlers}
      {...drag.containerHandlers}
    >
      <ScrollView
        ref={boardScroll}
        horizontal
        scrollEnabled={!dragging}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={e => { scrollX.current = e.nativeEvent.contentOffset.x; }}
        onLayout={(e: LayoutChangeEvent) => { viewportWidth.current = e.nativeEvent.layout.width; }}
        onContentSizeChange={w => { contentWidth.current = w; }}
        contentContainerStyle={[styles.boardContent, { paddingBottom: bottomPadding }]}
      >
        {columns.map(column => (
          <BoardColumnView
            key={column.key}
            column={column}
            styles={styles}
            columnRef={columnRef(column.key)}
            registerScroll={scrollRef(column.key)}
            completed={completed.get(column.key) ?? NO_TASKS}
            doneShown={doneShown.has(column.key)}
            onToggleDone={toggleDone}
            onUncheck={onUncheck}
            cardRef={cardRef}
            draggingId={drag.draggingId}
            scrollEnabled={!dragging}
            isList={columnIsList(column.group)}
            onOpenTask={onOpenTask}
            onCheck={onCheck}
            onOpenSection={onOpenSection}
            onLift={drag.startDrag}
            newLine={lineColumn === column.key
              ? <React.Fragment key={`line-${column.key}-${lineKey}`}>{renderNewLine(column.group, () => setLineColumn(null), () => setLineKey(k => k + 1))}</React.Fragment>
              : null}
            onOpenLine={() => { setLineColumn(column.key); setLineKey(k => k + 1); }}
          />
        ))}
        <View style={[styles.column, styles.newColumn]}>
          {namingSection ? (
            <InlineNameField
              placeholder="Section name"
              onSubmit={name => { onNamingDone(); onAddSection(name); }}
              onCancel={onNamingDone}
              accessibilityLabel="New section name"
            />
          ) : (
            <InlineAction
              icon="add"
              label="New section"
              variant="neutral"
              surface="tray"
              style={styles.addAction}
              onPress={() => { haptics.tap(); onStartNaming(); }}
            />
          )}
        </View>
      </ScrollView>

      {/* The drop line and the card under the finger, over everything. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.dropLine, { opacity: lineOpacity, transform: linePos.getTranslateTransform() }]}
      />
      {lifted && (
        <Animated.View
          pointerEvents="none"
          style={[styles.floating, shadows.card, { transform: cardPos.getTranslateTransform() }]}
        >
          <CardBody task={lifted} styles={styles} colors={colors} />
        </Animated.View>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const NO_TASKS: Task[] = [];

/** What the board needs of a column's own scroll view to scroll it mid-drag. */
interface ColumnScroll {
  y: () => number;
  maxY: () => number;
  scrollTo: (y: number) => void;
}

interface ColumnProps {
  column: BoardColumn;
  styles: Styles;
  columnRef: (view: View | null) => void;
  registerScroll: (handle: ColumnScroll | null) => void;
  completed: Task[];
  doneShown: boolean;
  onToggleDone: (key: string) => void;
  onUncheck: (task: Task) => void;
  cardRef: (id: string) => (view: View | null) => void;
  draggingId: string | null;
  scrollEnabled: boolean;
  isList: boolean;
  onOpenTask: (task: Task) => void;
  onCheck: (task: Task) => void;
  onOpenSection: (group: TaskGroup) => void;
  onLift: (task: Task) => void;
  newLine: React.ReactNode;
  onOpenLine: () => void;
}

function BoardColumnView({
  column, styles, columnRef, registerScroll, completed, doneShown, onToggleDone, onUncheck, cardRef, draggingId, scrollEnabled, isList,
  onOpenTask, onCheck, onOpenSection, onLift, newLine, onOpenLine,
}: ColumnProps) {
  // Its own, since each column scrolls on its own and its add field sits at
  // the foot of what it scrolls.
  const colors = useColors();
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();
  const scrollY = useRef(0);
  const contentHeight = useRef(0);
  const viewHeight = useRef(0);
  useEffect(() => {
    registerScroll({
      y: () => scrollY.current,
      maxY: () => Math.max(0, contentHeight.current - viewHeight.current),
      scrollTo: y => {
        scrollY.current = y;
        keyboardScroll.ref.current?.scrollTo({ y, animated: false });
      },
    });
    return () => registerScroll(null);
  }, [registerScroll, keyboardScroll.ref]);
  const title = column.group ? (column.group.title.trim() || 'Untitled section') : 'No section';
  const header = (
    <>
      <Text style={styles.columnTitle} numberOfLines={1}>{title.toUpperCase()}</Text>
      <Text style={styles.columnCount}>{column.tasks.length}</Text>
    </>
  );
  return (
    <View ref={columnRef} collapsable={false} style={styles.column}>
      {column.group ? (
        <TouchableOpacity
          style={styles.columnHeader}
          onPress={() => { haptics.tap(); onOpenSection(column.group!); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${column.tasks.length} open. Edit section`}
        >
          {header}
        </TouchableOpacity>
      ) : (
        <View style={styles.columnHeader} accessibilityLabel={`${title}, ${column.tasks.length} open`}>{header}</View>
      )}
      <ScrollView
        {...keyboardScroll.props}
        ref={keyboardScroll.ref}
        style={styles.columnScroll}
        scrollEnabled={scrollEnabled}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={e => { keyboardScroll.noteScroll(e); scrollY.current = e.nativeEvent.contentOffset.y; }}
        onLayout={e => { viewHeight.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_w, h) => { contentHeight.current = h; }}
      >
        {column.tasks.map(task => (
          <View
            key={task.id}
            ref={cardRef(task.id)}
            collapsable={false}
            style={[styles.cardWrap, draggingId === task.id && styles.cardLifted]}
          >
            <TouchableOpacity
              style={styles.card}
              onPress={() => { haptics.tap(); onOpenTask(task); }}
              onLongPress={() => onLift(task)}
              delayLongPress={interaction.delayLongPress}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={task.title}
              accessibilityHint="Opens the task. Hold to move it to another column."
            >
              <TouchableOpacity
                style={styles.check}
                onPress={() => onCheck(task)}
                hitSlop={8}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: false }}
                accessibilityLabel={`Complete ${task.title}`}
              />
              <CardText task={task} styles={styles} colors={colors} />
            </TouchableOpacity>
          </View>
        ))}
        {newLine ?? (
          <InlineAction
            icon="add"
            label={isList ? 'Add item' : 'Add task'}
            style={styles.addAction}
            onPress={() => { haptics.tap(); onOpenLine(); }}
          />
        )}
        {column.tasks.length === 0 && !newLine && (
          <Text style={styles.emptyNote}>
            {column.group ? 'Nothing here yet.' : 'Drop a card here to take it out of its section.'}
          </Text>
        )}
        {completed.length > 0 && (
          <TouchableOpacity
            style={styles.doneToggle}
            onPress={() => { haptics.tap(); onToggleDone(column.key); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityState={{ expanded: doneShown }}
            accessibilityLabel={`${doneShown ? 'Hide' : 'Show'} ${completed.length} completed`}
          >
            <Ionicons name="checkmark-circle-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.doneToggleText}>{completed.length} completed</Text>
            <RotatingChevron open={doneShown} size={13} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        {doneShown && completed.map(task => (
          <TouchableOpacity
            key={task.id}
            style={[styles.card, styles.cardWrap, styles.doneCard]}
            onPress={() => { haptics.tap(); onOpenTask(task); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${task.title}, completed`}
          >
            <TouchableOpacity
              style={[styles.check, styles.checkDone]}
              onPress={() => { haptics.tap(); onUncheck(task); }}
              hitSlop={8}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: true }}
              accessibilityLabel={`Mark ${task.title} not done`}
            >
              <Ionicons name="checkmark" size={14} color={colors.onDone} />
            </TouchableOpacity>
            <Text style={[styles.cardTitle, styles.doneTitle]} numberOfLines={2}>{task.title}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function CardText({ task, styles, colors }: { task: Task; styles: Styles; colors: Colors }) {
  const due = task.dueDate ? format(new Date(task.dueDate), 'EEE, MMM d') : null;
  const waiting = isHeldBack(task);
  return (
    <View style={styles.cardText}>
      <Text style={styles.cardTitle} numberOfLines={3}>{task.title}</Text>
      {(due || waiting) && (
        <View style={styles.metaRow}>
          {due && <Text style={styles.meta}>{due}</Text>}
          {waiting && (
            <View style={styles.metaWaiting}>
              <Ionicons name="hourglass-outline" size={11} color={colors.textSecondary} />
              <Text style={styles.meta}>Waiting</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function CardBody({ task, styles, colors }: { task: Task; styles: Styles; colors: Colors }) {
  return (
    <View style={styles.card}>
      <View style={styles.check} />
      <CardText task={task} styles={styles} colors={colors} />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1 },
  // Full height, so a column's maxHeight has a height to be a share of: a
  // long column stops at the board's foot and scrolls inside itself.
  boardContent: { height: '100%', paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.smd, alignItems: 'flex-start' },
  column: {
    width: COLUMN_WIDTH,
    maxHeight: '100%',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  newColumn: { minHeight: 0 },
  columnHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    paddingHorizontal: spacing.xs, paddingTop: spacing.xxs, paddingBottom: spacing.sm, minHeight: 32,
  },
  columnTitle: { flex: 1, fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.textSecondary, letterSpacing: 0.8 },
  columnCount: { fontSize: font.xs, color: colors.textTertiary },
  columnScroll: { flexGrow: 0, flexShrink: 1 },
  cardWrap: { marginBottom: spacing.sm },
  cardLifted: { opacity: 0.3 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.smd,
    backgroundColor: colors.bgSecondary, borderRadius: radius.sm + 2,
    paddingVertical: spacing.smd, paddingHorizontal: spacing.smd,
  },
  check: {
    width: CHECK_SIZE, height: CHECK_SIZE, borderRadius: checkboxRadius(CHECK_SIZE),
    borderWidth: 1.5, borderColor: colors.controlBorder, marginTop: 1,
  },
  cardText: { flex: 1 },
  cardTitle: { fontSize: font.md, color: colors.text },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  meta: { fontSize: font.xxs, color: colors.textSecondary },
  metaWaiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  addAction: { alignSelf: 'flex-start' },
  doneToggle: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start',
    marginTop: spacing.smd, paddingHorizontal: spacing.xs, minHeight: 32,
  },
  doneToggleText: { fontSize: font.sm, color: colors.textSecondary },
  doneCard: { backgroundColor: colors.bgTertiary },
  checkDone: { backgroundColor: colors.done, borderColor: colors.done, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { flex: 1, color: colors.textSecondary },
  emptyNote: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  dropLine: {
    position: 'absolute', left: 0, top: 0,
    width: COLUMN_WIDTH - spacing.md, height: 3, borderRadius: radius.full, backgroundColor: colors.accent,
  },
  floating: {
    position: 'absolute', left: 0, top: 0, width: COLUMN_WIDTH - spacing.md, borderRadius: radius.sm + 2,
  },
});
