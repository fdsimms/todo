import React, { useRef, useEffect, useMemo } from 'react';
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
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useShallow } from 'zustand/react/shallow';
import { useTemplateStore } from '../store/useTemplateStore';
import { useTemplateCategoryStore } from '../store/useTemplateCategoryStore';
import { groupTemplatesByCategory } from '../utils/templateGrouping';
import type { TaskTemplate } from '../types';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the picked template after the sheet has slid away, so the apply sheet doesn't overlap it. */
  onSelect: (template: TaskTemplate) => void;
}

/**
 * Step one of applying a template from Today's add menu: pick which template,
 * grouped by category the same way the Templates screen lists them. Choosing
 * one dismisses this sheet and hands off to ApplyTemplateSheet, which is where
 * the anchor dates and item checklist live. Empty templates are shown disabled
 * — there'd be nothing to check off in the next step.
 */
export function TemplatePickerSheet({ visible, onClose, onSelect }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const templates = useTemplateStore(useShallow(s => s.templates));
  const templateCategories = useTemplateCategoryStore(useShallow(s => s.categories));

  const categoryOrder = useMemo(
    () => [...templateCategories].sort((a, b) => a.sortOrder - b.sortOrder).map(c => c.name),
    [templateCategories]
  );
  const listItems = useMemo(
    () => groupTemplatesByCategory(templates, categoryOrder),
    [templates, categoryOrder]
  );

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(hiddenY);
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
  }, [visible]);

  const dismiss = (after?: () => void) => {
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

  const handleSelect = (template: TaskTemplate) => {
    haptics.tap();
    dismiss(() => onSelect(template));
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sheetTitle}>Add from a template</Text>

          {templates.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="copy-outline" size={28} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No templates yet</Text>
              <Text style={styles.emptySub}>
                Build a reusable checklist under More › Templates, then add it all here in one tap
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.list} bounces={false}>
              {listItems.map((item, idx) => {
                if (item.type === 'header') {
                  return (
                    <Text key={item.key} style={styles.sectionHeader}>
                      {item.label}
                    </Text>
                  );
                }
                const tpl = item.template;
                const empty = tpl.items.length === 0;
                const prev = listItems[idx - 1];
                return (
                  <React.Fragment key={item.key}>
                    {prev?.type === 'template' && <View style={styles.inlineSep} />}
                    <TouchableOpacity
                      style={[styles.row, empty && styles.rowDisabled]}
                      onPress={() => handleSelect(tpl)}
                      disabled={empty}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={tpl.name}
                      accessibilityState={{ disabled: empty }}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: colors.accent + '22' }]}>
                        <Ionicons name="copy" size={16} color={empty ? colors.textTertiary : colors.accent} />
                      </View>
                      <View style={styles.rowInfo}>
                        <Text style={styles.rowName} numberOfLines={1}>{tpl.name}</Text>
                        <Text style={styles.rowHint}>
                          {empty ? 'No items' : `${tpl.items.length} item${tpl.items.length === 1 ? '' : 's'}`}
                        </Text>
                      </View>
                      {!empty && <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })}
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
  list: {
    maxHeight: 380,
  },
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowDisabled: { opacity: 0.5 },
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
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  emptySub: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
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
