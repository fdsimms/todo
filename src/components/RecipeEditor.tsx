import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Keyboard,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Recipe, RecipeMealType, RecipeSourceType } from '../types';
import {
  RECIPE_MEAL_TYPES,
  RECIPE_MEAL_TYPE_LABELS,
  RECIPE_NAME_MAX_LENGTH,
  RECIPE_SOURCE_MAX_LENGTH,
  RECIPE_SOURCE_TYPES,
  RECIPE_SOURCE_TYPE_LABELS,
  RECIPE_PAGE_MAX_LENGTH,
  RECIPE_TAG_MAX_LENGTH,
  LEFTOVER_KEEP_DAYS_DEFAULT,
  LEFTOVER_KEEP_DAYS_MAX,
  LEFTOVER_KEEP_DAYS_MIN,
} from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { recipesUsing } from '../utils/recipeComponents';
import { allRecipeTags, cleanRecipeTag, toggleRecipeTag } from '../utils/recipeTags';
import { tagColor } from '../utils/tagColor';
import { InlineAction } from './InlineAction';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatDuration } from '../utils/effort';
import { describeKeepDays } from '../utils/leftovers';
import { CollapsibleField } from './CollapsibleField';
import { CountStepper } from './CountStepper';
import { distinctRecipeValues, filterRecipeSuggestions, formatServingsRange, totalMinutes } from '../utils/recipeUtils';
import { EditorRow } from './EditorRow';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';

interface Props {
  visible: boolean;
  recipe: Recipe | null;
  onClose: () => void;
  /** Fired after a confirmed delete, so the detail screen can pop itself. */
  onDeleted: () => void;
}

// CountStepper steps by 1, so prep and cook time are each stepped in 5-minute
// units rather than one minute at a time — a recipe's duration doesn't need
// minute precision, and 1-minute steps would make a 45-minute braise a lot of
// holding. Capped at 6 hours, well past anything this app times. Shared by
// both rows below rather than one constant pair per row, since the
// constraint is the same fact about durations, not about cooking specifically.
const DURATION_STEP_MINUTES = 5;
const DURATION_MAX_MINUTES = 360;

/**
 * Everything about a recipe that isn't its ingredient list: the name, what it
 * serves, where it came from, and the notes. Same progressive-disclosure shape
 * as TemplateEditor — the rarely-changed rows sit under the name.
 */
