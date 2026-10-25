import { create } from 'zustand';
import type { OwedMission } from '../utils/missions';

/**
 * The missions owed right now and which one is on screen. Screen state only,
 * never persisted: `AlarmMissionHost` works out `owed` (from the native
 * pending list and the alarm store) and draws the mission, and the Alarms &
 * Reminders screen reads `owed` for its banner and opens one with `show`.
 */
interface MissionState {
  owed: OwedMission[];
  activeKey: string | null;
  setOwed: (owed: OwedMission[]) => void;
  show: (key: string) => void;
  hide: () => void;
}

export const useMissionStore = create<MissionState>(set => ({
  owed: [],
  activeKey: null,
  setOwed: owed => set({ owed }),
  show: key => set({ activeKey: key }),
  hide: () => set({ activeKey: null }),
}));
