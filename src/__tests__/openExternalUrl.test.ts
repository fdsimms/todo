const mockOpenURL = jest.fn();
const mockAlert = jest.fn();
jest.mock('react-native', () => ({
  Linking: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));

import { externalFailureCopy, externalKindFor, openExternalUrl } from '../utils/openExternalUrl';

beforeEach(() => {
  mockOpenURL.mockReset();
  mockAlert.mockReset();
});

describe('externalKindFor', () => {
  it('reads the kind off the scheme', () => {
    expect(externalKindFor('tel:+15551234')).toBe('call');
    expect(externalKindFor('sms:+15551234')).toBe('message');
    expect(externalKindFor('mailto:a@b.co')).toBe('email');
    expect(externalKindFor('https://example.com')).toBe('link');
    expect(externalKindFor('someapp://thing')).toBe('link');
  });

  it('is case-insensitive and tolerates text with no scheme', () => {
    expect(externalKindFor('TEL:5551234')).toBe('call');
    expect(externalKindFor('no scheme here')).toBe('link');
  });
});

describe('externalFailureCopy', () => {
  it('names what failed, as a title that is not a command', () => {
    expect(externalFailureCopy('call').title).toBe('Couldn’t start the call');
    expect(externalFailureCopy('message').title).toBe('Couldn’t open Messages');
    expect(externalFailureCopy('email').title).toBe('Couldn’t open Mail');
    expect(externalFailureCopy('directions').title).toBe('Couldn’t open Maps');
    expect(externalFailureCopy('link').title).toBe('Couldn’t open that link');
  });
});

describe('openExternalUrl', () => {
  it('opens it and says nothing when the system can', async () => {
    mockOpenURL.mockResolvedValue(true);
    await expect(openExternalUrl('https://example.com')).resolves.toBe(true);
    expect(mockOpenURL).toHaveBeenCalledWith('https://example.com');
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('says it could not, in the words for what was being opened', async () => {
    mockOpenURL.mockRejectedValue(new Error('no handler'));
    await expect(openExternalUrl('mailto:a@b.co')).resolves.toBe(false);
    expect(mockAlert).toHaveBeenCalledWith('Couldn’t open Mail', expect.any(String));
  });

  it('takes the kind a caller names, since directions look like any https link', async () => {
    mockOpenURL.mockRejectedValue(new Error('no handler'));
    await openExternalUrl('https://maps.apple.com/?q=x', 'directions');
    expect(mockAlert).toHaveBeenCalledWith('Couldn’t open Maps', expect.any(String));
  });
});
