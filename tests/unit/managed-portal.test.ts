import { describe, expect, it } from 'vitest';
import { managedPortalCommandSchema, portalProfileSchema } from '../../src/lib/modules/agent-room/contracts/schemas/managed-portal.schema.js';
import { assertAllowedPortalUrl, confinePortalPath, portalProfileFromPayload } from '../../src/lib/modules/agent-room/application/services/ManagedPortalService.js';

describe('managed Portal contracts', () => {
  it('accepts typed semantic actions and rejects arbitrary references', () => {
    expect(managedPortalCommandSchema.parse({ nodeId: 'portal', action: 'click', args: { ref: 'e42' } }).args).toEqual({ ref: 'e42', button: 'left' });
    expect(() => managedPortalCommandSchema.parse({ nodeId: 'portal', action: 'click', args: { ref: '#password' } })).toThrow();
    expect(() => managedPortalCommandSchema.parse({ nodeId: 'portal', action: 'wait', args: {} })).toThrow();
  });

  it('normalizes bounded browser profiles without credentials', () => {
    expect(portalProfileSchema.parse({})).toEqual({
      profileId: 'default', profileScope: 'workspace', allowedHosts: [], downloadDirectory: '.orkestrai/downloads',
      control: 'disabled', agentIds: [], paused: false, allowBackground: false,
    });
    expect(portalProfileFromPayload({ portalProfileId: 'team', portalAllowedHosts: ['APP.EXAMPLE.COM'] })).toMatchObject({
      profileId: 'team', allowedHosts: ['app.example.com'],
    });
  });

  it('enforces host allowlists and rejects URL credentials', () => {
    expect(assertAllowedPortalUrl('https://app.example.com/tasks', ['app.example.com']).hostname).toBe('app.example.com');
    expect(() => assertAllowedPortalUrl('https://evil.example.net', ['app.example.com'])).toThrow(/not allowed/);
    expect(() => assertAllowedPortalUrl('https://user:secret@app.example.com', ['app.example.com'])).toThrow(/credential-free/);
  });

  it('confines upload and download paths to the workspace', () => {
    expect(confinePortalPath('/workspace', 'assets/file.png')).toBe('/workspace/assets/file.png');
    expect(() => confinePortalPath('/workspace', '../secret.txt')).toThrow(/inside the workspace/);
    expect(() => confinePortalPath('/workspace', '/tmp/secret.txt')).toThrow(/inside the workspace/);
  });
});
