import { useGymStore } from '../store/useGymStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { getCurrentLocation } from './weatherLocation';
import { gymAt, lastUsedGymId } from './gyms';

/**
 * Which gym a workout starts at (docs/arch/workouts.md, "Gyms"). The rules are
 * `gymAt` and `lastUsedGymId` in `gyms.ts`; this is the one place that reads
 * the position.
 *
 * **It reads nothing unless a gym has a pin.** Starting a workout asks the
 * device where it is only when somebody saved a place for a gym, and it never
 * asks permission (`getCurrentLocation`): the permission is requested where the
 * pin is set, from the gym's own editor. With no pin, no permission or demo
 * mode there is no read and the workout starts at the gym it last used.
 */

/** The gym a workout should start at before any position is known. */
export function defaultGymId(): string | null {
  return lastUsedGymId(useGymStore.getState().gyms, useWorkoutStore.getState().sessions);
}

/**
 * Moves a live session to the gym the device is at, once the position comes
 * back. A no-op when no gym has a pin, the fix can't tell, the session has
 * ended meanwhile, a set was already ticked (the person is under way and picked
 * or accepted where they are), or the session is at that gym already. Only the
 * gym changes: nothing about the exercises is rearranged (a swap is always the
 * person's tap).
 */
export async function applyLocationGym(sessionId: string): Promise<void> {
  const gyms = useGymStore.getState().gyms;
  if (!gyms.some(g => !g.archived && g.latitude !== null && g.longitude !== null)) return;
  const fix = await getCurrentLocation({ accuracy: 'balanced' });
  if (!fix) return;
  const gym = gymAt(gyms, { latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracyM ?? null });
  if (!gym) return;
  const store = useWorkoutStore.getState();
  const session = store.sessions.find(s => s.id === sessionId);
  if (!session || session.endedAt !== null || (session.gymId ?? null) === gym.id) return;
  if (store.loadSets(sessionId).some(s => s.completedAt !== null)) return;
  store.updateSession(sessionId, { gymId: gym.id });
}
