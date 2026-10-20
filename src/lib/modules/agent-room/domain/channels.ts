/**
 * Conversation channels: the team channel every agent and the owner share,
 * and one direct channel per agent. Stored messages are the agent-authored
 * posts, the owner's messages and questions with their answers; agent-to-agent
 * asks are read from the message envelopes and merged into the team timeline.
 */
export type ChannelAuthorKind = 'owner' | 'agent' | 'system' | 'external';
export type ChannelMessageKind = 'text' | 'question' | 'answer' | 'event';

export type ChannelMessage = {
  id: string;
  workspaceId: string;
  channel: string;
  authorKind: ChannelAuthorKind;
  authorNodeId: string | null;
  kind: ChannelMessageKind;
  body: string;
  meta: Record<string, unknown>;
  replyToId: string | null;
  answeredAt: string | null;
  createdAt: string;
};

export const TEAM_CHANNEL = 'team';
export const MAX_CHANNEL_BODY = 8_000;
export const MAX_QUESTION_OPTIONS = 6;
export const MAX_OPTION_LENGTH = 80;

export function directChannel(nodeId: string): string {
  return `dm:${nodeId}`;
}

/** Returns the agent node id of a direct channel, or null for any other channel. */
export function directChannelNode(channel: string): string | null {
  const match = /^dm:([0-9a-f-]{36})$/i.exec(channel);
  return match ? match[1] : null;
}

export function isKnownChannel(channel: string): boolean {
  return channel === TEAM_CHANNEL || directChannelNode(channel) !== null;
}

/** Trims, de-duplicates and bounds the answer options an agent offers the owner. */
export function normalizeQuestionOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const option of options) {
    if (typeof option !== 'string') continue;
    const value = option.replace(/\s+/g, ' ').trim().slice(0, MAX_OPTION_LENGTH);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    result.push(value);
    if (result.length >= MAX_QUESTION_OPTIONS) break;
  }
  return result;
}

/** Names mentioned with @Title in a message, matched against the known titles (longest first). */
export function mentionedTitles(body: string, titles: readonly string[]): string[] {
  const found: Array<{ title: string; at: number }> = [];
  const taken: Array<[number, number]> = [];
  const lower = body.toLowerCase();
  for (const title of [...new Set(titles)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const needle = `@${title.toLowerCase()}`;
    for (let index = lower.indexOf(needle); index !== -1; index = lower.indexOf(needle, index + 1)) {
      const end = index + needle.length;
      if (/[\p{L}\p{N}_-]/u.test(lower.charAt(end))) continue;
      if (taken.some(([from, to]) => index < to && end > from)) continue;
      taken.push([index, end]);
      if (!found.some((entry) => entry.title === title)) found.push({ title, at: index });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.title);
}

export const MAX_POSTED_IMAGES = 6;

/**
 * Workspace files a post shows with `![alt](path)`, in order and without
 * repeats. Web addresses, data URIs and app routes are not workspace files.
 */
export function postedImagePaths(body: string): Array<{ alt: string; path: string }> {
  const images: Array<{ alt: string; path: string }> = [];
  for (const match of body.matchAll(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g)) {
    const path = match[2].replace(/^\.\//, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/api\/|#)/i.test(path)) continue;
    if (images.some((image) => image.path === path)) continue;
    images.push({ alt: match[1].trim(), path });
    if (images.length >= MAX_POSTED_IMAGES) break;
  }
  return images;
}

export type ChannelBindingKind = 'telegram' | 'slack';

/** An agent listening to and answering in one external chat. */
export type ChannelBinding = {
  id: string;
  workspaceId: string;
  nodeId: string;
  integrationId: string;
  kind: ChannelBindingKind;
  externalChatId: string;
  allowedSenders: string[];
  enabled: boolean;
  lastError: string | null;
  lastInboundAt: string | null;
  createdAt: string;
};

/**
 * Whether an inbound sender may talk to the agent: an empty list allows the
 * whole chat. Only identities the platform verifies count: the sender id, or
 * a username the platform reserves for that account (Telegram's @handle).
 * Display names are chosen freely by anyone, so they never match.
 */
export function senderAllowed(binding: Pick<ChannelBinding, 'allowedSenders'>, senderId: string, senderHandle: string | null): boolean {
  if (!binding.allowedSenders.length) return true;
  const handle = senderHandle?.trim().replace(/^@/, '').toLowerCase() || null;
  return binding.allowedSenders.some((allowed) => {
    const value = allowed.trim().replace(/^@/, '').toLowerCase();
    return Boolean(value) && (value === senderId.toLowerCase() || value === handle);
  });
}
