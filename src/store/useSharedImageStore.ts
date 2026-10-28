import { create } from 'zustand';

/**
 * Screenshots and photos shared into the app from another app's share sheet,
 * waiting to be read for tasks: the names of the files the share extension left
 * in the App Group folder (`SharedTaskImageQueue.swift`), oldest first. Filled
 * by `useSharedTaskImages`, shown by `SharedImageBanner` on Today.
 *
 * **Memory only, unlike `useSharedLinkStore`, and deliberately.** A shared link
 * has to be persisted because the native drain deletes the file it read, which
 * leaves the store as the only copy. Here the file is the copy and stays put
 * until a person adds the tasks or discards the image, so a relaunch just lists
 * the folder again.
 */
interface SharedImageState {
  names: string[];
  setNames: (names: string[]) => void;
}

export const useSharedImageStore = create<SharedImageState>(set => ({
  names: [],
  setNames: names => set(state => (
    state.names.length === names.length && state.names.every((n, i) => n === names[i])
      ? state
      : { names }
  )),
}));
