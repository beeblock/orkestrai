import type { DocsCatalog } from './types.js';

/**
 * Conteudo da pagina /docs em pt-BR. Para alterar o conteudo, edite aqui e
 * replique a MESMA estrutura (ids, ordem, quantidade de itens) em en.js e es.js.
 * Os ids das secoes sao estaveis entre locales (viram ancora na URL).
 */
export const DOCS_PT: DocsCatalog = {
  quickstart: [
    'Crie um workspace (botão + na barra lateral) apontando para a pasta do seu projeto.',
    'Abra Agentes na barra inferior, escolha um serviço disponível e arraste um retângulo no canvas — nomeie, escolha modelo/esforço se quiser e marque Líder se ele vai comandar o time.',
    'Desenhe mais agentes e conecte-os arrastando da bolinha (handle) de um até o outro.',
    'Abra o quadro Tarefas (+ Tarefas), crie cartões e atribua — cada tarefa cai direto no terminal do agente.',
    'Fale com qualquer agente pelo próprio terminal dele, ou deixe o líder distribuir tudo sozinho via CLI orkestrai.',
  ],
  sections: [
    {
      id: 'workspaces',
      title: 'Workspaces',
      body: `Um workspace = uma equipe num projeto: diretório de trabalho, ícone e layout do canvas salvos. Crie com o botão + na barra lateral. Vários workspaces rodam ao mesmo tempo — os agentes continuam vivos em background ao trocar. Instruções em AGENTS.md/CLAUDE.md são injetadas nos agentes (edite no lápis ao lado do nome). O botão ⏻ (Descarregar) encerra os terminais vivos do workspace ativo — libera memória/CPU sem apagar nada: o layout fica salvo e cada agente retoma a conversa ao reabrir o terminal. No macOS, projetos em Downloads, Documentos ou Mesa exigem consentimento do sistema; se o acesso expirar, o Canvas e o Workbench mostram Autorizar pasta para selecionar novamente o mesmo diretório e continuar sem reiniciar o app.`,
    },
    {
      id: 'workspace-folders',
      title: 'Organize workspaces em pastas',
      body: `Agrupe workspaces em pastas na barra lateral quando tiver vários projetos (por cliente, por time, por ambiente). Digite um nome em "Nova pasta" no fim da lista pra criar uma na raiz; arraste um workspace pro cabeçalho de uma pasta pra guardá-lo lá, ou arraste pro espaço vazio da lista pra mandar de volta pra raiz. Um workspace novo também pode nascer já dentro de uma pasta: use o ícone de mais no cabeçalho dela, ou escolha qualquer pasta no campo Pasta do próprio diálogo de novo workspace. Pastas aninham dentro de outras pastas do mesmo jeito, sem limite de profundidade — arraste uma pasta sobre outra pra transformá-la em subpasta, ou use o ícone de "nova subpasta" no cabeçalho de qualquer pasta pra criar uma já dentro dela; uma pasta nunca pode ser solta dentro dela mesma ou de uma subpasta sua. Dê duplo-clique no nome da pasta ou use o ícone de lápis pra renomear, e cada pasta lembra se está recolhida entre reinícios. Apagar uma pasta (ícone de lixeira, com confirmação) nunca é destrutivo: todo workspace e subpasta dentro dela sobe pra raiz em vez de ser removido.`,
    },
    {
      id: 'wsl-runtime',
      title: 'Workspaces Windows com WSL',
      body: `No Windows, o ambiente escolhido ao criar ou editar o workspace é o padrão do time. Cada terminal pode herdá-lo ou, no diálogo de criação e no menu compacto do terminal, escolher Ambiente de execução para forçar Windows nativo ou uma distribuição WSL específica. Selecione exatamente Ubuntu, Ubuntu-22.04, Ubuntu-24.04, Debian ou outra instalação e informe o caminho Linux da mesma pasta do projeto. Assim, um único workspace pode combinar agentes Windows e WSL, inclusive distribuições diferentes. O badge WIN ou WSL identifica uma sobrescrita. Detecção e modelos do provider, PTY, retomada exata da conversa, Council, agentes recrutados e a ponte orkestrai seguem o runtime efetivo de cada terminal. Recrutas do Maestro herdam o andar ativo do líder e só são confirmados depois que a PTY inicia no ambiente correto; uma falha remove o nó incompleto. Ao atribuir uma tarefa, o Orkestrai inicia ou retoma um agente offline e só move o cartão para Fazendo depois de entregar o briefing completo. O Orkestrai valida a CLI naquela distribuição e confirma o transcript do provider dentro da home Linux correspondente antes de persistir ou restaurar um id; um agente vazio começa limpo em vez de adivinhar a conversa mais recente. Trocar o runtime reinicia somente aquele terminal. Distribuição, diretório ou comando ausente gera erros distintos e acionáveis, sem fallback silencioso para Windows nativo.`,
    },
    {
      id: 'agentes',
      title: 'Agentes: criar, nomear, modelo & esforço',
      body: `O menu Agentes na barra inferior lista Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline, Devin e GitHub Copilot sem lotar o canvas. Fixe até quatro favoritos para mantê-los ao lado do menu; a ordem escolhida persiste entre workspaces e reinícios, e um agente fixado indisponível continua salvo sem ocupar a barra. Você não precisa conhecer terminal nem usar todos: comece pelo serviço que já assina ou prefere e combine outro quando quiser uma segunda perspectiva. Agentes que precisam de configuração levam à Central de Providers, também disponível pelo ícone de cabo na barra lateral, Cmd/Ctrl+2 ou pelo menu nativo Workspace. Ao desenhar um agente, o diálogo pergunta nome, modelo e esforço apenas quando o provider oferece essas opções, além de Líder (Modo Maestro). Depois de criado, o menu compacto no cabeçalho reúne troca de provider e perfil, role, uma seleção visual de 15 temas ANSI, recarga com contexto, Modo Maestro e remoção; o título continua editável com duplo-clique. Trocar o provider preserva conexões, role, andar e posição, encerra a conversa anterior e inicia uma sessão limpa.`,
    },
    {
      id: 'provider-center',
      title: 'Central de Providers',
      body: `A Central verifica localmente as nove CLIs compatíveis e separa os agentes prontos daqueles que ainda precisam de configuração. Expanda um provider para ver seu guia oficial, um comando de instalação para seu sistema quando disponível, instruções de login, capacidades detectadas, status público ao vivo quando houver e Perfis nomeados pelo mecanismo documentado de diretório de conta da CLI. O Orkestrai nunca autentica um agente silenciosamente nem armazena credenciais de Perfil nos dados do canvas; o login continua dentro da CLI oficial e os valores do perfil são resolvidos no servidor somente ao iniciar a PTY. Depois de instalar, use Verificar novamente e volte ao canvas.`,
    },
    {
      id: 'roles',
      title: 'Roles (papéis do time)',
      body: `Roles são conjuntos de instruções salvos em .orkestrai/roles/<slug>/role.json — viajam com o repositório. No painel Roles, a aba Catálogo oferece funções completas de liderança, produto, arquitetura, frontend, backend, Svelar, QA, segurança, acessibilidade, documentação, release e performance; instale com + e personalize na aba No workspace. Nos presets, Claude recebe a role como system prompt, Codex como instrução de developer e Kimi pelo arquivo de agente antes da primeira mensagem; outros providers recebem apenas uma referência curta ao AGENTS.md da role, sem colar o prompt longo no terminal. O líder também pode reatribuir roles via orkestrai reassign. "Descobrir em outra pasta..." escolhe qualquer diretório e importa os role.json encontrados dentro de .orkestrai/roles/ ali, permitindo reusar uma role feita num projeto a partir de outro sem parentesco.`,
    },
    {
      id: 'times',
      title: 'Times: paralelo, líder & Loop',
      body: `Todos os agentes rodam em paralelo (processos independentes). A coordenação é por conexões: agente pergunta a agente com orkestrai ask, ou o Líder (★ Maestro) distribui com task/ask e recruta/demite com recruit/dismiss. O nó Loop Ralph é o modo sequencial: líder planeja → engenheiro implementa → tester revisa, até N rodadas. Rotinas disparam prompts agendados em qualquer terminal.`,
    },
    {
      id: 'council',
      title: 'Council: compare perspectivas independentes',
      body: `Abra Conselho diretamente na barra do Canvas, no topo do workspace no Workbench ou pelo Command/Ctrl+K. Pedir perspectivas em uma tarefa leva o briefing completo; no menu do líder, já o seleciona para a síntese. Execute de dois a cinco agentes reais sobre o mesmo objetivo, escolha modo consultivo ou implementação, dê uma abordagem diferente a cada agente, selecione o critério de decisão e defina um limite rígido de execuções. Toda perspectiva devolve o mesmo contrato estruturado de evidências, riscos, testes, divergências, recomendação e confiança; a falha de um provider não descarta as respostas concluídas. Uma síntese opcional do líder consome mais uma execução, mas a decisão final de selecionar, pedir consenso ou rejeitar é sempre humana e persistida. Council é a camada de decisão; Andares são a camada de isolamento. Implementações Git rodam em andares separados e somente o resultado selecionado e commitado pode ser aterrissado depois de nova prévia de diff, alterações pendentes e conflitos. Nada faz merge ou push automaticamente.`,
    },
    {
      id: 'control-center',
      title: 'Central de controle e comunicações verificadas',
      body: `Abra a Central de controle no topo de cada workspace expandido no explorer do Workbench. Ela reconstrói o estado de cada agente do térreo e dos andares atualmente ativos a partir de um histórico append-only; agentes de andares encerrados permanecem no histórico, mas não entram nas contagens. Os badges de andar distinguem worktrees ativas. Os estados incluem iniciando, trabalhando, aguardando resposta ou permissão, bloqueado, ocioso, concluído, erro ou desconectado. Cada linha mostra tarefa atual, última ação relevante, tempo no estado, provider, role e uso disponível. Atividade apresenta o mesmo histórico como uma timeline semântica de mensagens, tarefas, revisões, decisões, Git e eventos do sistema; metadados brutos ficam recolhidos para diagnóstico. Comunicações projeta cada transição na fila, enviada, entregue, recebida, respondida ou falhou em um envelope durável com fingerprint do conteúdo, correlação, chave de deduplicação e histórico de tentativas. Repetir o mesmo evento é idempotente, enquanto reutilizar um id com outro conteúdo ou destinatário é rejeitado. A Central de atenção global, aberta pelo sino ao lado de Canvas/Workbench, reúne perguntas, pedidos de permissão, bloqueios e falhas de todos os workspaces, prioriza o atual e permite ler, adiar, resolver e abrir a origem exata. Command/Ctrl+K pesquisa esse histórico com filtros como type:, agent:, workspace:, status:, has:error, before: e after:. Esses estados sobrevivem à troca de tela e ao reinício do app sem acordar terminais ociosos. As edges continuam como histórico visual de conversas reais, mas a entrega usa a ponte e não depende de uma edge.`,
    },
    {
      id: 'workstreams',
      title: 'Fluxos de trabalho: um rastro da tarefa à entrega',
      body: `Abra Fluxos de trabalho abaixo do workspace no explorer do Workbench ou pelo Command/Ctrl+K. Um fluxo não é outro gerenciador de projetos: cada tarefa ativa do Kanban é a identidade canônica, e a visão projeta coluna atual, responsável, andar e branch ativos, atividade semântica, Conselhos, registros da Central de revisão, revisão Git exata, evidências, testes, riscos e arquivos vinculados. As etapas fila, ativo, revisão, bloqueado e concluído são derivadas dessas fontes reais. Iniciar um Conselho pelo fluxo leva o briefing da tarefa, enquanto abrir quadro ou Central de revisão retorna ao registro editável original. Decisões, revisões, atividades e arquivos alterados sem vínculo continuam contabilizados em vez de serem atribuídos silenciosamente à tarefa errada.`,
    },
    {
      id: 'workspace-memory',
      title: 'Memória do workspace com evidências',
      body: `Abra Memória do workspace pelo Command/Ctrl+K, Canvas ou explorador do workspace no Workbench. Salve apenas decisões, fatos, preferências, restrições, referências e aprendizados duráveis; toda entrada exige uma ou mais fontes explícitas, como declaração do usuário, nota, tarefa, mensagem canônica, arquivo do workspace, URL, evidência Git, revisão, Conselho ou agente. Fontes guardam identificação, trechos limitados, links e fingerprints de conteúdo. Revisões nunca sobrescrevem o conhecimento anterior: elas o substituem com proteção de concorrência otimista, e o arquivamento mantém a trilha de auditoria. Agentes usam memory_search apenas quando o contexto for relevante e memory_add ou memory_revise com evidência; o Orkestrai nunca injeta toda a memória em cada prompt nem trata conversa casual como fato.`,
    },
    {
      id: 'annotation-center',
      title: 'Central de Anotações: feedback com sua origem',
      body: `Abra a Central de Anotações pelo Canvas, explorer do workspace no Workbench ou Command/Ctrl+K. Ela não copia comentários para outro gerenciador: projeta cada comentário de código da Central de revisão e cada thread do Design nativo a partir do artefato canônico. Pesquise feedback aberto ou resolvido e inspecione autor, arquivo, linha ou camada exata, revisão capturada, atualização e relação com tarefa. Um comentário de código fica desatualizado quando o conteúdo capturado não corresponde mais ao arquivo atual. Abrir origem retorna à revisão ou documento de Design original, onde a resolução continua autoritativa.`,
    },
    {
      id: 'team-packs',
      title: 'Team Packs: times portáteis e versionados',
      body: `Abra Team Packs pela biblioteca de presets do Canvas. Presets existentes e o catálogo embutido continuam compatíveis; um snapshot customizado começa na versão 1.0.0 e inclui agentes, roles, skills portáteis, etapas e tarefas-modelo, rotinas, servidores MCP adicionais, conexões e layout. Publique uma versão semântica maior com notas para criar uma revisão local imutável. Exporte um arquivo .orkestrai-team-pack.json protegido por checksum ou importe um após validações limitadas de schema, tamanho, integridade e conteúdo. Sessões, ids de conversa, credenciais e outros estados de runtime são removidos. A importação cria um novo pack local em vez de substituir silenciosamente outro com a mesma identidade.`,
    },
    {
      id: 'huddles',
      title: 'Huddles: conversas persistentes com pessoas e agentes',
      body: `Abra Huddles pela barra do Canvas, explorer do Workbench, menu nativo Workspace, Command/Ctrl+K ou PWA Remota. Inicie uma sala ativa por workspace com assunto, pauta opcional, um facilitador e até onze agentes além da pessoa que iniciou. Dite ou escreva cada fala, direcione para até cinco agentes participantes e, se quiser, ouça novas respostas pelo TTS local existente. A transcrição limitada, histórico de participantes, respostas pendentes ou falhas e ciclo de vida sobrevivem à navegação e reinicialização sem acordar terminais alheios. Um agente contribui por huddle list/say na CLI ou ferramentas MCP tipadas sem disparar respostas recursivas. Encerre explicitamente ou crie uma tarefa Kanban vinculada com pauta e transcrição; Fluxos de trabalho mostra a sessão como evidência da entrega. A colaboração remota aplica permissões separadas de visualizar, falar e gerenciar sobre o transporte criptografado existente. É uma conversa estruturada assistida por voz, não uma chamada de áudio sempre aberta.`,
    },
    {
      id: 'review-center',
      title: 'Controle de código e Central de revisão',
      body: `Abra a Central de revisão em cada workspace do explorer do Workbench para inspecionar alterações preparadas e não preparadas sem sair do Orkestrai. O cabeçalho mostra branch, upstream e commits à frente ou atrás; a lista permite preparar, remover da preparação, criar commit, fazer pull, push e descartar edições rastreadas somente após confirmação. Selecionar um arquivo abre um diff lado a lado e limitado no Monaco; arquivos binários ou muito grandes recebem estados seguros explícitos. Inicie uma revisão para vincular a revisão Git exata a uma tarefa, agente responsável, resumo, evidências, testes, riscos e arquivos selecionados. Clique em qualquer lado do diff para comentar no arquivo ou na linha. Quando o repositório muda, comentários antigos continuam visíveis como contexto desatualizado em vez de apontarem silenciosamente para outra linha. Aprove, solicite alterações ou rejeite em linguagem direta; alterações solicitadas são enviadas ao agente responsável quando seu terminal está disponível e permanecem salvas quando ele está offline.`,
    },
    {
      id: 'portal-design-mode',
      title: 'Portal Design Mode',
      body: `No aplicativo instalado, abra um Portal e escolha Inspecionar design no cabeçalho. O hover destaca o elemento real da página sem alterá-lo; o clique captura um seletor limitado, texto visível, estilos computados relevantes, viewport e um PNG recortado. Revise esse contexto, descreva o resultado esperado e registre-o em uma nova tarefa para triagem do líder, em uma nova tarefa já atribuída a um agente ou em uma tarefa existente. Screenshot e contexto ficam juntos no Kanban para manter a rastreabilidade. Esc cancela a inspeção. O HTML bruto serve apenas para a prévia sanitizada; query strings, cookies, headers, tokens, storage e estado oculto nunca entram automaticamente.`,
    },
    {
      id: 'mobile-device',
      title: 'Dispositivo móvel no Canvas e Workbench',
      body: `Adicione Dispositivo móvel pela barra do Canvas. Ele é um único node persistente do workspace; o Workbench lista e abre o mesmo node e a mesma sessão. Em Macs Apple Silicon com Xcode instalado, escolha um iOS Simulator. No macOS, Windows ou Linux com o Platform Tools do Android Studio instalado, escolha um AVD local ou um aparelho USB ou de rede autorizado no ADB; aparelhos físicos exigem confirmação explícita antes da conexão. O painel transmite a tela e envia toques, swipes, gestos de pinça, rotação, Home, texto e os botões Android Voltar e Recentes. A tela inteira se ajusta ao Canvas e Workbench; controles independentes permitem reduzir, ampliar, voltar ao ajuste automático ou usar 1:1 com scroll horizontal e vertical. A gaveta de ferramentas instala builds .app/.ipa ou .apk, abre um bundle id do iOS ou package/activity do Android, salva screenshots em .orkestrai/devices/screenshots, lê logs limitados e a árvore de acessibilidade ou UIAutomator e inspeciona ou altera permissões. Os agentes recebem as mesmas ações confinadas ao workspace pela CLI orkestrai device e pelas tools MCP depois que o usuário inicia a sessão. O Orkestrai encerra apenas helpers e simuladores ou emuladores que iniciou; cada workspace admite um node e uma sessão, e sessões ociosas são limpas.`,
    },
    {
      id: 'api-client',
      title: 'Cliente de API para contratos e coleções REST',
      body: `Adicione Cliente de API pela barra do Canvas para trabalhar com HTTP/REST, GraphQL, WebSocket e gRPC sem alternar de aplicativo. Crie pastas aninhadas, arraste requests pela alça dedicada e configure query, headers, autenticação Bearer, Basic, chave de API ou OAuth 2.0, cookies, proxy, CA, certificados de cliente e TLS. GraphQL possui editores de query, variáveis e operação; WebSocket oferece mensagens, keepalive, reconexão e transcript; gRPC carrega proto local e executa os quatro modos de streaming. Campos estruturados usam editores com sintaxe e as respostas JSON/XML aparecem em árvores expansíveis. Em Scripts, escolha Orkestrai nativo, Postman ou Bruno. Coleções Postman usam o Postman Runtime oficial; scripts Bruno e OpenCollection usam o runtime QuickJS seguro oficial do Bruno. APIs de escopo, helpers de request e response, callbacks de rede, cookies, controle de fluxo, testes, Chai e visualizações executam sem traduzir o script. O vault fica criptografado no app desktop. Runners mantêm ordem, ambiente, dados de iteração, intervalo e regra de parada. Importe Bruno, OpenCollection, Postman v2.1, Swagger 2.0 ou OpenAPI 3.x e exporte Bruno, OpenCollection, Postman, OpenAPI 3.1, ambientes Postman ou o backup Orkestrai sem perdas. Origens Bruno, OpenCollection e Postman possuem sincronização protegida e bidirecional; OpenAPI permanece pull-only. Serviços exclusivamente hospedados do Postman, como Package Library de time e datasets, exigem o backend Postman e não são comportamento portátil da coleção. O mesmo node persiste no Canvas e Workbench, e agentes conectados usam api_client_list e api_client_execute sem receber credenciais salvas no inventário.`,
    },
    {
      id: 'api-client-scripts',
      title: 'Scripts e testes do Cliente de API',
      body: 'Use esta referência nos editores Scripts e na aba Testes, que separa Assertions e JavaScript. O editor completa bru.*, req/res, test/expect e pm.* conforme o runtime escolhido e ocupa toda a área disponível. Os exemplos abaixo podem ser copiados diretamente.',
      bullets: [
        'A ordem é: pré-request da coleção, pré-request das pastas da raiz até a folha, pré-request da request, chamada de rede, pós-resposta da request, JavaScript de Testes, pós-resposta das pastas da folha até a raiz, pós-resposta da coleção e assertions nativas.',
        'Os escopos Postman permanecem separados em pm.globals, pm.collectionVariables, pm.environment, pm.iterationData e pm.variables. O Bruno expõe os equivalentes de ambiente, global, coleção, runtime, secrets e iteração do runner. Use {{nome}} em qualquer campo da request.',
        'Postman oferece pm.sendRequest, pm.execution.runRequest/setNextRequest/skipRequest, cookies, vault, visualizer, APIs legadas, pm.require para bibliotecas incluídas, metadados corretos de iteração em pm.info e o Chai completo incluído. Bruno oferece bru.sendRequest/runRequest, helpers req/res, variáveis de request e pasta, blocos de variáveis pós-resposta, assertions declarativas, blocos tests, cookies, fluxo do runner, visualizações, bibliotecas incluídas e test/expect/assert globais.',
        'Os scripts importados são preservados e executados pelo runtime de origem selecionado, sem transpilar JavaScript. Package Library de time, datasets hospedados, mocks e outros estados em nuvem do Postman exigem os serviços Postman e não fazem parte de um arquivo de coleção portátil. O Bruno permanece no runtime QuickJS seguro oficial: o acesso NodeVM inseguro ao filesystem, aos processos e a módulos locais arbitrários da máquina fica deliberadamente desabilitado. O .orkestrai-api.json continua sendo o backup sem perdas do estado exclusivo do Orkestrai.',
        'Agentes e líderes podem importar uma coleção Bruno, OpenCollection ou Postman existente com api_client_import e um caminho relativo ao repositório. Se o workspace coordena vários repositórios irmãos, abra Editar workspace > Repositórios adicionais, autorize cada raiz e use o alias correspondente, como @api-tests/bruno. api_client_read/replace edita o mesmo node visível na UI e grava de volta nas origens vinculadas por padrão; sync-status, pull e push expõem conflitos antes de substituir qualquer lado. Caminhos absolutos, pastas superiores não autorizadas e escapes por links simbólicos continuam bloqueados. Requests, pastas, scripts, testes e variáveis nativos do formato ficam em arquivos comuns prontos para git, Bruno, Postman e CI; configurações de runner exclusivas do Orkestrai permanecem no node e no backup nativo sem perdas.',
      ],
      examples: [
        {
          id: 'postman',
          title: 'Scripts compatíveis com Postman',
          description: 'Selecione Postman: Pré-request prepara dados, Pós-resposta captura variáveis e Testes > JavaScript recebe pm.test/pm.expect. Cada linha do runner alimenta pm.iterationData.',
          snippets: [
            {
              id: 'pre-request',
              title: 'Request · Pré-request',
              code: `const requestId = 'req-' + Date.now();

const tenant = pm.iterationData.get('tenant');

pm.variables.set('requestId', requestId);
pm.globals.set('lastTenant', tenant);
pm.request.headers.upsert({
  key: 'X-Request-Id',
  value: requestId,
});

pm.vault.get('apiKey').then((apiKey) => {
  pm.request.headers.upsert({ key: 'X-API-Key', value: apiKey });
});

console.log('Request preparada:', requestId, tenant);`,
            },
            {
              id: 'post-response',
              title: 'Request · Pós-resposta',
              code: `let body;

pm.test('Status é 200', () => {
  pm.expect(pm.response.code).to.equal(200);
});

pm.test('Body é um JSON válido', () => {
  body = pm.response.json();
});

if (body) {
  pm.test('Resposta contém access_token', () => {
    pm.expect(body).to.have.property('access_token');
  });

  pm.test('Resposta contém o id do usuário', () => {
    pm.expect(body).to.have.property('user');
    pm.expect(body.user).to.have.property('id');
  });

  if (body.access_token) {
    pm.environment.set('accessToken', body.access_token);
  }

  if (body.user?.id) {
    pm.environment.set('userId', body.user.id);
  }

  pm.execution.setNextRequest('Buscar usuário');
  console.log('Usuário autenticado:', body.user?.id);
}`,
            },
            {
              id: 'javascript-tests',
              title: 'Testes > JavaScript',
              code: `pm.test('Status é 200', () => {
  pm.expect(pm.response.code).to.equal(200);
  pm.expect(pm.response.json()).to.have.property('user');
});`,
            },
            {
              id: 'next-request',
              title: 'Request seguinte · uso das variáveis',
              code: `GET {{baseUrl}}/users/{{userId}}
Authorization: Bearer {{accessToken}}
X-Request-Id: {{requestId}}`,
            },
          ],
        },
        {
          id: 'bruno',
          title: 'Scripts compatíveis com Bruno',
          description: 'Selecione Bruno: use Pré/Pós-resposta para automação e Testes > JavaScript para o corpo oficial test(...). O export envolve esse código em tests { } automaticamente.',
          snippets: [
            {
              id: 'pre-request',
              title: 'Request · Pré-request',
              code: `const login = await bru.runRequest('Auth / Login');
const token = login.data.access_token || bru.getVar('accessToken');

if (!token) {
  throw new Error('A variável accessToken não foi definida');
}

req.setHeader('Authorization', 'Bearer ' + token);
req.setHeader('Accept', 'application/json');

console.log('Request autenticada');`,
            },
            {
              id: 'post-response',
              title: 'Request · Pós-resposta',
              code: `const body = res.getBody();

test('Usuário foi criado', () => {
  expect(res.getStatus()).to.equal(201);
  expect(body).to.have.property('id');
});

bru.setVar('createdUserId', body.id);
bru.setVar('lastStatus', res.getStatus());
bru.setNextRequest('Buscar usuário');

console.log('Usuário criado:', body.id);`,
            },
            {
              id: 'javascript-tests',
              title: 'Testes > JavaScript',
              code: `test('Usuário foi criado', () => {
  expect(res.getStatus()).to.equal(201);
  expect(res.getBody()).to.have.property('id');
});`,
            },
          ],
        },
        {
          id: 'orkestrai-native',
          title: 'Orkestrai nativo: assertions e JavaScript',
          description: 'Na aba Testes, alterne entre assertions estruturadas e JavaScript. O runtime nativo aceita pm.test/pm.expect ou test/expect; use assertions para verificações simples.',
          snippets: [
            {
              id: 'javascript-tests',
              title: 'Testes > JavaScript',
              code: `test('Status é 200', () => {
  expect(res.getStatus()).to.equal(200);
});

pm.test('Body é JSON', () => {
  pm.expect(pm.response.json()).to.have.property('data');
});`,
            },
            {
              id: 'declarative-tests',
              title: 'Aba Testes · assertions',
              code: `Fonte          Caminho          Operador       Esperado
Status         —                Igual           200
Body           data.user.id     Existe          —
Header         content-type     Contém          application/json
Tempo resposta —                Menor que       1000`,
            },
            {
              id: 'variables',
              title: 'Ambiente e template nativos',
              code: `Variável da coleção: baseUrl = https://api.example.com
Variável do ambiente: accessToken = <token do ambiente ativo>
Variável criada por script: userId = 42

URL: {{baseUrl}}/users/{{userId}}
Header: Authorization = Bearer {{accessToken}}`,
            },
          ],
        },
      ],
    },
    {
      id: 'notas',
      title: 'Notas como canais de trabalho',
      body: `Notas são markdown vivo compartilhado com os agentes. A convenção: conecte a nota a quem deve lê-la/escrevê-la e diga o propósito no título e no conteúdo. Ex.: nota “Backlog (líder escreve)” conectada ao líder — você escreve “quebre em tarefas para o time” e ele lê com orkestrai note read e distribui no quadro. Nota “Para mim (humano)” — peça ao líder para registrar status/decisões nela com orkestrai note write/edit, e você acompanha formatado (ícone de olho). Duplo-clique no título renomeia a nota. Solte, cole ou selecione imagens, PDFs, outros arquivos e links HTTP/HTTPS; arquivos de até 10 MB ficam em .orkestrai/attachments/ e a referência markdown entra no cursor. Ao remover um anexo pelo X, a referência também sai da nota e o arquivo armazenado no workspace é apagado.`,
    },
    {
      id: 'tarefas',
      title: 'Tarefas (kanban)',
      body: `O nó Tarefas (+ Tarefas na barra inferior) é o quadro do workspace. Use o ícone de colunas no cabeçalho para nomear, colorir, ordenar e criar até dez etapas que representem o seu processo — por exemplo Ideias, Roteiro, Design, Aprovação e Publicado. O líder e o time enxergam essas etapas automaticamente e mantêm o estado real de cada entrega. O botão "Adicionar tarefa" abre um composer completo com título, descrição em markdown e imagens, PDFs, arquivos ou links; também é possível soltá-los direto num cartão. Atribuir um cartão despacha título, descrição e todas as referências direto para o agente. Ao iniciar, o líder recebe todas as tarefas sem responsável com o briefing completo e deve registrar/atribuir no quadro antes de delegar por mensagem. task done envia uma notificação identificada como Tarefa concluída e entrega automaticamente o handoff ao líder assim que o composer dele estiver livre; Projeto concluído é reservado para o término real do projeto. Cada tarefa pode ter UMA nota vinculada; concluídas podem ser arquivadas sem perder o histórico.`,
    },
    {
      id: 'imagens',
      title: 'Nó de Imagem (referência visual)',
      body: `A ferramenta Imagem (barra inferior) cria um nó de referência visual no canvas: mockup, screenshot, diagrama de arquitetura. Cole com Ctrl+V ou clique para escolher o arquivo — a imagem fica salva no workspace (.orkestrai/images/). Conecte o nó ao líder (ou a um agente específico, como o designer) para deixar claro quem deve usar aquela referência, e diga no chat o que fazer com ela. Duplo-clique no título renomeia; o ícone de imagem no cabeçalho troca o arquivo.`,
    },
    {
      id: 'visual-annotations',
      title: 'Formas e anotações visuais',
      body: `Use Formas na barra do Canvas para desenhar retângulos, caixas arredondadas, elipses, losangos e setas curvas editáveis ao redor do trabalho. Dê duplo-clique para editar o texto; o controle de estilo altera fundo, opacidade, borda, tracejado, tipografia e âncoras da seta. Selecione uma forma e use a ação de duplicar ou Cmd/Ctrl+D para preservar exatamente tamanho, texto, estilo e geometria da seta com um pequeno deslocamento. Cmd/Ctrl+C e Cmd/Ctrl+V copiam e colam uma ou várias formas selecionadas mantendo o espaçamento relativo; cada cópia é um node persistente separado e pode ser editada de forma independente.`,
    },
    {
      id: 'design-mode',
      title: 'Modo Design nativo',
      body: `Adicione Design pela barra do Canvas para criar um documento visual estruturado salvo em .orkestrai/designs dentro do projeto. Dê duplo-clique na prévia ou use expandir para abrir o mesmo documento no Modo Design do Canvas ou no Workbench. Desenhe frames, retângulos, elipses, textos e paths em qualquer tamanho; Shift mantém proporções e Alt/Option cria ou redimensiona a partir do centro. A Caneta mostra a prévia do próximo segmento e do fechamento: clique para cantos, arraste para curvas, clique na primeira âncora para fechar ou use Enter/Esc para concluir um path aberto. Selecione um path e pressione Enter ou dê duplo-clique para entrar na edição vetorial. Arraste âncoras e alças, arraste um segmento para curvá-lo, dê duplo-clique no segmento para dividi-lo e escolha tangentes Canto, Espelhado, Assimétrico ou Desconectado na barra contextual. Use Shift-clique ou seleção por caixa para escolher vários pontos e movê-los, deslocá-los pelo teclado, excluí-los ou redimensioná-los em conjunto; escolha a Caneta e clique numa extremidade para continuar um path aberto. Camadas selecionadas exibem oito alças de resize, a geometria do path escala com seus limites, vetores rotacionados são editados no lugar e textos aceitam edição direta no canvas e múltiplas linhas. Use Shift para selecionar camadas, alinhar, distribuir, combinar por união, subtração, interseção ou exclusão e criar ou liberar máscaras. Agrupe com Cmd/Ctrl+G e desagrupe com Shift+Cmd/Ctrl+G; mover ou redimensionar um grupo transforma seus descendentes, enquanto Alt seleciona diretamente uma camada interna. Empilhe fills e strokes sólidos ou com gradiente linear/radial; adicione sombras, blur, blend modes, réguas, guias persistentes e snap. As ferramentas de cor listam e selecionam todas as camadas com o mesmo preenchimento ou contorno, aplicam uma cor à seleção ou substituem sólidos e stops de gradiente correspondentes na página. Frames aceitam auto layout horizontal, vertical, com wrap ou grid, padding e gaps, enquanto constraints dos filhos respondem ao redimensionamento. Cole, arraste ou escolha um SVG para converter paths, formas primitivas, a hierarquia original de grupos, transforms aninhados, estilos, gradientes e referências em camadas vetoriais nativas editáveis; PNG, JPEG, WebP e GIF continuam como assets raster reutilizáveis. Copie a seleção atual como SVG ou PNG ou exporte a arte selecionada ou a página completa em SVG, PNG, JPEG, WebP ou PDF; controles de edição nunca entram no export ou thumbnail. Abra Variáveis ao lado de Camadas para criar tokens tipados em coleções, adicionar modos como Claro e Escuro, reutilizar um token por alias e vincular preenchimento, contorno, opacidade, raio, tipografia, espaçamento, padding ou efeitos compatíveis no inspector. Comece por presets de produto, marketing ou mobile, importe DTCG JSON ou CSS variables, exporte DTCG, CSS ou Tailwind e use a auditoria para localizar tokens duplicados ou não usados, valores repetidos e candidatos a componente. Em Componentes, transforme um frame ou grupo em fonte reutilizável, crie instâncias vinculadas, exponha propriedades de texto, visibilidade e slot, troque a instância ou variante e mantenha overrides locais ou desanexe uma cópia. Em Bibliotecas, publique uma versão somente para workspaces escolhidos, importe, sincronize sem perder a posição local ou desvincule mantendo cópias editáveis. Em Código, a varredura somente leitura extrai CSS variables, configuração Tailwind estática e contratos Svelte, React ou Vue sem executar arquivos do projeto; depois vincule componentes visuais e sincronize tokens por hash de origem. Trocar o modo ativo atualiza imediatamente todas as camadas vinculadas. Tokens e componentes aparecem na busca global e no resumo do node Design. Tooltips mostram os atalhos, Delete remove os pontos ou camadas selecionados, Esc sai em etapas da edição de pontos e vetores, as setas deslocam em um e Shift em dez, e desfazer/refazer usa operações tipadas. Cada mutação registra revisão e histórico limitado. Conecte o node Design ao líder ou especialista para editar o mesmo scene graph por tools MCP tipadas do Orkestrai, incluindo tokens, componentes, instâncias, propriedades, variantes, slots e links de bibliotecas; edições humanas e de agentes usam controle otimista, atualizam editores abertos e não exigem reescrever JSON.`,
    },
    {
      id: 'design-collaboration',
      title: 'Colaboração ao vivo no Design',
      body: `Abra Colaboração no inspector do Design para trabalhar no mesmo documento nativo com pessoas e agentes. A presença ao vivo mostra página, cursor e seleção de cada participante; Seguir mantém sua viewport naquela pessoa até você parar. Selecionar uma layer assume um lease curto e renovável, então outro participante recebe um conflito claro em vez de sobrescrever a mesma layer. Crie uma conversa na página ou layer selecionada, mencione pessoas, responda, resolva ou reabra; conversas e autoria permanecem no histórico mesmo se a layer for removida. Uma proposta visual mostra a prévia de posição, tamanho, opacidade e preenchimento sem alterar o documento, lista o diff estrutural e só aplica todas as operações de forma atômica depois de aprovação explícita. Envie a proposta ao Council para perspectivas independentes ou crie um Andar Git paralelo para implementação isolada. Agentes conectados usam as mesmas operações versionadas de comentário, proposta e decisão pelo MCP do Orkestrai e não podem simular aprovação humana. No compartilhamento criptografado, o acesso ao Design é aprovado separadamente por dispositivo como Nenhum, Visualizar, Comentar, Propor ou Editar e decidir. O Remote recebe páginas, atividade, conversas e resumos de propostas sanitizados, nunca o scene graph completo, assets, arquivos, credenciais ou caminhos locais.`,
    },
    {
      id: 'design-quality',
      title: 'Qualidade e recuperação do Design',
      body: `Abra Qualidade no inspector do Design para auditar nomes úteis de layers, texto ou conteúdo cortado, sobreposição acidental, contraste de texto segundo WCAG e metadados de acessibilidade. Selecionar um problema foca sua layer exata. O mesmo painel aplica templates completos e editáveis de produto, marketing, mobile ou design system pelo command bus com proteção de revisão. Toda escrita válida mantém um backup automático; documentos principais corrompidos se recuperam dele, históricos grandes são compactados automaticamente e a restauração manual cria uma nova revisão. Documentos acima de 500 layers renderizam apenas a região visível, a seleção e sua hierarquia. Agentes conectados podem executar a mesma auditoria ou aplicar um template por comandos MCP e CLI tipados.`,
    },
    {
      id: 'presets',
      title: 'Presets de equipe',
      body: `A Biblioteca de presets fica no ícone de template da barra lateral e no botão Presets da barra inferior. Além dos times de Produto, React, Next.js, SvelteKit, Svelar e Laravel, ela traz Campanha e lançamento, Brand e design, Conteúdo e SEO e Orkestrai Contributing. Cada receita inclui líder, especialistas, roles operacionais extensas, skills, briefing, quadro, tarefa inicial e layout; o time de contribuição inclui ainda consenso obrigatório entre Claude, Codex e Kimi. Agentes de preset iniciam com acesso total autônomo e recebem a role pelo mecanismo nativo da CLI, sem deixar o terminal preso em texto colado. O líder recebe a tarefa inicial completa e deve atribuí-la antes de delegar. Use Novo workspace para outra pasta ou + para somar o time ao canvas atual sem apagar nada.`,
    },
    {
      id: 'fluxos',
      title: 'Fluxos (pipelines de agentes)',
      body: `O nó Fluxo (+ Fluxo na barra inferior) é um pipeline visual: passos em sequência, onde a saída de um agente vira a entrada do próximo via {{input}} no prompt. Passo "Agente" conversa com o agente escolhido (a aresta acende durante) — se o terminal do agente nunca foi aberto, o fluxo inicia a sessão dele sozinho; passo "Aprovação" pausa até você clicar em Aprovar — humano no loop. Repetição com limite (até 5 rodadas). Dois superpoderes: o botão SINCRONIZAR cria um passo Agente para cada agente conectado ao fluxo (na ordem das arestas — monte o pipeline desenhando); e FLUXOS ENCADEADOS — quando um Fluxo termina com sucesso, a saída final dispara os Fluxos conectados a ele (falha não encadeia, ciclo é bloqueado). O progresso aparece ao vivo no nó, erros aparecem num banner no topo do nó (nada falha em silêncio) e o histórico das últimas 5 execuções fica guardado nele. Use para revisões encadeadas (escreve → revisa → aprova), pipelines compostos (pesquisa → redação → SEO) ou fan-out de um fluxo para vários.`,
    },
    {
      id: 'sem-medo',
      title: 'Diff, Loop & Andares — sem medo (para não-devs)',
      body: `Três botões que assustam mas são amigáveis: DIFF é só um comparador — mostra lado a lado o que mudou no código entre duas versões, sem mexer em nada. LOOP (Loop Ralph) é um piloto automático: o time repete sozinho o ciclo planejar → fazer → revisar até o número de rodadas que você escolher. ANDARES são cópias de segurança do projeto: cada time trabalha numa cópia separada e ninguém bagunça a versão principal — no fim, o app ajuda a juntar tudo de volta (e avisa se houver conflito antes). Pode clicar sem receio: nada aqui apaga seu trabalho.`,
    },
    {
      id: 'conexoes',
      title: 'Conexões',
      body: `Arraste da bolinha de um nó até outro — a conexão é bidirecional e a bolinha flutua pela borda sempre no ponto mais próximo do outro nó. A corda tracejada tem física (balança ao mover) e fica verde animada enquanto os agentes conversam. O Orkestrai reduz automaticamente o trabalho de simulação em canvases grandes e conexões fora da tela, preservando o sinal visual das conversas selecionadas ou ativas; janelas ocultas e o modo de movimento reduzido interrompem as animações. Hover mostra o X de remover; clique fixa o X. Conectar instala a skill da ponte nos agentes (eles aprendem a CLI orkestrai sozinhos).`,
    },
    {
      id: 'andares',
      title: 'Andares (worktrees)',
      body: `Um andar é um git worktree do repo do workspace com branch própria. O painel Andares mostra, para o térreo e cada worktree ativa, os agentes e uma lista das tarefas com título, etapa e responsável, além de arquivos alterados, sincronização da branch e último commit. Workbench e Central de controle identificam o andar dos agentes ativos. Ao aterrissar ou excluir, terminais, cópias de layout e edges daquele andar são arquivados automaticamente: continuam disponíveis para atribuição histórica, mas não inflam as contagens nem aparecem como agentes atuais. Clonar o layout nunca reutiliza a sessão PTY ou a conversa do provider. Crie pelo painel ou pela CLI: orkestrai floor create/list/preview/land/remove; recruit --floor posiciona um novo agente no andar ativo escolhido. Aterrissar faz merge da branch depois da prévia de diff e conflitos. Conflitos nunca são escondidos: o erro lista os arquivos e a resolução vira tarefa explícita.`,
    },
    {
      id: 'rotinas',
      title: 'Automações',
      body: `Abra Automações pela barra do Canvas, pelo explorer do Workbench ou por Command/Ctrl+K. O gatilho pode ser manual, agendado, uma mudança em tarefa, uma mensagem confirmada de agente, commit Git, pull request do GitHub, webhook, mudança em arquivo ou pasta ou limite de uso de provider. As ações enviam um prompt a um agente, criam uma tarefa rastreável no Kanban ou mostram uma notificação explícita no desktop. Receitas de desenvolvimento, design, marketing, pesquisa e operações oferecem pontos de partida seguros. Cada execução registra entrada do gatilho, agente/provider de destino, snapshots de cota, confirmação da saída, duração, tentativa e falha recuperável; retries são limitados e eventos duplicados são idempotentes. Tokens do GitHub ficam cifrados pelo safeStorage do Electron e nunca entram no banco do workspace. As Rotinas agendadas antigas continuam compatíveis e aparecem aqui automaticamente.`,
    },
    {
      id: 'portal',
      title: 'Portal (browser dos agentes)',
      body: `O nó Portal é um navegador embutido. Dê a cada Portal um nome persistente pelo lápis no cabeçalho; o endereço fica na barra de navegação separada. Os agentes listam todos os Portais do workspace com nome, URL, id e estado de conexão e escolhem pelo nome único ou id: orkestrai portal <nome-ou-nodeId> navigate (abrir URL), eval (rodar JS na página), dom (ler o HTML), screenshot. Um Portal não conectado ainda existe e deve ser reutilizado; criar outro exige intenção explícita. Conectado a um agente, ele vira os olhos do agente. Use para testar a aplicação que o time está construindo (aponte o portal para o dev server) ou pesquisar na web. No desktop, links e logins que pedem uma nova janela abrem num Portal sandboxed do Orkestrai, não no browser do sistema, preservando window.opener e a mesma sessão. Cookies persistentes e web storage são gravados em disco, e o nó restaura a última URL navegada após reiniciar; sites ainda podem usar cookies somente de sessão que expiram ao fechar. A automação completa roda no Electron; no browser comum o portal é só visualizador. O ícone de celular no cabeçalho do Portal abre uma barra de responsividade, parecida com o device toolbar de um navegador: escolha um dispositivo (iPhone, Pixel, iPad, laptop, desktop) ou digite largura/altura exatas, gire a orientação, ou desligue pra voltar a preencher o nó. O viewport real da página muda pro tamanho escolhido — igual redimensionar uma janela de verdade — então o CSS responsivo dela reage normalmente; se o tamanho emulado for maior que o nó, o Portal rola até lá em vez de encolher ou distorcer a página.`,
    },
    {
      id: 'mcp',
      title: 'MCP (tools externas dos agentes)',
      body: `MCP é o padrão para dar ferramentas externas aos agentes (GitHub, Gmail, Figma, Drive, Postgres...). O JEITO FÁCIL: página Skills (barra lateral) → aba MCPs — pesquise na curadoria oficial ou no registry MCP e instale com um clique; se o servidor pedir chave/token, o app explica onde conseguir. Remotos instalam sem comando. AVANÇADO: lápis ao lado do workspace → "Servidores MCP". AUTOMÁTICO: o Orkestrai provisiona a própria ponte nos formatos de Claude/Kimi (.mcp.json), OpenCode (opencode.json), Cursor (.cursor/mcp.json), Cline (.cline/mcp.json), Devin (.devin/mcp_config.json) e Antigravity (.agents/mcp_config.json), além das skills e do bloco preservado em AGENTS.md. O Codex recebe a ponte do Orkestrai e o MCP oficial do Figma como parâmetros temporários ao iniciar, sem reescrever ~/.codex/config.toml. Cada agente recebe as ações do canvas como tools tipadas no workspace correto.`,
    },
    {
      id: 'cli',
      title: 'CLI orkestrai (a ponte)',
      body: `Os agentes usam a CLI orkestrai para agir no canvas: list, ask, usage, huddle list/say, note read/write/edit/create, task list/columns/add/move/assign/done/archive/history, role show/write/edit, floor create/list/preview/land/remove, notify, recruit/dismiss/connect/reassign, portal, device, port, fs, run, say, clip, notes e portals. ask preserva mensagens com várias palavras mesmo sem aspas, mas uma conversa só conta quando a ponte devolve Resposta confirmada; timeout ou resposta não confirmada termina com erro. usage devolve as cotas atuais e a recomendação configurada no nó Uso. huddle list/say permite que um agente participante leia a transcrição limitada e contribua sem disparar respostas recursivas. task columns devolve as etapas definidas por você; task add --column e task move permitem que líder e equipe respeitem qualquer processo, não apenas um kanban de software. device lista, conecta, controla, inspeciona, captura e encerra o simulador móvel do workspace. task done também avisa o líder automaticamente. Agentes que falam MCP recebem as mesmas ações como tools nativas via orkestrai mcp. O provisionamento da ponte é automático e o token fica em .orkestrai/workspace.json.`,
    },
    {
      id: 'usage-routing',
      title: 'Uso e roteamento por cota',
      body: `Abra Uso na barra inferior e use Adicionar ao canvas para manter a capacidade dos providers visível no workspace. O Roteamento do líder aparece primeiro no nó: escolha origem, fallback, janela de 5 horas/semanal/mensal e percentual sem redimensionar. Os detalhes dos providers vêm depois numa área de rolagem contida compatível com mouse, trackpad, toque e teclado sem aplicar zoom no canvas; nós compactos salvos anteriormente usam o mesmo comportamento. Claude, Codex e Kimi expõem janelas legíveis por máquina usando as credenciais que já pertencem às CLIs; somente esses percentuais verificados participam do roteamento automático entre origem e fallback. O mesmo painel lista Antigravity, Cursor, Devin, OpenCode e Cline com sua capacidade oficial real: Antigravity expõe cota nos painéis AI Credits e Model Quotas, Cursor e Devin exigem credenciais administrativas separadas de Team/Enterprise e OpenCode/Cline mostram uso no console da conta, nas configurações ou no provider de modelo escolhido. Nenhum provider indisponível recebe percentual inventado. O nó atualiza as fontes automáticas a cada cinco minutos, oferece links para a documentação oficial e avisa quando a janela da política está indisponível. Uma tarefa já em execução nunca troca de terminal silenciosamente.`,
    },
    {
      id: 'appearance',
      title: 'Temas e aparência',
      body: `Em Configurações → Aparência, escolha Orkestrai Dark, Graphite, Midnight ou Orkestrai Light. O padrão escuro combina superfícies grafite com o amarelo da marca; o tema claro mantém contraste legível em painéis, nós, ícones, marcas dos providers, botões e hovers. Para personalizar, duplique qualquer tema e edite seus tokens semânticos; a prévia aparece imediatamente e Salvar persiste a escolha. Temas personalizados podem ser exportados ou importados como JSON validado, sem aceitar CSS arbitrário.`,
    },
    {
      id: 'atalhos',
      title: 'Atalhos',
      body: `⌘P paleta · ⌘K (ou Ctrl+K) buscar na documentação de qualquer tela · ⌘2 Central de Providers · ⌘⇧A próxima atenção · ⌘⇧T organizar os nós selecionados ou todo o canvas quando nada está selecionado · Cmd/Ctrl+D duplicar formas selecionadas · Cmd/Ctrl+C e Cmd/Ctrl+V copiar e colar formas selecionadas · ⌘G agrupar · ⌘⇧G desagrupar · N nova nota · L conectar selecionados · Alt+1…9 focar terminal · Alt+Espaço ditado por voz · ⌘F buscar no terminal · ⌘Z desfazer · Backspace excluir. No Windows, a barra de título estilizada oferece Arquivo, Editar, Visualizar, Workspace, Janela e Ajuda sem perder os controles da janela; macOS e Linux mantêm seus menus de plataforma.`,
    },
  ],
  useCases: [
    {
      id: 'leader-team',
      title: 'Time de desenvolvimento com líder (zero-config)',
      body: 'Crie um Claude e diga: “orquestra pra mim a feature X”. Ele propõe o time, você aprova, e ele recruta, conecta e distribui via kanban. Cada consulta por ask só vale após confirmação explícita da ponte; quando um agente usa task done, o líder recebe o handoff automaticamente para revisar e coordenar o próximo passo.',
      tags: ['Líder/Maestro', 'recruit/dismiss', 'kanban'],
    },
    {
      id: 'watch-24-7',
      title: 'Funcionário 24/7 (vigia de tarefas)',
      body: 'Rotina a cada 1–5 min no líder: “verifique o quadro (orkestrai task list); atribua o que estiver sem dono; se faltar agente, recrute”. O time inteiro trabalha sem você tocar em nada — atribuir despacha a tarefa direto pro terminal do agente.',
      tags: ['Rotinas', 'task assign', 'auto-dispatch'],
    },
    {
      id: 'parallel-features',
      title: 'Duas features em paralelo sem conflito',
      body: 'Um andar (worktree) por feature: time A no Térreo na main, time B no andar “auth-refactor”. Ao terminar, floor preview mostra conflitos antes; o land mergeia. Conflito vira tarefa para um agente resolver.',
      tags: ['Andares/worktrees', 'floor land', 'branches'],
    },
    {
      id: 'council-decision',
      title: 'Compare abordagens antes de comprometer o time',
      body: 'Abra Conselho pela barra do Canvas, pelo topo do workspace no Workbench ou pelo Command/Ctrl+K. Se partir de uma tarefa, o briefing já entra completo. Peça a três agentes para avaliarem de forma independente arquitetura, risco de entrega e custo. Use o modo consultivo quando quiser apenas decidir ou implementação para protótipos isolados. Compare a matriz normalizada, leia a síntese opcional do líder e registre sua seleção, pedido de consenso ou rejeição. Somente uma implementação selecionada, com destino limpo e prévia sem conflitos, pode ser aterrissada.',
      tags: ['Council', 'decisão humana', 'andares isolados'],
    },
    {
      id: 'api-client-workflow',
      title: 'Testar APIs do Bruno ou Postman sem sair do Canvas',
      body: 'Adicione um Cliente de API e importe Bruno, OpenCollection YAML, Postman v2.1, Swagger 2.0 ou OpenAPI 3.x. Em um projeto que já possui testes Bruno/Postman, peça ao líder ou agente para usar api_client_import com o caminho relativo ao repositório. Se o workspace coordena repositórios irmãos, autorize-os em Editar workspace > Repositórios adicionais e use aliases como @api-tests/bruno. A mesma coleção aparece no Canvas e Workbench, edições posteriores por api_client_replace persistem nos arquivos do repositório real e caminhos superiores não autorizados continuam bloqueados. Organize pastas, ambientes e runners, escreva automação e testes JavaScript com autocomplete, execute a suíte, revise conflitos de sincronização e então versione a coleção alterada junto do projeto.',
      tags: ['Coleções REST', 'scripts + testes', 'Canvas + Workbench'],
    },
    {
      id: 'visual-annotations',
      title: 'Reutilizar uma explicação visual sem reconstruí-la',
      body: 'Estilize uma forma ou um arranjo completo de rótulos, containers e setas. Duplique a forma selecionada pela ação visível ou com Cmd/Ctrl+D, ou copie e cole uma seleção múltipla para criar outra versão com a mesma geometria e o mesmo espaçamento. Edite o texto e as cores da cópia de forma independente sem alterar o original.',
      tags: ['Formas', 'copiar e colar', 'anotações no Canvas'],
    },
    {
      id: 'visual-qa',
      title: 'QA visual da sua aplicação',
      body: 'Portal apontado para o dev server (http://localhost:5173) conectado a um agente: “abra o portal, faça o fluxo de checkout, tire screenshot e me diga o que quebrou”. O agente navega, executa JS, lê o DOM e reporta.',
      tags: ['Portal', 'screenshot', 'eval/dom'],
    },
    {
      id: 'mobile-qa',
      title: 'Reproduzir e validar um fluxo no iOS ou Android',
      body: 'Adicione Dispositivo móvel ao Canvas ou abra-o pelo Workbench. Conecte um iOS Simulator no Apple Silicon, um AVD Android no macOS, Windows ou Linux ou confirme explicitamente um aparelho Android físico autorizado no ADB; então instale um build do workspace. O mesmo node persistente e a mesma sessão continuam nas duas visualizações. A tela completa se ajusta ao painel por padrão; use zoom, 1:1 e scroll nos dois eixos para inspecionar detalhes. Você ou um agente pode tocar, arrastar, digitar, girar, usar botões do sistema, alterar permissões, inspecionar acessibilidade, capturar screenshots e coletar logs limitados mantendo todos os artefatos dentro do projeto.',
      tags: ['iOS/Android', 'QA mobile', 'CLI/MCP'],
    },
    {
      id: 'research-summary',
      title: 'Pesquisa automatizada com resumo',
      body: '“Use o Portal Pesquisa para ler sobre X, crie uma nota chamada Resumo X e escreva os achados em bullet points.” O agente navega, extrai e escreve — você lê formatado na nota conectada.',
      tags: ['Portal', 'notas', 'note create'],
    },
    {
      id: 'inbox-files',
      title: 'Inbox de arquivos processada sozinha',
      body: 'Rotina a cada 2 min: “liste ./inbox; para cada imagem nova, descreva e classifique; mova para ./inbox/done e registre no quadro”. Solte arquivos na pasta e o time processa em lote, sem parar.',
      tags: ['Rotinas', 'pastas', 'lote'],
    },
    {
      id: 'cross-review',
      title: 'Revisão cruzada entre providers',
      body: 'Conecte Claude e Codex: o Claude implementa, o Codex revisa (orkestrai ask), o veredito volta na mesma corda (ela acende verde durante a conversa). Dois olhares de modelos diferentes em cada mudança.',
      tags: ['Conexões', 'ask', 'multi-provider'],
    },
    {
      id: 'choose-agent-provider',
      title: 'Escolher um agente sem conhecer CLIs',
      body: 'Use o provider que você já tem instalado e autenticado; o Orkestrai cuida do terminal, da ponte e da retomada da conversa. Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline e Devin aparecem na mesma barra quando disponíveis. Para uma campanha, identidade visual, pesquisa, conteúdo ou produto, nomeie os agentes pelo resultado esperado e combine um segundo provider apenas quando quiser revisão independente.',
      tags: ['8 providers', 'sem terminal', 'qualquer profissão'],
    },
    {
      id: 'pin-favorite-agents',
      title: 'Manter os agentes favoritos a um clique',
      body: 'Abra Agentes na barra inferior e fixe até quatro serviços que você mais usa. Os favoritos prontos viram botões diretos ao lado do menu, na ordem escolhida, em todos os workspaces e reinícios; um serviço temporariamente indisponível continua salvo sem ocupar espaço na barra.',
      tags: ['Menu Agentes', 'favoritos fixados', 'preferência global'],
    },
    {
      id: 'setup-agent-provider',
      title: 'Preparar um provider de IA sem adivinhar comandos',
      body: 'Abra a Central de Providers para ver quais agentes este dispositivo já consegue usar. Expanda Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline ou Devin, siga a instalação indicada para seu sistema, conclua o login na CLI oficial e use Verificar novamente antes de voltar ao canvas.',
      tags: ['Central de Providers', 'configuração guiada', 'credenciais locais'],
    },
    {
      id: 'deploy-sentinel',
      title: 'Sentinela de deploy/testes',
      body: 'Rotina de hora em hora num shell ou agente: “rode os testes; se falhar, abra uma tarefa para o time e me notifique (orkestrai notify)”. Você recebe notificação nativa do sistema e o kanban já tem o cartão.',
      tags: ['Rotinas', 'notify', 'CI local'],
    },
    {
      id: 'automate-workspace',
      title: 'Automatizar trabalho repetível com rastreabilidade',
      body: 'Abra Automações no Canvas ou Workbench, comece por uma receita de operações, pesquisa, design, marketing ou desenvolvimento e escolha o gatilho e a ação exatos. Use eventos de tarefa e mensagem para coordenação, mudanças em arquivo ou commit para fluxos locais, limites de uso como proteção de roteamento, webhooks para sistemas externos e a conexão cifrada do GitHub para pull requests. O histórico mostra o que disparou, qual agente recebeu, qual ação terminou e se há retry limitado disponível.',
      tags: ['Automações', 'gatilhos', 'histórico de execução'],
    },
    {
      id: 'framework-preset',
      title: 'Preset do seu framework (projeto novo em 30s)',
      body: 'Abra a Biblioteca de presets e escolha React, Next.js, SvelteKit, Svelar ou Laravel. O projeto nasce com líder, implementação, arquitetura e QA conectados, roles completas, skills para Claude/Codex, quadro e tarefa inicial. Os terminais usam o modo autônomo de acesso total do adapter do provider para o time executar sem confirmações repetidas. Salve o workspace como preset quando quiser duplicar e personalizar a receita.',
      tags: ['Biblioteca de presets', 'roles/skills', 'bootstrap'],
    },
    {
      id: 'portable-role-library',
      title: 'Reutilizar uma role especialista de outro projeto',
      body: 'Abra Roles, escolha "Descobrir em outra pasta..." e selecione o projeto que possui a role. O Orkestrai valida os arquivos limitados em .orkestrai/roles desse projeto, importa apenas nomes novos e nunca sobrescreve uma role existente no workspace.',
      tags: ['Roles', 'instruções portáteis', 'importação segura'],
    },
    {
      id: 'custom-workflow',
      title: 'Um quadro com as etapas do seu processo',
      body: 'No cabeçalho de Tarefas, abra Etapas e monte o fluxo que faz sentido para você: Ideias → Produção → Revisão → Aprovação → Publicado. O líder e os especialistas passam a ler e atualizar essas etapas automaticamente, sem você aprender comandos.',
      tags: ['Etapas personalizadas', 'aprovação', 'qualquer processo'],
    },
    {
      id: 'campaign-launch',
      title: 'Campanha completa sem montar o time do zero',
      body: 'Escolha Campanha e lançamento na Biblioteca. O canvas nasce com líder de campanha, pesquisa de mercado, copy, canais e métricas, além de briefing e primeira tarefa. Para trabalho visual ou editorial, use Brand e design ou Conteúdo e SEO.',
      tags: ['Marketing', 'design', 'conteúdo'],
    },
    {
      id: 'orkestrai-contributing',
      title: 'Contribuir no Orkestrai com três perspectivas',
      body: 'Aplique Orkestrai Contributing. O Claude lidera, Codex e Kimi atuam como oráculos independentes e precisam aprovar o plano antes de qualquer tarefa ser criada; especialistas Svelar, desktop e QA/release executam o plano já documentado.',
      tags: ['Claude + Codex + Kimi', 'consenso', 'open source'],
    },
    {
      id: 'approval-pipeline',
      title: 'Pipeline escreve → revisa → aprova',
      body: 'Fluxo com 3 passos: Dev escreve a feature, Revisor critica (a saída de um vira {{input}} do outro) e o passo de Aprovação pausa até você dar OK no nó. O progresso aparece ao vivo e as últimas execuções ficam no histórico do fluxo.',
      tags: ['Fluxos', 'aprovação humana', 'pipeline'],
    },
    {
      id: 'chained-flows',
      title: 'Fluxos encadeados (pipeline de pipelines)',
      body: 'Conecte um Fluxo a outro no canvas: quando o primeiro termina com sucesso, a saída final dispara o próximo automaticamente (falha não encadeia, ciclo é bloqueado). Ex.: Fluxo "Pesquisa" → Fluxo "Redação" → Fluxo "Revisão SEO", ou fan-out — um Fluxo "extrai tópicos" alimentando os Fluxos "tradução EN" e "tradução ES" ao mesmo tempo. E com o botão Sincronizar, cada agente conectado ao Fluxo vira um passo na ordem das arestas — o pipeline é o próprio desenho.',
      tags: ['Fluxos', 'encadeamento', 'fan-out'],
    },
    {
      id: 'ui-exploration',
      title: 'Crie três direções completas de UI antes de implementar',
      body: 'Abra Design na barra do Canvas e escolha Três direções completas de UI. Informe objetivo, público, plataforma, destino do código, restrições, referências e se Light e Dark são obrigatórios. O Orkestrai cria um grupo rastreável com uma spec vinculada, oito tarefas progressivas no Kanban e três documentos Design nativos: Clareza, Expressiva e Eficiente. Cada designer começa somente com uma tela principal desktop e uma mobile, preferencialmente por importação semântica HTML/CSS, e deve mostrar a primeira revisão em até cinco minutos. O status no node distingue aguardando, trabalhando, parado e pronto para revisão. Abra o documento, use a seção Revisão visual de Qualidade para aprovar ou devolver com feedback; contagem de layers e auditoria estrutural não substituem essa inspeção. Somente a direção aprovada avança para estados responsivos, tokens tipados, componentes, protótipo e preview de código real. Em documentos largos, navegue com trackpad, Mão (H), Espaço+arraste ou botão do meio e use Ajustar. Finalize validando o resultado aprovado contra um Portal ou dispositivo móvel e registrando-o no Review Center.',
      tags: ['3 direções de UI', 'design + tokens + código', 'aprovação humana'],
    },
    {
      id: 'design-figma',
      title: 'Desenhe uma interface junto com seu time de IA',
      body: 'Adicione um node Design nativo e abra no Modo Design do Canvas ou no Workbench. Monte paths vetoriais, máscaras, gradientes, frames responsivos com auto layout e assets de imagem reutilizáveis ou cole um SVG para transformar paths, transforms, estilos e gradientes em camadas nativas editáveis. Agrupe ou desagrupe a arte, selecione todas as camadas que usam a mesma cor, substitua cores correspondentes em sólidos e stops de gradiente e copie a seleção como SVG ou PNG. Em Variáveis, use presets, importe ou exporte tokens, defina modos e aliases, vincule propriedades e audite repetições. Em Componentes, crie fontes, instâncias, propriedades, variantes, slots e overrides. Publique bibliotecas versionadas apenas para workspaces autorizados ou extraia e sincronize CSS variables, Tailwind e contratos Svelte, React ou Vue pela varredura estática da aba Código. Na aba Figma, mantenha o MCP remoto oficial gerenciado para agentes compatíveis, salve um token REST somente leitura no cofre do sistema operacional, inspecione o link do arquivo, escolha páginas ou frames e importe camadas, vetores, assets, estilos, variáveis, componentes, variantes, instâncias locais e identidades de bibliotecas externas para o mesmo documento nativo. Origens vinculadas comparam hashes remotos e locais antes de uma sincronização seletiva, para você decidir entre alteração do Figma, edição local e conflito. Escolher a versão local coloca somente aquela layer revisada na fila do Figma. O plugin próprio transfere a seleção ativa do Figma com imagens raster, copia SVG editável ou JSON estrutural, cria uma página no Figma com assets, variáveis, estilos, componentes e variantes nativos do documento Orkestrai e envia somente as alterações vinculadas da fila de volta ao arquivo atual por uma conexão do workspace restrita ao loopback. Conecte o documento ao Designer ou líder: o agente lê a revisão exata, combina o MCP oficial do Figma com tools tipadas de inspeção, import e sync do Orkestrai e verifica o resultado enquanto seu editor atualiza ao vivo. Os mappings existentes de Code Connect completam o vínculo persistente node Figma → camada Orkestrai → implementação. Exporte a seleção ou a página aprovada em SVG, PNG, JPEG, WebP ou PDF. Documento, assets, thumbnails, design system, vínculos Figma e histórico de revisões ficam no workspace e continuam pesquisáveis junto com tarefas, notas, arquivos, portais e o restante do time.',
      tags: ['Modo Design nativo', 'vetores + auto layout', 'manual + agentes'],
    },
    {
      id: 'design-delivery',
      title: 'Transformar design em código e validar a implementação',
      body: 'Abra um documento Design nativo e escolha Componentes → Código. Importe estruturas HTML/Tailwind, Svelte, React/JSX ou Vue como layers nativas editáveis sem executar código do projeto. Para entregar, selecione um frame ou grupo, escolha o adapter Svelar/Svelte 5, React, Next.js, Vue 3 ou HTML/Tailwind, revise o arquivo gerado completo e somente então grave dentro do workspace. Mappings compatíveis de Code Connect reutilizam primeiro os componentes reais do projeto; o artefato vinculado abre direto no Monaco e se recusa a sobrescrever um arquivo alterado depois da prévia. Agentes conectados usam design_import_code e design_generate_code_preview/apply pelo MCP tipado do Orkestrai, ou os comandos equivalentes da CLI incluída, com a mesma revisão e atribuição à tarefa. Em Validar, escolha um Portal ao vivo ou dispositivo iOS/Android conectado e um viewport de frame, celular, tablet ou desktop. O Orkestrai captura a implementação, normaliza as duas imagens e mostra design, implementação, overlay ajustável e pixel diff. Crie uma tarefa de feedback no Kanban com os três screenshots ou uma entrada na Central de Review vinculada à alteração Git real para que líder ou especialista possa reproduzir, atribuir e aprovar o resultado.',
      tags: ['design para código', 'pixel diff', 'Monaco + Central de Review'],
    },
    {
      id: 'design-prototype',
      title: 'Prototipar e animar a experiência antes da implementação',
      body: 'Abra um documento Design nativo e troque o inspetor direito de Design para Protótipo. Crie um ou mais fluxos iniciais, selecione qualquer layer e vincule interações de clique, pressionar, hover ou tempo que navegam para um frame, abrem ou fecham um overlay, voltam pelo histórico, rolam até um conteúdo ou trocam o modo de uma variável. Frames podem rolar na horizontal ou vertical enquanto filhos selecionados permanecem fixos. Execute o fluxo no player de apresentação focado com transições, hotspots, moldura de dispositivo, tela cheia e controles de reiniciar/voltar; depois compartilhe um protótipo HTML autocontido e somente leitura sem expor o workspace. Em Motion, crie tokens reutilizáveis de duração e easing, adicione tracks e keyframes por layer, visualize o resultado e copie keyframes CSS ou código Motion.dev. Protótipo, animação, variáveis, componentes, artefatos de código e histórico de revisões continuam no mesmo documento nativo, então designers e agentes conectados editam a mesma fonte pelo command bus MCP protegido por revisão.',
      tags: ['protótipo interativo', 'timeline de motion', 'manual + agentes'],
    },
    {
      id: 'design-collaboration',
      title: 'Revise trabalho visual com pessoas e agentes',
      body: 'Abra Colaboração num documento Design nativo. Siga um participante ao vivo, deixe um comentário na página ou layer e peça a um agente uma proposta versionada em vez de uma edição imediata. Inspecione o diff estrutural e a prévia e então aprove, rejeite, envie ao Council ou crie um Andar paralelo. Para um revisor externo, compartilhe o workspace e conceda somente o nível de Design necessário; o Companion recebe resumos sanitizados em vez do scene graph ou arquivos do projeto.',
      tags: ['presença ao vivo', 'comentários + propostas', 'Council + Andares'],
    },
    {
      id: 'design-quality',
      title: 'Audite e recupere um design de produção',
      body: 'Abra Qualidade em um documento Design nativo para encontrar problemas de nomes, cortes, sobreposição, contraste e acessibilidade e ir direto a cada layer. Comece um produto, página de marketing, fluxo mobile ou design system real a partir de um template nativo editável. Backup automático, migração de schema, histórico limitado, restauração explícita e renderização incremental protegem documentos grandes. Um agente conectado pode usar design_audit e aplicar os mesmos templates sem ignorar revisões.',
      tags: ['auditoria de qualidade', 'backup + recuperação', 'documentos grandes'],
    },
    {
      id: 'mcp-tools',
      title: 'Agentes com tools externas via MCP',
      body: 'Adicione servidores MCP no editor do workspace (ex.: filesystem, web, banco) — os agentes ganham as tools nativamente, e o Orkestrai em si aparece como servidor MCP com as ações do canvas (orkestrai mcp). Presets podem carregar os MCPs junto com o time.',
      tags: ['MCP', 'tools tipadas', '.mcp.json'],
    },
    {
      id: 'managed-ports',
      title: 'Liberar portas deixadas por dev servers',
      body: 'Crie um Portal local para o app (ex.: http://localhost:5173). O painel Portas, logo depois de Usage na barra inferior, mostra se esse listener está ativo, qual processo/PID o ocupa e permite encerrá-lo com confirmação. Só portas ligadas a Portais locais do workspace entram na lista; o servidor do próprio Orkestrai fica protegido.',
      tags: ['Portas', 'Portal', 'dev server'],
    },
    {
      id: 'leader-dictation',
      title: 'Ditar em qualquer campo de texto',
      body: 'Clique em qualquer campo editável — título ou descrição do kanban, role, nota ou formulário — e use a bolinha de voz global ou Alt+Espaço. Já no primeiro clique, o campo é preservado e a transcrição entra exatamente no cursor, sem exigir líder. Em Configurações → Ditado por voz, você pode ativar o envio automático: em terminais, a transcrição também pressiona Enter; campos comuns continuam apenas recebendo o texto. O badge clicável mostra se a bolinha está fixada ou livre e abre diretamente os controles de posição; o tooltip também exibe o atalho Ctrl+clique ou Command+clique. No Workbench, a posição fixada ocupa um espaço próprio no cabeçalho e não cobre abas nem ações; ao desafixar, ela volta a se mover livremente. Sem campo ativo, o controle encontra o líder do workspace tanto no Canvas quanto no Workbench. No macOS, Fn/Globe isolada pertence ao sistema; escolha um combo ou uma tecla F1–F12.',
      tags: ['Ditado global', 'campos de texto', 'voz local'],
    },
    {
      id: 'audio-devices',
      title: 'Escolher microfone e saída de áudio',
      body: 'Abra Configurações → Voz para escolher e testar o microfone usado em todo ditado local e a saída usada nas prévias e respostas faladas. Autorize o microfone para revelar os nomes dos dispositivos, observe o medidor de entrada ao vivo e reproduza um tom curto na saída antes de salvar. O ditado grava PCM direto pela mesma rota Web Audio do medidor e normaliza fala baixa antes do STT local. Se o dispositivo escolhido desaparecer, o Orkestrai volta ao padrão do sistema. Permissão negada, dispositivo ausente, captura interrompida, provável disputa e um dispositivo que abre sem produzir sinal recebem orientações diferentes; plataformas que não permitem direcionar o áudio do app explicam a limitação em vez de ignorar a escolha silenciosamente.',
      tags: ['Dispositivos de áudio', 'teste de microfone', 'teste de saída'],
    },
    {
      id: 'switch-agent-provider',
      title: 'Trocar o provider de um membro do time',
      body: 'No cabeçalho do agente, abra ⇄ e escolha outro provider instalado. O Orkestrai encerra somente a PTY e a conversa do provider anterior, preserva nome, role, Modo Maestro, andar, posição e conexões e inicia o substituto no mesmo nó.',
      tags: ['Providers', 'troca sem recriar', 'time preservado'],
    },
    {
      id: 'devin-local-agent',
      title: 'Usar o Devin como membro local do time',
      body: 'Instale e autentique a CLI oficial do Devin e crie um agente Devin pelo canvas. Pesquise a lista de modelos da conta no seletor limitado e rolável, escolha um e inicie com acesso autônomo ao workspace. O Orkestrai provisiona a ponte MCP e a skill nativas e retoma a conversa local exata depois de reiniciar o app.',
      tags: ['Devin CLI', 'agente local', 'retomada exata'],
    },
    {
      id: 'multilingual-spoken-replies',
      title: 'Ouvir respostas no seu idioma',
      body: 'Em Configurações → Voz, escolha uma das três vozes locais: português do Brasil, inglês dos Estados Unidos ou espanhol latino-americano. Ajuste a velocidade entre 0,75× e 1,50× e use Ouvir prévia para comparar antes de ativar o alto-falante no cabeçalho do agente. O Parakeet continua cuidando apenas do ditado; as respostas usam o Supertonic 3 offline e começam a tocar por frases para reduzir a espera.',
      tags: ['TTS', 'Supertonic 3', 'pt-BR · en-US · es-MX'],
    },
    {
      id: 'quota-aware-delegation',
      title: 'Distribuir trabalho sem estourar a cota',
      body: 'Adicione o nó Uso ao canvas, defina Claude como origem, Codex como fallback e escolha a janela de 5 horas, semanal ou mensal e o percentual. Antes de delegar uma tarefa nova, o líder consulta orkestrai usage e recomenda o agente saudável quando a origem cruza esse limite. O painel também explica por que Antigravity, Cursor, Devin, OpenCode ou Cline não fornecem o mesmo percentual automático e aponta cada fonte oficial em vez de adivinhar; conversas e tarefas em andamento permanecem no provider atual.',
      tags: ['Uso no canvas', 'fallback', 'delegação'],
    },
    {
      id: 'organize-canvas',
      title: 'Reorganizar um workspace que cresceu',
      body: 'Selecione os nós que deseja realinhar e escolha Organizar canvas na barra ou na paleta de comandos. O Orkestrai organiza somente a seleção; sem nada selecionado, organiza todo o canvas em linhas determinísticas sem sobrepor nós. As conexões permanecem atrás de todos os nós.',
      tags: ['Layout do canvas', 'seleção', 'conexões'],
    },
    {
      id: 'focused-workspace-view',
      title: 'Trabalhar com vários artefatos no Workbench',
      body: 'Use o seletor Canvas/Workbench no canto superior esquerdo para abrir o explorer agrupado de workspaces. Os itens abertos aparecem em abas verticais por padrão; em Configurações → Aparência, você pode preferir abas horizontais sobre cada painel. Divida o painel ativo para a direita ou para baixo e organize até oito terminais, quadros, notas, portais, arquivos, fluxos ou nós de uso redimensionáveis. Arraste uma aba para outro painel ou use seu menu Mover para. O layout é salvo por workspace, layouts antigos migram automaticamente e referências inválidas são descartadas com segurança. Artefatos do canvas preservam sua identidade persistida para manter sessões, conteúdo e alterações sincronizados; arquivos usam abas locais e não criam nós no canvas. Métricas da fonte e geometria do painel estabilizam antes de anexar uma PTY existente, mantendo o cursor piscante alinhado depois de passar por Configurações, documentação, Canvas ou Workbench. O rodapé mostra todas as janelas de uso reportadas por Claude, Codex e Kimi e abre os detalhes com um clique, usando o mesmo snapshot de cinco minutos da aba e do nó Uso. Command/Ctrl+Page Up ou Page Down percorre os itens, Shift alterna o painel e Command/Ctrl+\\ divide o painel. A bolinha de voz usa o líder do workspace ativo também nesta visualização. Ao voltar ao Canvas, o Orkestrai preserva o workspace e centraliza o nó selecionado.',
      tags: ['Workbench', 'até 8 painéis', 'divisões recursivas'],
    },
    {
      id: 'monitor-team-control-center',
      title: 'Ver o que o time realmente está fazendo',
      body: 'Abra a Central de controle de um workspace expandido no Workbench para comparar quem está trabalhando, ocioso, bloqueado, aguardando resposta ou offline. O explorer compacto mostra tarefa, estado e andar de cada agente ativo; agentes e nodes de andares aterrissados ou excluídos ficam no histórico sem inflar as contagens atuais. A caixa de comunicações comprova se um handoff entrou na fila, foi entregue, recebido, respondido ou falhou sob um id persistente. Troque de workspace ou reinicie o app sem acordar terminais ociosos: o histórico reconstrói a mesma visão operacional.',
      tags: ['Central de controle', 'entrega verificada', 'atividade dos agentes'],
    },
    {
      id: 'triage-attention-across-workspaces',
      title: 'Tratar todos os workspaces em uma central de atenção',
      body: 'Abra o sino ao lado de Canvas/Workbench para ver perguntas, pedidos de permissão, bloqueios e falhas de todos os workspaces, com o atual primeiro. Expanda qualquer item para ler a mensagem e a solicitação original completas sem sair da central. Abrir origem é uma ação separada e fica indisponível quando o agente ou tarefa já foi removido; ainda assim, o conteúdo persistido continua legível. Marque como lido, adie ou resolva sem perder o histórico. Use Command/Ctrl+K com type:attention, workspace:"Nome", agent:"Nome", status:open, has:error, before: ou after: para recuperar o mesmo evento depois.',
      tags: ['Central de atenção', 'triagem entre workspaces', 'operadores de busca'],
    },
    {
      id: 'trace-delivery-workstream',
      title: 'Rastrear uma entrega do briefing à evidência Git',
      body: 'Crie e atribua o trabalho no Kanban e abra Fluxos de trabalho no Workbench. A tarefa vira a identidade estável da entrega: agente e andar aparecem automaticamente, decisões do Conselho mantêm o mesmo briefing, a Central de revisão vincula a revisão e os arquivos exatos, e a timeline explica cada transição. Abra o quadro, Conselho ou revisão original a qualquer momento; o fluxo nunca substitui nem duplica esses registros.',
      tags: ['Fluxos de trabalho', 'rastreabilidade ponta a ponta', 'Kanban ao Git'],
    },
    {
      id: 'preserve-sourced-workspace-memory',
      title: 'Preserve uma decisão sem perder sua fonte',
      body: 'Abra Memória do workspace, registre a decisão ou restrição reutilizável e associe a declaração do usuário, tarefa, nota, arquivo, URL, mensagem, revisão ou Conselho que a sustenta. Agentes consultam a mesma evidência somente quando relevante. Quando a decisão mudar, revise-a a partir da versão atual para manter o valor anterior auditável e impedir que edições concorrentes se sobrescrevam silenciosamente.',
      tags: ['Memória do workspace', 'procedência', 'decisões versionadas'],
    },
    {
      id: 'triage-traceable-annotations',
      title: 'Faça a triagem de feedback de código e design em um só lugar',
      body: 'Abra a Central de Anotações pelo Canvas ou Workbench para comparar todos os comentários abertos da Central de revisão e threads do Design nativo. Pesquise por feedback, autor, arquivo, camada ou artefato, inspecione revisão e obsolescência e abra a fonte canônica para responder ou resolver. A central nunca cria uma cópia desconectada do feedback.',
      tags: ['Central de Anotações', 'feedback de código + design', 'rastreabilidade de revisão'],
    },
    {
      id: 'version-and-share-team-pack',
      title: 'Versione e compartilhe um time completo',
      body: 'Capture o workspace atual como Team Pack customizado, publique uma versão semântica com notas e inspecione checksums imutáveis. Exporte para outra instalação ou importe um arquivo compartilhado após o Orkestrai validar schema, tamanho, conteúdo e SHA-256. Agentes, roles, skills, etapas, rotinas, configuração MCP e layout viajam; sessões e credenciais não.',
      tags: ['Team Packs', 'versões semânticas', 'importação e exportação seguras'],
    },
    {
      id: 'run-agent-huddle',
      title: 'Chegue a uma decisão com um huddle persistente de agentes',
      body: 'Abra Huddles, defina assunto e pauta, escolha facilitador e agentes participantes e escreva ou dite uma fala para quem precisa opinar. Acompanhe respostas pendentes e concluídas numa transcrição ordenada, ouça as novas quando o TTS estiver ativo e permita que agentes participantes registrem descobertas concisas pela ponte. Encerre quando a decisão estiver clara e crie uma tarefa Kanban vinculada para manter pauta e transcrição no fluxo da entrega. Um colaborador remoto participa da mesma sala sanitizada conforme permissão para visualizar, falar ou gerenciar.',
      tags: ['Huddle persistente', 'ditado + TTS', 'evidência na tarefa'],
    },
    {
      id: 'edit-and-preview-files',
      title: 'Editar e inspecionar arquivos sem sair do Workbench',
      body: 'Expanda Arquivos no sidebar do Workbench e abra um arquivo do workspace diretamente em uma aba local, sem criar um nó no canvas. A árvore de arquivos do Canvas e o Command/Ctrl+K usam a mesma abertura direta. O Monaco preserva cursor, undo, seleção e estado não salvo entre painéis. Busque ou substitua texto, navegue por símbolos, formate arquivos compatíveis e escolha minimapa, quebra de linha, tamanho da fonte ou autosave opcional em Configurações → Aparência. Markdown alterna entre fonte e prévia sanitizada; PDFs têm navegação e zoom; imagens permitem zoom, pan, dimensões e transparência; binários exibem metadados e abrem no aplicativo do sistema. Arquivos acima de 512 KB abrem em uma prévia limitada e somente leitura para nunca sobrescrever conteúdo que não foi carregado.',
      tags: ['Editor Monaco', 'prévias offline', 'estado não salvo'],
    },
    {
      id: 'share-reference-material',
      title: 'Entregar contexto completo para o time',
      body: 'Arraste uma imagem, PDF, arquivo ou link HTTP/HTTPS para a nota de briefing, o composer de um agente ou um cartão do kanban. O Orkestrai guarda arquivos de até 10 MB dentro do workspace, insere uma referência legível e entrega título, descrição e todos os anexos quando o líder ou agente recebe a tarefa.',
      tags: ['Anexos', 'drag and drop', 'briefing completo'],
    },
    {
      id: 'universal-workspace-search',
      title: 'Encontrar qualquer item sem navegar por menus',
      body: 'Pressione Command/Ctrl+K em qualquer tela para buscar workspaces, agentes, tarefas, notas, ferramentas, roles, skills, arquivos, configurações e comandos. A busca mostra contexto e prévia, guarda itens recentes e favoritos e permite abrir um artefato no painel atual, à direita ou abaixo. Para buscar dentro do conteúdo dos arquivos do workspace, use o prefixo content:. A leitura permanece confinada à pasta do workspace.',
      tags: ['Busca universal', 'Command/Ctrl+K', 'arquivos e comandos'],
    },
    {
      id: 'review-delivery',
      title: 'Revisar uma entrega com evidências e decisão clara',
      body: 'Abra a Central de revisão no Workbench, selecione os arquivos alterados e crie uma revisão vinculada à tarefa do kanban e ao agente responsável. Registre screenshots ou evidências da entrega, testes executados e riscos conhecidos. Adicione comentários em arquivos ou linhas exatas e então aprove, solicite alterações ou rejeite. As alterações solicitadas são enviadas ao terminal do agente quando ele está disponível; se o código mudar antes, o comentário original permanece marcado como contexto desatualizado.',
      tags: ['Central de revisão', 'diff Monaco', 'feedback para agente'],
    },
    {
      id: 'portal-design-feedback',
      title: 'Apontar um problema visual em vez de descrevê-lo de memória',
      body: 'Abra o app em um Portal e escolha Inspecionar design. Clique no botão, título, campo, imagem ou área de layout que precisa de atenção, revise o screenshot recortado e o contexto seguro do elemento e descreva o resultado esperado. Crie uma tarefa sem responsável para triagem do líder, uma tarefa já atribuída a um especialista ou acrescente o feedback a uma tarefa existente. Todo envio fica rastreável no Kanban sem expor segredos do browser.',
      tags: ['Portal Design Mode', 'feedback visual', 'inspeção segura'],
    },
    {
      id: 'remote-collaboration',
      title: 'Compartilhar um workspace sem compartilhar sua máquina',
      body: 'Habilite o compartilhamento experimental, inicie uma sessão criptografada de ponta a ponta e escolha um convite para Navegador/celular ou App Orkestrai. O link web abre o PWA Remote instalável. O convite do app abre automaticamente o Orkestrai instalado; o convidado também pode usar Workspace → Entrar em workspace remoto e colar o convite. Ambos removem o segredo da URL antes da conexão e guardam uma chave de pareamento não extraível somente naquele dispositivo. Confira a impressão digital e escolha Leitor, Colaborador, Operador ou Administrador. Um Operador pode manter conversas sanitizadas e rastreáveis com o líder ou outro agente e ditar em qualquer uma delas usando o STT local do host. A tela principal mantém o histórico do líder visível; quando ele usa ferramentas e fala em várias etapas, o Remote aguarda o fim real do turno e reúne todos os blocos antes de publicar a resposta. Um Administrador também pode iniciar ou restaurar um agente offline. O terminal bruto é uma permissão separada, exclusiva de Administrador naquele dispositivo, desativada por padrão, limitada a um terminal, responsiva à tela atual, com limite de tráfego, criptografia e auditoria. O ditado do terminal insere o texto sem pressionar Enter. Ela não libera navegação de arquivos, visualização de Portal ou dispositivo mobile nem edição do Canvas. Revogue o dispositivo ou encerre a sessão a qualquer momento e consulte comandos aceitos e rejeitados na auditoria.',
      tags: ['PWA Remote criptografado', 'ditado no host', 'terminal responsivo opt-in'],
    },
    {
      id: 'custom-app-theme',
      title: 'Adaptar a aparência ao seu trabalho',
      body: 'Escolha um dos três temas escuros ou o tema claro de alto contraste em Configurações → Aparência. Duplique o mais próximo da sua preferência, ajuste os tokens de cor com prévia imediata e exporte o JSON para usar o mesmo tema em outra instalação.',
      tags: ['Temas', 'tokens semânticos', 'importar/exportar'],
    },
    {
      id: 'windows-wsl-agents',
      title: 'Usar ferramentas instaladas somente no WSL',
      body: 'Escolha o runtime mais usado ao criar ou editar o workspace no Windows. Para misturar ambientes, abra o menu compacto de cada terminal, selecione Ambiente de execução e escolha Padrão do workspace, Windows nativo ou a distribuição WSL exata onde Kimi, Claude, Codex ou outra CLI está instalada. Informe o caminho Linux correspondente à mesma pasta do projeto. O badge WIN/WSL confirma a exceção, e somente aquele terminal reinicia. Canvas, arquivos, tarefas e notas continuam compartilhados enquanto cada agente usa suas próprias ferramentas.',
      tags: ['Windows + WSL', 'múltiplas distribuições', 'providers locais'],
    },
    {
      id: 'provider-profiles',
      title: 'Separar contas pessoais e de trabalho dos providers',
      body: 'Abra a Central de Providers, expanda Claude, Codex, Kimi, GitHub Copilot, Cursor, Cline ou OpenCode e adicione um Perfil nomeado apontando para o diretório ou os diretórios de configuração daquela conta, conforme documentado pela CLI. Escolha-o no diálogo de Novo agente ao criar, ou depois no menu do terminal, ou roteie novos trabalhos para ele pelo nó Uso. O Orkestrai guarda no banco somente a referência do Perfil e os caminhos; as credenciais continuam nos arquivos da própria CLI e são resolvidas no servidor apenas quando a PTY inicia. Um Perfil usado por terminal ou regra de roteamento não pode ser excluído. Antigravity e Devin ficam indisponíveis aqui enquanto não houver um override de conta da CLI seguro, documentado e verificável em todas as plataformas.',
      tags: ['Perfis de provider', 'múltiplas contas', 'isolamento de credenciais'],
    },
    {
      id: 'saved-terminal-commands',
      title: 'Reabrir um shell já pronto para trabalhar',
      body: 'Abra o menu de opções de um terminal e escolha Comandos salvos. Guarde atalhos exclusivos daquele terminal ou comandos globais disponíveis em todos eles, pesquise pelo nome ou conteúdo e execute qualquer item manualmente. Em shells puros, ative Executar ao retomar para disparar os comandos uma única vez quando a sessão for criada ou restaurada, inclusive no WSL. O Orkestrai nunca autoexecuta texto em Claude, Codex, Kimi ou outro agente para não contaminar conversas. Os comandos ficam em texto simples: use variáveis de ambiente ou o cofre da ferramenta para segredos, nunca senhas e tokens no comando salvo. Os terminais preservam o ambiente do sistema operacional e a ponte do Orkestrai, mas excluem valores privados do servidor desktop para que o .env de cada projeto, incluindo a APP_KEY do Laravel, tenha prioridade.',
      tags: ['Comandos salvos', 'autoexec seguro', 'shells e WSL'],
    },
    {
      id: 'desktop-diagnostics',
      title: 'Diagnosticar uma ação do desktop que não responde',
      body: 'Abra Visualizar > Ferramentas do desenvolvedor e reproduza o problema observando o Console. Depois escolha Ajuda > Abrir pasta de logs e compartilhe o arquivo orkestrai.log com o suporte. O log local rotativo inclui erros do renderer, falhas do servidor interno e encerramentos inesperados; credenciais comuns são ocultadas e a saída normal dos agentes não é persistida.',
      tags: ['Ferramentas do desenvolvedor', 'logs locais', 'suporte'],
    },
  ],
  changelog: [
    {
      date: '26 ago 2026 · 0.21.0',
      title: 'Orkestrai 0.21.0: Roles portáteis e criação mais rápida de workspaces',
      summary: 'Reuse Roles especialistas, escolha a conta certa do provider e arquive o workspace numa pasta durante a criação.',
      items: [
        'Adicionado o botão "Descobrir em outra pasta..." ao lado do discover do repositório já existente em Roles: escolha qualquer pasta num diálogo nativo e o Orkestrai importa toda `role.json` encontrada dentro de `.orkestrai/roles/` ali.',
        'Arquivos de role importados têm limites de tamanho e quantidade, são validados antes da persistência, ficam confinados ao projeto selecionado e nunca sobrescrevem uma role existente no workspace.',
        'Adicionado um campo Perfil no diálogo de Novo agente para providers com Perfis de multi-conta configurados.',
        'O par perfil/provider é validado antes de persistir o terminal; credenciais permanecem no armazenamento seguro e nunca entram nos dados do canvas.',
        'Adicionado um campo Pasta no diálogo de Novo workspace, e um ícone de mais no cabeçalho de cada pasta que abre o diálogo com ela pré-selecionada como destino.',
        'Workspaces comuns ou baseados em preset são persistidos diretamente no destino validado, evitando criação parcial na raiz quando a pasta é inválida.',
      ],
    },
    {
      date: '25 ago 2026 · 0.20.1',
      title: 'Orkestrai 0.20.1: configuração MCP segura no Codex',
      summary: 'O Codex mantém a ponte automática do workspace sem abrir mão do controle sobre o dotfile global ou a visibilidade no Git.',
      items: [
        'O Codex recebe as definições MCP do Orkestrai e do Figma oficial por parâmetros temporários ao iniciar em runtime nativo ou WSL; o provisionamento deixa de reescrever ~/.codex/config.toml.',
        'A estrutura exata de args multilinha órfãos e env duplicado escrita por builds antigos é reparada após validação, com backup, acesso serializado e substituição atômica; TOML inválido sem relação com esse bug permanece intocado.',
        'AGENTS.md, arquivos MCP dos providers e opencode.json deixam de ser ocultados pelo .git/info/exclude; blocos legados exatos são reduzidos aos diretórios de runtime e skills pertencentes ao Orkestrai.',
        'Falhas ao provisionar a ponte agora entram nos diagnósticos do desktop em vez de desaparecer silenciosamente.',
      ],
    },
    {
      date: '25 ago 2026 · 0.20.0',
      title: 'Orkestrai 0.20.0: workspaces organizados e providers mais completos',
      summary: 'Pastas aninhadas, testes responsivos no Portal, mais personalização de terminais e gestão segura de MCPs e skills para todos os providers chegam juntos.',
      items: [
        'Servidores MCP e skills adicionados ao workspace agora se propagam aos formatos nativos de Cursor, Cline, Devin, Antigravity e OpenCode, acompanhando os providers já cobertos pela ponte do Orkestrai.',
        'O marketplace de Skills abre com um catálogo curado, combina resultados ao vivo com segurança e valida downloads do registro antes que cheguem ao workspace.',
        'Workspaces podem ser organizados em pastas aninhadas persistentes na barra lateral do Canvas, com arrastar e soltar, subpastas, renomeação, estado recolhido, prevenção de ciclos e exclusão não destrutiva.',
        'O Portal ganhou nome persistente editável separado do endereço, automação por nome único ou id, inventário de todos os Portais do workspace com conexão explícita, reutilização de URLs repetidas, barra de endereço coerente com o tema ativo e viewport responsivo real com rolagem contida.',
        'Configurações mostra uma prévia de cores, fonte e padding do terminal, usa o modificador correto do sistema e adiciona Monokai, Ayu Dark, Rosé Pine e Solarized Light.',
        'A seleção no terminal ficou precisa em qualquer zoom do Canvas, o Uso de Perfis do Claude lê credenciais específicas do Keychain no macOS, os ícones de providers e ferramentas permanecem consistentes entre temas, os estados de carregamento do Workbench têm semântica assistiva válida e excluir o workspace ativo troca com segurança para longe dos PTYs encerrados.',
        'Os builds desktop instalados voltam a expor as Ferramentas do desenvolvedor e permitem abrir uma pasta de diagnóstico rotativa e limitada que registra falhas do renderer e servidor interno ocultando credenciais comuns.',
        'O provisionamento de workspaces permanece compatível com fluxos de criação que omitem a lista opcional de repositórios adicionais, tratando-a como vazia em vez de falhar.',
      ],
    },
    {
      date: '24 ago 2026 · 0.19.0',
      title: 'Orkestrai 0.19.0: contas, status, identidade dos providers e roteamento mais claro',
      summary: 'Ficou mais fácil identificar, monitorar e rotear providers entre várias contas, com novo tema de terminal e um nó de Uso realmente utilizável.',
      items: [
        'Uso e roteamento agora abre num tamanho inicial útil, mostra o Roteamento do líder antes dos providers, reorganiza controles em larguras estreitas e contém a rolagem por mouse, trackpad, toque e teclado sem ampliar o canvas.',
        'Adicionados Perfis de provider nomeados, roteamento de Uso por perfil, status público ao vivo, marcas específicas nos agentes do Canvas, GitHub Copilot como provider de agente e o tema de terminal Obsidian.',
        'Credenciais de Perfis nunca entram no payload do canvas: só a referência e caminhos não secretos persistem, os valores são resolvidos no servidor ao iniciar a PTY, o armazenamento seguro é verificado, referências ativas bloqueiam exclusão e chaves de API do Devin não são aceitas como perfil da CLI local.',
        'Nomes de Perfil são únicos sem diferenciar maiúsculas, colisões legadas migram com segurança, UUIDs completos sobrevivem ao roteamento de Uso, erros são traduzidos e uma falha ao consultar o status público aparece como indisponível, não como saudável.',
        'O WebSocket de PTY aceita conexões do navegador somente pelo Orkestrai na porta exata do app, impedindo que outro site em localhost abra ou controle sessões de terminal.',
      ],
    },
    {
      date: '24 ago 2026 · 0.18.1',
      title: 'Orkestrai 0.18.1: estado confiável de projeto, Portal, voz e terminal',
      summary: 'Ambientes de projeto ficam isolados enquanto navegação, ditado e terminais se recuperam de forma confiável no desktop.',
      items: [
        'Os processos de terminal mantêm o ambiente do sistema operacional e a ponte do Orkestrai, mas removem a APP_KEY do desktop e todas as variáveis privadas carregadas pelo runtime do app. Registros criptografados, cookies e sessões do Laravel passam a usar o .env do projeto e deixam de falhar com “The MAC is invalid”.',
        'Pop-ups de login dos Portais agora abrem numa janela sandboxed do Orkestrai com a mesma sessão persistente, em vez de escapar para o browser do sistema. Cookies e storage são gravados em disco, e cada nó Portal restaura sua última URL navegada.',
        'O ditado agora grava PCM direto pela mesma rota Web Audio do medidor, normaliza fala baixa e identifica claramente quando o microfone selecionado abriu sem produzir sinal.',
        'A fonte e a geometria do terminal estabilizam antes de anexar novamente a PTY, e o histórico ANSI termina de ser processado antes do redraw final, mantendo o cursor do xterm alinhado ao voltar para o Canvas.',
      ],
    },
    {
      date: '23 ago 2026 · 0.18.0',
      title: 'Orkestrai 0.18.0: coordenação durável, conhecimento com fontes e times reutilizáveis',
      summary: 'Mensagens, atividade, atenção, entrega, memória, anotações, Team Packs e Huddles agora preservam seu contexto operacional.',
      items: [
        'Cada mensagem entre agentes agora possui um envelope canônico com destinatário e conteúdo verificados, recibos duráveis, correlação, deduplicação e proteção contra replay.',
        'A Central de controle adiciona uma timeline semântica de Atividade para mensagens, tarefas, revisões, decisões, Git e eventos do sistema, com diagnósticos brutos sob demanda.',
        'Uma Central de atenção global prioriza perguntas, pedidos de permissão, bloqueios e falhas de todos os workspaces e permite ler, adiar, resolver e abrir a origem.',
        'Command/Ctrl+K agora indexa atividade, mensagens canônicas e atenção com operadores de tipo, agente, workspace, status, erro e data.',
        'O Workbench adiciona Fluxos de trabalho, uma projeção ao vivo de cada tarefa do Kanban até responsável, andar, decisões do Conselho, revisões, atividade semântica e evidência Git exata.',
        'A Memória do workspace preserva decisões, fatos, preferências, restrições, referências e aprendizados com fontes, busca, revisões imutáveis, proteção contra conflitos, histórico e acesso sob demanda para agentes via MCP/CLI.',
        'A Central de Anotações projeta feedback de revisão de código e Design nativo sem perder artefato canônico, autoria, alvo, revisão, resolução e aviso de código desatualizado.',
        'Presets customizados agora são Team Packs versionados, com releases semânticas, histórico local imutável, verificação SHA-256, importação limitada e sem estado vivo ou credenciais.',
        'Falhas ao importar, exportar ou publicar versões de Team Packs agora permanecem no idioma selecionado na UI, sem expor mensagens internas do servidor.',
        'Huddles persistentes reúnem pessoas e agentes selecionados em uma transcrição limitada com ditado, TTS opcional, respostas direcionadas, contribuições por CLI/MCP, permissões remotas criptografadas, retomada do ciclo de vida e evidência vinculada ao Kanban e aos Fluxos de trabalho.',
        'A janela de Huddles agora aproveita a área disponível, mantém histórico e transcrição com rolagem independente, reorganiza o conteúdo em janelas estreitas e oferece uma ação de fechar sempre visível.',
        'A paleta Command/Ctrl+P agora usa a pilha compartilhada de modais e volta a fechar corretamente por Escape ou clique fora, inclusive após abrir Huddles.',
        'Agentes agora vinculam coleções Bruno, OpenCollection e Postman pelo caminho relativo ou por um alias de repositório irmão autorizado, como @api-tests/bruno. Canvas e Workbench exibem as mesmas requests, enquanto a sincronização atômica persiste scripts e testes nos arquivos do repositório real, bloqueia escapes não autorizados e expõe conflitos antes de substituir qualquer lado.',
        'No Windows, Ctrl+C e clique direito copiam o texto selecionado do terminal pela área de transferência nativa; sem seleção, Ctrl+C continua interrompendo o processo em execução.',
        'A Central de atenção agora expande a mensagem e a solicitação original completas no próprio item, separa a navegação para a origem e identifica quando o agente ou tarefa já foi removido.',
        'Respostas de agentes agora são correlacionadas ao turno exato do provider, mesmo após mensagens posteriores ou descoberta tardia da sessão; entregas concorrentes ao mesmo terminal são serializadas e não geram mais falhas falsas de transcript estruturado.',
        'O recrutamento do Maestro agora herda o andar ativo, inicia e valida a PTY no runtime correto inclusive no WSL e desfaz nós incompletos. Tarefas atribuídas só entram em Fazendo após iniciar ou retomar o agente e entregar o briefing ao terminal.',
        'Briefings longos enviados ao Codex no Windows e WSL agora aguardam o composer processar o texto, confirmam atividade após o envio e repetem somente o Enter quando o TUI não o reconhece.',
      ],
    },
    {
      date: '22 ago 2026 · 0.17.0',
      title: 'Orkestrai 0.17.0: autoria completa de testes de API para pessoas e agentes',
      summary: 'Testes JavaScript por runtime, autocomplete e autoria protegida por MCP/CLI agora compartilham um único modelo de coleção.',
      items: [
        'A aba Testes agora alterna entre assertions estruturadas e um editor JavaScript de altura completa com autocomplete contextual para Bruno, Postman e Orkestrai nativo. Scripts de teste executam separados da automação pós-resposta e fazem round-trip nos exports Bruno e Postman.',
        'Agentes e líderes conectados podem criar, ler, substituir com fingerprint, executar e exportar coleções completas pelas tools MCP api_client_* ou pela CLI. Mudanças concorrentes na UI ficam protegidas, segredos locais permanecem mascarados e arquivos exportados ficam dentro do workspace.',
      ],
    },
    {
      date: '22 ago 2026 · 0.16.0',
      title: 'Orkestrai 0.16.0: runtimes oficiais de scripts Postman e Bruno',
      summary: 'O Cliente de API nativo executa automações importadas com runtimes oficiais compatíveis com a origem, escopos portáteis e segredos criptografados.',
      items: [
        'Scripts do Cliente de API agora rodam pelo Postman Runtime oficial ou pelo runtime QuickJS seguro oficial do Bruno, com escopos separados, sendRequest/runRequest, cookies, controle de fluxo, visualizações, bibliotecas incluídas, testes Chai completos e vault criptografado pelo sistema operacional. Variáveis, assertions e blocos tests importados do Bruno executam nativamente, enquanto runners expõem dados e metadados corretos de iteração.',
        'A documentação agora possui uma referência completa e pesquisável de scripts do Cliente de API, com exemplos copiáveis e separados para Postman Runtime, Bruno QuickJS e testes declarativos nativos, além do limite explícito dos serviços exclusivos da nuvem Postman.',
      ],
    },
    {
      date: '20 ago 2026 · 0.15.0',
      title: 'Orkestrai 0.15.0: comandos reutilizáveis e Cliente de API multiprotocolo',
      summary: 'A inicialização dos shells fica repetível enquanto o Cliente de API cobre edição, execução, segurança, respostas e sincronização no fluxo diário.',
      items: [
        'Scripts pré-request ou pós-resposta inválidos agora identificam a etapa exata do request ou da coleção e a linha de origem, em vez de reduzir falhas do QuickJS a um erro genérico de execução da API.',
        'O Cliente de API nativo agora executa requests HTTP/REST, GraphQL, WebSocket e gRPC. GraphQL inclui query, variáveis e seleção de operação; WebSocket adiciona fila de mensagens, reconexão, keepalive e transcript bidirecional; gRPC carrega arquivos proto locais e oferece os quatro modos de streaming.',
        'O OAuth 2.0 assistido oferece authorization code com state e PKCE, além dos grants diretos de client credentials, senha e refresh token. HTTP e WebSocket compartilham cookies, proxy, CA própria, certificados de cliente PEM ou PKCS#12 e controle de verificação TLS.',
        'Origens Bruno e OpenCollection vinculadas agora têm pull, push, monitoramento a cada cinco segundos, fingerprints, limpeza de arquivos obsoletos e resolução explícita de conflitos. Links Postman e OpenAPI continuam somente para pull.',
        'Campos JSON, JavaScript, GraphQL e XML agora usam editores com sintaxe, busca, quebra de linha e formatação. Respostas JSON/XML aparecem como árvores expansíveis, transcripts de protocolo abrem diretamente e as visões ativas de request, script e resposta usam um estado temático inequívoco.',
        'A modal de runners da coleção de API agora mantém todo o rodapé de ações visível em janelas mais baixas e reorganiza os controles de forma responsiva. Ao reordenar requests e pastas, a interface mostra o destino exato antes, depois ou dentro da pasta.',
        'Cada terminal agora possui comandos salvos pesquisáveis, exclusivos ou globais. O gerenciador marca claramente o escopo ativo, comandos de inicialização idênticos são deduplicados entre os dois escopos e um respawn do PTY não envia o mesmo comando de retomada duas vezes.',
        'O Cliente de API nativo agora oferece pastas aninhadas, drag-and-drop que não move o node, ações de clique direito e vários runners persistentes com seleção e ordem de requests, ambiente, iterações, intervalo, parada ao falhar e variáveis encadeadas entre requests.',
        'Coleções de API agora podem ser exportadas para Bruno pelo serializador oficial ou para Postman v2.1 preservando metadados REST que o Orkestrai não edita diretamente. Um formato versionado do Orkestrai restaura todo o estado nativo, incluindo pastas, runners, ambientes, scripts e histórico.',
        'Contratos Swagger 2.0 e OpenAPI 3.x agora são importados com referências locais limitadas, exemplos gerados, mapeamento de autenticação e notas visíveis de fidelidade. Coleções exportam como OpenAPI 3.1 JSON/YAML ou OpenCollection YAML e ambientes Postman são movidos separadamente.',
        'O inglês agora é o padrão real da inicialização, inclusive na splash do Electron exibida antes de carregar as configurações; o idioma salvo continua assumindo o app assim que ele fica pronto.',
        'Avisos de credencial, token, timeout e API de provider no Uso agora usam códigos estáveis traduzidos em pt-BR, inglês e espanhol, sem exibir texto interno do backend em português.',
        'Criar ou editar uma request de API não eleva mais toda a área invisível do node sobre vizinhos de camada superior; menus de terminal e ferramentas do Canvas continuam clicáveis após usar o Cliente de API.',
        'Os atalhos de teclado do Canvas e do Design Studio agora ignoram com segurança eventos do browser cujo alvo seja Window, um node de texto ou outro alvo que não seja elemento, em vez de travar com “closest is not a function”.',
        'O DOMPurify 3.4.14 agora é aplicado em toda a árvore de dependências do Monaco, eliminando todos os alertas conhecidos do npm audit sem rebaixar nem substituir o editor.',
        'Os formulários de Automações voltaram a criar, editar e ativar automações e a salvar integrações do GitHub sem rejeitar incorretamente os parâmetros internos da rota.',
        'A troca de idioma no onboarding agora mantém o assistente aberto na etapa de boas-vindas durante a remontagem da interface.',
        'Excluir um workspace agora encerra seus terminais ativos antes de remover os nodes persistidos, evitando processos órfãos e eventos de atividade tardios.',
        'Voltar ao Workbench por um link direto do Canvas agora preserva o node exato em seu painel existente em vez de perder a divisão da tela.',
        'Criar um agente agora reutiliza o status do provider já verificado no runtime do workspace, evitando uma nova varredura de CLIs e o botão bloqueado sem necessidade.',
        'Os nodes do Canvas e do Workbench agora aparecem sem aguardar a varredura mais lenta de providers; terminais recém-criados e selecionados recuperam o foco após persistir a sessão e a troca de visualização preserva o node durante o carregamento assíncrono.',
        'A digitação feita durante o handshake da PTY agora fica numa fila curta e é entregue à sessão criada, enquanto o xterm permanece montado durante a persistência do ID.',
        'O tour de exploração guiada de UI agora cria briefing, quadro de tarefas e três direções editáveis por Fazer por mim, em vez de ficar parado atrás de uma configuração não enviada.',
      ],
    },
    {
      date: '19 ago 2026 · 0.14.0',
      title: 'Orkestrai 0.14.0: pacotes RPM nativos para Linux',
      summary: 'Fedora, RHEL, CentOS e distribuições compatíveis agora têm um instalador nativo do Orkestrai.',
      items: [
        'Toda release Linux agora publica um RPM junto ao AppImage existente.',
        'O pacote inclui os metadados públicos de mantenedor exigidos por instaladores nativos do Linux.',
        'Os arquivos RPM usam o mesmo nome estável do produto Orkestrai adotado pelos outros instaladores.',
        'O pipeline de release verifica o RPM e sua entrada no latest-linux.yml antes de publicar qualquer artefato.',
        'Instalações RPM usam o fluxo de atualização do Linux compatível com o gerenciador de pacotes.',
      ],
    },
    {
      date: '18 ago 2026 · 0.13.0',
      items: [
        'O Orkestrai 0.13.0 mantém o teclado do terminal isolado dos atalhos de acessibilidade do Canvas. Escape chega corretamente ao Vim, editores de merge/rebase, pagers e outras TUIs sem desselecionar o node nem tirar o foco do xterm; busca e ditado continuam locais ao terminal.',
        'O scroll dentro de terminais e outros nodes do Canvas agora permanece isolado mesmo quando chega ao início ou ao fim do conteúdo. O zoom do Canvas só responde quando o ponteiro está sobre a área livre do próprio Canvas.',
        'As formas do Canvas agora exibem uma ação visível de duplicar e aceitam Cmd/Ctrl+D. Cmd/Ctrl+C e Cmd/Ctrl+V copiam e colam uma forma ou um arranjo completo de seleção múltipla preservando tamanho, texto, estilos, geometria editável das setas e espaçamento relativo.',
        'Novo Cliente de API nativo no Canvas e Workbench: crie e envie requests com método, URL, headers, autenticação Bearer/Basic, body e variáveis, veja status, duração, tamanho e resposta formatada, importe pastas Bruno pelo parser oficial ou coleções Postman v2.1 e reabra a origem no aplicativo instalado.',
        'Terminais shell nativos agora preservam a pasta atual após reiniciar o Orkestrai. Cursor e os demais providers também recebem uma tool explícita para listar notas existentes antes de ler ou editar, evitando duplicatas e arrays vazios.',
        'Command/Ctrl+K voltou a pesquisar toda a documentação localizada junto com o conteúdo dos workspaces. Tópicos, casos de uso e itens do changelog ignoram diferenças de acento, abrem na âncora exata e continuam disponíveis mesmo se a busca do workspace falhar.',
        'Documentos Design grandes agora expandem a área de trabalho ao redor de todos os frames em vez de cortar o que passa da página nominal. Use trackpad ou scroll, a ferramenta Mão (H), Espaço+arraste ou o botão do meio para navegar; Ajustar enquadra todo o conteúdo e o zoom chega a 2%. Exports e thumbnails usam os mesmos limites completos. Agentes conectados consultam design_reference uma vez, criam até 2.000 layers com design_create_elements ou aplicam layers, tokens, bindings, componentes, protótipo e motion juntos com design_apply_blueprint. Explorações guiadas proíbem explicitamente inspecionar a instalação, fazer probes de schema ou criar scratch scripts de descoberta.',
        'Workbench e Central de controle não acumulam mais agentes, quadros e outros nodes de andares já aterrissados ou excluídos. O upgrade arquiva o legado, a finalização do andar remove edges obsoletas, agentes ativos recebem o nome do andar e clones de layout iniciam sem reutilizar sessão PTY ou conversa do provider. O recrutamento pela ponte agora respeita e valida o andar solicitado.',
        'A exploração guiada de UI agora trabalha em gates progressivos. Cada direção entrega primeiro somente uma tela desktop e uma mobile por composição semântica compacta, com primeira revisão esperada em até cinco minutos. Os nodes exibem aguardando, trabalhando, parado ou pronto; a aba Qualidade permite aprovar a revisão atual ou solicitar mudanças com feedback rastreável. Somente a direção aprovada expande para estados, tokens, componentes, protótipo e código, e a auditoria estrutural não é mais apresentada como prova de qualidade visual. Explorações criadas antes desta atualização continuam reconhecidas.',
        'A geometria das conexões do Canvas agora reutiliza índices de nodes e adjacências de cada snapshot imutável, sem varrer o grafo inteiro para cada edge e handle. Mudanças feitas por agentes atualizam snapshots brutos de nodes, edges e andares sem verificar todos os providers novamente.',
        'As configurações de áudio agora selecionam e testam o microfone usado por todo ditado local e a saída usada por prévias e respostas faladas. Dispositivos removidos voltam ao padrão do sistema, e falhas distinguem permissão, hardware ausente, captura interrompida e provável disputa pela única entrada.',
        'As conexões do canvas agora adaptam física, taxa de quadros e renderização à quantidade de edges, visibilidade no viewport, janela oculta e preferência por movimento reduzido. Workspaces densos preservam as cores de conversa ativa enquanto edges ociosas ou fora da tela viram paths estáticos leves.',
        'Qualidade e escala no Design Studio: uma auditoria ao vivo encontra problemas de nomes, cortes, sobreposição, contraste WCAG e acessibilidade e foca a layer afetada; quatro templates nativos completos criam bases editáveis de produto, marketing, mobile ou design system; backup automático, recuperação de corrupção, migração de schema, histórico limitado, restauração explícita e renderização incremental protegem documentos grandes. Agentes recebem as mesmas operações de auditoria e template pela CLI/MCP tipadas.',
        'Terminais WSL no Windows agora validam a distribuição, diretório, PATH de login e CLI exatos antes do spawn e rastreiam conversas dos providers dentro da home Linux daquela distribuição. Somente transcripts confirmados são persistidos ou retomados; ids inválidos começam limpos em vez de invocar uma conversa mais recente especulativa, e erros de distribuição, caminho ou comando ausente são distintos e acionáveis.',
        'Uso agora inventaria os oito providers de agentes a partir de um catálogo único de capacidades. Claude, Codex e Kimi mantêm janelas automáticas verificadas e roteamento; Antigravity, Cursor, Devin, OpenCode e Cline mostram suas limitações documentadas de CLI, API administrativa ou provider de modelo com links oficiais, sem percentuais inventados.',
        'Documentos Design nativos agora oferecem colaboração ao vivo entre pessoas e agentes com presença, cursores, seleções, modo seguir, leases curtos de layer, conversas ancoradas, propostas visuais versionadas, diff estrutural e aprovação atômica. Propostas podem ser revisadas no Council ou implementadas em um Andar isolado. O Remote Companion criptografado usa permissões de Design independentes por dispositivo e recebe somente resumos sanitizados de atividade, conversas e propostas; agentes conectados usam as mesmas operações de comentar, propor e decidir pelas tools tipadas do MCP do Orkestrai.',
        'O Design Studio agora inclui protótipos interativos e motion nativos no mesmo documento versionado. Crie vários fluxos iniciais; vincule interações de clique, pressionar, hover e tempo para navegação, overlays, voltar, rolagem ou modos de variáveis; visualize transições, layers fixas, overflow, hotspots, moldura de dispositivo e tela cheia num player focado; e compartilhe um protótipo HTML autocontido e somente leitura. Tokens de motion reutilizáveis, tracks por layer, keyframes, easing, keyframes CSS e saída Motion.dev ficam pesquisáveis e disponíveis aos agentes conectados pelo mesmo command bus MCP.',
        'A entrega nativa do Modo Design agora importa estruturas HTML/Tailwind, Svelte, React/JSX e Vue como layers editáveis e gera Svelar/Svelte 5, React, Next.js, Vue 3 ou HTML/Tailwind com prévia antes da gravação. Mappings existentes de Code Connect são reutilizados primeiro, artefatos gerados continuam vinculados ao documento Design e abrem no Monaco, e um Portal ao vivo ou dispositivo móvel conectado pode ser comparado ao frame selecionado com pixel diff e overlay ajustável. As evidências viram uma tarefa rastreável no Kanban ou uma entrada na Central de Review vinculada à alteração Git real.',
        'A interoperabilidade oficial com o Figma agora provisiona o MCP remoto gerenciado para providers compatíveis e importa páginas ou frames selecionados como camadas, vetores, assets, estilos, variáveis, componentes, variantes, instâncias nativas e identidades de bibliotecas externas. Origens do Figma mantêm mappings persistentes, aparecem na busca universal e passam por uma prévia seletiva de conflitos antes da sincronização. Um plugin próprio do Orkestrai, restrito ao loopback, transfere seleções ao vivo com imagens raster, SVG editável ou JSON estrutural, cria uma página do Figma com recursos de design nativos de um documento Orkestrai e envia somente alterações revisadas da fila de volta ao arquivo atual. A credencial REST fica criptografada pelo sistema operacional e agentes recebem tools tipadas de inspeção, import, preview e sync pelo MCP do Orkestrai.',
        'A fase de Design Systems do Modo Design está completa: presets de tokens para produto, marketing e mobile; importação DTCG/CSS e exportação DTCG/CSS/Tailwind; auditoria de duplicados, valores hardcoded e candidatos a componente; componentes, instâncias, propriedades, variantes, slots e overrides; bibliotecas versionadas entre workspaces autorizados; e extração estática de CSS variables, Tailwind e contratos Svelte, React ou Vue sem executar código do projeto. Tokens e componentes também aparecem na busca global, na prévia do Canvas e no command bus MCP.',
        'O Modo Design nativo agora oferece variáveis de design tipadas em coleções e modos, aliases, vínculos pesquisáveis por propriedade, prévia imediata dos modos e o command bus visual completo e protegido por revisão para agentes via MCP do Orkestrai.',
        'Colar, arrastar ou importar SVG agora cria camadas vetoriais nativas editáveis em vez de um asset achatado. Agrupar/desagrupar, seleção profunda, lista e seleção por mesma cor, substituição em stops de gradiente, export conforme a seleção e Copiar como SVG/PNG funcionam com desfazer/refazer.',
        'O Modo Design agora separa seleção de camadas e edição vetorial. A Caneta mostra prévia e continua paths, curva ou divide segmentos, oferece tangentes Canto, Espelhado, Assimétrico e Desconectado, seleção por caixa e transformação de múltiplos pontos, edição rotacionada, resize direto de camadas e texto multilinha editável no canvas. Overlays de edição ficam fora de exports e thumbnails.',
        'O Modo Design nativo ganhou paths de Caneta editáveis, operações booleanas, máscaras, múltiplas pinturas sólidas ou com gradiente, efeitos e blend modes; snap, réguas, guias, alinhamento e distribuição; auto layout responsivo horizontal, vertical, com wrap ou grid; assets raster reutilizáveis e importação SVG estrutural editável por seletor, colagem ou arraste; exportação SVG, PNG, JPEG, WebP e PDF; e thumbnails raster vinculados à revisão para prévias grandes eficientes no Canvas.',
        'Adicionada a primeira fase do Modo Design nativo: nodes Design persistentes e compartilhados por Canvas e Workbench, scene graph estruturado com frames, retângulos, elipses e textos, edição manual de propriedades, camadas, zoom, desfazer/refazer, histórico de revisões, atualização ao vivo por agentes e operações tipadas na CLI/MCP com proteção contra conflitos. Formas agora são criadas por arraste com preview e tamanho livre; Delete fica isolado no editor e não remove mais o node Design do Canvas; rotação e alinhamento de texto estão disponíveis nas propriedades.',
      ],
    },
    {
      date: '15 ago 2026 · 0.12.0',
      items: [
        'O Orkestrai 0.12.0 permite combinar o Windows nativo e múltiplas distribuições WSL no mesmo time. O workspace define o runtime padrão, cada terminal pode herdá-lo ou selecionar seu próprio ambiente, e detecção/modelos do provider, PTY, retomada, Council, recrutamento e ponte seguem o runtime efetivo. A troca reinicia somente o terminal afetado e valida distribuição, caminho e CLI sem fallback silencioso.',
        'O servidor empacotado agora inclui os módulos necessários do runtime WSL, permitindo criar, restaurar e executar workspaces WSL também no aplicativo instalado.',
        'Ao criar ou editar um workspace WSL, o Orkestrai deriva e bloqueia automaticamente a pasta visível pelo Windows a partir do caminho Linux, sem exigir um segundo caminho equivalente nem rejeitar a configuração por engano.',
      ],
    },
    {
      date: '15 ago 2026 · 0.11.0',
      items: [
        'O Orkestrai 0.11.0 adiciona conversas remotas rastreáveis com o líder ou outro agente, vinculadas à pergunta e à sessão exatas em todos os providers registrados. A tela principal preserva o histórico do líder e aguarda o fim real do turno quando há falas intermediárias e uso de ferramentas. O ditado pelo STT local do host funciona no líder, no agente e no terminal; no terminal, apenas insere o texto. Início ou restauração continua exclusivo para Administrador, e o terminal bruto exige aprovação separada, vem desativado, adapta-se ao celular, limita-se a uma sessão e mantém controle de tráfego, criptografia e auditoria. Abrir o terminal fecha a conversa antes de ocupar a tela inteira.',
        'Convites por navegador e celular agora chegam à fila de aprovação do host depois que o relay de produção foi recriado com a origem oficial do PWA Remote habilitada.',
        'A barra de ferramentas do Canvas agora prioriza ícones compactos com tooltips; o cabeçalho de Como usar permanece visível durante a rolagem; o changelog separa versões recolhíveis e mudanças numeradas; a modal de compartilhamento alinha seus campos; e Canvas e o menu Workspace ganharam uma entrada explícita para acessar um workspace remoto.',
        'A interface do app foi reconstruída sobre os tokens semânticos de tema: o padrão escuro agora combina superfícies grafite com o amarelo da marca, o tema claro ganhou contraste real, e Canvas, Workbench, Configurações, documentação, Central de Providers, painéis, modais, menus, campos e encaixe da bolinha de voz seguem a mesma hierarquia responsiva.',
        'Pastas de workspace protegidas pelo macOS agora têm descrições de privacidade localizadas. Canvas e Workbench substituem o erro técnico EPERM/EACCES por uma recuperação que autoriza novamente a pasta exata e tenta abrir o workspace sem reiniciar o app.',
        'O compartilhamento agora oferece convites separados para Navegador/celular e App Orkestrai. O PWA Remote instalável acompanha agentes, tarefas, revisões, atividade e uso dos providers, persiste uma chave WebCrypto não extraível e remove o segredo do convite da URL antes de conectar.',
        'O compartilhamento de workspace agora usa por padrão o endpoint de produção relay.orkestrai.app. O relay aceita a origem local dinâmica do app instalado e as origens web oficiais configuradas, enquanto rejeita sites não relacionados.',
        'O compartilhamento experimental de workspace agora cria uma sessão host criptografada de ponta a ponta com convites únicos por link e QR code, aprovação explícita pela impressão digital do dispositivo, funções Leitor/Colaborador/Operador/Administrador, revogação imediata, auditoria de comandos e um companion remoto limitado para estado do time, tarefas, revisões e mensagens ao líder. O relay opaco nunca recebe conteúdo em texto aberto, enquanto saída de PTY, arquivos, notas, portais, credenciais, URLs privadas e caminhos locais ficam excluídos.',
        'Rotinas evoluíram para Automações com gatilhos manual, agenda, tarefa, mensagem, commit Git, pull request do GitHub, webhook, mudança de arquivo e limite de uso; ações de prompt, tarefa e notificação; receitas prontas; jobs idempotentes em fila; histórico recuperável; e credenciais do GitHub cifradas pelo app instalado.',
        'O modo focado evoluiu para Workbench, com itens abertos persistentes, abas verticais por padrão e abas horizontais opcionais em Configurações.',
        'Agora é possível organizar até oito artefatos ao vivo em divisões redimensionáveis para a direita ou para baixo, alternar o painel ativo e restaurar o layout por workspace sem duplicar sessões.',
        'O explorer agora agrupa agentes, trabalho, conteúdo e ferramentas; as abas podem ser arrastadas ou movidas por menu, e layouts antigos migram com segurança para o novo formato.',
        'Command/Ctrl+K agora abre uma busca universal por workspaces, agentes, tarefas, notas, roles, skills, arquivos, configurações e comandos, com prévia, recentes, favoritos e abertura direta em painéis.',
        'A busca de arquivos usa ripgrep confinado ao workspace e virtualiza listas grandes para manter a interface responsiva.',
        'Imagens, PDFs, arquivos e links agora podem ser soltos, colados ou selecionados em agentes, tarefas, notas e composers; arquivos de até 10 MB ficam confinados em .orkestrai/attachments/ e seguem no briefing completo.',
        'O rodapé do Workbench mostra todas as janelas de uso de Claude, Codex e Kimi com as mesmas cores de severidade e o mesmo snapshot de cinco minutos da aba e do nó Uso.',
        'A bolinha de voz fixada agora usa um espaço dedicado no cabeçalho do Workbench e não cobre abas nem ações do artefato aberto.',
        'Abrir ao lado em outro workspace agora troca o contexto primeiro, sem criar painéis vazios nem misturar artefatos de workspaces diferentes.',
        'Inter, Sora e JetBrains Mono agora são empacotadas no app, removendo a dependência de Google Fonts e de conexão com a internet para tipografia.',
        'Canvas e Workbench não aguardam mais o diagnóstico demorado de providers para abrir, e a busca global não bloqueia mais a montagem das telas por um ciclo reativo nem comprime sua lista e prévia.',
        'Fechar o painel ativo agora preserva o artefato que estava visível, e indicadores de terminal e textos compactos têm semântica e contraste acessíveis.',
        'A restauração agora compartilha verificações repetidas por workspace, isola entre workspaces o acesso a pastas protegidas e repara os arquivos da ponte de forma assíncrona, para que uma permissão pendente no macOS não bloqueie o Canvas ou Workbench em outro lugar.',
        'Remover um anexo da nota agora também retira seu markdown renderizado e apaga o arquivo do workspace, sem deixar conteúdo órfão.',
        'O Workbench agora tem um explorer nativo do workspace. Arquivos abrem diretamente em abas locais pelo explorer, pela árvore do Canvas ou pela busca global, sem criar nós Editor desconectados, enquanto o Monaco carregado sob demanda preserva modelos, alterações não salvas, símbolos, formatação e busca/substituição.',
        'Markdown, PDFs, imagens e binários agora abrem em prévias offline dedicadas, com limite seguro para arquivos grandes, navegação e zoom, dimensões da imagem, metadados e abertura pelo aplicativo do sistema.',
        'Os assets de produção agora recebem os mesmos headers de isolamento do app, mantendo os workers do Monaco e PDF fora da thread da interface no build instalado.',
        'O Workbench agora inclui uma Central de controle com estados persistidos dos agentes, tarefas atuais, duração do estado, uso dos providers e uma caixa de comunicações verificadas.',
        'As mensagens da ponte agora mantêm um único id entre os eventos na fila, enviada, entregue, recebida, respondida e falhou; ask só termina com sucesso após resposta confirmada.',
        'Os indicadores de atividade do Canvas e Workbench agora atualizam por eventos WebSocket em vez de polling a cada dez segundos, e eventos informativos não disparam mais notificações nativas.',
        'Nomes e roles dos agentes agora quebram em linhas próprias no explorer do Workbench, e os itens abertos na vertical mostram o nome completo sem esconder a parte que diferencia cada agente com reticências.',
        'O Workbench agora inclui uma Central de revisão com alterações Git preparadas e não preparadas estruturadas, sincronização de branch, diffs Monaco limitados, comentários persistidos por arquivo e linha, detecção de contexto desatualizado, tarefa e agente vinculados e decisões de aprovar, solicitar alterações ou rejeitar com envio direto ao agente.',
        'O Portal Design Mode agora destaca elementos reais da página, captura screenshot recortado e contexto seguro limitado, mostra uma prévia antes do envio e registra todo feedback no Kanban: como nova tarefa para triagem do líder, nova tarefa atribuída a um agente ou complemento de uma tarefa existente. Cookies, tokens, storage, headers e query strings ficam de fora.',
        'O Council agora executa de dois a cinco agentes reais como perspectivas independentes com orçamento limitado, evidências, riscos, testes, divergências e confiança estruturados, tolerância a falhas parciais, síntese opcional do líder e decisão humana persistida. Perspectivas de implementação usam andares Git isolados e exigem nova prévia limpa e sem conflitos antes de aterrissar o resultado selecionado e commitado.',
        'As funcionalidades das fases 0 a 8 agora têm descoberta consistente: Conselho aparece na barra do Canvas, no Workbench e na busca global; os tours permanecem visíveis entre Canvas e Workbench; cada caso de uso documentado inicia seu tour correspondente; e o catálogo de tours ganhou busca e um fluxo específico para anexos.',
        'Canvas e Workbench agora compartilham um node persistente de Dispositivo móvel e uma sessão por workspace. Além do iOS Simulator no Apple Silicon, o Android agora encontra as ferramentas do Android Studio no macOS, Windows e Linux, inicia ou conecta a AVDs e só acessa aparelhos físicos autorizados após confirmação explícita. Um servidor scrcpy 3.1 incluído e WebCodecs acelerado por hardware oferecem vídeo H.264 ao vivo, toque e gestos, Voltar/Home/Recentes, rotação, texto, instalação de APK e abertura de package, screenshots, logcat limitado, árvore UIAutomator, permissões, limpeza do ciclo de vida, reinício estável de AVD e tools equivalentes na CLI orkestrai e no MCP.',
      ],
    },
    {
      date: '11 ago 2026 · 0.10.0',
      items: [
        'O Orkestrai 0.10.0 apresenta o modo Terminais, com um explorer pesquisável de todos os workspaces que abre terminais, quadros, notas, portais, arquivos, fluxos e uso na área inteira, preservando o nó ao voltar ao canvas.',
        'A bolinha de voz agora encontra e abre o líder do workspace ativo também no modo Terminais, sem exibir incorretamente o erro de workspace ou líder ausente.',
        'Sessões PTY existentes agora ocupam toda a área focada ao abrir no modo Terminais, sem manter as dimensões pequenas do nó no Canvas nem corromper o desenho do chat.',
        'O cabeçalho do terminal ganhou um menu compacto para provider, role, tema, recarga, Modo Maestro e remoção, sem controles sobrepostos em nós estreitos.',
        'O botão para localizar o item no Canvas agora usa um único ícone centralizado, sem símbolos sobrepostos no cabeçalho do modo Terminais.',
        'Os terminais agora oferecem 10 temas com paletas ANSI completas e seleção visual pelo nome; a configuração explica por que Fn/Globe isolada não pode ser usada como atalho no macOS.',
      ],
    },
    {
      date: '11 ago 2026 · 0.9.1',
      items: [
        'Arquivos de role do Kimi agora incluem o frontmatter obrigatório do perfil, e arquivos antigos ou ausentes são reparados antes de iniciar o terminal em vez de encerrar a PTY com erro de agent file inválido.',
        'A bolinha de voz global agora tem um badge clicável de posição fixada ou livre que abre diretamente os controles, e o tooltip também informa o atalho correto da plataforma.',
      ],
    },
    {
      date: '11 ago 2026 · 0.9.0',
      items: [
        'Presets agora configuram roles pelo mecanismo nativo de Claude, Codex e Kimi; outros providers recebem uma referência curta ao arquivo, sem prompts longos como texto colado no terminal.',
        'Uso e roteamento permite escolher a janela de 5 horas, semanal ou mensal e informa quando o provider não reporta o período selecionado.',
        'O coletor entende a resposta atual do Kimi e limites adicionais do Codex, mostrando cada janela reportada uma única vez no painel e no nó.',
        'O toggle shadcn voltou a representar o estado visualmente, e o editor de workspace ganhou layout responsivo, rolagem limitada e rodapé estável.',
        'No Windows, a linha abaixo da barra de título agora ocupa toda a largura da janela.',
      ],
    },
    {
      date: '10 ago 2026 · 0.8.3',
      items: [
        'Orkestrai 0.8.3: o seletor pesquisável de modelos agora segue a composição oficial do shadcn-svelte, abre sem cortar a busca e mantém lupa, lista e foco alinhados.',
        'Configurações ganhou a opção de enviar automaticamente o ditado em terminais com Enter, sem submeter formulários ou outros campos de texto.',
      ],
    },
    {
      date: '10 ago 2026 · 0.8.2',
      items: [
        'Orkestrai 0.8.2: conversas entre Claude e Codex foram validadas nos dois sentidos com respostas reais e confirmação pelo transcript correto.',
        'Sessões Codex usam o diretório real do workspace e sessões Kimi usam o hash exato do caminho, sem cruzar conversas entre projetos concorrentes.',
        'ask preserva mensagens sem aspas com várias palavras e timeout ou resposta não confirmada agora termina com erro explícito.',
        'task done entrega automaticamente um handoff ao líder sem misturar a mensagem com um rascunho humano em andamento.',
      ],
    },
    {
      date: '10 ago 2026 · 0.8.1',
      items: [
        'A bolinha de voz global agora reconhece o campo focado no primeiro clique, pode ser fixada ou arrastada e sai da frente dos painéis abertos.',
        'Seletores de modelo agora têm pesquisa e rolagem, inclusive para contas Devin com catálogos grandes.',
        'O Orkestrai Light ganhou contraste consistente em painéis, nós, textos, botões, ícones, marcas de providers e hovers.',
        'Organizar canvas agora alinha os nós selecionados ou todo o workspace, com conexões sempre atrás dos nós.',
        'As cores de severidade do nó Uso correspondem ao painel Uso, e Skills já carrega resultados iniciais úteis.',
        'A recuperação do workspace valida a conversa do provider antes de retomar, evitando sessões obsoletas e reinjeção desnecessária de roles.',
        'O Windows agora usa o launcher correto das CLIs, seleção de terminal ajustada ao DPI e uma barra de título e menu estilizados.',
      ],
    },
    {
      date: '10 ago 2026 · 0.8.0',
      items: [
        'O painel Uso agora pode ser adicionado ao canvas como um nó persistente com cotas de Claude, Codex e Kimi.',
        'O nó Uso configura origem, fallback e limite; líder e agentes consultam a recomendação pela nova ação usage da CLI e do MCP antes de distribuir trabalho novo.',
        'Configurações ganhou Aparência com três temas escuros, um tema claro e editor de tokens semânticos com prévia imediata.',
        'Temas personalizados podem ser duplicados, importados e exportados como JSON validado e persistem entre reinícios.',
        'Canvas, nós, Central de Providers, Skills, documentação e Configurações agora respeitam os tokens globais de tema.',
      ],
    },
    {
      date: '10 ago 2026 · 0.7.0',
      items: [
        'Os botões de providers foram consolidados em um único menu Agentes, enquanto Shell continua disponível diretamente.',
        'Até quatro agentes favoritos podem ser fixados ao lado do menu, com ordem salva globalmente entre workspaces e reinícios.',
        'Agentes indisponíveis continuam visíveis com acesso direto à Central de Providers e nunca ocupam a barra.',
      ],
    },
    {
      date: '10 ago 2026 · 0.6.0',
      items: [
        'O Devin agora é um provider nativo com detecção local, modelos da conta, sessões interativas autônomas e retomada exata da conversa.',
        'A ponte do Orkestrai provisiona a configuração MCP e a skill do Devin, enquanto os transcripts ATIF entregam respostas limpas entre agentes e para o TTS.',
        'Agentes Devin concorrentes são vinculados às próprias sessões locais pelo diretório do workspace, sem inspecionar nem alterar os dados do Devin.',
        'O Cursor agora inicia com confiança no workspace e aprovação de MCP, enquanto o Antigravity inicia de forma autônoma e expõe seus níveis de esforço.',
      ],
    },
    {
      date: '10 ago 2026 · 0.5.2',
      items: [
        'Gravações longas de ditado agora chegam à transcrição, sem bater no limite padrão de 512 KB do servidor empacotado após poucos segundos.',
        'Gravações acima de aproximadamente 15 minutos mostram uma mensagem de limite clara e traduzida no ditado global e no terminal.',
        'Portais salvos tentam carregar novamente quando o dev server local inicia depois do canvas e aguardam a página real antes da automação.',
        'Terminais Claude concorrentes reservam IDs de conversa distintos, evitando transcripts trocados e respostas corrompidas entre agentes.',
        'Erros de Portal preservam o detalhe útil, e respostas de providers nunca voltam a usar o redraw bruto do terminal.',
        'Retomar um workspace não injeta as roles novamente: só agentes com tarefas atribuídas ainda abertas, ou o líder com trabalho sem responsável, recebem um prompt de continuação.',
        'O servidor continua respondendo enquanto o macOS aguarda a permissão da pasta do workspace, e um provisionamento interrompido é tentado novamente com segurança.',
      ],
    },
    {
      date: '10 ago 2026 · 0.5.1',
      items: [
        'Os terminais agora descartam IDs locais de PTY obsoletos após reiniciar o app e retomam automaticamente a conversa preservada de cada provider.',
        'A recuperação de sessão usa um código WebSocket estável e espera o novo ID ser persistido antes de reconectar.',
      ],
    },
    {
      date: '10 ago 2026 · 0.5.0',
      items: [
        'O ditado local agora escreve no campo de texto ativo em qualquer tela; sem campo ativo no canvas, continua enviando ao líder.',
        'O provider de um agente pode ser trocado no cabeçalho sem perder nome, role, Modo Maestro, andar, posição ou conexões.',
        'Roles dos presets agora incluem missão, contexto, processo, critérios de aceite e handoff, e são aplicadas automaticamente ao iniciar a PTY.',
        'O líder recebe a fila inicial do kanban com título, descrição, imagens e nota e deve atribuir cada trabalho antes de delegar.',
        'Notificações distinguem Tarefa concluída, Projeto concluído e Atenção, evitando confundir uma entrega parcial com o projeto inteiro.',
        'Andares mostra as tarefas reais, suas etapas e responsáveis em cada worktree e no térreo.',
        'A edição de texto em formas acompanha o tamanho, peso e alinhamento renderizados, inclusive em fontes grandes.',
      ],
    },
    {
      date: '09 ago 2026 · 0.4.0',
      items: [
        'Cursor, Antigravity e Cline agora entram no canvas como providers nativos, ao lado de Claude, Codex, Kimi e OpenCode.',
        'A lista de providers, modelos e esforços vem dos adapters instalados, sem enums fixos na UI, nos schemas ou na ponte de recrutamento.',
        'Cada provider recebe a skill e a configuração MCP no formato que reconhece; o Cline usa configuração isolada por workspace.',
        'A retomada rastreia IDs exatos nos transcritos, manifestos e caches de cada CLI, evitando conectar um terminal à conversa de outro agente.',
        'A Central de Providers agora detecta as CLIs localmente e oferece instalação por sistema, orientação oficial de login, capacidades e nova verificação em um clique.',
        'Novas instalações começam em inglês e perguntam o idioma primeiro no onboarding, salvando português brasileiro, inglês ou espanhol imediatamente.',
        'O app agora aguarda o idioma inicial salvo antes de liberar a interface, evitando telas com idiomas misturados e cliques perdidos no startup.',
        'Terminais de presets agora iniciam com as flags autônomas de acesso total de cada provider; terminais antigos sem argumentos são reparados sem sobrescrever comandos personalizados.',
      ],
    },
    {
      date: '09 ago 2026 · 0.3.0',
      items: [
        'O quadro agora aceita até dez etapas personalizadas com nome, cor e ordem; líder e equipe consultam e atualizam o mesmo fluxo automaticamente.',
        'A Biblioteca ganhou times prontos de Campanha e lançamento, Brand e design e Conteúdo e SEO, com briefings e papéis adequados também a marketers, designers e creators.',
        'O preset Orkestrai Contributing combina Claude líder, oráculos Codex e Kimi, especialistas Svelar/desktop/QA e um Flow que exige consenso antes da criação das tarefas.',
      ],
    },
    {
      date: '09 ago 2026 · 0.2.0',
      items: [
        'A Biblioteca de presets chegou ao canvas com busca, filtros e times prontos de Produto, React, Next.js, SvelteKit, Svelar e Laravel; use em um workspace novo ou some ao time atual.',
        'Presets v2 agora preservam descrição e status completos das tarefas e skills portáveis, sem copiar sessões PTY nem sobrescrever skills personalizadas no projeto de destino.',
        'Roles ganhou um catálogo traduzido com 12 funções completas de liderança, engenharia, qualidade e operação.',
        'Andares agora mostra agentes ativos, tarefas atribuídas e estado Git de cada worktree e do térreo.',
        'O app desktop ganhou menus nativos traduzidos, e Configurações e Documentação passaram a usar a mesma base visual do site.',
      ],
    },
    {
      date: '09 ago 2026 · 0.1.5',
      items: [
        'Mensagens automáticas agora aguardam o usuário terminar o rascunho e são entregues em fila, sem misturar textos de outros agentes no terminal do líder.',
        'Mensagens entre agentes não são mais cortadas silenciosamente em 4.000 caracteres.',
        'O silêncio do terminal virou um estado neutro de ociosidade e não dispara mais notificações falsas de atenção no desktop.',
        'Textos em português do Brasil receberam uma revisão de acentuação, acompanhada por um teste que evita regressões frequentes.',
      ],
    },
    {
      date: '08 ago 2026 · 0.1.4',
      items: [
        'Orkestrai 0.1.4 é a primeira release para macOS com assinatura Developer ID Application e notarização da Apple; a assinatura ad-hoc fica restrita a builds locais.',
        'O pipeline interrompe a release se qualquer uma das cinco credenciais Apple estiver ausente, evitando publicar novamente um pacote sem assinatura confiável.',
        'O CI valida autoridade, Team ID, Hardened Runtime, aceitação pelo Gatekeeper e ticket de notarização nas versões Apple Silicon e Intel antes da publicação.',
        'Esta versão também é publicada no feed legado para alcançar instalações antigas e migra o app para o repositório principal nas atualizações futuras.',
      ],
    },
    {
      date: '07 ago 2026 · 0.1.3',
      items: [
        'Orkestrai 0.1.3 corrige o pacote macOS da 0.1.2: os arquivos estavam íntegros, mas a assinatura ad-hoc parcial fazia o Gatekeeper informar que o app estava danificado.',
        'Bundles macOS sem certificado agora recebem assinatura ad-hoc completa; o CI valida assinatura profunda, DMGs e ZIPs nas arquiteturas Apple Silicon e Intel antes da publicação.',
        'Updaters antigos ficam bloqueados no Mac para não remover a instalação atual; o app novo detecta releases pela API pública e direciona para instalação manual segura.',
        'No primeiro uso sem Developer ID, tente abrir o app, feche o aviso e use Ajustes do Sistema → Privacidade e Segurança → Segurança → Abrir Mesmo Assim; autentique e confirme Abrir. Windows não foi afetado.',
      ],
    },
    {
      date: '07 ago 2026 · 0.1.2',
      items: [
        'Orkestrai 0.1.2: o painel Usage agora atualiza Claude, Codex e Kimi automaticamente a cada 5 minutos, em vez de a cada 60 segundos, reduzindo chamadas desnecessárias e o risco de HTTP 429.',
        'O cache do servidor segue o mesmo intervalo e evita consultas duplicadas ao reabrir o painel ou voltar ao app.',
        'O botão de atualização manual continua buscando dados novos imediatamente e ignora o cache apenas quando acionado.',
      ],
    },
    {
      date: '07 ago 2026 · 0.1.1',
      items: [
        'Orkestrai 0.1.1 inclui electron-updater no aplicativo instalado; Configurações deixa de confundir módulo ausente com execução fora do app desktop.',
        'Instalações 0.0.1 e 0.1.0 precisam de uma atualização manual única para 0.1.1. Depois disso, Windows e Linux voltam ao fluxo automático; macOS sem assinatura mantém o download manual seguro.',
        'Tarefas criadas pelo usuário chegam ao líder somente depois de persistir título, descrição markdown e todas as imagens anexadas.',
        'O briefing enviado ao líder e ao agente atribuído contém sempre título, descrição e a lista completa de imagens de referência.',
      ],
    },
    {
      date: '07 ago 2026',
      items: [
        'Orkestrai 0.1.0: primeira release pública preparada para atualizar as instalações 0.0.1.',
        'Pipeline por tag gera macOS Apple Silicon/Intel, Windows x64 e Linux x64 e publica somente os binários no repositório público de releases.',
        'A release só fica pública depois de validar instaladores, blockmaps, manifests latest-*.yml, tamanhos e SHA-512; macOS exige ZIPs de update para as duas arquiteturas e o instalador Windows usa exatamente o nome referenciado por latest.yml.',
        '“Verificar agora” devolve o estado real e não fica mais preso em “Verificando”; eventos do boot também não se perdem quando a tela monta depois.',
        'Falha temporária ao consultar o GitHub não abre mais o modal manual. O fallback aparece apenas quando uma atualização encontrada falha no download ou instalação.',
        'Windows NSIS e Linux AppImage atualizam sem assinatura; no macOS sem certificado Apple, o app mantém o download manual seguro.',
      ],
    },
    {
      date: '06 ago 2026',
      items: [
        'Novo painel Portas logo depois de Usage: lista listeners vinculados aos Portais locais do workspace, com processo, PID e estado em uso/livre.',
        'MCP do Codex reparado no Windows: o config.toml agora usa o runtime e a CLI por caminhos absolutos, sem depender de PATH, PATHEXT, .cmd ou Node.js externo.',
        'O handshake global do orkestrai mcp agora inicia mesmo fora de um workspace; token e URL só são exigidos quando uma tool realmente acessa a ponte.',
        'Encerramento seguro de porta com confirmação, revalidação do PID e proteção do processo do Orkestrai; portas arbitrárias da máquina nunca aparecem.',
        'Nova bolinha de ditado no topo direito: aciona exatamente o microfone do líder e escreve a transcrição direto no terminal dele, mesmo em outro andar; sem líder, mostra um toast claro.',
        'Correção na retomada do Claude: transcripts de subagentes e arquivos de startup sem uma mensagem retomável não substituem mais o ID válido da conversa do líder.',
        'Após apagar os modelos locais de voz, o microfone do terminal e a bolinha do líder voltam a pedir confirmação antes do download; a interface também informa se a exclusão falhar.',
        'Supertonic 3 substitui o Kokoro nas respostas faladas, com áudio local em 44,1 kHz; o Parakeet e todo o fluxo de STT permanecem inalterados.',
        'Três presets de fala — pt-BR, en-US e espanhol latino — com prévia, velocidade ajustável de 0,75× a 1,50× e migração automática das vozes antigas.',
        'Respostas longas são sintetizadas por frases, com prefetch do próximo trecho e PCM binário no IPC para começar a tocar mais cedo sem sobrepor falas.',
        'O novo modelo INT8 tem download menor, é verificado por SHA-256 e só remove o Kokoro antigo depois de instalado com sucesso.',
        'A busca global de documentação por Cmd/Ctrl+K agora cobre monitores largos por inteiro e mantém o diálogo centralizado.',
        'Interface, documentação, casos de uso e três tours novos traduzidos em pt-BR, English e Español (16 tours no onboarding).',
      ],
    },
    {
      date: '05 ago 2026',
      items: [
        'Kanban estilo Trello: composer com título, descrição em markdown e imagens anexadas já na criação da tarefa (Ctrl+V ou seletor, com miniaturas).',
        'Descrição da tarefa formatada no cartão (duplo-clique edita) e suportada na API/CLI.',
        'Markdown completo em notas, roles e histórico do kanban: links, checkboxes, tabelas e código — sanitizado.',
        'Novo nó Imagem no canvas: referência visual conectável aos agentes (cole com Ctrl+V ou escolha o arquivo).',
        'Todos os placeholders do app traduzidos (pt-BR/English/Español).',
        'Cobertura i18n de 100%: o app inteiro (canvas, nós, painéis, diálogos, paleta, páginas) fala pt-BR, English e Español — mais de 500 chaves novas.',
        'Documentação "Como usar" traduzida integralmente: tópicos, casos de uso, quickstart e changelog acompanham o idioma escolhido.',
        'CLI: task add aceita --description em markdown (também na tool MCP).',
        'Fluxo que funciona de verdade: agentes sem sessão são iniciados sozinhos pelo pipeline, erros aparecem num banner no nó (fim das falhas silenciosas) e estados vazios guiam o que fazer.',
        'Ícone de pasta (o default) selecionável no editor do workspace — o picker tinha 24 ícones mas não o original.',
        'Injeção de texto nos terminais 100% unificada (roles inclusas): texto e Enter sempre em writes separados — o composer não fica mais pendurado em nenhum provider (Claude, Codex, Kimi).',
        'Fluxos encadeados: um Fluxo conectado a outro dispara o próximo com a saída final (falha não encadeia, ciclo bloqueado) — pipelines compostos e fan-out.',
        'Botão Sincronizar no Fluxo: cada agente conectado vira um passo na ordem das arestas — o pipeline é o próprio desenho.',
        'Novo tour guiado "Fluxos encadeados" no onboarding (12 tours agora): cria os dois fluxos, conecta e você roda o encadeamento.',
        'Modal do onboarding polida: anel roxo de seleção/foco não é mais cortado pelo scroll, fade no rodapé da lista e etapa de casos de uso mais larga.',
        'Onboarding sempre guia do zero: boas-vindas → criar workspace novo → caso de uso, mesmo com um workspace aberto (atalho "usar atual" continua).',
        '"Fazer por mim" aparece na hora no canvas: nós e conexões criados por tour, CLI ou API disparam live refresh — sem sair e voltar do workspace.',
        'Fix: onboarding não abria em inglês/espanhol — a troca de idioma remontava a página depois da URL ser limpa e o wizard morria; a intenção agora sobrevive ao remount (teste de regressão incluso).',
        'Fix: tour de pesquisa não travava mais no último passo — passos agora executam várias ações em sequência (as duas conexões são feitas) e o tour conclui sozinho quando o último check passa.',
        'Fix: busca de MCPs quebrava a lista ao achar resultados duplicados no registry (agora deduplica) — buscar "Figma" funciona e a curadoria aparece primeiro.',
        'Caso de uso + tour novo "Do Figma ao código": agente Designer, nó Imagem com o mockup e Figma MCP para ler o arquivo direto (13 tours).',
        'Fix sério: respostas entre agentes vêm do transcrito limpo da CLI (sem lixo de TUI, barra de status ou caracteres duplicados) — fim do composer abrindo editor externo com texto corrompido.',
        'Fix: servidor MCP do Orkestrai falava framing errado (LSP) e o Kimi dava timeout de 30s — agora é NDJSON, o padrão oficial do MCP (Claude, Kimi e cia conectam).',
        'Toda injeção de texto em composer é sanitizada: sem bytes de controle e sem Enter solto (submit parcial) em nenhum provider.',
        'Fix sério nos tours: passo com ação sem check nunca avançava (e cada clique criava outro agente) — agora avança sozinho, com guarda anti-duplicata. Auditoria e2e roda os 13 tours inteiros a cada build.',
        'Fix: tools MCP com campos errados (ask mandava text em vez de message, notes apontavam rotas inexistentes, dismiss mandava agent em vez de target) — agora cobertas por teste de mapeamento corpo-a-corpo com os schemas da ponte.',
        'Contrato MCP completo: as 23 tools são validadas contra as rotas e schemas reais da ponte a cada build; tools de maestro sem identidade dão erro claro em vez de 422.',
        'Ask não devolve mais lixo de boot: se o transcrito ainda está vazio (tela de trust, composer ecoando), a ponte espera a resposta de verdade em vez de repassar a tela crua.',
        'Codex, Kimi e OpenCode agora NASCEM sabendo da ponte: bloco no AGENTS.md (merge, sem apagar nada seu), MCP do Codex no ~/.codex/config.toml e opencode.json no projeto — antes só o Claude recebia as instruções.',
        'Apagar nó pede confirmação (Delete do teclado e X do nó): sem mais perder um agente e o contexto dele por acidente.',
        'A resposta de um agente não é mais injetada no composer do outro (ela já chega pelo retorno do comando) — fim do texto emendado na sua digitação.',
        'Kimi destravado de vez: a ponte espera o TUI terminar o boot antes de escrever (o Enter virava newline no composer), re-envia o Enter se nada acontece e lê a resposta do wire.jsonl real — verificado com o Kimi de verdade respondendo limpo.',
        'Títulos duplicados não quebram mais o roteamento: novos agentes ganham sufixo automático (Dev 2, Dev 3) e um ask ambíguo explica como resolver em vez de mandar pro agente errado.',
        'orkestrai list agora marca quem é o líder com [LIDER] — agentes não chutam mais "orkestrai ask Maestro" (Maestro é o papel, não um título).',
      ],
    },
    {
      date: '04 ago 2026',
      items: [
        'Ciclo de conversa por voz: ditou, o agente responde falando — em português do Brasil de verdade.',
        'Voz 100% autocontida (sem Node, sem Docker): runtime próprio baixado junto com o modelo, verificação de espaço em disco e opção de apagar o modelo.',
        'A fala lê só a resposta atual — sem markdown, URLs ou caracteres estranhos.',
        'Kanban: anexar imagens nos cartões funcionando (Ctrl+V e seletor).',
        'Seta sem ponta vazando; painel de estilo com sliders e cabeça de seta configurável.',
        'Usage do Kimi renova a credencial sozinho.',
        'Sem briga de portas entre workspaces: orkestrai port devolve porta livre e os agentes aprendem a nunca matar processo de porta alheia.',
        'Botão Descarregar com confirmação e feedback; Configurações redesenhadas; changelog aqui na página.',
        'Atualizações automáticas: o app busca versão nova sozinho e instala na troca, sem tocar seus dados.',
        'Skeletons de carregamento na sidebar, usage, skills e Configurações — sem pulos na UI.',
        'Kanban com histórico: arquive concluídas sem perder o registro do que foi entregue.',
        'Tarefa com nota de spec vinculada: arquiva junto, protegida contra exclusão, lida pelo histórico.',
        'Voz lê o transcrito da sessão: resposta completa do agente, sem caracteres invisíveis.',
        'Presets de equipe: salve o workspace como template e comece projetos com o time pronto.',
        'Fluxos: pipelines visuais de agentes com aprovação humana e histórico de execuções.',
        'Servidor MCP próprio + tools CLI novas (fs, say, run, clip) + gerenciador de MCPs.',
        'Resposta entre agentes submetida sozinha — composer não fica mais pendurado.',
        'Reconexão automática após suspensão do notebook, com o contexto restaurado.',
        'Botão Recarregar em cada terminal (reinicia a sessão com o contexto).',
        'Janelas nunca nascem menores que o mínimo — sem botões vazando.',
        'Tooltips em toda a toolbar; textos de Diff/Loop/Andares em linguagem simples.',
        '⌘K / Ctrl+K global: busca na documentação de qualquer tela.',
        'Marketplace de MCPs na página Skills: curadoria oficial + registry, instalação com 1 clique e campos de token guiados.',
        'App em Português, English e Español: seletor de idioma nas Configurações (paraglide).',
        'Design pass: página Skills & MCPs redesenhada (abas segmentadas, cartões com badges) e docs polidas.',
        'Onboarding interativo: 11 tours guiados por caso de uso, com "Fazer por mim" e auto-conclusão, em 3 idiomas.',
        'Ícone de workspace agora é seletor Lucide (sidebar, editor e presets); emoji antigo continua funcionando.',
      ],
    },
    {
      date: '03 ago 2026',
      items: [
        'Voz embarcada sem Docker e sem Python, com confirmação antes do download.',
        'Kanban com imagens de referência e líder avisado de tarefa nova; roles com editor markdown.',
        'Suporte completo a Windows; notificações nativas com marca, workspace e agente.',
      ],
    },
    {
      date: '02 ago 2026',
      items: [
        'Modo Maestro consertado de ponta a ponta: o líder recruta, conecta e distribui sozinho.',
        'Painel de usage dos providers e marketplace de skills (skills.sh) dentro do app.',
        'Orquestração automática no canvas: organograma, arestas vivas, kanban e portal.',
        'Ditado offline com atalho configurável; builds Linux/Windows e fundo do DMG com a marca.',
      ],
    },
    {
      date: '01 ago 2026',
      items: [
        'Nasce o Orkestrai: canvas de agentes, ponte CLI, andares (worktrees), rotinas, roles, kanban, portal e Modo Maestro.',
        'Multi-workspace com resume exato de contexto; app desktop para macOS, Linux e Windows.',
      ],
    },
  ],
};
