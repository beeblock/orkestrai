import { describe, expect, it } from 'vitest';
import { managedPortalCommandSchema, portalProfileSchema } from '../../src/lib/modules/agent-room/contracts/schemas/managed-portal.schema.js';
import { assertAllowedPortalUrl, confinePortalPath, portalProfileFromPayload } from '../../src/lib/modules/agent-room/application/services/ManagedPortalService.js';
import { normalizePortalHosts } from '../../src/lib/modules/agent-room/domain/portal-hosts.js';

describe('managed Portal contracts', () => {
  it('preserves IPv6 hosts when saving the settings form without accepting URL or credential inputs', () => {
    expect(normalizePortalHosts('127.0.0.1\n[::1]\nAPP.EXAMPLE.COM, [0:0:0:0:0:0:0:1]')).toEqual(['127.0.0.1', '[::1]', 'app.example.com']);
    expect(normalizePortalHosts('https://example.com example.com:8443 user:pass@example.com *.example.com ../evil example.com/path')).toEqual([]);
  });
  it('accepts typed semantic actions and rejects arbitrary references', () => {
    expect(managedPortalCommandSchema.parse({ nodeId: 'portal', action: 'click', args: { ref: 'e42' } }).args).toEqual({ ref: 'e42', button: 'left' });
    expect(() => managedPortalCommandSchema.parse({ nodeId: 'portal', action: 'click', args: { ref: '#password' } })).toThrow();
    expect(() => managedPortalCommandSchema.parse({ nodeId: 'portal', action: 'wait', args: {} })).toThrow();
  });

  it('normalizes bounded browser profiles without credentials', () => {
    expect(portalProfileSchema.parse({})).toEqual({
      profileId: 'default', profileScope: 'workspace', allowedHosts: [], downloadDirectory: '.orkestrai/downloads',
      control: 'interact', agentAccess: 'workspace', agentIds: [], paused: false, allowBackground: false,
    });
    expect(portalProfileFromPayload({ portalProfileId: 'team', portalAllowedHosts: ['APP.EXAMPLE.COM'] })).toMatchObject({
      profileId: 'team', allowedHosts: ['app.example.com'],
    });
  });

  it('defaults to team access without discarding explicit legacy restrictions', () => {
    expect(portalProfileFromPayload({})).toMatchObject({ control: 'interact', agentAccess: 'workspace' });
    expect(portalProfileFromPayload({ portalControl: 'disabled', portalAgentIds: [] })).toMatchObject({ control: 'disabled', agentAccess: 'selected' });
    expect(portalProfileFromPayload({ portalAgentAccess: 'workspace', portalAgentIds: [] })).toMatchObject({ agentAccess: 'workspace' });
    const legacy = portalProfileFromPayload({ portalAllowedHosts: ['*.legacy.example'] });
    expect(legacy.allowedHosts).toEqual(['*.legacy.example']);
    expect(() => assertAllowedPortalUrl('https://another.example', legacy.allowedHosts)).toThrow(/not allowed/);
  });

  it('enforces host allowlists and rejects URL credentials', () => {
    expect(assertAllowedPortalUrl('https://app.example.com/tasks', ['app.example.com']).hostname).toBe('app.example.com');
    expect(() => assertAllowedPortalUrl('https://evil.example.net', ['app.example.com'])).toThrow(/not allowed/);
    expect(() => assertAllowedPortalUrl('https://user:secret@app.example.com', ['app.example.com'])).toThrow(/credential-free/);
    expect(assertAllowedPortalUrl('http://[::1]:53455/login', [], 'http://127.0.0.1:63315/app').hostname).toBe('[::1]');
    expect(assertAllowedPortalUrl('https://docs.example.org', [], 'https://app.example.com').hostname).toBe('docs.example.org');
    expect(() => assertAllowedPortalUrl('http://[::1]:53455/login', ['127.0.0.1'], 'http://[::1]:53455')).toThrow(/not allowed/);
    expect(assertAllowedPortalUrl('http://[::1]:53455/login', ['[::1]']).hostname).toBe('[::1]');
  });

  it('confines upload and download paths to the workspace', () => {
    expect(confinePortalPath('/workspace', 'assets/file.png')).toBe('/workspace/assets/file.png');
    expect(() => confinePortalPath('/workspace', '../secret.txt')).toThrow(/inside the workspace/);
    expect(() => confinePortalPath('/workspace', '/tmp/secret.txt')).toThrow(/inside the workspace/);
  });
});
