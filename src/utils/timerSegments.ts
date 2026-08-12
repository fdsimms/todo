import type { Task } from '../types';

/**
 * Apportioning a timed task's countdown across its subtasks.
 *
 * "Violin practice, 25 minutes" is really "5 min scales, 10 min known pieces,
 * 10 min new piece" — one running timer with signposts in it. A subtask of a
 * timed task may carry its own `timedMinutes`, which is its stretch of the
 * parent's run; the stretches are laid end to end in subtask order, and where
 * the clock has got to is what says which one you're on.
 *
 * **The stretches are read off the clock, never stored or ticked.** Nothing
 * here writes: no "current segment" column, no auto-completing a subtask when
 * its minutes run out. That's the same call `utils/timer.ts` makes about
 * readiness and for the same reason — a stored pointer would need clearing on
 * pause, on reset and on every new occurrence of a recurring task, and would go
 * stale the moment the app is backgrounded. Deriving means a phone that was off
 * for ten minutes comes back on the right stretch for free.
 *
 * A subtask's tick box stays the user's own: ticking "scales" early doesn't
 * skip the timer forward, and the timer passing "scales" doesn't tick it. They
 * measure different things — one is where the clock is, the other is what you
 * decided you were done with.
 *
 * The parent's `timedMinutes` remains the countdown's one target (see the note
 * on `Task.timedMinutes`); this module only says how that target is signposted.
 * When the stretches don't fill it — an older row, or a subtask deleted from
 * somewhere that didn't re-total — the run simply has no active stretch past
 * the last one, and every reader here degrades to the plain countdown.
 */
export interface TimerSegment {
  /** The subtask this stretch belongs to. */
  id: string;
  title: string;
  /** The stretch's own length. */
  minutes: number;
  /** Offsets into the parent's run, in seconds. */
  startSeconds: number;
  endSeconds: number;
}

/** Where a stretch sits relative to the clock. */
export type SegmentPhase = 'done' | 'active' | 'upcoming';

/**
 * The three fields a stretch is read off. Deliberately narrower than `Task`, so
 * the editor can lay out the same signposts for subtasks typed into a task that
 * doesn't exist yet (`DraftSubtask`) without having to fake a whole row.
 */
export type SegmentSource = Pick<Task, 'id' | 'title' | 'timedMinutes'>;

/** A subtask's own stretch, if it has one. Non-positive minutes count as none. */
export function segmentMinutesOf(subtask: Pick<Task, 'timedMinutes'>): number | null {
  const minutes = subtask.timedMinutes;
  return minutes != null && minutes > 0 ? minutes : null;
}

/**
 * The stretches, laid end to end in the order the subtasks are in.
 *
 * Subtasks without minutes are skipped rather than given a zero-length
 * stretch — a subtask that isn't part of the apportionment is a step with no
 * time attached, not an instant one. Completed subtasks keep their stretch:
 * the run's length can't depend on what's been ticked, or the countdown would
 * shorten under the user mid-session.
 */
export function timerSegments(subtasks: SegmentSource[]): TimerSegment[] {
  const segments: TimerSegment[] = [];
  let cursor = 0;
  subtasks.forEach(sub => {
    const minutes = segmentMinutesOf(sub);
    if (minutes === null) return;
    const startSeconds = cursor;
    cursor += minutes * 60;
    segments.push({ id: sub.id, title: sub.title, minutes, startSeconds, endSeconds: cursor });
  });
  return segments;
}

/**
 * The total the stretches add up to, or null when nothing is apportioned.
 *
 * This is what the editor writes to the parent's `timedMinutes` — the sum is
 * the target, so setting a stretch changes how long the task runs for rather
 * than carving up a number the user also has to keep in step by hand.
 */
export function apportionedMinutes(subtasks: SegmentSource[]): number | null {
  const segments = timerSegments(subtasks);
  if (segments.length === 0) return null;
  return segments.reduce((total, s) => total + s.minutes, 0);
}

/**
 * Index of the stretch the clock is inside, or -1 when there isn't one —
 * nothing apportioned, or the run has already passed the last stretch.
 *
 * A stretch owns its start and not its end, so the instant one runs out is the
 * next one's first instant rather than a moment belonging to both.
 */
export function activeSegmentIndex(segments: TimerSegment[], elapsedSeconds: number): number {
  const clamped = Math.max(0, elapsedSeconds);
  return segments.findIndex(s => clamped < s.endSeconds);
}

/** The stretch the clock is inside, or null. */
export function activeSegment(segments: TimerSegment[], elapsedSeconds: number): TimerSegment | null {
  const index = activeSegmentIndex(segments, elapsedSeconds);
  return index === -1 ? null : segments[index];
}

export function segmentPhase(segment: TimerSegment, elapsedSeconds: number): SegmentPhase {
  const clamped = Math.max(0, elapsedSeconds);
  if (clamped >= segment.endSeconds) return 'done';
  if (clamped >= segment.startSeconds) return 'active';
  return 'upcoming';
}

/** Seconds left of this stretch. 0 once the clock is past it. */
export function segmentRemaining(segment: TimerSegment, elapsedSeconds: number): number {
  return Math.max(0, segment.endSeconds - Math.max(0, elapsedSeconds));
}
