import { parse } from 'parse5';
import { writeFile } from 'node:fs/promises';

// Maintenance-only import of public JSON schemas. Never evaluate website scripts.
// Runtime uses the reviewed snapshot, not the provider's changing HTML frontend.
const pending = new Set([
  'minimax/h3/image-to-video', 'bytedance/seedance-2.5/image-to-video',
  'bytedance/seedance-2.0/image-to-video', 'kling-video/v3.0/pro/image-to-video',
  'alibaba/wan-3.0/image-to-video',
]);
const models = new Map();
const seen = new Set();
for (const id of pending) {
  if (seen.size > 150 || !/^[a-zA-Z0-9_./-]{1,240}$/.test(id) || id.includes('..')) throw new Error('Invalid catalog');
  if (seen.has(id)) continue;
  seen.add(id);
  const documentationUrl = `https://open.higgsfield.ai/models/${id}/api-reference`;
  const response = await fetch(documentationUrl, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error(`Documentation unavailable: ${id}`);
  const html = await response.text();
  if (html.length > 4000000) throw new Error('Document too large');
  let found;
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    if (value.input_schema && value.slug === id && value.output_type === 'video') found = value;
    for (const child of Object.values(value)) inspect(child);
  };
  const visit = node => {
    if (node.tagName === 'script') {
      const content = (node.childNodes ?? []).map(child => child.value ?? '').join('');
      const match = /^self\.__next_f\.push\((\[.*\])\)$/.exec(content);
      if (match) {
        const chunk = JSON.parse(match[1])[1];
        if (typeof chunk === 'string') for (const line of chunk.split('\n')) {
          const json = line.slice(line.indexOf(':') + 1);
          if (json.startsWith('[')) { try { inspect(JSON.parse(json)); } catch {} }
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(html));
  if (!found || found.input_schema.type !== 'object') throw new Error(`No documented schema: ${id}`);
  const price = found.overview?.price;
  const publicPrice = price?.currency === 'USD' && /^\d+(?:\.\d+)?$/.test(String(price.amount)) && Number(price.amount) <= 1000
    && typeof price.unit === 'string' && price.unit.length <= 80
    ? { unitPrice: Number(price.amount), unit: price.unit, currency: 'USD' } : null;
  models.set(id, { id, name: `${found.title} ${found.variant_title ?? ''}`.trim(), category: found.operation_type,
    status: 'active', documentationUrl, publicPrice, schema: found.input_schema });
  for (const member of found.family ?? []) if (member.slug) pending.add(member.slug);
  console.log(`Verified ${id}`);
}
await writeFile(new URL('../src/lib/modules/creative-media/domain/higgsfield-video-contracts.json', import.meta.url), JSON.stringify({
  fetchedAt: new Date().toISOString(), models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)),
}, null, 2) + '\n');
