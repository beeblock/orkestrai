import { describe, expect, it } from 'vitest';
import { accessModels, accessEfforts } from '$lib/components/agent-room/model-access-options.js';
import { sharedAdapter } from '$lib/modules/agent-room/application/adapters/SharedAdapter.js';
import type { AgentProviderInfo } from '$lib/modules/agent-room/domain/types.js';

const provider = { id: 'codex', efforts: ['low','high','ultra'], models: [
  { value: 'one', label: 'One', efforts: ['low','high'] },
  { value: 'two', label: 'Two', efforts: ['high','ultra','invalid'] },
] } as AgentProviderInfo;

describe('received-access catalog controls', () => {
  it('uses the adapter catalog and preserves a saved model missing from that catalog', () => {
    const models = accessModels(provider, [{value:'saved',label:'Previously allowed',efforts:['high']}]);
    expect(models.map(model => model.value)).toEqual(['one','two','saved']);
    expect(models[1].efforts).toEqual(['high','ultra']);
    expect(accessEfforts(models,['one'])).toEqual(['low','high']);
    expect(accessEfforts(models,null)).toEqual(['low','high','ultra']);
    expect(accessEfforts(models,[])).toEqual([]);
  });
  it('bounds and validates external model metadata before rendering controls', () => {
    const models = accessModels({...provider,models:[...provider.models!,{provider:'codex',value:'bad?value',label:'Invalid'},
      {provider:'codex',value:'one',label:'Duplicate'},{provider:'codex',value:'long',label:'x'.repeat(300),efforts:['surprise','medium']}]});
    expect(models.map(model => model.value)).toEqual(['one','two','long']);
    expect(models[2].label).toHaveLength(100);
    expect(models[2].efforts).toEqual(['medium']);
  });
  it('treats the bundled Orkestrai CLI as installed independently of invitations', async () => {
    expect(sharedAdapter.bundled).toBe(true);
    expect(await sharedAdapter.detect()).toEqual({installed:true});
  });
});
