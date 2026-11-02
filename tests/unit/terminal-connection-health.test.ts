import { describe, expect, it } from 'vitest';
import { TerminalConnectionHealth } from '$lib/components/agent-room/terminal-connection-health.js';
describe('terminal viewer recovery', () => {
  it('keeps retrying after six failures with bounded delays', () => {
    const health = new TerminalConnectionHealth();
    for (let index = 1; index <= 20; index++) expect(health.disconnected(.5)).toEqual({ attempt: index, delay: Math.min(15000, 1000 * 2 ** Math.min(index - 1, 4)) });
  });
  it('does not hide a flapping connection by resetting on every attach', () => {
    const health = new TerminalConnectionHealth();
    health.opened(0); health.attached(1);
    expect(health.disconnected(.5).attempt).toBe(1);
    health.opened(10); health.attached(11);
    expect(health.disconnected(.5).attempt).toBe(2);
  });
  it('resets failures after sustained healthy traffic', () => {
    const health = new TerminalConnectionHealth(); health.disconnected(); health.disconnected();
    health.opened(0); health.attached(0);
    for (let now=10000;now<=40000;now+=10000) { health.received(now); expect(health.heartbeat(now)).toBe('ping'); }
    expect(health.disconnected(.5).attempt).toBe(1);
  });
  it('gives a suspended renderer time to receive a fresh pong', () => {
    const health=new TerminalConnectionHealth(); health.opened(0);
    expect(health.heartbeat(300000)).toBe('ping');
    expect(health.heartbeat(310000)).toBe('ping');
    expect(health.heartbeat(320000)).toBe('ping');
    expect(health.heartbeat(340001)).toBe('reconnect');
  });
});
