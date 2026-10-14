import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { OfferBanner } from './OfferBanner';
import { useColors } from '../theme/ThemeContext';
import { describeProduct } from '../utils/groceryProduct';

interface Props {
  /**
   * Render only while the offer names this item, for a host already showing
   * one (`GroceryItemSheet`). Omitted, it answers for whichever item the offer
   * names, which is what a screen listing all of them wants.
   */
  itemId?: string;
}

/**
 * "How was it?" for the flavor you just finished: Loved it, It was fine or
 * Never again, one tap.
 *
 * **It is asked after the product is out, never on the way in.** Rating a
 * flavor from the shopping list asks about something nobody has tried yet, so
 * the only moments offered are the ones where the person has had it: marking a
 * flavor out of the pantry, and "Used it up". "Went bad" never raises it,
 * because spoiled is not disliked. The reason ("too sweet") lives in the
 * product's note and is added in ProductSheet; this banner records the verdict
 * and nothing else, so ignoring it costs nothing.
 *
 * **Waits for the disposal question.** Both can be raised by one tap, and two
 * banners of the same shape side by side is the noise `OfferBanner` exists to
 * avoid, so this shows once "Used it up, or did it go bad?" has been answered.
 */
export function ProductRatingOffer({ itemId }: Props) {
  const offer = useGroceryStore(s => s.ratingOffer);
  const disposalOpen = useGroceryStore(s => s.disposalOffer !== null);
  const products = useGroceryStore(useShallow(s => s.itemProducts));
  const rate = useGroceryStore(s => s.rateOfferedProduct);
  const dismiss = useGroceryStore(s => s.dismissRatingOffer);
  const colors = useColors();

  if (!offer || disposalOpen) return null;
  if (itemId !== undefined && offer.itemId !== itemId) return null;
  // Resolve-or-shrug: a product deleted between the tap and the answer leaves
  // nothing to rate.
  const product = products.find(p => p.id === offer.productId);
  if (!product) return null;

  const name = describeProduct(product);
  if (!name) return null;
  const lead = `How was the ${name}?`;
  return (
    <OfferBanner
      lead={lead}
      rest="Rating it helps you pick between flavors next time."
      actionLabel="Loved it"
      onAction={() => rate('loved')}
      actionTint={colors.greenFill}
      secondaryActionLabel="It was fine"
      onSecondaryAction={() => rate('fine')}
      tertiaryActionLabel="Never again"
      onTertiaryAction={() => rate('avoid')}
      tertiaryActionTint={colors.redFill}
      onDismiss={dismiss}
      accessibilityLabel={lead}
      actionAccessibilityLabel={`Rate the ${name} as loved it`}
      secondaryActionAccessibilityLabel={`Rate the ${name} as it was fine`}
      tertiaryActionAccessibilityLabel={`Rate the ${name} as never again`}
      dismissAccessibilityLabel="Dismiss rating question"
    />
  );
}
