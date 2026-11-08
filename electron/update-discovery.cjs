const { isNewerVersion } = require('./update-policy.cjs');

const RELEASE_API = 'https://api.github.com/repos/beeblock/orkestrai/releases/latest';
const MAX_RESPONSE_BYTES = 262144;

async function latestPublicRelease({ currentVersion, platform = process.platform, arch = process.arch, reason = 'network', fetchImpl = fetch } = {}) {
  const response = await fetchImpl(RELEASE_API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Orkestrai updater' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Release discovery returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('Release discovery response is too large.');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_RESPONSE_BYTES) throw new Error('Release discovery response is too large.');
    chunks.push(Buffer.from(chunk));
  }
  let release;
  try { release = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid public release JSON.'); }
  if (!release || typeof release !== 'object') throw new Error('Invalid public release metadata.');
  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  if (!/^v(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/.test(tag)
    || release.draft !== false || release.prerelease !== false
    || release.html_url !== `https://github.com/beeblock/orkestrai/releases/tag/${tag}`) {
    throw new Error('Invalid public release metadata.');
  }
  const version = tag.slice(1);
  if (!isNewerVersion(version, currentVersion)) return { status: 'none' };
  const names = Array.isArray(release.assets) && release.assets.length <= 100
    ? release.assets.map(asset => typeof asset?.name === 'string' && asset.name.length <= 200 ? asset.name : '') : [];
  const expected = platform === 'win32' ? [`Orkestrai-Setup-${version}.exe`]
    : platform === 'darwin' ? [arch === 'arm64' ? `Orkestrai-${version}-arm64.dmg` : `Orkestrai-${version}.dmg`]
    : [`Orkestrai-${version}.AppImage`, `Orkestrai-${version}.x86_64.rpm`];
  if (!expected.some(name => names.includes(name))) throw new Error('The public release has no compatible installer.');
  // This is discovery only. It never bypasses manifests, checksums, signatures
  // or installation policy: the existing UI opens the fixed official page.
  return { status: 'manual', version, reason };
}

async function checkWithFallback(primary, fallback, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let original;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await primary(); }
    catch (error) {
      original = error;
      const transient = /(?:408|429|50[0-9])|timeout|timed out|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(String(error?.code ?? '') + ' ' + String(error?.message ?? ''));
      if (attempt || !transient) break;
      await pause(500);
    }
  }
  try { return await fallback(); }
  catch { throw original; }
}

module.exports = { RELEASE_API, latestPublicRelease, checkWithFallback };
