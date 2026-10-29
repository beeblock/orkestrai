import { fork } from 'node:child_process';
import { extname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from '@beeblock/svelar/validation';
import { MCP_TOOLS, executeMcpTool } from '../../../../../../packages/orkestrai-cli/src/mcp.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { GuestWorkspaceFiles } from './GuestWorkspaceFiles.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { buildWslLaunch } from '$lib/modules/agent-room/infrastructure/WslRuntime.js';
import { agentEnv } from '$lib/modules/agent-room/infrastructure/agent-path.js';
import type { WorkspaceExecutionRuntime } from '$lib/modules/agent-room/domain/types.js';
import { imagegenSchema } from '../../contracts/schemas/model-access.schema.js';
import type { InferenceToolResult } from '../../contracts/schemas/model-access.schema.js';

const execSchema = z.object({ command: z.string().min(1).max(100000), timeoutMs: z.number().int().min(100).max(600000).default(30000) }).strict();
const pathSchema = z.object({ path: z.string().min(1).max(4096) }).strict();
const writeSchema = pathSchema.extend({ content: z.string().max(2 * 1024 * 1024) }).strict();
const copySchema = z.object({source:z.string().min(1).max(4096),destination:z.string().min(1).max(4096)}).strict();
export class GuestWorkspaceTools {
  private files?: GuestWorkspaceFiles;
  private images = new Set<string>();
  private storedImages = new Map<string, string>();
  private imageInputs = new Map<string, string>();
  readonly manifest = [
    { name: 'imagegen', description: 'Generate or edit one image using the explicitly lent Codex image capability. Equivalent to image_gen.imagegen. Guest reference paths only. Reuse the SAME idempotencyKey after an uncertain result; never retry an unconfirmed generation with a different key. The result is saved on the GUEST and its path returned.', inputSchema: { type: 'object', additionalProperties: false, properties: { prompt: { type: 'string' }, transparent_background: { type: 'boolean' }, referenced_image_paths: { type: 'array', items: { type: 'string' }, maxItems: 5 }, idempotencyKey: { type: 'string', format: 'uuid' } }, required: ['prompt','idempotencyKey'] } },
    { name: 'imagegen_store', internal: true, description: 'Private image return channel. Store only a prepared generated image on the guest.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, sha256: { type: 'string' }, data: { type: 'string' } }, required: ['id','sha256','data'] } },
    ...MCP_TOOLS,
    { name: 'exec_command', description: 'Run a command on the GUEST computer in this agent’s working directory and effective native/WSL runtime. Use orkestrai heavy for builds and tests. Commands must finish; use Shell nodes for persistent servers. Observe the guest workspace instructions and gates.', inputSchema: { type: 'object', additionalProperties: false, properties: { command: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 100, maximum: 600000 } }, required: ['command'] } },
    { name: 'read_file', description: 'Read a guest workspace file, using approved repository aliases when needed.', inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'write_file', description: 'Write a guest workspace file. Never write provider credentials or bypass workspace restrictions.', inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } },
    { name: 'copy_file', description: 'Copy exact bytes between approved GUEST paths (up to 20 MiB), including image workflow outputAbsolutePaths. Works across native/WSL runtimes and Floors without editing pixels or guessing shell path syntax.', inputSchema: { type:'object',additionalProperties:false,properties:{source:{type:'string'},destination:{type:'string'}},required:['source','destination'] } },
    { name: 'view_image', description: 'View an image on the guest computer from an approved workspace path, including Portal screenshots.', inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] } },
  ];
  constructor(private context: { workspaceId: string; nodeId: string; cwd: string; workspaceRoot: string; runtime: WorkspaceExecutionRuntime; bridge: (method: string, path: string, body?: unknown) => Promise<any>; env: Record<string, string>; imagesAllowed?: boolean; signal: AbortSignal }) { if (!context.imagesAllowed) this.manifest.splice(0,2); }
  async call(name: string, args: Record<string, unknown>): Promise<InferenceToolResult> {
    this.context.signal.throwIfAborted();
    if (!(await autonomyPolicyService.runWindow(this.context.workspaceId, 'model_access_tool')).allowed) throw new Error('INFERENCE_WORKSPACE_PAUSED');
    if (!this.files) { const workspace = await workspaceRepository.getWorkspace(this.context.workspaceId); if (!workspace) throw new Error('INFERENCE_WORKSPACE_NOT_FOUND'); this.files = new GuestWorkspaceFiles(workspace,this.context.cwd,this.context.runtime,this.context.nodeId); }
    const files = this.files;
    let value: unknown;
    if (name === 'imagegen') {
      if (!this.context.imagesAllowed) throw new Error('INFERENCE_IMAGE_DENIED');
      const request = imagegenSchema.parse(args); this.images.add(request.idempotencyKey);
      const references = []; let total = 0;
      for (const path of request.referenced_image_paths) {
        const image = await files.image(path); total += image.data.length;
        if (image.data.length > 6 * 1024 * 1024 || total > 18 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(image.contentType)) throw new Error('INFERENCE_IMAGE_LIMIT');
        references.push({ mime: image.contentType, data: Buffer.from(image.data).toString('base64') });
      }
      const fingerprint = createHash('sha256').update(JSON.stringify({request,references})).digest('hex');
      const previous = this.imageInputs.get(request.idempotencyKey);
      if (previous && previous !== fingerprint) throw new Error('INFERENCE_IMAGE_IDEMPOTENCY_CONFLICT');
      if (!previous) {
        const manifest = { id:request.idempotencyKey,authorization:{workspaceId:this.context.workspaceId,nodeId:this.context.nodeId,capability:'approved-delegated-codex-images'},endpoint:`https://chatgpt.com/backend-api/codex/images/${references.length ? 'edits' : 'generations'}`,prompt:request.prompt,parameters:{model:'gpt-image-2',n:1,quality:'auto',background:request.transparent_background ? 'transparent' : 'opaque'},references:references.map((image,index) => ({path:request.referenced_image_paths[index],role:'edit-reference',sha256:createHash('sha256').update(Buffer.from(image.data,'base64')).digest('hex')})),estimate:{billing:'existing Codex subscription quota; no API-key billing'},reservation:{generations:1},fingerprint };
        await files.write(`.orkestrai/generated-images/manifests/${request.idempotencyKey}-${randomUUID()}.json`,JSON.stringify(manifest,null,2),true);
        this.imageInputs.set(request.idempotencyKey,fingerprint);
      }
      value = { id: request.idempotencyKey, prompt: request.prompt, transparentBackground: request.transparent_background };
      return { callId: randomUUID(), success: true, content: [{ type: 'text', text: JSON.stringify(value) }, ...references.map(image => ({ type: 'image' as const, mime: image.mime as 'image/png', data: image.data }))] };
    } else if (name === 'imagegen_store') {
      const result = z.object({ id: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), data: z.string().max(28 * 1024 * 1024) }).strict().parse(args);
      if (!this.context.imagesAllowed || !this.images.has(result.id)) throw new Error('INFERENCE_IMAGE_DENIED');
      const bytes = Buffer.from(result.data, 'base64');
      if (!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.length > 20 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== result.sha256) throw new Error('INFERENCE_IMAGE_HASH');
      const previous = this.storedImages.get(result.id);
      const path = previous ?? (await files.write(`.orkestrai/generated-images/${result.id}-${randomUUID()}.png`, bytes, true)).path;
      this.storedImages.set(result.id, path); value = { path, sha256: result.sha256 };
    } else if (name === 'exec_command') value = await autonomyPolicyService.execute({workspaceId:this.context.workspaceId,capability:'agent',operation:'model_access.command',actorType:'agent',actorId:this.context.nodeId,mutation:true,input:{},auditOutput:()=>({executed:true})},()=>this.exec(execSchema.parse(args)));
    else if (name === 'read_file') value = await files.read(pathSchema.parse(args).path);
    else if (name === 'write_file') { const input = writeSchema.parse(args); value = await files.write(input.path, input.content); }
    else if (name === 'copy_file') { const input=copySchema.parse(args);value=await files.copy(input.source,input.destination); }
    else if (name === 'view_image') {
      const input = pathSchema.parse(args); const image = await files.image(input.path);
      if (!['image/png','image/jpeg','image/webp'].includes(image.contentType) || image.data.length > 6 * 1024 * 1024) throw new Error('INFERENCE_IMAGE_LIMIT');
      return { callId: randomUUID(), success: true, content: [{ type: 'image', mime: image.contentType as 'image/png', data: Buffer.from(image.data).toString('base64') }] };
    } else {
      if (!MCP_TOOLS.some(tool => tool.name === name)) throw new Error('INFERENCE_TOOL_DENIED');
      value = await executeMcpTool({ bridge: this.context.bridge, selfAgent: this.context.nodeId, findFreePort: async () => {
        const net = await import('node:net'); const server = net.createServer();
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const address = server.address(); await new Promise<void>(resolve => server.close(() => resolve()));
        if (!address || typeof address === 'string') throw new Error('INFERENCE_PORT_FAILED'); return address.port;
      } }, name, args);
    }
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) text = text.slice(0, 1000000) + '\n[Output truncated; request a smaller range.]';
    return { callId: randomUUID(), success: true, content: [{ type: 'text', text }] };
  }
  private async exec(input: z.infer<typeof execSchema>) {
    const { context } = this;
    const shell = context.runtime.kind === 'wsl' ? '/bin/bash' : process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
    const commandArgs = shell === 'powershell.exe' ? ['-NoProfile','-NonInteractive','-Command',input.command] : ['-lc', input.command];
    const launch = context.runtime.kind === 'native' ? { command: shell, args: commandArgs, cwd: context.cwd, env: { ...agentEnv(), ...context.env } } : buildWslLaunch({ runtime: context.runtime, command: shell, args: commandArgs, hostCwd: context.cwd, workspaceRoot: context.workspaceRoot, hostEnv: { ...agentEnv(), ...context.env } });
    return new Promise<{ output: string; exitCode: number | null; timedOut: boolean }>((complete, reject) => {
      const child = fork(resolve(process.cwd(),'packages/orkestrai-cli/src/inference-worker.mjs'),[],{execArgv:[],env:{ELECTRON_RUN_AS_NODE:'1',...(process.env.SystemRoot ? {SystemRoot:process.env.SystemRoot} : {})},stdio:['pipe','pipe','pipe','ipc']});
      child.send({command:launch.command,args:launch.args,cwd:launch.cwd,env:launch.env,cleanupDirectory:false}); child.stdin?.end();
      let output = '', bytes = 0, timedOut = false; const limit = 1024 * 1024;
      const onData = (data: Buffer) => { bytes += data.length; if (bytes <= limit) output += data.toString('utf8'); else if (bytes - data.length <= limit) output += '\n[Output truncated.]'; };
      child.stdout!.on('data', onData); child.stderr!.on('data', onData);
      const abort = () => { child.kill('SIGTERM'); };
      const timer = setTimeout(() => { timedOut = true; abort(); }, input.timeoutMs); timer.unref?.();
      context.signal.addEventListener('abort', abort, { once: true });
      if (context.signal.aborted) abort();
      child.once('error', () => { clearTimeout(timer); context.signal.removeEventListener('abort', abort); reject(new Error('INFERENCE_GUEST_COMMAND_FAILED')); });
      child.once('close', code => { clearTimeout(timer); context.signal.removeEventListener('abort', abort); complete({ output, exitCode: code, timedOut }); });
    });
  }
}
