import React, { useMemo } from 'react';
import { ChipFilterSheet, type ChipFilterGroup } from './ChipFilterSheet';
import { tagColor } from '../utils/tagColor';
import { toggleRecipeTag } from '../utils/recipeTags';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The whole box's vocabulary, alphabetical — see allRecipeTags. */
  tags: readonly string[];
  /** How many recipes each tag is on — see recipeTagCounts. */
  counts: ReadonlyMap<string, number>;
  selected: readonly string[];
  onChange: (tags: string[]) => void;
}

/**
 * The recipe box's tag filter, in a wrapping bottom sheet rather than the
 * horizontal chip row it started as. A scrolling row hides every chip past
 * what fits on screen behind a swipe nobody is prompted to make, and a tag box
 * can run past what a phone-width row can even gesture through (a household's
 * grocery aisles alone are north of a dozen; a personal recipe vocabulary —
 * cuisines, diets, occasions, "quick", "make ahead" — gets there fast).
 * Wrapping puts the whole vocabulary on screen at once.
 *
 * Multi-select: recipe tags AND together (see filterRecipesByTags), so every
 * chip is a checkbox, not a single "which one" choice — picking a second
 * doesn't replace the first.
 */
export function RecipeTagFilterSheet({ visible, onClose, tags, counts, selected, onChange }: Props) {
  const groups = useMemo<ChipFilterGroup[]>(() => [{
    label: '',
    options: tags.map(tag => {
      const count = counts.get(tag) ?? 0;
      return { key: tag, label: tag, color: tagColor(tag), count, accessibilityLabel: `${tag}, ${count} recipes` };
    }),
    selected: [...selected],
    onToggle: tag => onChange(toggleRecipeTag(selected, tag)),
    activeStyle: 'tint',
    checkbox: true,
  }], [tags, counts, selected, onChange]);

  return (
    <ChipFilterSheet
      visible={visible}
      onClose={onClose}
      title="Filter by tag"
      groups={groups}
      onClearAll={() => onChange([])}
    />
  );
}
