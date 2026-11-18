/**
 * Tests for src/services/askClaudeCalls.ts. Network calls are intercepted with
 * a spy on global.fetch; no real key or server is reached.
 */
import { askClaude, confirmPreview, describeAskError, undoConfirmed } from '../services/askClaudeCalls';
import { userTurn, type AskPreview } from '../utils/askClaudeChat';

let mockSettings: { anthropicApiKey: string; aiFeatureConfig: Record<string, { enabled: boolean; model: string }> };
let mockServerUrl = 'https://todo.example.dev';
let mockToken = 'write-token';
const mockSyncNow = jest.fn(() => Promise.resolve(null));
const mockRevertable = jest.fn(() => 2);
const mockRevertBatch = jest.fn(() => ({ reverted: 2, skipped: 0 }));

jest.mock('../utils/errorLog', () => ({ logError: jest.fn() }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => mockSettings } }));
jest.mock('../store/useSyncStore', () => ({
  useSyncStore: { getState: () => ({ serverUrl: mockServerUrl, syncNow: mockSyncNow }) },
}));
jest.mock('../store/useUnattendedStore', () => ({ useUnattendedStore: { getState: () => ({ entries: [] }) } }));
jest.mock('../utils/agentUndo', () => ({
  agentUndoPlan: jest.fn(),
  revertableInBatch: () => mockRevertable(),
  revertBatch: () => mockRevertBatch(),
}));
jest.mock('../utils/agentUndoRun', () => ({ agentUndoReaders: jest.fn(), applyAgentUndo: jest.fn() }));
jest.mock('../utils/secureApiKey', () => ({
  MCP_WRITE_TOKEN_SECURE_KEY: 'mcpWriteToken',
  loadSecureKey: () => Promise.resolve(mockToken),
}));
jest.mock('todo-foundation-models', () => ({
  isOnDeviceModelAvailable: () => false,
  onDeviceModelAvailability: () => 'unavailable',
  generateOnDevice: jest.fn(),
}));

const reply = (content: unknown[], stop_reason = 'end_turn') =>
  ({ ok: true, status: 200, json: () => Promise.resolve({ content, stop_reason }) }) as Response;

const preview: AskPreview = { id: 'u1', tool: 'defer_task', willDo: ['Move "Dentist"'], confirmToken: 'tok' };

beforeEach(() => {
  mockSettings = { anthropicApiKey: 'key', aiFeatureConfig: { askClaude: { enabled: true, model: 'claude-haiku-5-5' } } };
  mockServerUrl = 'https://todo.example.dev';
  mockToken = 'write-token';
  jest.restoreAllMocks();
  mockSyncNow.mockClear();
  mockRevertable.mockReset().mockReturnValue(2);
  mockRevertBatch.mockClear();
});

describe('askClaude', () => {
  it('sends the conversation through the MCP connector with its beta and the chosen model', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply([{ type: 'text', text: 'Hi' }]));
    const turn = await askClaude([userTurn('Hello')]);
    expect(turn).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Hi' }] });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['anthropic-beta']).toBe('mcp-client-2025-11-20');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.mcp_servers[0]).toMatchObject({ url: 'https://todo.example.dev/mcp', authorization_token: 'write-token' });
  });

  it('picks up a reply that paused on a long run of tool calls, and joins the pieces', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply([{ type: 'text', text: 'Looking.' }], 'pause_turn'))
      .mockResolvedValueOnce(reply([{ type: 'text', text: 'Found it.' }]));
    const turn = await askClaude([userTurn('Find it')]);
    expect(turn.content).toEqual([{ type: 'text', text: 'Looking.' }, { type: 'text', text: 'Found it.' }]);
    const second = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(second.messages[second.messages.length - 1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Looking.' }] });
  });

  it('asks nothing while the switch is off, without a write token, or without a sync server', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    mockSettings.aiFeatureConfig.askClaude.enabled = false;
    await expect(askClaude([userTurn('x')])).rejects.toThrow('AI feature disabled');
    mockSettings.aiFeatureConfig.askClaude.enabled = true;
    mockToken = '';
    await expect(askClaude([userTurn('x')])).rejects.toThrow('No MCP write token');
    mockToken = 'write-token';
    mockServerUrl = '';
    await expect(askClaude([userTurn('x')])).rejects.toThrow('No sync server');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends nothing in demo mode', async () => {
    const { setDemoModeActive } = jest.requireActual('../utils/demoState') as typeof import('../utils/demoState');
    const fetchSpy = jest.spyOn(global, 'fetch');
    setDemoModeActive(true);
    try {
      await expect(askClaude([userTurn('x')])).rejects.toThrow('demo mode');
      expect(await confirmPreview(preview)).toEqual({ ok: false, reason: expect.stringMatching(/demo mode/) });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      setDemoModeActive(false);
    }
  });

  it('says what to fix in words for the person', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply([], 'refusal'));
    await expect(askClaude([userTurn('x')])).rejects.toThrow('Claude declined');
    expect(describeAskError(new Error('Claude declined'))).toMatch(/another way/);
    expect(describeAskError(new Error('No MCP write token'))).toMatch(/write token in Settings/);
    expect(describeAskError(Object.assign(new Error('API error 400'), { reason: 'Could not connect to MCP server dundundun' })))
      .toMatch(/couldn’t reach your server/);
  });
});

describe('confirmPreview', () => {
  it('calls confirm_change on the server with the write token, and reads back the batch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      text: () => Promise.resolve(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"batchId":"b1"}' }] } })}\n\n`),
    } as Response);
    expect(await confirmPreview(preview)).toEqual({ ok: true, batchId: 'b1' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://todo.example.dev/mcp');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer write-token');
    expect(JSON.parse(init.body as string).params).toEqual({ name: 'confirm_change', arguments: { confirmToken: 'tok', willDo: ['Move "Dentist"'] } });
  });

  it('turns a rejected token, a refusal and a dropped connection into a reason, and changes nothing', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve('') } as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"error":"That confirmToken was already used."}' }] } })),
      } as Response)
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await confirmPreview(preview)).toEqual({ ok: false, reason: expect.stringMatching(/didn’t accept the write token/) });
    expect(await confirmPreview(preview)).toEqual({ ok: false, reason: 'This change was already made.' });
    expect(await confirmPreview(preview)).toEqual({ ok: false, reason: expect.stringMatching(/Couldn’t reach your server/) });
  });

  it('has nothing to send for a preview that would change nothing', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    expect(await confirmPreview({ ...preview, confirmToken: null })).toMatchObject({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('undoConfirmed', () => {
  it('takes the batch back and sends the undo on', async () => {
    expect(await undoConfirmed('b1')).toEqual({ ok: true, reverted: 2, skipped: 0 });
    expect(mockRevertBatch).toHaveBeenCalledTimes(1);
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });

  it("pulls first when the change hasn't reached the phone, and says so if it still hasn't", async () => {
    mockRevertable.mockReturnValue(0);
    expect(await undoConfirmed('b1')).toEqual({ ok: false, reason: expect.stringMatching(/hasn’t reached this phone/) });
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(mockRevertBatch).not.toHaveBeenCalled();
  });
});
