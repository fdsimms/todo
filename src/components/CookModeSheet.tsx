// Cook mode: mise en place, then the method one step at a time. One component
// of ~1,000 lines, so grep a landmark below rather than reading it start to
// finish:
//
//   ==== <name> ====        the section banners through the logic half
//   ScreenAwake              the keep-awake helper, just below the component
//   makeStyles               styles, at the bottom
//
// The design argument is in the doc comment on CookModeSheet itself: nothing
// here writes to the recipe, and the whole screen is built around hands that
// are wet and a phone that's asleep.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Keyboard, Modal, View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Recipe } from '../types';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRecipeTimer } from '../hooks/useRecipeTimer';
import { useStepTimers } from '../hooks/useStepTimers';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { askCookQuestion, describeAIError } from '../services/aiSuggestions';
import {
  COOK_QUESTION_MAX_LENGTH, cookQuestionContext, suggestedCookQuestions,
} from '../utils/cookQuestions';
import { DetailHeader } from './DetailHeader';
import { EmptyState } from './EmptyState';
import { ProgressBar } from './ProgressBar';
import { RecipeTimerRow } from './RecipeTimerRow';
import { NumberPadAccessory } from './NumberPadAccessory';
import { StepTimerRow } from './StepTimerRow';
import { InlineAction } from './InlineAction';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, lineHeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { clampStepIndex, cookSteps, describeStepPosition } from '../utils/cookMode';
import { formatStepDuration, stepDurationOffers } from '../utils/stepTimers';
import { flattenRecipeIngredients } from '../utils/recipeComponents';
import { ingredientHeadings } from '../utils/recipeSections';
import { describeStandingSwap, standingSwapMap } from '../utils/standingSwaps';
import { onHandNameKeys } from '../utils/grocerySuggest';
import { formatScale, isUnscaled, scaleQuantity } from '../utils/recipeScale';
import { convertQuantity } from '../utils/unitConvert';

interface Props {
  visible: boolean;
  recipe: Recipe;
  recipesById: ReadonlyMap<string, Recipe>;
  /**
   * The factor the recipe is being read at, handed over from the screen that
   * opened this. Display only, like everywhere else a factor travels: cook mode
   * writes nothing, and halving a recipe to cook for one tonight is still not
   * an edit to the recipe (see MealPlanEntry.recipeScale for where it does last).
   */
  scale: number;
  onClose: () => void;
}

/**
 * Cook mode — the method one step at a time, with the screen kept awake and the
 * cook timer on screen throughout (#1695).
 *
 * The moment this exists for is the one with the worst ergonomics in the app:
 * hands wet, phone asleep, scrolling a blob of text to find where you were.
 * Every other kitchen surface here is built for *preparing* to cook — planning
 * a week, shopping for it, filing what came back. This is the twenty minutes of
 * actually doing it, and the whole design follows from that:
 *
 * - **`useKeepAwake` for as long as this is up, and no longer.** It's called
 *   from inside the Modal's own content (see `ScreenAwake`) rather than at the
 *   top of this component, because this component stays mounted with
 *   `visible={false}` and a lock taken then would hold the screen awake for the
 *   rest of the session.
 * - **One step, big.** `font.xxl` with a generous line height, so it reads from
 *   across a counter. A long step scrolls; the timer and the controls don't move
 *   when it does, because reaching for Pause shouldn't need aiming.
 * - **The cook timer is the recipe's own**, through `useRecipeTimer` and the
 *   same `RecipeTimerRow` the recipe screen draws — not a second stopwatch that
 *   looks like it. Starting one here and logging it there is the same timer.
 * - **The time a step names is offered as a timer of its own** (see
 *   `parseStepDurations`). The chips sit under the sentence they were read out
 *   of, because that's what makes it obvious the app didn't invent a number;
 *   the countdowns they start sit in the footer with the cook timer, because
 *   pressing Next must not take a running timer off screen. Nothing starts one
 *   unasked — the parse exists to make an offer, and a wrong reading costs a
 *   chip nobody presses.
 * - **Nothing here writes to the recipe.** Position and the ingredient panel's
 *   fold are screen state, gone when the modal closes; finishing the last step
 *   closes it and logs nothing, because logging the cook time is the timer's
 *   own ✓ and an app that banked a time nobody confirmed would be inventing
 *   one. A step timer is the one thing started here that outlives the sheet,
 *   and it is stored beside the recipe rather than on it — a countdown someone
 *   set for tonight's pan is not an edit to the dish, the same call `scale`
 *   makes.
 *
 * Quantities in the ingredient panel run through the active scale *and* the
 * `unitSystem` setting, in that order (exact multiplication, then the rounding
 * conversion) — a halved recipe has to read correctly mid-step, which is the
 * whole reason `Recipe.steps` is structured rather than a blob. The steps
 * themselves are shown exactly as written: nothing parses amounts back out of a
 * sentence, and per-step amounts wait for the ingredient references #1695
 * deliberately deferred.
 */
