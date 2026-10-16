/**
 * Copy flags: lines of on-screen copy the person marked on their phone as
 * needing a manual pass (Settings › About › Flag copy). TEMPORARY dev tooling,
 * removed with the rest of the feature before the app opens to real users.
 *
 * The flow: `list_copy_flags` names each flagged string and the screen it was on,
 * the string is searched for in the app's source and rewritten, and
 * `resolve_copy_flag` closes the flag with what it became. The edit happens
 * wherever the source is checked out, and so does the search: each flag carries
 * a `find` command for that checkout. The server could not answer it itself
 * with a file and line, because the image holds a snapshot of `src/components`
 * and `src/screens` that deploys do not refresh (`deploy-mcp.yml` leaves them
 * out of its paths), so a line number from here would be wrong after most
 * copy edits.
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
  /** A command to run in the source checkout: lists the strings that match, with file and line. */
  find: string;
}

const HOW_TO_FIX = 'Run each flag\'s find command in the source checkout you are editing: it lists every string in the app that matches, with its file and line. The text is what the screen showed, so a number or a name in the middle of it is a gap in the source, and find searches the longest stretch without a digit. Change the copy to follow the app\'s copy rules, then call resolve_copy_flag with what it became.';

/** The most characters of a flag's text put in its search, so a long paragraph is not searched whole. */
const FIND_MAX_CHARS = 60;

/**
 * The `npm run copy -- --grep` command that finds a flagged string in the app's
 * source. The pattern is the longest stretch of the text with no digit in it,
 * because a number on screen is a `${…}` in the source (`copy` shows it as
 * `{}`), so the whole string would not match; short stretches fall back to the
 * whole text. An apostrophe of either kind becomes `.`, since the source writes
 * the curly one and the screen text may have either, and that also keeps the
 * single quotes around the pattern from needing escapes.
 */
export function copyFlagFind(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const stretches = flat.split(/\d+/).map(p => p.trim()).filter(Boolean);
  const longest = stretches.reduce((a, b) => (b.length > a.length ? b : a), '');
  const stretch = (longest.length >= 4 ? longest : flat).slice(0, FIND_MAX_CHARS);
  const pattern = stretch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\u2018\u2019']/g, '.');
  return `npm run copy -- --grep '${pattern}'`;
}

function row(f: CopyFlag): CopyFlagRow {
  return { id: f.id, text: f.text, screen: f.screen, note: f.note, status: f.status, resolution: f.resolution, find: copyFlagFind(f.text) };
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
