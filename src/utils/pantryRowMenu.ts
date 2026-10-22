/**
 * What a Pantry row's chip says and what its menu offers.
 *
 * The chip is the row's one tap target, in place of the ✕ that only ever said
 * "out". It names the state a row can be in on its own (`low`, else `have`),
 * and opens a menu of everything a person might say about the packet. Pure so
 * the rules are written once and tested: `KitchenScreen` maps each `key` to the
 * store action that already writes it (the item sheet's pills), so a menu entry
 * and the pill beside it can't mean different things.
 *
 * **Used it up and Went bad are separate entries, not a question asked after
 * Out.** The answer is what `markOutOfMany` records against the item, so
 * choosing it up front costs a tap less than the follow-up question did.
 * A container (a leftover) has its own two outcomes, "Finished it" and
 * "Threw it out", chosen on purpose here as in its sheet: nothing is guessed as
 * eaten. Neither is offered on a box or a portion: how often a food gets wasted is an
 * item-level record (see `markProductsOutOf`), so a box's menu has one plain
 * "Out of it" rather than an answer it would drop.
 */

export type PantryRowAction =
  | 'have'
  | 'low'
  | 'clearLow'
  | 'usedUp'
  | 'spoiled'
  | 'boughtMore'
  | 'opened'
  | 'unopened'
  | 'freeze'
  | 'thaw'
  | 'out'
  | 'finished'
  | 'tossed'
  | 'split'
  | 'edit';

export interface PantryRowFacts {
  /** A catalog row, one of an item's boxes (`ItemProduct`), or a container. */
  kind: 'grocery' | 'product' | 'leftover';
  /** A box that is some of the pack in the freezer (`ItemProduct.isPortion`). */
  portion: boolean;
  low: boolean;
  opened: boolean;
  frozen: boolean;
}

export interface PantryRowMenuEntry {
  key: PantryRowAction;
  label: string;
}

export type PantryRowChip = 'have' | 'low' | 'fridge' | 'freezer';

/**
 * A box can't be running low: that mark lives on the item. A container says
 * where it is, since that is the one thing about it a chip can state.
 */
export function pantryRowChip(facts: PantryRowFacts): PantryRowChip {
  if (facts.kind === 'leftover') return facts.frozen ? 'freezer' : 'fridge';
  return facts.kind === 'grocery' && facts.low ? 'low' : 'have';
}

export const PANTRY_CHIP_LABEL: Record<PantryRowChip, string> = {
  have: 'Have it',
  low: 'Low',
  fridge: 'Fridge',
  freezer: 'Freezer',
};

export type PantryRowMark = 'opened' | 'frozen';

/**
 * The tags a row wears under its name. Frozen replaces opened, the way the
 * row's caption already does (`kitchenInventory` drops the opened clause for a
 * frozen row): a packet in the freezer is read as frozen, not as a jar that was
 * once opened.
 */
export function pantryRowMarks(facts: PantryRowFacts): PantryRowMark[] {
  // The chip already says a container is in the freezer.
  if (facts.kind === 'leftover') return [];
  if (facts.frozen) return ['frozen'];
  return facts.opened ? ['opened'] : [];
}

export function pantryRowMenu(facts: PantryRowFacts): PantryRowMenuEntry[] {
  if (facts.kind === 'leftover') {
    return [
      { key: 'finished', label: 'Finished it' },
      { key: 'tossed', label: 'Threw it out' },
      facts.frozen
        ? { key: 'thaw', label: 'Take out of the freezer' }
        : { key: 'freeze', label: 'Put in the freezer' },
      { key: 'split', label: facts.frozen ? 'Split into the fridge' : 'Split into the freezer' },
      { key: 'edit', label: 'Edit' },
    ];
  }
  // A portion is nothing but the packet: it has no clock to open or freeze,
  // and being out of it deletes it.
  if (facts.portion) return [{ key: 'out', label: 'Used up' }];
  const opened: PantryRowMenuEntry = facts.opened
    ? { key: 'unopened', label: 'Not opened' }
    : { key: 'opened', label: 'Opened' };
  const frozen: PantryRowMenuEntry = facts.frozen
    ? { key: 'thaw', label: 'Out of the freezer' }
    : { key: 'freeze', label: 'In the freezer' };
  if (facts.kind === 'product') {
    return [opened, frozen, { key: 'out', label: 'Out of it' }];
  }
  return [
    { key: 'have', label: 'Have it' },
    facts.low
      ? { key: 'clearLow', label: 'Not running low' }
      : { key: 'low', label: 'Running low' },
    { key: 'usedUp', label: 'Used it up' },
    { key: 'spoiled', label: 'Went bad' },
    { key: 'boughtMore', label: 'Bought more' },
    opened,
    frozen,
  ];
}
