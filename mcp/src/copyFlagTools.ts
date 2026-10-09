/**
 * Copy flags: lines of on-screen copy the person marked on their phone as
 * needing a manual pass (Settings › About › Flag copy). TEMPORARY dev tooling,
 * removed with the rest of the feature before the app opens to real users.
 *
 * The flow: `list_copy_flags` names each flagged string and the screen it was on,
 * the string is searched for in the app's source and rewritten, and
 * `resolve_copy_flag` closes the flag with what it became. This server cannot
 * see the repo, so the edit itself happens wherever the source is checked out.
 */
import type { CopyFlag } from '../../src/types';
import type { Replica } from './replica';

export interface CopyFlagRow {
  id: string;
  /** The string as rendered. A search key, not necessarily a source literal. */
  text: string;
  /** The route name it was flagged on. */
  screen: string;
  note: string;
  status: CopyFlag['status'];
  resolution: string;
}

const HOW_TO_FIX = 'Search the source for the text (or its stable fragments: a rendered string may be built from a template literal), change the copy to follow the app\'s copy rules, then call resolve_copy_flag with what it became.';

function row(f: CopyFlag): CopyFlagRow {
  return { id: f.id, text: f.text, screen: f.screen, note: f.note, status: f.status, resolution: f.resolution };
}

export function listCopyFlags(
  replica: Replica,
  input: { status?: 'open' | 'resolved' | 'all' } = {},
): { flags: CopyFlagRow[]; note: string } {
  const status = input.status ?? 'open';
  const flags = replica.copyFlags().filter(f => status === 'all' || f.status === status).map(row);
  return { flags, note: HOW_TO_FIX };
}

export function resolveCopyFlag(replica: Replica, id: string, resolution: string): { flag: CopyFlagRow } {
  return { flag: row(replica.resolveCopyFlag(id, resolution)) };
}
