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
import { useShallow } from 'zustand/react/shallow';
import type { MealPlanEntry, MealSlot } from '../types';
import { MEAL_SLOTS, RECIPE_NAME_MAX_LENGTH } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SafeBlurView } from './SafeBlurView';
import { InlineAction } from './InlineAction';
import { SheetActionRow } from './SheetActionRow';
import { dayKeyOf } from '../utils/dateUtils';
import { slotLabel } from '../utils/mealPlan';
import type { ChoiceGroup } from '../utils/recipeComponents';
import { RecipeScaleChips } from './RecipeScaleChips';
import { PillGroup } from './PillGroup';
import { SheetScrim } from './SheetScrim';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { usePersonNoteStore } from '../store/usePersonNoteStore';
import { guestFoodNotes } from '../utils/personNotes';
import { getCurrentDayStart } from '../utils/dateUtils';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  /** Read live from the store by id, so the chips follow a move the sheet just made. */
  entry: MealPlanEntry | null;
  title: string;
  /** The week on screen — the days "Move to…" offers. */
  weekDays: Date[];
  onMove: (to: { date?: string; slot?: MealSlot }) => void;
  /**
   * Opens a full date picker for this meal — the way out of the week the chips
   * show. The caller dismisses this sheet first and hosts the picker itself,
   * since two modals can't be up at once.
   */
  onMoveFurther?: () => void;
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
  /**
   * Records who this meal is for — see MealPlanEntry.personIds. Absent (with
   * the block) when nobody has been added on the People screen yet, since a
   * picker with nothing in it is a prompt to start filing your friends, which
   * is exactly what `docs/arch/people.md` rule 3 rules out.
   */
  onSetGuests?: (personIds: string[]) => void;
  /**
   * Ticks the meal off, or back on. Present either way now — the action used
   * to vanish once an entry was cooked, so the sheet could get you into that
   * state and not back out of it (#1361).
   */
  onSetCooked?: (cooked: boolean) => void;
  /**
   * Opens the recipe with its cook timer already running — the handoff from
   * the plan to the pan. Present only while the entry's recipe resolves.
   */
  onStartCooking?: () => void;
  /** Present only while the entry's recipe still resolves. */
  onOpenRecipe?: () => void;
  /**
   * Shops this one meal — opens the review sheet on its recipe, at this
   * meal's own scale and either/or picks. Present only while the entry's
   * recipe resolves, and present whether or not the meal is cooked: unlike
   * the week and day adds, which skip a cooked meal because nobody asked
   * about it, this one was asked for by name.
   */
  onAddToList?: () => void;
  /** Present only while the entry's recipe still resolves and has prep tasks. */
  onAddPrepTasks?: () => void;
  /**
   * Says whether this meal gets a "Cook X" task on Today, overriding the
   * `mealCookTasks` setting for this one meal (#1402). Absent on a meal that's
   * already been cooked — the night has happened, and offering to schedule it
   * then is offering to schedule the past.
   */
  onSetCookTask?: (want: boolean) => void;
  /** Whether one exists right now — what the row's label and state read from. */
  hasCookTask?: boolean;
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
  visible, entry, title, weekDays, onMove, onMoveFurther, onRemove, onRename, choiceGroups = [], onChoose,
  onScale, baseServings, baseServingsMax, onSetGuests, onSetCooked, onStartCooking, onOpenRecipe, onAddToList, onAddPrepTasks,
  onLogLeftovers,
  onFinishLeftover, onSetCookTask, hasCookTask = false, onClose,
}: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();
  const cooked = !!entry?.cookedAt;

  // Archived people are out of the picker but never stripped off a meal that
  // already names them — the same split TaskEditor makes, and for the same
  // reason: filing somebody away is about the list, not about last Tuesday.
  const people = usePersonStore(useShallow(s => s.people.filter(p => !p.archived)));
  const guestIds = entry?.personIds ?? [];

  /**
   * What the guests at this meal can't or won't eat.
   *
   * The kitchen half of the app paying off in a way it could not without both
   * halves (#2047): remembering that Ansley cannot eat shellfish, at the moment
   * you are deciding what to cook her, is care rather than measurement.
   *
   * Read off every person rather than the filtered picker list, so an archived
   * guest already on the meal still brings their note with them — filing
   * somebody away is about the People screen's list, not about what they eat.
   */
  const allPeople = usePersonStore(useShallow(s => s.people));
  const allNotes = usePersonNoteStore(useShallow(s => s.notes));
  const foodNotes = useMemo(() => {
    if (guestIds.length === 0) return [];
    const guests = allPeople
      .filter(p => guestIds.includes(p.id))
      .map(p => ({ id: p.id, name: displayNameOf(p) }));
    return guestFoodNotes(allNotes, guests, getCurrentDayStart());
  }, [allNotes, allPeople, guestIds.join(',')]);

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
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
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset. "Open recipe"
      // is the call site that made this visible: the card was put back on
      // screen at the bottom of the meal plan and stayed there until
      // RecipeDetail had finished rendering.
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
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      },
    })
  ).current;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={() => dismiss()} />

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
            <View style={styles.scaleBlock}>
              <Text style={styles.label}>Batch</Text>
              <RecipeScaleChips
                value={entry?.recipeScale ?? 1}
                onChange={onScale}
                baseServings={baseServings}
                baseServingsMax={baseServingsMax}
                surface="card"
                // The component carries no inset of its own (two of its three
                // callers are full-bleed rows), so the card's own 16pt has to
                // be handed to it — without this its chips and servings row sit
                // flush to the card edge while every label above them is inset.
                style={styles.scaleChips}
              />
            </View>
          )}

          {/* Under the batch chips and above the choice groups: all three say
              what gets cooked rather than where the meal sits, and who is
              coming is the one a cook decides first. `PillGroup` rather than a
              raw pill row because the people list has no ceiling — it caps
              itself and grows a filter — and deliberately with no `onCreate`,
              so somebody can be picked here but never invented here. */}
          {!!onSetGuests && people.length > 0 && (
            <View style={styles.guestBlock}>
              <Text style={styles.label}>Guests</Text>
              {/* The inset lives here because PillGroup carries none of its own
                  — same reason scaleChips does it for RecipeScaleChips, and
                  without it the pills sit flush to the card edge while the
                  label above them is inset 16pt. */}
              <View style={styles.guestPills}>
              <PillGroup
                noun="guest"
                surface="card"
                options={people.map(p => ({
                  key: p.id,
                  label: displayNameOf(p),
                  selected: guestIds.includes(p.id),
                  accessibilityLabel: `${displayNameOf(p)} is coming`,
                  onPress: () => {
                    haptics.tap();
                    onSetGuests(
                      guestIds.includes(p.id)
                        ? guestIds.filter(id => id !== p.id)
                        : [...guestIds, p.id]
                    );
                  },
                }))}
              />
              </View>
              {/* Directly under the guests, because it is a consequence of them
                  and reads as nonsense anywhere else. Stated flatly and with
                  nobody's name in a warning colour: this is a thing you wrote
                  down, not an alert. */}
              {foodNotes.length > 0 && (
                <View style={styles.foodNotes}>
                  {foodNotes.map((note, i) => (
                    <Text key={`${note.personId}:${i}`} style={styles.foodNote}>
                      <Text style={styles.foodNoteName}>{note.name}</Text>
                      {`  ${note.text}`}
                    </Text>
                  ))}
                </View>
              )}
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
                  accessibilityLabel={`Move to ${format(day, 'EEEE, MMMM d')}`}
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

          {/*
            The way past the seven chips. They're deliberately a week — see the
            note above on why this isn't a drag — but a week was also the hard
            ceiling: moving one meal to next Tuesday meant selecting it as a
            "bulk" of one, because only the bulk bar had a calendar (#1364).
            A chip row for the common case, an escape hatch for the rest.
          */}
          {!!onMoveFurther && (
            <View style={styles.furtherRow}>
              <InlineAction
                label="Another date…"
                icon="calendar-outline"
                variant="neutral"
                onPress={() => { haptics.tap(); dismiss(onMoveFurther); }}
                accessibilityLabel="Move this meal to a date outside this week"
              />
            </View>
          )}

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

          {!!onSetCooked && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon={cooked ? 'close-circle-outline' : 'checkmark-circle-outline'}
                color={colors.accent}
                label={cooked ? 'Mark not cooked' : 'Mark cooked'}
                onPress={() => {
                  const next = !cooked;
                  next ? haptics.success() : haptics.tap();
                  dismiss(() => onSetCooked(next));
                }}
                accessibilityLabel={cooked ? 'Mark this meal not cooked' : 'Mark this meal cooked'}
              />
            </>
          )}

          {/*
            Above "Open recipe" because it's the more specific version of it,
            and because it's the thing you want at the moment you're standing
            in the kitchen: this sheet knows what tonight is, the recipe screen
            has the timer, and until now nothing joined them (#1379). Starting
            the timer here rather than passing a navigation param keeps the
            state where it lives — on the recipe — so the screen simply opens
            with it already running.
          */}
          {!!onStartCooking && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon="flame-outline"
                color={colors.accent}
                label="Start cooking"
                onPress={() => { haptics.impactMedium(); dismiss(onStartCooking); }}
                accessibilityLabel="Start cooking this meal, opening the recipe with its timer running"
              />
            </>
          )}

          {!!onOpenRecipe && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon="restaurant-outline"
                color={colors.accent}
                label="Open recipe"
                onPress={() => { haptics.tap(); dismiss(onOpenRecipe); }}
                accessibilityLabel="Open this recipe"
              />
            </>
          )}

          {/*
            The one-meal end of the same three-scope shortcut the day headers'
            cart button and the week's own pill sit at the other end of: a
            meal, a day, a week. Directly under "Open recipe" because it's the
            other thing this sheet can do with the recipe behind the meal,
            where the two rows below it both write a task.
          */}
          {!!onAddToList && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon="cart-outline"
                color={colors.accent}
                label="Add ingredients to list"
                onPress={() => { haptics.tap(); dismiss(onAddToList); }}
                accessibilityLabel="Add this meal's ingredients to the grocery list"
              />
            </>
          )}

          {/*
            The per-meal override for this slot's meal task (#1402). Applies immediately
            and leaves the sheet open — the same model the move chips and the
            cooked toggle follow — because it's a property of this meal being
            set, not an action being taken and left behind. It reads the entry
            live rather than holding state, so the label follows what the
            reconcile actually did.
          */}
          {!!onSetCookTask && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon={hasCookTask ? 'checkbox' : 'square-outline'}
                color={colors.accent}
                label={hasCookTask ? 'Remove meal task' : 'Add meal task'}
                onPress={() => { haptics.tap(); onSetCookTask(!hasCookTask); }}
                accessibilityRole="switch"
                accessibilityState={{ checked: hasCookTask }}
                accessibilityLabel="Meal task on Today"
                accessibilityHint={hasCookTask
                  ? 'Removes the task for this meal'
                  : 'Adds a task for this meal on the day it\'s planned for'}
              />
            </>
          )}

          {!!onAddPrepTasks && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon="alarm-outline"
                color={colors.accent}
                label="Add prep tasks"
                onPress={() => { haptics.tap(); dismiss(onAddPrepTasks); }}
                accessibilityLabel="Add prep tasks for this meal"
              />
            </>
          )}

          {!!onLogLeftovers && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon="snow-outline"
                color={colors.accent}
                label="Log leftovers"
                onPress={() => { haptics.tap(); dismiss(onLogLeftovers); }}
                accessibilityLabel="Log leftovers from this meal"
              />
            </>
          )}

          {!!onFinishLeftover && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon="checkmark-done-outline"
                color={colors.green}
                label="Finished the leftovers"
                onPress={() => { haptics.success(); dismiss(onFinishLeftover); }}
                accessibilityLabel="Mark the leftover this meal used as finished"
              />
            </>
          )}

          <View style={styles.sep} />
          <SheetActionRow
            icon="trash-outline"
            color={colors.red}
            label="Remove from plan"
            onPress={() => { haptics.warning(); dismiss(onRemove); }}
            accessibilityLabel="Take this off the plan"
          />
        </ScrollView>

        <TouchableOpacity
          style={styles.cancelCard}
          onPress={() => {
            // Tapping Done can beat the title field's own blur — flush it
            // first instead of dropping whatever was typed.
            if (editingTitle) commitRename();
            dismiss();
          }}
          activeOpacity={interaction.activeOpacity}
        >
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
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  guestBlock: { marginBottom: spacing.sm },
  guestPills: { paddingHorizontal: spacing.md },
  foodNotes: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: 3 },
  foodNote: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
  foodNoteName: { color: colors.text, fontWeight: fontWeight.medium },
  scaleBlock: { paddingBottom: spacing.xs },
  scaleChips: { paddingHorizontal: spacing.md },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  chipsLast: {
    marginBottom: spacing.md,
  },
  furtherRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
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
