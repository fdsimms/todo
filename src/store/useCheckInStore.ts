import { create } from 'zustand';
import type { CheckIn, CheckInAnswer } from '../types';
import { dbGetAllCheckIns, dbInsertCheckIn, dbUpdateCheckIn, dbDeleteCheckIn } from '../db/database';
import { generateId } from '../utils/id';
import { keepUnchanged } from '../utils/structuralSharing';

/**
 * Check-ins (`src/utils/checkIns.ts`): rows only. Scheduling the notification
 * is `checkInRecording.ts`, because this store is read by the MCP replica,
 * which can't load the notification module.
 */
export interface CheckInInput {
  sourceKind: CheckIn['sourceKind'];
  sourceId: string;
  subject: string;
  about?: string | null;
  dueAt: string;
  dayKey: string;
}

interface CheckInStore {
  checkIns: CheckIn[];
  initialized: boolean;
  initialize: () => void;
  add: (input: CheckInInput) => CheckIn;
  /** Saves an answer. Returns the updated row, or null when it no longer exists. */
  answer: (id: string, answer: CheckInAnswer, at?: Date) => CheckIn | null;
  remove: (id: string) => void;
  /** Deletes every check-in about one dose or food, returning the ids removed. */
  removeForSource: (kind: CheckIn['sourceKind'], sourceId: string) => string[];
  forSource: (kind: CheckIn['sourceKind'], sourceId: string) => CheckIn | null;
}

export const useCheckInStore = create<CheckInStore>((set, get) => ({
  checkIns: [],
  initialized: false,

  initialize() {
    set(state => keepUnchanged(state, { checkIns: dbGetAllCheckIns(), initialized: true }));
  },

  add(input) {
    const checkIn: CheckIn = {
      id: generateId(),
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      subject: input.subject.trim(),
      about: input.about?.trim() || null,
      dueAt: input.dueAt,
      dayKey: input.dayKey,
      answer: null,
      answeredAt: null,
    };
    dbInsertCheckIn(checkIn);
    set(s => ({ checkIns: [checkIn, ...s.checkIns] }));
    return checkIn;
  },

  answer(id, answer, at = new Date()) {
    const existing = get().checkIns.find(c => c.id === id);
    if (!existing) return null;
    const next: CheckIn = { ...existing, answer, answeredAt: at.toISOString() };
    dbUpdateCheckIn(next);
    set(s => ({ checkIns: s.checkIns.map(c => (c.id === id ? next : c)) }));
    return next;
  },

  remove(id) {
    dbDeleteCheckIn(id);
    set(s => ({ checkIns: s.checkIns.filter(c => c.id !== id) }));
  },

  removeForSource(kind, sourceId) {
    const gone = get().checkIns.filter(c => c.sourceKind === kind && c.sourceId === sourceId);
    gone.forEach(c => dbDeleteCheckIn(c.id));
    if (gone.length) set(s => ({ checkIns: s.checkIns.filter(c => !gone.includes(c)) }));
    return gone.map(c => c.id);
  },

  forSource(kind, sourceId) {
    return get().checkIns.find(c => c.sourceKind === kind && c.sourceId === sourceId) ?? null;
  },
}));
