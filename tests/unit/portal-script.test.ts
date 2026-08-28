import { describe, expect, it } from 'vitest';
import { portalScriptExpression, unwrapPortalScriptResult } from '../../src/lib/components/agent-room/canvas/portal-script.js';

async function evaluate(source: string): Promise<unknown> {
  return await (0, eval)(portalScriptExpression(source));
}

describe('Portal script envelope', () => {
  it('returns serializable script results', async () => {
    const envelope = await evaluate('Promise.resolve({ ok: true, count: 2 })');
    expect(unwrapPortalScriptResult(envelope)).toEqual({ ok: true, count: 2 });
  });

  it('turns page exceptions into bounded command failures', async () => {
    const envelope = await evaluate('throw new Error("broken page script")');
    expect(() => unwrapPortalScriptResult(envelope)).toThrow('Error: broken page script');
  });

  it('quotes untrusted source without changing the wrapper', async () => {
    const envelope = await evaluate('"</script>\\n${literal}"');
    expect(unwrapPortalScriptResult(envelope)).toContain('</script>');
  });
});
