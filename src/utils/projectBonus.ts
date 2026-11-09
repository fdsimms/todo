import type { CoinEntry, Project, Task } from '../types';
import { useRewardStore } from '../store/useRewardStore';
import { isOpenEnded } from './listMode';

/**
 * The coin bonus for completing a project, as the task store and the MCP replica
 * both pay it. The rule is `projectBonusFor` (`rewards.ts`); this is the one
 * place that decides which projects qualify and which tasks count, so the app
 * and Claude can't disagree about it.
 *
 * Never for an ongoing project or a list (`isOpenEnded`): those have no finish
 * line, and every other "you're done" path already refuses them.
 */
export function payProjectBonus(
  project: Pick<Project, 'id' | 'title' | 'ongoing' | 'list'>,
  tasks: readonly Pick<Task, 'id' | 'projectId'>[],
): CoinEntry | null {
  if (isOpenEnded(project)) return null;
  const ids = new Set(tasks.filter(t => t.projectId === project.id).map(t => t.id));
  return useRewardStore.getState().recordProjectBonus(project.id, ids, `Project complete: ${project.title}`, new Date().toISOString());
}

/** Reopening a project takes its bonus back. Returns what was removed, for an undo to write again. */
export function takeBackProjectBonus(projectId: string): CoinEntry[] {
  return useRewardStore.getState().takeBackProjectBonus(projectId);
}
