import * as m from '$lib/paraglide/messages.js';
export function knowledgeLabel(value: string): string {
  const labels: Record<string, () => string> = {
    note: m['knowledge.note'], file: m['knowledge.file'], task: m['knowledge.task'], memory: m['memory.title'], image: m['node.image'], design: m['knowledge.design'], codeGraph: m['code_graph.title'],
    ready: m['knowledge.ready'], empty: m['knowledge.empty_text'], unsupported: m['knowledge.unsupported'], error: m['knowledge.parse_error'], missing: m['knowledge.missing'],
    automatic: m['learning.automatic'], review: m['learning.review'], off: m['learning.off'],
    reflection: m['learning.reflection'], pending: m['learning.pending'], active: m['learning.active'], rejected: m['learning.rejected'], archived: m['learning.archived'],
    agent_reported: m['learning.agent_reported'], owner_reviewed: m['learning.owner_reviewed'], observed_event: m['learning.observed_event'],
  };
  return labels[value]?.() ?? value;
}
