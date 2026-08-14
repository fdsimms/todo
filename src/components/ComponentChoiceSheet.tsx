import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Recipe } from '../types';
import { RECIPE_CHOICE_GROUP_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { cleanChoiceGroup } from '../utils/recipeUtils';
import type { ResolvedComponent } from '../utils/recipeComponents';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';
import { SegmentedControl } from './SegmentedControl';
import { PillGroup } from './PillGroup';

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
 * **The label is the grouping**, so this is a closed on/off track — the same
 * `SegmentedControl` + `PillGroup` pair the ingredient sheet's own alternatives
 * card uses — with the recipe's existing labels offered as pills rather than a
 * picker over some separate list of groups: a group has no existence apart from
 * the components filed under it, so there is nothing to create or delete.
 * Deliberately not a bare "Alternative for" text field any more — that box held
 * a *grouping key*, which meant the first component in a pair had to be filed
 * as an alternative for itself, a question nobody could answer without knowing
 * the data model.
 */
export function ComponentChoiceSheet({ visible, recipe, component, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const setComponentChoiceGroup = useRecipeStore(s => s.setComponentChoiceGroup);
  const makeComponentDefault = useRecipeStore(s => s.makeComponentDefault);

  const [label, setLabel] = useState('');
  // Held apart from the label for the same reason the ingredient sheet keeps
  // them separate: "one of a choice, group not named yet" is a real state, and
  // deriving this from the label would snap the control straight back to
  // "Always included" the moment someone opens the picker with no groups yet.
  const [choiceOn, setChoiceOn] = useState(false);

  useEffect(() => {
    if (component) {
      setLabel(component.component.choiceGroup ?? '');
      setChoiceOn(!!component.component.choiceGroup);
    }
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
        <Text style={styles.groupLabel}>Alternatives</Text>
        <SegmentedControl
          label="Alternatives"
          value={choiceOn ? 'choice' : 'always'}
          onChange={next => {
            haptics.tap();
            animateLayout();
            setChoiceOn(next === 'choice');
            if (next === 'always') setLabel('');
            // Joining the recipe's only existing group is the overwhelmingly
            // common intent, and it saves a tap — same call the ingredient
            // sheet's own version of this toggle makes.
            else if (!label) setLabel(existingLabels[0] ?? '');
          }}
          options={[
            { value: 'always', label: 'Always included' },
            { value: 'choice', label: 'One of a choice' },
          ]}
        />
        {choiceOn ? (
          <>
            <PillGroup
              noun="group"
              surface="card"
              filterPlaceholder="Find or name a group…"
              createMaxLength={RECIPE_CHOICE_GROUP_MAX_LENGTH}
              onCreate={value => {
                const cleaned = cleanChoiceGroup(value);
                if (!cleaned) return 'Give the group a name.';
                setLabel(cleaned);
              }}
              options={[
                // A group named on this component and nowhere else yet has no
                // pill of its own in the list below, so it gets a pinned one —
                // otherwise the label just typed is stored and invisible.
                ...(!clean || existingLabels.includes(clean)
                  ? []
                  : [{
                      key: '__current__',
                      label: clean,
                      pinned: true,
                      selected: true,
                      onPress: () => {},
                    }]),
                ...existingLabels.map(existing => ({
                  key: existing,
                  label: existing,
                  selected: clean === existing,
                  onPress: () => { haptics.tap(); setLabel(existing); },
                })),
              ]}
            />
            {!clean ? (
              <Text style={styles.hint}>
                Name the group these alternatives share — “Side”, “Sauce”. Every component
                under it is one way of filling the same slot.
              </Text>
            ) : (
              <Text style={styles.hint}>
                Components sharing “{clean}” are alternatives — a meal cooks one of them, and
                only that one gets shopped for.
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.hint}>
            Every component is included unless it's one of a choice. Two components in the
            same group mean a meal cooks one of them, picked when it's planned.
          </Text>
        )}
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
  defaultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  defaultText: { color: colors.text, fontSize: font.sm },
  defaultActionText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  hint: { color: colors.textTertiary, fontSize: font.xs, lineHeight: font.xs * 1.4 },
});
