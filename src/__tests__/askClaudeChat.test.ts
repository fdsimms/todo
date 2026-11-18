import {
  ASK_CLAUDE_LOADED_TOOLS,
  askClaudeReady,
  ASK_CLAUDE_SERVER,
  buildAskRequest,
  confirmChangeRequest,
  confirmRefusalText,
  doneLine,
  mcpUrlFor,
  previewNote,
  readAskReply,
  readConfirmResponse,
  userTurn,
  type AskPreview,
} from '../utils/askClaudeChat';

const previewText = (willDo: string[], confirmToken = 'tok1') =>
  JSON.stringify({ preview: true, willDo, confirmToken, next: 'Nothing has changed yet.' });

const preview = (over: Partial<AskPreview> = {}): AskPreview => ({
  id: 'mcptoolu_1', tool: 'defer_task', willDo: ['Move "Dentist": date from today to Friday'], confirmToken: 'tok1', ...over,
});

describe('mcpUrlFor', () => {
  it('is the sync server with /mcp on the end', () => {
    expect(mcpUrlFor('https://todo.fly.dev')).toBe('https://todo.fly.dev/mcp');
    expect(mcpUrlFor('  https://todo.fly.dev//  ')).toBe('https://todo.fly.dev/mcp');
  });

  it('is null with no sync server, or with something that is not an address', () => {
    expect(mcpUrlFor('')).toBeNull();
    expect(mcpUrlFor(null)).toBeNull();
    expect(mcpUrlFor('todo.fly.dev')).toBeNull();
  });
});

describe('buildAskRequest', () => {
  const body = buildAskRequest({ history: [userTurn('Hi')], mcpUrl: 'https://s/mcp', writeToken: 'w' });

  it('points the connector at the server with the write token', () => {
    expect(body.mcp_servers).toEqual([{ type: 'url', url: 'https://s/mcp', name: ASK_CLAUDE_SERVER, authorization_token: 'w' }]);
  });

  it('defers every tool but a few reads, and never lets the model confirm', () => {
    const toolset = (body.tools as Record<string, unknown>[]).find(t => t.type === 'mcp_toolset') as {
      default_config: unknown; configs: Record<string, { defer_loading?: boolean; enabled?: boolean }>;
    };
    expect(toolset.default_config).toEqual({ defer_loading: true });
    for (const name of ASK_CLAUDE_LOADED_TOOLS) expect(toolset.configs[name]).toEqual({ defer_loading: false });
    expect(toolset.configs.confirm_change).toEqual({ enabled: false });
  });

  it('keeps the search tool loaded, since the API refuses a request with every tool deferred', () => {
    const search = (body.tools as Record<string, unknown>[])[0];
    expect(search).toEqual({ type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' });
    expect(search).not.toHaveProperty('defer_loading');
  });

  it('sends the history as it was given and leaves the model to the caller', () => {
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(body).not.toHaveProperty('model');
  });
});

describe('userTurn', () => {
  it('is plain text with nothing to report', () => {
    expect(userTurn('Add milk')).toEqual({ role: 'user', content: 'Add milk' });
  });

  it("puts the app's notes ahead of the person's words", () => {
    expect(userTurn('Thanks', ['(App: done.)'])).toEqual({
      role: 'user', content: [{ type: 'text', text: '(App: done.)' }, { type: 'text', text: 'Thanks' }],
    });
  });
});

describe('readAskReply', () => {
  it("shows Claude's words and a card for each preview, in order", () => {
    const items = readAskReply([
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'Let me find it.' },
      { type: 'mcp_tool_use', id: 'u1', name: 'search_tasks', server_name: ASK_CLAUDE_SERVER, input: {} },
      { type: 'mcp_tool_result', tool_use_id: 'u1', is_error: false, content: [{ type: 'text', text: '{"tasks":[]}' }] },
      { type: 'text', text: 'Found it. Here is the change:' },
      { type: 'mcp_tool_use', id: 'u2', name: 'defer_task', server_name: ASK_CLAUDE_SERVER, input: {} },
      { type: 'mcp_tool_result', tool_use_id: 'u2', is_error: false, content: [{ type: 'text', text: previewText(['Move "Dentist"']) }] },
      { type: 'text', text: 'Tap Confirm to move it.' },
    ]);
    expect(items).toEqual([
      { kind: 'text', text: 'Let me find it.\n\nFound it. Here is the change:' },
      { kind: 'preview', preview: { id: 'u2', tool: 'defer_task', willDo: ['Move "Dentist"'], confirmToken: 'tok1' } },
      { kind: 'text', text: 'Tap Confirm to move it.' },
    ]);
  });

  it('offers nothing to confirm when the write would change nothing', () => {
    const [item] = readAskReply([
      { type: 'mcp_tool_use', id: 'u1', name: 'update_task', input: {} },
      { type: 'mcp_tool_result', tool_use_id: 'u1', content: [{ type: 'text', text: previewText(['Nothing in the app would change.']) }] },
    ]);
    expect(item).toEqual({ kind: 'preview', preview: expect.objectContaining({ confirmToken: null }) });
  });

  it('shows nothing for a failed call, a refusal, or a search', () => {
    expect(readAskReply([
      { type: 'mcp_tool_result', tool_use_id: 'u1', is_error: true, content: [{ type: 'text', text: previewText(['x']) }] },
      { type: 'mcp_tool_result', tool_use_id: 'u2', content: [{ type: 'text', text: '{"error":"No task has that id."}' }] },
      { type: 'server_tool_use', id: 's1', name: 'tool_search_tool_bm25', input: { query: 'grocery' } },
      { type: 'tool_search_tool_result', tool_use_id: 's1', content: { type: 'tool_search_tool_search_result', tool_references: [] } },
      { type: 'text', text: '   ' },
    ])).toEqual([]);
  });
});

describe('confirmChangeRequest', () => {
  it('calls confirm_change with the token and the lines repeated exactly', () => {
    expect(confirmChangeRequest(preview())).toEqual({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'confirm_change', arguments: { confirmToken: 'tok1', willDo: ['Move "Dentist": date from today to Friday'] } },
    });
  });
});

