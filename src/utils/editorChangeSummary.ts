/**
 * Which parts of the task editor differ from what it opened with, in the
 * words the editor's own rows use, for the "Discard changes?" alert to name.
 *
 * It reads the two JSON snapshots `TaskEditor` already compares (the baseline
 * and `currentSnapshot()`), so it can never disagree with the dirty check
 * about whether something changed. A field with no entry below is still
 * counted, as "other settings", so a new snapshot field degrades to a vaguer
 * line instead of an alert that names nothing.
 */

const LABELS: Record<string, string> = {
  title: 'title', notes: 'notes', category: 'category', projectId: 'project', project: 'project',
  tags: 'tags', personIds: 'people', attachments: 'attachments',
  dueDate: 'date', timeSegments: 'time of day',
  windowStart: 'time window', windowEnd: 'time window', windowStartSun: 'time window', windowEndSun: 'time window',
  deadline: 'deadline', deadlineOffsetDays: 'deadline', deadlineMonthDay: 'deadline',
  deadlineOnCalendar: 'deadline', deadlineTime: 'deadline', logCompletionToCalendar: 'deadline',
  deferUntil: 'defer date',
  reminderTime: 'reminder', reminderKind: 'reminder', alarmSound: 'reminder', alarmSoundPool: 'reminder',
  reminderOffsetDays: 'reminder', reminderTracksVisibility: 'reminder', reminderTimeAnchor: 'reminder',
  reminderUtcOffsetMinutes: 'reminder', reminderPlaceId: 'reminder', reminderPlaceOn: 'reminder',
  alarmLink: 'reminder', alarmLinkLeavesOpen: 'reminder',
  recurrenceType: 'repeat', recurrenceInterval: 'repeat', recurrenceDays: 'repeat', recurrenceMonthDay: 'repeat',
  recurrenceMonth: 'repeat', recurrenceWeekOrdinal: 'repeat', recurrenceFromCompletion: 'repeat',
  recurrenceHolidays: 'repeat', rainSkipMm: 'repeat', recurrenceEndDate: 'repeat', recurrenceCount: 'repeat',
  priority: 'priority', effort: 'effort', estimatedMinutes: 'effort', actualMinutes: 'effort', difficulty: 'difficulty',
  slotIn: 'slot in',
  timedMinutes: 'timer', completionTimerMinutes: 'timer', completionTimerNote: 'timer',
  targetCount: 'target', prorateFirstWeek: 'target', targetUnit: 'target', allowOvershoot: 'target',
  coinsPerTap: 'target', quotaIntervalMinutes: 'target', quotaReminders: 'target', quotaPlaceIds: 'target',
  quotaAlwaysVisible: 'target', quotaRestAfterLog: 'target', followWaterTarget: 'target', quotaPeriod: 'target',
  quotaRampStep: 'target', quotaRampEvery: 'target', quotaRampGoal: 'target',
  healthMetric: 'health goal', healthTarget: 'health goal', healthFollowGoal: 'health goal',
  chainEnabled: 'chain steps', chainItems: 'chain steps', chainIndex: 'chain steps', chainStepOnSchedule: 'chain steps',
  rotationItems: 'rotation',
  pinned: 'pin', pinEachOccurrence: 'pin',
  vacationPause: 'vacation pause', excludeFromSuggestions: 'suggestions', weatherWait: 'weather wait', bounty: 'bounty',
  polarity: 'goal', slipAllowance: 'goal', showStreak: 'streak', streakRequiresWindow: 'streak', streakCountsUnits: 'streak',
  linkUrl: 'link', phoneNumber: 'phone number', emailAddress: 'email address', location: 'location',
  blockerIds: 'waits for', waitForSeriesEnd: 'waits for', answerGate: 'waits for',
  waitingOnPersonId: 'waits for', followUpOn: 'waits for',
  deliverableKind: 'question on completion', deliverableOptionsText: 'question on completion',
  deliverableSetsAway: 'question on completion', mission: 'mission',
  followUpTaskEveryN: 'follow-up task', followUpTaskTitle: 'follow-up task', followUpTaskDraft: 'follow-up task',
  followUpTaskOneAtATime: 'follow-up task', followUpTaskAtEnd: 'follow-up task',
  penaltyMinutes: 'app limits', gatesApps: 'app limits', gateGroupId: 'app limits', penaltyCutoffTime: 'app limits',
  supplyCount: 'supply', supplyUnit: 'supply', supplyRefillCount: 'supply', supplyReorderAt: 'supply',
  supplyLeadDays: 'supply', supplyGroceryItemId: 'supply',
  logHealthMetric: 'logging', logHealthAmount: 'logging', medicationName: 'logging', medicationAmount: 'logging',
  medicationUnit: 'logging', medicationExtras: 'logging', logMealSlot: 'logging', logSavedMealId: 'logging',
  logMealSlotByTime: 'logging', workoutRoutineId: 'logging', workoutProgramId: 'logging',
  templateId: 'template',
};

const OTHER = 'other settings';

/** The labels of what changed between two snapshots, in the order the snapshot lists them, each once. */
export function changedEditorFields(baseline: string, current: string): string[] {
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;
  try {
    before = JSON.parse(baseline) as Record<string, unknown>;
    after = JSON.parse(current) as Record<string, unknown>;
  } catch {
    return [];
  }
  const labels: string[] = [];
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    const label = LABELS[key] ?? OTHER;
    if (!labels.includes(label)) labels.push(label);
  }
  // "other settings" reads as a catch-all, so it goes last whatever its position.
  return labels.includes(OTHER) ? [...labels.filter(l => l !== OTHER), OTHER] : labels;
}

/** "title", "title and notes", "title, notes and date", "title, notes, date and 2 more". */
export function listChanges(labels: string[], max = 3): string {
  if (labels.length === 0) return '';
  if (labels.length <= max) {
    return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  }
  const rest = labels.length - max;
  return `${labels.slice(0, max).join(', ')} and ${rest} more`;
}

/**
 * For a sheet whose dirty check is a handful of separate comparisons: pass each
 * field's label with whether it differs, get the text `confirmDiscard`'s
 * `changed` option takes ("title and notes"). Labels repeat freely (two fields
 * on one row) and are listed once.
 */
export function changedList(entries: ReadonlyArray<readonly [label: string, changed: boolean]>): string {
  const labels: string[] = [];
  for (const [label, changed] of entries) if (changed && !labels.includes(label)) labels.push(label);
  return listChanges(labels);
}

/**
 * For a sheet whose baseline is a JSON array (`snapshotOf`): `labels[i]` names
 * what slot `i` of the array holds, and the result is the text for
 * `confirmDiscard`'s `changed` option. Keep the two lists in one place, next to
 * the snapshot function, so a slot added to one is added to the other.
 */
export function changedSlots(labels: readonly string[], baseline: string, current: string): string {
  let before: unknown[];
  let after: unknown[];
  try {
    before = JSON.parse(baseline) as unknown[];
    after = JSON.parse(current) as unknown[];
  } catch {
    return '';
  }
  return changedList(labels.map((label, i) => [label, JSON.stringify(before[i]) !== JSON.stringify(after[i])] as const));
}
