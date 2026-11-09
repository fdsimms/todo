import { confirmByElicitation } from '../elicitConfirm';
import { createConfirmTokens } from '../confirmWrites';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });

function setup(action: string, caps: unknown = { elicitation: {} }, throws = false) {
  const tokens = createConfirmTokens();
  const willDo = ['Move "Pay rent" to Friday.'];
  const request = { id: 'a' };
  const previewed = text({ preview: true, willDo, confirmToken: tokens.issue('update_task', request, willDo) });
  const low = {
    getClientCapabilities: () => caps,
    elicitInput: jest.fn(async () => { if (throws) throw new Error('no'); return { action, content: { confirm: true } }; }),
  };
  const write = jest.fn(async () => text({ applied: true }));
  return { tokens, request, previewed, low, write };
}
const run = (s: ReturnType<typeof setup>) => confirmByElicitation(s.low as never, s.tokens, s.previewed, s.write);

describe('confirmByElicitation', () => {
  it('writes after the person accepts', async () => {
    const s = setup('accept');
    expect(await run(s)).toEqual(text({ applied: true }));
    expect(s.write).toHaveBeenCalledTimes(1);
  });
  it('does not write after a decline', async () => {
    const s = setup('decline');
    expect(JSON.parse((await run(s)).content[0].text).declined).toBe(true);
    expect(s.write).not.toHaveBeenCalled();
  });
  it('falls back to the token preview without the capability or when asking fails', async () => {
    const a = setup('accept', {});
    expect(await run(a)).toBe(a.previewed);
    const b = setup('accept', { elicitation: {} }, true);
    expect(await run(b)).toBe(b.previewed);
    expect(a.write).not.toHaveBeenCalled();
    expect(b.write).not.toHaveBeenCalled();
  });
});
