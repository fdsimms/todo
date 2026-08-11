import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  border,
  iconSize,
  interaction,
  checkboxRadius,
  type Colors,
} from '../theme';
import { formatOffsetLabel } from '../utils/templateUtils';
import { flattenRecipePrepTasks, type FlatPrepTask } from '../utils/recipeComponents';
import { SheetHeaderButton } from './SheetHeaderButton';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
  recipe: Recipe | null;
  recipesById: ReadonlyMap<string, Recipe>;
  onClose: () => void;
  /** Only the checked prep tasks — the caller adds them as real tasks. */
  onAdd: (prepTasks: FlatPrepTask[]) => void;
}

/**
 * Review-then-commit for a meal's prep tasks, the prep-task sibling of
 * RecipeToListSheet — same reason it exists: `addPrepTasksForSelected` used
 * to add every prep task on the recipe in one shot with no way to skip one,
 * the same "blind add everything" RecipeToListSheet replaced for
 * ingredients. Every task starts ticked, so a tap on "Add prep tasks" with
 * nothing unchecked behaves exactly as the old blind add did.
 */
export function PrepTasksReviewSheet({ visible, recipe, recipesById, onClose, onAdd }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const prepTasks = useMemo(
    () => (recipe ? flattenRecipePrepTasks(recipe, recipesById) : []),
    [recipe, recipesById]
  );

  const [ticked, setTicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setTicked(new Set(prepTasks.map(p => p.prepTask.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (id: string) => {
    haptics.tap();
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    const chosen = prepTasks.filter(p => ticked.has(p.prepTask.id));
    if (chosen.length === 0) {
      Alert.alert('Nothing to add', 'No prep tasks are checked.');
      return;
    }
    onAdd(chosen);
    onClose();
  };

  const addCount = ticked.size;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={72} />
          <Text style={styles.headerTitle} numberOfLines={1}>Prep tasks</Text>
          <SheetHeaderButton
            label={addCount > 0 ? `Add ${addCount}` : 'Add'}
            onPress={handleAdd}
            disabled={addCount === 0}
            minWidth={72}
          />
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.card}>
            {prepTasks.map((p, i) => {
              const on = ticked.has(p.prepTask.id);
              return (
                <React.Fragment key={p.prepTask.id}>
                  {i > 0 && <View style={styles.sep} />}
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => toggle(p.prepTask.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${p.prepTask.title}, ${formatOffsetLabel(p.prepTask.offsetDays)}`}
                  >
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>
                      {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
                    </View>
                    <View style={styles.body}>
                      <Text style={styles.name} numberOfLines={1}>{p.prepTask.title}</Text>
                      {p.recipe.id !== recipe?.id && (
                        <Text style={styles.sources} numberOfLines={1}>{p.recipe.name}</Text>
                      )}
                    </View>
                    <View style={styles.offsetPill}>
                      <Text style={styles.offsetText} numberOfLines={1}>
                        {formatOffsetLabel(p.prepTask.offsetDays)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + CHECKBOX_SIZE + spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: checkboxRadius(CHECKBOX_SIZE),
    borderWidth: border.md,
    borderColor: colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  body: { flex: 1, gap: 2 },
  name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  sources: { fontSize: font.xs, color: colors.textTertiary },
  offsetPill: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: 120,
  },
  offsetText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
});
