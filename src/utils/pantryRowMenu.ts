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
 * Neither is offered on a box or a portion: how often a food gets wasted is an
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
  | 'out';

export interface PantryRowFacts {
  /** A catalog row, or one of an item's boxes (`ItemProduct`). */
  kind: 'grocery' | 'product';
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

export type PantryRowChip = 'have' | 'low';

/** A box can't be running low: that mark lives on the item. */
export function pantryRowChip(facts: PantryRowFacts): PantryRowChip {
  return facts.kind === 'grocery' && facts.low ? 'low' : 'have';
}

export const PANTRY_CHIP_LABEL: Record<PantryRowChip, string> = {
  have: 'Have it',
  low: 'Low',
};

export type PantryRowMark = 'opened' | 'frozen';

/**
 * The tags a row wears under its name. Frozen replaces opened, the way the
 * row's caption already does (`kitchenInventory` drops the opened clause for a
 * frozen row): a packet in the freezer is read as frozen, not as a jar that was
 * once opened.
 */
export function pantryRowMarks(facts: PantryRowFacts): PantryRowMark[] {
  if (facts.frozen) return ['frozen'];
  return facts.opened ? ['opened'] : [];
}

export function pantryRowMenu(facts: PantryRowFacts): PantryRowMenuEntry[] {
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
