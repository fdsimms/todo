// A name search of the food database and the portion fetch behind a pick,
// shared by the standalone search sheet (`NutritionSearchSheet`) and the food
// log's own sheet, which runs it inline under its search field.
//
// Both are network round trips, so every reply is checked against what it was
// asked for before it is kept: a search overtaken by a newer one lands nothing,
// and `reset()` (a sheet closing or reopening, the inline section being shut)
// retires anything still in flight. A pick's portion fetch answered after a
// reset would otherwise hand a food to a screen that has moved on.
import { useCallback, useMemo, useRef, useState } from 'react';
import { rankFoodCandidates, type RankedFood } from '../utils/foodSearchMatch';
import {
  describeFoodSearchError,
  fetchFoodPortions,
  foodSearchErrorSettingsEntryId,
  searchFoods,
  type FoodSearchHit,
} from '../services/foodSearch';
import type { FoodNutrition } from '../types';

export interface FoodDatabaseSearch {
  /** The hits for the last search, ranked against `rankQuery`. */
  ranked: RankedFood[];
  searching: boolean;
  /** Whether a search has come back (with or without results) since the last reset. */
  searched: boolean;
  /** The fdcId whose portions are being fetched, while one is. */
  picking: string | null;
  error: string | null;
  /** The Settings row that would fix `error`, when one would. */
  errorSettingsEntryId: string | null;
  /** The text the last search was run for, or null before any. */
  searchedFor: string | null;
  run: (text: string) => Promise<void>;
  /**
   * Fetches the picked row's portion table and resolves to its full panel and
   * the database's own name for it, or null when the fetch failed (the error
   * is set) or its answer was dropped by a reset.
   */
  pick: (row: RankedFood) => Promise<{ nutrition: FoodNutrition; description: string } | null>;
  reset: () => void;
}

/**
 * `rankQuery` is what the hits are ranked against, which is the field's live
 * text rather than what was searched: a search sheet lets someone narrow the
 * hits by typing further without another request.
 */
export function useFoodDatabaseSearch(rankQuery: string): FoodDatabaseSearch {
  const [hits, setHits] = useState<FoodSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorSettingsEntryId, setErrorSettingsEntryId] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState<string | null>(null);

  // Which session a reply belongs to (bumped by reset), and which search is
  // the newest. Read back after each await.
  const sessionRef = useRef(0);
  const searchRef = useRef(0);

  const reset = useCallback(() => {
    sessionRef.current += 1;
    setHits([]);
    setSearching(false);
    setSearched(false);
    setPicking(null);
    setError(null);
    setErrorSettingsEntryId(null);
    setSearchedFor(null);
  }, []);

  const run = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    setErrorSettingsEntryId(null);
    setSearchedFor(trimmed);
    const session = sessionRef.current;
    const search = ++searchRef.current;
    const current = () => sessionRef.current === session && searchRef.current === search;
    try {
      const found = await searchFoods(trimmed);
      if (!current()) return;
      setHits(found);
    } catch (e) {
      if (!current()) return;
      setHits([]);
      setError(describeFoodSearchError(e));
      setErrorSettingsEntryId(foodSearchErrorSettingsEntryId(e));
    } finally {
      // Left alone for a search that was overtaken: the newer one owns the
      // spinner now, and a reset has already cleared it.
      if (current()) {
        setSearching(false);
        setSearched(true);
      }
    }
  }, []);

  const pick = useCallback(async (row: RankedFood) => {
    const hit = hits.find(h => h.candidate.fdcId === row.candidate.fdcId);
    if (!hit || picking) return null;
    setPicking(row.candidate.fdcId);
    setError(null);
    const session = sessionRef.current;
    try {
      // The second request, and the reason there is one: the portion table is
      // on the detail endpoint only, and without it a recipe line written as a
      // volume or a count can never become grams. See `readFdcPortions`.
      const portions = await fetchFoodPortions(row.candidate.fdcId);
      if (sessionRef.current !== session) return null;
      setPicking(null);
      return { nutrition: { ...hit.nutrition, portions }, description: row.candidate.description };
    } catch (e) {
      if (sessionRef.current !== session) return null;
      setError(describeFoodSearchError(e));
      setPicking(null);
      return null;
    }
  }, [hits, picking]);

  const ranked = useMemo(
    () => rankFoodCandidates(rankQuery, hits.map(h => h.candidate)),
    [rankQuery, hits],
  );

  return { ranked, searching, searched, picking, error, errorSettingsEntryId, searchedFor, run, pick, reset };
}
