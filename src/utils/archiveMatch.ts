import { scoreSubstring } from './ranges';

// High bar (near-exact title match, not just "shares some letters") — this
// only fires to catch "I'm re-adding the thing I archived months ago", not
// to flag every item that vaguely resembles an old one.
const MATCH_THRESHOLD = 70;

// Titled enough to match on — tasks and projects both qualify.
export function findArchivedMatch<T extends { title: string }>(archived: T[], title: string): T | null {
  const q = title.trim();
  if (!q) return null;
  const qLower = q.toLowerCase();

  let best: { item: T; score: number } | null = null;
  for (const item of archived) {
    const t = item.title.trim();
    if (!t) continue;
    if (t.toLowerCase() === qLower) return item;
    const { score } = scoreSubstring(t, q);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { item, score };
    }
  }
  return best?.item ?? null;
}
