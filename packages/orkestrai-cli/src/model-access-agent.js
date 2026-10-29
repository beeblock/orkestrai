import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { StringDecoder } from 'node:string_decoder';

/**
 * A guest terminal. Provider processes and their credentials never run on this side.
 * @param {string[]} args
 * @param {{request:(body:Record<string,unknown>,signal:AbortSignal)=>Promise<Response>, input?:import('node:stream').Readable & {setRawMode?:(value:boolean)=>unknown}, write?:(value:string)=>void}} options
 */
export async function runModelAccessAgent(args, { request, input = process.stdin, write = value => process.stdout.write(value) }) {
  /** @param {string} name */
  const flag = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  let model = flag('--model'), effort = flag('--effort');
  const sessionId = flag('--session-id') ?? randomUUID(), instructions = flag('--instructions') ?? '';
  /** @type {{active?:AbortController}} */
  const state = {};
  /** @param {string} operation @param {string} [prompt] */
  async function send(operation, prompt = '') {
    state.active = new AbortController();
    try {
      const response = await request({ operation, prompt, model, effort, sessionId, instructions }, state.active.signal);
      if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error ?? 'INFERENCE_OFFLINE'); }
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const result = await reader.read(); buffer += decoder.decode(result.value, { stream: !result.done });
        if (buffer.length > 256 * 1024) throw new Error('INFERENCE_OUTPUT_LIMIT');
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (!line) continue;
          const item = JSON.parse(line);
          if (item.event === 'configured') { const config = JSON.parse(item.text); model = config.model; effort = config.effort; }
          else if (item.event === 'text') write(stripVTControlCharacters(item.text));
          else if (item.event === 'tool') write(`\r\n[${stripVTControlCharacters(item.text)}]\r\n`);
          else if (item.event === 'error') throw new Error(item.text);
        }
        if (result.done) break;
      }
    } finally { state.active = undefined; }
  }
  await send('open');
  if (args.includes('--once')) {
    let prompt = ''; for await (const chunk of input) { prompt += chunk; if (prompt.length > 1024 * 1024) throw new Error('INFERENCE_INPUT_LIMIT'); }
    await send('turn', prompt); return;
  }
  write('\x1b[?2004h\r\n❯ ');
  input.setRawMode?.(true); input.resume();
  let draft = '', paste = false, escape = '', queued = Promise.resolve(), busy = false;
  const inputDecoder = new StringDecoder('utf8');
  const submit = () => {
    const prompt = draft; draft = ''; if (!prompt.trim() || busy) return;
    if (prompt.trim() === '/exit') { input.emit('end'); return; }
    busy = true; write('\r\n');
    queued = queued.then(() => send('turn', prompt)).catch(error => { write(`\r\n[${stripVTControlCharacters(String(error.message))}]`); }).finally(() => { busy = false; write('\r\n❯ '); });
  };
  await new Promise(resolve => {
    input.on('data', chunk => {
      for (const character of typeof chunk === 'string' ? chunk : inputDecoder.write(chunk)) {
        if (character === '\x03') { if (state.active) state.active.abort(); else { draft = ''; write('\r\n❯ '); } continue; }
        if (character === '\x04' && !draft && !busy) { input.emit('end'); continue; }
        if (character === '\x1b' || escape) {
          escape += character;
          if (escape === '\x1b[200~') { paste = true; escape = ''; }
          else if (escape === '\x1b[201~') { paste = false; escape = ''; }
          else if (escape.length >= 8 || /^\x1b\[[A-DF-H]$/.test(escape)) escape = '';
          continue;
        }
        if (busy) continue; // A second owner draft belongs in the app composer while this turn runs.
        if ((character === '\r' || character === '\n') && !paste) { submit(); continue; }
        if (character === '\x7f' || character === '\b') { if (draft.length) { draft = [...draft].slice(0,-1).join(''); write('\b \b'); } continue; }
        if (character === '\x15') { draft = ''; write('\r\x1b[2K❯ '); continue; }
        if (draft.length >= 1024 * 1024) continue;
        if (character >= ' ' || paste && (character === '\n' || character === '\t')) { draft += character; write(character === '\n' ? '\r\n' : character); }
      }
    });
    input.once('end', resolve); input.once('close', resolve);
  });
  state.active?.abort(); await queued; input.setRawMode?.(false); write('\x1b[?2004l');
}
