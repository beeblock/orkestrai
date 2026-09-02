import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PORTAL_PARTITION,
  isAllowedPortalUrl,
  portalWindowOpenResponse,
  shouldOpenPortalInCanvas,
} = require('../../electron/portal-policy.cjs') as {
  PORTAL_PARTITION: string;
  isAllowedPortalUrl: (url: string) => boolean;
  portalWindowOpenResponse: (url: string, title?: string) => Record<string, unknown>;
  shouldOpenPortalInCanvas: (url: string, disposition: string) => boolean;
};

describe('Electron Portal popup policy', () => {
  it('allows web popups and blocks privileged protocols', () => {
    expect(isAllowedPortalUrl('https://example.com/login')).toBe(true);
    expect(isAllowedPortalUrl('http://localhost:5173')).toBe(true);
    expect(isAllowedPortalUrl('about:blank')).toBe(true);
    expect(isAllowedPortalUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedPortalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedPortalUrl('data:text/html,hello')).toBe(false);
  });

  it('keeps popup windows in the persistent sandboxed Portal session', () => {
    const response = portalWindowOpenResponse('https://example.com/auth', 'Portal') as {
      action: string;
      overrideBrowserWindowOptions: { title: string; webPreferences: Record<string, unknown> };
    };
    expect(response.action).toBe('allow');
    expect(response.overrideBrowserWindowOptions.title).toBe('Portal');
    expect(response.overrideBrowserWindowOptions.webPreferences).toMatchObject({
      partition: PORTAL_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
  });

  it('routes browser-style tabs into the canvas while preserving real popup windows', () => {
    expect(shouldOpenPortalInCanvas('https://example.com/docs', 'foreground-tab')).toBe(true);
    expect(shouldOpenPortalInCanvas('http://localhost:5173/result', 'background-tab')).toBe(true);
    expect(shouldOpenPortalInCanvas('https://example.com/oauth', 'new-window')).toBe(false);
    expect(shouldOpenPortalInCanvas('javascript:alert(1)', 'foreground-tab')).toBe(false);
    expect(shouldOpenPortalInCanvas('about:blank', 'foreground-tab')).toBe(false);
  });

  it('denies invalid popup destinations without creating a window', () => {
    expect(portalWindowOpenResponse('orkestrai://join/secret')).toEqual({ action: 'deny' });
    expect(isAllowedPortalUrl(`https://example.com/${'a'.repeat(4096)}`)).toBe(false);
  });
});
