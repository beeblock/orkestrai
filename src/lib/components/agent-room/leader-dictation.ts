export const LEADER_DICTATION_COMMAND = 'orkestrai:leader-dictation';
export const LEADER_DICTATION_STATE = 'orkestrai:leader-dictation-state';

export type LeaderDictationStatus = 'idle' | 'starting' | 'recording' | 'transcribing';

export type LeaderDictationCommandDetail = {
  nodeId: string;
};

export type LeaderDictationStateDetail = LeaderDictationCommandDetail & {
  status: LeaderDictationStatus;
};
