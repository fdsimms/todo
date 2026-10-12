import { create } from 'zustand';
import type { CopyFlag } from '../types';
import {
  dbGetAllCopyFlags,
  dbInsertCopyFlag,
  dbUpdateCopyFlag,
  dbDeleteCopyFlag,
} from '../db/database';
import { generateId } from '../utils/id';

/**
 * TEMPORARY dev tooling (see `CopyFlag`): lines of copy marked as needing a
 * manual pass. CRUD only; the fixing happens in the repo, driven by the MCP
 * server's `list_copy_flags` and `resolve_copy_flag`.
 */

interface CopyFlagStore {
  flags: CopyFlag[];
  initialized: boolean;
  initialize: () => void;
  /** Flags `text` on `screen`, or returns the open flag already there. */
  addFlag: (text: string, screen: string, note: string) => CopyFlag | null;
  updateNote: (id: string, note: string) => void;
  removeFlag: (id: string) => void;
}

export const useCopyFlagStore = create<CopyFlagStore>((set, get) => ({
  flags: [],
  initialized: false,

  initialize() {
    set({ flags: dbGetAllCopyFlags(), initialized: true });
  },

  addFlag(text, screen, note) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const existing = get().flags.find(
      f => f.status === 'open' && f.text === trimmed && f.screen === screen,
    );
    if (existing) return existing;
    const flag: CopyFlag = {
      id: generateId(),
      text: trimmed,
      screen,
      note: note.trim(),
      status: 'open',
      resolution: '',
      createdAt: new Date().toISOString(),
    };
    dbInsertCopyFlag(flag);
    set({ flags: [flag, ...get().flags] });
    return flag;
  },

  updateNote(id, note) {
    const flag = get().flags.find(f => f.id === id);
    if (!flag) return;
    const next = { ...flag, note: note.trim() };
    dbUpdateCopyFlag(next);
    set({ flags: get().flags.map(f => (f.id === id ? next : f)) });
  },

  removeFlag(id) {
    dbDeleteCopyFlag(id);
    set({ flags: get().flags.filter(f => f.id !== id) });
  },
}));
