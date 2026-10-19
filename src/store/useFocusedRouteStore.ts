import { create } from 'zustand';

/**
 * The route on show right now, whichever kind it is (a tab, or a card pushed
 * over one). Written on every navigation state change and read by `AppFrame`
 * alone, to decide whether the app's column is lifted for a two-pane screen
 * (`columnUncappedFor`). A store rather than a prop on the navigator: the
 * navigator is memoized so a tab switch doesn't re-render it and everything it
 * overlays, and this is the one thing that has to change with every switch.
 */
interface FocusedRouteState {
  route: string | null;
  setRoute: (route: string | null) => void;
}

export const useFocusedRouteStore = create<FocusedRouteState>(set => ({
  route: null,
  setRoute: route => set(state => (state.route === route ? state : { route })),
}));
