const { spawnSync, execFile } = require('node:child_process');
const path = require('node:path');

function macBundlePath(execPath) {
  const bundlePath = path.resolve(path.dirname(execPath), '..', '..');
  return bundlePath.endsWith('.app') ? bundlePath : null;
}

function canInstallUpdatesAutomatically({
  platform = process.platform,
  execPath = process.execPath,
  assess = spawnSync,
} = {}) {
  if (platform !== 'darwin') return true;

  const bundlePath = macBundlePath(execPath);
  if (!bundlePath) return false;

  try {
    const result = assess('/usr/sbin/spctl', ['--assess', '--type', 'execute', bundlePath], {
      encoding: 'utf8',
      stdio: 'ignore',
    });
    return result?.status === 0;
  } catch {
    return false;
  }
}

function isNewerVersion(candidate, current) {
  const parse = (version) => {
    const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
  };
  const next = parse(candidate);
  const installed = parse(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

async function canInstallUpdatesAutomaticallyAsync({
  platform = process.platform, execPath = process.execPath, assess = execFile,
} = {}) {
  if (platform !== 'darwin') return true;
  const bundlePath = macBundlePath(execPath);
  if (!bundlePath) return false;
  try {
    return await new Promise((resolve) => {
      assess('/usr/sbin/spctl', ['--assess', '--type', 'execute', bundlePath],
        { timeout: 30_000, maxBuffer: 32_768, windowsHide: true }, (error) => resolve(!error));
    });
  } catch { return false; }
}

module.exports = { canInstallUpdatesAutomatically, canInstallUpdatesAutomaticallyAsync, isNewerVersion, macBundlePath };
