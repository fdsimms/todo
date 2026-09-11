import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { MEAL_SLOTS, MEAL_SLOT_LABELS, type FoodNutrition, type MealSlot } from '../types';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { packageChoices, packageHelping } from '../utils/scanPortion';
import { scalePanelToAmount } from '../utils/foodLog';
import { haptics } from '../utils/haptics';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';

/**
 * How much of each scanned package was eaten.
 *
 * **A barcode says what something is; it never says how much of it you ate.**
 * The scan session resolves the food and its label panel, and that is as far as
 * a code can go — this is the one question left, asked once per scanned box
 * rather than assumed to be one serving. Assuming would be a wrong calorie
 * count with nothing on screen to say so, which is the refusal the whole
 * nutrition tree is arranged around.
 *
 * **Two taps and a text field, in that order.** The panel's own serving and the
 * whole package are the two answers a label can support without typing, and
 * `packageChoices` withholds the second when the source never stated a pack
 * size — a made-up serving count multiplied by a real per-serving figure is
 * exactly the invented number this must not produce. Anything else is typed and
 * measured against the food's own portion table by `scalePanelToAmount`, which
 * refuses an amount it cannot resolve rather than approximating it.
 *
 * **A row nobody answered is not logged.** Scanning several boxes and logging
 * one of them is an ordinary thing to do, so an untouched card is skipped
 * silently rather than defaulted to a serving.
 *
 * Nothing is written until Log, so the swipe-down is guarded: what it would
 * lose is a set of picked amounts.
 */

/** One scanned box, resolved as far as a barcode can take it. */
export interface ScannedFood {
  key: string;
  /** What the entry gets called — the catalog row's name, plus its box. */
  label: string;
  /** The label panel, already on the box by the time this opens. */
  panel: FoodNutrition;
  /** Pack size as the source printed it, or null when it stated none. */
  packSize: string | null;
  itemId: string | null;
  productId: string | null;
}

interface Props {
  visible: boolean;
  foods: readonly ScannedFood[];
  /** Which meal these land in, defaulting to whatever the screen was showing. */
  slot: MealSlot | null;
  /** The logical day being logged, so a backdated scan lands where it is shown. */
  at: Date;
  /**
   * The planned meal these entries are logging, carried onto each one — the
   * same link `FoodLogEntrySheet` writes for the caller that has one. Omitted
   * by every caller scanning a food on its own, which is why the store's own
   * field defaults to null rather than this prop defaulting to it.
   */
  mealPlanEntryId?: string | null;
  onClose: () => void;
}

/** What one card is currently answering. `null` is the untouched state. */
type Answer =
  | { kind: 'choice'; servings: number; label: string }
  | { kind: 'typed'; text: string };

