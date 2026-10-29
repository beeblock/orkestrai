import { createHash } from 'node:crypto';
import { delegatedCodexImage, delegatedImageInput } from './delegated-images.js';
import type { InferenceProviderRun } from '$lib/modules/model-access/infrastructure/providers/InferenceProvider.js';
import type { InferenceToolResult } from '$lib/modules/model-access/contracts/schemas/model-access.schema.js';

/** Same interceptor for native inference and integration tests; credentials never enter tool results. */
export function delegatedImageTools(input: InferenceProviderRun, profile: Record<string,string>, generate = delegatedCodexImage) {
  const generated = new Map<string,{fingerprint:string,result:Promise<InferenceToolResult>}>(); let busy = false;
  return async (name: string, args: Record<string,unknown>): Promise<InferenceToolResult> => {
    if (name !== 'imagegen') return input.callTool(name,args);
    if (input.offering.providerId !== 'codex' || !input.offering.images) throw new Error('INFERENCE_IMAGE_DENIED');
    const id = typeof args.idempotencyKey === 'string' ? args.idempotencyKey : '';
    const fingerprint = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    const previous = generated.get(id);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('INFERENCE_IMAGE_IDEMPOTENCY_CONFLICT'); return previous.result; }
    if (busy || generated.size >= 100) throw new Error('INFERENCE_IMAGE_LIMIT');
    busy = true;
    const result = (async () => {
      const prepared = await input.callTool('imagegen',args);
      if (!prepared.success || prepared.content[0]?.type !== 'text') throw new Error('INFERENCE_IMAGE_INPUT');
      let value: unknown; try { value = JSON.parse(prepared.content[0].text); } catch { throw new Error('INFERENCE_IMAGE_INPUT'); }
      const parsed = delegatedImageInput.safeParse({...value as Record<string,unknown>,references:prepared.content.filter(part => part.type === 'image').map(part => ({mime:part.mime,data:part.data}))});
      if (!parsed.success || parsed.data.id !== id) throw new Error('INFERENCE_IMAGE_INPUT');
      await input.reserveImage(id);
      let status: 'completed' | 'failed' | 'unconfirmed' = 'failed';
      try {
        const bytes = await generate(parsed.data,profile,input.signal);
        const stored = await input.callTool('imagegen_store',{id,data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')});
        if (!stored.success) { status = 'unconfirmed'; throw new Error('INFERENCE_IMAGE_RETURN_UNCONFIRMED'); }
        status = 'completed'; return stored;
      } catch (error) { if (error instanceof Error && /UNCONFIRMED|DISCONNECTED|ABORTED|TIMEOUT/.test(error.message)) status = 'unconfirmed'; throw error; }
      finally { await input.finishImage(id,status); }
    })().finally(() => { busy = false; });
    generated.set(id,{fingerprint,result}); return result;
  };
}
