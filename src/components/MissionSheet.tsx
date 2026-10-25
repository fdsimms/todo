import React from 'react';
import type { AlarmMission, Task } from '../types';
import { PushupCounterSheet } from './PushupCounterSheet';
import { displayTitleFor } from '../utils/visibilityUtils';
import { normalizeMission } from '../utils/missions';

interface Props {
  visible: boolean;
  mission: AlarmMission;
  /** What the mission is for: a task's or an alarm's title. */
  title: string;
  /** Starts the mission afresh when it changes while the sheet is up. */
  subjectKey: string;
  /** What the sheet says once the mission is done, as it slides away. */
  doneNote: string;
  /** The mission is done. The caller closes the sheet and finishes what it was for. */
  onDone: () => void;
  /** Cancel: closes the sheet with nothing done. */
  onClose: () => void;
  /** Only while an alarm is ringing for it: the held Give up (see missions.ts). */
  onGiveUp?: () => void;
}

/**
 * Runs a mission, whichever kind it is. Every caller (a task's row and
 * checkbox, the answer queue, the ringing-alarm host) goes through this, so a
 * new kind of mission is one more case here rather than a change at each.
 */
export function MissionSheet({ mission, onDone, ...rest }: Props) {
  switch (mission.kind) {
    case 'pushups':
      return <PushupCounterSheet {...rest} count={mission.count} onCounted={onDone} />;
  }
}

/** The props a task's own mission sheet takes from the task, or null for a task with none. */
export function taskMissionProps(task: Task): Pick<Props, 'mission' | 'title' | 'subjectKey' | 'doneNote'> | null {
  const mission = normalizeMission(task.mission);
  if (!mission) return null;
  const title = displayTitleFor(task);
  return { mission, title, subjectKey: task.id, doneNote: `${title} is checked off.` };
}
