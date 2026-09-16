import { describe, expect, it } from 'vitest';
import { acquireNativeObservation, nativeObservationKey, nativeReadBusy } from '$lib/modules/agent-room/application/adapters/computers/native-observation-lock.js';

describe('native observation leases', () => {
  it('groups exact macOS window IDs by process and keeps all other formats exclusive', () => {
    expect(nativeObservationKey('123:cg:45')).toBe('mac:123');
    expect(nativeObservationKey('123:cg:46')).toBe('mac:123');
    for (const id of [undefined, '123', 'windows:123', '0:cg:45', '123:cg:0', '123:cg:45\n']) {
      expect(nativeObservationKey(id)).toBe('*');
    }
  });

  it('allows unrelated readers but prevents overlapping reads of the same process', () => {
    const first = acquireNativeObservation('mac:123');
    const other = acquireNativeObservation('mac:456');
    try {
      expect(first).toBeTypeOf('function');
      expect(other).toBeTypeOf('function');
      expect(acquireNativeObservation('mac:123')).toBeNull();
      expect(acquireNativeObservation('*')).toBeNull();
      expect(nativeReadBusy('mac:789')).toBe(false);
      expect(nativeReadBusy('*')).toBe(true);
    } finally { first?.(); other?.(); }
    expect(nativeReadBusy('*')).toBe(false);
  });

  it('keeps global readers exclusive and release idempotent across a subsequent lease', () => {
    const first = acquireNativeObservation('*');
    expect(acquireNativeObservation('mac:123')).toBeNull();
    first?.();
    const next = acquireNativeObservation('*');
    try {
      first?.();
      expect(nativeReadBusy('*')).toBe(true);
    } finally { next?.(); }
    expect(nativeReadBusy('*')).toBe(false);
  });
});
