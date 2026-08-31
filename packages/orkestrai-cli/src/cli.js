/**
 * CLI `orkestrai` — ponte entre agentes e o canvas do Orkestrai.
 *
 * Config: sobe os diretorios a partir do cwd procurando
 * `.orkestrai/workspace.json` ({ token, apiUrl }). Variaveis de ambiente
 * ORKESTRAI_TOKEN e ORKESTRAI_API_URL tem precedencia.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { DESIGN_REFERENCE_TOPICS, designReference } from './design-reference.js';
import { apiClientReference } from './api-client-reference.js';

/** Porta livre de verdade: binda na efemera, le o numero e libera. */
export async function findFreePort() {
  return new Promise((resolvePromise, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
  });
}

/** Testa se uma porta esta livre (probe de bind em 127.0.0.1). */
export async function isPortFree(port) {
  return new Promise((resolvePromise) => {
    const srv = createNetServer();
    srv.unref();
    srv.once('error', () => resolvePromise(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolvePromise(true)));
  });
}

const USAGE = `orkestrai — ponte entre agentes do Orkestrai

Uso:
  orkestrai list [--agent <seuNodeId>] [--json]
  orkestrai usage [--json]
  orkestrai graph status | graph index [--project <uuid>] | graph search <consulta> [--project <uuid>] [--kinds <csv>] [--limit <n>] | graph symbol <symbolId> | graph neighbors <symbolId> [--direction incoming|outgoing|both] [--depth <1-4>] [--kinds <csv>] [--limit <n>] [--json]
  orkestrai memory list [consulta] [--history] [--json]
  orkestrai memory add <titulo> --content <texto> --source-label <fonte> [--kind fact|decision|preference|constraint|reference|lesson] [--source-type user|note|task|message|file|url|git|review|council|agent] [--source-id <id>] [--source-uri <path-ou-url>] [--source-excerpt <trecho>] [--tags <csv>] [--confidence <0-100>] [--pin]
  orkestrai memory revise <id> --title <titulo> --content <texto> --kind <tipo> --sources <json> --base-revision <n> --base-updated-at <iso>
  orkestrai memory archive <id>
  orkestrai huddle list [--json]
  orkestrai huddle say <huddleId> <mensagem> [--json]
  orkestrai ask <agente> <mensagem> [--from <agente>] [--timeout <ms>] [--raw] [--json]
  orkestrai note read <nodeId>
  orkestrai note write <nodeId> <conteudo>
  orkestrai note edit <nodeId> <trecho-antigo> <trecho-novo>
  orkestrai note create <titulo> [--content <texto>] [--connect <agente|all>]
  orkestrai api list [--json] | api reference | api read <nodeId> | api import <path> [--kind auto|bruno|postman|openCollection] [--node <nodeId>] [--title <titulo>] [--manual] | api create <titulo> --file <json> | api replace <nodeId> --file <json> --fingerprint <sha256> [--no-sync] | api sync-status <nodeId> | api pull <nodeId> [--force] | api push <nodeId> [--force] | api export <nodeId> <bruno|postman> [--path <relativo>] | api run <nodeId> <requestId> | api run-runner <nodeId> <runnerId> [--variables <json>] [--max-executions <n>] [--json]
  orkestrai image list | image read <nodeId> | image create [--title <titulo>] [--prompt <texto>] [--count <1-10>] [--transparent] | image update <nodeId> [--title <titulo>] [--prompt <texto>] [--count <1-10>] [--transparent|--opaque] | image connect <nodeId> <targetNodeId> [--order <n>] | image disconnect <nodeId> <targetNodeId> | image reference <nodeId> <path> [--title <titulo>] [--order <n>] | image run <nodeId> [--prompt <texto>] [--count <1-10>] [--transparent] [--output <pasta>] [--prefix <nome>] | image validate <nodeId> <runId> <outputPath> | image complete <nodeId> <runId> <outputPath...> | image fail <nodeId> <runId> [--error image_gen_tool_failed|image_gen_output_missing|image_gen_cancelled] | image cancel <nodeId> | image delete <nodeId>
  orkestrai design list | design read <nodeId> | design reference [${DESIGN_REFERENCE_TOPICS.join('|')}] | design audit <nodeId> | design template <nodeId> <product|marketing|mobile|design-system> --revision <n>
  orkestrai design apply <nodeId> <operations-json> --revision <n> [--summary <texto>] [--task <taskId>]
  orkestrai design import-code <nodeId> <arquivo> --format html|svelte|react|vue --name <nome> --revision <n> [--css <arquivo>]
  orkestrai design generate <nodeId> <elementIds-json> --framework svelar|svelte|react|next|vue|html --output <path> --name <nome> [--write --revision <n>]
  orkestrai role show [nome] | role write <nome> <prompt> | role edit <nome> <antigo> <novo>
  orkestrai portal create <url> [--title <titulo>] [--connect <agente|all>] [--force-new]
  orkestrai portal <nodeId|nome> <navigate <url> | eval <js> | dom | screenshot>
  orkestrai notify <mensagem> [--kind info|attention|project|task] [--title <titulo>]
  orkestrai status <starting|working|waiting_input|waiting_permission|blocked|idle|done|error|disconnected> [acao] [--task <id>]
  orkestrai recruit <titulo> --from <maestro> [--provider <id>] [--profile <nome>] [--model <id>] [--effort low|medium|high|xhigh|max|ultra] [--role <papel>] [--replace <agente>] [--floor <id>] [--json]
  orkestrai dismiss <agente> --from <maestro>
  orkestrai connect <de> <para> --from <maestro>
  orkestrai task list [--json]
  orkestrai task columns [--json]
  orkestrai task add <titulo> [--description <md>] [--assign <agente>] [--note <nota>] [--column <coluna>] [--from <agente>]
  orkestrai task done <taskId>
  orkestrai task move <taskId> <coluna>
  orkestrai task assign <taskId> <agente>
  orkestrai task link <taskId> <nota> | unlink <taskId>
  orkestrai task archive <taskId> | archive-done | history [--json]
  orkestrai floor list [--json]
  orkestrai floor create <nome> [--branch <b>] [--existing] [--clone]
  orkestrai floor preview <floorId> [--target <branch>]
  orkestrai floor land <floorId> [--target <branch>]
  orkestrai floor remove <floorId> [--delete-branch]
  orkestrai device list [--json]
  orkestrai device attach <deviceId> [--platform ios|android]
  orkestrai device tap <x> <y> | swipe <x1> <y1> <x2> <y2> [--duration <ms>]
  orkestrai device pinch <centerX> <centerY> <startDistance> <endDistance> [--duration <ms>]
  orkestrai device type <texto> | button <back|home|lock|app-switcher> | rotate <orientacao>
  orkestrai device install <path> | launch <bundleId|package/activity> | logs | tree | screenshot | stop
  orkestrai device permissions <list|grant|revoke|reset> [permission] [bundleId] [--value <valor>]
  orkestrai port [--check <porta>]  — devolve uma porta livre (ou testa uma)
  orkestrai fs read <path> | fs write <path> <conteudo> | fs search <termo> [--content]
  orkestrai say <texto>  — fala no desktop com a voz configurada
  orkestrai run <taskId>  — re-despacha a tarefa para o responsavel
  orkestrai notes | portals  — listagens rapidas
  orkestrai clip  — le a area de transferencia local
  orkestrai mcp  — servidor MCP em stdio (tools do canvas para agentes MCP)

Config: .orkestrai/workspace.json (token, apiUrl) ou env ORKESTRAI_TOKEN/ORKESTRAI_API_URL.
Identidade: ORKESTRAI_NODE_ID/ORKESTRAI_AGENT_TITLE no ambiente ja definem --from e --agent.
`;

