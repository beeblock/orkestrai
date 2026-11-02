import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/** Real packaged Core + native PTY; never authenticates a model or touches an owner home. */
export async function verifyPackagedPtyRecovery({ require, apiUrl, cwd }) {
  const { WebSocket } = require('ws');
  assert.equal(typeof WebSocket, 'function', 'Load the packaged Node WebSocket implementation');
  const base = randomUUID().replaceAll('-', '');
  const windows = process.platform === 'win32';
  const command = windows ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe') : '/bin/sh';
  const args = windows ? ['/d', '/q', '/k', `set ORKESTRAI_PROBE=${base}`]
    : ['-c', `ORKESTRAI_PROBE=${base}; export ORKESTRAI_PROBE; exec /bin/sh`];
  let sessionId;
  let socket;
  try {
    for (let round = 0; round < 8; round++) {
      const current = new WebSocket(apiUrl.replace(/^http/, 'ws') + '/ws/agent-room/pty');
      socket = current;
      let info = null, output = '', failure = null;
      const listeners = new Set();
      const notify = () => { for (const listener of [...listeners]) listener(); };
      current.on('open',notify);
      current.on('error', error => { failure = error; notify(); });
      current.on('message', raw => {
        const frame = JSON.parse(String(raw));
        if (frame.type === 'created' || frame.type === 'attached') info = frame.session;
        if (frame.type === 'output') output = (output + frame.data).slice(-65536);
        if (frame.type === 'error') failure = new Error(`Native PTY smoke failed (${frame.code ?? 'protocol error'})`);
        notify();
      });
      const wait = (predicate, label) => new Promise((resolve,reject) => {
        const timer=setTimeout(()=>finish(new Error(`Native PTY recovery timed out: ${label}`)),15000);
        const inspect=()=> { if(failure)finish(failure); else if(predicate())finish(); };
        const finish=error=> {clearTimeout(timer);listeners.delete(inspect);error?reject(error):resolve();};
        listeners.add(inspect);inspect();
      });
      await wait(()=>current.readyState===WebSocket.OPEN,'socket open');
      if (sessionId) current.send(JSON.stringify({type:'attach',sessionId,stream:true}));
      else current.send(JSON.stringify({type:'create',command,args,cwd,cols:80,rows:24,stream:true}));
      await wait(()=>info!==null,'attach');
      if (sessionId) assert.equal(info.id,sessionId,'A viewer reconnect must reuse the same PTY');
      sessionId=info.id;
      assert.equal(info.exited,false);
      output='';
      const text=windows ? `echo %ORKESTRAI_PROBE%_${round}\r` : `printf '%s_${round}\\n' "$ORKESTRAI_PROBE"\r`;
      current.send(JSON.stringify({type:'input',sessionId,data:text}));
      // The submitted command never contains this expanded value; terminal echo cannot pass this assertion.
      await wait(()=>output.includes(`${base}_${round}`),'executed input');
      if(round===7) current.send(JSON.stringify({type:'kill',sessionId}));
      await new Promise(resolve=> {current.once('close',resolve);current.close();});
    }
    return {nativePtyInput:'passed',viewerReattachments:7,retainedSession:'passed'};
  } finally {
    if(socket && socket.readyState===WebSocket.OPEN) { if(sessionId)socket.send(JSON.stringify({type:'kill',sessionId}));socket.close(); }
  }
}
