import { useEffect, useRef, useState } from 'react';
import { searchPlaces } from '../services/placeSearch';
import { PLACE_QUERY_MIN_LENGTH, type PlaceResult } from '../utils/places';
import { useSettingsStore } from '../store/useSettingsStore';

const PLACE_SEARCH_DEBOUNCE_MS = 350;
const MAX_SUGGESTIONS = 3;

/**
 * Apple Maps suggestions for a place being typed into a plain text field.
 *
 * Debounced, and checked against the query once the answer is back: a slow
 * answer for an older query must not replace the list for the current one.
 * `searchPlaces` owns the privacy rules (the `placeSuggestionsEnabled` switch,
 * demo mode), so with the switch off this stays empty and `enabled` tells the
 * caller to offer the switch. `active` is false while nothing should be looked
 * up, such as right after a suggestion was picked.
 */
export function usePlaceSuggestions(query: string, active: boolean): {
  results: PlaceResult[];
  enabled: boolean;
  wanted: boolean;
} {
  const enabled = useSettingsStore(s => s.placeSuggestionsEnabled);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const queryRef = useRef('');
  const trimmed = query.trim();
  const wanted = active && trimmed.length >= PLACE_QUERY_MIN_LENGTH;

  useEffect(() => {
    queryRef.current = trimmed;
    if (!enabled || !wanted) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchPlaces(trimmed).then(found => {
        if (queryRef.current === trimmed) setResults(found.slice(0, MAX_SUGGESTIONS));
      });
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, wanted, trimmed]);

  return { results, enabled, wanted };
}
