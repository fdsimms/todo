import React, { useRef, useState } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { travelArrivePickerOptions, travelSourceStart } from '../utils/travelTasks';
import { setArriveEarlyForEvent } from '../utils/travelModeWrite';
import { formatTimeOfDay } from '../utils/dateUtils';
import { EventOptionSheet } from './EventOptionSheet';
import { ArriveAtSheet } from './ArriveAtSheet';

interface Props {
  visible: boolean;
  /** The local calendar event id the "Leave for X" row was written for, which the per-event preference is keyed by. */
  eventId: string | null;
  /** The row's source id, which ends in the event's start, for the "Other…" time wheel. */
  sourceId: string | null;
  onClose: () => void;
}

/** The "Arrive" card for a "Leave for X" row, raised from its arrival line. */
export function TravelArriveSheet({ visible, eventId, sourceId, onClose }: Props) {
  const defaultMinutes = useSettingsStore(s => s.travelArriveEarlyMinutes);
  const pref = useSettingsStore(s => (eventId ? s.travelEventPrefs[eventId] : undefined));
  const picked = pref?.arriveEarlyMinutes ?? null;
  const [atVisible, setAtVisible] = useState(false);
  // "Other…" calls the option card's onClose and then onOther in one tick; the
  // owner of this sheet must not unmount it in between, or the wheel never opens.
  const goingToAt = useRef(false);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const startMs = sourceId ? travelSourceStart(sourceId) : null;
  const start = startMs === null ? null : new Date(startMs);
  return (
    <>
      <EventOptionSheet
        visible={visible && !atVisible}
        title="Arrive"
        options={travelArrivePickerOptions(defaultMinutes, picked, start, d => formatTimeOfDay(d, use24Hour))}
        selectedKey={picked === null ? 'default' : String(picked)}
        onSelect={key => { if (eventId) setArriveEarlyForEvent(eventId, key); }}
        onOther={start ? () => { goingToAt.current = true; setAtVisible(true); } : undefined}
        onClose={() => queueMicrotask(() => { if (!goingToAt.current) onClose(); goingToAt.current = false; })}
      />
      <ArriveAtSheet
        visible={atVisible}
        start={start}
        currentMinutes={picked ?? defaultMinutes}
        onSubmit={minutes => { if (eventId) setArriveEarlyForEvent(eventId, String(minutes)); }}
        onClose={() => { setAtVisible(false); onClose(); }}
      />
    </>
  );
}
