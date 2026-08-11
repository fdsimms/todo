import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { MealPlanEntry, MealSlot } from '../types';
import { MEAL_SLOTS, RECIPE_NAME_MAX_LENGTH } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SafeBlurView } from './SafeBlurView';
import { dayKeyOf } from '../utils/dateUtils';
import { slotLabel } from '../utils/mealPlan';
import type { ChoiceGroup } from '../utils/recipeComponents';
import { RecipeScaleChips } from './RecipeScaleChips';

interface Props {
  visible: boolean;
  /** Read live from the store by id, so the chips follow a move the sheet just made. */
  entry: MealPlanEntry | null;
  title: string;
  /** The week on screen — the days "Move to…" offers. */
  weekDays: Date[];
  onMove: (to: { date?: string; slot?: MealSlot }) => void;
  onRemove: () => void;
  /**
   * Present only for a free-text entry (no recipeId) — a recipe-backed
   * title comes from the recipe and isn't independently editable here.
   */
  onRename?: (title: string) => void;
  /**
   * The either/or slots this meal's recipe poses — "Side: mash or roast" — with
   * whichever option this entry is currently having marked active. Empty for
   * every meal whose recipe offers no choice, which is most of them, and the
   * section then renders nothing.
   */
  choiceGroups?: ChoiceGroup[];
  /** Records a pick. Absent alongside an empty `choiceGroups`. */
  onChoose?: (group: ChoiceGroup, componentId: string) => void;
  /**
   * Records how much of the recipe this meal makes — see
   * MealPlanEntry.recipeScale. Absent for a meal with no recipe behind it,
   * which is what hides the control entirely.
   */
  onScale?: (factor: number) => void;
  /** The recipe's own serving count — enables the servings stepper under the
      batch chips. See RecipeScaleChips.baseServings. */
  baseServings?: number | null;
  /** The high end of a range, for the "recipe says serves 4-6" caption. */
  baseServingsMax?: number | null;
  /** Present only while the entry hasn't already been marked cooked. */
  onMarkCooked?: () => void;
  /** Present only while the entry's recipe still resolves. */
  onOpenRecipe?: () => void;
  /** Present only while the entry's recipe still resolves and has prep tasks. */
  onAddPrepTasks?: () => void;
  /**
   * Present unless this entry is already eating a tracked leftover — logging a
   * leftover *of* a leftover is the one case where the offer is noise.
   */
  onLogLeftovers?: () => void;
  /**
   * Present only when this entry is eating a tracked leftover that's still in
   * the fridge. The separate later action the picker's "was that the last of
   * it?" offer is the cheap version of — see Leftover.finishedAt.
   */
  onFinishLeftover?: () => void;
  onClose: () => void;
}

/**
 * What you can do to a planned meal: move it, re-slot it, open its recipe,
 * take it off.
 *
 * **"Move to…" is a chip row, not a drag.** Cross-section drag has needed
 * bespoke math twice in this app (resolveDrop, resolveGroceryDrop), and the one
 * built for Today's category headers never lined up with the finger holding it
 * and was removed along with its helpers. Seven chips need no measurement and
 * show the whole week at once.
 *
 * Every tap applies immediately and leaves the sheet open, so moving a dinner
 * to Thursday *and* making it lunch is two taps rather than two round trips.
 *
 * **Its height is data-driven, so it has to be bounded.** A composed recipe
 * contributes a labelled chip row per choice group, and five of the actions
 * below are conditional — a meal that has every one of them, on a recipe with
 * two either/or groups, is taller than a phone. Same `maxHeight` + inner
 * `ScrollView` + `flexShrink` shape RecipePickerSheet already uses; without it
 * the card simply grows off the top of the screen with nothing to scroll, and
 * the title is what goes first.
 */
/** Kept clear above the sheet so its first row never slides under the status bar. */
const TOP_INSET = 72;

