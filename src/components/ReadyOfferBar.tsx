import React, { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useSheetMount } from '../hooks/useSheetMount';
import { useSettingsStore } from '../store/useSettingsStore';
import { InlineAction } from './InlineAction';
import { BannerBar } from './BannerBar';
import { WhenPicker } from './WhenPicker';
import { useBottomBarHeight } from '../hooks/useBottomBarHeight';
import { FAB_SIZE } from './Fab';
import { spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { getLogicalToday } from '../utils/dateUtils';
import { displayTitleFor } from '../utils/visibilityUtils';
import { useLingering } from '../hooks/useLingering';

// Longer than the undo bar's six seconds: this one asks a question with two
// answers rather than offering one button.
const VISIBLE_MS = 8000;

/**
 * "Paint the hallway is ready: Today / Pick a day", after finishing the last
 * thing a task was waiting on.
 *
 * A task waiting on another reappears where its date puts it once the wait is
 * over, which for a task with no date is nowhere: it moved to Unscheduled or
 * stayed on a project page, and "ready" happened with nothing on screen to
 * say so. `completeTask` notes which tasks that was (`readyOffer`), and this
 * offers them a day. Ignoring it changes nothing, same as the undo bar it sits
 * where; the tasks stay undated exactly as they would have.
 *
 * Mounted once at the navigator root beside UndoBar, for the same reason:
 * it's a few seconds the app is in after a tap, not a place.
 */
export function ReadyOfferBar() {
  const insets = useSafeAreaInsets();
  const barHeight = useBottomBarHeight();
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const offer = useTaskStore(s => s.readyOffer);
  const titles = useTaskStore(useShallow(s =>
    offer ? s.tasks.filter(t => offer.taskIds.includes(t.id) && !t.completed).map(t => displayTitleFor(t)) : []
  ));
  const clearReadyOffer = useTaskStore(s => s.clearReadyOffer);
  const placeReadyTasks = useTaskStore(s => s.placeReadyTasks);

  const [picking, setPicking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!offer) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => clearReadyOffer(), VISIBLE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [offer?.at]);

  const shown = !!offer && titles.length > 0;
  // Mounted on first use and kept (see useSheetMount): an idle WhenPicker
  // still subscribes to the task list, and this bar lives for the session.
  const mountPicker = useSheetMount(shown && picking);

  const place = (date: Date) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    haptics.success();
    setPicking(false);
    placeReadyTasks(date);
  };

  const label = titles.length === 1 ? `“${titles[0]}” is ready` : `${titles.length} tasks are ready`;
  const bottom = insets.bottom + barHeight + FAB_SIZE + spacing.lg;
  // The label, held while the bar drops away after the offer clears. Its
  // titles are gone from the store by then, so it has to be kept, not re-read.
  const bar = useLingering(shown && !picking ? label : null);

  return (
    <>
      {bar.value !== null && (
        <BannerBar
          bottom={bottom}
          label={bar.value}
          layout="stacked"
          leaving={bar.leaving}
          onLeft={bar.onLeft}
          onDismiss={() => {
            if (timerRef.current) clearTimeout(timerRef.current);
            clearReadyOffer();
          }}
          actions={
            <>
              <InlineAction
                label="Today"
                onPress={() => place(getLogicalToday(dayResetTime))}
                accessibilityLabel={`Do ${titles.length === 1 ? 'it' : 'them'} today`}
              />
              <InlineAction
                label="Pick a day"
                variant="neutral"
                onPress={() => {
                  haptics.tap();
                  if (timerRef.current) clearTimeout(timerRef.current);
                  setPicking(true);
                }}
              />
            </>
          }
        />
      )}
      {mountPicker && (
        <WhenPicker
          visible={shown && picking}
          value={null}
          title="Pick a day"
          showTimeOfDay={false}
          showSuggest={false}
          allowPast={false}
          onConfirm={date => { if (date) place(date); }}
          onCancel={() => { setPicking(false); clearReadyOffer(); }}
        />
      )}
    </>
  );
}
