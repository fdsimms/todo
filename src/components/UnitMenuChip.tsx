import React, { useMemo } from 'react';
import { isNutrientUnitOption, type FoodUnitOption } from '../utils/foodLog';
import { ChoiceMenuChip, type ChoiceGroup } from './ChoiceMenuChip';

/** The key a caller stores for "type the amount as free text". */
export const OTHER_UNIT_KEY = 'other';

interface Props {
  options: FoodUnitOption[];
  /** The chosen option's key, `OTHER_UNIT_KEY`, or null while nothing is. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** For `SheetModal`'s development warnings. */
  name: string;
  /** The chip's fill, one step off the field it sits in. Defaults to a card's `bgSecondary`. */
  chipBackground?: string;
}

/**
 * The unit beside an amount field: a chip showing the current unit, which opens
 * a short menu of every unit the food's panel can measure.
 *
 * A row of pills made the units, the amounts-by-nutrient (cal, g protein) and
 * the free-text escape one block of ten equal choices, when nearly every
 * amount is a serving or grams. The chip keeps the common case to the field
 * itself and puts the rest one tap away, grouped: units, then amounts stated as
 * a quantity of one nutrient (`isNutrientUnitOption`), then "Something else".
 * The menu itself is `ChoiceMenuChip`.
 */
export function UnitMenuChip({ options, selectedKey, onSelect, name, chipBackground }: Props) {
  const groups = useMemo<ChoiceGroup[]>(() => {
    const nutrients = options.filter(isNutrientUnitOption);
    return [
      { options: options.filter(o => !isNutrientUnitOption(o)) },
      ...(nutrients.length > 0 ? [{ heading: 'BY NUTRIENT', options: nutrients }] : []),
      { heading: 'OTHER', options: [{ key: OTHER_UNIT_KEY, label: 'Something else' }] },
    ];
  }, [options]);

  return (
    <ChoiceMenuChip
      groups={groups}
      selectedKey={selectedKey}
      onSelect={onSelect}
      noun="Unit"
      name={name}
      labelOverride={selectedKey === OTHER_UNIT_KEY ? 'Other' : undefined}
      background={chipBackground}
    />
  );
}
