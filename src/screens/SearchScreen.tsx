import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import type { Recipe, Task } from '../types';
import type { SearchResult } from '../utils/fuzzySearch';
import { fuzzySearch, scoreSubstring } from '../utils/fuzzySearch';
import { describeCookHistory, matchRecipes, type RecipeMatch, type RecipeMatchField } from '../utils/recipeUtils';
import { displayTitleFor } from '../utils/visibilityUtils';
import { tagColor } from '../utils/tagColor';
import { haptics } from '../utils/haptics';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, iconSize, interaction, checkboxRadius, type Colors } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { SearchField } from '../components/SearchField';
import { EmptyState } from '../components/EmptyState';
import { HighlightedText } from '../components/HighlightedText';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { format } from 'date-fns/format';

// How long the field waits for typing to pause before the expensive
// fuzzySearch recompute runs. The TextInput's own value/onChangeText stay
// bound to the raw `query` state below regardless — this only delays the
// results useMemo, so fast typing never desyncs the controlled input from
// what's on screen while still keeping the recompute off every keystroke.
const SEARCH_DEBOUNCE_MS = 180;

const CHECKBOX_SIZE = 20;

/**
 * Search is scoped, not merged, and the two reasons are structural rather than
 * aesthetic.
 *
 * The rankers aren't comparable. fuzzySearch sums weighted per-word scores into
 * the hundreds (a title match alone is worth up to 240); matchRecipes returns a
 * single 3/2/1/0.75/0.5/0.4/0.25 rung. Interleaving them means inventing a
 * conversion between those two number lines with nothing to check it against,
 * and every wrong guess reads as the app burying what you asked for.
 *
 * And a tap means different things. A task opens TaskEditor *on this screen*; a
 * recipe pushes RecipeDetail. One list whose rows silently do one or the other,
 * with nothing promising which, is worse than two lists.
 *
 * There is deliberately **no "All" scope** — it would be the merged ranking
 * again, wearing a hat. What stops a scope from being a dead end is the count on
 * the other pill (and the empty state's offer to cross over), which tells you
 * where the matches are *before* you conclude the app hasn't got them.
 */
type SearchScope = 'tasks' | 'recipes';
const SCOPES: { key: SearchScope; label: string }[] = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'recipes', label: 'Recipes' },
];

/**
 * Why a recipe is in the results, when it isn't the obvious reason. Searching
 * "fennel" and being handed "Roast chicken" is only obviously right if the row
 * says "Fennel" underneath it — and now that attribution and notes match too
 * (#1366), the share of results needing that explanation went up, not down.
 */
function matchCaption(
  field: RecipeMatchField,
  matchedText: string | null
): { icon: React.ComponentProps<typeof Ionicons>['name']; text: string } | null {
  // A name match needs no caption — the title is right there, highlighted.
  if (field === 'name') return null;
  // Notes carries no matchedText: any snippet short enough to sit on a row
  // would cut the sentence in half, so the row says where to look instead.
  if (field === 'notes') return { icon: 'document-text-outline', text: 'In notes' };
  if (!matchedText) return null;
  if (field === 'tag') return { icon: 'pricetag-outline', text: matchedText };
  if (field === 'ingredient') return { icon: 'nutrition-outline', text: matchedText };
  return { icon: 'book-outline', text: matchedText };
}

