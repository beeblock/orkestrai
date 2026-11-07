import { afterEach, expect, it, vi } from 'vitest';
import { AgentLearningService } from '$lib/modules/agent-room/application/services/AgentLearningService.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('shares a stalled lookup and bounds abandoned optional recall across recipients', async () => {
  vi.useFakeTimers();
  const service = new AgentLearningService();
  let release!: (text: string) => void;
  const lookup = vi.spyOn(service, 'context').mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const first = service.contextForDelivery('workspace', 'agent', 'first');
  const duplicate = service.contextForDelivery('workspace', 'agent', 'first');
  await expect(service.contextForDelivery('workspace', 'agent', 'different task')).resolves.toBe('');
  await vi.advanceTimersByTimeAsync(400);
  expect(await first).toBe(''); expect(await duplicate).toBe(''); expect(lookup).toHaveBeenCalledOnce();
  // A timeout must not start another still-running lookup every queue tick.
  const again = service.contextForDelivery('workspace', 'agent', 'first');
  await vi.advanceTimersByTimeAsync(400); expect(await again).toBe(''); expect(lookup).toHaveBeenCalledOnce();
  release('old context'); await vi.advanceTimersByTimeAsync(0);
  lookup.mockResolvedValue('new task context');
  expect(await service.contextForDelivery('workspace', 'agent', 'new')).toBe('new task context');
});

it('limits stalled background reads globally while task delivery proceeds', async () => {
  vi.useFakeTimers();
  const service = new AgentLearningService();
  const lookup = vi.spyOn(service, 'context').mockImplementation(() => new Promise(() => {}));
  const contexts = Array.from({ length: 40 }, (_, i) => service.contextForDelivery(`workspace-${i}`, `agent-${i}`, 'work'));
  await vi.advanceTimersByTimeAsync(400);
  expect(await Promise.all(contexts)).toEqual(Array(40).fill(''));
  expect(lookup).toHaveBeenCalledTimes(4);
});

it('preserves successful recall and isolates workspace/agent scope', async () => {
  const service = new AgentLearningService();
  vi.spyOn(service, 'context').mockImplementation(async (workspace, agent) => `${workspace}/${agent}`);
  expect(await Promise.all([service.contextForDelivery('a','same','query'), service.contextForDelivery('b','same','query')])).toEqual(['a/same','b/same']);
});