export function CookModeSheet({ visible, recipe, recipesById, scale, onClose }: Props) {
  // ==== store bindings and derived data: the method, the ingredients ====
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  // The step view holds the question field, so it has to lift clear of the
  // keyboard — and `automaticallyAdjustKeyboardInsets` is never passed bare
  // here, for the 30,000pt reason the hook's own doc comment gives.
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));

  // Only while this is actually up: the sheet stays mounted behind the recipe
  // screen with `visible` false, and a timer bound there would keep a
  // once-a-second interval — and a once-a-second re-render of a modal nobody
  // can see — running for as long as a cook timer does. The hook takes an
  // undefined recipe for exactly this.
  const cookTimer = useRecipeTimer(visible ? recipe : undefined, 'Cook');
  // Same `visible ?` guard and for the same reason — a sheet mounted invisible
  // must not hold a once-a-second interval open. Scoped to this recipe, so a
  // timer left running on another dish stays on that dish's screen.
  const stepTimers = useStepTimers(visible ? recipe.id : undefined);

  const standingSwaps = useMemo(
    () => standingSwapMap(itemSubs, groceryItems),
    [itemSubs, groceryItems]
  );
  // Live, not persisted — see recipeComponents.ts's ChoiceResolution.onHand.
  const onHand = useMemo(() => onHandNameKeys(groceryItems, new Date()), [groceryItems]);

  const steps = useMemo(
    () => cookSteps(recipe, recipesById),
    [recipe, recipesById]
  );
  const ingredients = useMemo(
    () => flattenRecipeIngredients(recipe, recipesById, { onHand }, standingSwaps),
    [recipe, recipesById, standingSwaps, onHand]
  );
  // Which headings each line opens: the component's name where one starts, and
  // the recipe's own section label where one does. Both are inferred from the
  // flat list rather than stored on it — see ingredientHeadings.
  const headings = useMemo(() => ingredientHeadings(ingredients), [ingredients]);

  // ==== screen state: where the cook is, the ask panel, the ingredient fold ====
  // Whether there's anything to gather before the method starts. A recipe
  // with a method but no ingredient lines (rare, but the two are independent
  // fields) has nothing for a mise en place screen to show.
  const hasIngredients = ingredients.length > 0;

  // -1 is the mise en place screen, ahead of step 0 — screen state like the
  // step position itself, reset the same way on close.
  const [rawIndex, setRawIndex] = useState(0);
  const [ingredientsOpen, setIngredientsOpen] = useState(false);
  // One question at a time, about the step on screen, and none of it outlives
  // that step: the answer is screen state like the position and the panel's
  // fold, and a step only gains a `note` when someone presses Keep. There is no
  // transcript on purpose — a scrolling log of turns is the shape this screen
  // was built to avoid, and the kept note is what a second cooking wants anyway.
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  // The method is read live off the store, so it can shrink underneath a cook
  // whose recipe is being edited on the screen behind this — clamping at read
  // time is what keeps a stale index off the end of it.
  const atMise = rawIndex === -1;
  const index = atMise ? -1 : clampStepIndex(rawIndex, steps.length);
  const step = index >= 0 ? steps[index] : null;

  // ==== effects: resetting on close, clearing the ask panel per step ====
  // Back to the top for the next open — the mise en place screen where there's
  // something to gather, step 1 where there isn't. A cooking is one sitting,
  // and handing someone step 6 of a dish they started yesterday is worse than
  // handing them the start. Reset on the way *out* rather than on the way in,
  // so the state is already clean before the first frame is drawn — resetting
  // on open would paint the old step for a frame first.
  useEffect(() => {
    if (!visible) {
      setRawIndex(hasIngredients ? -1 : 0);
      setIngredientsOpen(false);
    }
  }, [visible, hasIngredients]);

  // An answer belongs to the sentence it was given about, so moving off that
  // step takes it with it — including a half-typed question, which on the next
  // step would be a question about something else.
  const stepId = step?.id ?? null;
  useEffect(() => {
    setAskOpen(false);
    setQuestion('');
    setAsking(false);
    setAnswer(null);
    setAskError(null);
  }, [stepId]);

  // ==== the "ask about this step" flow ====
  // Read off the step being shown, and only that one: parsing the whole method
  // up front would cost every open of the sheet a pass over text nobody is
  // looking at, and the offer is only ever made about the step on screen.
  const offers = useMemo(() => (step === null ? [] : stepDurationOffers(step)), [step]);

  // Which engine would answer, so the entry point can't exist for a call that
  // would refuse — `routeForFeature` has no on-device arm for this one (a free
  // question over a whole ingredient list wants world knowledge and more window
  // than the on-device model has), so no key means no Ask button rather than a
  // button that apologises.
  const canAsk = useAiRoute('cookHelp') !== 'unavailable';
  const setStepNote = useRecipeStore(s => s.setStepNote);

  // Derived from the step's own words, with no round trip: typing a question
  // with wet hands is the thing worth saving, and paying a request to save a
  // request is not.
  const suggestions = useMemo(
    () => (step === null || !askOpen
      ? []
      : suggestedCookQuestions(step.text, ingredients.map(flat => flat.ingredient.name))),
    [step, askOpen, ingredients]
  );

  const ask = useCallback(async (text: string) => {
    const asked = text.trim();
    if (!asked || asking) return;
    const context = cookQuestionContext(recipe.name, steps, index, ingredients, scale, unitSystem);
    if (!context) return;
    haptics.tap();
    // The keyboard goes as the request does: the answer lands below the field
    // it was typed into, and a cook who has just asked is done typing.
    Keyboard.dismiss();
    setQuestion(asked);
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const reply = await askCookQuestion(context, asked);
      setAnswer(reply);
      haptics.success();
      // An answer arriving under a kept note, under the step, can land below
      // the fold with its own Keep button — which is the one control it came
      // with. Same delayed scroll the AI settings rows use, for the same
      // reason: the row has to be laid out before it can be scrolled to.
      setTimeout(() => keyboardScroll.ref.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      setAskError(describeAIError(e));
      haptics.error();
    } finally {
      setAsking(false);
    }
  }, [asking, recipe.name, steps, index, ingredients, scale, unitSystem, keyboardScroll.ref]);

  // ==== navigation: mise en place, then step to step ====
  const atLast = index >= 0 && index === steps.length - 1;

  const startCooking = () => {
    haptics.tap();
    setRawIndex(0);
  };

  const goBack = () => {
    haptics.tap();
    // Step 1's Back returns to the mise en place screen when there was one to
    // leave, rather than sitting disabled at the start of the method.
    if (index === 0 && hasIngredients) {
      setRawIndex(-1);
      return;
    }
    setRawIndex(Math.max(0, index - 1));
  };

  const goNext = () => {
    if (atLast) {
      haptics.success();
      onClose();
      return;
    }
    haptics.tap();
    setRawIndex(index + 1);
  };

  // ==== render. Everything below is JSX ====
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <ScreenAwake />
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <DetailHeader
          title={recipe.name}
          onBack={onClose}
          backIcon="close"
          backAccessibilityLabel="Leave cook mode"
          actions={
            // Only when it says something: at 1× the recipe is being read as
            // written, and a chip repeating that is chrome. When it isn't, this
            // is the one thing on screen explaining why the amounts in the panel
            // below aren't the recipe's own numbers.
            isUnscaled(scale) ? undefined : (
              <View style={styles.scaleChip}>
                <Text style={styles.scaleChipText}>{formatScale(scale)}</Text>
              </View>
            )
          }
        />

        {atMise ? (
          <ScrollView style={styles.stepScrollView} contentContainerStyle={styles.stepScroll}>
            <Text style={styles.miseTitle}>Mise en place</Text>
            <Text style={styles.miseSubtitle}>
              Everything this recipe needs, before you start cooking.
            </Text>
            <View style={styles.miseCard}>
              {ingredients.map((flat, position) => {
                // Same scale-then-convert pipeline the panel below runs, and
                // the same component grouping — this is that same list, just
                // read before the method rather than during it.
                const scaled = scaleQuantity(flat.ingredient.quantity, scale);
                const converted = convertQuantity(scaled.text, unitSystem);
                const marked = scaled.scaled || converted.converted || !!flat.swappedFrom;
                const previous = ingredients[position - 1];
                const heading =
                  flat.depth > 0 && previous?.recipe.id !== flat.recipe.id ? flat.recipe.name : null;
                const last = position === ingredients.length - 1;
                return (
                  <View key={`${flat.recipe.id}:${flat.ingredient.id}`}>
                    {!!heading && <Text style={styles.miseHeading}>{heading}</Text>}
                    <View style={[styles.miseRow, last && styles.miseRowLast]}>
                      <View style={styles.miseRowText}>
                        <Text style={styles.miseName}>{flat.ingredient.name}</Text>
                        {!!flat.swappedFrom && (
                          <Text style={styles.miseSwap} numberOfLines={1}>
                            {describeStandingSwap(flat.swappedFrom)}
                          </Text>
                        )}
                        {!!flat.ingredient.prep && (
                          <Text style={styles.misePrep}>{flat.ingredient.prep}</Text>
                        )}
                      </View>
                      {!!converted.text && (
                        <View style={[styles.miseQtyPill, marked && styles.miseQtyPillMarked]}>
                          <Text
                            style={[styles.miseQtyText, marked && styles.miseQtyTextMarked]}
                            numberOfLines={1}
                          >
                            {converted.text}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        ) : step === null ? (
          <EmptyState
            icon="book-outline"
            title="No method written down"
            subtitle="Add steps to this recipe, or write the method into its notes, and cook mode has something to read out."
          />
        ) : (
          <>
            <View style={styles.progress}>
              <Text style={styles.position}>{describeStepPosition(index, steps.length)}</Text>
              <ProgressBar progress={(index + 1) / steps.length} height={4} />
            </View>

            <ScrollView
              ref={keyboardScroll.ref}
              style={styles.stepScrollView}
              contentContainerStyle={styles.stepScroll}
              {...keyboardScroll.props}
            >
              {/* Whose step it is, and only when that isn't obvious. The walk
                  puts the root's steps first and each component's after, in
                  component order — the app has no way to know the mash wants
                  boiling before the steak is seared, so it says where the
                  boundary is rather than inventing a schedule across it. */}
              {!step.whole && (
                <View style={styles.attribution}>
                  <Ionicons name="layers-outline" size={iconSize.xs} color={colors.accent} />
                  <Text style={styles.attributionText} numberOfLines={1}>{step.recipe.name}</Text>
                </View>
              )}
              <Text style={styles.stepText}>{step.text}</Text>
              {/* Said out loud, because the split is the app's and not the
                  cook's: a recipe whose method lives in notes gets read as
                  steps here, and that has to be legible as a fallback rather
                  than as numbering someone wrote. */}
              {step.fromNotes && (
                <Text style={styles.fromNotes}>From this recipe’s notes</Text>
              )}

              {/* The offer, under the sentence it was read out of rather than
                  down in the footer: the number belongs to this step, and
                  attaching it to the text is what makes it obvious the app
                  didn't invent one. Starting it moves it to the footer, which
                  is the half that must not scroll away. */}
              {offers.length > 0 && (
                <View style={styles.offers}>
                  {offers.map(offer => (
                    <InlineAction
                      key={`${offer.start}:${offer.seconds}`}
                      icon="timer-outline"
                      label={`Set a ${formatStepDuration(offer.seconds)} timer`}
                      accessibilityLabel={`Set a ${formatStepDuration(offer.seconds)} timer for ${describeStepPosition(index, steps.length)}`}
                      onPress={() => stepTimers.start({
                        recipeId: recipe.id,
                        recipeName: recipe.name,
                        stepId: step.id,
                        stepLabel: describeStepPosition(index, steps.length),
                        durationSeconds: offer.seconds,
                      })}
                    />
                  ))}
                </View>
              )}
              {offers.some(offer => offer.maxSeconds !== null) && (
                <Text style={styles.offersNote}>
                  Where the step gives a range, the timer runs for the shorter time.
                </Text>
              )}

              {/* A note kept on this step, shown without being asked for: not
                  having to ask again is the entire reason it was kept. */}
              {!!step.note && (
                <View style={styles.noteCard}>
                  <Ionicons name="bookmark" size={iconSize.xs} color={colors.purple} />
                  <Text style={styles.noteText}>{step.note}</Text>
                </View>
              )}

              {/* Asking sits under the sentence it's about, for the same reason
                  the timer chips do: the question is about this step, and the
                  answer is worthless next to a different one. It stays in this
                  scroll view rather than opening a sheet of its own, so a
                  running timer and the step controls never leave the screen to
                  make room for it. */}
              {canAsk && (
                <View style={styles.ask}>
                  {!askOpen ? (
                    <InlineAction
                      icon="help-circle-outline"
                      label="Ask about this step"
                      tint={colors.purple}
                      onPress={() => { haptics.tap(); animateLayout(); setAskOpen(true); }}
                    />
                  ) : (
                    <>
                      <TextInput
                        style={styles.askInput}
                        value={question}
                        onChangeText={setQuestion}
                        placeholder="e.g. how do I know when it's done?"
                        placeholderTextColor={colors.textTertiary}
                        maxLength={COOK_QUESTION_MAX_LENGTH}
                        returnKeyType="send"
                        autoFocus
                        editable={!asking}
                        onSubmitEditing={() => ask(question)}
                        accessibilityLabel="Your question about this step"
                      />
                      {!asking && answer === null && (
                        <View style={styles.askSuggestions}>
                          {suggestions.map(suggestion => (
                            <InlineAction
                              key={suggestion}
                              label={suggestion}
                              variant="neutral"
                              surface="page"
                              onPress={() => ask(suggestion)}
                            />
                          ))}
                        </View>
                      )}
                      {asking && (
                        <View style={styles.asking}>
                          <ActivityIndicator color={colors.purple} />
                          <Text style={styles.askingText}>Asking…</Text>
                        </View>
                      )}
                      {!!askError && <Text style={styles.askError}>{askError}</Text>}
                      {/* Gone once it's been kept: the note card above is now
                          holding the same words, and two copies of one answer
                          reads as two answers. */}
                      {!!answer && answer !== step.note && (
                        <View style={styles.answerCard}>
                          <Text style={styles.answerText}>{answer}</Text>
                          {/* A step read out of `notes` has no row to keep it
                              on — see CookStep.note. */}
                          {!step.fromNotes && (
                            <InlineAction
                              icon="bookmark-outline"
                              label="Keep this note"
                              tint={colors.purple}
                              accessibilityLabel="Keep this answer as a note on this step"
                              onPress={() => {
                                haptics.success();
                                animateLayout();
                                setStepNote(step.recipe.id, step.id, answer);
                              }}
                            />
                          )}
                        </View>
                      )}
                    </>
                  )}
                </View>
              )}
            </ScrollView>
          </>
        )}

        <View style={[styles.tray, { paddingBottom: insets.bottom + spacing.sm }]}>
          {/* Hidden on the mise en place screen itself — that's this same list,
              already on screen in full, not folded behind a header to tap. */}
          {ingredients.length > 0 && !atMise && (
            <View style={styles.panel}>
              <TouchableOpacity
                style={styles.panelHeader}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); animateLayout(); setIngredientsOpen(v => !v); }}
                accessibilityRole="button"
                accessibilityState={{ expanded: ingredientsOpen }}
                accessibilityLabel={`Ingredients, ${ingredients.length}`}
                accessibilityHint="Double tap for the amounts this cook needs"
              >
                <Ionicons name="basket-outline" size={16} color={colors.accent} />
                <Text style={styles.panelHeaderText}>Ingredients · {ingredients.length}</Text>
                <Ionicons
                  name={ingredientsOpen ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
              {ingredientsOpen && (
                <ScrollView style={styles.panelList} nestedScrollEnabled>
                  {ingredients.map((flat, position) => {
                    // Scaled first, then converted: the multiplication is exact
                    // and the conversion rounds, so rounding last is the only
                    // order that doesn't compound. Same pipeline the recipe
                    // screen's own row runs, and the swap is already applied —
                    // flattenRecipeIngredients took the rules on the way out.
                    const scaled = scaleQuantity(flat.ingredient.quantity, scale);
                    const converted = convertQuantity(scaled.text, unitSystem);
                    const marked = scaled.scaled || converted.converted || !!flat.swappedFrom;
                    const heading = headings[position];
                    // A hairline above a section the way the recipe screen
                    // draws one, except at the top of the list and except
                    // directly under a component's name: the name is already
                    // the boundary there, and a rule between the two would
                    // read as a separator rather than as a heading and the
                    // heading under it.
                    const rule = position > 0 && !heading.dish && !!heading.section;
                    return (
                      <View key={`${flat.recipe.id}:${flat.ingredient.id}`}>
                        {rule && <View style={styles.panelDivider} />}
                        {heading.dish && <Text style={styles.panelHeading}>{flat.recipe.name}</Text>}
                        {!!heading.section && (
                          <Text style={styles.panelHeading}>{heading.section}</Text>
                        )}
                        <View style={styles.panelRow}>
                          <View style={styles.panelRowText}>
                            <Text style={styles.panelName}>{flat.ingredient.name}</Text>
                            {!!flat.swappedFrom && (
                              <Text style={styles.panelSwap} numberOfLines={1}>
                                {describeStandingSwap(flat.swappedFrom)}
                              </Text>
                            )}
                            {!!flat.ingredient.prep && (
                              <Text style={styles.panelPrep}>{flat.ingredient.prep}</Text>
                            )}
                          </View>
                          {!!converted.text && (
                            <View style={[styles.qtyPill, marked && styles.qtyPillMarked]}>
                              <Text style={[styles.qtyText, marked && styles.qtyTextMarked]} numberOfLines={1}>
                                {converted.text}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          )}

          {/* Every countdown started from a step, whichever step it was started
              from. They live here rather than under the step text because the
              whole point of setting one is walking away from the step: pressing
              Next must not take a running timer off screen with it, and Pause
              has to be reachable without navigating back to the sentence that
              started it. */}
          {stepTimers.timers.length > 0 && (
            // Capped rather than left to grow: the step text is what this
            // screen is for, and four pans on the go would otherwise push it
            // off the top. Three rows fit under the cap and a fourth scrolls,
            // the same answer the ingredient panel gives to a long list. The
            // card is the wrapper and the scroll is inside it, so the padding
            // stays on the card rather than on a scrolling frame.
            <View style={styles.timerCard}>
              <ScrollView style={styles.stepTimerStack} nestedScrollEnabled>
                {stepTimers.timers.map(timer => (
                  <StepTimerRow
                    key={timer.id}
                    timer={timer}
                    now={stepTimers.now}
                    hideRecipeName
                    onToggle={() => stepTimers.toggle(timer)}
                    onAddTime={() => stepTimers.addTime(timer.id)}
                    onRestart={() => stepTimers.restart(timer.id)}
                    onRemove={() => stepTimers.remove(timer.id)}
                  />
                ))}
              </ScrollView>
            </View>
          )}

          {/* The recipe's own cook timer, not a second one — see useRecipeTimer.
              It sits above the step controls and never scrolls away, which is
              the "already there" half of this feature: starting, pausing and
              logging a cook shouldn't cost a trip back to the recipe. */}
          <View style={styles.timerCard}>
            <RecipeTimerRow verb="Cook" {...cookTimer} />
          </View>

          {atMise ? (
            <View style={styles.controls}>
              <TouchableOpacity
                style={styles.controlPrimary}
                activeOpacity={interaction.activeOpacity}
                onPress={startCooking}
                accessibilityRole="button"
                accessibilityLabel="Start cooking"
              >
                <Text style={styles.controlPrimaryText}>Start Cooking</Text>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.onAccent} />
              </TouchableOpacity>
            </View>
          ) : step !== null && (
            <View style={styles.controls}>
              <TouchableOpacity
                style={[styles.control, index === 0 && !hasIngredients && styles.controlOff]}
                activeOpacity={interaction.activeOpacity}
                onPress={goBack}
                disabled={index === 0 && !hasIngredients}
                accessibilityRole="button"
                accessibilityLabel={index === 0 && hasIngredients ? 'Back to mise en place' : 'Previous step'}
              >
                <Ionicons name="chevron-back" size={iconSize.sm} color={colors.accent} />
                <Text style={styles.controlText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.controlPrimary}
                activeOpacity={interaction.activeOpacity}
                onPress={goNext}
                accessibilityRole="button"
                accessibilityLabel={atLast ? 'Finish cooking and leave cook mode' : 'Next step'}
              >
                <Text style={styles.controlPrimaryText}>{atLast ? 'Done' : 'Next'}</Text>
                <Ionicons
                  name={atLast ? 'checkmark' : 'chevron-forward'}
                  size={iconSize.sm}
                  color={colors.onAccent}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
        {/* For the cook timer's "or log a time" field. Its own rather than the
            recipe screen's underneath: a Modal is a separate window, and an
            accessory bar can only attach to a keyboard in the window it was
            mounted in. */}
        <NumberPadAccessory />
      </View>
    </Modal>
  );
}

/**
 * Holds the screen awake for exactly as long as it's mounted.
 *
 * Its own component so the lock is tied to the Modal's *content* rather than to
 * `CookModeSheet`, which stays mounted while `visible` is false — calling the
 * hook up there would keep the phone awake from the first time a recipe screen
 * rendered until the app was killed.
 */
function ScreenAwake() {
  useKeepAwake();
  return null;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Three rows of StepTimerRow plus the card's own padding. A fourth is a
  // scroll rather than more height, so the tray can't grow without bound.
  stepTimerStack: {
    maxHeight: 210,
    flexGrow: 0,
  },
  offers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  offersNote: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: spacing.sm,
  },
  // Margin on both sides: the offers above it have their own top margin and the
  // step text below has none, so a block landing between them has to clear both.
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  noteText: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
  },
  ask: {
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  // No `lineHeight` on a TextInput — see CLAUDE.md; `minHeight` is what keeps
  // the field from resizing between empty and typed.
  askInput: {
    alignSelf: 'stretch',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    color: colors.text,
    fontSize: font.md,
  },
  askSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  asking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  askingText: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  askError: {
    color: colors.red,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
  },
  answerCard: {
    alignSelf: 'stretch',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  // A size up from the note and the error: this is the thing someone stopped
  // cooking to read, even though the step above it stays the bigger text.
  answerText: {
    color: colors.text,
    fontSize: font.lg,
    lineHeight: lineHeight.lg,
  },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scaleChip: {
    backgroundColor: colors.accent + '26',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  scaleChipText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  progress: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  position: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  stepScrollView: {
    flex: 1,
  },
  stepScroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  attribution: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  attributionText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  // The one thing on screen worth reading from a step back, so it takes the
  // largest size in the app and a line height to match.
  stepText: {
    color: colors.text,
    fontSize: font.xxl,
    lineHeight: 38,
    fontWeight: fontWeight.regular,
  },
  fromNotes: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  // Everything below the step, pinned: the panel, the timer and the controls
  // stay put while a long step scrolls above them.
  tray: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.bg,
  },
  panel: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  panelHeaderText: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  // Capped so the panel can't push the timer and the controls off the bottom of
  // a small screen — the two things a cook needs with their hands full.
  panelList: {
    maxHeight: 220,
    marginTop: spacing.sm,
  },
  panelDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginTop: spacing.sm,
  },
  panelHeading: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  panelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xsm,
  },
  panelRowText: {
    flex: 1,
  },
  panelName: {
    color: colors.text,
    fontSize: font.md,
  },
  panelSwap: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
    marginTop: spacing.xxs,
  },
  panelPrep: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: spacing.xxs,
  },
  qtyPill: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  qtyPillMarked: { backgroundColor: colors.accent + '26' },
  qtyText: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  qtyTextMarked: { color: colors.accent, fontWeight: fontWeight.medium },
  // The mise en place screen: the same ingredient list the tray's collapsed
  // panel shows mid-step, but this is the one place it's the main event —
  // bigger type, one row per line with a divider, meant to be read from
  // across the counter while gathering rather than glanced at one-handed.
  miseTitle: {
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: fontWeight.semibold,
  },
  miseSubtitle: {
    color: colors.textSecondary,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  miseCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  miseHeading: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  miseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  miseRowLast: { borderBottomWidth: 0 },
  miseRowText: {
    flex: 1,
  },
  miseName: {
    color: colors.text,
    fontSize: font.lg,
  },
  miseSwap: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    marginTop: spacing.xxs,
  },
  misePrep: {
    color: colors.textTertiary,
    fontSize: font.sm,
    marginTop: spacing.xxs,
  },
  miseQtyPill: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  miseQtyPillMarked: { backgroundColor: colors.accent + '26' },
  miseQtyText: {
    color: colors.textSecondary,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  miseQtyTextMarked: { color: colors.accent },
  timerCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Deliberately taller than the app's other buttons: this is the one control
  // aimed at with wet hands and half an eye.
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: 18,
    paddingHorizontal: spacing.lg,
  },
  controlOff: { opacity: 0.4 },
  controlText: {
    color: colors.accent,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  controlPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
    paddingVertical: 18,
  },
  controlPrimaryText: {
    color: colors.onAccent,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
});
