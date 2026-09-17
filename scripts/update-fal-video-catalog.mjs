import { readFile, writeFile } from 'node:fs/promises';

// Generate the bundled, read-only discovery snapshot from a successful public
// catalog audit. Never package credentials, raw responses or inference outputs.
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/update-fal-video-catalog.mjs <audited-models.json>');
const models = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(models) || models.length < 100 || models.length > 5000) throw new Error('Invalid catalog size');
const safe = models.map(model => {
  if (typeof model.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.-]*)*$/.test(model.id) || model.id.length > 240 || typeof model.name !== 'string' || model.name.length > 200 || typeof model.category !== 'string' || model.category.length > 80 || !['active', 'deprecated'].includes(model.status)) throw new Error('Invalid model metadata');
  return { id: model.id, name: model.name, category: model.category, status: model.status, documentationUrl: `https://fal.ai/models/${model.id}/api` };
});
await writeFile(new URL('../src/lib/modules/creative-media/domain/fal-video-catalog.json', import.meta.url), JSON.stringify({ fetchedAt: new Date().toISOString(), models: safe }, null, 2) + '\n');
console.info(`Bundled ${safe.length} published video endpoints.`);
