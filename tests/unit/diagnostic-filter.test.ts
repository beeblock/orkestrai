import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isExpectedPortalDiagnostic } = require('../../electron/diagnostic-filter.cjs') as {
  isExpectedPortalDiagnostic: (values: unknown[]) => boolean;
};

describe('desktop diagnostic filter', () => {
  it('does not persist duplicate expected Portal failures', () => {
    expect(isExpectedPortalDiagnostic([
      "Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': Error: ERR_CONNECTION_REFUSED",
    ])).toBe(true);
    expect(isExpectedPortalDiagnostic([
      '(node:123) electron: Failed to load URL: http://127.0.0.1:5000 with error: ERR_CONNECTION_REFUSED',
    ])).toBe(true);
    expect(isExpectedPortalDiagnostic([
      "Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': Error: Script failed to execute",
    ])).toBe(true);
  });

  it('keeps unexpected Electron and renderer failures actionable', () => {
    expect(isExpectedPortalDiagnostic(['Renderer process exited unexpectedly'])).toBe(false);
    expect(isExpectedPortalDiagnostic([
      "Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': Error: permission denied",
    ])).toBe(false);
  });
});
