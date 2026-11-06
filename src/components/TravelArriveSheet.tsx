import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { travelArrivePickerOptions } from '../utils/travelTasks';
import { setArriveEarlyForEvent } from '../utils/travelModeWrite';
import { EventOptionSheet } from './EventOptionSheet';

interface Props {
  visible: boolean;
  /** The local calendar event id the "Leave for X" row was written for, which the per-event preference is keyed by. */
  eventId: string | null;
  onClose: () => void;
}

/** The "Arrive" card for a "Leave for X" row, raised from its arrival line. */
export function TravelArriveSheet({ visible, eventId, onClose }: Props) {
  const defaultMinutes = useSettingsStore(s => s.travelArriveEarlyMinutes);
  const pref = useSettingsStore(s => (eventId ? s.travelEventPrefs[eventId] : undefined));
  const picked = pref?.arriveEarlyMinutes ?? null;
  return (
    <EventOptionSheet
      visible={visible}
      title="Arrive"
      options={travelArrivePickerOptions(defaultMinutes)}
      selectedKey={picked === null ? 'default' : String(picked)}
      onSelect={key => { if (eventId) setArriveEarlyForEvent(eventId, key); }}
      onClose={onClose}
    />
  );
}
