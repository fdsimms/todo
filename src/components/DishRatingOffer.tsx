import React from 'react';
import { useDishRatingStore } from '../store/useDishRatingStore';
import { OfferBanner } from './OfferBanner';
import { useColors } from '../theme/ThemeContext';

/**
 * "Would you order it again?" for a meal you described and just logged: Loved
 * it, It was fine or Never again, one tap.
 *
 * The same shape as `ProductRatingOffer`, for the one kind of food with no
 * catalog row to hang a rating on. It records the answer and nothing else:
 * the restaurant and a note are added later from Dishes, so ignoring this
 * costs nothing. Nothing writes an answer for the person, and a dish that
 * already has one is never asked about again (`dishOfferFor`).
 */
export function DishRatingOffer() {
  const offer = useDishRatingStore(s => s.offer);
  const rate = useDishRatingStore(s => s.rateOffered);
  const dismiss = useDishRatingStore(s => s.dismissOffer);
  const colors = useColors();

  if (!offer) return null;
  const lead = `Would you order ${offer.name} again?`;
  return (
    <OfferBanner
      lead={lead}
      rest="Your answer is saved under Dishes."
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
      actionAccessibilityLabel={`Rate ${offer.name} as loved it`}
      secondaryActionAccessibilityLabel={`Rate ${offer.name} as it was fine`}
      tertiaryActionAccessibilityLabel={`Rate ${offer.name} as never again`}
      dismissAccessibilityLabel="Dismiss rating question"
    />
  );
}
