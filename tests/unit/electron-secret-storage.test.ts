import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import path from 'node:path';
const { waitForInternalServer } = createRequire(import.meta.url)('../../electron/startup-recovery.cjs');
const main = readFileSync('electron/main.cjs', 'utf8');
const code = main.slice(main.indexOf('function secureSecretsPath()'), main.indexOf('const MENU_COPY ='));
function fixture(platform: string, content: string | Error, backend = 'gnome_libsecret') {
  let disk = content, temporary = '';
  const fs = { readFileSync: vi.fn(() => { if (disk instanceof Error) throw disk; return disk; }), mkdirSync: vi.fn(),
    writeFileSync: vi.fn((_path: string, value: string) => { temporary = value; }), renameSync: vi.fn(() => { disk = temporary; }) };
  const safeStorage = { isEncryptionAvailable: vi.fn(() => true), isAsyncEncryptionAvailable: vi.fn(async () => true), getSelectedStorageBackend: () => backend,
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)), decryptString: vi.fn(() => 'secret'),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`encrypted:${value}`)), decryptStringAsync: vi.fn(async () => ({ result: 'secret', shouldReEncrypt: false })) };
  const api = runInNewContext(`${code}; ({ saveAutomationSecret, deleteAutomationSecret, readAutomationSecret })`, { fs, path, Buffer, Symbol, Map, process: { platform, pid: 123 }, app: { getPath: () => '/test' }, safeStorage });
  return { api, fs, safeStorage, stored: () => JSON.parse(String(disk)) };
}
describe('desktop credential vault', () => {
  it('preserves a linked WhatsApp identity when unlocking or decrypting fails', async () => {
    const key = 'automation:whatsapp:workspace:connection';
    const f = fixture('darwin', JSON.stringify({ [key]: 'encrypted-existing-identity' }));
    f.safeStorage.decryptStringAsync.mockRejectedValue(new Error('unlock cancelled'));
    await expect(f.api.readAutomationSecret(key)).rejects.toThrow('WHATSAPP_AUTH_DECRYPT_FAILED');
    expect(f.fs.writeFileSync).not.toHaveBeenCalled();
    await expect(f.api.readAutomationSecret('automation:other')).resolves.toBeNull();
    await expect(fixture('darwin', '{}').api.readAutomationSecret(key)).resolves.toBeNull();
    await expect(fixture('darwin', '{broken').api.readAutomationSecret(key)).rejects.toThrow('not changed');
    await expect(fixture('linux', '{}', 'basic_text').api.readAutomationSecret(key)).rejects.toThrow('WHATSAPP_SECURE_STORAGE_REQUIRED');
  });
  it.each(['basic_text', 'unknown'])('refuses the unprotected Linux backend %s', async backend => {
    const f = fixture('linux', '{}', backend);
    await expect(f.api.saveAutomationSecret('automation:creative-profile:test', 'secret')).rejects.toThrow('unavailable');
    await expect(f.api.readAutomationSecret('automation:creative-profile:test')).resolves.toBeNull();
    expect(f.fs.writeFileSync).not.toHaveBeenCalled();
  });
  it.each(['{broken', '[]', '{"automation:other":123}'])('never overwrites malformed existing credentials: %s', async content => {
    const f = fixture('darwin', content);
    await expect(f.api.saveAutomationSecret('automation:creative-profile:test', 'secret')).rejects.toThrow('not changed');
    expect(() => f.api.deleteAutomationSecret('automation:creative-profile:test')).toThrow('not changed');
    expect(f.fs.writeFileSync).not.toHaveBeenCalled();
  });
  it.each(['darwin', 'win32', 'linux'])('preserves other credentials and saves encrypted values on %s', async platform => {
    const f = fixture(platform, '{"automation:other":"original"}');
    await f.api.saveAutomationSecret('automation:creative-profile:test', 'secret');
    expect(f.stored()).toEqual({ 'automation:other': 'original', 'automation:creative-profile:test': Buffer.from('encrypted:secret').toString('base64') });
    expect(f.fs.renameSync).toHaveBeenCalledOnce();
    if (platform !== 'linux') {
      expect(f.safeStorage.isEncryptionAvailable).not.toHaveBeenCalled(); expect(f.safeStorage.encryptString).not.toHaveBeenCalled();
      expect(f.safeStorage.encryptStringAsync).toHaveBeenCalledOnce();
    }
  });
  it('allows a new store but does not overwrite an unreadable store', async () => {
    const missing = fixture('win32', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await missing.api.saveAutomationSecret('automation:test', 'secret'); expect(missing.fs.writeFileSync).toHaveBeenCalledOnce();
    const denied = fixture('win32', Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(denied.api.saveAutomationSecret('automation:test', 'secret')).rejects.toThrow('not changed');
    expect(denied.fs.writeFileSync).not.toHaveBeenCalled();
  });
  it('keeps startup health responsive while the operating system waits for an unlock', async () => {
    const f = fixture('darwin', '{"automation:test":"cipher"}');
    let unlock!: (available: boolean) => void, settled = false;
    f.safeStorage.isAsyncEncryptionAvailable.mockImplementation(() => new Promise(resolve => { unlock = resolve; }));
    const read = f.api.readAutomationSecret('automation:test').finally(() => { settled = true; });
    await waitForInternalServer('http://localhost/health', { request: async () => ({ ok: true }), timeoutMs: 30 });
    await new Promise(resolve => setTimeout(resolve, 35)); expect(settled).toBe(false);
    unlock(true); await expect(read).resolves.toBe('secret');
    expect(f.safeStorage.decryptString).not.toHaveBeenCalled(); expect(f.safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
  });
  it('preserves simultaneous writes to different accounts after asynchronous encryption', async () => {
    const f = fixture('darwin', '{"automation:other":"original"}'), releases = new Map<string, (value: Buffer) => void>();
    f.safeStorage.encryptStringAsync.mockImplementation(value => new Promise(resolve => releases.set(value, resolve)));
    const a = f.api.saveAutomationSecret('automation:a', 'a'), b = f.api.saveAutomationSecret('automation:b', 'b');
    await vi.waitFor(() => expect(releases.size).toBe(2));
    releases.get('b')!(Buffer.from('cipher-b')); await b;
    releases.get('a')!(Buffer.from('cipher-a')); await a;
    expect(f.stored()).toEqual({ 'automation:other': 'original', 'automation:a': Buffer.from('cipher-a').toString('base64'), 'automation:b': Buffer.from('cipher-b').toString('base64') });
  });
  it('does not resurrect a credential deleted while its encryption awaited the OS', async () => {
    const f = fixture('darwin', '{}'); let release!: (value: Buffer) => void;
    f.safeStorage.encryptStringAsync.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const saving = f.api.saveAutomationSecret('automation:test', 'secret');
    await vi.waitFor(() => expect(f.safeStorage.encryptStringAsync).toHaveBeenCalledOnce());
    f.api.deleteAutomationSecret('automation:test'); release(Buffer.from('encrypted'));
    await expect(saving).rejects.toThrow('changed during unlock'); expect(f.stored()).toEqual({});
  });
  it('does not return a revoked WhatsApp credential after delayed decryption', async () => {
    const key = 'automation:whatsapp:workspace:connection', f = fixture('darwin', JSON.stringify({ [key]: 'cipher' }));
    let release!: (value: {result: string; shouldReEncrypt: boolean}) => void;
    f.safeStorage.decryptStringAsync.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const read = f.api.readAutomationSecret(key);
    await vi.waitFor(() => expect(f.safeStorage.decryptStringAsync).toHaveBeenCalledOnce());
    f.api.deleteAutomationSecret(key); release({result:'secret',shouldReEncrypt:false});
    await expect(read).rejects.toThrow('WHATSAPP_AUTH_DECRYPT_FAILED');
  });
});
