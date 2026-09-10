import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { autonomyPolicyService, AutonomyGatePendingError, redactAutonomyValue } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { AgentAutonomyAuditEvent } from '$lib/modules/agent-room/domain/models/AgentAutonomyAuditEvent.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { secretRefService } from '$lib/modules/agent-room/application/services/SecretRefService.js';
import { AgentSecretRef } from '$lib/modules/agent-room/domain/models/AgentSecretRef.js';
import { AutonomyPolicyController } from '$lib/modules/agent-room/interface/http/controllers/AutonomyPolicyController.js';
import { FilesystemController } from '$lib/modules/agent-room/interface/http/controllers/FilesystemController.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

describe('AutonomyPolicyService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('submits complete quick prompts through the delivery queue without changing raw terminal input', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Composer', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', payload: { sessionId: 'test-session' } });
    const raw = vi.spyOn(ptySessionManager, 'writeHumanInput').mockImplementation(() => {});
    const submit = vi.spyOn(ptySessionManager, 'writeWithConfirmedSubmit').mockResolvedValue();
    try {
      const controller = new FilesystemController();
      const event = (body: unknown) => ({ params: { id: workspace.id, nodeId: node.id }, request: new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
      expect((await controller.writeTerminal(event({ data: 'Complete prompt', submit: true }))).status).toBe(200);
      expect(submit).toHaveBeenCalledWith('test-session', 'Complete prompt');
      expect(raw).not.toHaveBeenCalled();
      expect((await controller.writeTerminal(event({ data: '\u001b' }))).status).toBe(200);
      expect(raw).toHaveBeenCalledWith('test-session', '\u001b');
    } finally { raw.mockRestore(); submit.mockRestore(); }
  });

  it('validates policy, gate, and vault HTTP bodies alongside the Svelar route parameters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-autonomy-http-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'HTTP acceptance', workingDir: root });
    const current = await autonomyPolicyService.get(workspace.id);
    const controller = new AutonomyPolicyController();
    const event = (body: unknown, params = { id: workspace.id }) => ({
      params, url: new URL('http://localhost/api'),
      request: new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const response = await controller.update(event({ enabled: true, mode: 'bounded', policy: current.policy }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.enabled).toBe(true);
    const gate = await autonomyPolicyService.decide({ workspaceId: workspace.id, capability: 'browser', operation: 'portal:click', actorType: 'agent', actorId: 'qa', mutation: true, risk: 'purchase' });
    const approved = await controller.resolveGate(event({ decision: 'approved' }, { id: workspace.id, gateId: gate.gate!.id } as { id: string }));
    expect(approved.status).toBe(200);
    const ref = await controller.createSecretRef(event({ name: 'Synthetic credential', bindings: { destinations: ['example.test'] } }));
    expect(ref.status).toBe(201);
    const rejected = await controller.update(event({ enabled: true, mode: 'bounded', policy: { ...current.policy, unexpected: true } }));
    expect(rejected.status).toBe(422);
  });

  it('keeps ordinary development inside a standing grant unattended', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-autonomy-'));
    const file = join(root, 'README.md');
    await writeFile(file, 'ready');
    const workspace = await workspaceRepository.createWorkspace({ name: 'Autonomy', workingDir: root });
    const current = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, {
      enabled: true,
      mode: 'bounded',
      policy: current.policy,
    });

    const value = await autonomyPolicyService.execute({
      workspaceId: workspace.id,
      capability: 'filesystem',
      operation: 'file:write',
      actorType: 'agent',
      actorId: 'designer',
      mutation: true,
      filesystem: { path: file, permission: 'write', size: 5 },
      input: { contentDigest: 'known' },
    }, async () => 'saved');

    expect(value).toBe('saved');
    expect(await autonomyPolicyService.verifyAudit(workspace.id)).toMatchObject({ valid: true });
  });

  it('keeps emergency stop fail-closed even if the policy switch is disabled afterwards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-halted-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Emergency stop', workingDir: root });
    await autonomyPolicyService.emergencyStop(workspace.id);
    const current = await autonomyPolicyService.get(workspace.id);
    expect(current.policy.halted).toBe(true);
    await autonomyPolicyService.update(workspace.id, { enabled: false, mode: 'bounded', policy: current.policy });
    const decision = await autonomyPolicyService.decide({ workspaceId: workspace.id, capability: 'browser', operation: 'snapshot', actorType: 'agent' });
    expect(decision.status).toBe('denied');
    expect((await autonomyPolicyService.runWindow(workspace.id, 'manual')).allowed).toBe(false);
  });

  it('never shares an approval between different actors or run steps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-gate-identity-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Approval identity', workingDir: root });
    const current = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled:true, mode:'bounded', policy:current.policy });
    const request = { workspaceId:workspace.id, capability:'browser' as const, operation:'portal:click', actorType:'agent' as const, actorId:'a', stepId:'step1', risk:'purchase' as const, mutation:true };
    const decision = await autonomyPolicyService.decide(request);
    await autonomyPolicyService.resolveGate(workspace.id, decision.gate!.id, 'approved', 'owner');
    expect((await autonomyPolicyService.decide(request)).status).toBe('allowed');
    expect((await autonomyPolicyService.decide({ ...request, actorId:'b' })).status).toBe('gated');
    expect((await autonomyPolicyService.decide({ ...request, stepId:'step2' })).status).toBe('gated');
  });

  it('gates a boundary crossing once and resumes the matching operation after approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-autonomy-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'orkestrai-autonomy-outside-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Gates', workingDir: root });
    const current = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: current.policy });
    const request = {
      workspaceId: workspace.id,
      capability: 'filesystem' as const,
      operation: 'file:create',
      actorType: 'automation' as const,
      actorId: 'daily-report',
      mutation: true,
      filesystem: { path: join(outside, 'report.pdf'), permission: 'create' as const },
    };

    let gateId = '';
    try {
      await autonomyPolicyService.execute(request, async () => 'should-not-run');
    } catch (error) {
      expect(error).toBeInstanceOf(AutonomyGatePendingError);
      gateId = (error as AutonomyGatePendingError).gate.id;
    }
    expect(gateId).not.toBe('');
    await autonomyPolicyService.resolveGate(workspace.id, gateId, 'approved', 'workspace-owner');
    await expect(autonomyPolicyService.execute(request, async () => 'created')).resolves.toBe('created');
  });

  it('redacts credentials and detects an altered audit chain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-autonomy-audit-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Audit', workingDir: root });
    await autonomyPolicyService.recordObservedEffect({
      workspaceId: workspace.id,
      capability: 'agent',
      operation: 'shell:completed',
      actorType: 'system',
      input: { authorization: 'Bearer raw-token', url: 'https://example.test/?token=raw-token' },
    }, 'completed', { password: 'raw-password' });

    const [event] = await autonomyPolicyService.listAudit(workspace.id);
    expect(event.certainty).toBe('inferred');
    const grant = await autonomyPolicyService.recordSemanticEffect({ workspaceId: workspace.id, capability: 'browser', operation: 'portal:grant_changed', actorType: 'user' });
    expect(grant.certainty).toBe('semantic');
    expect(JSON.stringify(event)).not.toContain('raw-token');
    expect(JSON.stringify(redactAutonomyValue({ password: 'raw-password' }))).not.toContain('raw-password');
    expect(await autonomyPolicyService.verifyAudit(workspace.id)).toMatchObject({ valid: true });
    await AgentAutonomyAuditEvent.query().where('id', event.id).update({ metadata_json: '{\"changed\":true}' });
    expect(await autonomyPolicyService.verifyAudit(workspace.id)).toMatchObject({ valid: false, brokenAt: event.id });
  });

  it('defers background work during quiet hours but never blocks a manual run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-autonomy-quiet-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Quiet hours', workingDir: root });
    const current = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, {
      enabled: true,
      mode: 'bounded',
      policy: { ...current.policy, quietHours: { enabled: true, start: '00:00', end: '00:00' } },
    });

    await expect(autonomyPolicyService.runWindow(workspace.id, 'schedule')).resolves.toMatchObject({
      allowed: false,
      reason: 'quiet_hours',
    });
    await expect(autonomyPolicyService.runWindow(workspace.id, 'manual')).resolves.toMatchObject({
      allowed: true,
      reason: 'manual',
    });
  });

  it('resolves a bound SecretRef only inside the trusted executor and exports redacted audit evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-autonomy-secret-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Vault', workingDir: root });
    const ref = await secretRefService.create(workspace.id, {
      name: 'Slack reports',
      purpose: 'Send a daily report',
      provider: 'host_vault',
      bindings: { integrations: ['slack'], operations: ['message.send'], destinations: ['hooks.slack.com'] },
    });
    const state = globalThis as typeof globalThis & { __orkestraiHostVaultResolve?: (reference: string) => Promise<string | null> };
    state.__orkestraiHostVaultResolve = async (reference) => reference === ref.ref ? 'raw-secret-value' : null;

    await expect(secretRefService.resolve(workspace.id, ref.ref, {
      integration: 'gmail', operation: 'message.send', destination: 'hooks.slack.com',
    })).rejects.toThrow('not bound');
    const secret = await secretRefService.resolve(workspace.id, ref.ref, {
      integration: 'slack', operation: 'message.send', destination: 'hooks.slack.com',
    });
    expect(String(secret)).toBe('[redacted-secret]');
    expect(JSON.stringify(secret)).toBe('"[redacted-secret]"');
    expect(secret.revealInsideTrustedExecutor()).toBe('raw-secret-value');

    const exported = await autonomyPolicyService.exportAudit(workspace.id);
    expect(exported.integrity).toMatchObject({ valid: true });
    expect(JSON.stringify(exported)).not.toContain('raw-secret-value');
    delete state.__orkestraiHostVaultResolve;
  });

  it('fails closed when persisted SecretRef bindings are malformed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-autonomy-invalid-secret-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Invalid vault binding', workingDir: root });
    const ref = await secretRefService.create(workspace.id, {
      name: 'Damaged credential',
      provider: 'host_vault',
      bindings: { integrations: ['slack'], operations: ['slack.send_message'], destinations: ['slack.com'] },
    });
    await AgentSecretRef.query().where('id', ref.id).update({ bindings_json: '{invalid-json' });

    await expect(secretRefService.list(workspace.id)).rejects.toThrow(/bindings are invalid/);
    await expect(secretRefService.resolve(workspace.id, ref.ref, {
      integration: 'slack', operation: 'slack.send_message', destination: 'slack.com',
    })).rejects.toThrow(/bindings are invalid/);
  });
});
