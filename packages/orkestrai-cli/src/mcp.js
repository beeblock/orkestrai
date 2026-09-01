/**
 * Servidor MCP (Model Context Protocol) do Orkestrai — stdio, JSON-RPC 2.0
 * NDJSON (uma mensagem JSON por linha, como manda a spec de transporte stdio
 * do MCP). Expoe as acoes do canvas como TOOLS nativas e tipadas para
 * qualquer agente que fala MCP (Claude Code, Kimi etc.) — em vez de parsear
 * saida de shell.
 *
 * Entrada tolera AMBOS os framings (NDJSON e Content-Length estilo LSP —
 * este ultimo existia na primeira versao; clientes oficiais usam NDJSON).
 * Saida e sempre NDJSON.
 *
 * Sem dependencias: protocolo minimo (initialize, ping, tools/list,
 * tools/call) sobre a bridge HTTP existente (token do workspace).
 */

import { DESIGN_REFERENCE_TOPICS, designReference } from './design-reference.js';
import { apiClientReference } from './api-client-reference.js';

const PROTOCOL_VERSION = '2024-11-05';

const DESIGN_ELEMENT_PROPERTIES = {
  id: { type: 'string', format: 'uuid' }, parentId: { type: ['string', 'null'], format: 'uuid' },
  type: { type: 'string', enum: ['frame', 'group', 'rectangle', 'ellipse', 'text', 'path', 'image'] }, name: { type: 'string' },
  x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 }, order: { type: 'integer', minimum: 0 },
  rotation: { type: 'number' }, opacity: { type: 'number', minimum: 0, maximum: 1 }, visible: { type: 'boolean' }, locked: { type: 'boolean' },
  fill: { type: 'string' }, stroke: { type: 'string' }, strokeWidth: { type: 'number', minimum: 0 }, fills: { type: 'array', items: { type: 'object' } }, strokes: { type: 'array', items: { type: 'object' } }, effects: { type: 'array', items: { type: 'object' } },
  blendMode: { type: 'string', enum: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] }, cornerRadius: { type: 'number', minimum: 0 },
  text: { type: 'string' }, fontSize: { type: 'number' }, fontWeight: { type: 'integer' }, textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
  accessibilityRole: { type: 'string', enum: ['none', 'button', 'link', 'heading', 'image', 'text', 'input', 'navigation', 'region'] }, accessibilityLabel: { type: ['string', 'null'] }, decorative: { type: 'boolean' },
  pathPoints: { type: 'array', items: { type: 'object' } }, pathSubpaths: { type: 'array', items: { type: 'array', items: { type: 'object' } } }, pathClosed: { type: 'boolean' }, fillRule: { type: 'string', enum: ['nonzero', 'evenodd'] },
  assetId: { type: ['string', 'null'], format: 'uuid' }, imageFit: { type: 'string', enum: ['fill', 'contain', 'cover'] }, maskId: { type: ['string', 'null'], format: 'uuid' }, isMask: { type: 'boolean' },
  layoutMode: { type: 'string', enum: ['none', 'horizontal', 'vertical', 'grid'] }, layoutWrap: { type: 'boolean' }, layoutGap: { type: 'number' }, layoutRowGap: { type: 'number' }, layoutColumnGap: { type: 'number' },
  layoutPaddingTop: { type: 'number' }, layoutPaddingRight: { type: 'number' }, layoutPaddingBottom: { type: 'number' }, layoutPaddingLeft: { type: 'number' }, layoutGridColumns: { type: 'integer' }, layoutAlign: { type: 'string', enum: ['start', 'center', 'end', 'space-between'] }, clipContent: { type: 'boolean' },
  prototypeOverflow: { type: 'string', enum: ['none', 'horizontal', 'vertical', 'both'] }, prototypeFixed: { type: 'boolean' }, constraintHorizontal: { type: 'string', enum: ['left', 'right', 'left-right', 'center', 'scale'] }, constraintVertical: { type: 'string', enum: ['top', 'bottom', 'top-bottom', 'center', 'scale'] }, slotName: { type: ['string', 'null'] },
};

const DESIGN_ELEMENT_INPUT = { type: 'object', properties: DESIGN_ELEMENT_PROPERTIES, required: ['type', 'name', 'x', 'y', 'width', 'height'] };
const DESIGN_BATCH_BASE = {
  nodeId: { type: 'string' }, baseRevision: { type: 'integer', minimum: 0 }, pageId: { type: 'string', format: 'uuid' },
  summary: { type: 'string', minLength: 1, maxLength: 500 }, taskId: { type: 'string', format: 'uuid' },
};

