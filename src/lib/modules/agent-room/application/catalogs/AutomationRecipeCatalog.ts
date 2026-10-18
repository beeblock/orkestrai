import type { AutomationFormInput } from '../../contracts/schemas/automation.schema.js';

export type AutomationRecipe = {
  id: string;
  category: 'development' | 'design' | 'marketing' | 'research' | 'operations' | 'loops';
  defaults: Partial<AutomationFormInput>;
};

export const automationRecipes: AutomationRecipe[] = [
  // Loops that keep a team moving: each prompts one agent; pick the agent in the editor.
  {
    id: 'loop-progress-check',
    category: 'loops',
    defaults: { triggerType: 'schedule', intervalMinutes: 15, actionType: 'prompt_agent', prompt: 'Progress check: in three short lines, say what you finished, what is next and what is blocking you.' },
  },
  {
    id: 'loop-keep-moving',
    category: 'loops',
    defaults: { triggerType: 'agent_idle', idleMinutes: 5, actionType: 'prompt_agent', prompt: 'You are idle. Pick up the next task assigned to you on the board (orkestrai task list). If there is none, ask the leader for one.' },
  },
  {
    id: 'loop-build-rescue',
    category: 'loops',
    defaults: { triggerType: 'agent_output', outputContains: 'FAILED', actionType: 'prompt_agent', prompt: 'The last command failed. Stop, read the failure, fix it first and tell the leader what broke.' },
  },
  {
    id: 'loop-test-watchdog',
    category: 'loops',
    defaults: { triggerType: 'schedule', intervalMinutes: 30, actionType: 'prompt_agent', prompt: 'Run the test suite. Fix failures right away and report the result in one line.', goalText: 'ALL TESTS PASS' },
  },
  {
    id: 'loop-commit-checkpoint',
    category: 'loops',
    defaults: { triggerType: 'schedule', intervalMinutes: 20, actionType: 'prompt_agent', prompt: 'If you have working changes, commit them with a clear message so progress is never lost.' },
  },
  {
    id: 'loop-review-sweep',
    category: 'loops',
    defaults: { triggerType: 'schedule', intervalMinutes: 30, actionType: 'prompt_agent', prompt: 'Review the latest changes for bugs, dead code and missing tests; fix what you find.' },
  },
  {
    id: 'loop-hourly-standup',
    category: 'loops',
    defaults: { triggerType: 'schedule', intervalMinutes: 60, actionType: 'prompt_agent', prompt: 'Write a short standup in the team channel (orkestrai post): done, doing, blocked.' },
  },
  {
    id: 'development-pr-review',
    category: 'development',
    defaults: {
      triggerType: 'github_pull_request', githubEvent: 'updated', actionType: 'prompt_agent',
      prompt: 'Review the pull request update. Inspect the diff, identify regressions, and record actionable findings.',
    },
  },
  {
    id: 'design-feedback-triage',
    category: 'design',
    defaults: {
      triggerType: 'task', taskEvent: 'created', actionType: 'prompt_agent',
      prompt: 'Triage the new design task. Check the references, accessibility, interaction states, and propose the next concrete action.',
    },
  },
  {
    id: 'marketing-handoff',
    category: 'marketing',
    defaults: {
      triggerType: 'task', taskEvent: 'completed', actionType: 'create_task',
      taskTitle: 'Prepare campaign handoff', taskDescription: 'Review the completed campaign work and prepare the publishing handoff.',
    },
  },
  {
    id: 'research-digest',
    category: 'research',
    defaults: {
      triggerType: 'schedule', intervalMinutes: 1440, actionType: 'prompt_agent',
      prompt: 'Summarize the latest research notes, separate evidence from inference, and highlight unanswered questions.',
    },
  },
  {
    id: 'operations-usage-guard',
    category: 'operations',
    defaults: {
      triggerType: 'usage_threshold', usageProvider: 'claude', usageWindow: 'weekly', usagePercent: 85,
      actionType: 'notify', notificationTitle: 'Provider capacity',
      notificationMessage: 'The configured provider usage threshold was reached. Review routing before assigning more work.',
    },
  },
];
