import { create } from 'zustand';
import { addDays } from 'date-fns/addDays';
import { estimateTravelMinutes } from '../services/travelTime';
import { isDemoModeActive } from '../utils/demoState';
import { getCurrentDayStart } from '../utils/dateUtils';
import { createRefreshGuard } from '../utils/refreshGuard';
import {
  eventIsTravelEligible,
  needsTravelEstimate,
  travelOriginForEvent,
  travelOriginKey,
  travelLeadFor,
  travelModeFor,
  travelWalkUnderFor,
  arriveEarlyFor,
  leadWithArrival,
  travelLeaveAt,
  travelSourceId,
  switchEstimateMode,
  TRAVEL_ESTIMATES_PER_REFRESH,
  TRAVEL_MODES,
  type TravelMode,
  type TravelEstimate,
  type TravelOrigin,
  type TravelEstimates,
} from '../utils/travelTasks';
import { readSavedPlaces } from '../utils/savedPlaces';
import { useCalendarStore } from './useCalendarStore';
import { useSettingsStore } from './useSettingsStore';

/**
 * Apple Maps' trip estimates for the upcoming "Leave for X" events, held in
 * memory: `useTransitStore`'s shape, for its reason. It is another service's
 * answer about the world, so there is no table, and `checkTravelTasks` reads
 * whatever is here and never fetches. `useTravelTaskSync` decides when to
 * refresh: while the app is open, never while it's closed, so a reminder
 * queued the evening before carries the last estimate the app saw.
 */
interface TravelTimeState {
  estimates: TravelEstimates;
  refreshing: boolean;
  /**
   * True once a read has answered since launch (or since the last `clear`),
   * including one that found nothing to ask. A row with no estimate and no
   * answer yet is still waiting; a row with no estimate after one is a trip
   * Apple Maps couldn't route, and says nothing.
   */
  settled: boolean;
  /** Estimates every upcoming travel event that has none, or a stale one, a few at a time. */
  refresh: () => Promise<void>;
  /**
   * Re-files one held estimate under another of the modes it already answered
   * (a tap on a row's other choice), before the preference that makes it the
   * event's mode is written, so the row changes at once instead of blanking
   * while the next refresh asks again.
   */
  switchMode: (sourceId: string, mode: TravelMode) => void;
  clear: () => void;
}

// One read, so one guard: an estimate must not be written back after the
// switch went off mid-request (refreshGuard.ts).
const estimateGuard = createRefreshGuard();

/** Whether there's any reason to ask: travel tasks on, estimates on, and a calendar to read. */
export function travelEstimatesWanted(s: {
  travelTasks: boolean;
  travelEstimates: boolean;
  calendarReadEnabled: boolean;
}): boolean {
  return s.travelTasks && s.travelEstimates && s.calendarReadEnabled;
}

/** Where this event's trip starts: its own pick, else the Settings place; null is where the phone is. */
export function travelOriginOfEvent(eventId: string): TravelOrigin | null {
  const s = useSettingsStore.getState();
  return travelOriginForEvent(eventId, s.travelEventPrefs, s.travelOriginPlaceId, readSavedPlaces());
}

