import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  TRAVEL_SKIP_KEY,
  travelModePickerOptions,
} from '../utils/travelTasks';
import { setTravelModeForEvent } from '../utils/travelModeWrite';
import { EventOptionSheet } from './EventOptionSheet';

interface Props {
  visible: boolean;
  /** The local calendar event id the "Leave for X" row was written for, which the per-event preference is keyed by. */
  eventId: string | null;
  /** The row's occurrence key, for re-filing its held estimate under the new mode. */
  sourceId: string | null;
  onClose: () => void;
}

/** The "Getting there" card for a "Leave for X" row, raised from its travel chip. */
export function TravelModeSheet({ visible, eventId, sourceId, onClose }: Props) {
  const defaultMode = useSettingsStore(s => s.travelMode);
  const walkUnder = useSettingsStore(s => s.travelWalkUnderMinutes);
  const pref = useSettingsStore(s => (eventId ? s.travelEventPrefs[eventId] : undefined));
  return (
    <EventOptionSheet
      visible={visible}
      title="Getting there"
      options={travelModePickerOptions(defaultMode, walkUnder)}
      selectedKey={pref?.skip ? TRAVEL_SKIP_KEY : pref?.mode ?? 'default'}
      onSelect={key => { if (eventId) setTravelModeForEvent(eventId, sourceId, key); }}
      onClose={onClose}
    />
  );
}
