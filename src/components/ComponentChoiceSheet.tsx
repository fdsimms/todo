import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Recipe } from '../types';
import { RECIPE_CHOICE_GROUP_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { cleanChoiceGroup } from '../utils/recipeUtils';
import type { ResolvedComponent } from '../utils/recipeComponents';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';

interface Props {
  visible: boolean;
  /** The recipe holding the link — the parent, not the component's own recipe. */
  recipe: Recipe;
  component: ResolvedComponent | null;
  onClose: () => void;
}

/**
 * Makes one component an either/or alternative: "Side — mashed potatoes or
 * roasted potatoes", of which a given meal cooks one.
 *
 * **The label is the grouping**, so this is a text field with the recipe's
 * existing labels offered as pills rather than a picker over some separate list
 * of groups. Same shape as the ingredient sheet's Section field one card up, and
 * for the same reason: a group has no existence apart from the components filed
 * under it, so there is nothing to create or delete — typing "Side" on a second
 * component is what makes the two alternatives, and clearing it on the last one
 * is what dissolves the group.
 */
export function ComponentChoiceSheet({ visible, recipe, component, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const setComponentChoiceGroup = useRecipeStore(s => s.setComponentChoiceGroup);
  const makeComponentDefault = useRecipeStore(s => s.makeComponentDefault);

  const [label, setLabel] = useState('');

  useEffect(() => {
    if (component) setLabel(component.component.choiceGroup ?? '');
  }, [component?.component.id, visible]);

  // The recipe's other labels, so joining an existing group is a tap and can't
  // be misspelled into a lookalike group of one.
  const existingLabels = useMemo(() => {
    const labels: string[] = [];
    for (const c of recipe.components) {
      if (c.choiceGroup && c.id !== component?.component.id && !labels.includes(c.choiceGroup)) {
        labels.push(c.choiceGroup);
      }
    }
    return labels;
  }, [recipe.components, component?.component.id]);

  // Whether this component already wins its group by sitting first — the state
  // "Make the default" would move it to, so there'd be nothing to offer.
  const isDefault = useMemo(() => {
    const group = component?.component.choiceGroup;
    if (!group) return false;
    return recipe.components.find(c => c.choiceGroup === group)?.id === component?.component.id;
  }, [recipe.components, component?.component.id, component?.component.choiceGroup]);

  const saveAndClose = () => {
    if (component) setComponentChoiceGroup(recipe.id, component.component.id, cleanChoiceGroup(label));
    onClose();
  };

  if (!component) return null;

  const name = component.name || 'This component';
  const clean = cleanChoiceGroup(label);

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} minWidth={40} />
          <Text style={styles.headerTitle} numberOfLines={1}>{name}</Text>
          <View style={styles.headerSpacer} />
        </>
      }
    >
      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Alternative for</Text>
        <TextInput
          style={styles.input}
          value={label}
          onChangeText={setLabel}
          placeholder="Side"
          placeholderTextColor={colors.textTertiary}
          maxLength={RECIPE_CHOICE_GROUP_MAX_LENGTH}
          autoCapitalize="sentences"
          accessibilityLabel="Choice group"
        />
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={[styles.pill, !clean && styles.pillActive]}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setLabel(''); }}
            accessibilityRole="button"
            accessibilityState={{ selected: !clean }}
            accessibilityLabel="Always included"
          >
            <Text style={[styles.pillText, !clean && styles.pillTextActive]}>Always included</Text>
          </TouchableOpacity>
          {existingLabels.map(existing => (
            <TouchableOpacity
              key={existing}
              style={[styles.pill, clean === existing && styles.pillActive]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setLabel(existing); }}
              accessibilityRole="button"
              accessibilityState={{ selected: clean === existing }}
              accessibilityLabel={existing}
            >
              <Text style={[styles.pillText, clean === existing && styles.pillTextActive]}>{existing}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>
          Components sharing a label are alternatives — a meal cooks one of them, and only
          that one gets shopped for. Leave it on “Always included” for a part that's in every
          time.
        </Text>
      </View>

      {!!clean && (
        <View style={styles.sectionCard}>
          <Text style={styles.groupLabel}>Default</Text>
          {isDefault ? (
            <View style={styles.defaultRow}>
              <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.accent} />
              <Text style={styles.defaultText}>The usual choice for “{clean}”</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.defaultRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => {
                haptics.tap();
                // Saves the label first: a component being moved into a group by
                // this very sheet has no group to be promoted within yet.
                setComponentChoiceGroup(recipe.id, component.component.id, clean);
                makeComponentDefault(recipe.id, component.component.id);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Make ${name} the usual choice for ${clean}`}
            >
              <Ionicons name="ellipse-outline" size={iconSize.sm} color={colors.textTertiary} />
              <Text style={styles.defaultActionText}>Make this the usual choice</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.hint}>
            What a planned meal uses until you pick something else for that night.
          </Text>
        </View>
      )}
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 40 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  input: { color: colors.text, fontSize: font.md, minHeight: 36 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingVertical: spacing.xs },
  pill: { backgroundColor: colors.bgTertiary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  pillActive: { backgroundColor: colors.accent },
  pillText: { color: colors.textSecondary, fontSize: font.sm },
  pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.medium },
  defaultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  defaultText: { color: colors.text, fontSize: font.sm },
  defaultActionText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  hint: { color: colors.textTertiary, fontSize: font.xs, lineHeight: font.xs * 1.4 },
});
