import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { exerciseProposal, proposalWrites, type ExerciseProposal } from './workoutProposal';

/**
 * "Use 82.5 kg" against the stores: the half of the suggestion card that
 * reads a session's proposal as things stand and writes it. The pure half,
 * which the MCP server also reads, is `workoutProposal.ts`.
 */

/** The proposal for an exercise of a session, read from the stores as they are now. */
export function liveProposal(sessionId: string, exerciseId: string): ExerciseProposal | null {
  const workouts = useWorkoutStore.getState();
  const session = workouts.sessions.find(s => s.id === sessionId);
  if (!session) return null;
  const settings = useSettingsStore.getState();
  return exerciseProposal({
    exerciseId,
    exercises: workouts.exercises,
    routine: session.routineId ? workouts.routines.find(r => r.id === session.routineId) ?? null : null,
    program: session.programId ? workouts.programs.find(p => p.id === session.programId) ?? null : null,
    sessions: workouts.sessions,
    routines: workouts.routines,
    history: workouts.exerciseHistory(exerciseId),
    exceptSessionId: session.id,
    plateInventory: settings.plateInventory,
    unit: settings.workoutUnit,
  });
}

export interface ApplyProposalOptions {
  /** The proposal shown, which "Use" writes. Read from the stores when left out. */
  proposal?: ExerciseProposal | null;
  /**
   * The id for the `index`th warm-up a ramp adds (`addPlannedWarmups`' `ids`):
   * the Apple Watch's Use draws them first, so a tick on one finds it.
   */
  warmupId?: (index: number) => string;
}

/**
 * "Use 82.5 kg": the proposal written onto the session's planned sets of the
 * exercise, each an ordinary edit, as if typed, and every one still editable.
 * Workout mode's card and the Apple Watch's `useSuggestion` tap both come
 * through here. False when there was nothing to apply.
 */
export function applyProposal(sessionId: string, exerciseId: string, options: ApplyProposalOptions = {}): boolean {
  const p = options.proposal === undefined ? liveProposal(sessionId, exerciseId) : options.proposal;
  if (!p || p.proposal.sets.length === 0) return false;
  const store = useWorkoutStore.getState();
  const sets = (store.setsBySession[sessionId] ?? store.loadSets(sessionId)).filter(s => s.exerciseId === exerciseId);
  if (sets.length === 0) return false;
  const { edits, warmupsToAdd } = proposalWrites(sets, p);
  for (const e of edits) store.editSet(sessionId, e.setId, { weightKg: e.weightKg, reps: e.reps });
  if (warmupsToAdd.length > 0) {
    const ids = options.warmupId ? warmupsToAdd.map((_, i) => options.warmupId!(i)) : undefined;
    const added = store.addPlannedWarmups(sessionId, exerciseId, warmupsToAdd, { ids });
    // Ids another row already holds: the warm-ups go in under ids of their own.
    if (added === 'taken') store.addPlannedWarmups(sessionId, exerciseId, warmupsToAdd);
  }
  return true;
}