export function RecipeEditor({ visible, recipe, onClose, onDeleted }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const renameRecipe = useRecipeStore(s => s.renameRecipe);
  const setNotes = useRecipeStore(s => s.setNotes);
  const setSourceUrl = useRecipeStore(s => s.setSourceUrl);
  const setAuthor = useRecipeStore(s => s.setAuthor);
  const setSource = useRecipeStore(s => s.setSource);
  const setSourceType = useRecipeStore(s => s.setSourceType);
  const setSourcePage = useRecipeStore(s => s.setSourcePage);
  const setServings = useRecipeStore(s => s.setServings);
  const setRecipeYield = useRecipeStore(s => s.setRecipeYield);
  const setLeftoverKeepDays = useRecipeStore(s => s.setLeftoverKeepDays);
  const setEstimatedMinutes = useRecipeStore(s => s.setEstimatedMinutes);
  const setPrepMinutes = useRecipeStore(s => s.setPrepMinutes);
  const setMealType = useRecipeStore(s => s.setMealType);
  const setTags = useRecipeStore(s => s.setTags);
  const deleteRecipe = useRecipeStore(s => s.deleteRecipe);

  const [name, setName] = useState('');
  const [notes, setNotesDraft] = useState('');
  const [url, setUrl] = useState('');
  const [author, setAuthorDraft] = useState('');
  const [source, setSourceDraft] = useState('');
  const [sourceType, setSourceTypeDraft] = useState<RecipeSourceType | null>(null);
  const [sourcePage, setSourcePageDraft] = useState('');
  const [servings, setServingsDraft] = useState<number | null>(null);
  const [servingsMax, setServingsMaxDraft] = useState<number | null>(null);
  const [recipeYield, setRecipeYieldDraft] = useState('');
  const [mealType, setMealTypeDraft] = useState<RecipeMealType | null>(null);
  const [tags, setTagsDraft] = useState<string[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [leftoverKeepDays, setLeftoverKeepDaysDraft] = useState<number | null>(null);
  const [servingsOpen, setServingsOpen] = useState(false);
  const [yieldOpen, setYieldOpen] = useState(false);
  const [leftoverKeepOpen, setLeftoverKeepOpen] = useState(false);
  const [estimatedMinutes, setEstimatedMinutesDraft] = useState<number | null>(null);
  const [prepMinutes, setPrepMinutesDraft] = useState<number | null>(null);
  const [durationOpen, setDurationOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [mealTypeOpen, setMealTypeOpen] = useState(false);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  // Distinct sources/authors already in use elsewhere, so a repeat ("NYT
  // Cooking" or "Alison Roman" on a fifth recipe) is one tap instead of
  // retyping it — same idea as LogbookScreen's availableCategories/
  // availableTags, computed from the data that's actually there rather than
  // a fixed list. Shared helper (distinctRecipeValues/filterRecipeSuggestions
  // in recipeUtils) since Source and Author want the identical derivation.
  const existingSources = useMemo(
    () => distinctRecipeValues(recipes, recipe?.id, r => r.source),
    [recipes, recipe?.id]
  );
  const sourceSuggestions = useMemo(
    () => filterRecipeSuggestions(existingSources, source),
    [existingSources, source]
  );
  const existingAuthors = useMemo(
    () => distinctRecipeValues(recipes, recipe?.id, r => r.author),
    [recipes, recipe?.id]
  );
  const authorSuggestions = useMemo(
    () => filterRecipeSuggestions(existingAuthors, author),
    [existingAuthors, author]
  );
  const [linkOpen, setLinkOpen] = useState(false);

  // The box's whole vocabulary, minus what this recipe already carries — the
  // same "computed from the data that's actually there" idea as the source
  // suggestions above, and the reason recipe tags need no registry (see
  // Recipe.tags): the recipes are the list.
  const tagSuggestions = useMemo(
    () => allRecipeTags(recipes).filter(t => !tags.includes(t)),
    [recipes, tags]
  );

  const addTagFromInput = () => {
    const tag = cleanRecipeTag(newTag);
    // Typing a name the recipe already carries does nothing — the one place
    // this differs from a chip tap, which toggles it back off.
    if (tag && !tags.includes(tag)) setTagsDraft(prev => [...prev, tag]);
    setNewTag('');
    setAddingTag(false);
  };

  useEffect(() => {
    if (!recipe) return;
    setName(recipe.name);
    setNotesDraft(recipe.notes);
    setUrl(recipe.sourceUrl ?? '');
    setAuthorDraft(recipe.author ?? '');
    setSourceDraft(recipe.source ?? recipe.sourceName ?? '');
    setSourceTypeDraft(recipe.sourceType);
    setSourcePageDraft(recipe.sourcePage ?? '');
    setServingsDraft(recipe.servings);
    setServingsMaxDraft(recipe.servingsMax);
    setRecipeYieldDraft(recipe.recipeYield ?? '');
    setLeftoverKeepDaysDraft(recipe.leftoverKeepDays);
    setMealTypeDraft(recipe.mealType);
    setTagsDraft(recipe.tags);
    setTagsOpen(false);
    setAddingTag(false);
    setNewTag('');
    setServingsOpen(false);
    setYieldOpen(false);
    setLeftoverKeepOpen(false);
    setEstimatedMinutesDraft(recipe.estimatedMinutes);
    setPrepMinutesDraft(recipe.prepMinutes);
    setDurationOpen(false);
    setPrepOpen(false);
    setMealTypeOpen(false);
    setAuthorOpen(false);
    setSourceOpen(false);
    setLinkOpen(false);
  }, [recipe]);

  const saveAndClose = () => {
    if (!recipe) { onClose(); return; }
    // renameRecipe refuses an empty name or a collision, and says so by
    // returning false — surfacing it here rather than silently discarding the
    // edit, which is what a plain `if (trimmed)` would do.
    if (name.trim() && name.trim() !== recipe.name && !renameRecipe(recipe.id, name)) {
      Alert.alert('That name is taken', 'Another recipe already goes by that name.');
      return;
    }
    setNotes(recipe.id, notes);
    setSourceUrl(recipe.id, url);
    setAuthor(recipe.id, author);
    setSource(recipe.id, source);
    setSourceType(recipe.id, sourceType);
    setSourcePage(recipe.id, sourcePage);
    setServings(recipe.id, servings, servingsMax);
    setRecipeYield(recipe.id, recipeYield);
    setLeftoverKeepDays(recipe.id, leftoverKeepDays);
    setEstimatedMinutes(recipe.id, estimatedMinutes);
    setPrepMinutes(recipe.id, prepMinutes);
    setMealType(recipe.id, mealType);
    // A tag half-typed when Done was tapped still counts — the field commits on
    // blur, but tapping Done can beat the blur.
    setTags(recipe.id, addingTag ? [...tags, cleanRecipeTag(newTag)] : tags);
    onClose();
  };

  // Spells out what breaks, the way TemplateEditor's does for a nested
  // template: the links aren't rewritten (see useRecipeStore.deleteRecipe), so
  // the recipes using this one are about to show a row they have to deal with.
  const handleDelete = () => {
    if (!recipe) return;
    haptics.warning();
    const usedBy = recipesUsing(recipes, recipe.id);
    const base = `Delete “${recipe.name}”? Anything already on your grocery list stays there.`;
    const message = usedBy.length === 0
      ? base
      : usedBy.length === 1
        ? `${base} It's used as a component of “${usedBy[0].name}”, which will show it as missing until you remove it there.`
        : `${base} It's used as a component of ${usedBy.length} other recipes (${usedBy.map(r => r.name).join(', ')}), which will show it as missing until you remove it there.`;
    Alert.alert(
      'Delete Recipe',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            deleteRecipe(recipe.id);
            onDeleted();
          },
        },
      ]
    );
  };

  if (!recipe) return null;

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
          <Text style={styles.headerTitle}>Edit Recipe</Text>
          <TouchableOpacity
            onPress={handleDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete recipe ${recipe.name}`}
          >
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </>
      }
    >
      <TextInput
        style={styles.titleInput}
        value={name}
        onChangeText={setName}
        placeholder="Recipe name"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={RECIPE_NAME_MAX_LENGTH}
        accessibilityLabel="Recipe name"
      />

      <View style={styles.sectionCard}>
        <EditorRow
          icon="people-outline"
          label="Serves"
          // Hidden while expanded — the stepper right below already shows the
          // current value, and showing it in both places read as the same
          // number appearing twice (same for every row below whose control
          // unfolds in place rather than opening a picker).
          value={servingsOpen ? undefined : (formatServingsRange(servings, servingsMax) ?? undefined)}
          hint="How many the quantities below are written for. Set an upper number too for a range, like a recipe that says “serves 4-6”."
          expanded={servingsOpen}
          onPress={() => { animateLayout(); setServingsOpen(v => !v); }}
          onClear={servings !== null
            ? () => { setServingsDraft(null); setServingsMaxDraft(null); setServingsOpen(false); }
            : undefined}
        />
        {servingsOpen && (
          <>
            <View style={styles.stepperRow}>
              <CountStepper
                value={servings}
                onChange={next => {
                  setServingsDraft(next);
                  // A max that no longer beats the new low end isn't a range —
                  // same rule useRecipeStore.setServings enforces on save.
                  if (next !== null && servingsMax !== null && servingsMax <= next) {
                    setServingsMaxDraft(null);
                  }
                }}
                min={1}
                max={99}
                // The floor clears it, so the row's × isn't the only way back to
                // "no serving size".
                allowNull
                emptyLabel="—"
                label="Servings"
                describeValue={n => (n === null ? 'not set' : `serves ${n}`)}
              />
            </View>
            {servings !== null && (
              <View style={styles.stepperRow}>
                <Text style={styles.stepperLabel}>up to</Text>
                <CountStepper
                  value={servingsMax}
                  onChange={setServingsMaxDraft}
                  min={servings + 1}
                  max={99}
                  allowNull
                  emptyLabel="—"
                  label="Up to"
                  describeValue={n => (n === null ? 'not a range' : `up to ${n}`)}
                />
              </View>
            )}
          </>
        )}
        <EditorRow
          icon="restaurant-outline"
          label="Yield"
          value={yieldOpen ? undefined : (recipeYield.trim() || undefined)}
          hint="What it makes, when a serving count isn't the right unit — “3 cups”, “2 dozen cookies”, “1 loaf”."
          expanded={yieldOpen}
          onPress={() => { animateLayout(); setYieldOpen(v => !v); }}
          onClear={recipeYield.trim() ? () => { setRecipeYieldDraft(''); setYieldOpen(false); } : undefined}
        />
        {yieldOpen && (
          <TextInput
            style={styles.urlInput}
            value={recipeYield}
            onChangeText={setRecipeYieldDraft}
            onSubmitEditing={() => Keyboard.dismiss()}
            placeholder="3 cups, 2 dozen cookies…"
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_SOURCE_MAX_LENGTH}
            returnKeyType="done"
            accessibilityLabel="Recipe yield"
          />
        )}
        <EditorRow
          icon="snow-outline"
          label="Leftovers keep"
          value={leftoverKeepOpen
            ? undefined
            : (leftoverKeepDays === null ? undefined : describeKeepDays(leftoverKeepDays))}
          hint={`How long this dish keeps in the fridge. Logging its leftovers starts at this many days instead of the usual ${LEFTOVER_KEEP_DAYS_DEFAULT}.`}
          expanded={leftoverKeepOpen}
          onPress={() => { animateLayout(); setLeftoverKeepOpen(v => !v); }}
          onClear={leftoverKeepDays !== null
            ? () => { setLeftoverKeepDaysDraft(null); setLeftoverKeepOpen(false); }
            : undefined}
        />
        {leftoverKeepOpen && (
          <View style={styles.stepperRow}>
            <CountStepper
              value={leftoverKeepDays}
              onChange={setLeftoverKeepDaysDraft}
              min={LEFTOVER_KEEP_DAYS_MIN}
              max={LEFTOVER_KEEP_DAYS_MAX}
              // Stepping *below* the floor clears it back to the standard
              // window. Unlike Serves, the floor itself can't double as "no
              // opinion" — "Same day" is a real thing to say about a dish (see
              // LEFTOVER_KEEP_DAYS_MIN), so it takes one more press to get past.
              allowNull
              emptyLabel="—"
              // The same shape LeftoverSheet's keep-for stepper uses, so the two
              // controls that set this number read alike.
              format={n => (n === 0 ? 'Same day' : `${n}d`)}
              label="Leftovers keep"
              describeValue={n => (n === null ? 'not set' : describeKeepDays(n))}
            />
          </View>
        )}
        <CollapsibleField
          label="Meal type"
          summary={mealType ? RECIPE_MEAL_TYPE_LABELS[mealType] : undefined}
          hint="What kind of meal this is, so recipes can be browsed by it."
          expanded={mealTypeOpen}
          onToggle={() => setMealTypeOpen(v => !v)}
        >
          <View style={styles.pillRow}>
            {RECIPE_MEAL_TYPES.map(type => (
              <TouchableOpacity
                key={type}
                style={[styles.pill, mealType === type && styles.pillActiveNeutral]}
                activeOpacity={interaction.activeOpacity}
                onPress={() => {
                  haptics.tap();
                  setMealTypeDraft(mealType === type ? null : type);
                  setMealTypeOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={RECIPE_MEAL_TYPE_LABELS[type]}
                accessibilityState={{ selected: mealType === type }}
              >
                <Text style={[styles.pillText, mealType === type && styles.pillTextActive]}>
                  {RECIPE_MEAL_TYPE_LABELS[type]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </CollapsibleField>
        <CollapsibleField
          label="Tags"
          summary={tags.length > 0 ? tags.join(', ') : undefined}
          hint="Free-form labels — “weeknight”, “vegetarian”, “thai”. Filter the recipe box by them, and combine two to narrow it."
          expanded={tagsOpen}
          onToggle={() => setTagsOpen(v => !v)}
        >
          <View style={styles.tagRow}>
            {tags.map(tag => (
              <TouchableOpacity
                key={tag}
                style={[styles.tagChip, { backgroundColor: tagColor(tag) + '33' }]}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); setTagsDraft(prev => toggleRecipeTag(prev, tag)); }}
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${tag}`}
              >
                <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                <Text style={[styles.tagChipText, { color: tagColor(tag) }]}>{tag}</Text>
                <Ionicons name="close" size={12} color={tagColor(tag)} />
              </TouchableOpacity>
            ))}
            {addingTag ? (
              <TextInput
                autoFocus
                style={styles.tagInput}
                value={newTag}
                onChangeText={setNewTag}
                onSubmitEditing={addTagFromInput}
                onBlur={addTagFromInput}
                placeholder="tag name"
                placeholderTextColor={colors.textTertiary}
                maxLength={RECIPE_TAG_MAX_LENGTH}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="New tag name"
              />
            ) : (
              // Neutral, not accent: it sits at the end of a row of chips that
              // tint themselves from tagPalette, whose first colour *is* the
              // accent — an accent pill there reads as one more tag.
              <InlineAction icon="add" label="Add tag" variant="neutral" onPress={() => setAddingTag(true)} />
            )}
          </View>
          {tagSuggestions.length > 0 && (
            <View style={styles.tagSuggestions}>
              {tagSuggestions.slice(0, 8).map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={styles.tagSuggestion}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => { haptics.tap(); setTagsDraft(prev => toggleRecipeTag(prev, tag)); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Add tag ${tag}`}
                >
                  <Text style={styles.tagSuggestionText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </CollapsibleField>
        <EditorRow
          icon="alarm-outline"
          label="Prep time"
          value={prepOpen ? undefined : (prepMinutes !== null ? formatDuration(prepMinutes) : undefined)}
          hint="Chopping, marinating, mise en place — before the cook clock starts. Its own timer on the recipe page, independent of the cook timer."
          expanded={prepOpen}
          onPress={() => { animateLayout(); setPrepOpen(v => !v); }}
          onClear={prepMinutes !== null ? () => { setPrepMinutesDraft(null); setPrepOpen(false); } : undefined}
        />
        {prepOpen && (
          <View style={styles.stepperRow}>
            <CountStepper
              value={prepMinutes !== null ? Math.round(prepMinutes / DURATION_STEP_MINUTES) : null}
              onChange={units => setPrepMinutesDraft(units === null ? null : units * DURATION_STEP_MINUTES)}
              min={1}
              max={DURATION_MAX_MINUTES / DURATION_STEP_MINUTES}
              allowNull
              emptyLabel="—"
              label="Prep time"
              format={units => formatDuration(units * DURATION_STEP_MINUTES)}
              describeValue={units => (units === null ? 'not set' : formatDuration(units * DURATION_STEP_MINUTES))}
            />
          </View>
        )}
        <EditorRow
          icon="time-outline"
          label="Cook time"
          value={durationOpen ? undefined : (estimatedMinutes !== null ? formatDuration(estimatedMinutes) : undefined)}
          hint="How long this takes once the cook clock starts — doubles as the cook timer's countdown on the recipe page."
          expanded={durationOpen}
          onPress={() => { animateLayout(); setDurationOpen(v => !v); }}
          onClear={estimatedMinutes !== null ? () => { setEstimatedMinutesDraft(null); setDurationOpen(false); } : undefined}
        />
        {durationOpen && (
          <View style={styles.stepperRow}>
            <CountStepper
              value={estimatedMinutes !== null ? Math.round(estimatedMinutes / DURATION_STEP_MINUTES) : null}
              onChange={units => setEstimatedMinutesDraft(units === null ? null : units * DURATION_STEP_MINUTES)}
              min={1}
              max={DURATION_MAX_MINUTES / DURATION_STEP_MINUTES}
              allowNull
              emptyLabel="—"
              label="Cook time"
              format={units => formatDuration(units * DURATION_STEP_MINUTES)}
              describeValue={units => (units === null ? 'not set' : formatDuration(units * DURATION_STEP_MINUTES))}
            />
          </View>
        )}
        {(prepMinutes !== null || estimatedMinutes !== null) && (
          <Text style={styles.totalTimeHint}>
            Total {formatDuration(totalMinutes({ prepMinutes, estimatedMinutes })!)}
            {prepMinutes !== null && estimatedMinutes !== null
              ? ` (${formatDuration(prepMinutes)} prep + ${formatDuration(estimatedMinutes)} cook)`
              : ''}
          </Text>
        )}
        <EditorRow
          icon="person-outline"
          label="Author"
          value={authorOpen ? undefined : (author.trim() || undefined)}
          hint="Who it's from — a person, not a publication."
          expanded={authorOpen}
          onPress={() => { animateLayout(); setAuthorOpen(v => !v); }}
          onClear={author.trim() ? () => { setAuthorDraft(''); setAuthorOpen(false); } : undefined}
        />
        {authorOpen && (
          <TextInput
            style={styles.urlInput}
            value={author}
            onChangeText={setAuthorDraft}
            onSubmitEditing={() => Keyboard.dismiss()}
            placeholder="Alison Roman…"
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_SOURCE_MAX_LENGTH}
            returnKeyType="done"
            accessibilityLabel="Recipe author"
          />
        )}
        {authorOpen && authorSuggestions.length > 0 && (
          <View style={styles.suggestionChips}>
            {authorSuggestions.map(value => (
              <TouchableOpacity
                key={value}
                style={styles.suggestionChip}
                activeOpacity={interaction.activeOpacity}
                onPress={() => setAuthorDraft(value)}
                accessibilityRole="button"
                accessibilityLabel={`Use author ${value}`}
              >
                <Text style={styles.suggestionChipText} numberOfLines={1}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <EditorRow
          icon="newspaper-outline"
          label="Source"
          value={sourceOpen ? undefined : (source.trim() || undefined)}
          hint="Where it's from — a site, a magazine, a cookbook."
          expanded={sourceOpen}
          onPress={() => { animateLayout(); setSourceOpen(v => !v); }}
          onClear={source.trim() ? () => { setSourceDraft(''); setSourceOpen(false); } : undefined}
        />
        {sourceOpen && (
          <View style={styles.pillRow}>
            {RECIPE_SOURCE_TYPES.map(type => (
              <TouchableOpacity
                key={type}
                style={[styles.pill, sourceType === type && styles.pillActiveNeutral]}
                activeOpacity={interaction.activeOpacity}
                onPress={() => {
                  haptics.tap();
                  setSourceTypeDraft(sourceType === type ? null : type);
                }}
                accessibilityRole="button"
                accessibilityLabel={RECIPE_SOURCE_TYPE_LABELS[type]}
                accessibilityState={{ selected: sourceType === type }}
              >
                <Text style={[styles.pillText, sourceType === type && styles.pillTextActive]}>
                  {RECIPE_SOURCE_TYPE_LABELS[type]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {sourceOpen && (
          <TextInput
            style={styles.urlInput}
            value={source}
            onChangeText={setSourceDraft}
            onSubmitEditing={() => Keyboard.dismiss()}
            placeholder="NYT Cooking, Bon Appétit…"
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_SOURCE_MAX_LENGTH}
            returnKeyType="done"
            accessibilityLabel="Recipe source"
          />
        )}
        {sourceOpen && sourceType === 'cookbook' && (
          <View style={styles.pageRow}>
            <Text style={styles.pageLabel}>Page</Text>
            <TextInput
              style={styles.pageInput}
              value={sourcePage}
              onChangeText={setSourcePageDraft}
              onSubmitEditing={() => Keyboard.dismiss()}
              placeholder="142"
              placeholderTextColor={colors.textTertiary}
              maxLength={RECIPE_PAGE_MAX_LENGTH}
              returnKeyType="done"
              accessibilityLabel="Cookbook page number"
            />
          </View>
        )}
        {sourceOpen && sourceSuggestions.length > 0 && (
          <View style={styles.suggestionChips}>
            {sourceSuggestions.map(value => (
              <TouchableOpacity
                key={value}
                style={styles.suggestionChip}
                activeOpacity={interaction.activeOpacity}
                onPress={() => setSourceDraft(value)}
                accessibilityRole="button"
                accessibilityLabel={`Use source ${value}`}
              >
                <Text style={styles.suggestionChipText} numberOfLines={1}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <EditorRow
          icon="link-outline"
          label="Link"
          value={linkOpen ? undefined : (url.trim() || undefined)}
          expanded={linkOpen}
          onPress={() => { animateLayout(); setLinkOpen(v => !v); }}
          onClear={url.trim() ? () => { setUrl(''); setLinkOpen(false); } : undefined}
        />
        {linkOpen && (
          <TextInput
            style={styles.urlInput}
            value={url}
            onChangeText={setUrl}
            onSubmitEditing={() => Keyboard.dismiss()}
            placeholder="Where it came from"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            accessibilityLabel="Recipe link"
          />
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotesDraft}
          placeholder="Method, timings, what you'd change"
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Recipe notes"
        />
      </View>
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  titleInput: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: fontWeight.semibold,
    // A box height rather than lineHeight: RN puts lineHeight straight onto the
    // iOS paragraph style with no baseline offset, sitting the glyphs low.
    minHeight: 44,
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: spacing.sm,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  stepperLabel: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  // Same tag treatment as TaskEditor's — a tag chip looks the same wherever
  // tags are edited in this app.
  tagRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    alignItems: 'center', paddingBottom: spacing.sm,
  },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagChipText: { fontSize: font.sm, fontWeight: fontWeight.medium },
  tagInput: {
    color: colors.text, fontSize: font.sm,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 4, paddingHorizontal: 4, minWidth: 80,
  },
  tagSuggestions: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.xs, paddingBottom: spacing.sm,
  },
  tagSuggestion: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  tagSuggestionText: { color: colors.textSecondary, fontSize: font.xs },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingBottom: spacing.sm },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  pillActiveNeutral: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
  urlInput: {
    color: colors.text,
    fontSize: font.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
  },
  notesInput: {
    color: colors.text,
    fontSize: font.md,
    paddingVertical: spacing.sm,
    minHeight: 96,
  },
  // Shared by Source's and Author's suggestion rows — both are the identical
  // "pick a value already used elsewhere" chip.
  suggestionChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  suggestionChip: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    maxWidth: 220,
  },
  suggestionChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  totalTimeHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    textAlign: 'right',
    paddingBottom: spacing.sm,
  },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  pageLabel: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  pageInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    paddingVertical: 4,
  },
});
