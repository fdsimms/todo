/**
 * Tests for src/utils/recipePhoto.ts.
 *
 * The native modules are jest.mock'd rather than transformed — they're only
 * ever `require`d at call site, so resolution is short-circuited here and
 * expo-modules-core never loads in the node environment.
 */

const mockRequestCamera = jest.fn();
const mockRequestLibrary = jest.fn();
const mockLaunchCamera = jest.fn();
const mockLaunchLibrary = jest.fn();

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: (...args: unknown[]) => mockRequestCamera(...args),
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestLibrary(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCamera(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}));

const mockResize = jest.fn();
const mockSaveAsync = jest.fn();
const mockRenderAsync = jest.fn();
const mockManipulate = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

const mockDelete = jest.fn();
const mockMove = jest.fn();
const mockDirCreate = jest.fn();
// Tracks every File/Directory constructed so a test can assert what got
// moved/deleted without the mock itself doing any real path arithmetic.
let mockFileExists = true;
let mockDirExists = false;

jest.mock('expo-file-system', () => {
  const joinUri = (uris: unknown[]): string =>
    uris.map(u => (typeof u === 'string' ? u : (u as { uri: string }).uri)).join('/');

  return {
    File: function MockFile(this: { uri: string; exists: boolean; delete: () => void; move: (dest: unknown) => void }, ...uris: unknown[]) {
      this.uri = joinUri(uris);
      this.exists = mockFileExists;
      this.delete = () => mockDelete(this.uri);
      this.move = (dest: unknown) => {
        const destUri = (dest as { uri: string }).uri;
        mockMove(this.uri, destUri);
        this.uri = destUri;
      };
    },
    Directory: function MockDirectory(this: { uri: string; exists: boolean; create: () => void }, ...uris: unknown[]) {
      this.uri = joinUri(uris);
      this.exists = mockDirExists;
      this.create = () => mockDirCreate(this.uri);
    },
    Paths: { document: { uri: 'file:///documents' } },
  };
});

import {
  photoTargetSize,
  pickRecipePhoto,
  pickRecipeImage,
  deleteRecipeImage,
  MAX_PHOTO_EDGE,
  MAX_IMAGE_EDGE,
} from '../utils/recipePhoto';

const GRANTED = { granted: true, canAskAgain: true };

