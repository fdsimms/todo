// #2704: the file half of syncing recipe photos. The database read and the
// file calls are mocked, since what's under test is which files get read,
// written and removed, and that none of it can throw into a sync.

let mockPaths = new Map<string, string>();
const mockDbPaths = jest.fn((ids?: readonly string[]) => {
  if (ids === undefined) return new Map(mockPaths);
  return new Map([...mockPaths].filter(([id]) => ids.includes(id)));
});
jest.mock('../db/database', () => ({
  dbRecipeImagePaths: (ids?: readonly string[]) => mockDbPaths(ids),
}));

let mockFiles = new Map<string, string>();
const mockDelete = jest.fn((name: string) => { mockFiles.delete(name.split('/').pop()!); });
let mockFileSystemThrows = false;
jest.mock('../utils/recipePhoto', () => ({
  recipeImageBasename: (uri: string) => uri.split('/').pop() || null,
  recipeImageOnDevice: (stored: string) => {
    if (mockFileSystemThrows) throw new Error('no expo-file-system in Node');
    return mockFiles.has(stored.split('/').pop()!);
  },
  readRecipeImageBase64: (uri: string) => mockFiles.get(uri.split('/').pop()!) ?? null,
  writeRecipeImageFile: (name: string, base64: string) => {
    if (mockFileSystemThrows) throw new Error('no expo-file-system in Node');
    mockFiles.set(name, base64);
    return `file:///doc/recipe-images/${name}`;
  },
  deleteRecipeImage: (uri: string) => mockDelete(uri),
}));

import {
  applyWithRecipeImages,
  readRecipeImageForSync,
  recipeIdsIn,
  recipeImageNames,
  unreferencedImageNames,
  writeRecipeImageFromSync,
} from '../utils/recipeImageSync';
import { emptyApplyReport, SYNC_FORMAT, type SyncPayload } from '../utils/syncMerge';

const OLD_DEVICE = 'file:///var/old-device/Documents/recipe-images/';

beforeEach(() => {
  mockPaths = new Map();
  mockFiles = new Map();
  mockFileSystemThrows = false;
  mockDbPaths.mockClear();
  mockDelete.mockClear();
});

const payload = (over: Partial<SyncPayload> = {}): SyncPayload => ({
  format: SYNC_FORMAT, deviceId: 'peer', since: null, until: 'x', tables: {}, deletions: [], ...over,
});

describe('recipeImageNames', () => {
  it('lists each photo the rows point at once, by filename, whatever device wrote the path', () => {
    mockPaths = new Map([
      ['r1', `${OLD_DEVICE}p1.jpg`],
      ['r2', 'file:///here/recipe-images/p2.jpg'],
      // A duplicated recipe keeps its original's path.
      ['r3', `${OLD_DEVICE}p1.jpg`],
    ]);
    expect(recipeImageNames().sort()).toEqual(['p1.jpg', 'p2.jpg']);
  });

  it('leaves out a name that could not have come from pickRecipeImage', () => {
    mockPaths = new Map([['r1', 'file:///x/recipe-images/bad name.jpg']]);
    expect(recipeImageNames()).toEqual([]);
  });

  it('answers empty rather than throwing', () => {
    mockDbPaths.mockImplementationOnce(() => { throw new Error('db closed'); });
    expect(recipeImageNames()).toEqual([]);
  });
});

describe('reading and writing a photo for sync', () => {
  it('reads a photo that is here, and nothing for one that is not or a bad name', () => {
    mockFiles.set('p1.jpg', 'AAAA');
    expect(readRecipeImageForSync('p1.jpg')).toBe('AAAA');
    expect(readRecipeImageForSync('p2.jpg')).toBeNull();
    expect(readRecipeImageForSync('../p1.jpg')).toBeNull();
  });

  it('writes a photo a peer sent under the name it was sent with', () => {
    expect(writeRecipeImageFromSync('p1.jpg', 'AAAA')).toBe(true);
    expect(mockFiles.get('p1.jpg')).toBe('AAAA');
  });

  it('never writes over a photo already here, since the name is minted once per photo', () => {
    mockFiles.set('p1.jpg', 'MINE');
    expect(writeRecipeImageFromSync('p1.jpg', 'THEIRS')).toBe(false);
    expect(mockFiles.get('p1.jpg')).toBe('MINE');
  });

  it('refuses a name that is a path, and empty bytes', () => {
    expect(writeRecipeImageFromSync('../../evil.jpg', 'AAAA')).toBe(false);
    expect(writeRecipeImageFromSync('p1.jpg', '')).toBe(false);
    expect(mockFiles.size).toBe(0);
  });

  it('answers false rather than throwing where there is no file system (the MCP replica)', () => {
    mockFileSystemThrows = true;
    expect(writeRecipeImageFromSync('p1.jpg', 'AAAA')).toBe(false);
  });
});