function findBridgeConfig(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 12; i += 1) {
    // .orkestrai/ e o atual; .pantheon/ e o legado (workspaces antigos).
    for (const folder of ['.orkestrai', '.pantheon']) {
      const candidate = resolve(dir, folder, 'workspace.json');
      if (existsSync(candidate)) {
        try {
          return JSON.parse(readFileSync(candidate, 'utf8'));
        } catch {
          return null;
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findRuntimeConfig(env) {
  try {
    // ORKESTRAI_RUNTIME_FILE sobrepoe o caminho ('' desativa — usado em testes).
    const custom = env.ORKESTRAI_RUNTIME_FILE;
    if (custom === '') return {};
    if (!custom && process.env.VITEST) return {};
    const candidate = custom ?? resolve(homedir(), '.orkestrai', 'runtime.json');
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
  } catch {
    // ignora — cai no workspace.json/default
  }
  return {};
}

function resolveConfig(env, cwd) {
  const fileConfig = findBridgeConfig(cwd) ?? {};
  const runtimeConfig = findRuntimeConfig(env);
  const token = env.ORKESTRAI_TOKEN ?? fileConfig.token;
  // A porta do app empacotado e livre (muda a cada execucao): o runtime.json
  // e regravado a cada boot e tem precedencia sobre o apiUrl do workspace.json.
  const apiUrl = (env.ORKESTRAI_API_URL ?? runtimeConfig.apiUrl ?? fileConfig.apiUrl ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
  if (!token) {
    throw new Error('Token da ponte nao encontrado (.orkestrai/workspace.json ou ORKESTRAI_TOKEN).');
  }
  return { token, apiUrl };
}

async function bridge(config, method, path, body) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(payload.error || payload.data?.error || `Falha na ponte (HTTP ${response.status}).`);
  }
  return payload.data;
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  const known = new Set(['raw', 'json', 'from', 'provider', 'role', 'replace', 'timeout']);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (known.has(arg.slice(2))) {
      if (arg === '--raw') flags.raw = true;
      else if (arg === '--json') flags.json = true;
      else if (arg === '--timeout') flags.timeout = Number(args[++i]);
      else flags[arg.slice(2)] = args[++i];
    } else if (arg.startsWith('--')) {
      // Flags genericos (--content, --connect, --assign, --branch, --clone,
      // --existing, --target, --delete-branch, --agent...): --nome valor ou --nome sozinho.
      const name = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
    } else positional.push(arg);
  }
  return { flags, positional };
}

function apiCollectionFromDocument(document) {
  const source = document?.collection ?? document?.payload ?? document;
  if (!source || Array.isArray(source) || typeof source !== 'object') throw new Error('O arquivo deve conter uma colecao de API JSON.');
  return Object.fromEntries([
    'requests', 'folders', 'runners', 'selectedRunnerId', 'selectedRequestId', 'variables', 'environments', 'globalVariables',
    'runtimeVariables', 'scriptDialect', 'activeEnvironment', 'collectionPreRequestScript', 'collectionPostResponseScript',
  ].filter((key) => Object.prototype.hasOwnProperty.call(source, key)).map((key) => [key, source[key]]));
}

export async function run(argv, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? console.log;

  const { flags, positional } = parseFlags(argv);
  const [command, ...rest] = positional;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    out(USAGE);
    return 0;
  }

  // Identidade do agente no ambiente (injetada no spawn do terminal): a CLI
  // ja sabe "quem eu sou" — --from e --agent viram opcionais.
  const selfAgent = env.ORKESTRAI_NODE_ID ?? env.ORKESTRAI_AGENT_TITLE;
  if (selfAgent) {
    flags.from = flags.from ?? selfAgent;
    flags.agent = flags.agent ?? selfAgent;
  }

  // `port` e 100% local (nao toca a bridge): resolve ANTES de exigir config.
  if (command === 'port') {
    const check = flags.check ?? rest[0];
    if (check !== undefined && check !== true) {
      const n = Number(check);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Uso: orkestrai port [--check <porta>]');
      const free = await isPortFree(n);
      out(free ? `${n} livre` : `${n} ocupada`);
      return free ? 0 : 1;
    }
    out(String(await findFreePort()));
    return 0;
  }

  // A referencia do Design e local e deve funcionar mesmo fora de um
  // workspace provisionado, assim como o handshake do MCP.
  if (command === 'design' && rest[0] === 'reference') {
    out(JSON.stringify(designReference(rest[1] ?? 'quickstart'), null, 2));
    return 0;
  }
  if (command === 'api' && rest[0] === 'reference') {
    out(JSON.stringify(apiClientReference(), null, 2));
    return 0;
  }

  // O MCP e global no Codex e pode subir fora de um workspace Orkestrai.
  // Resolve token/URL apenas quando uma tool realmente tocar a bridge; assim
  // o handshake nunca morre por falta de .orkestrai/workspace.json.
  if (command === 'mcp') {
    const { runMcpServer } = await import('./mcp.js');
    await runMcpServer({
      input: options.input ?? process.stdin,
      write: options.write ?? ((chunk) => process.stdout.write(chunk)),
      bridge: (method, path, body) => bridge(resolveConfig(env, cwd), method, path, body),
      findFreePort,
      selfAgent: selfAgent ?? null,
    });
    return 0;
  }

  const config = resolveConfig(env, cwd);

  switch (command) {
    case 'list': {
      const agentIdentity = flags.agent ?? selfAgent;
      const query = agentIdentity ? `?agentNodeId=${encodeURIComponent(agentIdentity)}` : '';
      const data = await bridge(config, 'GET', `/api/agent-room/bridge/agents${query}`);
      if (flags.json) {
        out(JSON.stringify(data, null, 2));
      } else {
        out(`Workspace: ${data.workspace.name}`);
        for (const repository of data.repositories ?? []) {
          out(`Repositorio adicional: ${repository.reference}`);
        }
        for (const agent of data.agents) {
          const status = agent.sessionAlive ? 'vivo' : 'sem sessao';
          const badge = agent.maestro ? ' [LIDER]' : '';
          out(`- ${agent.title}${badge} [${agent.provider ?? 'shell'}] (${status}) ${agent.nodeId}`);
        }
        if (data.agents.some((agent) => agent.maestro)) {
          out('O agente com [LIDER] e o maestro do time — fale com ele pelo TITULO (nao existe agente chamado "Maestro").');
        }
        if (data.notes?.length) {
          out(`Notas conectadas: ${data.notes.join(', ')}`);
        }
        for (const portal of data.portals ?? []) {
          const connection = portal.connected === true
            ? 'conectado a este agente'
            : portal.connected === false
              ? 'existe no workspace; nao conectado a este agente'
              : 'existe no workspace';
          out(`Portal [${connection}]: ${portal.title} ${portal.url} (${portal.id})`);
        }
        if (data.portals?.length) {
          out(`Controle o portal com: orkestrai portal <nodeId|nome> <navigate <url> | eval <js> | dom | screenshot>`);
        }
        for (const design of data.designs ?? []) {
          out(`Design conectado: ${design.title} (${design.id})`);
        }
        if (data.designs?.length) {
          out('Edite com tools MCP design_* (preferencial) ou orkestrai design read/apply. Leia a revisao novamente apos cada alteracao.');
        }
      }
      return 0;
    }
    case 'ask': {
      const [to, ...messageParts] = rest;
      const message = messageParts.join(' ').trim();
      if (!to || !message) throw new Error('Uso: orkestrai ask <agente> <mensagem> [--from <agente>] [--timeout ms]');
      const data = await bridge(config, 'POST', '/api/agent-room/bridge/ask', {
        to,
        message,
        from: flags.from,
        timeoutMs: flags.timeout,
        raw: flags.raw || undefined,
      });
      if (flags.json) out(JSON.stringify(data, null, 2));
      else if (flags.raw) out(data.sent ? `Mensagem ${data.messageId} entregue para ${data.to}.` : 'Mensagem nao enviada.');
      else if (data.replyConfirmed ?? (!data.timedOut && Boolean(data.reply))) {
        out(`Resposta confirmada de ${data.to} (mensagem ${data.messageId}):`);
        out(data.reply);
      } else {
        out(`Resposta nao confirmada de ${data.to}: timeout ou interrupcao. Nao trate esta tentativa como uma conversa concluida.`);
      }
      if (flags.raw) return data.sent ? 0 : 2;
      return (data.replyConfirmed ?? (!data.timedOut && Boolean(data.reply))) ? 0 : 2;
    }
    case 'usage': {
      const data = await bridge(config, 'GET', '/api/agent-room/bridge/usage');
      if (flags.json) {
        out(JSON.stringify(data, null, 2));
      } else {
        for (const provider of data.providers ?? []) {
          const windows = (provider.windows ?? []).map((window) => `${window.kind}: ${window.usedPercent}%`).join(', ');
          out(`- ${provider.provider}: ${provider.status}${windows ? ` (${windows})` : ''}`);
        }
        if (data.shouldFallback) {
          out(`ROTEAMENTO RECOMENDADO: novas tarefas de ${data.policy.sourceProvider} devem ir para ${data.recommendedProvider}.`);
        } else {
          out('Roteamento atual mantido; nenhuma troca de provider recomendada.');
        }
      }
      return 0;
    }
    case 'graph': {
      const [action, value, ...queryParts] = rest;
      if (action === 'status') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/code-graph');
        if (flags.json) out(JSON.stringify(data, null, 2));
        else if (!data.projects?.length) out('(no code repositories registered)');
        else for (const project of data.projects) {
          out(`- ${project.name}: ${project.status} · ${project.stats.files} files · ${project.stats.symbols} symbols · ${project.stats.edges} relationships`);
        }
        return 0;
      }
      if (action === 'index') {
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/code-graph', {
          projectIds: flags.project ? [String(flags.project)] : undefined,
          force: Boolean(flags.force),
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Code graph indexed: ${data.stats.files} files · ${data.stats.symbols} symbols · ${data.stats.edges} relationships.`);
        return 0;
      }
      if (action === 'search') {
        const query = [value, ...queryParts].filter(Boolean).join(' ').trim();
        if (!query) throw new Error('Usage: orkestrai graph search <query> [--kinds <csv>]');
        const params = new URLSearchParams({ q: query });
        if (flags.project) params.set('projectId', String(flags.project));
        if (flags.kinds) params.set('kinds', String(flags.kinds));
        if (flags.limit) params.set('limit', String(flags.limit));
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/code-graph/search?${params}`);
        if (flags.json) out(JSON.stringify(data, null, 2));
        else if (!data.length) out('(no matching symbols)');
        else for (const symbol of data) out(`- ${symbol.kind} ${symbol.qualifiedName} · ${symbol.projectName ?? ''}/${symbol.path ?? ''}:${symbol.startLine ?? 1} (${symbol.id})`);
        return 0;
      }
      if (action === 'symbol' && value) {
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/code-graph/symbols/${encodeURIComponent(value)}`);
        out(JSON.stringify(data, null, 2));
        return 0;
      }
      if (action === 'neighbors' && value) {
        const params = new URLSearchParams();
        if (flags.direction) params.set('direction', String(flags.direction));
        if (flags.depth) params.set('depth', String(flags.depth));
        if (flags.kinds) params.set('kinds', String(flags.kinds));
        if (flags.limit) params.set('limit', String(flags.limit));
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/code-graph/symbols/${encodeURIComponent(value)}/graph?${params}`);
        if (flags.json) out(JSON.stringify(data, null, 2));
        else {
          out(`${data.nodes.length} symbols · ${data.edges.length} relationships${data.truncated ? ' · truncated' : ''}`);
          for (const symbol of data.nodes) out(`- ${symbol.kind} ${symbol.qualifiedName} (${symbol.id})`);
        }
        return 0;
      }
      throw new Error('Usage: orkestrai graph <status|index|search|symbol|neighbors> ...');
    }
    case 'memory': {
      const [action, idOrTitle, ...values] = rest;
      if (action === 'list') {
        const query = [idOrTitle, ...values].filter(Boolean).join(' ');
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (flags.history) params.set('history', '1');
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/memory?${params}`);
        if (flags.json) out(JSON.stringify(data, null, 2));
        else if (!data.length) out('(nenhuma memoria encontrada)');
        else for (const item of data) out(`- ${item.title} [${item.kind}] v${item.revision} (${item.id})`);
        return 0;
      }
      if (action === 'add') {
        if (!idOrTitle || !flags.content || !flags['source-label']) throw new Error('Uso: orkestrai memory add <titulo> --content <texto> --source-label <fonte> [...]');
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/memory', {
          title: idOrTitle, content: String(flags.content), kind: flags.kind ?? 'fact', confidence: Number(flags.confidence ?? 100), pinned: Boolean(flags.pin),
          tags: String(flags.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean), createdByNodeId: selfAgent?.length === 36 ? selfAgent : null,
          sources: [{ type: flags['source-type'] ?? 'user', sourceId: flags['source-id'] ?? null, label: String(flags['source-label']), uri: flags['source-uri'] ?? null, excerpt: flags['source-excerpt'] ?? null }],
        });
        if (flags.json) out(JSON.stringify(data, null, 2)); else out(`Memoria salva: ${data.title} v${data.revision} (${data.id})`);
        return 0;
      }
      if (action === 'revise') {
        if (!idOrTitle || !flags.title || !flags.content || !flags.kind || !flags.sources || !flags['base-revision'] || !flags['base-updated-at']) throw new Error('Uso: orkestrai memory revise <id> --title ... --content ... --kind ... --sources <json> --base-revision <n> --base-updated-at <iso>');
        const data = await bridge(config, 'PATCH', `/api/agent-room/bridge/memory/${encodeURIComponent(idOrTitle)}`, {
          title: String(flags.title), content: String(flags.content), kind: flags.kind, confidence: Number(flags.confidence ?? 100), pinned: Boolean(flags.pin),
          tags: String(flags.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean), createdByNodeId: selfAgent?.length === 36 ? selfAgent : null,
          sources: JSON.parse(String(flags.sources)), baseRevision: Number(flags['base-revision']), baseUpdatedAt: String(flags['base-updated-at']),
        });
        if (flags.json) out(JSON.stringify(data, null, 2)); else out(`Memoria revisada: ${data.title} v${data.revision}`);
        return 0;
      }
      if (action === 'archive') {
        if (!idOrTitle) throw new Error('Uso: orkestrai memory archive <id>');
        const data = await bridge(config, 'DELETE', `/api/agent-room/bridge/memory/${encodeURIComponent(idOrTitle)}`);
        if (flags.json) out(JSON.stringify(data, null, 2)); else out(`Memoria arquivada: ${data.title}`);
        return 0;
      }
      throw new Error('Uso: orkestrai memory <list|add|revise|archive> ...');
    }
    case 'role': {
      const [action, name, ...values] = rest;
      if (action === 'show') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/roles' + (name ? '?name=' + encodeURIComponent(name) : ''));
        if (flags.json) {
          out(JSON.stringify(data, null, 2));
        } else if (Array.isArray(data)) {
          for (const role of data) out('- ' + role.name + ' [' + role.slug + '] (' + role.prompt.length + ' chars)');
        } else {
          out(data.prompt || '(prompt vazio)');
        }
        return 0;
      }
      if (action === 'write') {
        if (!name) throw new Error('Uso: orkestrai role write <nome> <prompt>');
        await bridge(config, 'POST', '/api/agent-room/bridge/roles', { name, prompt: values.join(' ') });
        out('Responsabilidade "' + name + '" salva.');
        return 0;
      }
      if (action === 'edit') {
        if (!name || !values[0]) throw new Error('Uso: orkestrai role edit <nome> <trecho-antigo> <trecho-novo>');
        await bridge(config, 'PATCH', '/api/agent-room/bridge/roles', { name, old: values[0], new: values.slice(1).join(' ') });
        out('Responsabilidade "' + name + '" editada.');
        return 0;
      }
      throw new Error('Uso: orkestrai role <show|write|edit> ...');
    }
    case 'huddle': {
      const [action, huddleId, ...values] = rest;
      if (action === 'list') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/huddles');
        if (flags.json) out(JSON.stringify(data, null, 2));
        else for (const item of data.huddles ?? []) out(`- ${item.title} (${item.id}) [${item.status}] ${item.turnCount} turnos`);
        return 0;
      }
      if (action === 'say') {
        if (!selfAgent || !huddleId || !values.length) throw new Error('Uso: orkestrai huddle say <huddleId> <mensagem>');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/huddles/${encodeURIComponent(huddleId)}/turns`, { from: selfAgent, text: values.join(' ') });
        if (flags.json) out(JSON.stringify(data, null, 2)); else out(`Fala registrada no huddle ${data.title}.`);
        return 0;
      }
      throw new Error('Uso: orkestrai huddle <list|say> ...');
    }
    case 'note': {
      const [action, nodeId, ...values] = rest;
      if (action === 'create') {
        const title = [nodeId, ...values].join(' ');
        if (!title) throw new Error('Uso: orkestrai note create <titulo> [--content <texto>] [--connect <agente|all>]');
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/notes', {
          title,
          content: flags.content,
          // Default: nota visivel para o time inteiro (specs/briefs).
          connect: flags.connect ?? 'all',
        });
        out(`Nota criada: "${data.title}" (${data.nodeId})${data.connectedTo ? ` — conectada a ${data.connectedTo}` : ''}`);
        return 0;
      }
      if (!action || !nodeId) throw new Error('Uso: orkestrai note <read|write|edit|create> ...');
      if (action === 'read') {
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/notes/${nodeId}`);
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(data.content);
        return 0;
      }
      if (action === 'write') {
        const content = values.join(' ');
        const data = await bridge(config, 'PUT', `/api/agent-room/bridge/notes/${nodeId}`, { content });
        out(`Nota ${data.nodeId} atualizada (${data.written} caracteres).`);
        return 0;
      }
      if (action === 'edit') {
        const [oldText, newText] = [values[0], values.slice(1).join(' ')];
        if (!oldText) throw new Error('Uso: orkestrai note edit <nodeId> <trecho-antigo> <trecho-novo>');
        await bridge(config, 'PATCH', `/api/agent-room/bridge/notes/${nodeId}`, { old: oldText, new: newText });
        out(`Nota ${nodeId} editada.`);
        return 0;
      }
      throw new Error(`Acao de nota desconhecida: ${action}`);
    }
    case 'api': {
      const [action, nodeId, requestId] = rest;
      if (action === 'list') {
        const query = selfAgent ? `?agentNodeId=${encodeURIComponent(selfAgent)}` : '';
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/api-clients${query}`);
        if (flags.json) out(JSON.stringify(data, null, 2));
        else {
          for (const client of data) {
            out(`- ${client.title} (${client.nodeId})`);
            for (const request of client.requests ?? []) out(`  ${request.method} ${request.name} (${request.requestId}) ${request.url}`);
          }
          if (!data.length) out('(nenhum cliente de API conectado)');
        }
        return 0;
      }
      if (action === 'read' && nodeId) {
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/api-clients/${encodeURIComponent(nodeId)}?agentNodeId=${encodeURIComponent(selfAgent ?? '')}`);
        out(JSON.stringify(data, null, 2));
        return 0;
      }
      if (action === 'import' && nodeId) {
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/api-clients/import', {
          path: nodeId,
          kind: flags.kind ?? 'auto',
          nodeId: flags.node,
          title: flags.title,
          syncMode: flags.manual ? 'manual' : 'watch',
          from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Colecao vinculada: ${data.title} (${data.nodeId}) · ${data.repository?.path ?? nodeId}`);
        return 0;
      }
      if (action === 'create') {
        if (!nodeId || !flags.file) throw new Error('Uso: orkestrai api create <titulo> --file <collection.json>');
        const document = JSON.parse(readFileSync(resolve(cwd, String(flags.file)), 'utf8'));
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/api-clients', { title: nodeId, collection: apiCollectionFromDocument(document), from: selfAgent });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Cliente de API criado: ${data.title} (${data.nodeId})`);
        return 0;
      }
      if (action === 'replace' && nodeId) {
        if (!flags.file || !flags.fingerprint) throw new Error('Uso: orkestrai api replace <nodeId> --file <collection.json> --fingerprint <sha256> [--title <titulo>]');
        const document = JSON.parse(readFileSync(resolve(cwd, String(flags.file)), 'utf8'));
        const data = await bridge(config, 'PUT', `/api/agent-room/bridge/api-clients/${encodeURIComponent(nodeId)}`, {
          title: flags.title,
          baseFingerprint: flags.fingerprint,
          collection: apiCollectionFromDocument(document),
          syncToSource: !flags['no-sync'],
          from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Cliente de API atualizado: ${data.title} (${data.fingerprint})`);
        return 0;
      }
      if (action === 'sync-status' && nodeId) {
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(nodeId)}/sync`, { action: 'status', from: selfAgent });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`${data.sourceKind ?? 'colecao'} · origem ${data.sourceChanged ? 'alterada' : 'atual'} · Orkestrai ${data.localChanged ? 'alterado' : 'atual'}${data.conflict ? ' · CONFLITO' : ''}`);
        return 0;
      }
      if ((action === 'pull' || action === 'push') && nodeId) {
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(nodeId)}/sync`, {
          action,
          ...(flags.force ? { resolution: action === 'pull' ? 'filesystem' : 'orkestrai' } : {}),
          from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(data.status === 'conflict' ? 'Conflito de sincronizacao: revise o status antes de forcar.' : `Colecao sincronizada (${action}).`);
        return data.status === 'conflict' ? 2 : 0;
      }
      if (action === 'export' && nodeId && ['bruno', 'postman'].includes(requestId)) {
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(nodeId)}/export`, {
          kind: requestId,
          path: flags.path ?? '.orkestrai/exports',
          from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Colecao ${requestId} exportada para ${data.path}`);
        return 0;
      }
      if (action === 'run-runner' && nodeId && requestId) {
        const variables = flags.variables ? JSON.parse(String(flags.variables)) : {};
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(nodeId)}/runners/${encodeURIComponent(requestId)}/execute`, {
          variables,
          maxExecutions: flags['max-executions'] ? Number(flags['max-executions']) : 100,
          from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`${data.runnerName}: ${data.passed ? 'OK' : 'FALHOU'} · ${data.executions} execucoes${data.stopReason ? ` · ${data.stopReason}` : ''}`);
        return data.passed ? 0 : 2;
      }
      if (action === 'run' && nodeId && requestId) {
        let variables = {};
        if (flags.variables) {
          variables = JSON.parse(String(flags.variables));
          if (!variables || Array.isArray(variables) || typeof variables !== 'object') throw new Error('--variables deve ser um objeto JSON.');
        }
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(nodeId)}/execute`, { requestId, variables, from: selfAgent });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else {
          out(`${data.status} ${data.statusText} · ${data.durationMs} ms · ${data.size} bytes`);
          if (data.body) out(data.body);
        }
        return data.ok ? 0 : 2;
      }
      throw new Error('Uso: orkestrai api <list|reference|read|import|create|replace|sync-status|pull|push|export|run|run-runner> ...');
    }
    case 'image': {
      const [action, nodeId, target] = rest;
      if (action === 'list') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/image-workflows');
        if (flags.json) out(JSON.stringify(data, null, 2));
        else {
          for (const workflow of data) out(`- ${workflow.title} [${workflow.status}] (${workflow.nodeId}) · ${workflow.references.length} refs · ${workflow.outputs.length} outputs`);
          if (!data.length) out('(nenhum fluxo de imagem)');
        }
        return 0;
      }
      if (action === 'read' && nodeId) {
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}`);
        out(JSON.stringify(data, null, 2));
        return 0;
      }
      if (action === 'create') {
        if (!selfAgent) throw new Error('Identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/image-workflows', {
          title: flags.title,
          prompt: flags.prompt,
          count: flags.count,
          transparentBackground: flags.transparent === undefined ? undefined : true,
          outputDirectory: flags.output,
          filePrefix: flags.prefix,
          from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Fluxo criado e conectado: ${data.title} (${data.nodeId}).`);
        return 0;
      }
      if (action === 'update' && nodeId) {
        if (!selfAgent) throw new Error('Identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
        const transparentBackground = flags.opaque ? false : flags.transparent ? true : undefined;
        const data = await bridge(config, 'PATCH', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}`, {
          title: flags.title,
          prompt: flags.prompt,
          count: flags.count,
          transparentBackground,
          outputDirectory: flags.output,
          filePrefix: flags.prefix,
          from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Fluxo atualizado: ${data.title} (${data.nodeId}).`);
        return 0;
      }
      if (action === 'connect' && nodeId && target) {
        if (!selfAgent) throw new Error('Identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}/connections`, {
          targetNodeId: target, order: flags.order, from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Node conectado ao fluxo: ${target}.`);
        return 0;
      }
      if (action === 'disconnect' && nodeId && target) {
        if (!selfAgent) throw new Error('Identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
        const data = await bridge(config, 'DELETE', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}/connections`, {
          targetNodeId: target, from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(data.disconnected ? `Node desconectado do fluxo: ${target}.` : 'A conexao nao existia.');
        return 0;
      }
      if (action === 'reference' && nodeId && target) {
        if (!selfAgent) throw new Error('Identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}/references`, {
          path: target, title: flags.title, order: flags.order, from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Referencia adicionada: ${data.reference.path} (${data.reference.nodeId}).`);
        return 0;
      }
      if (action === 'run' && nodeId) {
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}`, {
          prompt: flags.prompt,
          count: flags.count,
          transparentBackground: flags.transparent === undefined ? undefined : Boolean(flags.transparent),
          outputDirectory: flags.output,
          filePrefix: flags.prefix,
          from: selfAgent,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Run ${data.runId} preparado para image_gen.imagegen. Destinos: ${data.outputPaths.join(', ')}`);
        return 0;
      }
      if (action === 'complete' && nodeId) {
        const [runId, ...outputPaths] = rest.slice(2);
        if (!runId || !outputPaths.length) throw new Error('Uso: orkestrai image complete <nodeId> <runId> <outputPath...>');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}/complete`, { runId, outputPaths, from: selfAgent });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Fluxo concluido: ${data.outputPaths.length} imagem(ns) materializada(s).`);
        return 0;
      }
      if (action === 'validate' && nodeId) {
        const runId = rest[2];
        const outputPath = rest[3];
        if (!runId || !outputPath) throw new Error('Uso: orkestrai image validate <nodeId> <runId> <outputPath>');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}/validate`, { runId, outputPath, from: selfAgent });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else if (data.valid) out(`Output validado: ${data.path}.`);
        else out(`Output invalido (${data.errorCode}): ${data.repair ?? data.path}`);
        return data.valid ? 0 : 2;
      }
      if (action === 'fail' && nodeId) {
        const runId = rest[2];
        if (!runId) throw new Error('Uso: orkestrai image fail <nodeId> <runId> [--error image_gen_tool_failed]');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}/fail`, { runId, errorCode: flags.error ?? 'image_gen_tool_failed', from: selfAgent });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Falha registrada no run ${data.run.id}.`);
        return 0;
      }
      if (action === 'cancel' && nodeId) {
        if (!selfAgent) throw new Error('Identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
        const data = await bridge(config, 'DELETE', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}`, { from: selfAgent });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(data.cancelled ? `Execucao ${data.runId} cancelada.` : 'Nenhuma execucao ativa.');
        return 0;
      }
      if (action === 'delete' && nodeId) {
        if (!selfAgent) throw new Error('Identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}/remove`, { from: selfAgent });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Fluxo removido: ${data.nodeId}.`);
        return 0;
      }
      throw new Error('Uso: orkestrai image <list|read|create|update|connect|disconnect|reference|run|validate|complete|fail|cancel|delete> ...');
    }
    case 'design': {
      const [action, nodeId, ...values] = rest;
      if (action === 'list') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/designs');
        if (flags.json) out(JSON.stringify(data, null, 2));
        else {
          for (const design of data) out(`- ${design.title} [rev ${design.revision}, ${design.elements} elementos] (${design.nodeId})`);
          if (!data.length) out('(nenhum documento de design)');
        }
        return 0;
      }
      if (action === 'read' && nodeId) {
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/designs/${encodeURIComponent(nodeId)}`);
        out(JSON.stringify(data, null, 2));
        return 0;
      }
      if (action === 'audit' && nodeId) {
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/designs/${encodeURIComponent(nodeId)}/quality`);
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Auditados ${data.auditedElements} elementos: ${data.counts.error} erros, ${data.counts.warning} alertas, ${data.counts.info} informativos.`);
        return 0;
      }
      if (action === 'template' && nodeId && values[0]) {
        const baseRevision = Number(flags.revision);
        if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new Error('Uso: orkestrai design template <nodeId> <product|marketing|mobile|design-system> --revision <n>');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/designs/${encodeURIComponent(nodeId)}/quality`, {
          templateId: values[0], baseRevision, from: flags.from, taskId: flags.task,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Template aplicado; design atualizado para a revisao ${data.revision}.`);
        return 0;
      }
      if (action === 'apply' && nodeId) {
        const baseRevision = Number(flags.revision);
        if (!Number.isInteger(baseRevision) || baseRevision < 0 || !values.length) {
          throw new Error('Uso: orkestrai design apply <nodeId> <operations-json> --revision <n> [--summary <texto>]');
        }
        const operations = JSON.parse(values.join(' '));
        const data = await bridge(config, 'PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(nodeId)}`, {
          baseRevision,
          operations: Array.isArray(operations) ? operations : [operations],
          summary: flags.summary ?? 'Agent design update',
          from: flags.from,
          taskId: flags.task,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Design atualizado para a revisao ${data.revision}.`);
        return 0;
      }
      if (action === 'import-code' && nodeId && values[0]) {
        const baseRevision = Number(flags.revision);
        const format = String(flags.format ?? 'html');
        if (!Number.isInteger(baseRevision) || baseRevision < 0 || !flags.name) {
          throw new Error('Uso: orkestrai design import-code <nodeId> <arquivo> --format html|svelte|react|vue --name <nome> --revision <n> [--css <arquivo>]');
        }
        const markup = readFileSync(resolve(cwd, values[0]), 'utf8');
        const css = flags.css ? readFileSync(resolve(cwd, String(flags.css)), 'utf8') : '';
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/designs/${encodeURIComponent(nodeId)}/delivery/import`, {
          baseRevision,
          format,
          name: flags.name,
          markup,
          css,
          x: flags.x === undefined ? 80 : Number(flags.x),
          y: flags.y === undefined ? 80 : Number(flags.y),
          parentId: flags.parent ?? null,
          summary: flags.summary,
          from: flags.from,
          taskId: flags.task,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Codigo importado: ${data.elements.length} elementos, revisao ${data.revision}.`);
        return 0;
      }
      if (action === 'generate' && nodeId && values.length) {
        const framework = String(flags.framework ?? 'svelar');
        const outputPath = String(flags.output ?? '');
        const componentName = String(flags.name ?? '');
        const elementIds = JSON.parse(values.join(' '));
        if (!Array.isArray(elementIds) || !outputPath || !componentName) {
          throw new Error('Uso: orkestrai design generate <nodeId> <elementIds-json> --framework <id> --output <path> --name <nome> [--write --revision <n>]');
        }
        const preview = await bridge(config, 'POST', `/api/agent-room/bridge/designs/${encodeURIComponent(nodeId)}/delivery/preview`, {
          framework,
          elementIds,
          outputPath,
          componentName,
        });
        if (!flags.write) {
          if (flags.json) out(JSON.stringify(preview, null, 2));
          else out(preview.content);
          return 0;
        }
        const baseRevision = Number(flags.revision);
        if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new Error('--write exige --revision <n>.');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/designs/${encodeURIComponent(nodeId)}/delivery/apply`, {
          baseRevision,
          framework,
          elementIds,
          outputPath,
          componentName,
          expectedExistingHash: preview.existingHash,
          summary: flags.summary,
          from: flags.from,
          taskId: flags.task,
        });
        if (flags.json) out(JSON.stringify(data, null, 2));
        else out(`Codigo ${data.status === 'unchanged' ? 'validado' : 'escrito'} em ${data.path}; design na revisao ${data.revision}.`);
        return 0;
      }
      throw new Error('Uso: orkestrai design <list|read|audit|template|apply|import-code|generate> ...');
    }
    case 'recruit': {
      const [title] = rest;
      if (!title || !flags.from) throw new Error('Uso: orkestrai recruit <titulo> --from <maestro> [--provider id] [--profile nome] [--model id] [--effort medium] [--role papel] [--replace agente] [--floor id]');
      if (flags.profile && !flags.provider) throw new Error('--profile exige --provider para identificar a CLI da conta.');
      const data = await bridge(config, 'POST', '/api/agent-room/bridge/recruit', {
        title,
        from: flags.from,
        provider: flags.provider,
        profile: flags.profile,
        model: flags.model,
        effort: flags.effort,
        role: flags.role,
        replace: flags.replace,
        floorId: flags.floor,
      });
      if (flags.json) out(JSON.stringify(data, null, 2));
      else out(`Recruta "${data.title}" ${data.replaced ? 'substituido' : 'criado'}: ${data.nodeId}`);
      return 0;
    }
    case 'dismiss': {
      const [target] = rest;
      if (!target || !flags.from) throw new Error('Uso: orkestrai dismiss <agente> --from <maestro>');
      const data = await bridge(config, 'POST', '/api/agent-room/bridge/dismiss', { target, from: flags.from });
      out(`Agente "${data.dismissed}" dispensado.`);
      return 0;
    }
    case 'connect': {
      const [fromNode, toNode] = rest;
      if (!fromNode || !toNode || !flags.from) throw new Error('Uso: orkestrai connect <de> <para> --from <maestro>');
      const data = await bridge(config, 'POST', '/api/agent-room/bridge/connect', { from: flags.from, source: fromNode, to: toNode });
      out(`Conectados: ${data.from} -> ${data.to}`);
      return 0;
    }
    case 'portal': {
      const [nodeId, action, ...values] = rest;
      if (nodeId === 'create') {
        const url = action;
        if (!url) throw new Error('Uso: orkestrai portal create <url> [--title <titulo>] [--connect <agente|all>] [--force-new]');
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/portal/create', {
          url,
          title: flags.title,
          connect: flags.connect,
          from: flags.from,
          forceNew: flags['force-new'] === true,
        });
        out(`Portal ${data.reused ? 'reutilizado' : 'criado'}: "${data.title}" (${data.nodeId}) — conectado a ${data.connectedTo}`);
        return 0;
      }
      if (!nodeId || !action) throw new Error('Uso: orkestrai portal <nodeId|nome> <navigate <url> | eval <js> | dom | screenshot>');
      const args = action === 'navigate' ? { url: values.join(' ') } : action === 'eval' ? { js: values.join(' ') } : {};
      const data = await bridge(config, 'POST', '/api/agent-room/bridge/portal', { nodeId, action, args });
      if (flags.json) out(JSON.stringify(data, null, 2));
      else out(typeof data.result === 'string' ? data.result : JSON.stringify(data.result ?? data, null, 2));
      return 0;
    }
    case 'notify': {
      const message = rest.join(' ');
      if (!message) throw new Error('Uso: orkestrai notify <mensagem>');
      const data = await bridge(config, 'POST', '/api/agent-room/bridge/notify', { message, kind: flags.kind, title: flags.title, from: flags.from });
      out(data.notified ? 'Notificacao enviada.' : 'Evento informativo registrado sem notificacao do sistema.');
      return 0;
    }
    case 'status': {
      const [state, ...actionParts] = rest;
      if (!state || !flags.from) throw new Error('Uso: orkestrai status <estado> [acao] [--task <id>]');
      const data = await bridge(config, 'POST', '/api/agent-room/bridge/activity', {
        from: flags.from,
        state,
        action: actionParts.join(' ') || undefined,
        taskId: flags.task,
      });
      if (flags.json) out(JSON.stringify(data, null, 2));
      else out(`Estado registrado: ${data.state}.`);
      return 0;
    }
    case 'task': {
      const [action, ...values] = rest;
      if (action === 'list') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/tasks');
        if (flags.json) {
          out(JSON.stringify(data, null, 2));
        } else {
          for (const task of data) {
            const who = task.assigneeTitle ? ` → ${task.assigneeTitle}` : '';
            out(`- [${task.status}] ${task.title}${who} (${task.id})`);
            if (task.noteTitle) out(`    nota: ${task.noteTitle} (${task.noteId})`);
            for (const image of task.images ?? []) {
              out(`    imagem: ${image}`);
            }
          }
          if (!data.length) out('(quadro vazio)');
        }
        return 0;
      }
      if (action === 'add') {
        const title = values.join(' ');
        if (!title) throw new Error('Uso: orkestrai task add <titulo> [--description <md>] [--assign <agente>] [--note <nota>] [--from <agente>]');
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/tasks', {
          title,
          description: flags.description,
          assignee: flags.assign,
          note: flags.note,
          from: flags.from,
          status: flags.column,
        });
        out(`Tarefa criada: [${data.status}] ${data.title} (${data.id})`);
        return 0;
      }
      if (action === 'columns') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/task-columns');
        if (flags.json) out(JSON.stringify(data, null, 2));
        else for (const column of data) out(`- ${column.name ?? column.key} [${column.key}]`);
        return 0;
      }
      if (action === 'move') {
        const [taskId, ...columnParts] = values;
        const status = columnParts.join(' ');
        if (!taskId || !status) throw new Error('Uso: orkestrai task move <taskId> <coluna>');
        const data = await bridge(config, 'PATCH', `/api/agent-room/bridge/tasks/${taskId}`, { status });
        out(`Tarefa movida para [${data.status}].`);
        return 0;
      }
      if (action === 'done') {
        const taskId = values[0];
        if (!taskId) throw new Error('Uso: orkestrai task done <taskId>');
        const data = await bridge(config, 'PATCH', `/api/agent-room/bridge/tasks/${taskId}`, { status: 'done', from: flags.from });
        const handoff = data.completionHandoff;
        if (handoff?.status === 'queued') out(`Tarefa marcada como concluida. Lider ${handoff.leaderTitle} avisado.`);
        else if (handoff?.status === 'leader_offline') out(`Tarefa marcada como concluida. Lider ${handoff.leaderTitle} esta offline; o quadro registra a conclusao.`);
        else out('Tarefa marcada como concluida.');
        return 0;
      }
      if (action === 'assign') {
        const [taskId, assignee] = values;
        if (!taskId || !assignee) throw new Error('Uso: orkestrai task assign <taskId> <agente>');
        await bridge(config, 'PATCH', `/api/agent-room/bridge/tasks/${taskId}`, { assignee });
        out('Tarefa atribuida.');
        return 0;
      }
      if (action === 'link') {
        const [taskId, ...noteParts] = values;
        const note = noteParts.join(' ');
        if (!taskId || !note) throw new Error('Uso: orkestrai task link <taskId> <nota (id ou titulo)>');
        await bridge(config, 'PATCH', `/api/agent-room/bridge/tasks/${taskId}`, { note });
        out('Nota vinculada a tarefa.');
        return 0;
      }
      if (action === 'unlink') {
        const taskId = values[0];
        if (!taskId) throw new Error('Uso: orkestrai task unlink <taskId>');
        await bridge(config, 'PATCH', `/api/agent-room/bridge/tasks/${taskId}`, { note: '' });
        out('Nota desvinculada da tarefa.');
        return 0;
      }
      if (action === 'archive') {
        const taskId = values[0];
        if (!taskId) throw new Error('Uso: orkestrai task archive <taskId>');
        await bridge(config, 'POST', `/api/agent-room/bridge/tasks/${taskId}/archive`, {});
        out('Tarefa arquivada (sai do quadro, fica no historico).');
        return 0;
      }
      if (action === 'archive-done') {
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/tasks/archive-done', {});
        out(`Arquivadas ${data.archived} tarefa(s) concluida(s).`);
        return 0;
      }
      if (action === 'history') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/tasks/history');
        if (flags.json) {
          out(JSON.stringify(data, null, 2));
        } else {
          for (const task of data) {
            const who = task.assigneeTitle ? ` → ${task.assigneeTitle}` : '';
            const when = String(task.updatedAt ?? '').slice(0, 16).replace('T', ' ');
            out(`- [${task.status}${task.archivedAt ? '/arquivada' : ''}] ${task.title}${who} (${when})`);
            if (task.noteTitle) out(`    nota: ${task.noteTitle} (${task.noteId})`);
          }
          if (!data.length) out('(historico vazio)');
        }
        return 0;
      }
      throw new Error('Uso: orkestrai task <list|columns|add|move|done|assign|link|unlink|archive|archive-done|history> ...');
    }
    case 'floor': {
      const [action, ...values] = rest;
      if (action === 'list') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/floors');
        if (flags.json) {
          out(JSON.stringify(data, null, 2));
        } else {
          for (const floor of data) out(`- ${floor.name} [${floor.branch}] ${floor.status} (${floor.id})`);
          if (!data.length) out('(nenhum andar)');
        }
        return 0;
      }
      if (action === 'create') {
        const name = values.join(' ');
        if (!name) throw new Error('Uso: orkestrai floor create <nome> [--branch <b>] [--existing] [--clone]');
        const data = await bridge(config, 'POST', '/api/agent-room/bridge/floors', {
          name,
          branch: flags.branch,
          existingBranch: Boolean(flags.existing),
          cloneLayout: Boolean(flags.clone),
        });
        out(`Andar criado: ${data.name} [${data.branch}] (${data.id})`);
        return 0;
      }
      if (action === 'preview') {
        const floorId = values[0];
        if (!floorId) throw new Error('Uso: orkestrai floor preview <floorId> [--target <branch>]');
        const query = flags.target ? `?target=${encodeURIComponent(flags.target)}` : '';
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/floors/${floorId}/preview${query}`);
        if (flags.json) out(JSON.stringify(data, null, 2));
        else {
          out(`Aterrissagem ${data.from} → ${data.to}${data.targetDirty ? ' (checkout sujo!)' : ''}`);
          if (data.stat) out(data.stat);
          out(data.conflicts.length ? `Conflitos potenciais: ${data.conflicts.join(', ')}` : 'Sem conflitos potenciais.');
        }
        return 0;
      }
      if (action === 'land') {
        const floorId = values[0];
        if (!floorId) throw new Error('Uso: orkestrai floor land <floorId> [--target <branch>]');
        const data = await bridge(config, 'POST', `/api/agent-room/bridge/floors/${floorId}/land`, { targetBranch: flags.target });
        out(`Aterrissado: ${data.branch} → ${data.into}`);
        return 0;
      }
      if (action === 'remove') {
        const floorId = values[0];
        if (!floorId) throw new Error('Uso: orkestrai floor remove <floorId> [--delete-branch]');
        const query = flags['delete-branch'] ? '?deleteBranch=true' : '';
        await bridge(config, 'DELETE', `/api/agent-room/bridge/floors/${floorId}${query}`);
        out('Andar removido.');
        return 0;
      }
      throw new Error('Uso: orkestrai floor <list|create|preview|land|remove> ...');
    }
    case 'device': {
      const [action, ...values] = rest;
      if (action === 'list') {
        const data = await bridge(config, 'GET', '/api/agent-room/bridge/devices');
        if (flags.json) out(JSON.stringify(data, null, 2));
        else {
          for (const device of data.devices ?? []) {
            out(`- ${device.name} [${device.platform}/${device.state}] ${device.runtime ?? ''} (${device.id})`);
          }
          if (!data.devices?.length) out('(nenhum dispositivo disponivel)');
          if (data.session) out(`Ativo: ${data.session.deviceName} [${data.session.status}]`);
        }
        return 0;
      }
      let body;
      if (action === 'attach') {
        if (!values[0]) throw new Error('Uso: orkestrai device attach <deviceId> [--platform ios|android]');
        body = { command: 'start', platform: flags.platform ?? 'ios', deviceId: values[0] };
      } else if (action === 'stop') body = { command: 'stop' };
      else if (action === 'tap') {
        if (values.length < 2) throw new Error('Uso: orkestrai device tap <x> <y> (coordenadas 0..1)');
        body = { command: 'tap', x: Number(values[0]), y: Number(values[1]) };
      } else if (action === 'swipe') {
        if (values.length < 4) throw new Error('Uso: orkestrai device swipe <x1> <y1> <x2> <y2> [--duration ms]');
        body = { command: 'swipe', fromX: Number(values[0]), fromY: Number(values[1]), toX: Number(values[2]), toY: Number(values[3]), durationMs: Number(flags.duration ?? 300) };
      } else if (action === 'pinch') {
        if (values.length < 4) throw new Error('Uso: orkestrai device pinch <centerX> <centerY> <startDistance> <endDistance> [--duration ms]');
        body = { command: 'pinch', centerX: Number(values[0]), centerY: Number(values[1]), startDistance: Number(values[2]), endDistance: Number(values[3]), durationMs: Number(flags.duration ?? 300) };
      } else if (action === 'type') {
        const text = values.join(' ');
        if (!text) throw new Error('Uso: orkestrai device type <texto>');
        body = { command: 'type', text };
      } else if (action === 'button') body = { command: 'button', button: values[0] ?? 'home' };
      else if (action === 'rotate') {
        if (!values[0]) throw new Error('Uso: orkestrai device rotate <portrait|portrait_upside_down|landscape_left|landscape_right>');
        body = { command: 'rotate', orientation: values[0] };
      } else if (action === 'install') {
        if (!values[0]) throw new Error('Uso: orkestrai device install <path>');
        body = { command: 'install', path: values.join(' ') };
      } else if (action === 'launch') {
        if (!values[0]) throw new Error('Uso: orkestrai device launch <bundleId|package/activity>');
        body = { command: 'launch', bundleId: values[0] };
      } else if (action === 'permissions') {
        const [permissionAction, permission, bundleId] = values;
        if (!permissionAction) throw new Error('Uso: orkestrai device permissions <list|grant|revoke|reset> [permission] [bundleId]');
        body = { command: 'permissions', action: permissionAction, permission, bundleId, value: flags.value };
      } else if (action === 'logs') body = { command: 'logs', minutes: Number(flags.minutes ?? 2) };
      else if (action === 'tree') body = { command: 'tree' };
      else if (action === 'screenshot') body = { command: 'screenshot' };
      else throw new Error('Uso: orkestrai device <list|attach|tap|swipe|pinch|type|button|rotate|install|launch|permissions|logs|tree|screenshot|stop> ...');
      const data = await bridge(config, 'POST', '/api/agent-room/bridge/devices', body);
      if (flags.json || data.result) out(JSON.stringify(data.result ?? data.snapshot, null, 2));
      else out(data.snapshot?.session ? `Dispositivo ativo: ${data.snapshot.session.deviceName}` : 'Dispositivo parado.');
      return 0;
    }
    case 'fs': {
      const [action, ...values] = rest;
      if (action === 'read') {
        const path = values.join(' ');
        if (!path) throw new Error('Uso: orkestrai fs read <path>');
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/fs/read?path=${encodeURIComponent(path)}`);
        out(data.content ?? '');
        return 0;
      }
      if (action === 'write') {
        const path = values[0];
        const content = values.slice(1).join(' ');
        if (!path || !content) throw new Error('Uso: orkestrai fs write <path> <conteudo>');
        await bridge(config, 'POST', '/api/agent-room/bridge/fs/write', { path, content });
        out(`Escrito: ${path}`);
        return 0;
      }
      if (action === 'search') {
        const query = values.join(' ');
        if (!query) throw new Error('Uso: orkestrai fs search <termo> [--content]');
        const byContent = flags.content ? '&content=1' : '';
        const data = await bridge(config, 'GET', `/api/agent-room/bridge/fs/search?q=${encodeURIComponent(query)}${byContent}`);
        const hits = Array.isArray(data) ? data : (data.results ?? []);
        for (const hit of hits) out(`${hit.path}${hit.line ? `:${hit.line}` : ''}${hit.preview ? `  ${hit.preview}` : ''}`);
        if (!hits.length) out('(nada encontrado)');
        return 0;
      }
      throw new Error('Uso: orkestrai fs <read|write|search> ...');
    }
    case 'say': {
      const text = rest.join(' ');
      if (!text) throw new Error('Uso: orkestrai say "<texto>"');
      await bridge(config, 'POST', '/api/agent-room/bridge/say', { text });
      out('Falado no desktop.');
      return 0;
    }
    case 'run': {
      const taskId = rest[0];
      if (!taskId) throw new Error('Uso: orkestrai run <taskId>');
      await bridge(config, 'POST', `/api/agent-room/bridge/tasks/${taskId}/dispatch`, {});
      out('Tarefa re-despachada para o responsavel.');
      return 0;
    }
    case 'notes':
    case 'portals': {
      const query = selfAgent ? `?agentNodeId=${encodeURIComponent(selfAgent)}` : '';
      const data = command === 'notes'
        ? await bridge(config, 'GET', `/api/agent-room/bridge/notes${query}`)
        : await bridge(config, 'GET', `/api/agent-room/bridge/agents${query}`);
      const items = command === 'notes'
        ? (Array.isArray(data) ? data : (data.notes ?? []))
        : (data.portals ?? []);
      for (const item of items) {
        const connection = command === 'portals' && item.connected !== null && item.connected !== undefined
          ? (item.connected ? ' [conectado]' : ' [disponivel no workspace]')
          : '';
        out(`- ${item.title} (${item.id ?? item.nodeId})${item.url ? ` ${item.url}` : ''}${connection}`);
      }
      if (!items.length) out(command === 'notes' ? '(sem notas)' : '(sem portais)');
      return 0;
    }
    case 'clip': {
      // Le a area de transferencia LOCAL (onde o agente roda), sem bridge.
      const attempts =
        process.platform === 'darwin'
          ? [['pbpaste', []]]
          : process.platform === 'win32'
            ? [['powershell', ['-command', 'Get-Clipboard']]]
            : [['xclip', ['-selection', 'clipboard', '-o']], ['xsel', ['--clipboard', '--output']]];
      for (const [bin, args] of attempts) {
        try {
          const text = execFileSync(bin, args, { encoding: 'utf8', timeout: 5_000 }).trim();
          out(text || '(area de transferencia vazia)');
          return 0;
        } catch {
          // proxima tentativa
        }
      }
      throw new Error('Nao consegui ler a area de transferencia (sem pbpaste/xclip/xsel/powershell).');
    }
    default:
      out(USAGE);
      return 1;
  }
}
