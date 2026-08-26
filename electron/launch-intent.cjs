const path = require('node:path');

const BACKGROUND_ENTRYPOINTS = new Set([
  'orkestrai.js',
  'orkestrai-server.mjs',
]);

function normalizedBasename(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  return path.win32.basename(value.replaceAll('/', '\\')).toLowerCase();
}

/**
 * Internal Node-mode processes use the packaged Electron executable as their
 * runtime. If Windows starts one without preserving ELECTRON_RUN_AS_NODE, it
 * reaches the single-instance handler and must not steal focus from the user.
 */
function isBackgroundRuntimeInvocation(argv) {
  return (argv ?? []).some((argument) => BACKGROUND_ENTRYPOINTS.has(normalizedBasename(argument)));
}

module.exports = { isBackgroundRuntimeInvocation, normalizedBasename };