/** Tools expostas (inputSchema JSON Schema). args -> bridge no callTool(). */
const TOOLS = [
  { name: 'list', description: 'Lista agentes e todos os portais do workspace. Cada portal informa explicitamente se esta conectado a este agente.', inputSchema: { type: 'object', properties: {} } },
  { name: 'usage', description: 'Consulta cotas dos providers e a recomendacao de roteamento configurada no no Usage do canvas.', inputSchema: { type: 'object', properties: {} } },
  { name: 'code_graph_status', description: 'Retorna os repositorios registrados, estado da indexacao, diagnosticos e contagens do grafo de codigo do workspace.', inputSchema: { type: 'object', properties: {} } },
  { name: 'code_graph_index', description: 'Indexa sob demanda o codigo dos repositorios aprovados do workspace. Omita projectIds para indexar todos.', inputSchema: { type: 'object', properties: { projectIds: { type: 'array', maxItems: 16, items: { type: 'string', format: 'uuid' } }, force: { type: 'boolean', default: false } } } },
  { name: 'code_graph_search', description: 'Busca simbolos por nome, caminho, assinatura e documentacao. Use antes de ler vizinhanca e impacto.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 120 }, projectId: { type: 'string', format: 'uuid' }, kinds: { type: 'array', items: { type: 'string', enum: ['module', 'namespace', 'class', 'interface', 'type', 'enum', 'function', 'method', 'variable', 'endpoint', 'apiRequest', 'schema', 'gateway', 'resource', 'external', 'evidence'] } }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }, required: ['query'] } },
  { name: 'code_graph_symbol', description: 'Le um simbolo indexado com localizacao, assinatura e metadados sem ler o arquivo inteiro.', inputSchema: { type: 'object', properties: { symbolId: { type: 'string', format: 'uuid' } }, required: ['symbolId'] } },
  { name: 'code_graph_neighbors', description: 'Percorre uma vizinhanca limitada do grafo para entender dependencias, chamadas, contratos e fluxos. Nunca executa consultas arbitrarias.', inputSchema: { type: 'object', properties: { symbolId: { type: 'string', format: 'uuid' }, direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'], default: 'both' }, kinds: { type: 'array', items: { type: 'string', enum: ['contains', 'defines', 'imports', 'exports', 'calls', 'references', 'instantiates', 'inherits', 'implements', 'handles', 'requests', 'matches', 'validates', 'generatedFrom', 'routesTo', 'reads', 'writes', 'queries', 'usesEnv', 'sends', 'receives', 'coveredBy', 'failsAt', 'observedCalls'] } }, depth: { type: 'integer', minimum: 1, maximum: 4, default: 2 }, limit: { type: 'integer', minimum: 10, maximum: 750, default: 250 } }, required: ['symbolId'] } },
  { name: 'code_graph_changes', description: 'Cruza mudancas Git e Floors com o grafo persistido para retornar simbolos afetados, testes provaveis e conflitos logicos limitados.', inputSchema: { type: 'object', properties: { depth: { type: 'integer', minimum: 1, maximum: 3, default: 2 }, limit: { type: 'integer', minimum: 50, maximum: 750, default: 500 } } } },
  { name: 'code_graph_contracts', description: 'Cruza endpoints, chamadas HTTP, requests do API Client, prefixos de gateway, schemas e clientes gerados entre os repositorios aprovados.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 50, maximum: 1000, default: 500 }, includeGraph: { type: 'boolean', default: false } } } },
  { name: 'code_graph_quality', description: 'Retorna achados limitados e explicaveis de duplicacao, ciclos, acoplamento, limites arquiteturais, smells, operacoes sensiveis, codigo possivelmente morto e fluxos de dados.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 50, maximum: 1000, default: 500 }, includeGraph: { type: 'boolean', default: false } } } },
  { name: 'code_graph_semantic_status', description: 'Retorna o estado do indice semantico local, sem enviar codigo para servicos externos.', inputSchema: { type: 'object', properties: {} } },
  { name: 'code_graph_semantic_build', description: 'Constroi sob demanda o indice semantico local da revisao atual. Nao baixa modelo nem envia codigo para fora do dispositivo.', inputSchema: { type: 'object', properties: {} } },
  { name: 'code_graph_semantic_search', description: 'Busca simbolos por intencao no indice semantico local e retorna pontuacao e motivos explicaveis.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 120 }, projectId: { type: 'string', format: 'uuid' }, kinds: { type: 'array', items: { type: 'string', enum: ['module', 'namespace', 'class', 'interface', 'type', 'enum', 'function', 'method', 'variable', 'endpoint', 'apiRequest', 'schema', 'gateway', 'resource', 'external'] } }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } }, required: ['query'] } },
  { name: 'code_graph_evidence', description: 'Lista cobertura, falhas e chamadas observadas importadas para o grafo, incluindo relacoes vistas apenas em runtime.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 50, maximum: 5000, default: 2000 } } } },
  { name: 'code_graph_evidence_import', description: 'Importa LCOV, JUnit, traceback ou JSON estruturado de um caminho relativo a um repositorio aprovado. Persiste apenas evidencias derivadas e limitadas.', inputSchema: { type: 'object', properties: { projectId: { type: 'string', format: 'uuid' }, path: { type: 'string', minLength: 1, maxLength: 1024 }, kind: { type: 'string', enum: ['auto', 'coverage', 'test', 'trace'], default: 'auto' }, label: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['projectId', 'path'] } },
  { name: 'code_graph_handoff', description: 'Transforma um escopo retornado por code_graph_changes em uma review rastreavel do working tree principal ou em uma tarefa Kanban para o lider.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['review', 'task'] }, scopeId: { type: 'string', pattern: '^(workspace|floor:[0-9a-f-]{36})$' }, title: { type: 'string', minLength: 1, maxLength: 160 }, locale: { type: 'string', enum: ['en', 'pt-BR', 'es'], default: 'en' } }, required: ['kind', 'scopeId', 'title'] } },
  { name: 'huddle_list', description: 'Lista huddles e retorna a sessao selecionada com participantes e transcricao.', inputSchema: { type: 'object', properties: { huddleId: { type: 'string', format: 'uuid' } } } },
  { name: 'huddle_say', description: 'Registra uma fala deste agente em um huddle ativo, sem disparar respostas recursivas.', inputSchema: { type: 'object', properties: { huddleId: { type: 'string', format: 'uuid' }, text: { type: 'string', minLength: 1, maxLength: 10000 } }, required: ['huddleId', 'text'] } },
  { name: 'ask', description: 'Envia mensagem a outro agente e aguarda resposta confirmada. So afirme que conversou quando replyConfirmed for true.', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: 'Titulo do agente' }, message: { type: 'string' } }, required: ['agent', 'message'] } },
  { name: 'note_list', description: 'Lista notas acessiveis com nodeId, titulo e previa. Use antes de criar para atualizar a nota existente com note_read, note_write ou note_edit.', inputSchema: { type: 'object', properties: {} } },
  { name: 'note_read', description: 'Le uma nota pelo nodeId.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] } },
  { name: 'note_write', description: 'Substitui o conteudo de uma nota.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, content: { type: 'string' } }, required: ['nodeId', 'content'] } },
  { name: 'note_edit', description: 'Edicao pontual: troca um trecho da nota.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['nodeId', 'oldText', 'newText'] } },
  { name: 'note_create', description: 'Cria uma nota no canvas (conecta ao time por padrao).', inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, connect: { type: 'string', description: 'Titulo de agente ou "all"' } }, required: ['title'] } },
  { name: 'memory_search', description: 'Consulta memoria duravel e suas fontes sob demanda. Use antes de decisoes relevantes; nao trate conversa solta como memoria.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, includeHistory: { type: 'boolean', default: false } } } },
  { name: 'memory_add', description: 'Registra conhecimento duravel com pelo menos uma fonte explicita.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, kind: { type: 'string', enum: ['decision', 'fact', 'preference', 'constraint', 'reference', 'lesson'] }, confidence: { type: 'integer', minimum: 0, maximum: 100 }, pinned: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } }, sources: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: { type: { type: 'string', enum: ['user', 'note', 'task', 'message', 'file', 'url', 'git', 'review', 'council', 'agent'] }, sourceId: { type: ['string', 'null'] }, label: { type: 'string' }, uri: { type: ['string', 'null'] }, excerpt: { type: ['string', 'null'] } }, required: ['type', 'label'] } } }, required: ['title', 'content', 'kind', 'sources'] } },
  { name: 'memory_revise', description: 'Cria uma revisao imutavel. Requer revision e updatedAt obtidos por memory_search para impedir sobrescrita concorrente.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, kind: { type: 'string', enum: ['decision', 'fact', 'preference', 'constraint', 'reference', 'lesson'] }, confidence: { type: 'integer', minimum: 0, maximum: 100 }, pinned: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } }, sources: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object' } }, baseRevision: { type: 'integer', minimum: 1 }, baseUpdatedAt: { type: 'string' } }, required: ['id', 'title', 'content', 'kind', 'sources', 'baseRevision', 'baseUpdatedAt'] } },
  { name: 'memory_archive', description: 'Arquiva uma memoria sem apagar seu historico.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'api_client_list', description: 'Lista os requests salvos em nodes Cliente de API conectados a este agente, sem expor tokens ou senhas.', inputSchema: { type: 'object', properties: {} } },
  { name: 'api_client_reference', description: 'Retorna o contrato, fluxo seguro e exemplos oficiais de scripts Bruno, Postman e Orkestrai para criar colecoes completas sem tentativa e erro.', inputSchema: { type: 'object', properties: {} } },
  { name: 'api_client_read', description: 'Le uma colecao completa conectada, incluindo requests, pastas, runners e scripts. Segredos vem marcados; use o fingerprint ao substituir.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] } },
  { name: 'api_client_import', description: 'Importa e vincula uma colecao Bruno, OpenCollection ou Postman existente dentro do repositorio. Cria um node conectado ou atualiza nodeId, preserva scripts/testes e habilita acompanhamento por padrao.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Caminho relativo ao workspace.' }, kind: { type: 'string', enum: ['auto', 'bruno', 'postman', 'openCollection'], default: 'auto' }, nodeId: { type: 'string' }, title: { type: 'string' }, syncMode: { type: 'string', enum: ['manual', 'watch'], default: 'watch' } }, required: ['path'] } },
  { name: 'api_client_create', description: 'Cria no canvas uma colecao completa conectada ao agente. Consulte api_client_reference para o contrato.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, collection: { type: 'object', description: 'Colecao nativa completa conforme api_client_reference.' } }, required: ['title', 'collection'] } },
  { name: 'api_client_replace', description: 'Substitui atomicamente uma colecao completa e sincroniza a origem vinculada por padrao. Requer o fingerprint retornado por api_client_read e preserva segredos marcados.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseFingerprint: { type: 'string' }, title: { type: 'string' }, collection: { type: 'object', description: 'Colecao nativa completa conforme api_client_reference.' }, syncToSource: { type: 'boolean', default: true } }, required: ['nodeId', 'baseFingerprint', 'collection'] } },
  { name: 'api_client_sync_status', description: 'Compara a colecao do node com sua origem no repositorio sem alterar nada.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] } },
  { name: 'api_client_pull', description: 'Importa mudancas da origem vinculada. Recusa descartar edicoes locais; resolution=filesystem confirma explicitamente essa substituicao.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, resolution: { type: 'string', enum: ['filesystem'] } }, required: ['nodeId'] } },
  { name: 'api_client_push', description: 'Persiste requests, scripts, testes, ambientes e runners na origem Bruno/Postman vinculada. Recusa mudancas externas; resolution=orkestrai confirma explicitamente a substituicao.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, resolution: { type: 'string', enum: ['orkestrai'] } }, required: ['nodeId'] } },
  { name: 'api_client_export', description: 'Exporta a colecao conectada para Bruno ou Postman dentro do workspace, preservando estrutura, scripts e testes do runtime escolhido.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, kind: { type: 'string', enum: ['bruno', 'postman'] }, path: { type: 'string', default: '.orkestrai/exports' } }, required: ['nodeId', 'kind'] } },
  { name: 'api_client_run_runner', description: 'Executa um runner salvo com ordem, ambiente, iteracoes, dados por linha, variaveis encadeadas, testes e politica de parada.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, runnerId: { type: 'string' }, variables: { type: 'object', additionalProperties: { type: 'string' } }, maxExecutions: { type: 'integer', minimum: 1, maximum: 500, default: 100 } }, required: ['nodeId', 'runnerId'] } },
  { name: 'api_client_execute', description: 'Executa um request salvo em um Cliente de API conectado, aplicando variaveis e autenticacao localmente.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, requestId: { type: 'string' }, variables: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['nodeId', 'requestId'] } },
  { name: 'image_workflow_list', description: 'Lista os fluxos nativos operados por Codex ImageGen, suas conexoes, status, resultados e historico.', inputSchema: { type: 'object', properties: {} } },
  { name: 'image_workflow_read', description: 'Le o contrato exato do fluxo e, durante um run, retorna prompt, referenced_image_paths, destinos e chamada de conclusao. Use antes de image_gen.imagegen.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] } },
  { name: 'image_workflow_create', description: 'Cria um fluxo visivel no canvas, conecta este Codex como executor e salva a configuracao inicial sem iniciar a geracao.', inputSchema: { type: 'object', properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 }, prompt: { type: 'string', maxLength: 32000 },
    count: { type: 'integer', minimum: 1, maximum: 10 }, transparentBackground: { type: 'boolean' }, outputDirectory: { type: 'string' }, filePrefix: { type: 'string' },
  } } },
  { name: 'image_workflow_update', description: 'Atualiza titulo, direcao criativa e configuracao de um fluxo conectado sem iniciar a geracao. Use para preparar o plano e aguardar aprovacao.', inputSchema: { type: 'object', properties: {
    nodeId: { type: 'string' }, title: { type: 'string', minLength: 1, maxLength: 120 }, prompt: { type: 'string', maxLength: 32000 },
    count: { type: 'integer', minimum: 1, maximum: 10 }, transparentBackground: { type: 'boolean' }, outputDirectory: { type: 'string' }, filePrefix: { type: 'string' },
  }, required: ['nodeId'] } },
  { name: 'image_workflow_connect', description: 'Conecta ou reordena uma Nota, Imagem ou este proprio Codex no fluxo. order e baseado em zero e define a ordem de contexto/referencia.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, targetNodeId: { type: 'string' }, order: { type: 'integer', minimum: 0, maximum: 99 } }, required: ['nodeId', 'targetNodeId'] } },
  { name: 'image_workflow_disconnect', description: 'Remove uma conexao de contexto, referencia ou executor de um fluxo conectado.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, targetNodeId: { type: 'string' } }, required: ['nodeId', 'targetNodeId'] } },
  { name: 'image_workflow_add_reference', description: 'Adiciona ao canvas uma imagem PNG, JPEG ou WebP existente no workspace e a conecta como referencia ordenada do fluxo.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, path: { type: 'string' }, title: { type: 'string', maxLength: 120 }, order: { type: 'integer', minimum: 0, maximum: 99 } }, required: ['nodeId', 'path'] } },
  { name: 'image_workflow_run', description: 'Assume um fluxo conectado como executor Codex. Retorna os argumentos para a tool nativa image_gen.imagegen; nao pede chave nem chama uma API de imagem pelo app.', inputSchema: { type: 'object', properties: {
    nodeId: { type: 'string' }, prompt: { type: 'string', minLength: 1, maxLength: 32000 },
    count: { type: 'integer', minimum: 1, maximum: 10 }, transparentBackground: { type: 'boolean' },
    outputDirectory: { type: 'string' }, filePrefix: { type: 'string' },
  }, required: ['nodeId'] } },
  { name: 'image_workflow_complete', description: 'Depois de usar image_gen.imagegen e copiar os resultados para os destinos pre-alocados, valida os arquivos e cria os Image nodes com proveniencia.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, runId: { type: 'string' }, outputPaths: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } } }, required: ['nodeId', 'runId', 'outputPaths'] } },
  { name: 'image_workflow_validate', description: 'Valida um output individual antes de concluir o run. Confirma PNG integro e, quando solicitado, alpha real; retorna uma edicao corretiva que deve ser executada somente pela tool nativa image_gen.imagegen, nunca por Python ou manipulacao local de pixels.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, runId: { type: 'string' }, outputPath: { type: 'string' } }, required: ['nodeId', 'runId', 'outputPath'] } },
  { name: 'image_workflow_fail', description: 'Registra uma falha publica e limitada quando a tool nativa nao consegue concluir o run.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, runId: { type: 'string' }, errorCode: { type: 'string', enum: ['image_gen_tool_failed', 'image_gen_output_missing', 'image_gen_cancelled'] } }, required: ['nodeId', 'runId'] } },
  { name: 'image_workflow_cancel', description: 'Cancela a execucao ativa de um fluxo de imagem.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] } },
  { name: 'image_workflow_delete', description: 'Remove do canvas um fluxo controlado por este Codex; uma execucao ativa e invalidada antes da remocao.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] } },
  { name: 'design_list', description: 'Lista Designs, revisoes, progresso, estagnacao e gate visual. stalled = 5 min sem nova revisao; reviewStatus approved vale somente para a revisao atual.', inputSchema: { type: 'object', properties: {} } },
  { name: 'design_read', description: 'Le o scene graph completo de um Design node. Leia antes de alterar e use a revisao retornada.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] } },
  { name: 'design_reference', description: 'Retorna o contrato exato e exemplos para criar Design nativo sem probes, scripts temporarios ou inspecao do app. Consulte uma vez e escreva em lotes.', inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: DESIGN_REFERENCE_TOPICS, default: 'quickstart' } } } },
  { name: 'design_audit', description: 'Audita naming, clipping, overlap, contraste e acessibilidade sem alterar o documento. E uma auditoria estrutural, nunca uma aprovacao de qualidade visual.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] } },
  { name: 'design_apply_template', description: 'Aplica um template nativo completo pelo command bus transacional.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseRevision: { type: 'number' }, templateId: { type: 'string', enum: ['product', 'marketing', 'mobile', 'design-system'] }, taskId: { type: 'string' } }, required: ['nodeId', 'baseRevision', 'templateId'] } },
  { name: 'design_apply_operations', description: 'Aplica operacoes transacionais ao documento: layers, vetores, design system, prototipo, motion, comentarios e propostas. Leia a revisao antes e verifique o resultado depois.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseRevision: { type: 'number' }, operations: { type: 'array', minItems: 1, maxItems: 2000, items: { type: 'object' } }, summary: { type: 'string' }, taskId: { type: 'string' } }, required: ['nodeId', 'baseRevision', 'operations', 'summary'] } },
  { name: 'design_create_elements', description: 'Cria ate 2000 layers em uma unica revisao. Use para frames e telas completas; coordenadas de filhos continuam absolutas. Nao faca uma chamada por layer.', inputSchema: { type: 'object', properties: { ...DESIGN_BATCH_BASE, elements: { type: 'array', minItems: 1, maxItems: 2000, items: DESIGN_ELEMENT_INPUT } }, required: ['nodeId', 'baseRevision', 'pageId', 'elements', 'summary'] } },
  { name: 'design_apply_blueprint', description: 'Aplica layers, tokens, bindings, componentes, prototipo e motion em um unico lote tipado. Prefira esta tool para uma direcao completa e use design_reference para exemplos.', inputSchema: { type: 'object', properties: {
    ...DESIGN_BATCH_BASE,
    elements: { type: 'array', maxItems: 2000, items: DESIGN_ELEMENT_INPUT },
    variableCollections: { type: 'array', maxItems: 100, items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, modes: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } }, required: ['id', 'name'] } }, defaultModeId: { type: 'string', format: 'uuid' }, order: { type: 'integer', minimum: 0 } }, required: ['id', 'name', 'modes'] } },
    variables: { type: 'array', maxItems: 5000, items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, collectionId: { type: 'string', format: 'uuid' }, name: { type: 'string' }, type: { type: 'string', enum: ['color', 'spacing', 'radius', 'font-size', 'font-weight', 'line-height', 'opacity', 'effect', 'breakpoint', 'string', 'boolean'] }, description: { type: 'string' }, values: { type: 'object' }, order: { type: 'integer', minimum: 0 } }, required: ['id', 'collectionId', 'name', 'type', 'values'] } },
    bindings: { type: 'array', maxItems: 10000, items: { type: 'object', properties: { elementId: { type: 'string', format: 'uuid' }, property: { type: 'string', enum: ['fill', 'stroke', 'opacity', 'cornerRadius', 'strokeWidth', 'fontSize', 'fontWeight', 'layoutGap', 'layoutRowGap', 'layoutColumnGap', 'layoutPaddingTop', 'layoutPaddingRight', 'layoutPaddingBottom', 'layoutPaddingLeft', 'effects'] }, variableId: { type: ['string', 'null'], format: 'uuid' } }, required: ['elementId', 'property', 'variableId'] } },
    componentSets: { type: 'array', maxItems: 500, items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, propertyNames: { type: 'array', items: { type: 'string' } }, order: { type: 'integer', minimum: 0 } }, required: ['id', 'name'] } },
    components: { type: 'array', maxItems: 2000, items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, description: { type: 'string' }, rootElementId: { type: 'string', format: 'uuid' }, setId: { type: ['string', 'null'], format: 'uuid' }, variantValues: { type: 'object' }, properties: { type: 'array', items: { type: 'object' } }, key: { type: 'string' } }, required: ['id', 'name', 'rootElementId'] } },
    prototypeFlows: { type: 'array', maxItems: 500, items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, description: { type: 'string' }, startFrameId: { type: 'string', format: 'uuid' }, order: { type: 'integer', minimum: 0 } }, required: ['id', 'name', 'startFrameId'] } },
    prototypeInteractions: { type: 'array', maxItems: 5000, items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sourceElementId: { type: 'string', format: 'uuid' }, trigger: { type: 'object' }, action: { type: 'object' }, transition: { type: 'object' }, order: { type: 'integer', minimum: 0 } }, required: ['id', 'sourceElementId', 'trigger', 'action'] } },
    motionTokens: { type: 'array', maxItems: 500, items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, durationMs: { type: 'integer' }, easing: { type: 'object' }, order: { type: 'integer', minimum: 0 } }, required: ['id', 'name'] } },
    motionTracks: { type: 'array', maxItems: 5000, items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, elementId: { type: 'string', format: 'uuid' }, name: { type: 'string' }, durationMs: { type: 'integer' }, delayMs: { type: 'integer' }, iterations: { type: 'integer' }, direction: { type: 'string' }, fillMode: { type: 'string' }, tokenId: { type: ['string', 'null'], format: 'uuid' }, easing: { type: 'object' }, keyframes: { type: 'array', minItems: 2, items: { type: 'object' } }, order: { type: 'integer', minimum: 0 } }, required: ['id', 'elementId', 'name', 'keyframes'] } },
    presentation: { type: 'object', properties: { defaultFlowId: { type: ['string', 'null'], format: 'uuid' }, background: { type: 'string' }, showDeviceFrame: { type: 'boolean' }, showHotspots: { type: 'boolean' }, showCursor: { type: 'boolean' } } },
  }, required: ['nodeId', 'baseRevision', 'pageId', 'summary'] } },
  { name: 'design_comment', description: 'Cria um comentario rastreavel em uma pagina ou layer, com autoria do agente e suporte a mencoes no texto.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseRevision: { type: 'number' }, pageId: { type: 'string' }, elementId: { type: ['string', 'null'] }, body: { type: 'string' }, taskId: { type: 'string' } }, required: ['nodeId', 'baseRevision', 'pageId', 'body'] } },
  { name: 'design_propose', description: 'Submete operacoes visuais como proposta pendente para revisao humana, sem alterar o design aprovado.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseRevision: { type: 'number' }, title: { type: 'string' }, description: { type: 'string' }, operations: { type: 'array', minItems: 1, maxItems: 2000, items: { type: 'object' } }, floorId: { type: ['string', 'null'] }, councilId: { type: ['string', 'null'] }, taskId: { type: 'string' } }, required: ['nodeId', 'baseRevision', 'title', 'operations'] } },
  { name: 'design_decide_proposal', description: 'Aprova ou rejeita uma proposta visual pendente. A aprovacao aplica as operacoes validadas de forma transacional.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseRevision: { type: 'number' }, proposalId: { type: 'string' }, status: { type: 'string', enum: ['approved', 'rejected'] }, note: { type: ['string', 'null'] }, taskId: { type: 'string' } }, required: ['nodeId', 'baseRevision', 'proposalId', 'status'] } },
  { name: 'design_import_code', description: 'Composicao semantica compacta: transforma HTML/CSS, Svelte, React/JSX ou Vue em layers nativas editaveis. E a opcao preferida para colocar um conceito desktop/mobile visivel em poucos minutos.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseRevision: { type: 'number' }, format: { type: 'string', enum: ['html', 'svelte', 'react', 'vue'] }, name: { type: 'string' }, markup: { type: 'string' }, css: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, parentId: { type: ['string', 'null'] }, summary: { type: 'string' }, taskId: { type: 'string' } }, required: ['nodeId', 'baseRevision', 'format', 'name', 'markup'] } },
  { name: 'design_generate_code_preview', description: 'Gera uma previa sem escrita para Svelar/Svelte, React/Next, Vue ou HTML/Tailwind. Retorna status, conteudo, mappings e hash esperado.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, framework: { type: 'string', enum: ['svelar', 'svelte', 'react', 'next', 'vue', 'html'] }, elementIds: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string' } }, outputPath: { type: 'string' }, componentName: { type: 'string' } }, required: ['nodeId', 'framework', 'elementIds', 'outputPath', 'componentName'] } },
  { name: 'design_generate_code_apply', description: 'Escreve codigo previamente revisado dentro do workspace, rejeita arquivo alterado e vincula o artefato ao documento de design.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseRevision: { type: 'number' }, framework: { type: 'string', enum: ['svelar', 'svelte', 'react', 'next', 'vue', 'html'] }, elementIds: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string' } }, outputPath: { type: 'string' }, componentName: { type: 'string' }, expectedExistingHash: { type: ['string', 'null'] }, summary: { type: 'string' }, taskId: { type: 'string' } }, required: ['nodeId', 'baseRevision', 'framework', 'elementIds', 'outputPath', 'componentName', 'expectedExistingHash'] } },
  { name: 'design_figma_inspect', description: 'Inspeciona um link oficial do Figma e lista paginas/frames importaveis sem alterar o documento.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, url: { type: 'string' } }, required: ['nodeId', 'url'] } },
  { name: 'design_figma_import', description: 'Importa frames do Figma como scene graph nativo, preservando o vinculo para sincronizacao.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, url: { type: 'string' }, sourceNodeIds: { type: 'array', items: { type: 'string' }, minItems: 1 }, baseRevision: { type: 'number' }, targetPageId: { type: 'string' } }, required: ['nodeId', 'url', 'sourceNodeIds', 'baseRevision', 'targetPageId'] } },
  { name: 'design_figma_sync_preview', description: 'Compara Figma e Orkestrai e classifica alteracoes remotas, locais e conflitos antes de escrever.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, linkId: { type: 'string' } }, required: ['nodeId', 'linkId'] } },
  { name: 'design_figma_sync_apply', description: 'Aplica resolucoes seletivas de sincronizacao Figma apos revisar o preview.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, linkId: { type: 'string' }, baseRevision: { type: 'number' }, changes: { type: 'array', items: { type: 'object', properties: { nodeId: { type: 'string' }, resolution: { type: 'string', enum: ['figma', 'local', 'delete'] } }, required: ['nodeId', 'resolution'] } } }, required: ['nodeId', 'linkId', 'baseRevision', 'changes'] } },
  { name: 'design_create_element', description: 'Cria frame, grupo, retangulo, elipse, texto, vetor ou imagem no documento. A operacao falha em revisao antiga, sem sobrescrever trabalho humano.', inputSchema: { type: 'object', properties: {
    nodeId: { type: 'string' }, baseRevision: { type: 'number' }, pageId: { type: 'string' }, parentId: { type: ['string', 'null'] },
    type: { type: 'string', enum: ['frame', 'group', 'rectangle', 'ellipse', 'text', 'path', 'image'] }, name: { type: 'string' },
    x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
    fill: { type: 'string' }, stroke: { type: 'string' }, strokeWidth: { type: 'number' }, cornerRadius: { type: 'number' },
    text: { type: 'string' }, fontSize: { type: 'number' }, fontWeight: { type: 'number' }, summary: { type: 'string' }, taskId: { type: 'string' },
  }, required: ['nodeId', 'baseRevision', 'pageId', 'type', 'name', 'x', 'y', 'width', 'height'] } },
  { name: 'design_update_element', description: 'Atualiza propriedades tipadas de um elemento existente no Design node.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseRevision: { type: 'number' }, elementId: { type: 'string' }, changes: { type: 'object' }, summary: { type: 'string' }, taskId: { type: 'string' } }, required: ['nodeId', 'baseRevision', 'elementId', 'changes'] } },
  { name: 'design_delete_element', description: 'Exclui um elemento e seus descendentes do Design node, respeitando lock e revisao.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, baseRevision: { type: 'number' }, elementId: { type: 'string' }, summary: { type: 'string' }, taskId: { type: 'string' } }, required: ['nodeId', 'baseRevision', 'elementId'] } },
  { name: 'task_list', description: 'Lista as tarefas do quadro (kanban) do workspace.', inputSchema: { type: 'object', properties: {} } },
  { name: 'task_columns', description: 'Lista as colunas e chaves validas do kanban.', inputSchema: { type: 'object', properties: {} } },
  { name: 'task_add', description: 'Cria tarefa; com assignee ja despacha para o agente.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string', description: 'Descricao em markdown (checklists, links)' }, assignee: { type: 'string' }, note: { type: 'string', description: 'Nota de spec (id ou titulo)' }, column: { type: 'string', description: 'Chave ou nome da coluna inicial' } }, required: ['title'] } },
  { name: 'task_move', description: 'Move uma tarefa para qualquer coluna do quadro.', inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, column: { type: 'string' } }, required: ['taskId', 'column'] } },
  { name: 'task_done', description: 'Marca tarefa como concluida e faz handoff automatico ao lider.', inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] } },
  { name: 'task_history', description: 'Historico do quadro (concluidas + arquivadas).', inputSchema: { type: 'object', properties: {} } },
  { name: 'portal_create', description: 'Cria um portal somente quando nenhum existente pode ser reutilizado. A mesma URL e idempotente; forceNew exige pedido explicito do usuario.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, connect: { type: 'string' }, forceNew: { type: 'boolean', default: false } }, required: ['url'] } },
  { name: 'portal_navigate', description: 'Abre URL no portal identificado por nome unico ou ID.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string', description: 'Nome unico ou ID do portal.' }, url: { type: 'string' } }, required: ['nodeId', 'url'] } },
  { name: 'portal_eval', description: 'Executa JS no portal identificado por nome unico ou ID e retorna o resultado.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string', description: 'Nome unico ou ID do portal.' }, js: { type: 'string' } }, required: ['nodeId', 'js'] } },
  { name: 'portal_dom', description: 'Devolve o HTML atual do portal identificado por nome unico ou ID.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string', description: 'Nome unico ou ID do portal.' } }, required: ['nodeId'] } },
  { name: 'portal_screenshot', description: 'Captura a tela do portal identificado por nome unico ou ID (base64).', inputSchema: { type: 'object', properties: { nodeId: { type: 'string', description: 'Nome unico ou ID do portal.' } }, required: ['nodeId'] } },
  { name: 'floor_list', description: 'Lista andares (worktrees git) do workspace.', inputSchema: { type: 'object', properties: {} } },
  { name: 'floor_create', description: 'Cria um andar (worktree isolada com branch propria).', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'floor_preview', description: 'Previa da aterrissagem (merge) com conflitos.', inputSchema: { type: 'object', properties: { floorId: { type: 'string' } }, required: ['floorId'] } },
  { name: 'floor_land', description: 'Aterrissa o andar (merge da branch).', inputSchema: { type: 'object', properties: { floorId: { type: 'string' } }, required: ['floorId'] } },
  { name: 'device_list', description: 'Lista simuladores/dispositivos e a sessao Device ativa do workspace.', inputSchema: { type: 'object', properties: {} } },
  { name: 'device_attach', description: 'Inicia ou anexa um device ao painel do Workbench.', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' }, platform: { type: 'string', enum: ['ios', 'android'] } }, required: ['deviceId', 'platform'] } },
  { name: 'device_tap', description: 'Toca coordenadas normalizadas 0..1 no device ativo.', inputSchema: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } }, required: ['x', 'y'] } },
  { name: 'device_swipe', description: 'Desliza entre coordenadas normalizadas no device ativo.', inputSchema: { type: 'object', properties: { fromX: { type: 'number' }, fromY: { type: 'number' }, toX: { type: 'number' }, toY: { type: 'number' }, durationMs: { type: 'number' } }, required: ['fromX', 'fromY', 'toX', 'toY'] } },
  { name: 'device_pinch', description: 'Executa pinch com dois toques em coordenadas normalizadas no device ativo.', inputSchema: { type: 'object', properties: { centerX: { type: 'number', minimum: 0, maximum: 1 }, centerY: { type: 'number', minimum: 0, maximum: 1 }, startDistance: { type: 'number', minimum: 0.02, maximum: 0.9 }, endDistance: { type: 'number', minimum: 0.02, maximum: 0.9 }, durationMs: { type: 'number' } }, required: ['centerX', 'centerY', 'startDistance', 'endDistance'] } },
  { name: 'device_type', description: 'Digita texto no campo focado do device ativo.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'device_button', description: 'Pressiona um botao de sistema do device ativo.', inputSchema: { type: 'object', properties: { button: { type: 'string', enum: ['back', 'home', 'lock', 'app-switcher'] } }, required: ['button'] } },
  { name: 'device_rotate', description: 'Muda a orientacao do device ativo.', inputSchema: { type: 'object', properties: { orientation: { type: 'string', enum: ['portrait', 'portrait_upside_down', 'landscape_left', 'landscape_right'] } }, required: ['orientation'] } },
  { name: 'device_install', description: 'Instala um app do workspace no device ativo.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'device_launch', description: 'Abre um bundle/package no device ativo.', inputSchema: { type: 'object', properties: { bundleId: { type: 'string' } }, required: ['bundleId'] } },
  { name: 'device_logs', description: 'Le logs recentes e limitados do device ativo.', inputSchema: { type: 'object', properties: { minutes: { type: 'number', minimum: 1, maximum: 30 } } } },
  { name: 'device_tree', description: 'Le a arvore de acessibilidade limitada do device ativo.', inputSchema: { type: 'object', properties: {} } },
  { name: 'device_permissions', description: 'Lista ou altera explicitamente uma permissao do app no device ativo.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'grant', 'revoke', 'reset'] }, permission: { type: 'string', enum: ['notifications', 'location', 'camera', 'microphone', 'photos', 'photos-add', 'contacts', 'calendar', 'reminders', 'motion', 'media-library', 'siri', 'speech', 'faceid', 'user-tracking', 'homekit', 'all'] }, bundleId: { type: 'string' }, value: { type: 'string' } }, required: ['action'] } },
  { name: 'device_screenshot', description: 'Salva um screenshot no diretorio .orkestrai do workspace.', inputSchema: { type: 'object', properties: {} } },
  { name: 'device_stop', description: 'Desanexa e limpa o helper do device ativo.', inputSchema: { type: 'object', properties: {} } },
  { name: 'notify', description: 'Notificacao nativa de atencao ou conclusao do projeto. task_done ja notifica tarefas.', inputSchema: { type: 'object', properties: { message: { type: 'string' }, kind: { type: 'string', enum: ['info', 'attention', 'project', 'task'] }, title: { type: 'string' } }, required: ['message'] } },
  { name: 'status', description: 'Registra o estado semantico e a acao atual deste agente no Control Center.', inputSchema: { type: 'object', properties: { state: { type: 'string', enum: ['starting', 'working', 'waiting_input', 'waiting_permission', 'blocked', 'idle', 'done', 'error', 'disconnected'] }, action: { type: 'string' }, taskId: { type: 'string' } }, required: ['state'] } },
  { name: 'port', description: 'Devolve uma porta livre para subir servidores.', inputSchema: { type: 'object', properties: {} } },
  { name: 'recruit', description: '(maestro) Recruta agente novo no canvas. Para composição visual, prefira effort medium ou high; xhigh aumenta muito a latência de payloads estruturados.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, provider: { type: 'string', description: 'Id de um provider registrado no Orkestrai.' }, profile: { type: 'string', description: 'Nome de um perfil de multi-conta desse provider (ver usage). Sem isso, usa a conta padrão.' }, model: { type: 'string' }, effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }, role: { type: 'string' }, floorId: { type: 'string', description: 'Andar ativo onde o agente deve trabalhar.' } }, required: ['title'] } },
  { name: 'dismiss', description: '(maestro) Dispensa um agente.', inputSchema: { type: 'object', properties: { agent: { type: 'string' } }, required: ['agent'] } },
];

/** Mapeia tool -> chamada da bridge (mesmos endpoints da CLI). */
async function callTool(bridge, findFreePort, selfAgent, name, args = {}) {
  switch (name) {
    case 'list': {
      const query = selfAgent ? `?agentNodeId=${encodeURIComponent(selfAgent)}` : '';
      return bridge('GET', `/api/agent-room/bridge/agents${query}`);
    }
    case 'usage':
      return bridge('GET', '/api/agent-room/bridge/usage');
    case 'code_graph_status':
      return bridge('GET', '/api/agent-room/bridge/code-graph');
    case 'code_graph_index':
      return bridge('POST', '/api/agent-room/bridge/code-graph', { projectIds: args.projectIds, force: args.force ?? false });
    case 'code_graph_search': {
      const params = new URLSearchParams({ q: args.query });
      if (args.projectId) params.set('projectId', args.projectId);
      if (args.kinds?.length) params.set('kinds', args.kinds.join(','));
      if (args.limit) params.set('limit', String(args.limit));
      return bridge('GET', `/api/agent-room/bridge/code-graph/search?${params}`);
    }
    case 'code_graph_symbol':
      return bridge('GET', `/api/agent-room/bridge/code-graph/symbols/${encodeURIComponent(args.symbolId)}`);
    case 'code_graph_neighbors': {
      const params = new URLSearchParams();
      if (args.direction) params.set('direction', args.direction);
      if (args.kinds?.length) params.set('kinds', args.kinds.join(','));
      if (args.depth) params.set('depth', String(args.depth));
      if (args.limit) params.set('limit', String(args.limit));
      return bridge('GET', `/api/agent-room/bridge/code-graph/symbols/${encodeURIComponent(args.symbolId)}/graph?${params}`);
    }
    case 'code_graph_changes': {
      const params = new URLSearchParams();
      if (args.depth) params.set('depth', String(args.depth));
      if (args.limit) params.set('limit', String(args.limit));
      return bridge('GET', `/api/agent-room/bridge/code-graph/changes?${params}`);
    }
    case 'code_graph_contracts': {
      const params = new URLSearchParams();
      if (args.limit) params.set('limit', String(args.limit));
      params.set('includeGraph', args.includeGraph ? 'true' : 'false');
      return bridge('GET', `/api/agent-room/bridge/code-graph/contracts?${params}`);
    }
    case 'code_graph_quality': {
      const params = new URLSearchParams();
      if (args.limit) params.set('limit', String(args.limit));
      params.set('includeGraph', args.includeGraph ? 'true' : 'false');
      return bridge('GET', `/api/agent-room/bridge/code-graph/quality?${params}`);
    }
    case 'code_graph_semantic_status':
      return bridge('GET', '/api/agent-room/bridge/code-graph/semantic');
    case 'code_graph_semantic_build':
      return bridge('POST', '/api/agent-room/bridge/code-graph/semantic', { action: 'build' });
    case 'code_graph_semantic_search': {
      const params = new URLSearchParams({ q: args.query });
      if (args.projectId) params.set('projectId', args.projectId);
      if (args.kinds?.length) params.set('kinds', args.kinds.join(','));
      if (args.limit) params.set('limit', String(args.limit));
      return bridge('GET', `/api/agent-room/bridge/code-graph/semantic?${params}`);
    }
    case 'code_graph_evidence': {
      const params = new URLSearchParams();
      if (args.limit) params.set('limit', String(args.limit));
      return bridge('GET', `/api/agent-room/bridge/code-graph/evidence?${params}`);
    }
    case 'code_graph_evidence_import':
      return bridge('POST', '/api/agent-room/bridge/code-graph/evidence', args);
    case 'code_graph_handoff':
      return bridge('POST', '/api/agent-room/bridge/code-graph/handoffs', args);
    case 'huddle_list': {
      const huddleId = /** @type {{ huddleId?: string }} */ (args).huddleId;
      return bridge('GET', `/api/agent-room/bridge/huddles${huddleId ? `?selected=${encodeURIComponent(huddleId)}` : ''}`);
    }
    case 'huddle_say': {
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      const input = /** @type {{ huddleId: string, text: string }} */ (args);
      return bridge('POST', `/api/agent-room/bridge/huddles/${encodeURIComponent(input.huddleId)}/turns`, { from: selfAgent, text: input.text });
    }
    case 'ask':
      return bridge('POST', '/api/agent-room/bridge/ask', { to: args.agent, message: args.message, from: selfAgent });
    case 'note_list': {
      const query = selfAgent ? `?agentNodeId=${encodeURIComponent(selfAgent)}` : '';
      return bridge('GET', `/api/agent-room/bridge/notes${query}`);
    }
    case 'note_read':
      return bridge('GET', `/api/agent-room/bridge/notes/${encodeURIComponent(args.nodeId)}`);
    case 'note_write':
      return bridge('PUT', `/api/agent-room/bridge/notes/${encodeURIComponent(args.nodeId)}`, { content: args.content });
    case 'note_edit':
      return bridge('PATCH', `/api/agent-room/bridge/notes/${encodeURIComponent(args.nodeId)}`, { old: args.oldText, new: args.newText });
    case 'note_create':
      return bridge('POST', '/api/agent-room/bridge/notes', { title: args.title, content: args.content, connect: args.connect ?? 'all', from: selfAgent });
    case 'memory_search': {
      const params = new URLSearchParams();
      if (args.query) params.set('q', args.query);
      if (args.includeHistory) params.set('history', '1');
      return bridge('GET', `/api/agent-room/bridge/memory?${params}`);
    }
    case 'memory_add':
      return bridge('POST', '/api/agent-room/bridge/memory', { ...args, confidence: args.confidence ?? 100, pinned: args.pinned ?? false, tags: args.tags ?? [], createdByNodeId: selfAgent?.length === 36 ? selfAgent : null });
    case 'memory_revise': {
      const { id, ...body } = args;
      return bridge('PATCH', `/api/agent-room/bridge/memory/${encodeURIComponent(id)}`, { ...body, confidence: body.confidence ?? 100, pinned: body.pinned ?? false, tags: body.tags ?? [], createdByNodeId: selfAgent?.length === 36 ? selfAgent : null });
    }
    case 'memory_archive':
      return bridge('DELETE', `/api/agent-room/bridge/memory/${encodeURIComponent(args.id)}`);
    case 'api_client_list': {
      const query = selfAgent ? `?agentNodeId=${encodeURIComponent(selfAgent)}` : '';
      return bridge('GET', `/api/agent-room/bridge/api-clients${query}`);
    }
    case 'api_client_reference':
      return apiClientReference();
    case 'api_client_read':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('GET', `/api/agent-room/bridge/api-clients/${encodeURIComponent(args.nodeId)}?agentNodeId=${encodeURIComponent(selfAgent ?? '')}`);
    case 'api_client_import':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', '/api/agent-room/bridge/api-clients/import', { path: args.path, kind: args.kind ?? 'auto', nodeId: args.nodeId, title: args.title, syncMode: args.syncMode ?? 'watch', from: selfAgent });
    case 'api_client_create':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', '/api/agent-room/bridge/api-clients', { title: args.title, collection: args.collection, from: selfAgent });
    case 'api_client_replace':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('PUT', `/api/agent-room/bridge/api-clients/${encodeURIComponent(args.nodeId)}`, { title: args.title, baseFingerprint: args.baseFingerprint, collection: args.collection, syncToSource: args.syncToSource ?? true, from: selfAgent });
    case 'api_client_sync_status':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(args.nodeId)}/sync`, { action: 'status', from: selfAgent });
    case 'api_client_pull':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(args.nodeId)}/sync`, { action: 'pull', resolution: args.resolution, from: selfAgent });
    case 'api_client_push':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(args.nodeId)}/sync`, { action: 'push', resolution: args.resolution, from: selfAgent });
    case 'api_client_export':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(args.nodeId)}/export`, { kind: args.kind, path: args.path ?? '.orkestrai/exports', from: selfAgent });
    case 'api_client_run_runner':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(args.nodeId)}/runners/${encodeURIComponent(args.runnerId)}/execute`, { variables: args.variables ?? {}, maxExecutions: args.maxExecutions ?? 100, from: selfAgent });
    case 'api_client_execute':
      return bridge('POST', `/api/agent-room/bridge/api-clients/${encodeURIComponent(args.nodeId)}/execute`, { requestId: args.requestId, variables: args.variables ?? {}, from: selfAgent });
    case 'image_workflow_list':
      return bridge('GET', '/api/agent-room/bridge/image-workflows');
    case 'image_workflow_read':
      return bridge('GET', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(args.nodeId)}`);
    case 'image_workflow_create': {
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', '/api/agent-room/bridge/image-workflows', { ...args, from: selfAgent });
    }
    case 'image_workflow_update': {
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      const { nodeId, ...updates } = args;
      return bridge('PATCH', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}`, { ...updates, from: selfAgent });
    }
    case 'image_workflow_connect':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(args.nodeId)}/connections`, { targetNodeId: args.targetNodeId, order: args.order, from: selfAgent });
    case 'image_workflow_disconnect':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('DELETE', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(args.nodeId)}/connections`, { targetNodeId: args.targetNodeId, from: selfAgent });
    case 'image_workflow_add_reference':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(args.nodeId)}/references`, { path: args.path, title: args.title, order: args.order, from: selfAgent });
    case 'image_workflow_run': {
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      const { nodeId, ...overrides } = args;
      return bridge('POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(nodeId)}`, { ...overrides, from: selfAgent });
    }
    case 'image_workflow_complete':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(args.nodeId)}/complete`, { runId: args.runId, outputPaths: args.outputPaths, from: selfAgent });
    case 'image_workflow_validate':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(args.nodeId)}/validate`, { runId: args.runId, outputPath: args.outputPath, from: selfAgent });
    case 'image_workflow_fail':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(args.nodeId)}/fail`, { runId: args.runId, errorCode: args.errorCode ?? 'image_gen_tool_failed', from: selfAgent });
    case 'image_workflow_cancel':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('DELETE', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(args.nodeId)}`, { from: selfAgent });
    case 'image_workflow_delete':
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', `/api/agent-room/bridge/image-workflows/${encodeURIComponent(args.nodeId)}/remove`, { from: selfAgent });
    case 'design_list':
      return bridge('GET', '/api/agent-room/bridge/designs');
    case 'design_read':
      return bridge('GET', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}`);
    case 'design_reference':
      return designReference(args.topic ?? 'quickstart');
    case 'design_audit':
      return bridge('GET', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}/quality`);
    case 'design_apply_template':
      return bridge('POST', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}/quality`, {
        baseRevision: args.baseRevision,
        templateId: args.templateId,
        from: selfAgent,
        taskId: args.taskId,
      });
    case 'design_apply_operations':
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}`, {
        baseRevision: args.baseRevision,
        operations: args.operations,
        summary: args.summary,
        from: selfAgent,
        taskId: args.taskId,
      });
    case 'design_create_elements':
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}`, {
        baseRevision: args.baseRevision,
        operations: args.elements.map((element) => ({ kind: 'create', element: { ...element, pageId: args.pageId, parentId: element.parentId ?? null } })),
        summary: args.summary,
        from: selfAgent,
        taskId: args.taskId,
      });
    case 'design_apply_blueprint': {
      const now = new Date().toISOString();
      const operations = [
        ...(args.elements ?? []).map((element) => ({ kind: 'create', element: { ...element, pageId: args.pageId, parentId: element.parentId ?? null } })),
        ...(args.variableCollections ?? []).map((collection, order) => ({ kind: 'add-variable-collection', collection: { ...collection, defaultModeId: collection.defaultModeId ?? collection.modes[0]?.id, order: collection.order ?? order } })),
        ...(args.variables ?? []).map((variable, order) => ({ kind: 'add-variable', variable: { ...variable, description: variable.description ?? '', order: variable.order ?? order } })),
        ...(args.bindings ?? []).map((binding) => ({ kind: 'bind-variable', ...binding })),
        ...(args.componentSets ?? []).map((componentSet, order) => ({ kind: 'add-component-set', componentSet: { ...componentSet, propertyNames: componentSet.propertyNames ?? [], order: componentSet.order ?? order } })),
        ...(args.components ?? []).map((component) => ({ kind: 'add-component', component: { ...component, description: component.description ?? '', setId: component.setId ?? null, variantValues: component.variantValues ?? {}, properties: component.properties ?? [], key: component.key ?? component.id, updatedAt: now } })),
        ...(args.prototypeFlows ?? []).map((flow, order) => ({ kind: 'add-prototype-flow', flow: { ...flow, description: flow.description ?? '', order: flow.order ?? order } })),
        ...(args.prototypeInteractions ?? []).map((interaction, order) => ({ kind: 'add-prototype-interaction', interaction: { ...interaction, order: interaction.order ?? order } })),
        ...(args.motionTokens ?? []).map((token, order) => ({ kind: 'add-motion-token', token: { ...token, order: token.order ?? order } })),
        ...(args.motionTracks ?? []).map((track, order) => ({ kind: 'add-motion-track', track: { ...track, order: track.order ?? order } })),
        ...(args.presentation ? [{ kind: 'update-presentation', changes: args.presentation }] : []),
      ];
      if (!operations.length) throw new Error('design_apply_blueprint needs at least one element, token, component, prototype, motion item, binding, or presentation change.');
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}`, {
        baseRevision: args.baseRevision,
        operations,
        summary: args.summary,
        from: selfAgent,
        taskId: args.taskId,
      });
    }
    case 'design_comment': {
      const now = new Date().toISOString();
      const author = { kind: 'agent', id: selfAgent || 'agent', name: selfAgent || 'Agent', color: '#059669' };
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}`, {
        baseRevision: args.baseRevision,
        operations: [{ kind: 'add-design-comment', comment: {
          id: crypto.randomUUID(), pageId: args.pageId, elementId: args.elementId ?? null,
          x: null, y: null, status: 'open', messages: [{ id: crypto.randomUUID(), author, body: args.body, mentions: [], createdAt: now }],
          createdAt: now, updatedAt: now, resolvedAt: null, resolvedBy: null,
        } }],
        summary: 'Agent design comment', from: selfAgent, taskId: args.taskId,
      });
    }
    case 'design_propose': {
      const now = new Date().toISOString();
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}`, {
        baseRevision: args.baseRevision,
        operations: [{ kind: 'add-design-proposal', proposal: {
          id: crypto.randomUUID(), title: args.title, description: args.description ?? '',
          author: { kind: 'agent', id: selfAgent || 'agent', name: selfAgent || 'Agent', color: '#059669' },
          baseRevision: args.baseRevision, operations: args.operations, status: 'pending',
          floorId: args.floorId ?? null, councilId: args.councilId ?? null,
          createdAt: now, updatedAt: now, decidedAt: null, decidedBy: null, decisionNote: null,
        } }],
        summary: `Agent design proposal: ${args.title}`, from: selfAgent, taskId: args.taskId,
      });
    }
    case 'design_decide_proposal':
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}`, {
        baseRevision: args.baseRevision,
        operations: [{ kind: 'decide-design-proposal', proposalId: args.proposalId, status: args.status,
          actor: { kind: 'agent', id: selfAgent || 'agent', name: selfAgent || 'Agent', color: '#059669' }, note: args.note ?? null }],
        summary: `Agent design proposal ${args.status}`, from: selfAgent, taskId: args.taskId,
      });
    case 'design_import_code':
      return bridge('POST', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}/delivery/import`, {
        baseRevision: args.baseRevision,
        format: args.format,
        name: args.name,
        markup: args.markup,
        css: args.css ?? '',
        x: args.x ?? 80,
        y: args.y ?? 80,
        parentId: args.parentId ?? null,
        summary: args.summary,
        from: selfAgent,
        taskId: args.taskId,
      });
    case 'design_generate_code_preview':
      return bridge('POST', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}/delivery/preview`, {
        framework: args.framework,
        elementIds: args.elementIds,
        outputPath: args.outputPath,
        componentName: args.componentName,
      });
    case 'design_generate_code_apply':
      return bridge('POST', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}/delivery/apply`, {
        baseRevision: args.baseRevision,
        framework: args.framework,
        elementIds: args.elementIds,
        outputPath: args.outputPath,
        componentName: args.componentName,
        expectedExistingHash: args.expectedExistingHash,
        summary: args.summary,
        from: selfAgent,
        taskId: args.taskId,
      });
    case 'design_figma_inspect':
      return bridge('POST', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}/figma/inspect`, { url: args.url });
    case 'design_figma_import':
      return bridge('POST', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}/figma/import`, { url: args.url, sourceNodeIds: args.sourceNodeIds, baseRevision: args.baseRevision, targetPageId: args.targetPageId });
    case 'design_figma_sync_preview':
      return bridge('POST', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}/figma/sync`, { linkId: args.linkId });
    case 'design_figma_sync_apply':
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}/figma/sync`, { linkId: args.linkId, baseRevision: args.baseRevision, changes: args.changes });
    case 'design_create_element': {
      const { nodeId, baseRevision, summary, taskId, ...element } = args;
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(nodeId)}`, {
        baseRevision,
        operations: [{ kind: 'create', element: { ...element, parentId: element.parentId ?? null } }],
        summary: summary ?? `Create ${element.type} ${element.name}`,
        from: selfAgent,
        taskId,
      });
    }
    case 'design_update_element':
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}`, {
        baseRevision: args.baseRevision,
        operations: [{ kind: 'update', elementId: args.elementId, changes: args.changes }],
        summary: args.summary ?? `Update design element ${args.elementId}`,
        from: selfAgent,
        taskId: args.taskId,
      });
    case 'design_delete_element':
      return bridge('PATCH', `/api/agent-room/bridge/designs/${encodeURIComponent(args.nodeId)}`, {
        baseRevision: args.baseRevision,
        operations: [{ kind: 'delete', elementId: args.elementId }],
        summary: args.summary ?? `Delete design element ${args.elementId}`,
        from: selfAgent,
        taskId: args.taskId,
      });
    case 'task_list':
      return bridge('GET', '/api/agent-room/bridge/tasks');
    case 'task_columns':
      return bridge('GET', '/api/agent-room/bridge/task-columns');
    case 'task_add':
      return bridge('POST', '/api/agent-room/bridge/tasks', { title: args.title, description: args.description, assignee: args.assignee, note: args.note, status: args.column, from: selfAgent });
    case 'task_move':
      return bridge('PATCH', `/api/agent-room/bridge/tasks/${encodeURIComponent(args.taskId)}`, { status: args.column });
    case 'task_done':
      return bridge('PATCH', `/api/agent-room/bridge/tasks/${encodeURIComponent(args.taskId)}`, { status: 'done', from: selfAgent });
    case 'task_history':
      return bridge('GET', '/api/agent-room/bridge/tasks/history');
    case 'portal_create': {
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente) — crie o portal pelo canvas ou pela CLI dentro do terminal de um agente.');
      return bridge('POST', '/api/agent-room/bridge/portal/create', { url: args.url, title: args.title, connect: args.connect, forceNew: args.forceNew === true, from: selfAgent });
    }
    case 'portal_navigate':
      return bridge('POST', '/api/agent-room/bridge/portal', { nodeId: args.nodeId, action: 'navigate', args: { url: args.url } });
    case 'portal_eval':
      return bridge('POST', '/api/agent-room/bridge/portal', { nodeId: args.nodeId, action: 'eval', args: { js: args.js } });
    case 'portal_dom':
      return bridge('POST', '/api/agent-room/bridge/portal', { nodeId: args.nodeId, action: 'dom', args: {} });
    case 'portal_screenshot':
      return bridge('POST', '/api/agent-room/bridge/portal', { nodeId: args.nodeId, action: 'screenshot', args: {} });
    case 'floor_list':
      return bridge('GET', '/api/agent-room/bridge/floors');
    case 'floor_create':
      return bridge('POST', '/api/agent-room/bridge/floors', { name: args.name });
    case 'floor_preview':
      return bridge('GET', `/api/agent-room/bridge/floors/${encodeURIComponent(args.floorId)}/preview`);
    case 'floor_land':
      return bridge('POST', `/api/agent-room/bridge/floors/${encodeURIComponent(args.floorId)}/land`, {});
    case 'device_list':
      return bridge('GET', '/api/agent-room/bridge/devices');
    case 'device_attach':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'start', deviceId: args.deviceId, platform: args.platform });
    case 'device_tap':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'tap', x: args.x, y: args.y });
    case 'device_swipe':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'swipe', fromX: args.fromX, fromY: args.fromY, toX: args.toX, toY: args.toY, durationMs: args.durationMs ?? 300 });
    case 'device_pinch':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'pinch', centerX: args.centerX, centerY: args.centerY, startDistance: args.startDistance, endDistance: args.endDistance, durationMs: args.durationMs ?? 300 });
    case 'device_type':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'type', text: args.text });
    case 'device_button':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'button', button: args.button });
    case 'device_rotate':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'rotate', orientation: args.orientation });
    case 'device_install':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'install', path: args.path });
    case 'device_launch':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'launch', bundleId: args.bundleId });
    case 'device_logs':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'logs', minutes: args.minutes ?? 2 });
    case 'device_tree':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'tree' });
    case 'device_permissions':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'permissions', action: args.action, permission: args.permission, bundleId: args.bundleId, value: args.value });
    case 'device_screenshot':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'screenshot' });
    case 'device_stop':
      return bridge('POST', '/api/agent-room/bridge/devices', { command: 'stop' });
    case 'notify':
      return bridge('POST', '/api/agent-room/bridge/notify', { message: args.message, kind: args.kind, title: args.title, from: selfAgent });
    case 'status': {
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente).');
      return bridge('POST', '/api/agent-room/bridge/activity', { from: selfAgent, state: args.state, action: args.action, taskId: args.taskId });
    }
    case 'port':
      return { port: await findFreePort() };
    case 'recruit': {
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente) — recruit so funciona dentro do terminal do maestro.');
      return bridge('POST', '/api/agent-room/bridge/recruit', { title: args.title, provider: args.provider, profile: args.profile, model: args.model, effort: args.effort, role: args.role, floorId: args.floorId, from: selfAgent });
    }
    case 'dismiss': {
      if (!selfAgent) throw new Error('identidade do agente desconhecida (ORKESTRAI_NODE_ID ausente) — dismiss so funciona dentro do terminal do maestro.');
      return bridge('POST', '/api/agent-room/bridge/dismiss', { target: args.agent, from: selfAgent });
    }
    default:
      throw new Error(`Tool desconhecida: ${name}`);
  }
}

