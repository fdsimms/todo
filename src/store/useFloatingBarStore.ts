import { create } from 'zustand';

/**
 * Where the app-wide floating bars (CookingBar, FocusFloatingBar) end, measured
 * from the screen bottom. They live in the navigator, so a screen's own floating
 * button can't see them, and the one that shares their band (the scroll-to-top
 * button, in the corner opposite the add button) read `top` to rest above them
 * instead of underneath. Keyed by bar so one hiding can't clear another's edge.
 */
interface FloatingBarState {
  tops: Record<string, number>;
  report: (id: string, top: number | null) => void;
}

export const useFloatingBarStore = create<FloatingBarState>(set => ({
  tops: {},
  report: (id, top) =>
    set(s => {
      if (top === null) {
        if (!(id in s.tops)) return s;
        const { [id]: _gone, ...rest } = s.tops;
        return { tops: rest };
      }
      if (s.tops[id] === top) return s;
      return { tops: { ...s.tops, [id]: top } };
    }),
}));

/** The highest edge among the bars on screen, or 0 when there are none. */
export const selectFloatingBarsTop = (s: FloatingBarState): number =>
  Math.max(0, ...Object.values(s.tops));