/** A picked asset at the given size, plus the save result it should produce. */
function stubPipeline(saved: { base64?: string | null; uri?: string; width?: number; height?: number } = {}) {
  const context = { resize: mockResize, renderAsync: mockRenderAsync };
  mockResize.mockReturnValue(context);
  mockManipulate.mockReturnValue(context);
  mockRenderAsync.mockResolvedValue({ saveAsync: mockSaveAsync });
  mockSaveAsync.mockResolvedValue({
    base64: 'QUJD',
    uri: 'file:///cache/out.jpg',
    width: 1568,
    height: 1176,
    ...saved,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFileExists = true;
  mockDirExists = false;
});

describe('photoTargetSize', () => {
  it('caps a landscape photo on its width', () => {
    expect(photoTargetSize(4032, 3024)).toEqual({ width: MAX_PHOTO_EDGE });
  });

  it('caps a portrait photo on its height', () => {
    expect(photoTargetSize(3024, 4032)).toEqual({ height: MAX_PHOTO_EDGE });
  });

  it('leaves a photo already inside the cap alone', () => {
    // A resize also upscales, which would cost bytes and add no legibility.
    expect(photoTargetSize(1200, 900)).toBeNull();
  });

  it('does not resize exactly at the cap', () => {
    expect(photoTargetSize(MAX_PHOTO_EDGE, 1000)).toBeNull();
  });

  it('is null for degenerate dimensions', () => {
    expect(photoTargetSize(0, 0)).toBeNull();
    expect(photoTargetSize(NaN, NaN)).toBeNull();
  });
});

describe('pickRecipePhoto', () => {
  it('reports a denied camera permission without launching the camera', async () => {
    mockRequestCamera.mockResolvedValue({ granted: false, canAskAgain: false });

    await expect(pickRecipePhoto('camera')).resolves.toEqual({
      status: 'denied', source: 'camera', canAskAgain: false,
    });
    expect(mockLaunchCamera).not.toHaveBeenCalled();
  });

  it('reports a denied library permission without opening the library', async () => {
    mockRequestLibrary.mockResolvedValue({ granted: false, canAskAgain: true });

    await expect(pickRecipePhoto('library')).resolves.toEqual({
      status: 'denied', source: 'library', canAskAgain: true,
    });
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });

  it('reports a cancel without touching the manipulator', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({ canceled: true });

    await expect(pickRecipePhoto('library')).resolves.toEqual({ status: 'canceled' });
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('never asks the picker for base64', async () => {
    mockRequestCamera.mockResolvedValue(GRANTED);
    mockLaunchCamera.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.heic', width: 4032, height: 3024 }],
    });
    stubPipeline();

    await pickRecipePhoto('camera');

    // Full-resolution base64 in the JS heap is the OOM this feature avoids.
    expect(mockLaunchCamera.mock.calls[0][0].base64).toBeUndefined();
  });

  it('re-encodes a HEIC capture to JPEG', async () => {
    mockRequestCamera.mockResolvedValue(GRANTED);
    mockLaunchCamera.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photo.heic', width: 4032, height: 3024, mimeType: 'image/heic' }],
    });
    stubPipeline();

    const result = await pickRecipePhoto('camera');

    // The API rejects HEIC outright, so the media type is a literal we produce
    // rather than anything read off the asset.
    expect(result).toMatchObject({ status: 'ok', photo: { mediaType: 'image/jpeg' } });
    expect(mockSaveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg', base64: true }));
  });

  it('downscales an oversized photo on its long edge', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 4032, height: 3024 }],
    });
    stubPipeline();

    await pickRecipePhoto('library');

    expect(mockResize).toHaveBeenCalledWith({ width: MAX_PHOTO_EDGE });
  });

  it('still re-encodes a photo too small to need resizing', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///small.heic', width: 800, height: 600 }],
    });
    stubPipeline();

    await pickRecipePhoto('library');

    expect(mockResize).not.toHaveBeenCalled();
    expect(mockSaveAsync).toHaveBeenCalled();
  });

  it('deletes the temp copy it made of the photo', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 2000, height: 1500 }],
    });
    stubPipeline();

    await pickRecipePhoto('library');

    expect(mockDelete).toHaveBeenCalledWith('file:///cache/out.jpg');
  });

  it('still returns the photo when the temp delete fails', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 2000, height: 1500 }],
    });
    stubPipeline();
    mockDelete.mockImplementation(() => { throw new Error('read-only'); });

    await expect(pickRecipePhoto('library')).resolves.toMatchObject({ status: 'ok' });
  });

  it('reports a failure rather than rejecting when the manipulator throws', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 2000, height: 1500 }],
    });
    mockManipulate.mockImplementation(() => { throw new Error('corrupt image'); });

    await expect(pickRecipePhoto('library')).resolves.toEqual({
      status: 'failed', message: 'corrupt image',
    });
  });

  it('reports a failure when the save came back without base64', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 2000, height: 1500 }],
    });
    stubPipeline({ base64: null });

    await expect(pickRecipePhoto('library')).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('pickRecipeImage', () => {
  it('reports a denied permission without launching the picker', async () => {
    mockRequestLibrary.mockResolvedValue({ granted: false, canAskAgain: true });

    await expect(pickRecipeImage('library')).resolves.toEqual({
      status: 'denied', source: 'library', canAskAgain: true,
    });
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });

  it('reports a cancel without touching the manipulator', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({ canceled: true });

    await expect(pickRecipeImage('library')).resolves.toEqual({ status: 'canceled' });
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('never asks the picker for base64, and resizes on the display-size cap', async () => {
    mockRequestCamera.mockResolvedValue(GRANTED);
    mockLaunchCamera.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.heic', width: 4032, height: 3024 }],
    });
    stubPipeline();

    await pickRecipeImage('camera');

    expect(mockLaunchCamera.mock.calls[0][0].base64).toBeUndefined();
    expect(mockResize).toHaveBeenCalledWith({ width: MAX_IMAGE_EDGE });
  });

  it('never asks saveAsync for base64 either — the file is what gets kept', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 1200, height: 900 }],
    });
    stubPipeline();

    await pickRecipeImage('library');

    expect(mockSaveAsync).toHaveBeenCalledWith(expect.not.objectContaining({ base64: true }));
  });

  it('creates the recipe-images directory when it does not exist yet', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 1200, height: 900 }],
    });
    stubPipeline();
    mockDirExists = false;

    await pickRecipeImage('library');

    expect(mockDirCreate).toHaveBeenCalled();
  });

  it('skips creating the directory when it already exists', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 1200, height: 900 }],
    });
    stubPipeline();
    mockDirExists = true;

    await pickRecipeImage('library');

    expect(mockDirCreate).not.toHaveBeenCalled();
  });

  it('moves the saved copy into the document directory rather than the cache one it was written to', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 1200, height: 900 }],
    });
    stubPipeline({ uri: 'file:///cache/out.jpg', width: 1200, height: 900 });

    const result = await pickRecipeImage('library');

    expect(mockMove).toHaveBeenCalledTimes(1);
    const [fromUri, toUri] = mockMove.mock.calls[0];
    expect(fromUri).toBe('file:///cache/out.jpg');
    expect(toUri).toContain('file:///documents/recipe-images/');
    expect(result).toMatchObject({ status: 'ok', image: { uri: toUri, width: 1200, height: 900 } });
  });

  it('reports a failure rather than rejecting when the manipulator throws', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 1200, height: 900 }],
    });
    mockManipulate.mockImplementation(() => { throw new Error('corrupt image'); });

    await expect(pickRecipeImage('library')).resolves.toEqual({
      status: 'failed', message: 'corrupt image',
    });
  });

  it('reports a failure when the save came back with no uri', async () => {
    mockRequestLibrary.mockResolvedValue(GRANTED);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 1200, height: 900 }],
    });
    stubPipeline({ uri: undefined });

    await expect(pickRecipeImage('library')).resolves.toMatchObject({ status: 'failed' });
    expect(mockMove).not.toHaveBeenCalled();
  });
});

describe('deleteRecipeImage', () => {
  it('is a no-op for null or undefined', () => {
    deleteRecipeImage(null);
    deleteRecipeImage(undefined);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes an existing file', () => {
    mockFileExists = true;

    deleteRecipeImage('file:///documents/recipe-images/abc.jpg');

    expect(mockDelete).toHaveBeenCalledWith('file:///documents/recipe-images/abc.jpg');
  });

  it('does not attempt to delete a file that no longer exists', () => {
    mockFileExists = false;

    deleteRecipeImage('file:///documents/recipe-images/gone.jpg');

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('swallows a delete failure', () => {
    mockFileExists = true;
    mockDelete.mockImplementation(() => { throw new Error('locked'); });

    expect(() => deleteRecipeImage('file:///documents/recipe-images/abc.jpg')).not.toThrow();
  });
});