describe('readConfirmResponse', () => {
  const rpc = (text: string) => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });

  it('reads the batch from a server-sent event', () => {
    const body = `event: message\ndata: ${rpc('{"task":{},"batchId":"b1"}')}\n\n`;
    expect(readConfirmResponse(body)).toEqual({ ok: true, batchId: 'b1' });
  });

  it('reads plain JSON too, and a write that named no batch', () => {
    expect(readConfirmResponse(rpc('{"task":{}}'))).toEqual({ ok: true, batchId: null });
  });

  it("passes on the server's refusal in its own words", () => {
    expect(readConfirmResponse(rpc('{"error":"That confirmToken was already used."}')))
      .toEqual({ ok: false, reason: 'That confirmToken was already used.' });
    expect(readConfirmResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Tool not found' } })))
      .toEqual({ ok: false, reason: 'Tool not found' });
  });

  it('says so when the answer cannot be read (an HTML error page, say)', () => {
    expect(readConfirmResponse('<html>Bad Request</html>')).toEqual({ ok: false, reason: expect.stringMatching(/could not be read/) });
  });
});

describe('previewNote and doneLine', () => {
  it("tell Claude what happened to its change, with the server's own lines", () => {
    expect(previewNote(preview(), 'confirmed')).toMatch(/tapped Confirm and the change was made: Move "Dentist"/);
    expect(previewNote(preview(), 'cancelled')).toMatch(/nothing changed/);
    expect(previewNote(preview(), 'undone')).toMatch(/undid it/);
    expect(previewNote(preview(), 'failed')).toMatch(/refused/);
  });

  it('count the changes on a confirmed card', () => {
    expect(doneLine(preview())).toBe('Done');
    expect(doneLine(preview({ willDo: ['a', 'b'] }))).toBe('Done, 2 changes');
  });
});

describe('confirmRefusalText', () => {
  it("says the server's refusals in the sheet's terms, not the model's", () => {
    expect(confirmRefusalText('That preview is more than 15 minutes old, so it is no longer valid. Nothing was changed. Call preview_change again.'))
      .toBe('This change is more than 15 minutes old, so it wasn’t made. Ask again for a fresh one.');
    expect(confirmRefusalText('That confirmToken was already used, so the change was already made.')).toBe('This change was already made.');
    expect(confirmRefusalText('No preview has that confirmToken (it may be mistyped, or too old).')).toMatch(/no longer has this change/);
    expect(confirmRefusalText('update_task is no longer available. Preview again.')).toBe('Your server didn’t make the change: update_task is no longer available. Preview again.');
  });
});

describe('askClaudeReady', () => {
  const ready = { enabled: true, hasApiKey: true, syncServerUrl: 'https://todo.fly.dev', hasWriteToken: true, demo: false };

  it('offers the chat only when a message could go out', () => {
    expect(askClaudeReady(ready)).toBe(true);
    expect(askClaudeReady({ ...ready, enabled: false })).toBe(false);
    expect(askClaudeReady({ ...ready, hasApiKey: false })).toBe(false);
    expect(askClaudeReady({ ...ready, hasWriteToken: false })).toBe(false);
    expect(askClaudeReady({ ...ready, syncServerUrl: '' })).toBe(false);
  });

  it('is never offered in demo mode, where it would send the owner\'s key and token', () => {
    expect(askClaudeReady({ ...ready, demo: true })).toBe(false);
  });
});
