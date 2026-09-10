import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, NUTRIENT_KEYS, type MealSlot } from '../types';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { describeAIError, estimateMealNutrition } from '../services/aiSuggestions';
import {
  ESTIMATE_DESCRIPTION_MAX_LENGTH,
  describeEstimate,
  estimateToPanel,
  refineDescription,
  type NutritionEstimate,
} from '../utils/nutritionEstimate';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { groceryNameKey } from '../utils/groceryParse';
import { haptics } from '../utils/haptics';
import { InlineAction } from './InlineAction';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';

/**
 * "Cheeseburger and fries at Five Guys", read into figures to confirm.
 *
 * **The estimate is a proposal until somebody taps Log.** Nothing is written
 * before that, which is the rule the whole feature rests on rather than a
 * nicety: `docs/arch/health-data.md` licenses a dietary figure on it having
 * been entered by a person, and an estimate stored unconfirmed breaks exactly
 * that argument. The figures are on screen, itemised, before the tap. Same
 * call `sharedRecipeLinks` makes about a page waiting to be imported rather
 * than importing itself.
 *
 * **What the estimate claims is said in words beside it.** A chain's published
 * figures and a guess at a pub burger are different claims, and rendering a
 * bare number for both would present the second as the first. That sentence is
 * `describeEstimate`, which is a pure function so the rule that it never
 * advises is checkable rather than merely intended.
 *
 * **It offers a recipe before it estimates one.** If the description matches
 * something in the recipe box, that is real data the user already owns and it
 * beats a guess. The offer is a row, not a substitution: they may have eaten
 * out and named the dish the same thing.
 *
 * **Questions are asked, then skippable.** One or two, only where the answer
 * moves the figures a lot, and skipping simply leaves them out of the re-ask.
 * That is deliberately unlike `templateQuestions`, where every question has a
 * fallback answer because it fills a blank that must have a value; these only
 * narrow a re-ask, so unanswered is a meaningful state rather than a third one
 * for every reader to handle.
 *
 * The description typed here is staged before an explicit Log, so the swipe
 * down is guarded.
 */

interface Props {
  visible: boolean;
  /** Which meal it lands in, chosen by the section the estimate was started from. */
  slot: MealSlot | null;
  /** The logical day being logged, so a backdated estimate lands where it is shown. */
  at: Date;
  onClose: () => void;
  /** Offered instead of estimating, when the description names one. See the note above. */
  onPickRecipe: (recipeId: string) => void;
}

