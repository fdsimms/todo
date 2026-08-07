import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Animated,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { categoryLabel } from '../utils/categoryLabel';
import { formatOffsetWithAnchor } from '../utils/templateUtils';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useShallow } from 'zustand/react/shallow';
import type { Priority, TemplateAnchor, TemplateItem } from '../types';
import { PRIORITY_COLORS, TITLE_MAX_LENGTH } from '../types';

/** Same short labels the main quick add uses, so the two priority rows read alike. */
const PRIORITY_LABELS_SHORT = ['None', 'Low', 'Med', 'High', 'Urgent'] as const;

type ActivePanel = 'when' | 'priority' | 'category' | null;

interface Props {
  visible: boolean;
  templateId: string;
  /** Named on the chip above the field so it's obvious what's being added to. */
  templateName: string;
  onClose: () => void;
  /** Hand off to the full TemplateItemEditor pre-filled with what's entered so far. */
  onOpenFull: (draft: Partial<TemplateItem>) => void;
  /** Close this sheet and open the nested-template picker instead of adding a plain item. */
  onAddNested: () => void;
  onCreated?: (item: TemplateItem) => void;
}

/**
 * Quick add for a template item — the same sheet as QuickAddModal /
 * QuickAddNameSheet, with the template's own fields on the toolbar: a centered
 * card that springs in over a blurred backdrop, a title field with the round
 * accent submit button beside it, icon-only attribute chips that grow a label
 * once set, and inline panels under them.
 *
 * Two mechanics come with that shell and are load-bearing, not decoration:
 *
 * - **The keyboard is answered by an Animated offset, not a
 *   KeyboardAvoidingView.** This sheet used to be bottom-anchored inside a
 *   `KeyboardAvoidingView`, which is the one layout in the app that can leave
 *   its own confirm button under the keyboard.
 * - **`animationType="none"`, with the fade driven here.** Handing off to the
 *   full editor or the nested-template picker presents a `pageSheet` Modal the
 *   moment this one closes; a UIKit-animated dismissal is still in flight at
 *   that point and the presentation is silently dropped, so "More details" and
 *   "Nest a template" did nothing at all. `dismiss(after)` runs the handoff
 *   after this sheet has gone, exactly as QuickAddNameSheet does.
 */
