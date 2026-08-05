import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useTaskStore } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useShallow } from 'zustand/react/shallow';
import type { Priority, TemplateItem } from '../types';
import { PRIORITY_COLORS, TITLE_MAX_LENGTH } from '../types';

interface Props {
  visible: boolean;
  templateId: string;
  onClose: () => void;
  /** Hand off to the full TemplateItemEditor pre-filled with what's entered so far. */
  onOpenFull: (draft: Partial<TemplateItem>) => void;
  /** Close this sheet and open the nested-template picker instead of adding a plain item. */
  onAddNested: () => void;
  onCreated?: (item: TemplateItem) => void;
}

/**
 * Trimmed sibling of QuickAddModal for adding a template item quickly: title
 * input plus a few quick pills (category, priority, a simple due-offset
 * toggle since template items work in offsets, not absolute dates). Mirrors
 * QuickAddModal's "expand to full editor" affordance via onOpenFull.
 */
export function TemplateItemQuickAdd({ visible, templateId, onClose, onOpenFull, onAddNested, onCreated }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const addItem = useTemplateStore(s => s.addItem);
  const inputRef = useRef<TextInput>(null);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const [category, setCategory] = useState<string | null>(null);
  const [onAnchorDay, setOnAnchorDay] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setPriority(0);
      setCategory(null);
      setOnAnchorDay(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      Keyboard.dismiss();
    }
  }, [visible]);

  const createItem = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    haptics.success();
    const created = addItem(templateId, {
      title: trimmed,
      priority,
      category,
      dueOffsetDays: onAnchorDay ? 0 : null,
    });
    onCreated?.(created);
    onClose();
  };

  const handleOpenFull = () => {
    onOpenFull({
      title: title.trim(),
      priority,
      category,
      dueOffsetDays: onAnchorDay ? 0 : null,
    });
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
          <View style={styles.inputRow}>
            <Ionicons name="add-circle-outline" size={20} color={colors.textTertiary} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Add a task…"
              placeholderTextColor={colors.textTertiary}
              maxLength={TITLE_MAX_LENGTH}
              returnKeyType="done"
              onSubmitEditing={createItem}
            />
            <TouchableOpacity onPress={onAddNested} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add nested template">
              <Ionicons name="git-branch-outline" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleOpenFull} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open full editor">
              <Ionicons name="expand-outline" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[styles.pill, onAnchorDay && styles.pillActive]}
              onPress={() => { haptics.tap(); setOnAnchorDay(v => !v); }}
            >
              <Ionicons name="calendar-outline" size={13} color={onAnchorDay ? colors.bg : colors.textSecondary} />
              <Text style={[styles.pillText, onAnchorDay && styles.pillTextActive]}>
                {onAnchorDay ? 'On anchor day' : 'No date'}
              </Text>
            </TouchableOpacity>
            {([0, 1, 2, 3, 4] as Priority[]).map(p => (
              <TouchableOpacity
                key={p}
                style={[
                  styles.pill,
                  priority === p && p === 0 && styles.pillActive,
                  priority === p && p > 0 && { backgroundColor: PRIORITY_COLORS[p] },
                ]}
                onPress={() => { haptics.tap(); setPriority(p); }}
              >
                <Text style={[styles.pillText, priority === p && styles.pillTextActive]}>
                  {p === 0 ? 'No priority' : `P${p}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {allCategories.length > 0 && (
            <View style={styles.pillRow}>
              <TouchableOpacity
                style={[styles.pill, !category && styles.pillActive]}
                onPress={() => setCategory(null)}
              >
                <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
              </TouchableOpacity>
              {allCategories.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.pill, category === cat && styles.pillActive]}
                  onPress={() => { haptics.tap(); setCategory(cat); }}
                >
                  <Text style={[styles.pillText, category === cat && styles.pillTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.footer}>
            <TouchableOpacity onPress={onClose} activeOpacity={interaction.activeOpacity}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={createItem}
              disabled={!title.trim()}
              activeOpacity={interaction.activeOpacity}
              style={[styles.addBtn, !title.trim() && styles.addBtnDisabled]}
            >
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
  centerWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  input: { flex: 1, color: colors.text, fontSize: font.md, paddingVertical: 0 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  pillActive: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  cancelText: { color: colors.textSecondary, fontSize: font.md },
  addBtn: {
    backgroundColor: colors.accent, borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: 8,
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: '600' },
});
