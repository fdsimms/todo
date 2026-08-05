import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Keyboard,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import { PressableScale } from './PressableScale';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
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

const PRIORITY_LABELS_SHORT = ['None', 'P1', 'P2', 'P3', 'P4'] as const;

type ActivePanel = 'when' | 'priority' | 'category' | null;

interface Props {
  visible: boolean;
  templateId: string;
  /** Shown in the sheet's overline so it's obvious what's being added to. */
  templateName: string;
  onClose: () => void;
  /** Hand off to the full TemplateItemEditor pre-filled with what's entered so far. */
  onOpenFull: (draft: Partial<TemplateItem>) => void;
  /** Close this sheet and open the nested-template picker instead of adding a plain item. */
  onAddNested: () => void;
  onCreated?: (item: TemplateItem) => void;
}

/**
 * Trimmed sibling of QuickAddModal for adding a template item quickly, and
 * built on the same shape: title input, a row of labelled chips that each
 * open one inline panel, then explicitly labelled secondary actions. Every
 * control carries a word — an icon on its own never says what it does, and
 * the attribute lists (categories especially) stay behind their chip rather
 * than spilling across the sheet.
 */
export function TemplateItemQuickAdd({ visible, templateId, templateName, onClose, onOpenFull, onAddNested, onCreated }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const addItem = useTemplateStore(s => s.addItem);
  const inputRef = useRef<TextInput>(null);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const [category, setCategory] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<TemplateAnchor>('start');
  const [dueOffsetDays, setDueOffsetDays] = useState<number | null>(null);
  const [optional, setOptional] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setPriority(0);
      setCategory(null);
      setAnchor('start');
      setDueOffsetDays(null);
      setOptional(false);
      setActivePanel(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      Keyboard.dismiss();
    }
  }, [visible]);

  const togglePanel = (panel: ActivePanel) => {
    haptics.tap();
    animateLayout();
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

  const createItem = () => {
    if (!title.trim()) return;
    haptics.success();
    onCreated?.(addItem(templateId, draft()));
    onClose();
  };

  const handleOpenFull = () => {
    haptics.tap();
    onOpenFull(draft());
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <SafeBlurView
          intensity={30}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
          fallbackColor={colors.blurFallback}
        />
      </TouchableOpacity>
      <KeyboardAvoidingView
        style={styles.centerWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.overline} numberOfLines={1}>Add to {templateName}</Text>

          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="What needs doing?"
              placeholderTextColor={colors.textTertiary}
              maxLength={TITLE_MAX_LENGTH}
              returnKeyType="done"
              onSubmitEditing={createItem}
            />
          </View>

          {/* Attribute chips — each carries its own label, and opens one panel. */}
          <View style={styles.chipRow}>
            <Chip
              icon="calendar-outline"
              label="When"
              value={dueOffsetDays !== null ? formatOffsetWithAnchor(dueOffsetDays, anchor) : null}
              open={activePanel === 'when'}
              onPress={() => togglePanel('when')}
              colors={colors}
              styles={styles}
            />
            <Chip
              icon="flag-outline"
              iconColor={priority > 0 ? PRIORITY_COLORS[priority] : undefined}
              label="Priority"
              value={priority > 0 ? PRIORITY_LABELS_SHORT[priority] : null}
              open={activePanel === 'priority'}
              onPress={() => togglePanel('priority')}
              colors={colors}
              styles={styles}
            />
            {allCategories.length > 0 && (
              <Chip
                icon="folder-outline"
                label="Category"
                value={category ? categoryLabel(category, categories) : null}
                open={activePanel === 'category'}
                onPress={() => togglePanel('category')}
                colors={colors}
                styles={styles}
              />
            )}
            <Chip
              icon="help-circle-outline"
              label="Optional"
              value={optional ? 'Yes' : null}
              open={false}
              onPress={() => { haptics.tap(); setOptional(v => !v); }}
              colors={colors}
              styles={styles}
            />
          </View>

          {activePanel === 'when' && (
            <View style={styles.panel}>
              <Text style={styles.panelHint}>
                Template items have no fixed date — they're offset from a date you pick when applying the template.
              </Text>
              <View style={styles.panelChipRow}>
                <PanelChip
                  label="No date"
                  active={dueOffsetDays === null}
                  onPress={() => { haptics.tap(); setDueOffsetDays(null); }}
                  styles={styles}
                />
                <PanelChip
                  label="On start date"
                  active={dueOffsetDays !== null && anchor === 'start'}
                  onPress={() => { haptics.tap(); setAnchor('start'); setDueOffsetDays(0); }}
                  styles={styles}
                />
                <PanelChip
                  label="On end date"
                  active={dueOffsetDays !== null && anchor === 'end'}
                  onPress={() => { haptics.tap(); setAnchor('end'); setDueOffsetDays(0); }}
                  styles={styles}
                />
              </View>
              {dueOffsetDays !== null && (
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => { haptics.tap(); setDueOffsetDays(d => (d ?? 0) - 1); }}
                    accessibilityRole="button"
                    accessibilityLabel="One day earlier"
                  >
                    <Ionicons name="remove" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>{formatOffsetWithAnchor(dueOffsetDays, anchor)}</Text>
                  <TouchableOpacity
                    style={styles.stepperBtn}
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
              <View style={styles.panelChipRow}>
                {([0, 1, 2, 3, 4] as Priority[]).map(p => (
                  <PanelChip
                    key={p}
                    label={PRIORITY_LABELS_SHORT[p]}
                    active={priority === p}
                    dotColor={p > 0 ? PRIORITY_COLORS[p] : undefined}
                    onPress={() => { haptics.tap(); setPriority(p); }}
                    styles={styles}
                  />
                ))}
              </View>
            </View>
          )}

          {activePanel === 'category' && (
            <View style={styles.panel}>
              <ScrollView style={styles.panelScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                <View style={styles.panelChipRow}>
                  <PanelChip
                    label="None"
                    active={!category}
                    onPress={() => { haptics.tap(); setCategory(null); }}
                    styles={styles}
                  />
                  {allCategories.map(cat => (
                    <PanelChip
                      key={cat}
                      label={categoryLabel(cat, categories)}
                      active={category === cat}
                      onPress={() => { haptics.tap(); setCategory(cat); }}
                      styles={styles}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Secondary actions — spelled out, since neither is guessable from an icon. */}
          <View style={styles.secondaryRow}>
            <PressableScale
              style={styles.secondaryBtn}
              onPress={onAddNested}
              accessibilityLabel="Add another template as an item"
            >
              <Ionicons name="git-branch-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.secondaryBtnText}>Nest a template</Text>
            </PressableScale>
            <PressableScale
              style={styles.secondaryBtn}
              onPress={handleOpenFull}
              accessibilityLabel="Open the full editor with what's entered so far"
            >
              <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.secondaryBtnText}>More details</Text>
            </PressableScale>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity onPress={onClose} activeOpacity={interaction.activeOpacity} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <PressableScale
              onPress={createItem}
              disabled={!title.trim()}
              style={[styles.addBtn, !title.trim() && styles.addBtnDisabled]}
              accessibilityLabel="Add item"
              accessibilityState={{ disabled: !title.trim() }}
            >
              <Text style={styles.addBtnText}>Add item</Text>
            </PressableScale>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Toolbar chip: always shows its name, and its current value once set. */
function Chip({
  icon, iconColor, label, value, open, onPress, colors, styles,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
  label: string;
  value: string | null;
  open: boolean;
  onPress: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const set = value !== null;
  return (
    <PressableScale
      style={[styles.chip, open && styles.chipOpen, set && styles.chipSet]}
      onPress={onPress}
      accessibilityLabel={set ? `${label}: ${value}` : `Set ${label.toLowerCase()}`}
    >
      <Ionicons name={icon} size={13} color={iconColor ?? (set ? colors.accent : colors.textTertiary)} />
      <Text style={[styles.chipText, set && styles.chipTextSet]} numberOfLines={1}>
        {set ? value : label}
      </Text>
    </PressableScale>
  );
}

/** Option chip inside an open panel. */
function PanelChip({
  label, active, dotColor, onPress, styles,
}: {
  label: string;
  active: boolean;
  dotColor?: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <PressableScale
      style={[styles.panelChip, active && styles.panelChipActive, active && dotColor ? { borderColor: dotColor } : null]}
      onPress={onPress}
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      {dotColor && <View style={[styles.panelChipDot, { backgroundColor: dotColor }]} />}
      <Text style={[styles.panelChipText, active && styles.panelChipTextActive]}>{label}</Text>
    </PressableScale>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
  centerWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
    marginBottom: spacing.xs,
  },
  overline: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  inputRow: {
    backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  input: { color: colors.text, fontSize: font.md, paddingVertical: 0 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    maxWidth: '100%',
  },
  chipOpen: { backgroundColor: colors.bgQuaternary },
  chipSet: { backgroundColor: colors.accentSubtle },
  chipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium, flexShrink: 1 },
  chipTextSet: { color: colors.accent },
  panel: {
    backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    padding: spacing.sm, gap: spacing.sm,
  },
  panelHint: { color: colors.textTertiary, fontSize: font.xs, lineHeight: 16 },
  panelScroll: { maxHeight: 150 },
  panelChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  panelChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full, borderWidth: 1, borderColor: 'transparent',
    backgroundColor: colors.bgQuaternary,
  },
  panelChipActive: { backgroundColor: colors.accentSubtle, borderColor: colors.accent },
  panelChipDot: { width: 7, height: 7, borderRadius: 4 },
  panelChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  panelChipTextActive: { color: colors.accent, fontWeight: fontWeight.semibold },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.bgQuaternary, alignItems: 'center', justifyContent: 'center',
  },
  stepperValue: {
    flex: 1, textAlign: 'center',
    color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold,
  },
  secondaryRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.bgTertiary,
  },
  secondaryBtnText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  cancelText: { color: colors.textSecondary, fontSize: font.md },
  addBtn: {
    backgroundColor: colors.accent, borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
