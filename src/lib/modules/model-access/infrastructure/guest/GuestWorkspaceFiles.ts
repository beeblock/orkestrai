import { open, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { workspacePathService } from '$lib/modules/agent-room/application/services/WorkspacePathService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import type { Workspace, WorkspaceExecutionRuntime } from '$lib/modules/agent-room/domain/types.js';
const exec = promisify(execFile);

/** Paths and bytes belong only to the authenticated guest terminal's working tree/repositories. */
export class GuestWorkspaceFiles {
  private workspace: Workspace;
  readonly mainAlias: string;
  constructor(workspace: Workspace, private cwd: string, private runtime: WorkspaceExecutionRuntime, private nodeId: string) {
    let alias = 'workspace-main'; let index = 0;
    while (workspace.repositoryRoots?.some(root => root.alias === alias)) alias = `workspace-main-${++index}`;
    this.mainAlias = `@${alias}`;
    this.workspace = { ...workspace, workingDir: cwd, repositoryRoots: [...(workspace.repositoryRoots ?? []), { alias, path: workspace.workingDir }] };
  }
  private async reference(input: string, writable = false) {
    let path = input;
    if (this.runtime.kind === 'wsl' && input.startsWith('/')) {
      path = (await exec('wsl.exe', ['--distribution',this.runtime.distribution,'--exec','wslpath','-w',input], { encoding:'utf8',timeout:10000,windowsHide:true })).stdout.trim();
    }
    if (isAbsolute(path) || /^[a-z]:[\\/]/i.test(path)) {
      // Existing absolute references (Portal captures, image outputs) must resolve inside an approved root.
      let reference: string | null;
      try { reference = await workspacePathService.reference(this.workspace, path); }
      catch (error) {
        if (!writable || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const names: string[] = []; let ancestor = path;
        while (true) {
          names.unshift(basename(ancestor)); const parent = dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent;
          try { const root = await workspacePathService.reference(this.workspace, ancestor); reference = root ? `${root}/${names.join('/')}` : null; break; }
          catch (nested) { if ((nested as NodeJS.ErrnoException).code !== 'ENOENT') throw nested; }
        }
      }
      if (!reference) throw new Error('INFERENCE_GUEST_PATH_DENIED'); return reference;
    }
    return path;
  }
  private permitted<T>(path: string, mutation: boolean, operation: () => Promise<T>) {
    return autonomyPolicyService.execute({ workspaceId:this.workspace.id, capability:'filesystem', operation: mutation ? 'filesystem.write' : 'filesystem.read', actorType:'agent', actorId:this.nodeId, mutation, filesystem:{ path, permission:mutation ? 'write' : 'read' }, input:{} }, operation);
  }
  async read(input: string, limit = 512 * 1024) {
    const path = await workspacePathService.resolveExisting(this.workspace, await this.reference(input));
    return this.permitted(path,false,async () => {
      const file = await open(path,'r');
      try {
        const info = await file.stat(); if (!info.isFile()) throw new Error('INFERENCE_GUEST_FILE_REQUIRED');
        const bytes = Buffer.alloc(Math.min(info.size, limit)); const read = await file.read(bytes,0,bytes.length,0);
        return { path: input, content:bytes.toString('utf8',0,read.bytesRead),truncated:info.size > limit };
      } finally { await file.close(); }
    });
  }
  async image(input: string) {
    const path = await workspacePathService.resolveExisting(this.workspace, await this.reference(input));
    return this.permitted(path,false,async () => {
      const file = await open(path,'r');
      try {
        const info = await file.stat(); if (!info.isFile() || info.size > 6 * 1024 * 1024) throw new Error('INFERENCE_IMAGE_LIMIT');
        const bytes = Buffer.alloc(info.size); let offset = 0;
        while (offset < bytes.length) { const read = await file.read(bytes,offset,bytes.length-offset,offset); if (!read.bytesRead) break; offset += read.bytesRead; }
        if (offset !== info.size || (await file.stat()).size !== info.size) throw new Error('INFERENCE_GUEST_FILE_CHANGED');
        const mime = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : null;
        if (!mime) throw new Error('INFERENCE_IMAGE_FORMAT'); return { data:bytes,contentType:mime };
      } finally { await file.close(); }
    });
  }
  async write(input: string, value: string | Buffer, exclusive = false) {
    // Generated outputs use relative, unpredictable names; ordinary edits may target an existing approved absolute path.
    const path = await workspacePathService.resolveWritable(this.workspace, await this.reference(input,true));
    return this.permitted(path,true,async () => {
      await mkdir(dirname(path),{recursive:true});
      await workspacePathService.resolveWritable(this.workspace, await this.reference(input,true));
      await writeFile(path,value,{...(exclusive ? {flag:'wx',mode:0o600} : {})});
      return { path, written:Buffer.byteLength(value) };
    });
  }
  async copy(source: string, destination: string) {
    const path = await workspacePathService.resolveExisting(this.workspace,await this.reference(source));
    const bytes = await this.permitted(path,false,async () => {
      const file=await open(path,'r');
      try {const info=await file.stat();if(!info.isFile() || info.size>20*1024*1024)throw new Error('INFERENCE_GUEST_FILE_LIMIT');
        const buffer=Buffer.alloc(info.size);let offset=0;while(offset<buffer.length){const read=await file.read(buffer,offset,buffer.length-offset,offset);if(!read.bytesRead)break;offset+=read.bytesRead;}
        if(offset!==info.size)throw new Error('INFERENCE_GUEST_FILE_CHANGED');return buffer;
      } finally {await file.close();}
    });
    return this.write(destination,bytes);
  }
}
