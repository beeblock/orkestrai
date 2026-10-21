import type { AttentionDecisionKind } from './attention-feed.svelte.js';
import * as m from '$lib/paraglide/messages.js';

/** Button labels for the in-place decision of each kind of request. */
export function decisionLabels(kind: AttentionDecisionKind): { approve: string; reject: string } {
  switch (kind) {
    case 'flow': return { approve: m['attention.decide_flow_approve'](), reject: m['attention.decide_flow_reject']() };
    case 'tool': return { approve: m['attention.decide_tool_approve'](), reject: m['attention.decide_tool_reject']() };
    case 'learning': return { approve: m['attention.decide_learning_approve'](), reject: m['attention.decide_learning_reject']() };
    case 'review': return { approve: m['attention.decide_review_approve'](), reject: m['attention.decide_review_reject']() };
    default: return { approve: m['attention.decide_gate_approve'](), reject: m['attention.decide_gate_reject']() };
  }
}
