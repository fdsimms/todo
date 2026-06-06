import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Task } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, type Colors } from '../theme';
import { tagColor } from '../utils/tagColor';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function FocusSelector({ visible, onClose }: Props) {
  const visibleTasks = useTaskStore(useShallow(s => s.visibleTasks()));
  const toggleFocus = useTaskStore(s => s.toggleFocus);
  const clearAllFocus = useTaskStore(s => s.clearAllFocus);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Local selection mirrors the store so changes are instant
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (visible) {
      setSelected(new Set(visibleTasks.filter(t => t.focused).map(t => t.id)));
    }
  }, [visible]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const apply = () => {
    // Sync local selection to store
    visibleTasks.forEach(t => {
      const shouldBeFocused = selected.has(t.id);
      if (t.focused !== shouldBeFocused) {
        toggleFocus(t.id);
      }
    });
    onClose();
  };

  const clearAll = () => {
    setSelected(new Set());
    clearAllFocus();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Pick your focus</Text>
          <TouchableOpacity onPress={apply} hitSlop={8}>
            <Text style={styles.done}>
              {selected.size > 0 ? `Focus (${selected.size})` : 'Done'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>
          Select the tasks you want to work on. Only these will appear in Focus.
        </Text>

        <FlatList
          data={visibleTasks}
          keyExtractor={t => t.id}
          renderItem={({ item }) => (
            <TaskSelectRow
              task={item}
              selected={selected.has(item.id)}
              onToggle={() => toggle(item.id)}
              colors={colors}
              styles={styles}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No visible tasks right now</Text>
            </View>
          }
        />

        {selected.size > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={clearAll}>
            <Text style={styles.clearText}>Clear all focus</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

function TaskSelectRow({
  task, selected, onToggle, colors, styles,
}: {
  task: Task;
  selected: boolean;
  onToggle: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, selected && styles.rowSelected]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
        {selected && <Ionicons name="checkmark" size={14} color={colors.text} />}
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>{task.title}</Text>
        {task.tags.length > 0 && (
          <View style={styles.rowTags}>
            {task.tags.slice(0, 3).map(tag => (
              <View key={tag} style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
            ))}
            <Text style={styles.rowTagText}>{task.tags[0]}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  title: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  cancel: { color: colors.accent, fontSize: font.md },
  done: { color: colors.accent, fontSize: font.md, fontWeight: '600' },
  hint: {
    color: colors.textTertiary, fontSize: font.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    lineHeight: 19,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  rowSelected: { backgroundColor: colors.bgSecondary },
  checkbox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: colors.bgQuaternary,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.accent, borderColor: colors.accent,
  },
  rowContent: { flex: 1, gap: 3 },
  rowTitle: { color: colors.text, fontSize: font.md },
  rowTags: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  rowTagText: { color: colors.textSecondary, fontSize: font.xs },
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { color: colors.textTertiary, fontSize: font.md },
  clearBtn: {
    marginHorizontal: spacing.md, marginBottom: 40, marginTop: spacing.sm,
    paddingVertical: 14, borderRadius: radius.md,
    backgroundColor: colors.bgTertiary, alignItems: 'center',
  },
  clearText: { color: colors.red, fontSize: font.md, fontWeight: '600' },
});
