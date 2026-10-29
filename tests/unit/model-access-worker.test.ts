import { describe, expect, it } from 'vitest';
import { fork, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe.skipIf(process.platform === 'win32')('inference worker lifetime', () => {
  it('kills its own descendant tree on Core disconnect, preserves siblings and only deletes owned temporary inputs', async () => {
    const directory=await mkdtemp(join(tmpdir(),'orkestrai-inference-worker-test-'));
    const sibling=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    const worker=fork(resolve('packages/orkestrai-cli/src/inference-worker.mjs'),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
    const childCode=`const{spawn}=require('child_process');const fs=require('fs');const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(join(directory,'pids'))},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000)`;
    let pids:number[]=[];
    try {
      worker.send({command:process.execPath,args:['-e',childCode],cwd:directory,env:{PATH:process.env.PATH},cleanupDirectory:false});
      for(let i=0;i<100;i++){try{pids=JSON.parse(await readFile(join(directory,'pids'),'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
      expect(pids).toHaveLength(2);worker.disconnect();
      await new Promise<void>(resolve=>worker.once('exit',()=>resolve()));
      for(const pid of pids) expect(()=>process.kill(pid,0)).toThrow();
      expect(()=>process.kill(sibling.pid!,0)).not.toThrow(); await expect(access(directory)).resolves.toBeUndefined();
    } finally {sibling.kill('SIGKILL');worker.kill('SIGKILL');for(const pid of pids){try{process.kill(pid,'SIGKILL');}catch{}}await rm(directory,{recursive:true,force:true});}
  });
});