function RecipeResultItem({ match, query, onPress, styles, colors }: {
  match: RecipeMatch;
  query: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { recipe, field, matchedText } = match;

  // Highlighted only when the *name* is what matched. scoreSubstring will
  // happily find a subsequence in any name, so drawing it for a recipe that
  // actually matched on its ingredient would underline letters scattered
  // through the title and point at the wrong thing entirely.
  const nameRanges = field === 'name' ? scoreSubstring(recipe.name, query).ranges : [];
  const caption = matchCaption(field, matchedText);
  // The answer to "when did we last have the ragù" — the question that opened
  // #1366. It's read off the recipe's own cookCount/lastCookedAt rather than by
  // scanning the plan, because plan entries purge at 180 days and the store
  // only ever holds the week it was asked for.
  const history = describeCookHistory(recipe);

  const a11yLabel = [
    recipe.name,
    caption ? `matched ${caption.text}` : null,
    history || null,
  ].filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Double tap to open recipe"
    >
      <View style={styles.statusIcon}>
        <View style={styles.recipeGlyph}>
          <Ionicons name="restaurant-outline" size={12} color={colors.accent} />
        </View>
      </View>

      <View style={styles.resultContent}>
        <HighlightedText
          text={recipe.name}
          ranges={nameRanges}
          style={styles.resultTitle}
          highlightStyle={styles.highlight}
          numberOfLines={2}
        />

        {(caption || history.length > 0) && (
          <View style={styles.resultMeta}>
            {caption && (
              <View style={styles.projectChip}>
                <Ionicons name={caption.icon} size={iconSize.xs} color={colors.textSecondary} />
                <Text style={styles.metaText} numberOfLines={1}>{caption.text}</Text>
              </View>
            )}
            {/* A step dimmer than the caption beside it. Both are grey text at
                font.xs, so at the same colour "Salmon fillets" and "Cooked once
                · last on 2 Aug" abut into one run-on string with only a gap
                between them — the task rows avoid that by colour-coding their
                meta (tag dots, green Done, orange Archived), and this row has
                no such coding to lean on. Tertiary also ranks them correctly:
                why it matched is why it's on screen, the history is context. */}
            {history.length > 0 && <Text style={styles.historyText}>{history}</Text>}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function SearchResultItem({ result, onPress, styles, colors }: {
  result: SearchResult;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const { task, titleMatches, projectName, projectMatches } = result;
  const isCompleted = task.completed;

  const completedDate = task.completedAt
    ? format(new Date(task.completedAt), 'MMM d')
    : null;

  const displayTitle = displayTitleFor(task);

  const a11yLabel = [
    displayTitle,
    projectName ? `in ${projectName}` : null,
    task.archived ? 'archived' : null,
    isCompleted ? `completed${completedDate ? ` ${completedDate}` : ''}` : null,
    !isCompleted && task.dueDate ? `due ${format(new Date(task.dueDate), 'MMM d')}` : null,
  ].filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Double tap to open task"
    >
      <View style={styles.statusIcon}>
        <View style={[styles.checkbox, isCompleted && styles.checkboxDone]}>
          {isCompleted && <Ionicons name="checkmark" size={12} color={colors.onAccent} />}
        </View>
      </View>

      <View style={styles.resultContent}>
        <HighlightedText
          text={displayTitle}
          ranges={titleMatches}
          style={[styles.resultTitle, isCompleted && styles.resultTitleDone]}
          highlightStyle={styles.highlight}
          numberOfLines={2}
        />

        <View style={styles.resultMeta}>
          {task.archived && (
            <Text style={styles.archivedLabel}>Archived</Text>
          )}
          {/* Ahead of the tags and dates, and highlighted like the title: a
              result can match on its project's name alone (fuzzySearch scores
              it), and until now that row gave no hint why it was in the list. */}
          {projectName && (
            <View style={styles.projectChip}>
              <Ionicons name="briefcase-outline" size={iconSize.xs} color={colors.textSecondary} />
              <HighlightedText
                text={projectName}
                ranges={projectMatches}
                style={styles.metaText}
                highlightStyle={styles.highlight}
                numberOfLines={1}
              />
            </View>
          )}
          {task.tags.slice(0, 3).map(tag => (
            <View key={tag} style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
          ))}
          {task.tags.length > 0 && (
            <Text style={styles.metaText}>{task.tags.slice(0, 2).join(', ')}</Text>
          )}
          {isCompleted && completedDate && (
            <Text style={styles.completedLabel}>Done {completedDate}</Text>
          )}
          {!isCompleted && task.dueDate && (
            <Text style={styles.metaText}>Due {format(new Date(task.dueDate), 'MMM d')}</Text>
          )}
          {task.notes.length > 0 && (
            <Text style={styles.notesPreview} numberOfLines={1}>{task.notes}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function SearchScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const tabBarHeight = useBottomTabBarHeight();
  const tasks = useTaskStore(s => s.tasks);
  const projects = useProjectStore(s => s.projects);
  const recipes = useRecipeStore(s => s.recipes);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('tasks');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Handed a query by quick search (see QuickSearchModal's footer row).
  // `at` is stamped fresh on every handoff, so searching the same term twice
  // still lands — same trick as resetToToday in navigationRef.ts.
  //
  // Applied during render rather than from an effect because this screen
  // stays mounted in the tab navigator: an effect only runs after the frame
  // is committed, so the user would see one frame of the previous query
  // before it swapped.
  const [handledQueryAt, setHandledQueryAt] = useState<number | undefined>(undefined);
  if (route.params?.at !== undefined && route.params.at !== handledQueryAt) {
    setHandledQueryAt(route.params.at);
    setQuery(route.params.query ?? '');
    // Back to Tasks with the handoff. Quick search is tasks-only by design, so
    // its "See all 12 results" names a task count — landing on Recipes would
    // answer a different question than the one that was just asked.
    setScope('tasks');
  }

  // Retyping a query you just typed would make the handoff a net loss, so the
  // field arrives focused and ready to be refined.
  useEffect(() => {
    if (handledQueryAt === undefined) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [handledQueryAt]);

  const projectNamesById = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects]
  );

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const results: SearchResult[] = useMemo(
    () => fuzzySearch(tasks, debouncedQuery, projectNamesById),
    [tasks, debouncedQuery, projectNamesById]
  );

  // Both scopes are searched on every query regardless of which is showing —
  // that's what pays for the counts on the pills, and the counts are the whole
  // reason a scoped search doesn't dead-end at "No results" on a term the app
  // does hold. Both rankers run over in-memory arrays behind the same debounce.
  const recipeResults: RecipeMatch[] = useMemo(
    () => matchRecipes(debouncedQuery, recipes),
    [recipes, debouncedQuery]
  );

  const counts: Record<SearchScope, number> = {
    tasks: results.length,
    recipes: recipeResults.length,
  };
  const scopeCount = counts[scope];
  const otherScope: SearchScope = scope === 'tasks' ? 'recipes' : 'tasks';
  const otherCount = counts[otherScope];

  const activeResults = results.filter(r => !r.task.completed);
  const completedResults = results.filter(r => r.task.completed);

  type ListItem =
    | { type: 'sectionHeader'; label: string }
    | { type: 'result'; result: SearchResult }
    | { type: 'recipe'; match: RecipeMatch };

  const listData: ListItem[] = useMemo(() => {
    // Recipes have no active/completed split to section on — a recipe is never
    // "done" — so they render as one ranked run.
    if (scope === 'recipes') {
      return recipeResults.map(match => ({ type: 'recipe', match } as ListItem));
    }
    if (results.length === 0) return [];
    const items: ListItem[] = [];
    if (activeResults.length > 0) {
      items.push({ type: 'sectionHeader', label: 'Active' });
      activeResults.forEach(r => items.push({ type: 'result', result: r }));
    }
    if (completedResults.length > 0) {
      items.push({ type: 'sectionHeader', label: 'Completed' });
      completedResults.forEach(r => items.push({ type: 'result', result: r }));
    }
    return items;
  }, [results, recipeResults, scope]);

  const openTask = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const openRecipe = (recipe: Recipe) => {
    haptics.tap();
    navigation.navigate('RecipeDetail', { recipeId: recipe.id });
  };

  const switchScope = (next: SearchScope) => {
    haptics.tap();
    setScope(next);
  };

  const handleQuickAddOpenFull = (draft: TaskDraft) => {
    setQuickAddVisible(false);
    setEditingTask(null);
    setEditorInitialDraft(draft);
    setEditorVisible(true);
  };

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'sectionHeader') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{item.label}</Text>
        </View>
      );
    }
    if (item.type === 'recipe') {
      return (
        <RecipeResultItem
          match={item.match}
          query={debouncedQuery}
          onPress={() => openRecipe(item.match.recipe)}
          styles={styles}
          colors={colors}
        />
      );
    }
    return (
      <SearchResultItem
        result={item.result}
        onPress={() => openTask(item.result.task)}
        styles={styles}
        colors={colors}
      />
    );
  };

  const showEmpty = query.trim().length > 0 && scopeCount === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Search" />

      <SearchField
        ref={inputRef}
        style={styles.searchBar}
        placeholder={scope === 'recipes' ? 'Search recipes…' : 'Search todos…'}
        value={query}
        onChangeText={setQuery}
      />

      {/* Counts appear only once something's been typed — before that they'd
          all read 0 and look like the app is empty rather than un-asked. */}
      <View style={styles.scopePills}>
        {SCOPES.map(({ key, label }) => {
          const active = scope === key;
          const count = counts[key];
          const showCount = query.trim().length > 0;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.scopePill, active && styles.scopePillActive]}
              onPress={() => switchScope(key)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={showCount ? `${label}, ${count} results` : label}
            >
              <Text style={[styles.scopePillText, active && styles.scopePillTextActive]}>
                {label}
              </Text>
              {showCount && (
                <View style={[styles.scopePillBadge, active && styles.scopePillBadgeActive]}>
                  <Text style={[styles.scopePillBadgeText, active && styles.scopePillBadgeTextActive]}>
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* EmptyState centers its "Create task" button vertically in whatever
          height it's given — on iOS that height doesn't shrink for the
          keyboard on its own, so with the search field still focused (the
          common case: you typed a query, got no results) the button centered
          on the full screen height landed underneath the keyboard, out of
          reach. KeyboardAvoidingView pads the bottom by the keyboard's
          height, so EmptyState re-centers above it instead. */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {showEmpty ? (
          /* The cross-over offer, and the reason scoping a search is safe: the
             one failure mode of a scope is deciding the app hasn't got what you
             asked for, when it's simply filed under the other pill. When the
             other scope has hits, going there beats anything else this screen
             could offer — including creating a task named after a recipe you
             already own. Only with nothing anywhere does "Create task" win. */
          <EmptyState
            key="no-results"
            icon="search-outline"
            title="No results"
            subtitle={
              scope === 'recipes'
                ? `No recipes match "${query}"`
                : `No todos match "${query}"`
            }
            actionLabel={
              otherCount > 0
                ? otherScope === 'recipes'
                  ? `See ${otherCount} recipe${otherCount === 1 ? '' : 's'}`
                  : `See ${otherCount} todo${otherCount === 1 ? '' : 's'}`
                : scope === 'tasks' ? 'Create task' : undefined
            }
            onAction={
              otherCount > 0
                ? () => switchScope(otherScope)
                : scope === 'tasks' ? () => setQuickAddVisible(true) : undefined
            }
            bottomOffset={tabBarHeight}
          />
        ) : query.trim().length === 0 ? (
          /* The recipe subtitle lists the fields on purpose — searching a
             recipe box by ingredient or author is the whole capability, and
             this prompt is the only place in the app that says so. */
          scope === 'recipes' ? (
            <EmptyState
              key="prompt-recipes"
              icon="search-outline"
              title="Find any recipe"
              subtitle="Search by name, tag, ingredient, author or notes"
              bottomOffset={tabBarHeight}
            />
          ) : (
            <EmptyState key="prompt" icon="search-outline" title="Find any todo" subtitle="Search active and completed todos" bottomOffset={tabBarHeight} />
          )
        ) : (
          <FlatList
            data={listData}
            keyExtractor={(item, i) =>
              item.type === 'sectionHeader' ? `h-${item.label}`
                : item.type === 'recipe' ? `r-${item.match.recipe.id}`
                : item.result.task.id
            }
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          />
        )}
      </KeyboardAvoidingView>

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        initialDraft={editorInitialDraft}
        onClose={() => { setEditorVisible(false); setEditorInitialDraft(null); }}
      />

      <QuickAddModal
        visible={quickAddVisible}
        onClose={() => setQuickAddVisible(false)}
        onOpenFull={handleQuickAddOpenFull}
        initialTitle={query}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  keyboardAvoiding: { flex: 1 },

  searchBar: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },

  // Same pill treatment as Today's view-mode switcher, which is the app's
  // established "these are lenses over one screen" control. A plain row rather
  // than that one's horizontal ScrollView: two or three scopes fit at any
  // width, and a scroll view that never scrolls only costs a hidden option.
  scopePills: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  scopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgSecondary,
  },
  scopePillActive: { backgroundColor: colors.accent },
  scopePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  scopePillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  // The count carries the whole anti-dead-end job, so it has to stay legible on
  // both pill surfaces — hence a second pair of tokens rather than one badge
  // colour that only works on the accent fill.
  scopePillBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: colors.bgQuaternary,
    alignItems: 'center',
  },
  scopePillBadgeActive: { backgroundColor: colors.bgSecondary },
  scopePillBadgeText: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold },
  scopePillBadgeTextActive: { color: colors.accent },

  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionHeaderText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Same inset-grouped card footprint as TaskItem rows.
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingRight: spacing.md,
    gap: spacing.sm,
  },
  statusIcon: {
    marginLeft: spacing.md,
    paddingTop: 1,
  },
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: checkboxRadius(CHECKBOX_SIZE),
    borderCurve: 'continuous',
    borderWidth: border.md,
    borderColor: colors.bgQuaternary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  // Sized and placed exactly like the checkbox it replaces, so the two scopes'
  // rows share one text column — but round and filled rather than a square
  // outline, because a recipe row has nothing to tick and a checkbox that does
  // nothing is the kind of control people tap once and stop trusting.
  recipeGlyph: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  resultContent: { flex: 1, gap: 3 },
  resultTitle: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: 21,
  },
  resultTitleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  highlight: {
    color: colors.accent,
    fontWeight: '700',
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  // Same icon + label pairing TaskItem's meta chips use, at this row's own
  // meta colour. flexShrink so a long project name gives way to the tags and
  // dates rather than wrapping the row on its own.
  projectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  metaText: { color: colors.textSecondary, fontSize: font.xs },
  historyText: { color: colors.textTertiary, fontSize: font.xs },
  completedLabel: { color: colors.green, fontSize: font.xs },
  archivedLabel: { color: colors.orange, fontSize: font.xs, fontWeight: fontWeight.semibold },
  notesPreview: {
    color: colors.textTertiary,
    fontSize: font.xs,
    flex: 1,
  },
});
