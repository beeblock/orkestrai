export type AgentLearningMode = 'automatic' | 'review' | 'off';
export type AgentLessonStatus = 'reflection' | 'pending' | 'active' | 'rejected' | 'archived';
export type AgentLesson = {
  id: string; workspaceId: string; nodeId: string; taskId: string; title: string;
  status: AgentLessonStatus; revision: number; fingerprint: string;
  trigger: string; mistake: string; correction: string; evidence: string;
  sourceHash: string; sourceTitle: string; sourceStatus: string;
  evidenceLevel: 'agent_reported' | 'owner_reviewed' | 'observed_event';
  history: Array<{ revision: number; status: AgentLessonStatus; at: string; actor: 'agent' | 'user' | 'system' }>;
  createdAt: string; updatedAt: string;
};
export function agentLearningMode(payload: Record<string, unknown>): AgentLearningMode {
  return payload.learningMode === 'off' || payload.learningMode === 'review' ? payload.learningMode : 'automatic';
}

export function lessonNeedsReview(content: string): boolean {
  // Advisory quarantine, not a promise to recognize every prompt injection.
  return /ignore.{0,40}(instructions|rules)|system\s*prompt|bypass|disable.{0,40}(gate|security|approval)|(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+|-----BEGIN.{0,30}PRIVATE KEY|\b(?:sk-|ghp_)[A-Za-z0-9_-]{16,}|[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/i.test(content);
}
