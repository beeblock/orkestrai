import { writeFile } from 'node:fs/promises';

// Public discovery only: no credentials, uploads or paid inference.
const categories = new Set(['text-to-audio', 'text-to-speech', 'text-to-music', 'audio-to-audio', 'video-to-audio', 'audio', 'music', 'sound-effects']);
const models = new Map();
const cursors = new Set();
let cursor = '';
for (let page = 0; page < 100; page++) {
  const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
  let response;
  for (let attempt = 0; attempt < 5; attempt++) {
    response = await fetch(`https://api.fal.ai/v1/models?${query}`, { signal: AbortSignal.timeout(30000) });
    if (response.status !== 429) break;
    await new Promise(resolve => setTimeout(resolve, 15000 * (attempt + 1)));
  }
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.models) || data.models.length > 100) throw new Error('Invalid catalog page');
  for (const model of data.models) {
    const meta = model.metadata;
    if (!categories.has(meta?.category)) continue;
    if (typeof model.endpoint_id !== 'string' || model.endpoint_id.length > 240 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.-]*)*$/.test(model.endpoint_id) || typeof meta.display_name !== 'string' || meta.display_name.length > 200 || !['active', 'deprecated'].includes(meta.status)) throw new Error('Invalid audio metadata');
    models.set(model.endpoint_id, { id: model.endpoint_id, name: meta.display_name, category: meta.category, status: meta.status, documentationUrl: `https://fal.ai/models/${model.endpoint_id}/api` });
  }
  if (!data.has_more) {
    if (!models.size) throw new Error('Empty audio catalog');
    await writeFile(new URL('../src/lib/modules/creative-media/domain/fal-audio-catalog.json', import.meta.url), JSON.stringify({ fetchedAt: new Date().toISOString(), models: [...models.values()] }, null, 2) + '\n');
    console.info(`Bundled ${models.size} audio endpoints.`);
    process.exit(0);
  }
  if (!data.next_cursor || cursors.has(data.next_cursor)) throw new Error('Incomplete catalog');
  cursor = data.next_cursor; cursors.add(cursor);
  await new Promise(resolve => setTimeout(resolve, 2000));
}
throw new Error('Catalog pagination limit');
