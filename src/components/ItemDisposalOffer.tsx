import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { OfferBanner } from './OfferBanner';
import { useColors } from '../theme/ThemeContext';

interface Props {
  /**
   * Render only while the offer names this row, for a host that is already
   * showing one item (`GroceryItemSheet`). Omitted, it answers for whichever
   * row the offer names, which is what a screen listing all of them wants.
   */
  itemId?: string;
  /**
   * Open this item's shelf life for editing — what the repeat-waste stage
   * offers. The hosts differ enough that neither could own it: the sheet is
   * already showing the row and only has to unfold a field, where the screen
   * has to open the sheet on it.
   */
  onOpenShelfLife: (itemId: string) => void;
}

/**
 * "How did that go?" — the two ways out of the pantry, asked once, right after
 * a row is marked out of.
 *
 * **The ✕ still writes one bit and the question comes after it.** That order is
 * the whole design: `markOutOfMany` marks the row out on the tap, so the pantry
 * is already correct and this is pure extra. Ignoring it leaves nothing wrong —
 * which is what lets the cheapest correction in the app stay one tap, the trade
 * docs/arch/groceries.md makes when it gives a catalog row a ✕ and a container
 * a sheet.
 *
 * **Two stages, and the second is the only thing the record is for.** Answering
 * "Went bad" often enough (`wantsShelfLifePrompt`) turns the banner into an
 * offer to shorten what this keeps for. That is deliberately a hand-off to a
 * person and not an adjustment the app makes: see `itemDisposal.ts` on why
 * these answers can't be arithmetic on a date, and `GroceryItem.shelfLifeDays`
 * for the correction they point at.
 *
 * **No dismissal stamp.** The offer is session-only store state about a tap
 * just made, the call `OfferBanner`'s other callers make — a question about a
 * bag of spinach thrown out last Tuesday isn't one anybody can answer, so it
 * has nothing to persist for.
 */
export function ItemDisposalOffer({ itemId, onOpenShelfLife }: Props) {
  const offer = useGroceryStore(s => s.disposalOffer);
  const items = useGroceryStore(useShallow(s => s.items));
  const recordDisposal = useGroceryStore(s => s.recordDisposal);
  const dismiss = useGroceryStore(s => s.dismissDisposalOffer);
  const colors = useColors();

  if (!offer) return null;
  if (itemId !== undefined && offer.itemId !== itemId) return null;
  // Resolve-or-shrug, like every other cross-row pointer here: an item deleted
  // between the ✕ and the answer leaves nothing to ask about.
  const item = items.find(i => i.id === offer.itemId);
  if (!item) return null;

  if (offer.stage === 'shelfLife') {
    // Names the count and nothing else. "Wasted twice" would be the grading
    // `describeOutcome` refuses when it picks "Thrown out" over "Wasted", and a
    // record the user volunteered is the worst possible thing to hand back to
    // them as a judgement.
    // "twice" for two, the same halving probablyHaveReason makes when it says
    // "once" rather than "1×". The count can't be lower than the threshold.
    const times = item.spoiledCount === 2 ? 'twice' : `${item.spoiledCount} times`;
    const lead = `${item.name} went bad ${times}.`;
    const rest = 'Change how long the app thinks it keeps?';
    return (
      <OfferBanner
        lead={lead}
        rest={rest}
        actionLabel="Shelf life"
        // Stacked with one button: this sentence is two lines on its own at
        // 390pt, and the inline layout would truncate it rather than wrap.
        stacked
        onAction={() => {
          dismiss();
          onOpenShelfLife(item.id);
        }}
        onDismiss={dismiss}
        accessibilityLabel={`${lead} ${rest}`}
        actionAccessibilityLabel={`Change how long ${item.name} keeps`}
        dismissAccessibilityLabel="Dismiss shelf life suggestion"
      />
    );
  }

  const lead = `${item.name} is out.`;
  const rest = 'How did it go?';
  return (
    <OfferBanner
      lead={lead}
      rest={rest}
      actionLabel="Used it up"
      onAction={() => recordDisposal(item.id, 'usedUp')}
      // Both filled, neither accent: this is the same two-way question
      // LeftoverSheet asks as "Finished it" / "Threw it out", neither answer is
      // the recommended one, and a filled-versus-grey pair would nominate one.
      //
      // Green and *red* rather than the fridge's green and orange, which is a
      // contrast call rather than a change of meaning: those are icon tints on
      // a plain row there, and as a fill under 13pt bold white text orange
      // measures about 2:1. `colors.onAccent` names accent, green and red
      // surfaces for exactly this reason, and red carries no verdict here — the
      // copy is "Went bad", the same refusal to grade that picks "Thrown out"
      // over "Wasted".
      actionTint={colors.green}
      secondaryActionLabel="Went bad"
      onSecondaryAction={() => recordDisposal(item.id, 'spoiled')}
      secondaryActionTint={colors.red}
      onDismiss={dismiss}
      accessibilityLabel={`${item.name} is marked out. How did it go?`}
      actionAccessibilityLabel={`Record that you used up the ${item.name}`}
      secondaryActionAccessibilityLabel={`Record that the ${item.name} went bad`}
      dismissAccessibilityLabel="Dismiss question"
    />
  );
}
