import { afterEach, describe, expect, it } from 'vitest';
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProfileSessionContinuityService } from '$lib/modules/agent-room/application/services/ProfileSessionContinuityService.js';
import { AgentSessionTracker } from '$lib/modules/agent-room/infrastructure/pty/AgentSessionTracker.ts';
import { findPromptInTranscript, findReplyToPrompt, latestTurnComplete } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';
import { agentStorageRoots } from '$lib/modules/agent-room/infrastructure/transcript/AgentStorageRoots.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orkestrai-profile-transfer-'))); roots.push(root);
  const sourceRoot = join(root, 'account-a'), targetRoot = join(root, 'account-b'), cwd = join(root, 'workspace');
  const sessionId = randomUUID(), otherId = randomUUID();
  const project = join('projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  await Promise.all([mkdir(join(sourceRoot, project), { recursive: true }), mkdir(targetRoot), mkdir(cwd)]);
  const text = [
    { type: 'user', sessionId, isSidechain: false, timestamp: new Date().toISOString(), message: { content: 'Continue the exact task' } },
    { type: 'assistant', sessionId, isSidechain: false, timestamp: new Date().toISOString(), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Task context retained.' }] } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
  await writeFile(join(sourceRoot, project, `${sessionId}.jsonl`), text);
  await writeFile(join(sourceRoot, project, `${otherId}.jsonl`), text.replaceAll(sessionId, otherId));
  await writeFile(join(sourceRoot, '.credentials.json'), 'source-login-not-for-copy');
  await writeFile(join(targetRoot, '.credentials.json'), 'target-login-stays');
  return { root, sourceRoot, targetRoot, cwd, sessionId, otherId, project, text, transcript: join(project, `${sessionId}.jsonl`) };
}
const service = new ProfileSessionContinuityService();

describe('profile conversation continuity', () => {
  it('moves only the selected context, tool results and rewind files, preserving both accounts and other sessions', async () => {
    const f = await fixture();
    const result = join(f.project, f.sessionId, 'tool-results', 'result.txt');
    const subagent = join(f.project, f.sessionId, 'subagents', 'agent-child.jsonl');
    const rewind = join('file-history', f.sessionId, 'original@v1');
    for (const path of [result, subagent, rewind]) { await mkdir(join(f.sourceRoot, path, '..'), { recursive: true }); await writeFile(join(f.sourceRoot, path), 'Saved result'); }
    const prepared = await service.prepare(f);
    await expect(readFile(join(f.targetRoot, f.transcript))).rejects.toMatchObject({ code: 'ENOENT' });
    await prepared.commit();
    expect(await readFile(join(f.targetRoot, f.transcript), 'utf8')).toBe(f.text);
    expect(await readFile(join(f.sourceRoot, f.transcript), 'utf8')).toBe(f.text);
    for (const path of [result, subagent, rewind]) expect(await readFile(join(f.targetRoot, path), 'utf8')).toBe('Saved result');
    expect(await readFile(join(f.targetRoot, '.credentials.json'), 'utf8')).toBe('target-login-stays');
    expect(await readFile(join(f.sourceRoot, '.credentials.json'), 'utf8')).toBe('source-login-not-for-copy');
    await expect(readFile(join(f.targetRoot, f.project, `${f.otherId}.jsonl`))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(join(f.targetRoot, f.transcript))).mode & 0o777).toBe(0o600);
    expect((await readdir(f.targetRoot)).some(name => name.startsWith('.orkestrai-session-transfer-'))).toBe(false);
  });

  it('supports A → B → A with newer turns and reads acknowledgements from the selected account', async () => {
    const f = await fixture();
    await (await service.prepare(f)).commit();
    const extra = JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: new Date().toISOString() }) + '\n';
    await appendFile(join(f.targetRoot, f.transcript), extra);
    await (await service.prepare({ ...f, sourceRoot: f.targetRoot, targetRoot: f.sourceRoot })).commit();
    expect(await readFile(join(f.sourceRoot, f.transcript), 'utf8')).toBe(f.text + extra);
    const options = { claudeConfigDir: f.targetRoot };
    const tracker = new AgentSessionTracker(f.root, null, options);
    expect(tracker.isAgentSessionResumable('claude-project-jsonl', f.cwd, f.sessionId)).toBe(true);
    expect(await findPromptInTranscript('claude', f.cwd, f.sessionId, 'Continue the exact task', Date.now() - 5000, options)).toEqual({ sessionId: f.sessionId });
    expect(await findReplyToPrompt('claude', f.cwd, f.sessionId, 'Continue the exact task', Date.now() - 5000, options)).toMatchObject({ sessionId: f.sessionId, complete: true, text: 'Task context retained.' });
    expect(await latestTurnComplete('claude', f.cwd, f.sessionId, options)).toBe(true);
    expect(new AgentSessionTracker(f.root).isAgentSessionResumable('claude-project-jsonl', f.cwd, f.sessionId)).toBe(false);
  });

  it('refuses divergent destination history without modifying either conversation', async () => {
    const f = await fixture(); await mkdir(join(f.targetRoot, f.project), { recursive: true });
    await writeFile(join(f.targetRoot, f.transcript), 'A different conversation');
    await expect(service.prepare(f)).rejects.toThrow('PROFILE_SESSION_CONFLICT');
    expect(await readFile(join(f.targetRoot, f.transcript), 'utf8')).toBe('A different conversation');
    expect(await readFile(join(f.sourceRoot, f.transcript), 'utf8')).toBe(f.text);
  });

  it('checks every companion before writing any transcript', async () => {
    const f = await fixture();
    const side = join(f.project, f.sessionId, 'tool-results');
    await mkdir(join(f.sourceRoot, side), { recursive: true }); await writeFile(join(f.sourceRoot, side, 'result.txt'), 'new');
    await mkdir(join(f.targetRoot, side), { recursive: true }); await writeFile(join(f.targetRoot, side, 'result.txt'), 'divergent');
    await expect(service.prepare(f)).rejects.toThrow('PROFILE_SESSION_CONFLICT');
    await expect(readFile(join(f.targetRoot, f.transcript))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('includes final writes that the provider persisted while exiting', async () => {
    const f = await fixture(), prepared = await service.prepare(f);
    await appendFile(join(f.sourceRoot, f.transcript), '{"type":"system","subtype":"turn_duration"}\n');
    await prepared.commit();
    expect(await readFile(join(f.targetRoot, f.transcript), 'utf8')).toBe(await readFile(join(f.sourceRoot, f.transcript), 'utf8'));
  });

  it('rejects symlinked destination parents, preserving an external file', async () => {
    const f = await fixture(), external = join(f.root, 'external'); await mkdir(external);
    await writeFile(join(external, `${f.sessionId}.jsonl`), 'Private external content');
    await mkdir(join(f.targetRoot, 'projects')); await symlink(external, join(f.targetRoot, f.project), 'dir');
    await expect(service.prepare(f)).rejects.toThrow('PROFILE_SESSION_UNSAFE_PATH');
    expect(await readFile(join(external, `${f.sessionId}.jsonl`), 'utf8')).toBe('Private external content');
  });

  it('rejects a newly planted destination link between prepare and commit', async () => {
    const f = await fixture(), prepared = await service.prepare(f), external = join(f.root, 'external'); await mkdir(external);
    await mkdir(join(f.targetRoot, 'projects')); await symlink(external, join(f.targetRoot, f.project), 'dir');
    await expect(prepared.commit()).rejects.toThrow('PROFILE_SESSION_UNSAFE_PATH');
    expect(await readdir(external)).toEqual([]);
  });

  it('rejects a symlinked source companion rather than copying another account’s credential', async () => {
    const f = await fixture(); await mkdir(join(f.sourceRoot, f.project, f.sessionId));
    await symlink(join(f.sourceRoot, '.credentials.json'), join(f.sourceRoot, f.project, f.sessionId, 'result.txt'));
    await expect(service.prepare(f)).rejects.toThrow('PROFILE_SESSION_UNSAFE_PATH');
  });

  it('rejects traversal session ids before accessing provider files', async () => {
    const f = await fixture(); await expect(service.prepare({ ...f, sessionId: '../../.credentials' })).rejects.toThrow('PROFILE_SESSION_INVALID');
  });

  it('uses Linux project identity with host-visible WSL profile directories', async () => {
    const f = await fixture(), cwd = '/home/user/workspace';
    const project = join('projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    await mkdir(join(f.sourceRoot, project), { recursive: true }); await writeFile(join(f.sourceRoot, project, `${f.sessionId}.jsonl`), f.text);
    await (await service.prepare({ ...f, cwd, posixCwd: true })).commit();
    expect(await readFile(join(f.targetRoot, project, `${f.sessionId}.jsonl`), 'utf8')).toBe(f.text);
    expect(agentStorageRoots({ CLAUDE_CONFIG_DIR: '/home/user/work', CODEX_HOME: '/home/user/codex', SECRET_VALUE: 'never-returned' }, cwd, value => `host:${value}`)).toEqual({ claudeConfigDir: 'host:/home/user/work', codexHome: 'host:/home/user/codex' });
  });
});
