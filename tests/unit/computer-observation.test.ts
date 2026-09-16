import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { computerCommandSchema, computerNodeConfigSchema, computerWatchSchema } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import { observationDifference, sampleObservation } from '$lib/modules/agent-room/application/services/ComputerObservationService.js';

describe('Generic local computer observation', () => {
  it('starts disabled with bounded defaults for old nodes', () => {
    const config = computerNodeConfigSchema.parse({});
    expect(config.watch).toMatchObject({ enabled: false, mode: 'auto', intervalSeconds: 1, cooldownSeconds: 2, region: { x: 0, y: 0, width: 1, height: 1 } });
    expect(computerWatchSchema.parse({ intervalSeconds: 5, cooldownSeconds: 20 })).toMatchObject({ intervalSeconds: 5, cooldownSeconds: 20 });
    expect(config.allowAgentWatch).toBe(false);
    expect(config.evidenceMaxMiB).toBe(256);
  });
  it('validates regions, cadence and full batches before execution', () => {
    expect(computerWatchSchema.safeParse({ region: { x: 0.9, y: 0, width: 0.2, height: 1 } }).success).toBe(false);
    expect(computerWatchSchema.safeParse({ intervalSeconds: 0 }).success).toBe(false);
    expect(computerWatchSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(computerCommandSchema.safeParse({ command: 'batch', steps: new Array(13).fill({ input: { command: 'focus', windowId: '1' } }) }).success).toBe(false);
    expect(computerCommandSchema.safeParse({ command: 'batch', steps: [{ input: { command: 'open_settings', permission: 'accessibility' } }] }).success).toBe(false);
  });
  it('detects content changes, ignores small noise and confines comparison to the selected region', () => {
    const png = new PNG({ width: 128, height: 128 }); png.data.fill(255);
    const region = { x: 0, y: 0, width: 0.5, height: 1 };
    const original = sampleObservation(PNG.sync.write(png), region);
    for (let y = 0; y < 128; y++) for (let x = 64; x < 128; x++) png.data[(y * 128 + x) * 4] = 0;
    expect(observationDifference(original.sample, sampleObservation(PNG.sync.write(png), region).sample)).toBe(0);
    png.data.fill(250);
    expect(observationDifference(original.sample, sampleObservation(PNG.sync.write(png), region).sample)).toBe(0);
    png.data.fill(0);
    expect(observationDifference(original.sample, sampleObservation(PNG.sync.write(png), region).sample)).toBe(100);
    expect(original.sample.length).toBe(64 * 64 * 3);
  });
});
