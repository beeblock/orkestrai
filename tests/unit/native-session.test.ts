import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NativeJsonSession, closeNativeSessions } from '$lib/modules/agent-room/application/adapters/computers/native-session.js';
import { macNativeSessionScript } from '$lib/modules/agent-room/application/adapters/computers/mac-native-session.js';

const sessions: NativeJsonSession[] = [];
function session(script: string, command = process.execPath, args = ['-e', script]) {
  const value = new NativeJsonSession(command, args, { PATH: process.env.PATH });
  sessions.push(value);
  return value;
}
const echo = `const rl=require('node:readline').createInterface({input:process.stdin});
let calls=0;rl.on('line',line=>{const r=JSON.parse(line);process.stdout.write(JSON.stringify({id:r.id,result:{pid:process.pid,call:++calls,value:r.request}})+'\\n');});`;

afterEach(() => { for (const value of sessions.splice(0)) value.close(); closeNativeSessions(); vi.useRealTimers(); });

describe('persistent native transport', () => {
  it('reuses one process and preserves Unicode, newlines and ordered concurrent requests', async () => {
    const value = session(echo);
    const first = JSON.parse(await value.run(JSON.stringify({ text: 'a\n\u00e7\ud83d\ude80' }), 5000));
    const secondPromise = value.run(JSON.stringify({ second: true }), 5000);
    const thirdPromise = value.run(JSON.stringify({ third: true }), 5000);
    const second = JSON.parse(await secondPromise), third = JSON.parse(await thirdPromise);
    expect(first.value).toEqual({ text: 'a\n\u00e7\ud83d\ude80' });
    expect([first.call, second.call, third.call]).toEqual([1, 2, 3]);
    expect(second.pid).toBe(first.pid);
    expect(third.pid).toBe(first.pid);
  });

  it('rejects malformed and oversized input before dispatch', async () => {
    const value = session(echo);
    await expect(value.run('not json', 1000)).rejects.toMatchObject({ inputAttempted: false });
    await expect(value.run(JSON.stringify('x'.repeat(2 * 1024 * 1024)), 1000)).rejects.toMatchObject({ inputAttempted: false });
    expect(JSON.parse(await value.run('{}', 5000)).call).toBe(1);
  });

  it('does not replay a timed out mutation and starts a clean process for the next explicit request', async () => {
    const value = session(`const rl=require('node:readline').createInterface({input:process.stdin});let calls=0;rl.on('line',line=>{const r=JSON.parse(line);calls++;if(r.request.hang)return;process.stdout.write(JSON.stringify({id:r.id,result:{calls}})+'\\n');});`);
    await expect(value.run('{"hang":true}', 150)).rejects.toMatchObject({ inputAttempted: true });
    expect(JSON.parse(await value.run('{}', 5000))).toEqual({ calls: 1 });
  });

  it('keeps queue expiry distinct from an uncertain native operation', async () => {
    const value = session(`require('node:readline').createInterface({input:process.stdin}).on('line',()=>{});`);
    const hanging = expect(value.run('{}', 150)).rejects.toMatchObject({ inputAttempted: true });
    const queued = expect(value.run('{}', 20)).rejects.toMatchObject({ inputAttempted: false });
    await hanging; await queued;
  });

  it('cancels queued input when closed instead of silently starting another process', async () => {
    const value = session(`require('node:readline').createInterface({input:process.stdin}).on('line',()=>{});`);
    const dispatched = expect(value.run('{}', 5000)).rejects.toMatchObject({ inputAttempted: true });
    const queued = expect(value.run('{}', 5000)).rejects.toMatchObject({ inputAttempted: false });
    await new Promise(resolve => setTimeout(resolve, 50));
    value.close();
    await dispatched; await queued;
    await expect(value.run('{}', 5000)).rejects.toMatchObject({ inputAttempted: false });
  });

  it.each([NaN, Infinity, 0, -1])('rejects an invalid deadline before starting the native host: %s', async (deadline) => {
    await expect(session(echo).run('{}', deadline)).rejects.toMatchObject({ inputAttempted: false });
  });

  it('bounds continuous process lifetime and never replays the previous request when recycling', async () => {
    const value = session(echo);
    const first = JSON.parse(await value.run('{"n":0}', 5000));
    for (let n = 1; n < 256; n++) {
      const current = JSON.parse(await value.run(JSON.stringify({ n }), 5000));
      expect(current).toMatchObject({ pid: first.pid, call: n + 1, value: { n } });
    }
    const next = JSON.parse(await value.run('{"n":256}', 5000));
    expect(next.pid).not.toBe(first.pid);
    expect(next).toMatchObject({ call: 1, value: { n: 256 } });
  });

  it('stops an idle helper and lets the next explicit request create a new one', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const value = session(echo);
    const first = JSON.parse(await value.run('{}', 5000));
    vi.advanceTimersByTime(30_000);
    const next = JSON.parse(await value.run('{}', 5000));
    expect(next.pid).not.toBe(first.pid);
    expect(next.call).toBe(1);
  });

  it.skipIf(process.platform !== 'darwin')('terminates the real native loop when its parent exits and closes the private pipe', async () => {
    const script = macNativeSessionScript('handleAccessibility', `ObjC.import('Foundation');function handleAccessibility(){return JSON.stringify({pid:Number($.NSProcessInfo.processInfo.processIdentifier)});}`);
    const parent = `const {spawn}=require('node:child_process');const child=spawn('/usr/bin/osascript',['-l','JavaScript','-e',${JSON.stringify(script)}],{stdio:['pipe','pipe','ignore']});child.on('error',()=>process.exit(1));child.stdout.once('data',data=>{const reply=JSON.parse(data);process.stdout.write(String(reply.result.pid),()=>process.exit(0));});child.stdin.write(JSON.stringify({id:1,request:{}})+'\\n');`;
    const { stdout } = await promisify(execFile)(process.execPath, ['-e', parent], { timeout: 5000, maxBuffer: 1024 });
    const pid = Number(stdout);
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    const alive = () => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };
    try { await expect.poll(alive, { timeout: 3000 }).toBe(false); }
    finally { if (alive()) process.kill(pid, 'SIGKILL'); }
  });

  it.each([
    `process.stdout.write(JSON.stringify({id:999,result:'wrong'})+'\\n')`,
    `process.stdout.write('not JSON\\n')`,
    `process.stdout.write('x'.repeat(3*1024*1024))`,
    `process.exit(2)`,
  ])('rejects unconfirmed output without disclosing stderr or payloads', async (action) => {
    const value = session(`require('node:readline').createInterface({input:process.stdin}).on('line',()=>{process.stderr.write('private-content');${action}});`);
    let failure: unknown;
    try { await value.run('{"private":"do not log"}', 5000); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ inputAttempted: true });
    expect(String(failure)).not.toMatch(/private-content|do not log/);
  });

  it('decodes a multibyte response split across chunks', async () => {
    const value = session(`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line),b=Buffer.from(JSON.stringify({id:r.id,result:'\\u00e7\\ud83d\\ude80'})+'\\n');for(const byte of b)process.stdout.write(Buffer.from([byte]));});`);
    expect(JSON.parse(await value.run('{}', 5000))).toBe('\u00e7\ud83d\ude80');
  });

  it.skipIf(process.platform !== 'darwin')('runs the real macOS framing loop without requesting permissions or posting input', async () => {
    const source = `ObjC.import('Foundation');let count=0;function handleAccessibility(request){return JSON.stringify({value:request,count:++count});}`;
    const script = macNativeSessionScript('handleAccessibility', source);
    const value = session(script, '/usr/bin/osascript', ['-l', 'JavaScript', '-e', script]);
    const request = { value: '\u65e5\u672c\u8a9e\ud83d\ude80\n'.repeat(8000) };
    expect(JSON.parse(await value.run(JSON.stringify(request), 5000))).toEqual({ value: request, count: 1 });
    expect(JSON.parse(await value.run('{}', 5000))).toEqual({ value: {}, count: 2 });
  });
});
