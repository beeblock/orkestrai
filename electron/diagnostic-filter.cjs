function diagnosticText(values) {
  return values.map((value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(' ');
}

/**
 * Portal navigation failures and page-script exceptions are represented by the
 * Portal node state or its structured command result. Electron also emits them
 * through console.error; persisting that duplicate as an app failure floods the
 * diagnostic log without adding actionable information.
 */
function isExpectedPortalDiagnostic(values) {
  const text = diagnosticText(values);
  const expectedNavigationFailure = /ERR_(?:ABORTED|CONNECTION_REFUSED|FAILED|NAME_NOT_RESOLVED)/.test(text);
  if (text.includes("Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL'")) {
    return expectedNavigationFailure || text.includes('Script failed to execute');
  }
  return /electron: Failed to load URL: .* with error: ERR_(?:ABORTED|CONNECTION_REFUSED|FAILED|NAME_NOT_RESOLVED)/.test(text);
}

module.exports = { diagnosticText, isExpectedPortalDiagnostic };
