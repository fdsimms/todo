import type { Project, ProjectKind } from '../types';
import { nudgeFieldsFor } from './nudgeCadence';

/**
 * What a project's kind brings with it, beyond the drawing.
 *
 * A list has no finish line (`Project.ongoing`) and is never pulled from or
 * nudged about, since a list of books or gift ideas has no next task and never
 * gets "done". Those two used to be applied by whichever button made the list,
 * and only the quick-add chip remembered to: a list filed from a Reminders
 * capture, the header toggle's "Just show as a list" and two of the demo lists
 * all kept a progress bar, a "Mark complete" banner and a place in Pull from
 * projects. So the store applies them on every route (`createProject`,
 * `updateProject`), and this file is the one place they're written.
 */

export type KindFields = Pick<Project, 'ongoing' | 'nudgeOptIn' | 'nudgeCadenceDays'>;

/** What every list starts with. Both can still be changed in the editor. */
export const LIST_KIND_FIELDS: KindFields = {
  ongoing: true,
  ...nudgeFieldsFor('never', 0),
};

/**
 * What a project starts with: a finish line, and the nudge mode the Settings
 * default answers (see `createProject` for why both fields come from it).
 */
export function projectKindFields(defaultCadenceDays: number): KindFields {
  return {
    ongoing: false,
    ...nudgeFieldsFor(defaultCadenceDays > 0 ? 'scheduled' : 'on-ask', defaultCadenceDays),
  };
}

/** The fields a project of `kind` starts with. */
export function kindFields(kind: ProjectKind, defaultCadenceDays: number): KindFields {
  return kind === 'list' ? LIST_KIND_FIELDS : projectKindFields(defaultCadenceDays);
}

/**
 * The fields to write alongside a kind change, so switching either way lands
 * where creating that kind fresh would have. Turning a list back into a project
 * used to leave it ongoing and never nudged, which is a project that silently
 * can't finish.
 *
 * Empty when the kind isn't changing. A field the patch names itself wins, so
 * the editor, which saves every field at once, keeps what the person picked.
 */
export function kindSwitchFields(
  current: ProjectKind,
  patch: Partial<Project>,
  defaultCadenceDays: number,
): Partial<KindFields> {
  if (patch.kind === undefined || patch.kind === current) return {};
  const fields: Partial<KindFields> = { ...kindFields(patch.kind, defaultCadenceDays) };
  for (const key of Object.keys(fields) as (keyof KindFields)[]) {
    if (key in patch) delete fields[key];
  }
  return fields;
}
