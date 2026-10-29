/** Private worker MCP: it can only forward the guest's declared tools. No workspace discovery. */
import readline from 'node:readline';
import { readFile } from 'node:fs/promises';
const context = JSON.parse(await readFile(process.argv[2], 'utf8'));
const endpoint = context.url;
const token = context.token;
if (!endpoint || !token || !/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint)) process.exit(1);
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  if (Buffer.byteLength(line) > 256 * 1024) { process.exitCode = 1; input.close(); return; }
  void (async () => {
    let message;
    try {
      message = JSON.parse(line);
      if (message.id === undefined) return;
      let result;
      if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'guest-tools', version: '1.0.0' } };
      else if (message.method === 'ping') result = {};
      else if (['tools/list','tools/call'].includes(message.method)) {
        const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: message.method, params: message.params }), signal: AbortSignal.timeout(10 * 60_000) });
        if (!response.ok) throw new Error('GUEST_TOOL_UNAVAILABLE');
        result = await response.json();
      } else throw new Error('UNSUPPORTED_METHOD');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
    } catch {
      if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Guest tool request failed.' } }) + '\n');
    }
  })();
});