export const useTravelTimeStore = create<TravelTimeState>((set, get) => ({
  estimates: {},
  refreshing: false,
  settled: false,

  async refresh() {
    if (isDemoModeActive()) return;
    if (get().refreshing) return;
    const settings = useSettingsStore.getState();
    if (!travelEstimatesWanted(settings)) return;
    const calendar = useCalendarStore.getState();
    if (!calendar.loaded) return;

    const now = new Date();
    // checkTravelTasks' horizon: through the end of the logical tomorrow.
    const horizonEnd = addDays(getCurrentDayStart(), 2).getTime();
    const upcoming = calendar.events
      .filter(event => eventIsTravelEligible(event, now, settings.travelEventPrefs) && Date.parse(event.start) < horizonEnd)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const places = readSavedPlaces();
    const walkUnderOf = (eventId: string) =>
      travelWalkUnderFor(eventId, settings.travelEventPrefs, settings.travelMode, settings.travelWalkUnderMinutes);
    const originOf = (eventId: string) =>
      travelOriginForEvent(eventId, settings.travelEventPrefs, settings.travelOriginPlaceId, places);
    const held = get().estimates;
    const wanted = upcoming
      .filter(event => needsTravelEstimate(event, held, travelModeFor(event.id, settings.travelEventPrefs, settings.travelMode), travelOriginKey(originOf(event.id)), now, walkUnderOf(event.id), settings.travelCompareModes))
      .slice(0, TRAVEL_ESTIMATES_PER_REFRESH);

    // Estimates for occurrences no longer coming up are dropped either way.
    const live = new Set(upcoming.map(travelSourceId));
    const kept: Record<string, TravelEstimate> = {};
    for (const [key, estimate] of Object.entries(held)) if (live.has(key)) kept[key] = estimate;
    if (wanted.length === 0) {
      if (Object.keys(kept).length !== Object.keys(held).length) set({ estimates: kept });
      if (!get().settled) set({ settled: true });
      return;
    }

    set({ refreshing: true });
    const token = estimateGuard.begin();
    try {
      const fresh: Record<string, TravelEstimate> = {};
      for (const event of wanted) {
        // Asked for the moment the user would leave by the typed lead: close
        // enough for traffic, and the only departure known before the answer.
        const mode = travelModeFor(event.id, settings.travelEventPrefs, settings.travelMode);
        const departAt = travelLeaveAt(event, leadWithArrival(travelLeadFor(event, {
          defaultMinutes: settings.travelLeadMinutes,
          byCalendar: settings.travelLeadByCalendar,
          arriveEarlyMinutes: settings.travelArriveEarlyMinutes,
        }), arriveEarlyFor(event.id, settings.travelEventPrefs, settings.travelArriveEarlyMinutes))) ?? now;
        const origin = originOf(event.id);
        // With a walk-under threshold the walk is asked first and kept when it
        // comes in at or under it; otherwise (too far, or no route on foot)
        // the Settings mode is asked as it would be with no threshold.
        const walkUnder = walkUnderOf(event.id);
        let filedMode = mode;
        let minutes: number | null = null;
        // Every mode answered so far, so the comparison below never asks one twice.
        const answered: Partial<Record<TravelMode, number>> = {};
        if (walkUnder > 0) {
          const walk = await estimateTravelMinutes(event, departAt, 'walking', origin);
          if (!estimateGuard.isCurrent(token)) return;
          if (walk !== null) answered.walking = walk;
          if (walk !== null && walk <= walkUnder) { minutes = walk; filedMode = 'walking'; }
        }
        if (minutes === null) {
          minutes = await estimateTravelMinutes(event, departAt, mode, origin);
          if (!estimateGuard.isCurrent(token)) return;
        }
        if (minutes === null) continue;
        answered[filedMode] = minutes;
        let others: Partial<Record<TravelMode, number>> | undefined;
        if (settings.travelCompareModes) {
          others = {};
          for (const other of TRAVEL_MODES) {
            if (other === filedMode) continue;
            let theirs = answered[other] ?? null;
            if (theirs === null) {
              theirs = await estimateTravelMinutes(event, departAt, other, origin);
              if (!estimateGuard.isCurrent(token)) return;
            }
            if (theirs !== null) others[other] = theirs;
          }
        }
        fresh[travelSourceId(event)] = {
          minutes,
          location: (event.location ?? '').trim(),
          mode: filedMode,
          ...(walkUnder > 0 ? { walkUnder } : {}),
          ...(others ? { others } : {}),
          origin: travelOriginKey(origin),
          at: Date.now(),
        };
      }
      set({ estimates: { ...kept, ...fresh } });
    } finally {
      // A read cut off by `clear` has answered nothing, so it settles nothing.
      set({ refreshing: false, ...(estimateGuard.isCurrent(token) ? { settled: true } : {}) });
    }
  },

  switchMode(sourceId, mode) {
    const held = get().estimates[sourceId];
    const next = held ? switchEstimateMode(held, mode) : null;
    if (next && next !== held) set({ estimates: { ...get().estimates, [sourceId]: next } });
  },

  clear() {
    estimateGuard.invalidate();
    set({ estimates: {}, refreshing: false, settled: false });
  },
}));