/** Envia uma mensagem JSON-RPC em NDJSON (spec stdio do MCP: 1 JSON por linha). */
function writeMessage(write, message) {
  write(`${JSON.stringify(message)}\n`);
}

/**
 * Loop principal do servidor MCP. Io injetavel para testes:
 * input = stream legivel (stdin), write = funcao de escrita (stdout).
 * bridge = (method, path, body) => Promise<data> ja autenticada.
 *
 * @param {{
 *   input: import('node:stream').Readable,
 *   write: (chunk: string) => void,
 *   bridge: (method: string, path: string, body?: any) => Promise<any>,
 *   findFreePort: () => Promise<number>,
 *   selfAgent?: string | null,
 *   version?: string,
 * }} options
 */
export async function runMcpServer(options) {
  const { input, write, bridge, findFreePort, selfAgent = null, version = '0.0.1' } = options;
  let buffer = Buffer.alloc(0);
  const pending = [];
  let waiter = null;
  let ended = false;

  const pump = () => {
    for (;;) {
      // Framing LSP legado (Content-Length) — tolerado na entrada.
      if (buffer.subarray(0, 15).toString('utf8').startsWith('Content-Length')) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1] ?? 0);
        if (!length) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }
        if (buffer.length < headerEnd + 4 + length) return;
        const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8');
        buffer = buffer.subarray(headerEnd + 4 + length);
        try {
          pending.push(JSON.parse(body));
        } catch {
          // mensagem quebrada — ignora
        }
        waiter?.();
        continue;
      }
      // NDJSON (spec stdio do MCP): uma mensagem por linha.
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd === -1) return;
      const line = buffer.subarray(0, lineEnd).toString('utf8').trim();
      buffer = buffer.subarray(lineEnd + 1);
      if (!line) continue;
      try {
        pending.push(JSON.parse(line));
      } catch {
        // linha quebrada — ignora
      }
      waiter?.();
    }
  };

  input.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    pump();
  });
  const markEnded = () => {
    ended = true;
    waiter?.();
  };
  input.on('end', markEnded);
  input.on('close', markEnded);

  const nextMessage = () =>
    new Promise((resolveNext) => {
      if (pending.length) return resolveNext(pending.shift());
      if (ended) return resolveNext(null);
      waiter = () => {
        waiter = null;
        resolveNext(pending.length ? pending.shift() : null);
      };
      pump();
    });

  input.resume?.();

  for (;;) {
    const message = await nextMessage();
    if (!message) {
      if (ended) break; // stdin fechou: encerra limpo (clients e testes)
      continue;
    }
    // Notificacoes (sem id) nao tem resposta.
    if (message.id === undefined || message.id === null) continue;
    const reply = (result) => writeMessage(write, { jsonrpc: '2.0', id: message.id, result });
    const fail = (error) =>
      writeMessage(write, { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
    try {
      if (message.method === 'initialize') {
        reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'orkestrai', version },
        });
      } else if (message.method === 'ping') {
        reply({});
      } else if (message.method === 'tools/list') {
        reply({ tools: TOOLS });
      } else if (message.method === 'tools/call') {
        const { name, arguments: toolArgs } = message.params ?? {};
        try {
          const data = await callTool(bridge, findFreePort, selfAgent, name, toolArgs);
          reply({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
        } catch (error) {
          reply({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
        }
      } else {
        writeMessage(write, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Metodo nao suportado: ${message.method}` } });
      }
    } catch (error) {
      fail(error);
    }
  }
}

export const MCP_TOOLS = TOOLS;
