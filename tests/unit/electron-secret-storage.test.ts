import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import path from 'node:path';

const main = readFileSync('electron/main.cjs', 'utf8');
const code = main.slice(main.indexOf('function secureSecretsPath()'), main.indexOf('const MENU_COPY ='));
function fixture(platform: string, content: string | Error, backend = 'gnome_libsecret') {
  const fs = { readFileSync: vi.fn(() => { if (content instanceof Error) throw content; return content; }), mkdirSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn() };
  const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend, encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)), decryptString: vi.fn(() => 'secret') };
  const api = runInNewContext(`${code}; ({ saveAutomationSecret, deleteAutomationSecret, readAutomationSecret })`, { fs, path, Buffer, process: { platform, pid: 123 }, app: { getPath: () => '/test' }, safeStorage });
  return { api, fs, safeStorage };
}
describe('desktop credential vault', () => {
  it.each(['basic_text', 'unknown'])('refuses the unprotected Linux backend %s', backend => {
    const f = fixture('linux', '{}', backend);
    expect(() => f.api.saveAutomationSecret('automation:creative-profile:test', 'secret')).toThrow('unavailable');
    expect(f.api.readAutomationSecret('automation:creative-profile:test')).toBeNull();
    expect(f.fs.writeFileSync).not.toHaveBeenCalled();
  });
  it.each(['{broken', '[]', '{"automation:other":123}'])('never overwrites malformed existing credentials: %s', content => {
    const f = fixture('darwin', content);
    expect(() => f.api.saveAutomationSecret('automation:creative-profile:test', 'secret')).toThrow('not changed');
    expect(() => f.api.deleteAutomationSecret('automation:creative-profile:test')).toThrow('not changed');
    expect(f.fs.writeFileSync).not.toHaveBeenCalled();
  });
  it.each(['darwin', 'win32', 'linux'])('preserves other credentials and saves encrypted values on %s', platform => {
    const f = fixture(platform, '{"automation:other":"original"}');
    f.api.saveAutomationSecret('automation:creative-profile:test', 'secret');
    const saved = JSON.parse(f.fs.writeFileSync.mock.calls[0][1] as string);
    expect(saved['automation:other']).toBe('original');
    expect(saved['automation:creative-profile:test']).toBe(Buffer.from('encrypted:secret').toString('base64'));
    expect(f.fs.renameSync).toHaveBeenCalledOnce();
  });
  it('allows a new store but does not overwrite an unreadable store', () => {
    const missing = fixture('win32', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    missing.api.saveAutomationSecret('automation:test', 'secret');
    expect(missing.fs.writeFileSync).toHaveBeenCalledOnce();
    const denied = fixture('win32', Object.assign(new Error('denied'), { code: 'EACCES' }));
    expect(() => denied.api.saveAutomationSecret('automation:test', 'secret')).toThrow('not changed');
    expect(denied.fs.writeFileSync).not.toHaveBeenCalled();
  });
});
