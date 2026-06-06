import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';

interface SettingsStore {
  dayResetTime: string; // "HH:MM" — when the logical day flips (default midnight "00:00")
  initialized: boolean;
  initialize: () => void;
  setDayResetTime: (time: string) => void;
}

export const useSettingsStore = create<SettingsStore>(set => ({
  dayResetTime: '00:00',
  initialized: false,

  initialize() {
    const resetTime = dbGetSetting('dayResetTime') ?? '00:00';
    set({ dayResetTime: resetTime, initialized: true });
  },

  setDayResetTime(time: string) {
    dbSetSetting('dayResetTime', time);
    set({ dayResetTime: time });
  },
}));
