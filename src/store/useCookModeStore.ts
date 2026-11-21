import { create } from 'zustand';
import { navigationRef, runWhenReady, COOK_MODE_ROUTE } from '../navigation/navigationRef';
import type { RecipeOverride } from '../types';

/**
 * What cook mode is cooking, shared between the recipe screen that opens it
 * and the page itself (`CookModeScreen`, a card pushed over the recipe).
 * `RecipeDetailScreen` owns the scale, the either/or picks and the one-off
 * replacements, and cook mode both reads and changes them (a pick made at the
 * counter has to still be the pick back on the recipe), which two screens can
 * only do through something both can see. Screen state only: never persisted
 * (`cookPosition.ts` remembers the setup for a cooking underway).
 */
export interface CookModeSetup {
  recipeId: string;
  scale: number;
  choices: string[];
  overrides: RecipeOverride[];
  /** Whether the end screen offers the food log (the recipe's nutrition can be worked out). */
  canLogFood: boolean;
}

export type CookModeRequest = 'cooked' | 'food';

interface CookModeState {
  setup: CookModeSetup | null;
  /**
   * An end-screen offer for the recipe screen to answer, since the sheet that
   * answers it can't be presented while this page is on top. `ready` flips once
   * the page has finished leaving, because UIKit drops a sheet presented
   * mid-transition (the same hand-off `useWorkoutModeStore.ask` makes).
   */
  request: { recipeId: string; kind: CookModeRequest; ready: boolean } | null;
  /** Opens the page on a recipe with this setup. */
  open: (setup: CookModeSetup) => void;
  /** Changes what is being cooked from the page; the recipe screen mirrors it. */
  update: (patch: Partial<Pick<CookModeSetup, 'scale' | 'choices' | 'overrides'>>) => void;
  /** Leaves the page. The cook timer keeps running. */
  close: () => void;
  requestAfterClose: (recipeId: string, kind: CookModeRequest) => void;
  markRequestReady: () => void;
  clearRequest: () => void;
}

function onCookPage(): boolean {
  return navigationRef.isReady() && navigationRef.getCurrentRoute()?.name === COOK_MODE_ROUTE;
}

export const useCookModeStore = create<CookModeState>((set, get) => ({
  setup: null,
  request: null,
  open: setup => {
    set({ setup });
    runWhenReady(() => {
      if (!onCookPage()) navigationRef.navigate(COOK_MODE_ROUTE, { recipeId: setup.recipeId });
    });
  },
  update: patch => set(s => (s.setup ? { setup: { ...s.setup, ...patch } } : s)),
  close: () => {
    if (onCookPage() && navigationRef.canGoBack()) navigationRef.goBack();
  },
  requestAfterClose: (recipeId, kind) => set({ request: { recipeId, kind, ready: false } }),
  markRequestReady: () => set(s => (s.request && !s.request.ready ? { request: { ...s.request, ready: true } } : s)),
  clearRequest: () => {
    if (get().request) set({ request: null });
  },
}));