export function EstimateMealSheet({ visible, slot, at, onClose, onPickRecipe }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const addEntry = useFoodLogStore(s => s.addEntry);
  const recipes = useRecipeStore(s => s.recipes);
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const addIngredientsFromText = useRecipeStore(s => s.addIngredientsFromText);

  const [description, setDescription] = useState('');
  const [estimate, setEstimate] = useState<NutritionEstimate | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosenSlot, setChosenSlot] = useState<MealSlot | null>(slot);
  // Which recipe this estimate was just filed as, so the button can turn into
  // a confirmation instead of offering to file the same thing twice. Reset
  // whenever the estimate itself changes, since a re-estimate or a fresh
  // description is a different candidate recipe.
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDescription('');
    setEstimate(null);
    setAnswers({});
    setLoading(false);
    setError(null);
    setChosenSlot(slot);
    setSavedRecipeId(null);
  }, [visible, slot]);

  // Real data the user already owns beats a guess, so a matching recipe is
  // offered before the request is made rather than after it comes back.
  const matches = useMemo(() => {
    const key = groceryNameKey(description);
    if (key.length < 3) return [];
    return recipes.filter(r => groceryNameKey(r.name).includes(key)).slice(0, 3);
  }, [description, recipes]);

  const run = async (text: string) => {
    setLoading(true);
    setError(null);
    setSavedRecipeId(null);
    try {
      setEstimate(await estimateMealNutrition(text));
    } catch (e) {
      setEstimate(null);
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleEstimate = () => {
    haptics.tap();
    setAnswers({});
    run(description);
  };

  // Re-asked rather than adjusted here: the model knows what a large changes
  // about a portion and this sheet does not, and scaling a published figure by
  // a guessed multiplier would turn a real number into an invented one.
  const handleAnswered = () => {
    if (!estimate) return;
    haptics.tap();
    run(refineDescription(
      description,
      estimate.questions.map(q => ({ prompt: q.prompt, answer: answers[q.prompt] ?? '' })),
    ));
  };

  const handleLog = () => {
    if (!estimate) return;
    const nutrition = estimateToPanel(estimate, at);
    if (!nutrition) { haptics.error(); return; }
    const written = addEntry({
      label: estimate.label,
      quantity: estimate.quantity,
      // No weight: a gram figure for a described meal would be one more
      // invented number with nothing to check it against.
      grams: null,
      nutrition,
      slot: chosenSlot,
      at,
    });
    if (!written) { haptics.error(); return; }
    haptics.success();
    onClose();
  };

  // Files the description as a recipe made of the lines it names, so it can be
  // logged again later without re-describing it. Deliberately not the
  // estimate's own total figures: those are a claim about *this* telling
  // ("typical for this dish", "a rough guess") and refining an existing
  // recipe's own nutrition every time it's re-logged is exactly what
  // recipeNutrition.ts already does from its ingredients — same pipeline
  // every other recipe goes through, not a second one for this sheet.
  // "Recipe" here means "a filed batch of ingredients", not "cookable": no
  // steps are written, same as any recipe nobody's added a method to yet.
  const handleSaveRecipe = () => {
    if (!estimate || !description.trim()) return;
    haptics.tap();
    const key = groceryNameKey(estimate.label);
    // The box refuses a name it already has (nameKey is UNIQUE) — land on
    // that recipe rather than failing, the same call InventRecipeSheet makes.
    const existing = recipes.find(r => r.nameKey === key);
    const recipe = existing ?? addRecipe(estimate.label);
    if (!recipe) { haptics.error(); return; }
    if (!existing) {
      const lines = description.split(',').map(s => s.trim()).filter(Boolean).join('\n');
      if (lines) addIngredientsFromText(recipe.id, lines);
    }
    setSavedRecipeId(recipe.id);
    haptics.success();
  };

  const handleCancel = () => {
    if (!description.trim() && !estimate) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const answered = estimate?.questions.some(q => answers[q.prompt]) ?? false;
  const shown = estimate ? NUTRIENT_KEYS.filter(k => estimate.amounts[k] !== undefined) : [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />
          <Text style={styles.headerTitle} numberOfLines={1}>Estimate a meal</Text>
          <SheetHeaderButton label="Log" onPress={handleLog} disabled={!estimate} minWidth={64} />
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Text style={styles.label}>WHAT DID YOU EAT?</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. cheeseburger and fries at Five Guys"
            placeholderTextColor={colors.textTertiary}
            maxLength={ESTIMATE_DESCRIPTION_MAX_LENGTH}
            multiline
            accessibilityLabel="What you ate"
          />
          <Text style={styles.hint}>
            Name the dish and the place if you know it. The figures come back as an
            estimate for you to check, and stay marked as one.
          </Text>

          {matches.length > 0 && !estimate && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>You have a recipe for this</Text>
              <Text style={styles.hint}>Its figures come from the ingredients rather than a guess.</Text>
              {matches.map(recipe => (
                <TouchableOpacity
                  key={recipe.id}
                  style={styles.recipeRow}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => { haptics.tap(); onPickRecipe(recipe.id); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Log ${recipe.name} instead`}
                >
                  <Text style={styles.recipeName}>{recipe.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.action, (!description.trim() || loading) && styles.actionOff]}
            activeOpacity={interaction.activeOpacity}
            disabled={!description.trim() || loading}
            onPress={handleEstimate}
            accessibilityRole="button"
            accessibilityLabel="Estimate this meal"
          >
            {loading
              ? <ActivityIndicator color={colors.onAccent} />
              : <Text style={styles.actionText}>{estimate ? 'Estimate again' : 'Estimate'}</Text>}
          </TouchableOpacity>

          {!!error && <Text style={styles.error}>{error}</Text>}

          {estimate && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{estimate.label}</Text>
              <Text style={styles.quantity}>{estimate.quantity}</Text>
              {/* What the figures claim, stated rather than implied. */}
              <Text style={styles.claim}>{describeEstimate(estimate)}</Text>

              {shown.map(key => (
                <View key={key} style={styles.figure}>
                  <Text style={styles.figureLabel}>{NUTRIENT_LABEL[key].label}</Text>
                  <Text style={styles.figureValue}>
                    {Math.round(estimate.amounts[key] as number).toLocaleString()}
                    {NUTRIENT_LABEL[key].unit === 'cal' ? ' cal' : NUTRIENT_LABEL[key].unit}
                  </Text>
                </View>
              ))}
              {/* Absent stays absent: a nutrient the model said nothing about
                  simply has no row, rather than a row reading zero. */}
              <Text style={styles.hint}>
                {shown.length === NUTRIENT_KEYS.length
                  ? 'Every nutrient stated.'
                  : `${shown.length} of ${NUTRIENT_KEYS.length} nutrients stated. The rest are unknown rather than zero.`}
              </Text>
              {savedRecipeId ? (
                <Text style={styles.hint}>Saved to your recipe box, so you can log this again later.</Text>
              ) : (
                <InlineAction
                  label="Save as a recipe"
                  onPress={handleSaveRecipe}
                  variant="neutral"
                  accessibilityLabel="Save this meal as a recipe you can log again"
                />
              )}
            </View>
          )}

          {estimate && estimate.questions.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>These would change the figures</Text>
              <Text style={styles.hint}>Answer what you know. Skipping any of them is fine.</Text>
              {estimate.questions.map(q => (
                <View key={q.prompt} style={styles.question}>
                  <Text style={styles.questionPrompt}>{q.prompt}</Text>
                  <View style={styles.options}>
                    {q.options.map(option => {
                      const on = answers[q.prompt] === option;
                      return (
                        <TouchableOpacity
                          key={option}
                          style={[styles.option, on && styles.optionOn]}
                          activeOpacity={interaction.activeOpacity}
                          onPress={() => {
                            haptics.tap();
                            // Tapping the chosen one again clears it, so an
                            // answer given by accident is one tap to take back.
                            setAnswers(a => ({ ...a, [q.prompt]: on ? '' : option }));
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`${q.prompt} ${option}`}
                        >
                          <Text style={[styles.optionText, on && styles.optionTextOn]}>{option}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
              <TouchableOpacity
                style={[styles.action, (!answered || loading) && styles.actionOff]}
                activeOpacity={interaction.activeOpacity}
                disabled={!answered || loading}
                onPress={handleAnswered}
                accessibilityRole="button"
                accessibilityLabel="Estimate again with these answers"
              >
                <Text style={styles.actionText}>Estimate again with these</Text>
              </TouchableOpacity>
            </View>
          )}

          {estimate && (
            <>
              <Text style={[styles.label, styles.labelSpaced]}>WHICH MEAL</Text>
              <SegmentedControl<MealSlot | null>
                options={[
                  ...MEAL_SLOTS.map(s => ({ value: s as MealSlot | null, label: MEAL_SLOT_LABELS[s] })),
                  { value: null, label: 'None' },
                ]}
                value={chosenSlot}
                onChange={setChosenSlot}
                columns={3}
                label="Which meal"
                surface="page"
              />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
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
    body: { flex: 1 },
    bodyContent: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    labelSpaced: { marginTop: spacing.md },
    input: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      color: colors.text,
      fontSize: font.md,
      minHeight: 76,
      textAlignVertical: 'top',
    },
    hint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    quantity: { color: colors.textSecondary, fontSize: font.sm },
    claim: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
    figure: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    figureLabel: { color: colors.text, fontSize: font.sm },
    figureValue: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
    question: { gap: spacing.sm },
    questionPrompt: { color: colors.text, fontSize: font.sm },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    option: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
    },
    optionOn: { backgroundColor: colors.accent },
    optionText: { color: colors.text, fontSize: font.sm },
    optionTextOn: { color: colors.onAccent, fontWeight: fontWeight.medium },
    action: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    actionOff: { opacity: interaction.activeOpacity * 0.6 },
    actionText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
    recipeRow: {
      paddingVertical: spacing.sm,
    },
    recipeName: { color: colors.accent, fontSize: font.sm },
    error: { color: colors.red, fontSize: font.sm, lineHeight: 18 },
  });
}