export function ScanPortionSheet({ visible, foods, slot, at, mealPlanEntryId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const addEntry = useFoodLogStore(s => s.addEntry);
  // Lifts the focused amount field clear of the keyboard instead of leaving
  // it to a plain ScrollView, which only scrolls when the person does it
  // manually — same mechanism as every other keyboard-heavy sheet (see the
  // hook's own doc comment for why this beats a KeyboardAvoidingView here).
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [chosenSlot, setChosenSlot] = useState<MealSlot | null>(slot);

  useEffect(() => {
    if (!visible) return;
    setAnswers({});
    setChosenSlot(slot);
  }, [visible, slot]);

  /**
   * What each answered card actually works out to. A typed amount that doesn't
   * resolve lands here as null, which is what greys its own card's figure out
   * rather than failing at Log — the person is looking at the field they typed.
   */
  const resolved = useMemo(() => {
    const out = new Map<string, { nutrition: FoodNutrition; grams: number | null; quantity: string } | null>();
    for (const food of foods) {
      const answer = answers[food.key];
      if (!answer) continue;
      // A field typed into and then cleared is untouched again, not a refusal.
      // Left as an answer it rendered "That amount can't be measured against
      // this label." under an empty box, which reads as the label being at
      // fault rather than the field being blank.
      if (answer.kind === 'typed' && !answer.text.trim()) continue;
      if (answer.kind === 'choice') {
        const nutrition = packageHelping(food.panel, answer.servings, answer.label, at);
        out.set(food.key, nutrition ? { nutrition, grams: nutrition.servingGrams, quantity: answer.label } : null);
      } else {
        const scaled = scalePanelToAmount(food.panel, answer.text, null, at);
        out.set(food.key, scaled ? { ...scaled, quantity: answer.text.trim() } : null);
      }
    }
    return out;
  }, [foods, answers, at]);

  const loggable = foods.filter(f => resolved.get(f.key));

  const handleCancel = () => {
    // Measured against what actually resolved, so a field typed into and then
    // cleared is not something a swipe-down would lose.
    if (resolved.size === 0) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const handleLog = () => {
    for (const food of loggable) {
      const answer = resolved.get(food.key);
      if (!answer) continue;
      // `addEntry` refuses a draft with no label or no figures; neither can
      // happen for a resolved card, and a silent skip is still the right
      // answer for the row rather than abandoning the rest of the batch.
      addEntry({
        label: food.label,
        quantity: answer.quantity,
        grams: answer.grams,
        nutrition: answer.nutrition,
        slot: chosenSlot,
        itemId: food.itemId,
        productId: food.productId,
        mealPlanEntryId: mealPlanEntryId ?? null,
        at,
      });
    }
    haptics.success();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />
          <Text style={styles.headerTitle}>How much?</Text>
          <SheetHeaderButton
            label="Log"
            onPress={handleLog}
            disabled={loggable.length === 0}
            minWidth={64}
          />
        </View>

        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <Text style={styles.groupLabel}>WHICH MEAL</Text>
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

          {foods.map(food => {
            const answer = answers[food.key];
            const choices = packageChoices(food.panel, food.packSize);
            const outcome = resolved.get(food.key);
            const typed = answer?.kind === 'typed' ? answer.text : '';
            return (
              <View key={food.key} style={styles.card}>
                <Text style={styles.cardTitle}>{food.label}</Text>
                <View style={styles.choices}>
                  {choices.map(choice => {
                    const on = answer?.kind === 'choice' && answer.label === choice.label;
                    return (
                      <TouchableOpacity
                        key={choice.key}
                        style={[styles.choice, on && styles.choiceOn]}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => {
                          haptics.tap();
                          setAnswers(a => ({ ...a, [food.key]: { kind: 'choice', servings: choice.servings, label: choice.label } }));
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={choice.label}
                      >
                        <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{choice.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  style={styles.input}
                  value={typed}
                  onChangeText={text => setAnswers(a => ({ ...a, [food.key]: { kind: 'typed', text } }))}
                  placeholder="e.g. 150g, 2 cups"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel={`Amount of ${food.label}`}
                />
                {/* What the answer works out to, or why it doesn't. An amount
                    the food's own portion table can't measure is refused here
                    rather than at Log, since the field is what needs changing. */}
                {resolved.has(food.key) && (
                  <Text style={[styles.outcome, !outcome && styles.outcomeRefused]}>
                    {outcome
                      ? outcome.nutrition.amounts.calorieKcal !== undefined
                        ? `${Math.round(outcome.nutrition.amounts.calorieKcal)} cal`
                        : 'Measured'
                      : 'That amount can’t be measured against this label.'}
                  </Text>
                )}
              </View>
            );
          })}

          <Text style={styles.footnote}>
            Anything left blank isn't logged.
          </Text>
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
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    body: { flex: 1 },
    bodyContent: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    choice: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
    },
    choiceOn: { backgroundColor: colors.accent },
    choiceText: { color: colors.text, fontSize: font.sm },
    choiceTextOn: { color: colors.onAccent, fontWeight: fontWeight.medium },
    input: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.text,
      fontSize: font.md,
    },
    outcome: { color: colors.textSecondary, fontSize: font.sm },
    outcomeRefused: { color: colors.textTertiary },
    groupLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    footnote: { color: colors.textSecondary, fontSize: font.sm },
  });
}
