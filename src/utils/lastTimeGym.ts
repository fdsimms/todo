import type { Gym, WorkoutSession, WorkoutSet } from '../types';

/**
 * Where last time's sets were done, shown above the PREVIOUS column when it was
 * not at the gym this workout is at: a dumbbell or machine at one gym says
 * little about another, so the numbers need that said. `previous` is
 * `previousSets`, which all come from one session, so there is one gym per
 * exercise, not one per set.
 *
 * Null (nothing shown) when last time was at this gym, had no gym chosen, or
 * its gym has since been deleted (`WorkoutSession.gymId` is allowed to dangle).
 * A workout with no gym chosen counts as a different one, so last time's gym
 * is still named.
 */
export interface LastTimeGym {
  name: string;
  /** When that workout started, for "Last time · Nov 10". */
  at: string;
}

export function lastTimeGym(
  previous: readonly Pick<WorkoutSet, 'sessionId'>[],
  sessions: readonly Pick<WorkoutSession, 'id' | 'startedAt' | 'gymId'>[],
  gyms: readonly Pick<Gym, 'id' | 'name'>[],
  currentGymId: string | null,
): LastTimeGym | null {
  const sessionId = previous[0]?.sessionId;
  if (!sessionId) return null;
  const session = sessions.find(s => s.id === sessionId);
  if (!session?.gymId || session.gymId === currentGymId) return null;
  const gym = gyms.find(g => g.id === session.gymId);
  return gym ? { name: gym.name, at: session.startedAt } : null;
}
