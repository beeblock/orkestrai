// A route remount must not discard an unsent prompt. Keep only text, scoped to
// its workspace and this tab; attachment ownership remains with the composer.
const PREFIX = 'orkestrai.canvasDraft.v1:';
const MAX_DRAFTS = 20;
const MAX_TEXT_LENGTH = 200_000;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function readCanvasDraft(storage: StorageLike | null, workspaceId: string): string {
  try {
    const raw = storage?.getItem(PREFIX + workspaceId);
    if (!raw || raw.length > MAX_TEXT_LENGTH * 6 + 128) return '';
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string') return '';
    return value.text.length <= MAX_TEXT_LENGTH ? value.text : '';
  } catch {
    return '';
  }
}

export function writeCanvasDraft(storage: StorageLike | null, workspaceId: string, text: string): void {
  if (!storage) return;
  try {
    const key = PREFIX + workspaceId;
    if (!text || text.length > MAX_TEXT_LENGTH) {
      storage.removeItem(key);
      return;
    }
    const others: Array<{ key: string; updatedAt: number }> = [];
    for (let i = 0; i < storage.length; i++) {
      const candidate = storage.key(i);
      if (!candidate?.startsWith(PREFIX) || candidate === key) continue;
      let updatedAt = 0;
      try { updatedAt = Number(JSON.parse(storage.getItem(candidate) ?? '{}').updatedAt) || 0; } catch { /* Invalid drafts expire first. */ }
      others.push({ key: candidate, updatedAt });
    }
    others.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of others.slice(MAX_DRAFTS - 1)) storage.removeItem(old.key);
    storage.setItem(key, JSON.stringify({ text, updatedAt: Date.now() }));
  } catch {
    // Restricted or full browser storage never prevents typing or sending.
  }
}