export function TemplateItemQuickAdd({ visible, templateId, templateName, onClose, onOpenFull, onAddNested, onCreated }: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const addItem = useTemplateStore(s => s.addItem);
  const inputRef = useRef<TextInput>(null);

  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const translateYAnim = useRef(new Animated.Value(16)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // The sheet glides to its new centered resting spot on its own spring rather
  // than tracking the keyboard 1:1 — same as the other quick adds.
  const keyboardOffsetAnim = useRef(new Animated.Value(0)).current;

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const [category, setCategory] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<TemplateAnchor>('start');
  const [dueOffsetDays, setDueOffsetDays] = useState<number | null>(null);
  const [optional, setOptional] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      Animated.spring(keyboardOffsetAnim, {
        toValue: -height / 2, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      Animated.spring(keyboardOffsetAnim, {
        toValue: 0, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setPriority(0);
    setCategory(null);
    setAnchor('start');
    setDueOffsetDays(null);
    setOptional(false);
    setActivePanel(null);
    scaleAnim.setValue(0.95);
    translateYAnim.setValue(16);
    sheetOpacity.setValue(0);
    backdropOpacity.setValue(0);
    keyboardOffsetAnim.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.spring(translateYAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start(() => {
      // Focus is deferred until the sheet has settled so the keyboard's own
      // slide-up doesn't fight the sheet's entrance.
      inputRef.current?.focus();
    });
  }, [visible]);

  /** Fades the sheet out, closes it, then runs `after` — see the note above. */
  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 120, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      scaleAnim.setValue(0.95);
      sheetOpacity.setValue(0);
      onClose();
      after?.();
    });
  };

  const togglePanel = (panel: ActivePanel) => {
    haptics.tap();
    setActivePanel(prev => (prev === panel ? null : panel));
  };

  const draft = (): Partial<TemplateItem> => ({
    title: title.trim(),
    priority,
    category,
    anchor,
    dueOffsetDays,
    optional,
  });

  const trimmedTitle = title.trim();

  const createItem = () => {
    if (!trimmedTitle) return;
    const created = addItem(templateId, draft());
    // Dismissing regardless is how an add that never happened came to look
    // exactly like one that did. Nothing was stored, so the sheet stays put
    // with the title intact rather than closing on a row that will never
    // appear (see addItem in useTemplateStore).
    if (!created) {
      haptics.error();
      Alert.alert(
        'Couldn’t add that item',
        'This template couldn’t be found, so nothing was saved. Go back to Templates and open it again, then retry.',
      );
      return;
    }
    haptics.success();
    animateLayout();
    onCreated?.(created);
    dismiss();
  };

  const handleOpenFull = () => {
    haptics.tap();
    const captured = draft();
    dismiss(() => onOpenFull(captured));
  };

  // No haptic here: openNestedPicker fires its own on the way in.
  const handleAddNested = () => dismiss(() => onAddNested());

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />
      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            shadows.sheet,
            {
              opacity: sheetOpacity,
              transform: [{ scale: scaleAnim }, { translateY: Animated.add(translateYAnim, keyboardOffsetAnim) }],
            },
          ]}
        >
          {/* Where this is going — the same chip the main quick add uses to
              name a placement, since the sheet otherwise says nothing about
              which template it belongs to. */}
          <View style={styles.seedRow}>
            <View style={styles.seedChip}>
              <Ionicons name="copy" size={13} color={colors.accent} />
              <Text style={styles.seedChipText} numberOfLines={1}>{templateName}</Text>
            </View>
          </View>

          {/* Title input row */}
          <View style={styles.row}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="New item…"
              placeholderTextColor={colors.textTertiary}
              maxLength={TITLE_MAX_LENGTH}
              returnKeyType="done"
              onSubmitEditing={createItem}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.addBtn, !trimmedTitle && styles.addBtnDisabled]}
              onPress={createItem}
              disabled={!trimmedTitle}
              accessibilityRole="button"
              accessibilityLabel="Add item"
            >
              <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
            </TouchableOpacity>
          </View>

          {/* Attribute toolbar — icon only until a value is set, then the value
              takes the chip's place. */}
          <View style={styles.toolbar}>
            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'when' && styles.toolChipActive, dueOffsetDays !== null && styles.toolChipSet]}
              onPress={() => togglePanel('when')}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={
                dueOffsetDays !== null
                  ? `Due: ${formatOffsetWithAnchor(dueOffsetDays, anchor)}`
                  : 'Set when this item is due'
              }
            >
              <Ionicons
                name="calendar-outline"
                size={13}
                color={dueOffsetDays !== null ? colors.accent : colors.textTertiary}
              />
              {dueOffsetDays !== null && (
                <Text style={[styles.toolChipText, styles.toolChipTextSet, styles.toolChipTextTruncate]} numberOfLines={1}>
                  {formatOffsetWithAnchor(dueOffsetDays, anchor)}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'priority' && styles.toolChipActive, priority > 0 && styles.toolChipSet]}
              onPress={() => togglePanel('priority')}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={priority > 0 ? `Priority: ${PRIORITY_LABELS_SHORT[priority]}` : 'Set priority'}
            >
              <View style={[styles.priorityDot, { backgroundColor: priority > 0 ? PRIORITY_COLORS[priority] : colors.textTertiary }]} />
              {priority > 0 && (
                <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                  {PRIORITY_LABELS_SHORT[priority]}
                </Text>
              )}
            </TouchableOpacity>

            {allCategories.length > 0 && (
              <TouchableOpacity
                style={[styles.toolChip, activePanel === 'category' && styles.toolChipActive, category !== null && styles.toolChipSet]}
                onPress={() => togglePanel('category')}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={category !== null ? `Category: ${categoryLabel(category, categories)}` : 'Set category'}
              >
                <Ionicons
                  name="folder-outline"
                  size={13}
                  color={category !== null ? colors.accent : colors.textTertiary}
                />
                {category !== null && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet, styles.toolChipTextTruncate]} numberOfLines={1}>
                    {categoryLabel(category, categories)}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* A toggle rather than a panel, so it keeps its word at all times —
                there's no glyph that says "skippable when the template runs". */}
            <TouchableOpacity
              style={[styles.toolChip, optional && styles.toolChipSet]}
              onPress={() => { haptics.tap(); setOptional(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityState={{ checked: optional }}
              accessibilityLabel="Optional"
              accessibilityHint="Optional items start unticked when the template is applied"
            >
              <Ionicons
                name="help-circle-outline"
                size={13}
                color={optional ? colors.accent : colors.textTertiary}
              />
              <Text style={[styles.toolChipText, optional && styles.toolChipTextSet]}>Optional</Text>
            </TouchableOpacity>
          </View>

          {/* Inline panels */}
          {activePanel === 'when' && (
            <View style={styles.panel}>
              <Text style={styles.panelHint}>
                Template items have no fixed date — they're offset from a date you pick when applying the template.
              </Text>
              <View style={styles.presetRow}>
                <TouchableOpacity
                  style={[styles.presetChip, dueOffsetDays === null && styles.presetChipActive]}
                  onPress={() => { haptics.tap(); setDueOffsetDays(null); }}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Text style={[styles.presetChipText, dueOffsetDays === null && styles.presetChipTextActive]}>
                    No date
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.presetChip, dueOffsetDays !== null && anchor === 'start' && styles.presetChipActive]}
                  onPress={() => { haptics.tap(); setAnchor('start'); setDueOffsetDays(d => d ?? 0); }}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Text style={[styles.presetChipText, dueOffsetDays !== null && anchor === 'start' && styles.presetChipTextActive]}>
                    From start date
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.presetChip, dueOffsetDays !== null && anchor === 'end' && styles.presetChipActive]}
                  onPress={() => { haptics.tap(); setAnchor('end'); setDueOffsetDays(d => d ?? 0); }}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Text style={[styles.presetChipText, dueOffsetDays !== null && anchor === 'end' && styles.presetChipTextActive]}>
                    From end date
                  </Text>
                </TouchableOpacity>
              </View>
              {dueOffsetDays !== null && (
                <View style={styles.intervalRow}>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => { haptics.tap(); setDueOffsetDays(d => (d ?? 0) - 1); }}
                    accessibilityRole="button"
                    accessibilityLabel="One day earlier"
                  >
                    <Ionicons name="remove" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.offsetValue}>{formatOffsetWithAnchor(dueOffsetDays, anchor)}</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => { haptics.tap(); setDueOffsetDays(d => (d ?? 0) + 1); }}
                    accessibilityRole="button"
                    accessibilityLabel="One day later"
                  >
                    <Ionicons name="add" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {activePanel === 'priority' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {([0, 1, 2, 3, 4] as Priority[]).map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.priorityChip,
                      priority === p && styles.priorityChipActive,
                      priority === p && p > 0 && { borderColor: PRIORITY_COLORS[p], backgroundColor: PRIORITY_COLORS[p] + '22' },
                    ]}
                    onPress={() => { haptics.tap(); setPriority(p); }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    {p > 0 && <View style={[styles.priorityChipDot, { backgroundColor: PRIORITY_COLORS[p] }]} />}
                    <Text style={[
                      styles.presetChipText,
                      priority === p && styles.presetChipTextActive,
                      priority === p && p > 0 && { color: PRIORITY_COLORS[p] },
                    ]}>
                      {PRIORITY_LABELS_SHORT[p]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {activePanel === 'category' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                <TouchableOpacity
                  style={[styles.presetChip, category === null && styles.presetChipActive]}
                  onPress={() => { haptics.tap(); setCategory(null); }}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Text style={[styles.presetChipText, category === null && styles.presetChipTextActive]}>None</Text>
                </TouchableOpacity>
                {allCategories.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.presetChip, category === cat && styles.presetChipActive]}
                    onPress={() => { haptics.tap(); setCategory(prev => (prev === cat ? null : cat)); }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.presetChipText, category === cat && styles.presetChipTextActive]}>
                      {categoryLabel(cat, categories)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Secondary actions — spelled out, since neither is guessable from an icon. */}
          <View style={styles.moreRow}>
            <TouchableOpacity
              style={styles.moreBtn}
              onPress={handleAddNested}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Add another template as an item"
            >
              <Ionicons name="git-branch-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.moreBtnText}>Nest a template</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreBtn}
              onPress={handleOpenFull}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Open the full editor with what's entered so far"
            >
              <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.moreBtnText}>More details</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    padding: spacing.md,
  },
  seedRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  seedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    maxWidth: '100%',
  },
  seedChipText: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: font.md,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  addBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: colors.bgTertiary,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  toolChipActive: {
    backgroundColor: colors.bgQuaternary,
  },
  toolChipSet: {
    backgroundColor: colors.accentSubtle,
  },
  toolChipText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  toolChipTextSet: {
    color: colors.accent,
  },
  toolChipTextTruncate: {
    maxWidth: 170,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  panel: {
    marginTop: spacing.sm,
  },
  panelHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  presetChipActive: {
    backgroundColor: colors.accent,
  },
  presetChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  presetChipTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.semibold,
  },
  priorityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  priorityChipActive: {
    backgroundColor: colors.bgQuaternary,
  },
  priorityChipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  intervalBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offsetValue: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  moreRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  moreBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
  },
  moreBtnText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
});
