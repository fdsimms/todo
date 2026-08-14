import { create } from 'zustand';
import { switchToDemoDatabase, switchToRealDatabase } from '../db/database';
import { seedDemoData } from '../utils/demoSeed';
import { setDemoModeActive } from '../utils/demoState';
import { useTaskStore } from './useTaskStore';
import { useSettingsStore } from './useSettingsStore';

// Demo mode replaces the app's entire data source with a throwaway one, so
// handing someone the phone shows them a believable task list and none of
// the user's own. It works by pointing the SQLite handle at a scratch file
// and re-running the normal startup sequence against it: every screen,
// selector, search and stat then reads demo rows without knowing anything
// changed, and real tasks aren't merely filtered out of a view — they're in
// a file nothing is reading.
//
// Deliberately NOT persisted. The flag lives in memory only, so force-quitting
// mid-demo always reopens on real data; the scratch file left behind is inert
// and gets deleted the next time demo mode starts.
interface DemoStore {
  active: boolean;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
}

export const useDemoStore = create<DemoStore>((set, get) => ({
  active: false,

  enterDemoMode() {
    if (get().active) return;
    // Set before anything else touches the task store: seedDemoData below
    // goes through the normal addTask action, and that action schedules a
    // real device notification/alarm for any reminder it's given. Demo rows
    // live only in the scratch database, so a scheduled alarm for one would
    // outlive it — this flag is what stops that scheduling from happening.
    setDemoModeActive(true);
    switchToDemoDatabase();
    // Creates the tables in the scratch file and reloads every data store
    // from it — which also cancels the real reminders, since initialize()
    // reschedules notifications from the tasks it just loaded.
    useTaskStore.getState().initialize();
    seedDemoData();
    set({ active: true });
  },

  exitDemoMode() {
    if (!get().active) return;
    // Cleared before the reload below, so the real reminders it schedules
    // from the real database aren't silently skipped by the same guard.
    setDemoModeActive(false);
    switchToRealDatabase();
    // Same startup order as App.tsx: tasks first (it re-runs initDatabase
    // and reschedules the real reminders), then settings — which discards
    // any preference changed during the demo, since those writes went to
    // the scratch file.
    useTaskStore.getState().initialize();
    useSettingsStore.getState().initialize();
    set({ active: false });
  },
}));
