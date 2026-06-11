import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useTemplateStore } from '../store/useTemplateStore';
import { resolveOffsetDate, formatOffsetLabel } from '../utils/templateUtils';
import { formatDueDate } from '../utils/dateUtils';
import { CalendarPicker } from './CalendarPicker';
import type { TaskTemplate, TemplateItem } from '../types';

interface Props {
  visible: boolean;
  template: TaskTemplate | null;
  onClose: () => void;
}

/** Sub-label for a checklist row: live dates when an anchor is set, offset labels otherwise. */
function itemSublabel(item: TemplateItem, anchor: Date | null): string | null {
  const parts: string[] = [];
  const due = resolveOffsetDate(anchor, item.dueOffsetDays);
  const defer = resolveOffsetDate(anchor, item.deferOffsetDays);
  if (due) {
    parts.push(`Due ${formatDueDate(due)}`);
  } else if (item.dueOffsetDays !== null) {
    parts.push(`Due ${formatOffsetLabel(item.dueOffsetDays).toLowerCase()}`);
  }
  if (defer) {
    parts.push(`Hidden until ${formatDueDate(defer)}`);
  } else if (item.deferOffsetDays !== null) {
    parts.push(`Hidden until ${formatOffsetLabel(item.deferOffsetDays).toLowerCase()}`);
  }
  if (item.timeSegments.length > 0) {
    parts.push(item.timeSegments.join(', '));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Bottom sheet for applying a template: pick an optional anchor date, toggle
 * which items to include (optional items start unchecked), then create them
 * all as real tasks.
 */
export function ApplyTemplateSheet({ visible, template, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const applyTemplate = useTemplateStore(s => s.applyTemplate);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && template) {
      // Non-optional items start checked; optional ones start unchecked.
      setSelectedIds(new Set(template.items.filter(i => !i.optional).map(i => i.id)));
      setAnchor(null);
      setShowCalendar(false);
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
        damping: 28,
        stiffness: 320,
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
  const openCalendar = () => {
    Animated.spring(translateY, {
      toValue: 700,
      damping: 28,
      stiffness: 320,
      useNativeDriver: true,
    }).start(() => {
      setShowCalendar(true);
    });
  };

  const restoreSheet = () => {
    setShowCalendar(false);
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
            damping: 22,
            stiffness: 300,
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

  const selectedCount = selectedIds.size;
  const anchorless = anchor === null && template.items.some(
    i => selectedIds.has(i.id) && (i.dueOffsetDays !== null || i.deferOffsetDays !== null)
  );

  const handleApply = () => {
    if (selectedCount === 0) return;
    haptics.success();
    applyTemplate(template.id, selectedIds, anchor);
    dismiss();
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

          {/* Anchor date */}
          <TouchableOpacity style={styles.anchorRow} onPress={openCalendar} activeOpacity={interaction.activeOpacity}>
            <Ionicons name="calendar-outline" size={18} color={anchor ? colors.accent : colors.textSecondary} />
            <View style={styles.anchorContent}>
              <Text style={styles.anchorLabel}>Anchor date</Text>
              {!anchor && <Text style={styles.anchorHint}>Item dates are relative to this day</Text>}
            </View>
            {anchor ? (
              <View style={styles.anchorValueRow}>
                <Text style={styles.anchorValue}>
                  {anchor.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
                <TouchableOpacity onPress={() => setAnchor(null)} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
            )}
          </TouchableOpacity>

          <View style={styles.inlineSep} />

          {/* Item checklist */}
          <ScrollView style={styles.itemList} bounces={false}>
            {template.items.map((item, idx) => {
              const checked = selectedIds.has(item.id);
              const sublabel = itemSublabel(item, anchor);
              return (
                <React.Fragment key={item.id}>
                  <TouchableOpacity
                    style={styles.itemRow}
                    onPress={() => toggleItem(item.id)}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Ionicons
                      name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={checked ? colors.accent : colors.textTertiary}
                    />
                    <View style={styles.itemContent}>
                      <Text style={[styles.itemTitle, !checked && styles.itemTitleUnchecked]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {sublabel && <Text style={styles.itemSub} numberOfLines={1}>{sublabel}</Text>}
                    </View>
                  </TouchableOpacity>
                  {idx < template.items.length - 1 && <View style={styles.inlineSep} />}
                </React.Fragment>
              );
            })}
          </ScrollView>

          {anchorless && (
            <Text style={styles.anchorlessHint}>
              No anchor date — scheduled items will be added without dates
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

      <CalendarPicker
        visible={showCalendar}
        value={anchor}
        mode="date"
        title="Anchor Date"
        onConfirm={date => {
          const noon = new Date(date);
          noon.setHours(12, 0, 0, 0);
          setAnchor(noon);
          restoreSheet();
        }}
        onCancel={restoreSheet}
      />
    </Modal>
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
  anchorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  anchorContent: { flex: 1 },
  anchorLabel: { color: colors.text, fontSize: font.md },
  anchorHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 1 },
  anchorValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  anchorValue: { color: colors.accent, fontSize: font.sm },
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
