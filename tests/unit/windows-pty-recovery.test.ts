import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({exec:vi.fn(),sync:vi.fn()}));
vi.mock('node:os',async importOriginal=>({...await importOriginal<typeof import('node:os')>(),platform:()=> 'win32'}));
vi.mock('node:child_process',async importOriginal=>({...await importOriginal<typeof import('node:child_process')>(),execFile:mocks.exec,execFileSync:mocks.sync}));
import { killPtyProcessTree } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
describe('Windows owned PTY stop',()=>{
  afterEach(()=>vi.clearAllMocks());
  it('never synchronously blocks the Core while taskkill is pending',async()=>{
    mocks.exec.mockReturnValue({});
    const pty={pid:1234,kill:vi.fn()};killPtyProcessTree(pty as never,true);
    expect(mocks.exec).toHaveBeenCalledWith('taskkill.exe',['/PID','1234','/T','/F'],expect.objectContaining({timeout:5000,windowsHide:true}),expect.any(Function));
    expect(mocks.sync).not.toHaveBeenCalled();
    await new Promise(resolve=>setTimeout(resolve,0));expect(pty.kill).not.toHaveBeenCalled();
  });
  it('falls back to the same owned PTY when Windows tree cleanup fails',()=>{
    let callback:((error:Error)=>void)|undefined;
    mocks.exec.mockImplementation((...args:any[])=>{callback=args.at(-1);return {};});
    const pty={pid:1234,kill:vi.fn()};killPtyProcessTree(pty as never,true);
    callback!(new Error('already detached'));expect(pty.kill).toHaveBeenCalledOnce();
  });
});
