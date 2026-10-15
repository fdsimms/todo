import React, { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT } from './DemoBanner';
import { BannerBar } from './BannerBar';
import { InlineAction } from './InlineAction';
import { useEventCreatedToastStore } from '../store/useEventCreatedToastStore';
import { spacing } from '../theme';
import { openEventInSystemCalendar } from '../utils/calendarSync';
import { readSavedEvents, saveEventAs, writeSavedEvents } from '../utils/savedEvents';
import { haptics } from '../utils/haptics';

// Long enough to reach for the button, short enough to stay out of the way.
const VISIBLE_MS = 5000;

/**
 * "Added to Calendar" with an Open button, after an event is added by hand,
 * and a Save button when the event isn't a saved one yet (`savedEvents.ts`):
 * the moment someone has just typed a regular out is when keeping it is cheapest.
 * Unlike `CoinToast` it takes touches, since the button is the point. Mounted
 * once at the navigator root so it survives the card that raised it closing.
 */
export function EventCreatedToast() {
  const insets = useSafeAreaInsets();
  const created = useEventCreatedToastStore(s => s.created);
  const clear = useEventCreatedToastStore(s => s.clear);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The title just saved from this toast, so it says so instead of offering again.
  const [savedKey, setSavedKey] = useState<number | null>(null);

  useEffect(() => {
    if (!created) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(clear, VISIBLE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [created, clear]);

  if (!created) return null;

  const open = () => {
    const { id, start } = created;
    clear();
    void openEventInSystemCalendar(id, start);
  };

  const justSaved = savedKey === created.key;
  const saveAs = created.saveAs;
  const save = () => {
    if (!saveAs) return;
    writeSavedEvents(saveEventAs(readSavedEvents(), saveAs.title, saveAs.fields, saveAs.start, Date.now()));
    haptics.success();
    setSavedKey(created.key);
  };

  return (
    <BannerBar
      bottom={insets.bottom + TAB_BAR_HEIGHT + spacing.md}
      label={justSaved ? 'Added to saved events' : 'Added to Calendar'}
      layout="stacked"
      liveRegion
      onDismiss={clear}
      actions={
        <>
          <InlineAction label="Open" onPress={open} accessibilityLabel="Open event in Calendar" />
          {saveAs && !justSaved && (
            <InlineAction
              label="Save as template"
              variant="neutral"
              onPress={save}
              accessibilityLabel={`Save ${saveAs.title} as a template so you can add it again quickly`}
            />
          )}
        </>
      }
    />
  );
}
