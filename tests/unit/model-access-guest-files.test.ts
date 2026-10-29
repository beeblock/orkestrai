import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GuestWorkspaceFiles } from '$lib/modules/model-access/infrastructure/guest/GuestWorkspaceFiles.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
const directories:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
describe('guest working-tree filesystem scope',()=>{
  it('uses Floor cwd for relative edits, accepts approved absolute/main aliases and refuses external symlinks',async()=>{
    const root=await mkdtemp(join(tmpdir(),'orkestrai-guest-files-'));directories.push(root);
    for(const name of ['main','floor','external'])await mkdir(join(root,name));
    await writeFile(join(root,'main','same.txt'),'main');await writeFile(join(root,'floor','same.txt'),'floor');await writeFile(join(root,'external','secret'),'private');
    await symlink(join(root,'external'),join(root,'floor','escape'),'dir');
    vi.spyOn(autonomyPolicyService,'execute').mockImplementation(async(_input,run)=>run());
    const files=new GuestWorkspaceFiles({id:'guest',workingDir:join(root,'main'),repositoryRoots:[]} as any,join(root,'floor'),{kind:'native'},'node');
    expect((await files.read('same.txt')).content).toBe('floor');expect((await files.read('@workspace-main/same.txt')).content).toBe('main');
    await files.write(join(root,'main','new','absolute.txt'),'created');expect(await readFile(join(root,'main','new','absolute.txt'),'utf8')).toBe('created');
    await expect(files.read('escape/secret')).rejects.toThrow();await expect(files.write('escape/new','no')).rejects.toThrow();await expect(files.read(join(root,'external','secret'))).rejects.toThrow();
    await files.copy('same.txt',join(root,'main','copy.txt'));expect(await readFile(join(root,'main','copy.txt'),'utf8')).toBe('floor');
  });
  it('rejects a huge reference before allocating its contents',async()=>{
    const root=await mkdtemp(join(tmpdir(),'orkestrai-guest-image-limit-'));directories.push(root);const handle=await open(join(root,'huge.png'),'w');await handle.truncate(100*1024*1024);await handle.close();
    vi.spyOn(autonomyPolicyService,'execute').mockImplementation(async(_input,run)=>run());
    const files=new GuestWorkspaceFiles({id:'guest',workingDir:root,repositoryRoots:[]} as any,root,{kind:'native'},'node');await expect(files.image('huge.png')).rejects.toThrow('IMAGE_LIMIT');
  });
});
