import { discussProjectHint, discussWithClaude } from '../utils/discussWithClaude';

const mockShow = jest.fn();
const mockOpenExternal = jest.fn((_url: string) => Promise.resolve(true));
let mockReady = { enabled: true, apiKey: 'key', serverUrl: 'https://todo.example.dev', hasToken: true, demo: false };

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ aiFeatureConfig: { askClaude: { enabled: mockReady.enabled } }, anthropicApiKey: mockReady.apiKey }) },
}));
jest.mock('../store/useSyncStore', () => ({ useSyncStore: { getState: () => ({ serverUrl: mockReady.serverUrl }) } }));
jest.mock('../store/useAskClaudeStore', () => ({ useAskClaudeStore: { getState: () => ({ hasToken: mockReady.hasToken, show: mockShow }) } }));
jest.mock('../store/useDemoStore', () => ({ useDemoStore: { getState: () => ({ active: mockReady.demo }) } }));
jest.mock('../utils/openExternalUrl', () => ({ openExternalUrl: (url: string) => mockOpenExternal(url) }));

beforeEach(() => {
  mockReady = { enabled: true, apiKey: 'key', serverUrl: 'https://todo.example.dev', hasToken: true, demo: false };
  mockShow.mockClear();
  mockOpenExternal.mockClear();
});

describe('discussWithClaude', () => {
  it('types the message into Ask Claude when it is set up', () => {
    expect(discussWithClaude('About my task')).toBe('askClaude');
    expect(mockShow).toHaveBeenCalledWith('About my task');
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  it('opens the Claude app otherwise, as the link always did', () => {
    mockReady.hasToken = false;
    expect(discussWithClaude('About my task')).toBe('claudeApp');
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockOpenExternal).toHaveBeenCalledWith('https://claude.ai/new?q=About%20my%20task');
  });

  it('never opens Ask Claude in demo mode', () => {
    mockReady.demo = true;
    expect(discussWithClaude('x')).toBe('claudeApp');
  });

  it('says where a project chat will open', () => {
    expect(discussProjectHint(true)).toMatch(/Ask Claude/);
    expect(discussProjectHint(false)).toMatch(/Claude app/);
  });
});
