import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { preflightWslLaunch } from '$lib/modules/agent-room/infrastructure/WslRuntime.js';

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(process.platform === 'win32')('WSL command preflight with a real isolated shell', () => {
  it('finds the app CLI installed only in the workspace, without a global install', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orkestrai wsl & project ')); dirs.push(root);
    const bin = join(root, '.orkestrai', 'bin'); mkdirSync(bin, {recursive:true});
    const launcher = join(bin, 'orkestrai'); writeFileSync(launcher, '#!/bin/sh\nexit 0\n'); chmodSync(launcher, 0o755);
    const fakeWsl = join(root, 'wsl.exe');
    writeFileSync(fakeWsl, `#!${process.execPath}\n` + `
const {spawnSync}=require('node:child_process');
const {existsSync}=require('node:fs');
const args=process.argv.slice(2), shellAt=args.indexOf('--exec'), script=args[shellAt+3];
if(args[1]==='Missing-distro'){process.stderr.write('WSL_E_DISTRO_NOT_FOUND');process.exit(1);}
if(!existsSync(args[args.indexOf('--cd')+1])){process.stderr.write('WSL_E_PATH_NOT_FOUND');process.exit(1);}
const run=spawnSync('/bin/bash',['--noprofile','--norc','-c',script,...args.slice(shellAt+4)],{env:process.env,encoding:'utf8'});
process.stdout.write(run.stdout||'');process.stderr.write(run.stderr||'');process.exit(run.status??1);
`); chmodSync(fakeWsl, 0o755);
    vi.stubEnv('PATH', [root, '/usr/bin', '/bin'].join(delimiter));
    vi.stubEnv('HOME', root); vi.stubEnv('WSLENV', 'EXISTING'); vi.stubEnv('ORKESTRAI_WORKSPACE_BIN', '');
    const runtime = {kind:'wsl' as const,distribution:'Ubuntu-24.04',linuxWorkingDir:root};
    await expect(preflightWslLaunch({runtime,command:'orkestrai',hostCwd:root})).resolves.toMatchObject({linuxWorkingDir:root});
    await expect(preflightWslLaunch({runtime,command:'orkestrai-missing-unique-test',hostCwd:root})).rejects.toMatchObject({code:'WSL_COMMAND_NOT_FOUND'});
    await expect(preflightWslLaunch({runtime:{...runtime,distribution:'Missing-distro'},command:'orkestrai',hostCwd:root})).rejects.toMatchObject({code:'WSL_DISTRIBUTION_UNAVAILABLE'});
    await expect(preflightWslLaunch({runtime:{...runtime,linuxWorkingDir:root+'/missing'},command:'orkestrai',hostCwd:root+'/missing'})).rejects.toMatchObject({code:'WSL_DIRECTORY_NOT_FOUND'});
  });
});
