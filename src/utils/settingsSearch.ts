import { mergeRanges } from './ranges';
import type { SettingsEntry } from './settingsIndex';

export interface SettingsSearchResult {
  entry: SettingsEntry;
  /** Ranges to highlight in `entry.label`, merged and sorted. */
  labelRanges: [number, number][];
  /**
   * What matched when the label didn't — the keyword or section name, so a
   * result that looks unrelated to what was typed can say why it's there.
   * Null when the label itself matched.
   */
  matchedVia: string | null;
  score: number;
}

/**
 * Substring matching only — deliberately not `fuzzySearch`.
 *
 * Fuzzy matching earns its noise against hundreds of user-written task titles,
 * where the thing you're looking for is a half-remembered phrase. Settings is
 * thirty-odd fixed labels the app itself wrote, so subsequence matching mostly
 * returns rows that merely contain the right letters in the right order —
 * "date" pulling in "Auto-archive projects" — and there aren't enough rows for
 * that to be worth the recall.
 */
function findRanges(haystack: string, needle: string): [number, number][] {
  const h = haystack.toLowerCase();
  const ranges: [number, number][] = [];
  let from = 0;
  for (;;) {
    const i = h.indexOf(needle, from);
    if (i === -1) break;
    ranges.push([i, i + needle.length]);
    from = i + needle.length;
  }
  return ranges;
}

/**
 * Every term has to match something, but they may match different things — so
 * "vacation streak" finds the vacation row via its label and its keywords, and
 * a term matching nothing drops the row entirely.
 */
export function searchSettings(entries: SettingsEntry[], query: string): SettingsSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const results: SettingsSearchResult[] = [];

  for (const entry of entries) {
    const label = entry.label.toLowerCase();
    const haystacks = [entry.section, ...(entry.keywords ?? [])];

    let score = 0;
    let labelRanges: [number, number][] = [];
    let matchedVia: string | null = null;
    let allMatched = true;

    for (const term of terms) {
      const inLabel = findRanges(entry.label, term);
      if (inLabel.length > 0) {
        labelRanges.push(...inLabel);
        // A label match is the strongest signal, and one starting the label
        // beats one buried in the middle of it.
        score += label.startsWith(term) ? 100 : 60;
        continue;
      }

      const hit = haystacks.find(h => h.toLowerCase().includes(term));
      if (hit !== undefined) {
        score += 20;
        matchedVia ??= hit;
        continue;
      }

      allMatched = false;
      break;
    }

    if (!allMatched) continue;

    labelRanges = mergeRanges(labelRanges);
    results.push({
      entry,
      labelRanges,
      // The label carried it — nothing to explain.
      matchedVia: labelRanges.length > 0 ? null : matchedVia,
      score,
    });
  }

  // Stable within a score: the registry's order is the order of the screen,
  // so equal-scoring rows come back in the order you'd scroll past them.
  return results.sort((a, b) => b.score - a.score);
}
