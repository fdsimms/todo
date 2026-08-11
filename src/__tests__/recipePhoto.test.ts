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
jest.mock('expo-file-system', () => ({
  File: function MockFile(this: { delete: () => void }, target: string) {
    this.delete = () => mockDelete(target);
  },
}));

import { photoTargetSize, pickRecipePhoto, MAX_PHOTO_EDGE } from '../utils/recipePhoto';

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
