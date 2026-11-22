import { describe, expect, it, vi } from 'vitest';
import { ZapoSecureStore } from '$lib/modules/agent-room/infrastructure/integrations/ZapoSecureStore.js';

function fixture() {
  const values = new Map<string, string>();
  const vault = { get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); }) };
  return { values, vault };
}
const keyPair = { pubKey: new Uint8Array(32).fill(1), privKey: new Uint8Array(32).fill(9) };

describe('Zapo keys are durable through the existing desktop encrypted vault', () => {
  it('restores real SQLite provider state with binary keys without creating any plaintext files', async () => {
    const f = fixture();
    const auth = await ZapoSecureStore.open('workspace', 'connection', f.vault);
    const session = auth.store.session('connection');
    await session.preKey.putPreKey({ keyId: 17, keyPair });
    await session.preKey.setServerHasPreKeys(true);
    expect(f.values.size).toBe(1);
    const saved = [...f.values.values()][0];
    expect(saved).not.toContain('noiseKey');
    expect(JSON.parse(saved).version).toBe(1);
    await auth.close();
    const restored = await ZapoSecureStore.open('workspace', 'connection', f.vault);
    expect(await restored.store.session('connection').preKey.getPreKeyById(17)).toMatchObject({ keyId: 17, keyPair });
    expect(await restored.store.session('connection').preKey.getServerHasPreKeys()).toBe(true);
    await restored.forget();
    expect(f.values.size).toBe(0);
  });

  it('does not return from a key write before its encrypted vault write succeeds', async () => {
    const f = fixture(), auth = await ZapoSecureStore.open('workspace', 'connection', f.vault);
    const session = auth.store.session('connection');
    await session.preKey.getPreKeyById(1);
    let release!: () => void;
    f.vault.set.mockImplementationOnce(async (key, value) => { await new Promise<void>(resolve => { release = resolve; }); f.values.set(key, value); });
    let complete = false;
    const write = session.preKey.putPreKey({ keyId: 18, keyPair }).then(() => { complete = true; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(complete).toBe(false);
    release(); await write;
    expect(complete).toBe(true);
    await auth.close();
  });

  it('preserves concurrent writes after reopening and keeps unrelated accounts isolated', async () => {
    const f = fixture(), auth = await ZapoSecureStore.open('workspace', 'connection', f.vault);
    await Promise.all(Array.from({ length: 16 }, (_, keyId) => auth.store.session('connection').preKey.putPreKey({ keyId, keyPair })));
    await auth.close();
    const restored = await ZapoSecureStore.open('workspace', 'connection', f.vault);
    const keys = await restored.store.session('connection').preKey.getPreKeysById(Array.from({ length: 16 }, (_, id) => id));
    expect(keys.every(Boolean)).toBe(true);
    const other = await ZapoSecureStore.open('workspace', 'other', f.vault);
    expect(await other.store.session('other').preKey.getPreKeyById(1)).toBeNull();
    await restored.close(); await other.close();
  });

  it('fails closed without secure storage and preserves a corrupt record instead of resetting it', async () => {
    await expect(ZapoSecureStore.open('workspace', 'missing', { get: async () => null, set: async () => {}, delete: async () => {} })).rejects.toThrow('WHATSAPP_SECURE_STORAGE_REQUIRED');
    const f = fixture(); f.values.set(ZapoSecureStore.key('workspace', 'connection'), 'corrupt record');
    await expect(ZapoSecureStore.open('workspace', 'connection', f.vault)).rejects.toThrow();
    expect(f.values.get(ZapoSecureStore.key('workspace', 'connection'))).toBe('corrupt record');
    expect(f.vault.set).not.toHaveBeenCalled();
  });
  it('rejects key writes when encryption fails and preserves the previous durable snapshot', async () => {
    const f = fixture(), auth = await ZapoSecureStore.open('workspace', 'connection', f.vault);
    const session = auth.store.session('connection');
    await session.preKey.putPreKey({ keyId: 1, keyPair });
    const durable = f.values.get(ZapoSecureStore.key('workspace', 'connection'));
    f.vault.set.mockRejectedValueOnce(new Error('SECURE_STORAGE_UNAVAILABLE'));
    await expect(session.preKey.putPreKey({ keyId: 2, keyPair })).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE');
    expect(auth.failed).toBe(true);
    expect(f.values.get(ZapoSecureStore.key('workspace', 'connection'))).toBe(durable);
    await auth.close().catch(() => undefined);
    const restored = await ZapoSecureStore.open('workspace', 'connection', f.vault);
    expect(await restored.store.session('connection').preKey.getPreKeyById(1)).toBeTruthy();
    expect(await restored.store.session('connection').preKey.getPreKeyById(2)).toBeNull();
    await restored.close();
  });

  it('drains an in-flight encrypted write before close and rejects later writes', async () => {
    const f = fixture(), auth = await ZapoSecureStore.open('workspace', 'connection', f.vault);
    const session = auth.store.session('connection');
    await session.preKey.getPreKeyById(1);
    let release!: () => void;
    f.vault.set.mockImplementationOnce(async (key, value) => { await new Promise<void>(resolve => { release = resolve; }); f.values.set(key, value); });
    const writing = session.preKey.putPreKey({ keyId: 5, keyPair });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const closing = auth.close();
    expect(auth.close()).toBe(closing);
    release(); await writing; await closing;
    await expect(session.preKey.putPreKey({ keyId: 6, keyPair })).rejects.toThrow();
    const restored = await ZapoSecureStore.open('workspace', 'connection', f.vault);
    expect(await restored.store.session('connection').preKey.getPreKeyById(5)).toBeTruthy();
    await restored.close();
  });

});