export function MealEntrySheet({
  visible, entry, title, weekDays, onMove, onRemove, onRename, choiceGroups = [], onChoose,
  onScale, baseServings, baseServingsMax, onMarkCooked, onOpenRecipe, onAddPrepTasks, onLogLeftovers,
  onFinishLeftover, onClose,
}: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(600);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    // A fresh open (or a switch to a different entry) always starts read-only,
    // regardless of whether the previous entry was left mid-edit.
    setEditingTitle(false);
    setDraftTitle(title);
  }, [visible, entry?.id]);

  const commitRename = () => {
    setEditingTitle(false);
    const trimmed = draftTitle.trim();
    if (onRename && trimmed && trimmed !== title) onRename(trimmed);
    else setDraftTitle(title);
  };

  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 700, damping: 28, stiffness: 320, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(600);
      onClose();
      after?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) dismiss();
        else Animated.spring(translateY, { toValue: 0, damping: 22, stiffness: 300, useNativeDriver: true }).start();
      },
    })
  ).current;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View
        style={[
          styles.sheetOuter,
          { maxHeight: windowHeight - TOP_INSET },
          { transform: [{ translateY }] },
        ]}
      >
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        {/* The card is itself the scroller, so a tall meal scrolls rather than
            growing off the top of the screen. The handle above and the Done
            card below stay put — the drag-to-dismiss responder lives on the
            handle, so scrolling in here never fights it. */}
        <ScrollView
          style={styles.card}
          contentContainerStyle={styles.cardContent}
          bounces={false}
          showsVerticalScrollIndicator={false}
          // The title can be mid-edit; a tap on a chip should move the meal
          // rather than being spent dismissing the keyboard.
          keyboardShouldPersistTaps="handled"
        >
          {editingTitle ? (
            <TextInput
              style={styles.sheetTitleInput}
              value={draftTitle}
              onChangeText={setDraftTitle}
              onBlur={commitRename}
              onSubmitEditing={commitRename}
              autoFocus
              autoCorrect={false}
              returnKeyType="done"
              maxLength={RECIPE_NAME_MAX_LENGTH}
              accessibilityLabel="Meal title"
            />
          ) : onRename ? (
            <TouchableOpacity
              style={styles.sheetTitleRow}
              onPress={() => { haptics.tap(); setDraftTitle(title); setEditingTitle(true); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Rename ${title}`}
              accessibilityHint="Opens a text field to edit this meal's title"
            >
              <Text style={[styles.sheetTitle, styles.sheetTitleEditable]} numberOfLines={2}>{title}</Text>
              <Ionicons name="pencil-outline" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : (
            <Text style={styles.sheetTitle} numberOfLines={2}>{title}</Text>
          )}

          {/* Alongside the choice chips, above "Move to", for the same reason
              they are: both change what gets cooked and bought rather than where
              the meal sits. Only for a meal backed by a recipe — a night that
              just says "leftovers" has no quantities to multiply. */}
          {!!onScale && (
            <View>
              <Text style={styles.label}>Batch</Text>
              <RecipeScaleChips
                value={entry?.recipeScale ?? 1}
                onChange={onScale}
                baseServings={baseServings}
                baseServingsMax={baseServingsMax}
                surface="card"
              />
            </View>
          )}

          {choiceGroups.map(group => (
            <View key={`${group.recipe.id}:${group.label}`}>
              <Text style={styles.label}>{group.label}</Text>
              <View style={styles.chips}>
                {group.options.map(option => {
                  const on = option.id === group.active.id;
                  const name = option.name || 'Deleted recipe';
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => { haptics.tap(); onChoose?.(group, option.id); }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${group.label}: ${name}`}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}

          <Text style={styles.label}>Move to</Text>
          <View style={styles.chips}>
            {weekDays.map(day => {
              const key = dayKeyOf(day);
              const on = entry?.date === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.dayChip, on && styles.chipOn]}
                  onPress={() => { haptics.tap(); onMove({ date: key }); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Move to ${format(day, 'EEEE d MMMM')}`}
                >
                  <Text style={[styles.dayChipTop, on && styles.chipTextOn]}>
                    {format(day, 'EEEEE')}
                  </Text>
                  <Text style={[styles.dayChipNum, on && styles.chipTextOn]}>
                    {format(day, 'd')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Meal</Text>
          <View style={[styles.chips, styles.chipsLast]}>
            {MEAL_SLOTS.map(slot => {
              const on = entry?.slot === slot;
              return (
                <TouchableOpacity
                  key={slot}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => { haptics.tap(); onMove({ slot }); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={slotLabel(slot)}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{slotLabel(slot)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {!!onMarkCooked && (
            <>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.action}
                onPress={() => { haptics.success(); dismiss(onMarkCooked); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Mark this meal cooked"
              >
                <View style={styles.actionIcon}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.accent} />
                </View>
                <Text style={[styles.actionText, { color: colors.accent }]}>Mark cooked</Text>
              </TouchableOpacity>
            </>
          )}

          {!!onOpenRecipe && (
            <>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.action}
                onPress={() => { haptics.tap(); dismiss(onOpenRecipe); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Open this recipe"
              >
                <View style={styles.actionIcon}>
                  <Ionicons name="restaurant-outline" size={16} color={colors.accent} />
                </View>
                <Text style={[styles.actionText, { color: colors.accent }]}>Open recipe</Text>
              </TouchableOpacity>
            </>
          )}

          {!!onAddPrepTasks && (
            <>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.action}
                onPress={() => { haptics.tap(); dismiss(onAddPrepTasks); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Add prep tasks for this meal"
              >
                <View style={styles.actionIcon}>
                  <Ionicons name="alarm-outline" size={16} color={colors.accent} />
                </View>
                <Text style={[styles.actionText, { color: colors.accent }]}>Add prep tasks</Text>
              </TouchableOpacity>
            </>
          )}

          {!!onLogLeftovers && (
            <>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.action}
                onPress={() => { haptics.tap(); dismiss(onLogLeftovers); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Log leftovers from this meal"
              >
                <View style={styles.actionIcon}>
                  <Ionicons name="snow-outline" size={16} color={colors.accent} />
                </View>
                <Text style={[styles.actionText, { color: colors.accent }]}>Log leftovers</Text>
              </TouchableOpacity>
            </>
          )}

          {!!onFinishLeftover && (
            <>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.action}
                onPress={() => { haptics.success(); dismiss(onFinishLeftover); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Mark the leftover this meal used as finished"
              >
                <View style={styles.actionIcon}>
                  <Ionicons name="checkmark-done-outline" size={16} color={colors.green} />
                </View>
                <Text style={[styles.actionText, { color: colors.green }]}>Finished the leftovers</Text>
              </TouchableOpacity>
            </>
          )}

          <View style={styles.sep} />
          <TouchableOpacity
            style={styles.action}
            onPress={() => { haptics.warning(); dismiss(onRemove); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Take this off the plan"
          >
            <View style={styles.actionIcon}>
              <Ionicons name="trash-outline" size={16} color={colors.red} />
            </View>
            <Text style={[styles.actionText, { color: colors.red }]}>Remove from plan</Text>
          </TouchableOpacity>
        </ScrollView>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Done</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    // Lets the card give way to the sheet's maxHeight instead of overflowing
    // it — without this the ScrollView takes its content's full height and
    // there is nothing to scroll.
    flexShrink: 1,
  },
  // The card's own padding lives on the scroll content, not on its frame.
  cardContent: {
    paddingBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  sheetTitleEditable: {
    flexShrink: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  sheetTitleInput: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    height: 28,
  },
  label: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  chipsLast: {
    marginBottom: spacing.md,
  },
  dayChip: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  dayChipTop: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  dayChipNum: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  chipOn: {
    backgroundColor: colors.accent,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  chipTextOn: {
    color: colors.onAccent,
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  // Fixed-width wrapper so the label starts at the same x regardless of the
  // glyph's own optical width (checkmark-circle vs restaurant vs trash, all
  // at size={16}) — same idea as SideMenuDrawer's iconWrap.
  actionIcon: {
    width: iconSize.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
