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
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useTemplateStore } from '../store/useTemplateStore';
import { resolveOffsetDate, formatOffsetLabel, anchorLabel, type TemplateAnchors } from '../utils/templateUtils';
import { formatDueDate } from '../utils/dateUtils';
import { CalendarPicker } from './CalendarPicker';
import type { TaskTemplate, TemplateItem } from '../types';

interface Props {
  visible: boolean;
  template: TaskTemplate | null;
  onClose: () => void;
}

/** Sub-label for a checklist row: live dates when its anchor is set, offset labels otherwise. */
function itemSublabel(item: TemplateItem, anchors: TemplateAnchors): string | null {
  const parts: string[] = [];
  const anchor = item.anchor === 'end' ? anchors.end : anchors.start;
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
  if ((item.dueOffsetDays !== null || item.deferOffsetDays !== null) && !anchor) {
    parts.push(`from ${anchorLabel(item.anchor).toLowerCase()}`);
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
  const [startAnchor, setStartAnchor] = useState<Date | null>(null);
  const [endAnchor, setEndAnchor] = useState<Date | null>(null);
  const [calendarTarget, setCalendarTarget] = useState<'start' | 'end' | null>(null);
  const anchors: TemplateAnchors = { start: startAnchor, end: endAnchor };

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && template) {
      // Non-optional items start checked; optional ones start unchecked.
      setSelectedIds(new Set(template.items.filter(i => !i.optional).map(i => i.id)));
      setStartAnchor(null);
      setEndAnchor(null);
      setCalendarTarget(null);
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
  const openCalendar = (target: 'start' | 'end') => {
    Animated.spring(translateY, {
      toValue: 700,
      damping: 28,
      stiffness: 320,
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
  const anchorless = template.items.some(i => {
    if (!selectedIds.has(i.id)) return false;
    if (i.dueOffsetDays === null && i.deferOffsetDays === null) return false;
    return i.anchor === 'end' ? endAnchor === null : startAnchor === null;
  });

  const handleApply = () => {
    if (selectedCount === 0) return;
    haptics.success();
    applyTemplate(template.id, selectedIds, anchors);
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

          {/* Anchor dates */}
          <AnchorRow
            icon="play-outline"
            label="Start date"
            hint="Items anchored to the start are relative to this day"
            value={startAnchor}
            onPress={() => openCalendar('start')}
            onClear={() => setStartAnchor(null)}
            colors={colors}
            styles={styles}
          />
          <View style={styles.inlineSep} />
          <AnchorRow
            icon="flag-outline"
            label="End date"
            hint="Items anchored to the end are relative to this day"
            value={endAnchor}
            onPress={() => openCalendar('end')}
            onClear={() => setEndAnchor(null)}
            colors={colors}
            styles={styles}
          />

          <View style={styles.inlineSep} />

          {/* Item checklist */}
          <ScrollView style={styles.itemList} bounces={false}>
            {template.items.map((item, idx) => {
              const checked = selectedIds.has(item.id);
              const sublabel = itemSublabel(item, anchors);
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

      <CalendarPicker
        visible={calendarTarget !== null}
        value={calendarTarget === 'end' ? endAnchor : startAnchor}
        mode="date"
        title={calendarTarget === 'end' ? 'End Date' : 'Start Date'}
        onConfirm={date => {
          const noon = new Date(date);
          noon.setHours(12, 0, 0, 0);
          if (calendarTarget === 'end') setEndAnchor(noon);
          else setStartAnchor(noon);
          restoreSheet();
        }}
        onCancel={restoreSheet}
      />
    </Modal>
  );
}

/** One of the two anchor date pickers (start / end) shown atop the sheet. */
function AnchorRow({
  icon, label, hint, value, onPress, onClear, colors, styles,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  value: Date | null;
  onPress: () => void;
  onClear: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={styles.anchorRow} onPress={onPress} activeOpacity={interaction.activeOpacity}>
      <Ionicons name={icon} size={18} color={value ? colors.accent : colors.textSecondary} />
      <View style={styles.anchorContent}>
        <Text style={styles.anchorLabel}>{label}</Text>
        {!value && <Text style={styles.anchorHint}>{hint}</Text>}
      </View>
      {value ? (
        <View style={styles.anchorValueRow}>
          <Text style={styles.anchorValue}>
            {value.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
          <TouchableOpacity onPress={onClear} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      )}
    </TouchableOpacity>
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
