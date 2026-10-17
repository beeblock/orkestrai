import { json, type RequestHandler } from '@sveltejs/kit';
import { settingsService } from '$lib/modules/agent-room/application/services/SettingsService.js';

// Phone pairing state is owned by the mobile access endpoints: never echoed to
// the renderer nor overwritten by a stale settings form.
const PRIVATE_PREFIX = 'mobileAccess';

async function visibleSettings(): Promise<Record<string, string>> {
  return Object.fromEntries(Object.entries(await settingsService.all()).filter(([key]) => !key.startsWith(PRIVATE_PREFIX)));
}

export const GET: RequestHandler = async () => {
  return json({ data: await visibleSettings() });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json();
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith(PRIVATE_PREFIX)) continue;
    await settingsService.set(key, String(value));
  }
  return json({ data: await visibleSettings() });
};
