import { TITLE_MAX_LENGTH } from '../types';

/**
 * Tracking replies ("who's coming?") as ordinary tasks: one per guest, each
 * asking a Pick-one question (Yes / No / Maybe) when it's ticked off, counted
 * on the project page by `projectAnswerTallies`. Nothing here is a new kind
 * of record; this only turns a pasted guest list into the lines to add.
 */

/** A leading list marker a pasted list carries: "- ", "• ", "1. ", "[ ] ". */
const BULLET = /^\s*(?:[-*•◦▪]|\d+[.)]|\[[ xX]?\])\s+/;

/**
 * The guest names in what was typed or pasted: one per line or per comma,
 * bullets stripped, blanks and repeats (ignoring case) dropped, in order.
 */
export function parseGuestNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const name = part.replace(BULLET, '').trim().slice(0, TITLE_MAX_LENGTH);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}
