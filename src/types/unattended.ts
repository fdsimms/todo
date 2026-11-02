import type { GeneratedKind } from './task';

/**
 * What an unattended pass did, recorded once, as it did it.
 *
 * Twenty generators, the expiry sweep and the completed-task purge all write
 * or delete rows with nobody watching, and until this there was no account of
 * any of it: a task appeared on Today with no way to ask where it came from,
 * and one left with no way to ask what took it.
 *
 * Three rules decide what gets a row, and each of them is a refusal:
 *
 * 1. **The effect, never the pass.** The catch-up list is 27 steps and runs at
 *    every launch, every background refresh and every return to the
 *    foreground. Every generator is idempotent by construction, so almost all
 *    of that work is a reconcile that changes nothing — logging the pass would
 *    fill this table with repeats and call it history. A row is written where
 *    something actually appeared or went.
 * 2. **Nothing about the user.** This says what the app did. It records no
 *    misses, no judgements and no inferences, for the same reason
 *    `sweepExpiredTasks` refuses to call an expired window a miss: those are
 *    claims about a person, and an unattended pass does not get to enter one
 *    on their behalf.
 * 3. **A successor is not an entry.** Completing a recurring task spawns the
 *    next one, and a quota rollover spawns the next day's row. Those are the
 *    user's own rule doing what they set it to do, which is execution rather
 *    than a decision the app made. What belongs here is the writes nobody
 *    asked for individually.
 *
 * Bounded by construction rather than by a setting — see `ledgerCutoff` in
 * `src/utils/retention.ts` for why this one may not default to forever the way
 * the Logbook's own window does.
 */
export type UnattendedAction = 'created' | 'cleared' | 'expired' | 'purged' | 'edited' | 'moved' | 'completed' | 'missed';

/**
 * Who made the write: the app's own passes, or an agent working through the
 * MCP server (docs/arch/mcp-server.md).
 *
 * An agent's writes belong here for the reason the generators' do. They land
 * on the phone by sync, with nobody looking at the app when they happen, and
 * the question they leave is the same one: where did this come from, and how
 * do I take it back. The three rules above still hold. Each row is one effect
 * the agent actually made; it says what changed and never why the person
 * wanted it; and a successor the completion spawned is not a row of its own.
 */
export type UnattendedActor = 'app' | 'agent';

/** What an agent's entry is about. Everything the app writes on its own is a task. */
export type UnattendedSubject =
  | 'task' | 'project' | 'grocery' | 'meal' | 'template' | 'person' | 'recipe' | 'food' | 'mood' | 'medication'
  | 'automation' | 'note' | 'stack' | 'reward'
  // A task category deleted over MCP (`delete_category`); a record only, since the app keeps no undo for it from Activity.
  | 'category'
  // A change to what is in the kitchen (`pantryWrite.ts`), undoable by snapshot (`agentPantryRevert.ts`).
  | 'pantry'
  // A change to the grocery catalog, a store or a separate list (`groceryItemWrite.ts`): an item's own fields and a deleted item are undoable (`agentCatalogRevert.ts`), the rest is a record.
  | 'catalog'
  // A calendar request (`CalendarRequest`): the agent asked, a device writes the event.
  | 'event'
  // A milestone on the mood log (`Milestone`). Titled by kind, never by its label, for the
  // reason a mood entry is: the Activity list is about the app, not somebody's health.
  | 'milestone'
  // A restaurant dish rating. The feature is gone; kept so older entries still read.
  | 'dish'
  // A journal or dream entry (`JournalEntry`). Titled by kind, never by its text, for the same reason.
  | 'journal'
  // A saved view, created or deleted by an agent. The feature is gone; kept so
  // older entries still read.
  | 'view'
  // A switch in Settings an agent flipped (vacation mode). Record only: the switch is one tap.
  | 'setting'
  // A meter reading an agent logged or deleted. The feature is gone; kept so
  // older entries still read.
  | 'meter'
  // A pot, pan, lid or tub (`Cookware`) an agent added, changed or deleted. Record only.
  | 'cookware'
  // A workout routine (`WorkoutRoutine`) an agent saved or deleted. Record only.
  | 'routine'
  // A workout program (`WorkoutProgram`) an agent saved or deleted. Record only.
  | 'program'
  // A gym (`Gym`) an agent saved or deleted. Record only.
  | 'gym'
  // A custom exercise (`Exercise`) an agent made. Record only.
  | 'exercise'
  // A logged workout (`WorkoutSession`) an agent wrote after the fact, changed or deleted.
  // Titled by kind, never by what was lifted, for the mood entry's reason. Record only.
  | 'workout';

/**
 * What an agent's edit or move changed: the fields it touched, as they were
 * and as it left them. Only the touched fields, so the record of a retitle
 * does not carry a copy of the whole task, and so "is it still how the agent
 * left it" is a question about those fields alone (see `agentRevertPlan`).
 */
export interface UnattendedRevert {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface UnattendedEntry {
  id: string;
  /** When it happened, ISO. */
  at: string;
  action: UnattendedAction;
  /** The generator responsible, or null for the two sweeps, which have none. */
  kind: GeneratedKind | null;
  /**
   * The task's title as it read at the time.
   *
   * A snapshot rather than a lookup, and deliberately so: every row this names
   * has been deleted or is about to be, so there would be nothing left to look
   * it up from. Empty for a `purged` row, which accounts for a count rather
   * than for one task.
   */
  title: string;
  /**
   * The row it was about. Provenance only, and allowed to dangle — a `created`
   * entry outlives the task it names, and that is still a true account of the
   * app having written it.
   */
  taskId: string | null;
  /** How many rows this entry accounts for. 1 for all but `purged`. */
  count: number;
  /** Who made it. 'app' for every row written before agents could write. */
  actor: UnattendedActor;
  /** What it is about. 'task' for everything the app writes on its own. */
  subject: UnattendedSubject;
  /** An agent's edit or move, as before and after. Null for everything else. */
  revert: UnattendedRevert | null;
  /**
   * The confirmed agent call this entry came from. Every entry written by one
   * confirmed write shares it, which is what lets the Activity screen offer
   * "undo all" for a call rather than a row at a time. Null for the app's own
   * rows and for agent rows written before this existed.
   */
  batchId?: string | null;
  /**
   * The row an agent's entry is about when that row is not a task: a grocery
   * item, a meal, a log entry, a project, or the name of a rule list. It is
   * what the Activity screen reads the record's current state by, and it is
   * allowed to dangle for the reason `taskId` is. Null for everything else.
   */
  recordId?: string | null;
}