describe('recipeIdsIn', () => {
  it('names the recipes a payload writes and the ones it deletes, and nothing else', () => {
    expect(recipeIdsIn(payload({
      tables: { recipes: [{ id: 'r1', updated_at: 'x' }], tasks: [{ id: 't1', updated_at: 'x' }] },
      deletions: [{ table: 'recipes', rowKey: 'r2', deletedAt: 'x' }, { table: 'tasks', rowKey: 't2', deletedAt: 'x' }],
    })).sort()).toEqual(['r1', 'r2']);
  });
});

describe('unreferencedImageNames', () => {
  it('names a photo nothing points at any more, and keeps one another recipe still uses', () => {
    expect(unreferencedImageNames(
      [`${OLD_DEVICE}gone.jpg`, `${OLD_DEVICE}shared.jpg`],
      ['file:///here/recipe-images/shared.jpg'],
    )).toEqual(['gone.jpg']);
  });
});

describe('applyWithRecipeImages', () => {
  const apply = jest.fn(() => emptyApplyReport());
  beforeEach(() => apply.mockClear());

  it('removes the file of a recipe another device deleted', () => {
    mockPaths = new Map([['r1', `${OLD_DEVICE}p1.jpg`]]);
    mockFiles.set('p1.jpg', 'AAAA');
    apply.mockImplementationOnce(() => {
      mockPaths.delete('r1');
      return emptyApplyReport();
    });

    applyWithRecipeImages(payload({ deletions: [{ table: 'recipes', rowKey: 'r1', deletedAt: 'x' }] }), 'cloudkit', apply);

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'peer' }), 'cloudkit');
    expect(mockDelete).toHaveBeenCalledWith('p1.jpg');
  });

  it('removes the old file when another device replaced the photo', () => {
    mockPaths = new Map([['r1', `${OLD_DEVICE}old.jpg`]]);
    apply.mockImplementationOnce(() => {
      mockPaths.set('r1', `${OLD_DEVICE}new.jpg`);
      return emptyApplyReport();
    });

    applyWithRecipeImages(payload({ tables: { recipes: [{ id: 'r1', updated_at: 'x' }] } }), undefined, apply);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('old.jpg');
  });

  it('keeps a photo a duplicate recipe still points at', () => {
    mockPaths = new Map([['r1', `${OLD_DEVICE}p1.jpg`], ['r2', `${OLD_DEVICE}p1.jpg`]]);
    apply.mockImplementationOnce(() => {
      mockPaths.delete('r1');
      return emptyApplyReport();
    });

    applyWithRecipeImages(payload({ deletions: [{ table: 'recipes', rowKey: 'r1', deletedAt: 'x' }] }), undefined, apply);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('never touches a photo just taken here, whose row may not be written yet', () => {
    // r1's photo is unchanged by the payload; a new file sits waiting for its row.
    mockPaths = new Map([['r1', `${OLD_DEVICE}p1.jpg`]]);
    mockFiles.set('fresh.jpg', 'NEW');

    applyWithRecipeImages(payload({ tables: { recipes: [{ id: 'r1', updated_at: 'x' }] } }), undefined, apply);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockFiles.has('fresh.jpg')).toBe(true);
  });

  it('reads nothing extra for a payload that touches no recipe', () => {
    const report = applyWithRecipeImages(payload({ tables: { tasks: [{ id: 't1', updated_at: 'x' }] } }), undefined, apply);
    expect(report).toEqual(emptyApplyReport());
    expect(mockDbPaths).not.toHaveBeenCalled();
  });
});
