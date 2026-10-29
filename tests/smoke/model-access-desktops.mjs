/** Explicit live smoke against TWO production Cores; never runs in the regular suite. */
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createRelayServer } from '../../packages/orkestrai-relay/src/server.mjs';

if(process.env.ORKESTRAI_MODEL_ACCESS_DESKTOP_LIVE!=='1')throw new Error('Set ORKESTRAI_MODEL_ACCESS_DESKTOP_LIVE=1 to authorize two real subscription turns.');
const profile=process.env.ORKESTRAI_MODEL_ACCESS_TEST_CODEX_PROFILE;
if(!profile)throw new Error('Select the owner test profile directory explicitly. It is never copied to the guest.');
const root=await mkdtemp(join(tmpdir(),'orkestrai-access-desktops-'));const cores=[];let socket,observedOutput='';
const relay=createRelayServer();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(read,accept,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){try{const value=await read();if(accept(value))return value;}catch{}await delay(100);}throw new Error('Desktop smoke state timeout.');}
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function api(core,path,method='GET',body){
  core.cookies??=new Map();const token=core.cookies.get('XSRF-TOKEN');
  const headers={'content-type':'application/json',cookie:[...core.cookies].map(([name,value])=>name+'='+value).join('; '),...(token?{'X-CSRF-Token':decodeURIComponent(token)}:{})};
  const response=await fetch(core.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');core.cookies.set(pair.slice(0,at),pair.slice(at+1));}
  const result=await response.json();if(!response.ok||result.error)throw new Error(`Desktop HTTP ${response.status}: ${String(result.error).slice(0,100)}`);return result.data;
}
async function startCore(name){
  const directory=join(root,name),home=join(directory,'home');await mkdir(home,{recursive:true});const port=await freePort();
  const core={url:`http://127.0.0.1:${port}`,directory,vault:new Map(),child:null,log:''};
  const env={...process.env,APP_KEY:'isolated-model-access-desktop-smoke',DB_PATH:join(directory,'database.db'),ORKESTRAI_DATA_DIR:directory,ORKESTRAI_SHIM_DIR:join(directory,'bin'),HOME:home,USERPROFILE:home,APPDATA:join(home,'AppData/Roaming'),LOCALAPPDATA:join(home,'AppData/Local'),XDG_CONFIG_HOME:join(home,'.config'),CODEX_HOME:join(home,'.codex'),PORT:String(port),ORIGIN:core.url};
  for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','OPENAI_API_KEY'])delete env[key];
  core.child=fork(resolve('scripts/orkestrai-server.mjs'),[],{env,execArgv:[],silent:true});cores.push(core);
  core.child.stdout.on('data',chunk=>{if(core.log.length<50000)core.log+=chunk;});core.child.stderr.on('data',chunk=>{if(core.log.length<50000)core.log+=chunk;});
  // Exercise the existing Electron secure-store IPC contract using memory-only TEST identities.
  // This is not a production plaintext/fallback secret store and never stores provider credentials.
  core.child.on('message',message=>{if(!/^orkestrai:secret:(get|set|delete)$/.test(message?.type)||!/^automation:/.test(message.key??''))return;
    if(message.type.endsWith(':set'))core.vault.set(message.key,message.value);if(message.type.endsWith(':delete'))core.vault.delete(message.key);
    core.child.send({type:'orkestrai:secret:result',requestId:message.requestId,value:core.vault.get(message.key)??null});});
  await wait(()=>api(core,'/api/agent-room/settings'),Boolean);await api(core,'/api/model-access');return core;
}
try{
  const address=await relay.listen(0,'127.0.0.1');const relayUrl=`ws://127.0.0.1:${address.port}`;
  const owner=await startCore('owner'),guest=await startCore('guest');
  const account=await api(owner,'/api/agent-room/provider-profiles','POST',{providerId:'codex',name:'Isolated live Codex smoke',configDir:profile});
  const grant=await api(owner,'/api/model-access','POST',{name:'Desktop smoke',relayUrl,expiresInMinutes:5,offerings:[{providerId:'codex',profileId:account.id,models:['gpt-6.1-sol'],efforts:['low'],images:true}],concurrency:1,requestsPerMinute:10,maxRequests:4});
  await wait(()=>api(owner,'/api/model-access'),state=>state.grants[0].state==='connected');
  const {invite}=await api(owner,`/api/model-access/${grant.id}`,'POST',{action:'invite'});
  const connection=await api(guest,'/api/model-access/join','POST',{invite,displayName:'Isolated guest device',relayUrl});
  const state=await wait(()=>api(owner,'/api/model-access'),state=>state.grants[0].pending.length===1);
  const peer=state.grants[0].pending[0];await api(owner,`/api/model-access/${grant.id}/approve`,'POST',{revision:grant.revision,guestId:peer.id,fingerprint:peer.fingerprint,approved:true});
  await wait(()=>api(guest,'/api/model-access'),state=>state.connections[0].state==='connected');
  const directory=join(guest.directory,'workspace');await mkdir(directory);
  const workspace=await api(guest,'/api/agent-room/workspaces','POST',{name:'Isolated delegated agent',workingDir:directory});
  const model=`${connection.id}/${grant.policy.offerings[0].id}/gpt-6.1-sol`;
  const args=['model-access-agent','--model',model,'--effort','low'];
  const node=await api(guest,`/api/agent-room/workspaces/${workspace.id}/nodes`,'POST',{type:'terminal',title:'Guest smoke',x:0,y:0,width:500,height:400,payload:{provider:'shared',command:'orkestrai',args,maestro:true}});
  const conversation=randomUUID();let session,output='';
  socket=new WebSocket(guest.url.replace('http:','ws:')+'/ws/agent-room/pty',{origin:guest.url});
  socket.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='created')session=message.session;if(message.type==='output')output+=String(message.data??'');if(message.type==='error')output+='\n'+message.code;observedOutput=output;});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  socket.send(JSON.stringify({type:'create',command:'orkestrai',args,conversationArgs:['--session-id',conversation],agentSessionId:conversation,provider:'shared',cwd:directory,workspaceId:workspace.id,workspaceRoot:directory,nodeId:node.id,env:{ORKESTRAI_NODE_ID:node.id,ORKESTRAI_AGENT_TITLE:node.title,ORKESTRAI_WORKSPACE_CONFIG:join(directory,'.orkestrai/workspace.json'),ORKESTRAI_API_URL:guest.url},stream:true}));
  await wait(()=>Promise.resolve({session,output}),state=>state.session&&state.output.includes('❯'));
  await api(guest,`/api/agent-room/workspaces/${workspace.id}/nodes/${node.id}`,'PATCH',{payload:{...node.payload,sessionId:session.id,agentSessionId:conversation}});
  const nonce=randomUUID(),firstPromptEnd=output.length;
  await api(guest,`/api/agent-room/workspaces/${workspace.id}/channels/${encodeURIComponent('dm:'+node.id)}/messages`,'POST',{body:`Use write_file on the GUEST to create marker.txt containing exactly GUEST_ONLY_${nonce}. Do not use other tools. Then respond DESKTOP_TURN_ONE_DONE.`});
  await wait(()=>readFile(join(directory,'marker.txt'),'utf8'),value=>value.trim()===`GUEST_ONLY_${nonce}`,120000);
  await wait(()=>Promise.resolve(output.slice(firstPromptEnd)),value=>value.includes('❯'),120000);
  const first=output.length;
  await api(guest,`/api/agent-room/workspaces/${workspace.id}/channels/${encodeURIComponent('dm:'+node.id)}/messages`,'POST',{body:'Without reading files or using coding tools, recall the exact GUEST_ONLY_ value from the previous request. Use channel_post (discover its schema if needed) to post that value followed by DESKTOP_TURN_TWO_DONE in this direct Conversation. This communication tool is explicitly allowed.'});
  await wait(()=>api(guest,`/api/agent-room/workspaces/${workspace.id}/channels/${encodeURIComponent('dm:'+node.id)}/messages`),rows=>rows.some(row=>row.authorKind==='agent'&&row.body.includes(nonce)&&row.body.includes('DESKTOP_TURN_TWO_DONE')),120000);
  const transcriptFiles=await import('node:fs/promises');
  const folders=await transcriptFiles.readdir(join(guest.directory,'model-access/transcripts'));assert.equal(folders.length,1);
  const transcript=await readFile(join(guest.directory,'model-access/transcripts',folders[0],conversation+'.jsonl'),'utf8');assert.ok(transcript.includes('DESKTOP_TURN_TWO_DONE'));
  const guestState=await api(guest,'/api/model-access');assert.ok(!JSON.stringify(guestState).includes(profile));assert.ok(!JSON.stringify(guestState).includes(account.id));
  const latest=(await api(owner,'/api/model-access')).grants[0];assert.equal(latest.requestsUsed,2);
  await api(owner,`/api/model-access/${grant.id}`,'POST',{action:'revoke',revision:latest.revision});
  await wait(()=>api(guest,'/api/model-access'),state=>state.connections[0].status==='revoked');
  const evidence={productionCores:2,encryptedRelay:true,liveProvider:'codex',guestFile:true,contextRetained:true,revocation:true,requests:2,providerCredentialsTransferred:false};
  await writeFile(join(root,'result.json'),JSON.stringify(evidence,null,2));console.info(JSON.stringify({...evidence,evidenceDirectory:root}));
}finally{
  await writeFile(join(root,'terminal.txt'),observedOutput,{mode:0o600});
  for(const core of cores){try{const state=await api(core,'/api/model-access');await writeFile(join(core.directory,'status.json'),JSON.stringify({grants:state.grants.map(row=>({status:row.status,state:row.state,requests:row.requestsUsed,running:row.running,queued:row.queued})),connections:state.connections.map(row=>({status:row.status,state:row.state}))}));}catch{}}
  const guestCore=cores[1];if(guestCore){try{const {readdir}=await import('node:fs/promises');const folders=await readdir(join(guestCore.directory,'model-access/transcripts'));for(const folder of folders)for(const file of await readdir(join(guestCore.directory,'model-access/transcripts',folder)))await writeFile(join(root,'transcript-'+file),(await readFile(join(guestCore.directory,'model-access/transcripts',folder,file),'utf8')).slice(-16000),{mode:0o600});}catch{}}
  socket?.close();
  for(const core of cores){core.child?.kill('SIGTERM');await Promise.race([new Promise(resolve=>core.child?.once('exit',resolve)),delay(3000)]);if(core.child?.exitCode===null)core.child.kill('SIGKILL');await writeFile(join(core.directory,'server.log'),core.log);}
  await relay.close();
  // Keep bounded logs/evidence on failure; remove test auth/config/database/workspace data.
  for(const core of cores){for(const name of ['home','database.db','database.db-wal','database.db-shm','workspace','bin','model-access'])await rm(join(core.directory,name),{recursive:true,force:true});}
}
