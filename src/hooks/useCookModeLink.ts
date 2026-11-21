import { useEffect, useRef } from 'react';
import { useCookModeStore, type CookModeSetup } from '../store/useCookModeStore';

// Longer than a native-stack pop, so it only ever fires when `transitionEnd` didn't.
const REQUEST_FALLBACK_MS = 1500;

interface Options {
  recipeId: string;
  /** Called with what cook mode now holds, each time it changes while it is up. */
  onSetup: (setup: CookModeSetup) => void;
  /** The end screen's "Log as cooked", once the page has left. */
  onCooked: () => void;
  /** The end screen's food log offer, once the page has left. */
  onFood: () => void;
}

/**
 * The recipe screen's side of cook mode, which is a page over it
 * (`CookModeScreen`, see `useCookModeStore`): keeps the screen's scale and
 * picks in step with what the page changes, answers the offers it leaves, and
 * says whether the page is up. Its own hook so the screen takes one line.
 */
export function useCookModeLink({ recipeId, onSetup, onCooked, onFood }: Options): { cooking: boolean } {
  const setup = useCookModeStore(s => (s.setup?.recipeId === recipeId ? s.setup : null));
  const request = useCookModeStore(s => (s.request?.recipeId === recipeId ? s.request : null));
  const latest = useRef({ onSetup, onCooked, onFood });
  latest.current = { onSetup, onCooked, onFood };

  useEffect(() => {
    if (setup) latest.current.onSetup(setup);
  }, [setup]);

  const pending = request !== null && !request.ready;
  useEffect(() => {
    if (!pending) return;
    const fallback = setTimeout(() => useCookModeStore.getState().markRequestReady(), REQUEST_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [pending]);

  const readyKind = request?.ready ? request.kind : null;
  useEffect(() => {
    if (!readyKind) return;
    useCookModeStore.getState().clearRequest();
    if (readyKind === 'cooked') latest.current.onCooked();
    else latest.current.onFood();
  }, [readyKind]);

  return { cooking: setup !== null };
}
