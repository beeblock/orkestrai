import { it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FalModelCatalogService } from '$lib/modules/creative-media/application/services/FalModelCatalogService.js';

// Explicit read-only integration audit. No credentials or inference requests.
it.runIf(process.env.FAL_CATALOG_AUDIT === '1')('audits the published fal video contracts without generating media', async () => {
  await mkdir('/tmp/orkestrai-fal-public-contracts', { recursive: true });
  const service = new FalModelCatalogService(async (url, init) => {
    const path = `/tmp/orkestrai-fal-public-contracts/${createHash('sha256').update(String(url)).digest('hex')}.json`;
    try { return new Response(await readFile(path), { headers: { 'content-type': 'application/json' } }); } catch {}
    const response = await fetch(url, init);
    if (response.ok) await writeFile(path, await response.clone().text());
    return response;
  });
  const models = await service.list();
  await writeFile('/tmp/orkestrai-fal-video-models.json', JSON.stringify(models, null, 2));
  console.info(`Published video endpoints: ${models.length}`);
  expect(models.some(model => model.id === 'bytedance/seedance-2.5/text-to-video')).toBe(true);
  const results = [];
  for (let offset = 0; offset < models.length; offset += 10) {
    const batch = models.slice(offset, offset + 10);
    try {
      for (const item of await service.contracts(batch.map(model => model.id))) results.push({ id: item.id, status: item.error ?? 'valid', properties: Object.keys(item.contract?.schema.properties ?? {}), output: Object.keys(item.contract?.outputSchema.properties ?? {}) });
    } catch {
      // A batch may exceed the bounded response size; audit those individually.
      for (const model of batch) {
        try { const contract = await service.contract(model.id); results.push({ id: model.id, status: 'valid', properties: Object.keys(contract.schema.properties ?? {}), output: Object.keys(contract.outputSchema.properties ?? {}) }); }
        catch (error) { results.push({ id: model.id, status: (error as Error).message }); }
      }
    }
    await writeFile('/tmp/orkestrai-fal-catalog-audit.json', JSON.stringify(results, null, 2));
    console.info(`Audited ${results.length}/${models.length}`);
  }
  await writeFile('/tmp/orkestrai-fal-catalog-audit.json', JSON.stringify(results, null, 2));
  console.info(JSON.stringify({ models: models.length, validated: results.filter(item => item.status === 'valid').length, failures: results.filter(item => item.status !== 'valid') }));
  expect(results.filter(item => item.status === 'valid').length).toBeGreaterThan(500);
  expect(results.every(item => ['valid', 'creative_model_contract_unavailable', 'creative_model_not_found'].includes(item.status))).toBe(true);
}, 1800000);
