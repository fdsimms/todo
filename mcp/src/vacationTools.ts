/**
 * Vacation mode: the switch in Settings that hides every task marked for
 * vacation pause, and every category set to hide on vacation, and protects
 * their streaks while it is on.
 *
 * `get_overview` reports it through `vacationState`, and `set_vacation_mode`
 * flips it through the settings store's own setter by way of the replica, so
 * what it does here is what the Settings toggle does: on the way off the
 * protected streaks are forgiven first (`vacationStreaks.ts`, the rule every
 * off-path shares), and what it hides is counted by the app's own
 * `isHiddenForVacation`, not re-derived.
 *
 * A trip can switch the mode on by itself (docs/arch/away-dates.md, "Scheduled
 * vacation mode"). Turning it off mid-trip from here is read by the phone's
 * pass exactly as a hand switch-off: declined for that trip, so it does not
 * come back tomorrow. The result says so, since from the person's side a
 * vacation that ends and a trip that is given up look the same.
 */
import type { Replica } from './replica';
import { eventNoonIso } from './taskFields';

export interface VacationState {
  on: boolean;
  /** When it was switched on. Stamped at the switch, so it records when they went, never when they are going. */
  since?: string;
  /** The day it turns itself off, `YYYY-MM-DD`, if one is set. */
  until?: string;
  /** The trip whose away dates switched it on, when a project did rather than a person. */
  drivenByTrip?: { projectId: string; title: string };
  /** What the mode hides while on: open tasks marked for vacation pause or in a hidden category, and those categories by name. */
  hiding: { tasks: number; categories: string[] };
}

/** The mode as it stands, for get_overview and for the result of a switch. */
export function vacationState(replica: Replica): VacationState {
  const settings = replica.settings();
  const categories = replica.categories().filter(c => c.hideOnVacation).map(c => c.name);
  if (!settings.vacationMode) return { on: false, hiding: { tasks: 0, categories } };
  const hidden = replica.tasks().filter(t => !t.parentId && !t.completed && !t.archived && replica.isHiddenForVacation(t)).length;
  const driver = settings.vacationDrivenBy ? replica.projects().find(p => p.id === settings.vacationDrivenBy) : undefined;
  return {
    on: true,
    ...(settings.vacationStart ? { since: settings.vacationStart } : {}),
    ...(settings.vacationEnd ? { until: replica.logicalDayKeyOf(settings.vacationEnd) } : {}),
    ...(driver ? { drivenByTrip: { projectId: driver.id, title: driver.title } } : {}),
    hiding: { tasks: hidden, categories },
  };
}

export interface SetVacationInput {
  on: boolean;
  /** `YYYY-MM-DD`: the day it turns itself off. null clears an end already set. Only with `on: true`. */
  until?: string | null;
}

export interface SetVacationResult extends VacationState {
  /** Set on the way off: the protected streaks re-dated so the pause reads as no gap. */
  forgivenStreaks?: number;
  note: string;
}

export function setVacationMode(replica: Replica, input: SetVacationInput): SetVacationResult {
  if (!input.on && input.until !== undefined) throw new Error('until goes with on: true; turning the mode off needs no end date.');
  let until: Date | null | undefined;
  if (input.until === null) until = null;
  else if (input.until !== undefined) {
    const noon = eventNoonIso(input.until);
    if (!noon) throw new Error(`until: "${input.until}" is not a date I can read. Use YYYY-MM-DD.`);
    if (replica.logicalDayKeyOf(noon) <= replica.todayKey()) throw new Error(`until: ${input.until} is not after today. The mode turns itself off on the morning of that day, so it has to be a later one.`);
    until = new Date(noon);
  }

  const wasDrivenBy = replica.settings().vacationDrivenBy;
  const outcome = replica.setVacationMode(input.on, until);
  const state = vacationState(replica);
  const driver = !input.on && wasDrivenBy ? replica.projects().find(p => p.id === wasDrivenBy) : undefined;

  const hides = (n: number, cats: string[]) =>
    `${n} ${n === 1 ? 'task' : 'tasks'} marked for vacation pause${cats.length ? ` and the ${cats.length === 1 ? 'category' : 'categories'} ${cats.join(', ')}` : ''}`;
  let note: string;
  if (outcome.endOnly) {
    note = state.until
      ? `Vacation mode was already on; it now turns itself off on ${state.until}. It is still hiding ${hides(outcome.hiddenTasks, outcome.hiddenCategories)}, with their streaks protected.`
      : `Vacation mode was already on; its end date is cleared, so it stays on until it is turned off. It is still hiding ${hides(outcome.hiddenTasks, outcome.hiddenCategories)}.`;
  } else if (input.on) {
    note = `Vacation mode is on${state.until ? ` and turns itself off on ${state.until}` : ' until it is turned off'}. It hides ${hides(outcome.hiddenTasks, outcome.hiddenCategories)}, and protects their streaks; everything else stays where it was.`;
  } else {
    note = `Vacation mode is off. ${hides(outcome.hiddenTasks, outcome.hiddenCategories)} ${outcome.hiddenTasks === 1 ? 'is' : 'are'} back on their lists, and ${outcome.forgivenStreaks} protected ${outcome.forgivenStreaks === 1 ? 'streak was' : 'streaks were'} forgiven so the pause reads as no gap.`;
    if (driver) note += ` The trip "${driver.title}" had switched it on; the phone records this as turned off for that trip, so the trip does not switch it back on tomorrow.`;
  }
  return {
    ...state,
    ...(input.on ? {} : { forgivenStreaks: outcome.forgivenStreaks }),
    note,
  };
}
