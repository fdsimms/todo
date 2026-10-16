import type { Project, TaskFieldDefaults } from '../types';
import { describeTaskFieldDefaults, hasTaskFieldDefaults } from './taskFieldDefaults';

/**
 * Every answer kept as a default for new tasks, in one list, for the Backfill
 * screen's "Defaults you've set" sheet.
 *
 * Nothing here is stored a second time. A default lives where it is read: on
 * `Project.taskDefaults` for a project, in `generatedTaskDefaults` for a kind of
 * automatic task. This only reads both and says what each one amounts to.
 */
export interface SavedDefaultRow {
  /** Stable across renders, and unique across both homes. */
  key: string;
  home: 'project' | 'automatic';
  /** The project id, or the generated kind. */
  id: string;
  label: string;
  summary: string;
}

export function savedDefaultRows(
  projects: readonly Project[],
  generatedDefaults: Record<string, TaskFieldDefaults>,
  /** A kind's own wording, or null for a kind this build doesn't know. */
  automaticLabel: (kind: string) => string | null,
): { projects: SavedDefaultRow[]; automatic: SavedDefaultRow[] } {
  const projectRows: SavedDefaultRow[] = [];
  for (const p of projects) {
    // An archived project can't be reached to clear it from anywhere else, so
    // it stays listed: a default nobody can see is the one still filling tasks.
    if (!hasTaskFieldDefaults(p.taskDefaults)) continue;
    projectRows.push({
      key: `project:${p.id}`, home: 'project', id: p.id, label: p.title,
      summary: describeTaskFieldDefaults(p.taskDefaults) ?? '',
    });
  }
  const automaticRows: SavedDefaultRow[] = [];
  for (const [kind, d] of Object.entries(generatedDefaults)) {
    const label = automaticLabel(kind);
    // A kind written by a newer peer is kept in storage (see
    // `parseGeneratedTaskDefaults`) but has no name here to show.
    if (!label || !hasTaskFieldDefaults(d)) continue;
    automaticRows.push({
      key: `automatic:${kind}`, home: 'automatic', id: kind, label,
      summary: describeTaskFieldDefaults(d) ?? '',
    });
  }
  const byLabel = (a: SavedDefaultRow, b: SavedDefaultRow) => a.label.localeCompare(b.label);
  return { projects: projectRows.sort(byLabel), automatic: automaticRows.sort(byLabel) };
}
