import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Recipe } from '../types';
import { GROCERY_QUANTITY_MAX_LENGTH, RECIPE_CHOICE_GROUP_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, type Colors } from '../theme';
import { fieldWell } from '../theme/textStyles';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { cleanChoiceGroup } from '../utils/recipeUtils';
import type { ResolvedComponent } from '../utils/recipeComponents';
import { amountUsedCounts, makesText, makesUnitsFor, splitMakes } from '../utils/componentShares';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';
import { EditorSheet } from './EditorSheet';
import { SegmentedControl } from './SegmentedControl';
import { ChoiceMenuChip } from './ChoiceMenuChip';
import { TextField } from './TextField';
import { InlineAction } from './InlineAction';
import { PillGroup } from './PillGroup';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { HelpText } from './HelpText';
import { BUTTON_LABEL } from '../copy/shared';

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
export function ComponentChoiceSheet({ visible, recipe, component: liveComponent, onClose }: Props) {
  // Held past the host clearing it, so the `return null` below can't tear the
  // presented sheet out of the tree while it is still closing: every host
  // clears the component in the same commit that lowers `visible`, and that
  // unmount is the freeze CLAUDE.md's SheetModal notes describe.
  const component = useSheetSubject(liveComponent);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const setComponentChoiceGroup = useRecipeStore(s => s.setComponentChoiceGroup);
  const makeComponentDefault = useRecipeStore(s => s.makeComponentDefault);
  const setComponentAmountUsed = useRecipeStore(s => s.setComponentAmountUsed);
  const setRecipeYield = useRecipeStore(s => s.setRecipeYield);

  const [label, setLabel] = useState('');
  // Held apart from the label for the same reason the ingredient sheet keeps
  // them separate: "one of a choice, group not named yet" is a real state, and
  // deriving this from the label would snap the control straight back to
  // "Always included" the moment someone opens the picker with no groups yet.
  const [choiceOn, setChoiceOn] = useState(false);
  // Typed freely and saved with the label on the way out, like the group.
  const [amount, setAmount] = useState('');
  // What the used recipe makes, asked right here when the amount can't be
  // compared with it: the fix has to be where the problem shows, not on the
  // other recipe's page. A number and a unit picked from the ones that compare
  // with the amount (`makesUnitsFor`), saved onto that recipe's own Yield.
  const [makesNumber, setMakesNumber] = useState('');
  const [makesUnit, setMakesUnit] = useState<string | null>(null);

  useEffect(() => {
    if (component) {
      setLabel(component.component.choiceGroup ?? '');
      setChoiceOn(!!component.component.choiceGroup);
      setAmount(component.component.amountUsed ?? '');
      const saved = splitMakes(
        component.recipe?.recipeYield ?? null,
        makesUnitsFor(component.component.amountUsed ?? '')?.units ?? [],
      );
      setMakesNumber(saved?.number ?? '');
      setMakesUnit(saved?.unit ?? null);
    }
  }, [component?.component.id, visible]);

  // The recipe's other labels, so joining an existing group is a tap and can't
  // be misspelled into a lookalike group of one. Includes the recipe's
  // ingredient labels too — sharing one with "corn tortillas" is exactly how
  // a component becomes that ingredient's alternative (see recipeComponents.ts
  // on cross-type groups); the pill can't say which kind a label belongs to
  // any more than the picker itself distinguishes them once joined.
  const existingLabels = useMemo(() => {
    const labels: string[] = [];
    for (const c of recipe.components) {
      if (c.choiceGroup && c.id !== component?.component.id && !labels.includes(c.choiceGroup)) {
        labels.push(c.choiceGroup);
      }
    }
    for (const i of recipe.ingredients) {
      if (i.choiceGroup && !labels.includes(i.choiceGroup)) labels.push(i.choiceGroup);
    }
    return labels;
  }, [recipe.components, recipe.ingredients, component?.component.id]);

  // The ingredient this component's group already belongs to, if any — an
  // ingredient always wins an unresolved group over a component (see
  // resolveGroupWinners), so a mixed group's recipe-level default is always
  // this, never something "Make the default" below could move.
  const defaultIngredientName = useMemo(() => {
    const group = component?.component.choiceGroup;
    if (!group) return null;
    return recipe.ingredients.find(i => i.choiceGroup === group)?.name || null;
  }, [recipe.ingredients, component?.component.choiceGroup]);

  // Whether this component already wins its group by sitting first — the state
  // "Make the default" would move it to, so there'd be nothing to offer. Can
  // never be true for a mixed group: the ingredient side always wins first.
  const isDefault = useMemo(() => {
    const group = component?.component.choiceGroup;
    if (!group || defaultIngredientName) return false;
    return recipe.components.find(c => c.choiceGroup === group)?.id === component?.component.id;
  }, [recipe.components, component?.component.id, component?.component.choiceGroup, defaultIngredientName]);

  // Asked only while the saved yield can't take the amount, judged on what is
  // saved so the field doesn't vanish mid-word once the typed one fits.
  const asksMakes = !!component?.recipe && !amountUsedCounts(amount, component.recipe);
  const makesUnits = asksMakes ? makesUnitsFor(amount) : null;
  // A unit picked for an earlier amount may not fit this one ("cup" once the
  // amount says grams), so the pick falls back to the amount's own default.
  const unit = makesUnits && makesUnit && makesUnits.units.includes(makesUnit) ? makesUnit : makesUnits?.defaultUnit ?? null;
  const makes = makesUnits && unit ? makesText(makesNumber, unit) : null;

  const saveAndClose = () => {
    if (component) {
      setComponentChoiceGroup(recipe.id, component.component.id, cleanChoiceGroup(label));
      setComponentAmountUsed(recipe.id, component.component.id, amount);
      const part = component.recipe;
      if (part && makes && makes !== part.recipeYield) setRecipeYield(part.id, makes);
    }
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
        <SheetHeader
          bare
          title={name}
          numberOfLines={1}
          left={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={saveAndClose} minWidth={40} />}
          right={<View style={styles.headerSpacer} />}
        />
      }
    >
      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Amount used</Text>
        <View style={styles.well}>
          <TextField
            style={styles.amountInput}
            value={amount}
            onChangeText={setAmount}
            placeholder="e.g. 1 tbsp"
            placeholderTextColor={colors.textTertiary}
            maxLength={GROCERY_QUANTITY_MAX_LENGTH}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel={`Amount of ${name} this recipe uses`}
          />
        </View>
        {asksMakes && !makesUnits && (
          <Text style={styles.amountWarning}>
            Nutrition can’t measure “{amount.trim()}”, so it counts the whole batch.
          </Text>
        )}
        {makesUnits && unit && (
          <>
            <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>{name} makes</Text>
            {/* The number and its unit in one field, the unit a chip opening
                the menu every other amount-and-unit field in the app uses
                (DoseAmountField, UnitMenuChip): eight units in a segmented
                track read as eight equal choices and outweighed the number. */}
            <View style={styles.makesField}>
              <TextField
                style={styles.amountInput}
                value={makesNumber}
                onChangeText={setMakesNumber}
                placeholder="e.g. 3/4"
                placeholderTextColor={colors.textTertiary}
                maxLength={12}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
                accessibilityLabel={`How many ${unit} ${name} makes`}
              />
              {makesUnits.units.length > 1 ? (
                <ChoiceMenuChip
                  name="ComponentChoiceSheet makes unit"
                  noun="Unit"
                  groups={makesUnits.groups.map(g => ({
                    ...(g.heading ? { heading: g.heading } : {}),
                    options: g.units.map(u => ({ key: u, label: u })),
                  }))}
                  selectedKey={unit}
                  onSelect={setMakesUnit}
                />
              ) : (
                <Text style={styles.makesUnitWord}>{unit}</Text>
              )}
            </View>
            {!makes && (
              <Text style={styles.amountWarning}>Until this is filled in, nutrition counts the whole batch.</Text>
            )}
          </>
        )}
        <HelpText style={styles.hint}>
          How much of {name.toLowerCase()} goes into this recipe, like “1 tbsp”, “2 fillets” or
          “1/4” for a quarter of what it makes. Nutrition counts only this much. Leave it empty to
          count everything it makes.
        </HelpText>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Alternatives</Text>
        <SegmentedControl
          label="Alternatives"
          value={choiceOn ? 'choice' : 'always'}
          onChange={next => {
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
              <HelpText style={styles.hint}>
                Name the group these alternatives share, like “Side” or “Sauce”. Every option
                under it (an ingredient, another component, or both) is one way of filling the
                same slot.
              </HelpText>
            ) : recipe.ingredients.some(i => i.choiceGroup === clean) ? (
              <Text style={styles.hint}>
                “{clean}” already names an ingredient on this recipe. Sharing it makes this
                component an alternative to that ingredient: a meal buys the ingredient or cooks
                this instead, never both.
              </Text>
            ) : (
              <Text style={styles.hint}>
                Components sharing “{clean}” are alternatives: a meal cooks one of them, and
                only that one gets shopped for.
              </Text>
            )}
          </>
        ) : (
          <HelpText style={styles.hint}>
            Every component is included unless it’s one of a choice. Two components in the
            same group mean a meal cooks one of them, picked when it’s planned.
          </HelpText>
        )}
      </View>

      {!!clean && (
        <View style={styles.sectionCard}>
          <Text style={styles.groupLabel}>Default</Text>
          {defaultIngredientName ? (
            <View style={styles.defaultRow}>
              <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.accent} />
              <Text style={styles.defaultText}>{defaultIngredientName} is the usual choice for “{clean}”</Text>
            </View>
          ) : isDefault ? (
            <View style={styles.defaultRow}>
              <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.accent} />
              <Text style={styles.defaultText}>The usual choice for “{clean}”</Text>
            </View>
          ) : (
            <View style={styles.defaultRow}>
              <InlineAction
                label="Make this the usual choice"
                icon="checkmark-circle-outline"
                onPress={() => {
                  // Saves the label first: a component being moved into a group by
                  // this very sheet has no group to be promoted within yet.
                  setComponentChoiceGroup(recipe.id, component.component.id, clean);
                  makeComponentDefault(recipe.id, component.component.id);
                  onClose();
                }}
                accessibilityLabel={`Make ${name} the usual choice for ${clean}`}
              />
            </View>
          )}
          <Text style={styles.hint}>
            {defaultIngredientName
              ? `An ingredient sharing this group is always the default. Pick ${name} for one meal in the plan.`
              : 'What a planned meal uses until you pick something else for that night.'}
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
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerSpacer: { width: 40 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
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
  // The card is bgSecondary, so the field steps up to bgTertiary.
  well: { ...fieldWell(colors), marginTop: spacing.xs },
  amountInput: { flex: 1, color: colors.text, fontSize: font.md, padding: 0, minHeight: 44 },
  hint: { color: colors.textTertiary, fontSize: font.xs, lineHeight: font.xs * 1.4 },
  groupLabelSpaced: { marginTop: spacing.md },
  makesField: { ...fieldWell(colors), marginTop: spacing.xs, paddingLeft: spacing.md, paddingRight: spacing.xs, gap: spacing.sm },
  makesUnitWord: { color: colors.text, fontSize: font.md, paddingRight: spacing.smd },
  amountWarning: { color: colors.warningText, fontSize: font.xs, lineHeight: font.xs * 1.4, marginVertical: spacing.xs },
});
