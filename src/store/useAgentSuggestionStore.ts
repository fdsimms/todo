import { create } from 'zustand';
import type { CalendarRequest, CalendarRequestStatus } from '../types';
import { dbGetAllCalendarRequests, dbInsertCalendarRequest, dbResolveCalendarRequest } from '../db/database';

interface AgentSuggestionStore {
  /** Every calendar request row; `liveSuggestions` picks the ones to show. */
  requests: CalendarRequest[];
  initialize: () => void;
  /** Adds a row. Only demo mode calls this; an agent's rows arrive by sync. */
  insert: (request: CalendarRequest) => void;
  /** Moves a proposal to its answer: `pending` (approved, the drain writes it), `cancelled` (skipped), `written` or `failed`. */
  answer: (id: string, status: Extract<CalendarRequestStatus, 'pending' | 'cancelled' | 'written' | 'failed'>, failureReason?: string) => void;
}

/**
 * The calendar requests an agent made, held so the Inbox can show the ones
 * waiting for a tap (`src/utils/agentSuggestions.ts`). Reloaded with every
 * other store at startup and after a sync, since that is how a request
 * arrives. It writes only the outcome columns, the same as the drain does.
 */
export const useAgentSuggestionStore = create<AgentSuggestionStore>((set, get) => ({
  requests: [],

  initialize() {
    set({ requests: dbGetAllCalendarRequests() });
  },

  insert(request) {
    dbInsertCalendarRequest(request);
    set({ requests: [...get().requests, request] });
  },

  answer(id, status, failureReason) {
    const outcome = {
      status,
      failureReason: status === 'failed' ? failureReason ?? null : null,
      eventExternalId: null,
      // A request put back to `pending` has not been answered yet.
      resolvedAt: status === 'pending' ? null : new Date().toISOString(),
    };
    dbResolveCalendarRequest(id, outcome);
    set({ requests: get().requests.map(r => (r.id === id ? { ...r, ...outcome } : r)) });
  },
}));
