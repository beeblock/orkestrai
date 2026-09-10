import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PORTAL_PARTITION,
  isAllowedPortalUrl,
  portalWindowOpenResponse,
  shouldOpenPortalInCanvas,
  managedPortalPartition,
  publicPortalUrl,
} = require('../../electron/portal-policy.cjs') as {
  PORTAL_PARTITION: string;
  publicPortalUrl: (url: string) => string;
  isAllowedPortalUrl: (url: string) => boolean;
  portalWindowOpenResponse: (url: string, createWindow?: (options: unknown) => unknown) => Record<string, unknown>;
  shouldOpenPortalInCanvas: (url: string, disposition: string) => boolean;
  managedPortalPartition: (workspaceId: string, nodeId: string, profileId?: string, scope?: string) => string;
};

describe('Electron Portal popup policy', () => {
  it('does not persist authentication parameters in public Portal state', () => {
    expect(publicPortalUrl('https://example.com/callback?code=private&state=opaque&next=inbox#access_token=secret')).toBe('https://example.com/callback?next=inbox');
    expect(publicPortalUrl('https://example.com/?q=report#/inbox')).toBe('https://example.com/?q=report#/inbox');
    expect(publicPortalUrl('https://user:password@example.com/')).toBe('https://example.com/');
    expect(publicPortalUrl('javascript:alert(1)')).toBe('about:blank');
  });
  it('allows web popups and blocks privileged protocols', () => {
    expect(isAllowedPortalUrl('https://example.com/login')).toBe(true);
    expect(isAllowedPortalUrl('http://localhost:5173')).toBe(true);
    expect(isAllowedPortalUrl('about:blank')).toBe(true);
    expect(isAllowedPortalUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedPortalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedPortalUrl('data:text/html,hello')).toBe(false);
    expect(isAllowedPortalUrl('https://user:secret@example.com')).toBe(false);
  });

  it('requires an embedded host and keeps popup contents sandboxed', () => {
    const createWindow = (options: unknown) => options;
    const response = portalWindowOpenResponse('https://example.com/auth', createWindow) as {
      action: string;
      createWindow: typeof createWindow;
      overrideBrowserWindowOptions: { webPreferences: Record<string, unknown> };
    };
    expect(response.action).toBe('allow');
    expect(response.createWindow).toBe(createWindow);
    expect(response.overrideBrowserWindowOptions.webPreferences).toMatchObject({
      partition: PORTAL_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
  });

  it('distinguishes new Canvas portals from embedded popup tabs', () => {
    expect(shouldOpenPortalInCanvas('https://example.com/docs', 'foreground-tab')).toBe(true);
    expect(shouldOpenPortalInCanvas('http://localhost:5173/result', 'background-tab')).toBe(true);
    expect(shouldOpenPortalInCanvas('https://example.com/oauth', 'new-window')).toBe(false);
    expect(shouldOpenPortalInCanvas('javascript:alert(1)', 'foreground-tab')).toBe(false);
    expect(shouldOpenPortalInCanvas('about:blank', 'foreground-tab')).toBe(false);
  });

  it('denies invalid popup destinations without creating a window', () => {
    expect(portalWindowOpenResponse('https://example.com/auth')).toEqual({ action: 'deny' });
    expect(portalWindowOpenResponse('about:blank')).toEqual({ action: 'deny' });
    expect(portalWindowOpenResponse('orkestrai://join/secret')).toEqual({ action: 'deny' });
    expect(isAllowedPortalUrl(`https://example.com/${'a'.repeat(4096)}`)).toBe(false);
  });

  it('isolates managed profiles by workspace or Portal', () => {
    expect(managedPortalPartition('workspace-a', 'portal-a', 'signed-in', 'workspace')).toBe('persist:orkestrai-portal-workspace-a-signed-in');
    expect(managedPortalPartition('workspace-a', 'portal-a', 'signed-in', 'private')).toBe('persist:orkestrai-portal-portal-a-signed-in');
    expect(managedPortalPartition('../../bad', 'portal:a', 'x y', 'private')).toBe('persist:orkestrai-portal-portala-xy');
  });
});
