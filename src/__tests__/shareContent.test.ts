const mockShare = jest.fn();
const mockAlert = jest.fn();
jest.mock('react-native', () => ({
  Share: { share: (...args: unknown[]) => mockShare(...args) },
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));

import { shareContent } from '../utils/shareContent';

beforeEach(() => {
  mockShare.mockReset();
  mockAlert.mockReset();
});

describe('shareContent', () => {
  it('shares and says nothing when the sheet opens', async () => {
    mockShare.mockResolvedValue({ action: 'sharedAction' });
    await expect(shareContent({ message: 'milk' })).resolves.toBe(true);
    expect(mockShare).toHaveBeenCalledWith({ message: 'milk' });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('treats backing out of the sheet as a normal outcome', async () => {
    mockShare.mockResolvedValue({ action: 'dismissedAction' });
    await expect(shareContent({ message: 'milk' })).resolves.toBe(true);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('says so when the sheet could not be presented', async () => {
    mockShare.mockRejectedValue(new Error('no view controller'));
    await expect(shareContent({ message: 'milk' })).resolves.toBe(false);
    expect(mockAlert).toHaveBeenCalledWith('Couldn’t share that', expect.any(String));
  });

  it('passes a url through with the message', async () => {
    mockShare.mockResolvedValue({ action: 'sharedAction' });
    await shareContent({ message: 'https://x.co', url: 'https://x.co' });
    expect(mockShare).toHaveBeenCalledWith({ message: 'https://x.co', url: 'https://x.co' });
  });
});
