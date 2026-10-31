import * as m from '$lib/paraglide/messages.js';
import type { LeadershipReview } from '$lib/modules/agent-room/contracts/schemas/leadership.schema.js';
export function leadershipReviewLabel(status: LeadershipReview['status']): string {
  if (status === 'collecting') return m['leadership.collecting']();
  if (status === 'pending') return m['leadership.pending']();
  if (status === 'changes_requested') return m['leadership.changes_requested']();
  if (status === 'approved') return m['leadership.approved']();
  return m['leadership.stale_review']();
}
