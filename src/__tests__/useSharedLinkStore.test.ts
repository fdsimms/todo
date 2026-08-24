import { useSharedLinkStore } from '../store/useSharedLinkStore';
import { dbDeleteSetting, dbGetSetting, dbSetSetting } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
  dbDeleteSetting: jest.fn(),
}));

const mockGet = dbGetSetting as jest.MockedFunction<typeof dbGetSetting>;
const mockSet = dbSetSetting as jest.MockedFunction<typeof dbSetSetting>;
const mockDelete = dbDeleteSetting as jest.MockedFunction<typeof dbDeleteSetting>;

const NYT = 'https://cooking.nytimes.com/recipes/1024022-sheet-pan-chicken';
const OTHER = 'https://seriouseats.com/recipes/2';

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockReturnValue(null);
  useSharedLinkStore.setState({ pendingUrls: [], hydrated: false });
});

describe('hydrate', () => {
  it('reads the queue back from the settings table', () => {
    mockGet.mockReturnValue(JSON.stringify([NYT, OTHER]));
    useSharedLinkStore.getState().hydrate();
    expect(useSharedLinkStore.getState().pendingUrls).toEqual([NYT, OTHER]);
  });

  it('only reads once', () => {
    // Both the hook's mount and a later foreground call through here; the
    // second must not overwrite a queue the first already drained into.
    mockGet.mockReturnValue(JSON.stringify([NYT]));
    useSharedLinkStore.getState().hydrate();
    useSharedLinkStore.getState().enqueue([OTHER]);
    useSharedLinkStore.getState().hydrate();
    expect(useSharedLinkStore.getState().pendingUrls).toEqual([NYT, OTHER]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('starts empty when nothing was stored', () => {
    useSharedLinkStore.getState().hydrate();
    expect(useSharedLinkStore.getState().pendingUrls).toEqual([]);
  });
});

describe('enqueue', () => {
  it('persists on the way in', () => {
    // The native drain deletes the App Group file it read, so this store is the
    // only copy the moment it returns — a force-quit before the user taps
    // Import must not lose a recipe they saved on purpose.
    useSharedLinkStore.getState().enqueue([NYT]);
    expect(useSharedLinkStore.getState().pendingUrls).toEqual([NYT]);
    expect(mockSet).toHaveBeenCalledWith('sharedRecipeLinks', JSON.stringify([NYT]));
  });

  it('canonicalises and de-duplicates through mergeSharedLinks', () => {
    useSharedLinkStore.getState().enqueue(['COOKING.NYTIMES.COM/recipes/1', 'not a url']);
    expect(useSharedLinkStore.getState().pendingUrls).toEqual(['https://cooking.nytimes.com/recipes/1']);
  });

  it('does nothing for an empty drain', () => {
    useSharedLinkStore.getState().enqueue([]);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('keeps the array reference when a re-share changes nothing', () => {
    // The Recipes screen subscribes to this array; re-sharing a page already
    // queued shouldn't re-render it.
    useSharedLinkStore.getState().enqueue([NYT]);
    const before = useSharedLinkStore.getState().pendingUrls;
    mockSet.mockClear();
    useSharedLinkStore.getState().enqueue([NYT]);
    expect(useSharedLinkStore.getState().pendingUrls).toBe(before);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('dismiss', () => {
  it('drops one page and persists what is left', () => {
    useSharedLinkStore.getState().enqueue([NYT, OTHER]);
    mockSet.mockClear();
    useSharedLinkStore.getState().dismiss(NYT);
    expect(useSharedLinkStore.getState().pendingUrls).toEqual([OTHER]);
    expect(mockSet).toHaveBeenCalledWith('sharedRecipeLinks', JSON.stringify([OTHER]));
  });

  it('deletes the stored row once the queue empties', () => {
    useSharedLinkStore.getState().enqueue([NYT]);
    useSharedLinkStore.getState().dismiss(NYT);
    expect(useSharedLinkStore.getState().pendingUrls).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith('sharedRecipeLinks');
  });

  it('ignores a page that is not queued', () => {
    // The import sheet reports whatever source the recipe ended up with, which
    // for a paste or a photo is nothing this queue ever held.
    useSharedLinkStore.getState().enqueue([NYT]);
    mockSet.mockClear();
    useSharedLinkStore.getState().dismiss(OTHER);
    expect(useSharedLinkStore.getState().pendingUrls).toEqual([NYT]);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('clear', () => {
  it('empties the queue and its stored row', () => {
    useSharedLinkStore.getState().enqueue([NYT, OTHER]);
    useSharedLinkStore.getState().clear();
    expect(useSharedLinkStore.getState().pendingUrls).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith('sharedRecipeLinks');
  });

  it('does nothing when already empty', () => {
    useSharedLinkStore.getState().clear();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
