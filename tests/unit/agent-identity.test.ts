import { describe, expect, it } from 'vitest';
import { AGENT_COLORS, agentColor, agentInitials, agentTone, elapsedParts, modelFromArgs } from '../../src/lib/components/agent-room/agent-identity.js';

describe('agent identity', () => {
  it('keeps one color per teammate and spreads ids across the palette', () => {
    expect(agentColor('node-a')).toBe(agentColor('node-a'));
    const used = new Set(Array.from({ length: 64 }, (_, index) => agentColor(`agent-${index}`)));
    expect(used.size).toBeGreaterThanOrEqual(AGENT_COLORS.length - 1);
  });

  it('builds two-letter monograms from titles', () => {
    expect(agentInitials('Codex Lider')).toBe('CL');
    expect(agentInitials('QA Upload')).toBe('QU');
    expect(agentInitials('Claude Mobile UX')).toBe('CU');
    expect(agentInitials('maestro')).toBe('MA');
    expect(agentInitials('Ágata-Revisão')).toBe('ÁR');
    expect(agentInitials('  ')).toBe('?');
  });

  it('maps activity states to the shared tones', () => {
    expect(agentTone('working')).toBe('working');
    expect(agentTone('starting')).toBe('working');
    expect(agentTone('waiting_input')).toBe('attention');
    expect(agentTone('waiting_permission')).toBe('attention');
    expect(agentTone('blocked')).toBe('blocked');
    expect(agentTone('error')).toBe('blocked');
    expect(agentTone('done')).toBe('done');
    expect(agentTone('disconnected')).toBe('offline');
    expect(agentTone('idle')).toBe('idle');
    expect(agentTone(null)).toBe('idle');
  });

  it('reports elapsed time in whole units', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(elapsedParts('2026-10-17T11:59:30Z', now)).toEqual({ unit: 'seconds', count: 30 });
    expect(elapsedParts('2026-10-17T11:11:00Z', now)).toEqual({ unit: 'minutes', count: 49 });
    expect(elapsedParts('2026-10-17T02:00:00Z', now)).toEqual({ unit: 'hours', count: 10 });
    expect(elapsedParts('2026-10-14T12:00:00Z', now)).toEqual({ unit: 'days', count: 3 });
    expect(elapsedParts('not a date', now)).toBeNull();
    expect(elapsedParts(null, now)).toBeNull();
  });

  it('reads the launch model from CLI args', () => {
    expect(modelFromArgs(['--dangerously-bypass-approvals-and-sandbox', '--model', 'gpt-5.6-luna'])).toBe('gpt-5.6-luna');
    expect(modelFromArgs(['--model=opus'])).toBe('opus');
    expect(modelFromArgs(['-m', 'gpt-6.1-sol'])).toBe('gpt-6.1-sol');
    expect(modelFromArgs(['--model', '--resume'])).toBeNull();
    expect(modelFromArgs(['--resume', 'abc'])).toBeNull();
    expect(modelFromArgs(undefined)).toBeNull();
  });
});
