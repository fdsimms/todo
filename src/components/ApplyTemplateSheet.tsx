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
  StyleSheet,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useShallow } from 'zustand/react/shallow';
import { useTemplateStore } from '../store/useTemplateStore';
import {
  resolveOffsetDate,
  formatOffsetLabel,
  anchorLabel,
  buildApplyTree,
  flattenApplyTree,
  leafIdsUnder,
  expandSelectionWithAncestors,
  extractPlaceholders,
  substitutePlaceholders,
  declaresRunPlaceholder,
  resolveApplyContainer,
  RUN_PLACEHOLDER,
  type TemplateAnchors,
  type ApplyTreeNode,
} from '../utils/templateUtils';
import { formatScheduledDate } from '../utils/dateUtils';
import { TITLE_MAX_LENGTH } from '../types';
import { WhenPicker } from './WhenPicker';
import { EditorRow } from './EditorRow';
import type { TaskTemplate, TemplateContainer, TemplateItem } from '../types';

interface Props {
  visible: boolean;
  template: TaskTemplate | null;
  onClose: () => void;
  /** Land every created task in this existing project instead of the template's own container — see ApplyTemplateOptions.targetProjectId. */
  projectId?: string;
}

/** Sub-label for a checklist row: live dates when its anchor is set, offset labels otherwise. */
function itemSublabel(item: TemplateItem, anchors: TemplateAnchors): string | null {
  const parts: string[] = [];
  const anchor = item.anchor === 'end' ? anchors.end : anchors.start;
  const due = resolveOffsetDate(anchor, item.dueOffsetDays);
  const defer = resolveOffsetDate(anchor, item.deferOffsetDays);
  if (due) {
    parts.push(`Due ${formatScheduledDate(due)}`);
  } else if (item.dueOffsetDays !== null) {
    parts.push(`Due ${formatOffsetLabel(item.dueOffsetDays).toLowerCase()}`);
  }
  if (defer) {
    parts.push(`Hidden until ${formatScheduledDate(defer)}`);
  } else if (item.deferOffsetDays !== null) {
    parts.push(`Hidden until ${formatOffsetLabel(item.deferOffsetDays).toLowerCase()}`);
  }
  if (item.timeSegments.length > 0) {
    parts.push(item.timeSegments.join(', '));
  }
  if ((item.dueOffsetDays !== null || item.deferOffsetDays !== null) && !anchor) {
    parts.push(`from ${anchorLabel(item.anchor).toLowerCase()}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** What the run name will do, given the container this apply resolves to. Doubles as the field's only in-app documentation. */
function runNameHint(container: TemplateContainer, upgraded: boolean, hasPlaceholders: boolean): string {
  const fills = hasPlaceholders ? ', and fills in the blanks below' : '';
  if (container === 'project') {
    return upgraded
      ? `Names the project these tasks land in. This template's groups become stacks inside it${fills}`
      : `Names the project these tasks land in, dated by the anchors above${fills}`;
  }
  if (container === 'stack') return `Names the stack these tasks land in${fills}`;
  return `Fills in the blanks below${fills ? '' : ''}`;
}

/** Recursively collect the ids of every leaf item under `nodes` that should start checked (optional items, and everything under an optional nested-template block, start unchecked). */
function initialLeafSelection(nodes: ApplyTreeNode[], ancestorOptional: boolean, out: Set<string>) {
  for (const node of nodes) {
    if (node.broken) continue;
    if (node.item.refTemplateId === null) {
      if (!node.item.optional && !ancestorOptional) out.add(node.item.id);
    } else {
      initialLeafSelection(node.children, ancestorOptional || node.item.optional, out);
    }
  }
}

/**
 * Bottom sheet for applying a template: pick an optional anchor date, toggle
 * which items to include (optional items start unchecked, including whole
 * nested-template blocks), then create them all as real tasks.
 */
export function ApplyTemplateSheet({ visible, template, onClose, projectId }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const templates = useTemplateStore(useShallow(s => s.templates));
  const applyTemplate = useTemplateStore(s => s.applyTemplate);

  const templatesById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates]);
  const tree = useMemo(
    () => (template ? buildApplyTree(template.items, template.id, templatesById) : []),
    [template, templatesById]
  );

  // Leaf item ids the user has checked — the only ids the checklist UI
  // itself needs to track; ref-item ids are derived at apply time.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedRefIds, setCollapsedRefIds] = useState<Set<string>>(new Set());
  const [startAnchor, setStartAnchor] = useState<Date | null>(null);
  const [endAnchor, setEndAnchor] = useState<Date | null>(null);
  const [calendarTarget, setCalendarTarget] = useState<'start' | 'end' | null>(null);
  // What this run of the template is about ("Camping w/ Dan"), and values for
  // any `{name}` blanks its items declare. Both empty = the original behavior.
  const [runName, setRunName] = useState('');
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const anchors: TemplateAnchors = { start: startAnchor, end: endAnchor };

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && template) {
      // Non-optional leaves start checked; optional ones (and everything
      // under an optional nested-template block) start unchecked.
      const initial = new Set<string>();
      initialLeafSelection(buildApplyTree(template.items, template.id, templatesById), false, initial);
      setSelectedIds(initial);
      setCollapsedRefIds(new Set());
      setStartAnchor(null);
      setEndAnchor(null);
      setCalendarTarget(null);
      setRunName('');
      setPlaceholderValues({});
      translateY.setValue(600);
      backdropOpacity.setValue(0);
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
  }, [visible, template]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 700,
        ...animation.spring.sheetDismiss,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      translateY.setValue(600);
      onClose();
    });
  };

  // Slide the sheet away before showing the calendar — rendering both at once
  // causes touch conflicts (same choreography as DeferModal).
  const openCalendar = (target: 'start' | 'end') => {
    Animated.spring(translateY, {
      toValue: 700,
      ...animation.spring.sheetDismiss,
      useNativeDriver: true,
    }).start(() => {
      setCalendarTarget(target);
    });
  };

  const restoreSheet = () => {
    setCalendarTarget(null);
    Animated.spring(translateY, {
      toValue: 0,
      ...animation.spring.smooth,
      useNativeDriver: true,
    }).start();
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

  if (!template) return null;

  const toggleItem = (id: string) => {
    haptics.tap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Toggle every leaf under a ref node together: all-select if any are unchecked, else deselect all. */
  const toggleNode = (node: ApplyTreeNode) => {
    haptics.tap();
    const leafIds = leafIdsUnder(node);
    setSelectedIds(prev => {
      const allChecked = leafIds.every(id => prev.has(id));
      const next = new Set(prev);
      leafIds.forEach(id => (allChecked ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const toggleCollapsed = (id: string) => {
    haptics.tap();
    setCollapsedRefIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const flatLeaves = flattenApplyTree(tree);
  const selectedCount = flatLeaves.filter(l => selectedIds.has(l.item.id)).length;
  const anchorless = flatLeaves.some(({ item: i }) => {
    if (!selectedIds.has(i.id)) return false;
    if (i.dueOffsetDays === null && i.deferOffsetDays === null) return false;
    return i.anchor === 'end' ? endAnchor === null : startAnchor === null;
  });

  // Derived off the whole tree rather than the current selection, so the field
  // and its hint don't appear and disappear as items are ticked.
  const selectedLeafItems = flatLeaves.map(l => l.item);
  const placeholderNames = extractPlaceholders(selectedLeafItems);
  const resolvedContainer = resolveApplyContainer(template.applyContainer, flatLeaves, templatesById);
  // Mirrors useTemplateStore.applyTemplate's downgrade: a project already
  // exists here, so a resolved 'project' container becomes a stack inside it
  // instead of a second project.
  const container = projectId && resolvedContainer === 'project' ? 'stack' : resolvedContainer;
  const containerUpgraded = container !== template.applyContainer;
  // Nothing to name when the run has no container and no `{run}` to fill.
  const showRunField = container !== 'none' || declaresRunPlaceholder(selectedLeafItems);

  const values = { ...placeholderValues, [RUN_PLACEHOLDER]: runName.trim() };

  const handleApply = () => {
    if (selectedCount === 0) return;
    haptics.success();
    const flatSelection = expandSelectionWithAncestors(tree, selectedIds);
    applyTemplate(template.id, flatSelection, anchors, {
      runName,
      placeholders: placeholderValues,
      targetProjectId: projectId,
    });
    dismiss();
  };

  const renderApplyTreeNodes = (nodes: ApplyTreeNode[], depth: number) =>
    nodes.map((node, idx) => {
      const isLast = idx === nodes.length - 1;
      const row = renderApplyTreeNode(node, depth);
      return (
        <React.Fragment key={node.item.id}>
          {row}
          {!isLast && <View style={styles.inlineSep} />}
        </React.Fragment>
      );
    });

  const renderApplyTreeNode = (node: ApplyTreeNode, depth: number) => {
    const indent = { paddingLeft: spacing.md + depth * spacing.lg };

    if (node.broken) {
      return (
        <View style={[styles.itemRow, indent]}>
          <Ionicons name="alert-circle" size={20} color={colors.warning} />
          <View style={styles.itemContent}>
            <Text style={[styles.itemTitle, { color: colors.warning }]} numberOfLines={1}>
              {node.item.refTemplateName || 'Nested template'} was deleted — skipped
            </Text>
          </View>
        </View>
      );
    }

    if (node.item.refTemplateId !== null) {
      const resolved = templatesById.get(node.item.refTemplateId);
      const name = resolved?.name ?? node.item.refTemplateName;
      const leafIds = leafIdsUnder(node);
      const allChecked = leafIds.length > 0 && leafIds.every(id => selectedIds.has(id));
      const collapsed = collapsedRefIds.has(node.item.id);
      return (
        <View>
          <View style={[styles.itemRow, indent]}>
            <TouchableOpacity
              onPress={() => toggleNode(node)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="checkbox"
              accessibilityLabel={name}
              accessibilityState={{ checked: allChecked }}
            >
              <Ionicons
                name={allChecked ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={allChecked ? colors.accent : colors.textTertiary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.itemContent}
              onPress={() => toggleCollapsed(node.item.id)}
              activeOpacity={interaction.activeOpacity}
            >
              <View style={styles.nestedTitleRow}>
                <Ionicons name="git-branch-outline" size={13} color={colors.textSecondary} />
                <Text style={[styles.itemTitle, !allChecked && styles.itemTitleUnchecked]} numberOfLines={1}>
                  {name}
                </Text>
              </View>
              <Text style={styles.itemSub} numberOfLines={1}>
                {leafIds.length} item{leafIds.length === 1 ? '' : 's'}
              </Text>
            </TouchableOpacity>
            <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={14} color={colors.textTertiary} />
          </View>
          {!collapsed && renderApplyTreeNodes(node.children, depth + 1)}
        </View>
      );
    }

    const checked = selectedIds.has(node.item.id);
    const sublabel = itemSublabel(node.item, anchors);
    // Shown substituted so the checklist is a live preview of the titles that
    // will actually be created, blanks and all.
    const title = substitutePlaceholders(node.item.title, values);
    return (
      <TouchableOpacity
        style={[styles.itemRow, indent]}
        onPress={() => toggleItem(node.item.id)}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="checkbox"
        accessibilityLabel={title}
        accessibilityState={{ checked }}
      >
        <Ionicons
          name={checked ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={checked ? colors.accent : colors.textTertiary}
        />
        <View style={styles.itemContent}>
          <Text style={[styles.itemTitle, !checked && styles.itemTitleUnchecked]} numberOfLines={1}>
            {title}
          </Text>
          {sublabel && <Text style={styles.itemSub} numberOfLines={1}>{sublabel}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView
          intensity={isDark ? 20 : 15}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sheetTitle}>{template.name}</Text>

          {/* What this run is about — the one field that carries the context
              the item titles leave out. Optional: blank means loose, unnamed
              tasks, exactly as before it existed. */}
          {showRunField && (
            <View style={styles.runBlock}>
              <TextInput
                style={styles.runInput}
                value={runName}
                onChangeText={setRunName}
                placeholder={`What's this ${template.name.toLowerCase()} for?`}
                placeholderTextColor={colors.textTertiary}
                maxLength={TITLE_MAX_LENGTH}
                returnKeyType="done"
              />
              <Text style={styles.runHint}>
                {runNameHint(container, containerUpgraded, placeholderNames.length > 0)}
              </Text>
            </View>
          )}

          {/* The name stays visible beside the field rather than living in its
              placeholder text — with two or three blanks, a filled-in box with
              no label is unidentifiable. */}
          {placeholderNames.length > 0 && (
            <View style={styles.runBlock}>
              {/* Named, because "blanks" is what the item editor calls them —
                  a labelled group is also what tells someone who has never
                  written one where these boxes came from. */}
              <Text style={styles.blanksLabel}>Blanks</Text>
              {placeholderNames.map(name => (
                <View key={name} style={styles.blankRow}>
                  <Text style={styles.blankLabel} numberOfLines={1}>{name}</Text>
                  <TextInput
                    style={styles.blankInput}
                    value={placeholderValues[name] ?? ''}
                    onChangeText={text => setPlaceholderValues(prev => ({ ...prev, [name]: text }))}
                    placeholder={`{${name}}`}
                    placeholderTextColor={colors.textTertiary}
                    maxLength={TITLE_MAX_LENGTH}
                    returnKeyType="done"
                    accessibilityLabel={`Value for ${name}`}
                  />
                </View>
              ))}
            </View>
          )}

          {(showRunField || placeholderNames.length > 0) && <View style={styles.inlineSep} />}

          {/* Anchor dates */}
          <AnchorRow
            icon="play-outline"
            label="Start date"
            hint="Items anchored to the start are relative to this day"
            value={startAnchor}
            onPress={() => openCalendar('start')}
            onClear={() => setStartAnchor(null)}
          />
          <View style={styles.inlineSep} />
          <AnchorRow
            icon="flag-outline"
            label="End date"
            hint="Items anchored to the end are relative to this day"
            value={endAnchor}
            onPress={() => openCalendar('end')}
            onClear={() => setEndAnchor(null)}
          />

          <View style={styles.inlineSep} />

          {/* Item checklist, including any nested templates' items indented beneath their ref row */}
          <ScrollView style={styles.itemList} bounces={false}>
            {renderApplyTreeNodes(tree, 0)}
          </ScrollView>

          {anchorless && (
            <Text style={styles.anchorlessHint}>
              Some scheduled items are missing their anchor date and will be added without dates
            </Text>
          )}

          <TouchableOpacity
            style={[styles.applyBtn, selectedCount === 0 && styles.applyBtnDisabled]}
            onPress={handleApply}
            disabled={selectedCount === 0}
            activeOpacity={interaction.activeOpacity}
          >
            <Text style={[styles.applyBtnText, selectedCount === 0 && styles.applyBtnTextDisabled]}>
              {selectedCount === 0
                ? 'No tasks selected'
                : `Add ${selectedCount} task${selectedCount === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>

      <WhenPicker
        visible={calendarTarget !== null}
        value={calendarTarget === 'end' ? endAnchor : startAnchor}
        title={calendarTarget === 'end' ? 'End date' : 'Start date'}
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={date => {
          if (calendarTarget === 'end') setEndAnchor(date);
          else setStartAnchor(date);
          restoreSheet();
        }}
        onClear={() => {
          if (calendarTarget === 'end') setEndAnchor(null);
          else setStartAnchor(null);
          restoreSheet();
        }}
        onCancel={restoreSheet}
      />
    </Modal>
  );
}

/**
 * One of the two anchor date pickers (start / end) shown atop the sheet.
 * A thin wrapper over `EditorRow` — the row this sheet needs is the same
 * "icon — label — value ›" one every editor uses; it only has to format the
 * Date into the value string first.
 */
function AnchorRow({
  icon, label, hint, value, onPress, onClear,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  value: Date | null;
  onPress: () => void;
  onClear: () => void;
}) {
  return (
    <EditorRow
      icon={icon}
      label={label}
      hint={hint}
      value={value
        ? value.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : undefined}
      onPress={onPress}
      onClear={onClear}
    />
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  runBlock: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  // No lineHeight on either input — RN maps it onto the iOS paragraph style
  // with no baseline compensation, dropping the glyphs low in the box. Height
  // does the sizing instead.
  runInput: {
    color: colors.text,
    fontSize: font.md,
    height: 42,
    paddingHorizontal: 11,
    borderRadius: radius.sm,
    borderWidth: border.sm,
    borderColor: colors.accent,
    backgroundColor: colors.bgTertiary,
  },
  runHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  blanksLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  blankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  blankLabel: {
    width: 76,
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  blankInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    height: 38,
    paddingHorizontal: 11,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  itemList: {
    maxHeight: 320,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  itemContent: { flex: 1, gap: 1 },
  nestedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  itemTitle: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
  },
  itemTitleUnchecked: {
    color: colors.textSecondary,
  },
  itemSub: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  anchorlessHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    textAlign: 'center',
  },
  applyBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    margin: spacing.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  applyBtnDisabled: {
    backgroundColor: colors.bgTertiary,
  },
  applyBtnText: {
    color: colors.onAccent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  applyBtnTextDisabled: {
    color: colors.textTertiary,
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
