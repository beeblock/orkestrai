import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectVoiceRuntime } from './voice-runtime.mjs';

export async function validatePackagedVoice(appRoot, { platform = process.platform, arch = process.arch, structureOnly = false } = {}) {
  const spec = await inspectVoiceRuntime(appRoot, platform, arch);
  if (!structureOnly) {
    assert.equal(process.versions.electron, undefined, 'Voice must run under real Node, not Electron');
    assert.equal(process.platform, platform, 'Voice smoke requires the target operating system');
    assert.equal(process.arch, spec.cpu, 'Voice smoke requires the target CPU');
    const require = createRequire(resolve(appRoot, 'package.json'));
    assert.equal(await realpath(require.resolve('sherpa-onnx-node')), await realpath(resolve(appRoot, 'node_modules/sherpa-onnx-node/sherpa-onnx.js')), 'Voice wrapper must resolve inside the packaged app');
    const sherpa = require('sherpa-onnx-node');
    assert.equal(typeof sherpa.OfflineRecognizer, 'function');
    assert.equal(typeof sherpa.OfflineTts, 'function');
    // Actually enter the native addon and exercise its external audio buffers.
    const wave = Buffer.alloc(52);
    wave.write('RIFF'); wave.writeUInt32LE(44, 4); wave.write('WAVEfmt ', 8);
    wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28);
    wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(8, 40);
    [-16384, 0, 16384, 8192].forEach((sample, index) => wave.writeInt16LE(sample, 44 + index * 2));
    const native = require(resolve(spec.directory, 'sherpa-onnx.node'));
    const decoded = native.readWaveFromBinary(wave);
    assert.equal(decoded.sampleRate, 16000);
    assert.equal(decoded.samples.length, 4);
    assert.ok(Math.abs(decoded.samples[0] + 0.5) < 0.001);
    assert.ok(Math.abs(decoded.samples[2] - 0.5) < 0.001);
  }
  const result = { platform, arch: spec.cpu, version: spec.version, nativeLibraries: spec.binaries.length, nativeExecution: !structureOnly };
  console.log(JSON.stringify({ packagedVoice: 'passed', ...result }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [appRoot, platform = process.platform, arch = process.arch, mode] = process.argv.slice(2);
  if (!appRoot || (mode && mode !== '--structure-only')) throw new Error('Usage: validate-voice-runtime.mjs <app-root> [platform] [arch] [--structure-only]');
  await validatePackagedVoice(appRoot, { platform, arch, structureOnly: mode === '--structure-only' });
}
