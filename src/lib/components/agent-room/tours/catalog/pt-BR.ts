import type { Tour } from '../types.js';

/**
 * Catalogo de tours guiados em pt-BR. Para adicionar um caso de uso novo:
 * copie um tour existente, ajuste os passos e registre as traducoes em
 * catalog/en.js e catalog/es.js com o MESMO id e a MESMA estrutura.
 */
export const TOURS_PT: Tour[] = [
  {
    id: 'team-leader',
    icon: 'Users',
    title: 'Time com líder (zero-config)',
    tagline: 'Um líder que monta e comanda o time por você.',
    steps: [
      {
        id: 'leader',
        title: 'Crie o líder do time',
        body: 'Tudo começa com um agente líder (Modo Maestro). Ele propõe o time, recruta, conecta e distribui o trabalho sozinho. Crio ele para você com um clique.',
        action: { kind: 'createAgent', title: 'Líder', provider: 'claude', leader: true },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Líder' },
      },
      {
        id: 'brief',
        title: 'A nota de briefing',
        body: 'A spec do projeto mora numa nota conectada ao time. Vou criar uma nota "Briefing" de exemplo — edite com o que você quer construir.',
        action: { kind: 'createNote', title: 'Briefing', content: '# Briefing\n\nDescreva aqui o projeto: objetivo, escopo e critérios de pronto.\n' },
        check: { kind: 'nodeExists', nodeType: 'note', titleIncludes: 'Briefing' },
      },
      {
        id: 'brief-connect',
        title: 'Conecte a nota ao líder',
        body: 'Conectar a nota ao líder dá a ele o contexto do projeto. Faço a conexão para você.',
        action: { kind: 'connect', fromTitle: 'Briefing', toTitle: 'Líder' },
        check: { kind: 'edgeExists', fromTitle: 'Briefing', toTitle: 'Líder' },
      },
      {
        id: 'board',
        title: 'O quadro de tarefas',
        body: 'O kanban do time: cartões em A fazer/Fazendo/Feito. Vou criar o quadro e a primeira tarefa atribuída ao líder — ele quebra e distribui o resto.',
        action: { kind: 'createTasksBoard' },
      },
      {
        id: 'first-task',
        title: 'Primeira tarefa para o líder',
        body: 'Crio a tarefa "Montar o time e começar" atribuída ao líder. Ela cai completa no terminal dele; todo trabalho que ele delegar também deve existir e ter responsável no quadro.',
        action: { kind: 'createTask', title: 'Montar o time e começar (leia a nota Briefing)', assigneeTitle: 'Líder' },
        check: { kind: 'taskExists', titleIncludes: 'Montar o time' },
      },
      {
        id: 'talk',
        title: 'Dê a ordem',
        body: 'No terminal do líder, diga: "leia a nota Briefing, proponha o time e comece". Consultas entre agentes só contam após o ask confirmar a resposta; quando alguém conclui com task done, o líder recebe o handoff automaticamente.',
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Líder' },
      },
    ],
  },
  {
    id: 'vigia-24-7',
    icon: 'Repeat',
    title: 'Funcionário 24/7 (vigia de tarefas)',
    tagline: 'Um agente que trabalha sem parar, de minuto em minuto.',
    steps: [
      {
        id: 'leader',
        title: 'O vigia',
        body: 'Um agente líder fica de plantão: a cada poucos minutos ele olha o quadro, atribui o que estiver sem dono e recruta se faltar gente.',
        action: { kind: 'createAgent', title: 'Vigia', provider: 'claude', leader: true },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Vigia' },
      },
      {
        id: 'board',
        title: 'O quadro vigiado',
        body: 'Ele precisa de um quadro para vigiar. Crio o nó Tarefas para você.',
        action: { kind: 'createTasksBoard' },
      },
      {
        id: 'routine',
        title: 'A rotina de plantão',
        body: 'Crio a rotina: a cada 5 minutos o vigia recebe "verifique o quadro (orkestrai task list); atribua o que estiver sem dono; se faltar agente, recrute".',
        action: { kind: 'createRoutine', targetTitle: 'Vigia', prompt: 'Verifique o quadro com: orkestrai task list. Atribua o que estiver sem dono. Se faltar agente, recrute (orkestrai recruit).', intervalMinutes: 5 },
        check: { kind: 'routineExists' },
      },
      {
        id: 'drop-task',
        title: 'Teste com uma tarefa',
        body: 'Crie uma tarefa qualquer no quadro (ou use "Fazer por mim") e observe: em até 5 minutos o vigia pega e distribui sozinho.',
        action: { kind: 'createTask', title: 'Tarefa de teste do vigia' },
        check: { kind: 'taskExists', titleIncludes: 'vigia' },
      },
    ],
  },
  {
    id: 'duas-features',
    icon: 'GitBranch',
    title: 'Duas features em paralelo sem conflito',
    tagline: 'Dois times, dois andares, zero pisada no pé.',
    steps: [
      {
        id: 'floor',
        title: 'Crie um andar',
        body: 'Um andar é uma cópia isolada do projeto (worktree git) com branch própria. O time B trabalha nela enquanto o time A fica no principal. Crio o andar "feature-nova" para você.',
        action: { kind: 'createFloor', name: 'feature-nova' },
        check: { kind: 'floorExists', nameIncludes: 'feature' },
      },
      {
        id: 'agents',
        title: 'Um agente por frente',
        body: 'Crio dois agentes: um trabalha no andar principal, outro na feature nova. Mova o segundo para a camada do andar (painel Andares na barra inferior).',
        action: { kind: 'createAgent', title: 'Dev Principal', provider: 'claude' },
      },
      {
        id: 'agent-b',
        title: 'O agente da feature',
        body: 'Crio o agente da frente B. No painel Andares, troque a camada visível e arraste-o para lá — ele passa a trabalhar no checkout do andar.',
        action: { kind: 'createAgent', title: 'Dev Feature', provider: 'codex' },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Dev Feature' },
      },
      {
        id: 'land',
        title: 'Juntando de volta',
        body: 'Quando a feature terminar: painel Andares → preview mostra conflitos ANTES do merge; o land junta tudo. Conflito vira tarefa para um agente resolver. Conclua quando o andar existir.',
        check: { kind: 'floorExists', nameIncludes: 'feature' },
      },
    ],
  },
  {
    id: 'qa-visual',
    icon: 'Workflow',
    title: 'QA visual da sua aplicação',
    tagline: 'Um agente que abre sua app e testa de verdade.',
    steps: [
      {
        id: 'portal',
        title: 'O portal (navegador dos agentes)',
        body: 'O portal é um navegador embutido que os agentes controlam. O nome persistente aparece no cabeçalho e pode ser alterado pelo lápis; a URL fica na barra de navegação separada, então você e os agentes escolhem o Portal certo pelo nome. Crio um apontado para o seu dev server — ajuste a URL depois se não for localhost:5173. Pop-ups de login ficam numa janela sandboxed do Orkestrai com a mesma sessão persistente, e o nó restaura a última página navegada após reiniciar.',
        action: { kind: 'createPortal', url: 'http://localhost:5173', title: 'Portal App' },
        check: { kind: 'nodeExists', nodeType: 'portal' },
      },
      {
        id: 'responsive-check',
        title: 'Confira a responsividade você também',
        body: 'O ícone de celular no cabeçalho do portal abre uma barra de dispositivos, igual a de um navegador: escolha iPhone, Pixel, iPad, laptop ou desktop, ou digite largura/altura exatas. O viewport real da página muda pra esse tamanho, igual redimensionar uma janela, então o CSS responsivo dela reage de verdade.',
      },
      {
        id: 'qa',
        title: 'O agente de QA',
        body: 'Crio o agente que vai testar. Conecte-o ao portal para ele enxergar a página.',
        action: { kind: 'createAgent', title: 'QA', provider: 'claude' },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'QA' },
      },
      {
        id: 'connect',
        title: 'Conecte o QA ao portal',
        body: 'Conectado, o QA navega, lê o DOM, roda JS e tira screenshots. Faço a conexão.',
        action: { kind: 'connect', fromTitle: 'QA', toTitle: 'Portal App' },
        check: { kind: 'edgeExists', fromTitle: 'QA', toTitle: 'Portal App' },
      },
      {
        id: 'test',
        title: 'Peça o teste',
        body: 'No terminal do QA: "abra o portal, faça o fluxo principal da app, tire screenshot e me diga o que quebrou". Ele executa e reporta.',
      },
    ],
  },
  {
    id: 'pesquisa-resumo',
    icon: 'Search',
    title: 'Pesquisa automatizada com resumo',
    tagline: 'O agente pesquisa na web e escreve o resumo numa nota.',
    steps: [
      {
        id: 'note',
        title: 'A nota de resumo',
        body: 'Crio a nota "Resumo" — é nela que o agente escreve os achados em bullet points.',
        action: { kind: 'createNote', title: 'Resumo', content: '# Resumo\n\n(os achados da pesquisa aparecem aqui em bullet points)\n' },
        check: { kind: 'nodeExists', nodeType: 'note', titleIncludes: 'Resumo' },
      },
      {
        id: 'portal',
        title: 'O portal de pesquisa',
        body: 'Crio um portal aberto no Google — o agente usa para ler fontes.',
        action: { kind: 'createPortal', url: 'https://www.google.com', title: 'Portal Pesquisa' },
        check: { kind: 'nodeExists', nodeType: 'portal' },
      },
      {
        id: 'agent',
        title: 'O pesquisador',
        body: 'Crio o agente pesquisador e conecto ele ao portal e à nota — portal para ler, nota para escrever.',
        action: { kind: 'createAgent', title: 'Pesquisador', provider: 'kimi' },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Pesquisador' },
      },
      {
        id: 'connect',
        title: 'Conexões de trabalho',
        body: 'Faço as duas conexões: Pesquisador ↔ Portal Pesquisa e Pesquisador ↔ Resumo. Depois diga: "use o portal para ler sobre X e escreva o resumo na nota".',
        action: [
          { kind: 'connect', fromTitle: 'Pesquisador', toTitle: 'Portal Pesquisa' },
          { kind: 'connect', fromTitle: 'Pesquisador', toTitle: 'Resumo' },
        ],
        check: { kind: 'edgeExists', fromTitle: 'Pesquisador', toTitle: 'Portal Pesquisa' },
      },
    ],
  },
  {
    id: 'inbox-arquivos',
    icon: 'FolderPlus',
    title: 'Inbox de arquivos processada sozinha',
    tagline: 'Solte arquivos na pasta; o time processa em lote.',
    steps: [
      {
        id: 'agent',
        title: 'O processador',
        body: 'Crio o agente que vai olhar a pasta ./inbox do seu projeto (crie a pasta depois se não existir).',
        action: { kind: 'createAgent', title: 'Processador', provider: 'claude' },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Processador' },
      },
      {
        id: 'routine',
        title: 'A rotina de varredura',
        body: 'Crio a rotina: a cada 2 minutos ele lista ./inbox, descreve/classifica o que é novo, move para ./inbox/done e registra no quadro.',
        action: { kind: 'createRoutine', targetTitle: 'Processador', prompt: 'Liste ./inbox; para cada arquivo novo, descreva e classifique; mova para ./inbox/done e registre no quadro com orkestrai task add.', intervalMinutes: 2 },
        check: { kind: 'routineExists' },
      },
      {
        id: 'test',
        title: 'Solte um arquivo',
        body: 'Crie a pasta ./inbox no projeto e solte um arquivo qualquer. Em até 2 minutos o processador descreve, classifica e arquiva.',
      },
    ],
  },
  {
    id: 'revisao-cruzada',
    icon: 'Cable',
    title: 'Revisão cruzada entre providers',
    tagline: 'Claude implementa, Codex revisa. Dois olhares por mudança.',
    steps: [
      {
        id: 'dev',
        title: 'O implementador',
        body: 'Crio o Claude que implementa as mudanças.',
        action: { kind: 'createAgent', title: 'Claude Dev', provider: 'claude' },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Claude Dev' },
      },
      {
        id: 'reviewer',
        title: 'O revisor',
        body: 'Crio o Codex revisor — um modelo diferente revisando com outro olhar.',
        action: { kind: 'createAgent', title: 'Codex Reviewer', provider: 'codex' },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Codex Reviewer' },
      },
      {
        id: 'connect',
        title: 'Conecte os dois',
        body: 'Faço a conexão: tudo que um perguntar ao outro viaja por ela (e ela acende verde durante a conversa).',
        action: { kind: 'connect', fromTitle: 'Claude Dev', toTitle: 'Codex Reviewer' },
        check: { kind: 'edgeExists', fromTitle: 'Claude Dev', toTitle: 'Codex Reviewer' },
      },
      {
        id: 'flow',
        title: 'O fluxo de revisão',
        body: 'Diga ao Claude Dev: "implemente X e peça revisão ao Codex Reviewer (orkestrai ask)". Ele implementa, o Codex critica, o veredito volta na mesma corda.',
      },
    ],
  },
  {
    id: 'sentinela-deploy',
    icon: 'Rocket',
    title: 'Sentinela de deploy e testes',
    tagline: 'De hora em hora: testes rodados, falhas viram tarefa + notificação.',
    steps: [
      {
        id: 'agent',
        title: 'O sentinela',
        body: 'Crio o agente que vigia a saúde do projeto.',
        action: { kind: 'createAgent', title: 'Sentinela', provider: 'codex' },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Sentinela' },
      },
      {
        id: 'board',
        title: 'O quadro de incidentes',
        body: 'Falhas viram cartões no quadro. Crio o nó Tarefas.',
        action: { kind: 'createTasksBoard' },
      },
      {
        id: 'routine',
        title: 'A ronda de hora em hora',
        body: 'Crio a rotina: a cada 60 minutos ele roda os testes; se falhar, abre tarefa para o time e te notifica no desktop.',
        action: { kind: 'createRoutine', targetTitle: 'Sentinela', prompt: 'Rode os testes do projeto. Se falhar, abra uma tarefa para o time (orkestrai task add) e notifique o usuário (orkestrai notify).', intervalMinutes: 60 },
        check: { kind: 'routineExists' },
      },
      {
        id: 'test',
        title: 'Quebre de propósito (opcional)',
        body: 'Introduza um erro no código e veja a próxima ronda abrir a tarefa e disparar a notificação nativa.',
      },
    ],
  },
  {
    id: 'preset-bootstrap',
    icon: 'Layers',
    title: 'Preset do seu framework',
    tagline: 'Monte o time uma vez; todo projeto novo nasce pronto.',
    steps: [
      {
        id: 'team',
        title: 'Monte o time padrão',
        body: 'Crie o time que você usa em todo projeto (líder, devs, roles, nota de bootstrap com as convenções do seu framework). Crio o líder para começar.',
        action: { kind: 'createAgent', title: 'Líder', provider: 'claude', leader: true },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Líder' },
      },
      {
        id: 'save',
        title: 'Salve como preset',
        body: 'Com o time montado: lápis ao lado do nome do workspace na barra lateral → "Salvar como preset". O snapshot guarda agentes, layout, notas, roles e rotinas (sem sessões).',
      },
      {
        id: 'use',
        title: 'Use no próximo projeto',
        body: 'Ao criar um workspace novo (+ na barra lateral), escolha o preset em "Começar de um preset" — o time inteiro nasce instanciado no projeto. Gerencie presets em Configurações.',
      },
    ],
  },
  {
    id: 'portable-role-library',
    icon: 'Layers',
    title: 'Reutilize uma role de outro projeto',
    tagline: 'Traga instruções especialistas já validadas para este workspace com segurança.',
    steps: [
      {
        id: 'open-roles',
        title: 'Abra Roles',
        body: 'Abra Roles na barra do Canvas e acesse a aba Workspace para ver as roles já instaladas aqui.',
      },
      {
        id: 'choose-folder',
        title: 'Escolha o projeto de origem',
        body: 'Selecione "Descobrir em outra pasta..." e escolha o projeto cujo diretório .orkestrai/roles contém as instruções especialistas.',
      },
      {
        id: 'review-import',
        title: 'Revise as roles importadas',
        body: 'Somente roles novas e válidas são adicionadas. Nomes existentes permanecem intactos; abra uma role importada antes de atribuí-la a um agente.',
      },
    ],
  },
  {
    id: 'pipeline-aprovacao',
    icon: 'Workflow',
    title: 'Pipeline escreve → revisa → aprova',
    tagline: 'Fluxo com 3 passos e uma pausa para o seu OK.',
    steps: [
      {
        id: 'agents',
        title: 'Dev e revisor',
        body: 'Crio os dois agentes do pipeline: o Dev (escreve) e o Revisor (critica).',
        action: { kind: 'createAgent', title: 'Dev', provider: 'claude' },
      },
      {
        id: 'reviewer',
        title: 'O revisor',
        body: 'Crio o revisor do pipeline.',
        action: { kind: 'createAgent', title: 'Revisor', provider: 'codex' },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Revisor' },
      },
      {
        id: 'flow',
        title: 'O fluxo de 3 passos',
        body: 'Crio o nó Fluxo: passo 1 o Dev escreve ({{input}} = sua entrada), passo 2 o Revisor critica a saída do Dev, passo 3 pausa para a SUA aprovação.',
        action: {
          kind: 'createFlow',
          title: 'Pipeline revisão',
          steps: [
            { kind: 'agent', target: 'Dev', prompt: 'Escreva a solução para: {{input}}' },
            { kind: 'agent', target: 'Revisor', prompt: 'Revise criticamente, aponte problemas e melhorias: {{input}}' },
            { kind: 'approval' },
          ],
        },
        check: { kind: 'nodeExists', nodeType: 'flow' },
      },
      {
        id: 'run',
        title: 'Rode o fluxo',
        body: 'No nó Fluxo: escreva a entrada (ex.: "validação de formulário com zod") e clique em Rodar. Acompanhe os passos acendendo e aprove no passo final.',
      },
    ],
  },
  {
    id: 'mcp-tools',
    icon: 'Cable',
    title: 'Tools externas via MCP',
    tagline: 'GitHub, docs e web nas mãos dos agentes — com um clique.',
    steps: [
      {
        id: 'install',
        title: 'Instale um MCP com 1 clique',
        body: 'Instalo o DeepWiki (documentação de qualquer repositório, sem configurar nada) neste workspace — sem comando, sem token.',
        action: { kind: 'installMcp', key: 'deepwiki' },
        check: { kind: 'mcpInstalled', name: 'deepwiki' },
      },
      {
        id: 'market',
        title: 'O marketplace de MCPs',
        body: 'Página Skills → aba MCPs: curadoria oficial (GitHub, Gmail, Figma, Drive, Vercel...) + registry completo. Os que pedem token abrem um diálogo guiado.',
      },
      {
        id: 'use',
        title: 'Use num agente',
        body: 'Num terminal de agente (Claude/Kimi), peça algo que o MCP faz — ex.: "pergunte ao DeepWiki como funciona o auth do repositório X". A tool aparece nativa no agente.',
      },
    ],
  },
  {
    id: 'chained-flows',
    icon: 'Workflow',
    title: 'Fluxos encadeados',
    tagline: 'Um fluxo dispara o próximo — pipelines compostos e fan-out.',
    steps: [
      {
        id: 'first-flow',
        title: 'O primeiro elo',
        body: 'Crio o Fluxo "Pesquisa" com um passo de aprovação — assim você simula a etapa sem precisar de agente real.',
        action: { kind: 'createFlow', title: 'Pesquisa', steps: [{ kind: 'approval' }] },
        check: { kind: 'nodeExists', nodeType: 'flow', titleIncludes: 'Pesquisa' },
      },
      {
        id: 'second-flow',
        title: 'O segundo elo',
        body: 'Crio o Fluxo "Redação" — quando a Pesquisa terminar com sucesso, a saída dela vira a entrada da Redação sozinha.',
        action: { kind: 'createFlow', title: 'Redação', steps: [{ kind: 'approval' }] },
        check: { kind: 'nodeExists', nodeType: 'flow', titleIncludes: 'Redação' },
      },
      {
        id: 'chain',
        title: 'Conecte os dois fluxos',
        body: 'Ligo Pesquisa → Redação com uma aresta: é a aresta que diz para onde a saída vai quando o fluxo termina.',
        action: { kind: 'connect', fromTitle: 'Pesquisa', toTitle: 'Redação' },
        check: { kind: 'edgeExists', fromTitle: 'Pesquisa', toTitle: 'Redação' },
      },
      {
        id: 'run-chain',
        title: 'Rode e veja o encadeamento',
        body: 'No Fluxo Pesquisa: clique Rodar e depois Aprovar. Quando ele termina, a Redação dispara sozinha com a saída — falha não encadeia e ciclo é bloqueado. Fan-out: conecte um terceiro fluxo à Pesquisa e os dois disparam juntos. E o botão Sincronizar transforma cada agente conectado a um fluxo em passo, na ordem das arestas.',
      },
    ],
  },

  {
    id: 'ui-exploration',
    icon: 'PanelsTopLeft',
    title: 'Explore três direções completas de UI',
    tagline: 'Compare design editável, tokens, componentes, protótipo e código antes de escolher.',
    steps: [
      {
        id: 'open-exploration',
        title: 'Defina o resultado uma vez',
        body: 'Use Fazer por mim para criar uma exploração guiada completa com briefing, tarefas e três direções editáveis. Pelo menu Design, você também pode preencher objetivo, público, plataforma, stack, restrições, referências e modos visuais antes de criar.',
        action: { kind: 'createDesignExploration', title: 'Exploração guiada de UI', objective: 'Explorar três direções visuais completas para uma interface clara, diferenciada e pronta para implementação.', audience: 'Pessoas que usarão o produto em desktop e celular.' },
        check: { kind: 'nodeExists', nodeType: 'group' },
      },
      {
        id: 'inspect-package',
        title: 'Comece pequeno e acompanhe',
        body: 'O Orkestrai cria uma spec vinculada, oito tarefas progressivas e três documentos Design nativos. Cada designer entrega primeiro apenas uma tela desktop e uma mobile. O status no node deixa claro quem está aguardando, trabalhando, parado há cinco minutos ou pronto para revisão.',
        check: { kind: 'nodeExists', nodeType: 'design' },
      },
      {
        id: 'compare-directions',
        title: 'Revise o conceito visual',
        body: 'Abra Qualidade dentro de cada documento e use Revisão visual para aprovar ou solicitar alterações com feedback rastreável. Avalie hierarquia, composição, identidade, clareza e acabamento: a auditoria automática verifica estrutura, não gosto ou qualidade visual.',
      },
      {
        id: 'approve-deliver',
        title: 'Expanda somente o aprovado',
        body: 'Depois da aprovação, a direção escolhida recebe estados responsivos, tokens, componentes, protótipo e código. Valide em Portal ou dispositivo móvel, rode os testes e registre o resultado ligado ao Git no Review Center.',
      },
    ],
  },
  {
    id: 'design-figma',
    icon: 'Palette',
    title: 'Crie designs junto com seu time de IA',
    tagline: 'Um documento visual nativo para você, o designer e o líder.',
    steps: [
      {
        id: 'document',
        title: 'Crie um documento de design nativo',
        body: 'Crio um node Design de Interface no mesmo Canvas do time. O documento estruturado fica dentro de .orkestrai/designs no seu workspace.',
        action: { kind: 'createDesign', title: 'Design de Interface' },
        check: { kind: 'nodeExists', nodeType: 'design', titleIncludes: 'Design de Interface' },
      },
      {
        id: 'open',
        title: 'Abra o Modo Design',
        body: 'Abra o mesmo documento no Modo Design em tela cheia no Canvas. Tooltips mostram cada ferramenta e atalho. A Caneta antecipa o próximo segmento e o fechamento; clique ou arraste para desenhar e use Enter ou duplo-clique no path para editá-lo. Curve ou divida segmentos, continue por uma extremidade e escolha tangentes Canto, Espelhado, Assimétrico ou Desconectado.',
        action: { kind: 'openDesign', title: 'Design de Interface' },
      },
      {
        id: 'compose',
        title: 'Componha interfaces vetoriais responsivas',
        body: 'Selecione pontos vetoriais por caixa e transforme-os juntos, redimensione qualquer camada pelas oito alças e edite texto multilinha diretamente no canvas. Use Shift para alinhar, distribuir, combinar, mascarar ou agrupar camadas; mova e redimensione descendentes do grupo juntos, selecione uma camada interna com Alt e encontre, selecione ou substitua cores iguais de preenchimento e contorno na página.',
      },
      {
        id: 'assets-export',
        title: 'Traga assets e exporte o trabalho aprovado',
        body: 'Cole, arraste ou escolha um SVG para transformar paths, formas, transforms, estilos e gradientes em camadas nativas editáveis. Imagens raster continuam na biblioteca reutilizável. Copie a seleção como SVG ou PNG ou exporte a seleção ou página inteira em SVG, PNG, JPEG, WebP ou PDF.',
      },
      {
        id: 'design-system',
        title: 'Torne a linguagem visual reutilizável',
        body: 'Abra Variáveis ao lado de Camadas. Comece por um preset de produto, marketing ou mobile, importe DTCG/CSS ou exporte DTCG/CSS/Tailwind; crie modos, aliases e bindings e use a auditoria para localizar repetições. Em Componentes, transforme frames em fontes reutilizáveis, crie instâncias, propriedades, variantes e slots. Em Bibliotecas, compartilhe versões apenas com workspaces autorizados. Em Código, extraia CSS variables, Tailwind e contratos Svelte, React ou Vue sem executar arquivos e conecte a fonte visual à implementação. Agentes usam o mesmo command bus protegido por revisão.',
      },
      {
        id: 'figma-bridge',
        title: 'Vincule o mesmo trabalho ao Figma',
        body: 'Abra Componentes → Figma. O MCP oficial já é gerenciado para agentes compatíveis. Salve um token REST somente leitura no cofre do sistema operacional, cole o link de uma página ou frame, inspecione, escolha o que entra no documento nativo e revise alterações remotas, locais ou conflitantes antes da sincronização. Manter a versão local coloca somente aquela layer revisada na fila do Figma. Instale o plugin próprio pela pasta dele, cole a conexão loopback restrita ao workspace copiada pelo Orkestrai e então transfira uma seleção ao vivo ou envie apenas as layers da fila.',
      },
      {
        id: 'designer',
        title: 'Adicione um designer ao mesmo documento',
        body: 'Crio um agente Designer. Ele inspeciona e edita o documento estruturado exato com tools tipadas do Orkestrai, sem adivinhar o visual por um screenshot.',
        action: { kind: 'createAgent', title: 'Designer', provider: 'claude' },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Designer' },
      },
      {
        id: 'connect',
        title: 'Torne a colaboração visível',
        body: 'Conecto o node Design ao Designer. O agente lê a revisão atual, aplica uma operação tipada e verifica o resultado enquanto seu editor atualiza ao vivo.',
        action: { kind: 'connect', fromTitle: 'Design de Interface', toTitle: 'Designer' },
        check: { kind: 'edgeExists', fromTitle: 'Design de Interface', toTitle: 'Designer' },
      },
    ],
  },
  {
    id: 'design-delivery',
    icon: 'Code2',
    title: 'Entregue um design como código funcional',
    tagline: 'Importe, gere, compare e revise sem quebrar a fonte visual.',
    steps: [
      {
        id: 'document',
        title: 'Comece por um único documento nativo',
        body: 'Crio um node Entrega de Design. O mesmo documento estruturado continua sendo a fonte para edição manual, agentes, código gerado e evidências visuais.',
        action: { kind: 'createDesign', title: 'Entrega de Design' },
        check: { kind: 'nodeExists', nodeType: 'design', titleIncludes: 'Entrega de Design' },
      },
      {
        id: 'open-code',
        title: 'Abra a área de entrega de Código',
        body: 'Abra o documento Design, escolha Componentes e depois Código. Conectar varre tokens e componentes reais; Importar código, Gerar e Validar ficam como etapas vizinhas do mesmo fluxo.',
        action: { kind: 'openDesign', title: 'Entrega de Design' },
      },
      {
        id: 'import',
        title: 'Traga uma interface existente para o scene graph',
        body: 'Em Importar código, escolha HTML/Tailwind, Svelte, React/JSX ou Vue e cole markup mais CSS opcional. Revise as notas de compatibilidade e crie layers nativas editáveis. Scripts e configurações do projeto nunca são executados.',
      },
      {
        id: 'generate',
        title: 'Revise antes de gravar o código da implementação',
        body: 'Selecione um frame ou grupo, escolha Svelar/Svelte 5, React, Next.js, Vue 3 ou HTML/Tailwind e informe o path do workspace. Veja primeiro o arquivo completo. Mappings compatíveis de Code Connect reutilizam componentes reais; a gravação é bloqueada se o arquivo mudar depois da prévia, e o resultado abre direto no Monaco. Agentes usam o mesmo fluxo protegido por revisão pelas tools MCP tipadas do Orkestrai ou pela CLI incluída.',
      },
      {
        id: 'validate',
        title: 'Compare com uma implementação ao vivo',
        body: 'Mantenha um Portal visível ou conecte um dispositivo iOS/Android, escolha o frame ou viewport responsivo e capture. Inspecione design normalizado, implementação, overlay ajustável e pixel diff em vez de depender da memória.',
      },
      {
        id: 'trace',
        title: 'Mantenha o feedback vinculado ao trabalho',
        body: 'Crie uma tarefa no Kanban com screenshots de referência, implementação e diff ou uma entrada na Central de Review vinculada ao arquivo Git gerado. O líder pode atribuir e o revisor aprova a alteração real.',
      },
    ],
  },
  {
    id: 'design-prototype',
    icon: 'PlaySquare',
    title: 'Monte um protótipo interativo',
    tagline: 'Conecte telas, anime layers e compartilhe uma experiência testável.',
    steps: [
      {
        id: 'document',
        title: 'Comece pela fonte de design nativa',
        body: 'Crio um node Design chamado Protótipo do Produto. Frames, variáveis, componentes, interações e motion compartilham o mesmo histórico de revisões.',
        action: { kind: 'createDesign', title: 'Protótipo do Produto' },
        check: { kind: 'nodeExists', nodeType: 'design', titleIncludes: 'Protótipo do Produto' },
      },
      {
        id: 'open',
        title: 'Abra o inspetor de Protótipo',
        body: 'Abra o documento e selecione Protótipo no inspetor direito. Crie um fluxo inicial e selecione um frame ou layer para acessar interações e controles de rolagem.',
        action: { kind: 'openDesign', title: 'Protótipo do Produto' },
      },
      {
        id: 'interactions',
        title: 'Vincule comportamento à layer selecionada',
        body: 'Adicione gatilhos de clique, pressionar, hover ou tempo para navegar entre frames, abrir overlays, voltar, rolar ou trocar modos de variáveis. Execute o fluxo para validar transições, layers fixas, hotspots e overflow no contexto.',
      },
      {
        id: 'motion',
        title: 'Anime com tokens reutilizáveis e keyframes',
        body: 'Troque para Motion, crie um token de duração e easing, adicione um track à layer selecionada e edite timeline e keyframes. Copie keyframes CSS ou saída Motion.dev quando a implementação precisar do mesmo comportamento.',
      },
      {
        id: 'share',
        title: 'Apresente ou compartilhe sem expor o workspace',
        body: 'Use o player focado com moldura de dispositivo, hotspots, tela cheia, reiniciar e voltar. Compartilhar exporta um protótipo HTML autocontido e somente leitura com o fluxo de interação aprovado.',
      },
    ],
  },
  {
    id: 'managed-ports',
    icon: 'RadioTower',
    title: 'Liberar portas de dev servers',
    tagline: 'Veja e encerre listeners locais sem sair do canvas.',
    steps: [
      {
        id: 'portal',
        title: 'Registre o app num Portal',
        body: 'Crio um Portal local na porta 4173. É esse vínculo persistido que permite ao Orkestrai gerenciar a porta com segurança.',
        action: { kind: 'createPortal', url: 'http://localhost:4173', title: 'Portal Dev' },
        check: { kind: 'nodeExists', nodeType: 'portal', titleIncludes: 'Portal Dev' },
      },
      {
        id: 'server',
        title: 'Inicie seu dev server',
        body: 'No terminal do projeto, inicie o app na mesma porta do Portal. Você pode usar `orkestrai port 4173` para escolher uma porta livre antes de subir o servidor.',
      },
      {
        id: 'panel',
        title: 'Abra Portas e libere o listener',
        body: 'Na barra inferior, logo depois de Usage, abra Portas. O processo aparece como em uso; clique no ícone de parar e confirme. O Portal fica salvo para a próxima execução.',
      },
    ],
  },
  {
    id: 'leader-dictation',
    icon: 'Mic',
    title: 'Ditar em qualquer campo',
    tagline: 'Fale onde estiver escrevendo, sem depender de um líder.',
    steps: [
      {
        id: 'field',
        title: 'Posicione o cursor',
        body: 'Clique em qualquer campo editável: título ou descrição de tarefa, role, nota ou formulário. O ditado acompanha o último campo e a seleção atual.',
      },
      {
        id: 'record',
        title: 'Clique na bolinha de voz',
        body: 'Use a bolinha colorida ou Alt+Espaço para gravar. O primeiro clique preserva o campo focado. O pequeno badge clicável mostra se ela está fixada ou livre e abre diretamente os controles de posição; o tooltip também exibe o atalho Ctrl+clique ou Command+clique. Desafixe a bolinha para arrastá-la dentro do canvas visível.',
      },
      {
        id: 'auto-submit',
        title: 'Escolha se o terminal deve enviar',
        body: 'Em Configurações → Ditado por voz, ative Enviar automaticamente no terminal para anexar Enter à transcrição. A opção só envia em terminais; kanban, roles, notas e formulários continuam apenas recebendo o texto.',
      },
      {
        id: 'fallback',
        title: 'Use o atalho do líder em qualquer modo',
        body: 'Sem um campo ativo, a bolinha envia a transcrição ao líder em Modo Maestro no Canvas ou no Workbench. Crio um líder para você testar; sem campo e sem líder, o app mostra um aviso. No macOS, Fn/Globe isolada é reservada pelo sistema, então configure um combo ou F1–F12.',
        action: { kind: 'createAgent', title: 'Líder por voz', provider: 'claude', leader: true },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Líder por voz' },
      },
    ],
  },
  {
    id: 'audio-devices',
    icon: 'Mic',
    title: 'Escolher e testar dispositivos de áudio',
    tagline: 'Use o microfone e a saída certos em todo o Orkestrai.',
    steps: [
      {
        id: 'open-settings',
        title: 'Abra as configurações de Voz',
        body: 'Abra Configurações → Voz. Os dispositivos de áudio aparecem acima do motor de voz, mantendo a escolha de entrada e saída separada dos modelos de STT e TTS.',
      },
      {
        id: 'grant-and-choose',
        title: 'Revele e escolha o microfone',
        body: 'Clique em Atualizar para autorizar o microfone e revelar os nomes. Escolha uma entrada, clique em Testar microfone e confirme a reação do medidor ao vivo antes de salvar.',
      },
      {
        id: 'test-output',
        title: 'Teste a saída de áudio',
        body: 'Escolha uma saída e reproduza o tom curto. Toda prévia e resposta falada passa por ela. Se a plataforma não permitir escolher uma saída específica, o Orkestrai explica que usará o padrão do sistema.',
      },
      {
        id: 'recover',
        title: 'Recupere sem adivinhação',
        body: 'O ditado captura PCM direto pela mesma rota Web Audio do medidor e normaliza fala baixa localmente. Se o dispositivo selecionado for desconectado, o Orkestrai volta ao padrão do sistema. Erros de captura distinguem permissão, hardware ausente, interrupção, provável disputa e um microfone que abre sem produzir sinal.',
      },
    ],
  },
  {
    id: 'switch-agent-provider',
    icon: 'Cable',
    title: 'Trocar o provider de um agente',
    tagline: 'Mude o modelo de execução sem desmontar o time.',
    steps: [
      {
        id: 'open',
        title: 'Abra a troca no cabeçalho',
        body: 'No agente que quer substituir, clique em ⇄. O menu lista os providers detectados neste dispositivo e marca o atual.',
      },
      {
        id: 'choose',
        title: 'Escolha um provider instalado',
        body: 'A troca encerra a PTY e a conversa do provider anterior e inicia uma sessão limpa com o novo adapter e suas flags de acesso.',
      },
      {
        id: 'preserve',
        title: 'Continue com o mesmo membro',
        body: 'Nome, role, Modo Maestro, andar, posição e conexões permanecem. Reaplique o contexto necessário na nova conversa e continue pelo mesmo quadro.',
      },
    ],
  },
  {
    id: 'multilingual-spoken-replies',
    icon: 'Languages',
    title: 'Respostas faladas em três idiomas',
    tagline: 'Escolha, teste e use uma voz local adequada ao idioma.',
    steps: [
      {
        id: 'choose',
        title: 'Escolha a voz nas Configurações',
        body: 'Abra Configurações → Voz e selecione Português (Brasil), English (United States) ou Español (Latinoamérica). Cada opção define junto o speaker e o idioma de síntese.',
      },
      {
        id: 'preview',
        title: 'Ouça antes de usar',
        body: 'Ajuste a velocidade entre 0,75× e 1,50× e clique em Ouvir prévia. No primeiro uso, confirme o download local; depois as três vozes funcionam offline no macOS, Linux e Windows.',
      },
      {
        id: 'enable',
        title: 'Ative no agente',
        body: 'Volte ao canvas e clique no alto-falante do terminal. A próxima resposta será falada na voz escolhida, por frases, enquanto o ditado continua usando o mesmo Parakeet de antes.',
      },
    ],
  },
  {
    id: 'team-template-library',
    icon: 'LayoutTemplate',
    title: 'Começar com um time pronto',
    tagline: 'Escolha a stack e receba agentes, roles, skills e quadro já organizados.',
    steps: [
      {
        id: 'preset-library',
        title: 'Abra a biblioteca de presets',
        body: 'Use o ícone de template na barra lateral ou Presets na barra inferior. Filtre por Produto, Desenvolvimento, Design e criação, Marketing e conteúdo ou Orkestrai.',
      },
      {
        id: 'create-or-merge',
        title: 'Crie do zero ou some ao time atual',
        body: 'Novo workspace prepara o projeto escolhido com layout, tarefas, roles e skills. O botão + adiciona o mesmo time ao canvas atual sem remover seus nodes.',
      },
      {
        id: 'operate',
        title: 'Complete o time e acompanhe os andares',
        body: 'As roles extensas entram automaticamente na primeira sessão e o líder recebe a tarefa inicial completa para atribuir. Em Andares, acompanhe o título, a etapa e o responsável real de cada tarefa antes de revisar e aterrissar.',
      },
    ],
  },
  {
    id: 'custom-board-stages',
    icon: 'Workflow',
    title: 'Adaptar o quadro ao seu processo',
    tagline: 'Troque o kanban genérico pelas etapas que sua equipe realmente usa.',
    steps: [
      {
        id: 'board',
        title: 'Crie o quadro de trabalho',
        body: 'Crio um nó Tarefas. Ele começa simples e pode representar uma campanha, produção de conteúdo, projeto de design ou desenvolvimento.',
        action: { kind: 'createTasksBoard' },
        check: { kind: 'nodeExists', nodeType: 'tasks', titleIncludes: 'Tarefas' },
      },
      {
        id: 'stages',
        title: 'Defina suas etapas',
        body: 'No cabeçalho do quadro, clique no ícone de colunas. Renomeie, mude cores, reordene e adicione etapas como Ideias, Aprovação e Publicado.',
      },
      {
        id: 'team-awareness',
        title: 'O time acompanha o mesmo fluxo',
        body: 'O líder e os especialistas recebem as etapas automaticamente. Eles criam e movem entregas no quadro enquanto você acompanha tudo visualmente.',
      },
    ],
  },
  {
    id: 'campaign-ready-team',
    icon: 'Palette',
    title: 'Lançar uma campanha com um time pronto',
    tagline: 'Estratégia, pesquisa, copy e métricas já chegam organizadas.',
    steps: [
      {
        id: 'library',
        title: 'Abra a Biblioteca de presets',
        body: 'Escolha Marketing e conteúdo → Campanha e lançamento. Para outras frentes, há também Brand e design e Conteúdo e SEO.',
      },
      {
        id: 'apply',
        title: 'Comece novo ou some ao workspace',
        body: 'Novo workspace cria o time em outra pasta. O botão + adiciona líder e especialistas ao canvas atual sem remover nada.',
      },
      {
        id: 'brief',
        title: 'Complete o briefing e dê o objetivo',
        body: 'Preencha objetivo, público, oferta, canais, prazo e métrica na nota criada. Depois fale com o líder: ele coordena pesquisa, copy, distribuição e aprovação.',
      },
    ],
  },
  {
    id: 'orkestrai-consensus-team',
    icon: 'LayoutTemplate',
    title: 'Contribuir no Orkestrai com consenso',
    tagline: 'Claude, Codex e Kimi concordam com o plano antes da execução.',
    steps: [
      {
        id: 'apply',
        title: 'Aplique Orkestrai Contributing',
        body: 'Na categoria Orkestrai da Biblioteca, crie o time completo com líder, dois oráculos e especialistas Svelar, desktop e QA/release.',
      },
      {
        id: 'consensus',
        title: 'Rode o Flow de consenso',
        body: 'Codex propõe ou audita a arquitetura, Kimi revisa produto, UX e riscos, e Claude sintetiza. Os dois oráculos precisam responder APROVADO.',
      },
      {
        id: 'delivery',
        title: 'Só então distribua as tarefas',
        body: 'Com o plano aprovado, o líder registra a decisão, cria briefings completos e acompanha Revisão e Validação até testes, build, documentação e changelog passarem.',
      },
    ],
  },
  {
    id: 'provider-center-setup',
    icon: 'Cable',
    title: 'Preparar seus providers de IA',
    tagline: 'Veja o que está pronto e siga a configuração oficial sem adivinhar comandos.',
    steps: [
      {
        id: 'open-center',
        title: 'Abra a Central de Providers',
        body: 'Use o ícone de cabo na barra lateral esquerda, Cmd/Ctrl+2 ou Workspace → Central de Providers. Ela verifica Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline, Devin e GitHub Copilot localmente.',
      },
      {
        id: 'follow-setup',
        title: 'Siga a configuração do seu dispositivo',
        body: 'Expanda um agente para ver o guia oficial e, quando disponível, um comando de instalação para macOS, Windows ou Linux. Conclua o login na própria CLI do provider; o Orkestrai nunca recebe a credencial.',
      },
      {
        id: 'verify',
        title: 'Verifique novamente e crie o agente',
        body: 'Volte à Central e use Verificar novamente. Quando a CLI for detectada, retorne ao canvas e crie esse agente pela barra inferior.',
      },
      {
        id: 'multi-account',
        title: 'Use uma segunda conta com Perfis',
        body: 'Se o provider tiver um override verificado de diretório de conta, a seção Perfis aparece ao expandi-lo: crie um perfil nomeado (ex.: "Trabalho") apontando para a configuração oficial daquela conta. Escolha-o direto no diálogo de Novo agente, ou depois pelo menu do terminal, e o roteamento de Uso também pode selecioná-lo. As credenciais ficam nos arquivos da CLI e só são resolvidas ao iniciar a PTY.',
      },
    ],
  },
  {
    id: 'choose-agent-provider',
    icon: 'Users',
    title: 'Escolher agentes sem conhecer terminal',
    tagline: 'Use o serviço que você já tem e organize o time pelo resultado.',
    steps: [
      {
        id: 'available',
        title: 'Veja o que já está disponível',
        body: 'A barra inferior detecta Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline, Devin e GitHub Copilot. Os disponíveis ficam ativos; os desativados só precisam de instalação e login.',
      },
      {
        id: 'outcome',
        title: 'Dê nome ao trabalho, não à tecnologia',
        body: 'Crie “Pesquisa de público”, “Direção de arte”, “Copy da campanha” ou “Revisão do produto”. Roles, notas e tarefas dizem ao agente o que entregar, mesmo que você nunca use um terminal fora do Orkestrai.',
      },
      {
        id: 'perspective',
        title: 'Combine apenas quando ajudar',
        body: 'Um provider basta para começar. Adicione outro para revisar uma decisão importante ou trazer uma perspectiva independente; o Orkestrai mantém cada conversa separada e conectada ao workspace.',
      },
    ],
  },
  {
    id: 'pin-favorite-agents',
    icon: 'Pin',
    title: 'Manter agentes favoritos por perto',
    tagline: 'Adapte a barra à sua rotina sem esconder as outras opções.',
    steps: [
      {
        id: 'open-agents',
        title: 'Abra o menu Agentes',
        body: 'Use Agentes na barra inferior para ver todos os serviços compatíveis. Selecionar um agente pronto arma a mesma ferramenta de desenho de antes; um agente que precisa de configuração abre a Central de Providers.',
      },
      {
        id: 'pin-favorites',
        title: 'Fixe até quatro favoritos',
        body: 'Em Fixados na barra, marque os serviços que você mais usa. Os favoritos prontos aparecem como botões diretos ao lado de Agentes, na ordem escolhida.',
      },
      {
        id: 'keep-your-preference',
        title: 'Use a mesma barra em todo lugar',
        body: 'A escolha é global e continua após trocar de workspace ou reiniciar o app. Se uma CLI fixada ficar indisponível, ela permanece salva, mas não ocupa espaço na barra.',
      },
    ],
  },
  {
    id: 'devin-local-agent',
    icon: 'Cable',
    title: 'Adicionar o Devin ao time local',
    tagline: 'Use o agente local oficial no mesmo fluxo visual do canvas.',
    steps: [
      {
        id: 'prepare',
        title: 'Prepare a CLI oficial',
        body: 'Abra a Central de Providers, expanda Devin e siga as instruções de instalação e login. Verifique novamente até o Devin aparecer como pronto.',
      },
      {
        id: 'create',
        title: 'Crie o membro Devin',
        body: 'Volte ao canvas e selecione Devin na barra inferior. Pesquise ou role a lista limitada de modelos, escolha um disponível na sua conta e inicie com acesso autônomo ao workspace.',
      },
      {
        id: 'continue',
        title: 'Trabalhe pela ponte',
        body: 'Conecte o Devin ao líder, quadro ou notas. O Orkestrai provisiona as tools MCP e a skill, mantém respostas limpas e retoma a conversa exata depois de reiniciar.',
      },
    ],
  },
  {
    id: 'quota-aware-delegation',
    icon: 'RadioTower',
    title: 'Delegação por cota',
    tagline: 'O líder enxerga os limites antes de distribuir trabalho novo.',
    steps: [
      {
        id: 'add-usage',
        title: 'Coloque Uso no canvas',
        body: 'Crio um nó Uso persistente com Claude como origem, Codex como fallback e limite inicial de 90%. Ele acompanha Claude, Codex e Kimi a cada cinco minutos.',
        action: { kind: 'createUsage', title: 'Uso dos providers' },
        check: { kind: 'nodeExists', nodeType: 'usage', titleIncludes: 'Uso dos providers' },
      },
      {
        id: 'understand-provider-capabilities',
        title: 'Leia somente capacidade verificada',
        body: 'Claude, Codex e Kimi reportam percentuais automáticos. Antigravity aponta para /usage ou /quota; Cursor e Devin explicam a exigência de API administrativa; OpenCode e Cline apontam para o provider de modelo escolhido. O Orkestrai nunca inventa uma cota.',
      },
      {
        id: 'set-policy',
        title: 'Ajuste a política',
        body: 'Roteamento do líder é a primeira seção do nó. Escolha a origem, um fallback diferente, a janela de 5 horas, semanal ou mensal e o percentual que significa "perto do limite". Os detalhes dos providers rolam abaixo sem ampliar o canvas, inclusive em nós compactos já salvos. Se o provider não reportar esse período, o nó pede outra janela.',
      },
      {
        id: 'leader-checks',
        title: 'O líder consulta antes de delegar',
        body: 'A skill ensina o líder a chamar orkestrai usage antes de distribuir trabalho novo. Ele recomenda um fallback saudável sem mover silenciosamente tarefas ou conversas que já estão em execução.',
      },
    ],
  },
  {
    id: 'organize-canvas',
    icon: 'LayoutGrid',
    title: 'Organizar o canvas',
    tagline: 'Realinhe uma seleção ou todo o workspace sem sobreposições.',
    steps: [
      {
        id: 'choose-scope',
        title: 'Escolha o que será movido',
        body: 'Selecione os nós que precisam de atenção. Com uma seleção, o Orkestrai move somente esses nós; sem seleção, organiza o canvas inteiro.',
      },
      {
        id: 'run-layout',
        title: 'Execute Organizar canvas',
        body: 'Use a ação da barra, a paleta de comandos ou Command+Shift+T. O layout determinístico distribui os nós em linhas legíveis sem empilhá-los.',
      },
      {
        id: 'keep-connections-clear',
        title: 'Mantenha o workspace legível',
        body: 'As conexões ficam atrás de todos os nós, inclusive em telas Windows com escalas diferentes. Depois, você ainda pode fazer ajustes manuais.',
      },
    ],
  },
  {
    id: 'focused-workspace-view',
    icon: 'PanelLeftOpen',
    title: 'Trabalhar no Workbench',
    tagline: 'Abra, organize e compare artefatos sem perder o canvas.',
    steps: [
      {
        id: 'switch-view',
        title: 'Alterne a visualização',
        body: 'Use Canvas/Workbench no canto superior esquerdo ou abra Workbench pelo menu Workspace. Os agentes continuam nas mesmas sessões enquanto você troca de modo; as métricas da fonte estabilizam antes do reattach para manter o cursor alinhado após visitar Configurações ou documentação.',
      },
      {
        id: 'choose-item',
        title: 'Escolha onde trabalhar',
        body: 'Expanda um workspace ou use a pesquisa. Os itens abertos ficam em abas verticais por padrão; você pode escolher abas horizontais em Configurações → Aparência.',
      },
      {
        id: 'split-work',
        title: 'Monte seu espaço de trabalho',
        body: 'Divida o painel ativo para a direita ou para baixo e organize até oito artefatos redimensionáveis. Arraste abas entre painéis ou use o menu Mover para; o layout retorna com o workspace.',
      },
      {
        id: 'attach-context',
        title: 'Leve as referências com o trabalho',
        body: 'Solte, cole ou selecione imagens, PDFs, arquivos e links em notas, cartões ou no composer do agente. Arquivos de até 10 MB ficam no workspace e a referência completa chega no briefing.',
      },
      {
        id: 'monitor-provider-usage',
        title: 'Acompanhe as cotas no rodapé',
        body: 'O rodapé mostra as janelas de 5 horas, semanal e mensal realmente reportadas por Claude, Codex e Kimi. Clique em qualquer provider para abrir os detalhes de Uso.',
      },
      {
        id: 'terminal-options',
        title: 'Organize as opções do terminal',
        body: 'Abra o menu de reticências no cabeçalho para trocar provider, role ou escolher visualmente um dos 15 temas ANSI, além de recarregar, alternar Modo Maestro ou remover o terminal.',
      },
      {
        id: 'dictate-to-leader',
        title: 'Dite sem voltar ao canvas',
        body: 'Fixada, a bolinha ocupa um espaço próprio no cabeçalho sem cobrir abas ou ações. Sem um campo de texto ativo, ela encontra o líder do workspace, abre o terminal dele e inicia o mesmo fluxo do Canvas.',
      },
      {
        id: 'return-canvas',
        title: 'Volte ao contexto visual',
        body: 'Clique no ícone de canvas no cabeçalho ou use o seletor. O workspace permanece ativo e o nó escolhido aparece centralizado no canvas.',
      },
    ],
  },
  {
    id: 'edit-and-preview-files',
    icon: 'FileCode2',
    title: 'Editar e visualizar arquivos',
    tagline: 'Use um editor local completo e inspecione formatos comuns sem sair do app.',
    steps: [
      {
        id: 'open-file',
        title: 'Abra um arquivo do workspace',
        body: 'Expanda Arquivos no sidebar do Workbench e escolha um arquivo de texto. Ele abre diretamente em uma aba local, sem adicionar um nó ao Canvas. O Monaco preserva cursor, seleção, undo e alterações não salvas entre abas e painéis.',
      },
      {
        id: 'use-editor-tools',
        title: 'Use as ferramentas do editor',
        body: 'Busque ou substitua texto, navegue por símbolos, formate arquivos compatíveis e alterne quebra de linha ou minimapa. Configurações → Aparência também oferece tamanho da fonte e autosave opcional.',
      },
      {
        id: 'inspect-previews',
        title: 'Inspecione sem outro aplicativo',
        body: 'Alterne Markdown entre fonte e prévia, navegue e amplie PDFs ou mova e amplie imagens. Binários mostram metadados seguros e podem abrir no aplicativo do sistema.',
      },
      {
        id: 'protect-edits',
        title: 'Mantenha alterações explícitas',
        body: 'Abas não salvas mostram um indicador e pedem confirmação ao fechar. Arquivos acima de 512 KB abrem somente para leitura, evitando sobrescrever conteúdo que não foi carregado.',
      },
    ],
  },
  {
    id: 'share-reference-material',
    icon: 'Paperclip',
    title: 'Compartilhar materiais de referência',
    tagline: 'Mantenha imagens, PDFs, arquivos e links junto do briefing que os agentes recebem.',
    steps: [
      {
        id: 'prepare-reference-note',
        title: 'Prepare um briefing rastreável',
        body: 'Crie uma nota para reunir objetivo, restrições e referências do trabalho. Ela continua sendo um node do Canvas e pode ser aberta no Workbench.',
        action: { kind: 'createNote', title: 'Briefing com referências', content: '# Briefing\n\n## Objetivo\n\n## Referências\n' },
        check: { kind: 'nodeExists', nodeType: 'note', titleIncludes: 'Briefing com referências' },
      },
      {
        id: 'attach-reference',
        title: 'Anexe no contexto certo',
        body: 'Arraste, cole ou selecione uma imagem, PDF, arquivo ou link HTTP/HTTPS na nota, no composer de um agente ou em uma tarefa. O item aparece com nome, tipo e ação de remoção explícita.',
      },
      {
        id: 'deliver-complete-context',
        title: 'Entregue o briefing completo',
        body: 'Conecte a nota ao líder ou atribua a tarefa. O agente recebe título, descrição e referências com paths relativos sob .orkestrai/attachments, sem depender de texto colado ou memória da conversa.',
      },
    ],
  },
  {
    id: 'universal-workspace-search',
    icon: 'Search',
    title: 'Usar a busca universal',
    tagline: 'Encontre e abra qualquer parte do trabalho com Command/Ctrl+K.',
    steps: [
      {
        id: 'open-search',
        title: 'Abra de qualquer tela',
        body: 'Pressione Command/Ctrl+K para buscar workspaces, agentes, tarefas, notas, roles, skills, arquivos, configurações e comandos.',
      },
      {
        id: 'inspect-result',
        title: 'Confira o contexto',
        body: 'Navegue pelos grupos e leia a prévia antes de abrir. Marque itens frequentes com a estrela; itens usados recentemente reaparecem na abertura seguinte.',
      },
      {
        id: 'place-result',
        title: 'Escolha onde abrir',
        body: 'Abra no painel atual, à direita ou abaixo. Use content: antes do termo para buscar dentro dos arquivos, sempre limitado à pasta do workspace.',
      },
    ],
  },
  {
    id: 'monitor-team-control-center',
    icon: 'Activity',
    title: 'Acompanhar o time na Central de controle',
    tagline: 'Veja a atividade real e confirme cada handoff sem acordar agentes ociosos.',
    steps: [
      {
        id: 'open-control-center',
        title: 'Abra a visão operacional',
        body: 'Vá ao Workbench, expanda um workspace e abra a Central de controle acima de Arquivos. Ela é uma visão local do Workbench e não cria outro nó no Canvas.',
        action: { kind: 'openPage', path: '/terminal?workspace={workspace}&node=workbench-control-center:{workspace}' },
      },
      {
        id: 'read-agent-state',
        title: 'Leia o estado real dos agentes',
        body: 'Compare agentes trabalhando, aguardando resposta ou permissão, bloqueados, ociosos, concluídos, com erro ou desconectados. Atividade transforma mensagens, tarefas, revisões, decisões, Git e eventos do sistema em uma timeline legível.',
      },
      {
        id: 'verify-delivery',
        title: 'Verifique as comunicações',
        body: 'A caixa projeta as transições na fila, enviada, entregue, recebida, respondida e falhou em um envelope canônico. Replays são idempotentes e um orkestrai ask bem-sucedido sempre termina com resposta confirmada.',
      },
      {
        id: 'switch-without-waking',
        title: 'Troque de workspace com segurança',
        body: 'Troque de tela ou reinicie o app. O histórico reconstrói a Central sem injetar prompts nem ativar terminais ociosos; notificações nativas ficam reservadas para atenção e conclusão reais.',
      },
    ],
  },
  {
    id: 'triage-attention-center',
    icon: 'BellRing',
    title: 'Tratar atenção entre todos os workspaces',
    tagline: 'Resolva perguntas e bloqueios reais sem vasculhar cada terminal.',
    steps: [
      {
        id: 'open-attention-center',
        title: 'Abra a caixa global',
        body: 'Use o sino ao lado da troca Canvas/Workbench. Ele permanece disponível nas duas visões e não acorda nenhum agente.',
        action: { kind: 'openPage', path: '/canvas?workspace={workspace}' },
      },
      {
        id: 'prioritize-signals',
        title: 'Comece pelo workspace atual',
        body: 'Perguntas, pedidos de permissão, bloqueios e falhas são reunidos de todos os workspaces, com o atual e a maior severidade primeiro.',
      },
      {
        id: 'defer-or-resolve',
        title: 'Abra, adie ou resolva',
        body: 'Abra a origem exata, marque como lido, adie por uma hora ou resolva. Toda ação mantém o histórico persistido de auditoria.',
      },
      {
        id: 'search-history',
        title: 'Recupere o histórico depois',
        body: 'Use Command/Ctrl+K com type:attention, workspace:"Nome", agent:"Nome", status:open, has:error, before: ou after: para encontrar o mesmo sinal novamente.',
      },
    ],
  },
  {
    id: 'trace-delivery-workstream',
    icon: 'Route',
    title: 'Rastrear uma entrega completa em Fluxos de trabalho',
    tagline: 'Mantenha tarefa, time, decisões, revisão e evidência Git no mesmo fluxo.',
    steps: [
      {
        id: 'open-workstreams',
        title: 'Abra a visão da entrega',
        body: 'Expanda o workspace no Workbench e abra Fluxos de trabalho ou encontre pelo Command/Ctrl+K. A visão projeta registros existentes e não cria outro node no Canvas.',
        action: { kind: 'openPage', path: '/terminal?workspace={workspace}&node=workbench-workstreams:{workspace}' },
      },
      {
        id: 'start-from-task',
        title: 'Use a tarefa do Kanban como identidade',
        body: 'Crie e atribua a tarefa real no quadro. Coluna, responsável, andar ativo, branch e atividade semântica aparecem automaticamente no fluxo.',
      },
      {
        id: 'connect-decisions-and-review',
        title: 'Mantenha decisões e revisão vinculadas',
        body: 'Peça perspectivas do Conselho pelo fluxo para que recebam o mesmo briefing. Crie o registro na Central de revisão contra essa tarefa e selecione revisão, arquivos, evidências, testes e riscos exatos.',
      },
      {
        id: 'inspect-delivery-trace',
        title: 'Leia o rastro completo',
        body: 'Compare timeline de atividade, progresso do Conselho, estado da revisão e caminhos Git vinculados. Registros sem vínculo continuam contabilizados explicitamente em vez de serem atribuídos à entrega errada.',
      },
    ],
  },
  {
    id: 'preserve-sourced-workspace-memory',
    icon: 'BookMarked',
    title: 'Preserve memória do workspace com fontes',
    tagline: 'Mantenha conhecimento durável útil sem transformar toda conversa em fato.',
    steps: [
      { id: 'open-workspace-memory', title: 'Abra a memória compartilhada', body: 'Abra Memória do workspace pelo explorador do Workbench, paleta de comandos do Canvas ou Command/Ctrl+K.', action: { kind: 'openPage', path: '/terminal?workspace={workspace}&node=workbench-memory:{workspace}' } },
      { id: 'record-durable-knowledge', title: 'Registre apenas conhecimento reutilizável', body: 'Escolha decisão, fato, preferência, restrição, referência ou aprendizado. Adicione conteúdo conciso, confiança, tags e fixe apenas o que merece prioridade.' },
      { id: 'attach-memory-source', title: 'Associe a evidência', body: 'Adicione pelo menos uma declaração do usuário, nota, tarefa, mensagem, arquivo, URL, referência Git, revisão, Conselho ou agente. Identificação e trecho tornam a procedência compreensível.' },
      { id: 'revise-memory-safely', title: 'Revise sem apagar o histórico', body: 'Use Revisar quando o conhecimento mudar. A versão anterior continua auditável e um editor desatualizado não sobrescreve silenciosamente um valor mais novo.' },
    ],
  },
  {
    id: 'triage-traceable-annotations',
    icon: 'MessageSquareText',
    title: 'Faça a triagem de anotações rastreáveis',
    tagline: 'Mantenha feedback de código e design ligado ao artefato que o originou.',
    steps: [
      { id: 'open-annotation-center', title: 'Abra a visão unificada', body: 'Abra a Central de Anotações pelo Canvas, explorer do Workbench ou Command/Ctrl+K.', action: { kind: 'openPage', path: '/terminal?workspace={workspace}&node=workbench-annotations:{workspace}' } },
      { id: 'filter-annotation-center', title: 'Encontre o feedback importante', body: 'Alterne entre itens abertos, resolvidos e todos. Pesquise por comentário, autor, revisão, arquivo, documento de Design ou camada.' },
      { id: 'inspect-annotation-source', title: 'Confira revisão e contexto', body: 'Inspecione a revisão capturada e o aviso de obsolescência. Comentários de código detectam mudanças posteriores; threads de Design mantêm revisão e camada.' },
      { id: 'resolve-at-source', title: 'Volte ao artefato canônico', body: 'Escolha Abrir origem para responder ou resolver na Central de revisão ou no Design nativo. A central nunca divide o estado do feedback.' },
    ],
  },
  {
    id: 'version-and-share-team-pack',
    icon: 'PackageOpen',
    title: 'Versione e compartilhe um Team Pack',
    tagline: 'Reutilize um time completo sem carregar sessões ou segredos.',
    steps: [
      { id: 'open-team-packs', title: 'Abra Team Packs', body: 'Abra a biblioteca de presets pelo Canvas. Presets embutidos e existentes continuam funcionando, enquanto snapshots customizados têm histórico.', action: { kind: 'openPage', path: '/canvas?workspace={workspace}' } },
      { id: 'capture-team-pack', title: 'Capture o time funcional', body: 'Salve o workspace como pack customizado. Agentes, roles, skills, etapas, tarefas-modelo, rotinas, MCPs, conexões e layout entram; o runtime vivo é removido.' },
      { id: 'publish-team-pack', title: 'Publique uma revisão imutável', body: 'Abra o histórico, informe uma versão semântica maior e notas e publique. A revisão anterior com checksum permanece inalterada.' },
      { id: 'share-team-pack', title: 'Exporte ou importe com segurança', body: 'Exporte o JSON protegido ou importe de outra instalação. O Orkestrai valida formato, tamanho, limites e SHA-256 antes de criar um pack local.' },
    ],
  },
  {
    id: 'run-agent-huddle',
    icon: 'MessageCircleMore',
    title: 'Conduza um huddle persistente de agentes',
    tagline: 'Reúna os agentes certos em uma conversa assistida por voz e rastreável.',
    steps: [
      { id: 'open-huddles', title: 'Abra Huddles', body: 'Abra Huddles pela barra do Canvas, explorer do Workbench, menu nativo Workspace ou Command/Ctrl+K.', action: { kind: 'openPage', path: '/canvas?workspace={workspace}' } },
      { id: 'choose-huddle-room', title: 'Configure a sala', body: 'Informe assunto e pauta opcional, escolha até onze agentes e defina o facilitador. Só pode existir um huddle ativo por workspace.' },
      { id: 'hold-huddle-turn', title: 'Direcione aos participantes certos', body: 'Selecione até cinco agentes participantes e escreva ou dite a fala. Respostas pendentes, concluídas, falhas e contribuições ficam ordenadas na transcrição persistida; o TTS opcional lê apenas respostas novas dos agentes.' },
      { id: 'close-huddle-loop', title: 'Transforme a decisão em trabalho', body: 'Encerre explicitamente e crie uma tarefa Kanban vinculada quando houver acompanhamento. Pauta e transcrição limitada viram evidência rastreável no Fluxo de trabalho relacionado.' },
    ],
  },
  {
    id: 'review-delivery',
    icon: 'GitPullRequestArrow',
    title: 'Revisar uma entrega',
    tagline: 'Inspecione as alterações reais, reúna evidências e registre uma decisão clara.',
    steps: [
      {
        id: 'open-review-center',
        title: 'Abra a Central de revisão',
        body: 'Vá ao Workbench, expanda o workspace e abra a Central de revisão acima de Arquivos. Ela é uma tela local e não adiciona outro nó ao Canvas.',
        action: { kind: 'openPage', path: '/terminal?workspace={workspace}&node=workbench-review-center:{workspace}' },
      },
      {
        id: 'inspect-diff',
        title: 'Inspecione as alterações reais',
        body: 'Escolha um arquivo preparado ou não preparado. O Monaco compara lado a lado a versão indexada e a alterada; use a lista para preparar, remover da preparação ou criar o commit sem trocar de aplicativo.',
      },
      {
        id: 'capture-context',
        title: 'Registre o contexto da entrega',
        body: 'Inicie uma revisão, vincule a tarefa e o agente responsável e registre resultado esperado, evidências, testes, riscos e arquivos incluídos. A revisão Git atual é salva junto.',
      },
      {
        id: 'decide',
        title: 'Comente e decida',
        body: 'Clique em uma linha do diff para comentar e então aprove, solicite alterações ou rejeite. Alterações solicitadas são enviadas ao agente responsável quando ele está online; os comentários permanecem visíveis e ficam marcados como desatualizados se o código mudar.',
      },
    ],
  },
  {
    id: 'portal-design-feedback',
    icon: 'ScanSearch',
    title: 'Dar feedback visual por um Portal',
    tagline: 'Selecione o elemento exato da interface e envie contexto seguro e acionável.',
    steps: [
      {
        id: 'open-portal',
        title: 'Abra a página real',
        body: 'Abra um Portal no Canvas ou Workbench usando o aplicativo instalado. Carregue a tela e o viewport onde encontrou o problema visual.',
        action: { kind: 'openPage', path: '/canvas' },
      },
      {
        id: 'inspect-element',
        title: 'Selecione o elemento',
        body: 'Escolha Inspecionar design no cabeçalho do Portal. Passe pela página para destacar elementos reais e clique no botão, campo, imagem, título ou área de layout exata. Pressione Esc para cancelar sem alterar a página.',
      },
      {
        id: 'review-context',
        title: 'Revise antes de enviar',
        body: 'Confirme o screenshot recortado, seletor, texto visível, estilos relevantes, path da página e viewport. Adicione o resultado esperado. O HTML bruto fica na prévia sanitizada; cookies, tokens, storage, headers e query strings ficam de fora.',
      },
      {
        id: 'send-feedback',
        title: 'Escolha o destino responsável',
        body: 'Crie uma tarefa para triagem do líder, uma tarefa já atribuída a um especialista ou acrescente o feedback e PNG a uma tarefa existente. Todas as opções mantêm o contexto e a decisão rastreáveis no Kanban.',
      },
    ],
  },
  {
    id: 'council-perspectives',
    icon: 'Scale',
    title: 'Comparar perspectivas com Council',
    tagline: 'Dê a mesma pergunta a agentes independentes e mantenha a decisão final humana.',
    steps: [
      {
        id: 'open-council',
        title: 'Comece pelo trabalho',
        body: 'Abra Conselho diretamente na barra do Canvas ou no topo do workspace no Workbench. Você também pode usar Pedir perspectivas em uma tarefa para levar o briefing completo ou no menu do líder para já selecioná-lo.',
        action: { kind: 'openCouncil' },
      },
      {
        id: 'configure-council',
        title: 'Limite a comparação',
        body: 'Escolha de dois a cinco agentes reais, dê uma abordagem distinta a cada um, selecione modo consultivo ou implementação e um critério de decisão, e então defina o máximo de execuções. A síntese opcional do líder consome uma execução desse limite.',
      },
      {
        id: 'compare-council',
        title: 'Compare o mesmo contrato',
        body: 'Revise lado a lado proposta, evidências verificadas, riscos, testes, divergências, recomendação e confiança. Perspectivas concluídas continuam úteis quando outro provider falha; a sugestão do líder é consultiva, não um veredito automático.',
      },
      {
        id: 'decide-council',
        title: 'Registre a decisão humana',
        body: 'Selecione uma perspectiva, peça mais consenso ou rejeite a rodada e salve sua justificativa. No modo implementação, somente um andar selecionado e commitado pode ser aterrissado, após nova prévia limpa e sem conflitos. Council nunca faz push ou merge sozinho.',
      },
    ],
  },
  {
    id: 'mobile-device-testing',
    icon: 'Smartphone',
    title: 'Testar um app no iOS ou Android',
    tagline: 'Controle, inspecione e capture um fluxo mobile sem sair do workspace.',
    steps: [
      {
        id: 'open-mobile-device',
        title: 'Adicione Dispositivo móvel',
        body: 'Adicione Dispositivo móvel pela barra do Canvas. Ele vira um único node persistente do workspace; o Workbench lista e abre o mesmo node. Escolha iOS Simulator no Apple Silicon ou Android no macOS, Windows e Linux com o Platform Tools do Android Studio instalado.',
        action: { kind: 'createDevice', title: 'Dispositivo móvel' },
        check: { kind: 'nodeExists', nodeType: 'device' },
      },
      {
        id: 'attach-simulator',
        title: 'Conecte um dispositivo',
        body: 'Escolha um iPhone ou iPad Simulator, um AVD Android ou um aparelho Android autorizado no ADB e selecione Iniciar. Hardware Android físico pede confirmação explícita. A tela se ajusta por padrão; zoom e 1:1 continuam independentes. Clique ou arraste para tocar e fazer swipe, enquanto a barra oferece os botões do sistema da plataforma, rotação, pinça, reinício e encerramento.',
      },
      {
        id: 'inspect-mobile-flow',
        title: 'Inspecione o fluxo',
        body: 'Abra Ferramentas do dispositivo para digitar texto, instalar um build iOS ou APK por um path do workspace, abrir um bundle id ou package/activity Android, inspecionar ou alterar permissões, ler logs e dados de acessibilidade limitados e salvar um screenshot em .orkestrai/devices/screenshots.',
      },
      {
        id: 'delegate-mobile-check',
        title: 'Delegue com evidências',
        body: 'Peça a um agente para usar orkestrai device ou as tools MCP equivalentes. Toques, swipes, screenshots, logs e inspeção de acessibilidade usam a sessão deste workspace. Encerre ao terminar; o Orkestrai também limpa helpers ociosos que ele iniciou.',
      },
    ],
  },
  {
    id: 'workspace-automations',
    icon: 'Workflow',
    title: 'Automatizar trabalho repetível do workspace',
    tagline: 'Conecte um gatilho preciso a uma ação rastreável sem esconder o que rodou.',
    steps: [
      {
        id: 'open-automations',
        title: 'Abra Automações',
        body: 'Abra Automações pela barra do Canvas, pelo explorer do Workbench ou por Command/Ctrl+K. As mesmas automações e o mesmo histórico do workspace aparecem em todos os acessos.',
        action: { kind: 'openPage', path: '/terminal?workspace={workspace}&node=workbench-automations:{workspace}' },
      },
      {
        id: 'choose-recipe',
        title: 'Comece por uma receita útil',
        body: 'Abra Receitas e escolha um ponto de partida de desenvolvimento, design, marketing, pesquisa ou operações. A receita preenche o formulário, mas nunca executa antes de você revisar e salvar.',
      },
      {
        id: 'configure-trigger-action',
        title: 'Deixe o contrato explícito',
        body: 'Escolha o evento e a ação exatos. Gatilhos de tarefa, mensagem, Git, GitHub, webhook, arquivo, uso, agenda e manual podem enviar prompt, criar tarefa no Kanban ou notificar o desktop.',
      },
      {
        id: 'inspect-history',
        title: 'Acompanhe cada execução',
        body: 'Use o Histórico de execuções para inspecionar entrada, agente e provider de destino, confirmação da saída, duração, tentativa e falha. Execuções com erro oferecem retry limitado em vez de desaparecer.',
      },
    ],
  },
  {
    id: 'remote-workspace-collaboration',
    icon: 'RadioTower',
    title: 'Compartilhar um workspace com segurança',
    tagline: 'Aprove as capacidades remotas exatas para cada dispositivo confiável.',
    steps: [
      {
        id: 'open-sharing',
        title: 'Abra o compartilhamento',
        body: 'Abra Compartilhar workspace pelo Canvas ou Workbench. Esta funcionalidade experimental vem desativada e precisa ser habilitada explicitamente no host.',
        action: { kind: 'openSharing' },
      },
      {
        id: 'create-invite',
        title: 'Escolha o destino e o acesso',
        body: 'Selecione Leitor, Colaborador, Operador ou Administrador e escolha Navegador/celular para abrir o PWA Remote ou App Orkestrai para outro desktop instalado. O convidado pode clicar no convite do app para abrir o Orkestrai automaticamente ou usar Workspace → Entrar em workspace remoto para colá-lo manualmente. Envie somente o link ou QR code correspondente por um canal confiável.',
      },
      {
        id: 'approve-device',
        title: 'Aprove o dispositivo correto',
        body: 'Compare a impressão digital do dispositivo antes de aprová-lo. Você pode trocar sua função, revogá-lo imediatamente e consultar cada comando aceito ou rejeitado na auditoria.',
      },
      {
        id: 'choose-agent-access',
        title: 'Separe conversa do acesso ao terminal',
        body: 'Operadores podem usar a conversa segura com o agente. Administradores também podem iniciar ou restaurar um agente. Habilite o terminal bruto separadamente para um dispositivo Administrador confiável somente quando necessário; ele vem desligado, limita-se a um terminal, controla tráfego, usa criptografia e gera auditoria.',
      },
      {
        id: 'use-remote-voice-terminal',
        title: 'Dite ou abra o terminal certo',
        body: 'No Remote, use o microfone na conversa com o líder, com outro agente ou no terminal; o STT roda localmente no host, o áudio segue criptografado e o relay nunca o processa. A tela principal preserva o histórico do líder e só publica a resposta depois do fim real do turno, reunindo falas intermediárias e o resultado final. No terminal, o ditado apenas insere texto. Abrir terminal fecha a modal e ocupa a tela, ajustando fonte, colunas e linhas ao celular, tablet ou desktop.',
      },
      {
        id: 'work-remotely',
        title: 'Use ou instale o Remote',
        body: 'Depois que o convidado solicita acesso, o host abre Compartilhar workspace → Acessos, compara a impressão digital e aprova o dispositivo. No navegador ou PWA instalável, ele acompanha a visão sanitizada e usa somente os comandos concedidos. Arquivos, notas, portais, dispositivos mobile, credenciais, caminhos locais e edição do Canvas continuam indisponíveis; a saída bruta só aparece enquanto sua permissão separada estiver habilitada.',
      },
      {
        id: 'stop-sharing',
        title: 'Encerre a sessão',
        body: 'Pare o compartilhamento quando a colaboração terminar. O Orkestrai fecha a sessão no relay, revoga o acesso ativo e exige um novo convite para qualquer reconexão.',
      },
    ],
  },
  {
    id: 'custom-app-theme',
    icon: 'Palette',
    title: 'Personalizar a aparência',
    tagline: 'Escolha um tema pronto ou ajuste cada token visual do app.',
    steps: [
      {
        id: 'choose-theme',
        title: 'Escolha claro ou escuro',
        body: 'Em Configurações → Aparência, compare Orkestrai Dark, Graphite, Midnight e Orkestrai Light. A opção clara mantém contraste acessível em nós, painéis, ícones, marcas dos providers e hovers.',
      },
      {
        id: 'edit-tokens',
        title: 'Crie seu próprio tema',
        body: 'Duplique o tema mais próximo e edite tokens semânticos de superfícies, textos, bordas, destaque, estados, grade e conexões. Use Salvar para persistir.',
      },
      {
        id: 'share-theme',
        title: 'Leve o tema com você',
        body: 'Exporte o tema personalizado como JSON e importe em outra instalação. O arquivo é validado e não executa CSS arbitrário.',
      },
    ],
  },
  {
    id: 'design-collaboration',
    icon: 'MessagesSquare',
    title: 'Colabore em um documento Design',
    tagline: 'Converse, proponha e aprove trabalho visual sem perder autoria nem revisões.',
    steps: [
      {
        id: 'open-design-collaboration',
        title: 'Abra um documento Design compartilhado',
        body: 'Crie um documento Design nativo e abra-o. No inspector direito, escolha Colaboração para ver pessoas, comentários, propostas e conflitos de edição no mesmo lugar.',
        action: [
          { kind: 'createDesign', title: 'Design Colaborativo' },
          { kind: 'openDesign', title: 'Design Colaborativo' },
        ],
        check: { kind: 'nodeExists', nodeType: 'design', titleIncludes: 'Design Colaborativo' },
      },
      {
        id: 'follow-and-comment',
        title: 'Siga o trabalho e ancore o feedback',
        body: 'Participantes ao vivo mostram página, cursor e seleção. Siga uma pessoa durante a revisão, selecione uma layer e adicione um comentário. Respostas, menções, resolução e autoria ficam versionadas no documento.',
      },
      {
        id: 'review-proposal',
        title: 'Revise antes de aplicar',
        body: 'Crie ou solicite uma proposta visual. A prévia e o diff estrutural não alteram o documento até uma pessoa aprovar explicitamente. A aprovação aplica todas as operações de forma atômica; um conflito bloqueia a gravação em vez de sobrescrever outro participante.',
      },
      {
        id: 'route-and-share',
        title: 'Escolha o caminho de decisão',
        body: 'Envie propostas incertas ao Council ou crie um Andar isolado para implementação paralela. Ao compartilhar remotamente, aprove o Design separadamente como Visualizar, Comentar, Propor ou Editar e decidir. O Remote recebe resumos sanitizados, nunca o scene graph, assets, arquivos ou caminhos locais.',
      },
    ],
  },
  {
    id: 'design-quality',
    icon: 'ShieldCheck',
    title: 'Audite e proteja um documento Design',
    tagline: 'Encontre defeitos visuais, use templates completos e recupere com segurança.',
    steps: [
      {
        id: 'open-design-quality',
        title: 'Abra o inspector de qualidade',
        body: 'Crie um documento Design nativo e abra Qualidade no inspector direito. A auditoria verifica nomes, cortes, sobreposição, contraste e acessibilidade sem alterar a arte.',
        action: [
          { kind: 'createDesign', title: 'Design de Produção' },
          { kind: 'openDesign', title: 'Design de Produção' },
        ],
        check: { kind: 'nodeExists', nodeType: 'design', titleIncludes: 'Design de Produção' },
      },
      { id: 'inspect-quality-issues', title: 'Vá direto à layer exata', body: 'Cada problema identifica sua gravidade e regra. Selecione-o para focar a layer afetada, corrija a propriedade no mesmo editor e acompanhe a atualização do relatório.' },
      { id: 'apply-design-template', title: 'Comece com um template nativo completo', body: 'Escolha Produto, Marketing, Mobile ou Design system. O template cria layers, tokens e, quando aplicável, fluxos de protótipo ou componentes editáveis por operações normais e versionadas.' },
      { id: 'recover-design-document', title: 'Entenda a recuperação', body: 'Qualidade também mostra o backup automático e o histórico recente limitado. Restaurar exige confirmação e cria uma nova revisão; documentos grandes renderizam de forma incremental preservando seleção e hierarquia.' },
    ],
  },
  {
    id: 'visual-annotations',
    icon: 'Shapes',
    title: 'Anotar e reutilizar um layout do Canvas',
    tagline: 'Monte uma explicação visual uma vez e duplique sem refazer os estilos.',
    steps: [
      {
        id: 'create-annotation',
        title: 'Adicione uma anotação visual',
        body: 'Eu crio uma forma estilizada no Canvas. Dê duplo-clique no texto e use o controle de estilo para trocar forma, cores, tipografia, borda e pontos da seta.',
        action: { kind: 'createShape', title: 'Nota de revisão', shape: 'rounded' },
        check: { kind: 'nodeExists', nodeType: 'shape', titleIncludes: 'Nota de revisão' },
      },
      { id: 'duplicate-annotation', title: 'Duplique sem reconstruir', body: 'Selecione uma ou mais formas e pressione Cmd/Ctrl+D, ou use a ação visível de duplicar. Posição, tamanho, texto, cores, tipografia e geometria da seta são preservados com um pequeno deslocamento.' },
      { id: 'copy-paste-annotation', title: 'Reutilize um arranjo completo', body: 'Selecione as formas, copie com Cmd/Ctrl+C e cole com Cmd/Ctrl+V. A seleção múltipla mantém o espaçamento relativo, e cada cópia continua editável de forma independente.' },
    ],
  },
  {
    id: 'api-client',
    icon: 'FileCode2',
    title: 'Testar uma API no Canvas',
    tagline: 'HTTP, GraphQL, WebSocket e gRPC ao lado do time, sem Alt+Tab.',
    steps: [
      {
        id: 'create-client',
        title: 'Adicione o Cliente de API',
        body: 'Crio uma coleção de API persistente com pastas, requests HTTP, GraphQL, WebSocket e gRPC, ambientes, scripts, testes, respostas e histórico no mesmo workspace.',
        action: { kind: 'createApiClient', title: 'API do projeto' },
        check: { kind: 'nodeExists', nodeType: 'apiClient', titleIncludes: 'API do projeto' },
      },
      { id: 'import-collection', title: 'Vincule a coleção do projeto', body: 'Importe Bruno, OpenCollection YAML, Postman v2.1, Swagger 2.0, OpenAPI 3.x ou um backup completo do Orkestrai. Coleções existentes no repositório continuam vinculadas em modo de acompanhamento, mantendo Canvas/Workbench e arquivos do projeto como uma única fonte de verdade.' },
      { id: 'multi-repository', title: 'Autorize repositórios irmãos', body: 'Quando este workspace coordena repositórios ao lado do diretório de trabalho, abra Editar workspace > Repositórios adicionais. Escolha cada repositório uma vez e defina um alias como api-tests; os agentes passam a usar @api-tests/bruno sem obter acesso a pastas superiores arbitrárias.' },
      { id: 'prepare-request', title: 'Prepare protocolo e credenciais', body: 'Escolha HTTP, GraphQL, WebSocket ou gRPC. Configure ambientes, headers, chave de API/Bearer/Basic ou obtenha um token OAuth 2.0 pelo fluxo assistido no navegador com PKCE. A aba Rede guarda cookies, proxy, CA, certificado do cliente e verificação TLS.' },
      { id: 'automate-and-test', title: 'Automatize e teste com autocomplete', body: 'Escolha Postman, Bruno ou Nativo. Os editores sugerem pm.*, bru.*, req/res e test/expect. Use Scripts para Pré/Pós-resposta e alterne Assertions/JavaScript em Testes; o runtime de origem executa escopos, callbacks, Chai, cookies, fluxo, visualizações e dados de iteração.' },
      { id: 'agent-authoring', title: 'Delegue testes versionados no projeto', body: 'Conecte o Cliente de API a um agente ou líder. Ele pode importar uma coleção Bruno/Postman por caminho relativo, editar pastas, requests, scripts, testes e variáveis nativos do formato, executar a suíte e persistir mudanças vinculadas nos arquivos originais sem expor segredos locais. Configurações de runner exclusivas do Orkestrai permanecem no node e no backup nativo.' },
      { id: 'send-request', title: 'Revise e compartilhe o resultado', body: 'Expanda ou recolha respostas JSON/XML estruturadas e veja transcrições WebSocket/gRPC, headers, testes, console, tempo, tamanho e histórico. Exporte Bruno, OpenCollection, Postman, OpenAPI 3.1, ambiente ou coleção nativa.' },
    ],
  },
  {
    id: 'windows-wsl-agents',
    icon: 'Laptop',
    title: 'Combinar agentes Windows e WSL',
    tagline: 'Escolha o ambiente certo para cada terminal do mesmo time.',
    steps: [
      {
        id: 'choose-runtime',
        title: 'Defina o padrão do workspace',
        body: 'No Windows, abra Novo workspace ou Editar workspace e escolha o ambiente que a maior parte do time vai herdar.',
      },
      {
        id: 'choose-distribution',
        title: 'Ajuste somente as exceções',
        body: 'Ao criar o agente ou pelo menu compacto do terminal, abra Ambiente de execução e escolha Padrão do workspace, Windows nativo ou WSL. O badge WIN/WSL deixa a sobrescrita visível.',
      },
      {
        id: 'set-linux-path',
        title: 'Selecione distribuição e caminho',
        body: 'Escolha a instalação que contém a CLI e confirme a pasta Linux correspondente ao projeto. Ubuntu-22.04, Ubuntu-24.04 e Debian permanecem independentes; ao salvar, somente aquele terminal reinicia no ambiente escolhido.',
      },
    ],
  },
  {
    id: 'saved-terminal-commands',
    icon: 'ListRestart',
    title: 'Salvar e reutilizar comandos de terminal',
    tagline: 'Atalhos por terminal, globais e autoexecução segura em shells.',
    steps: [
      {
        id: 'open-saved-commands',
        title: 'Abra os comandos salvos',
        body: 'No cabeçalho de um terminal, abra o menu de opções e expanda Comandos salvos. Comandos locais e globais aparecem ali para execução imediata; escolha Criar e gerenciar comandos para adicionar ou editar.',
      },
      {
        id: 'save-and-run-command',
        title: 'Salve e execute manualmente',
        body: 'Dê um nome claro, informe o comando e salve. A pesquisa encontra nome e conteúdo; Executar envia o comando ao terminal atual. O mesmo fluxo funciona manualmente em shells e agentes.',
      },
      {
        id: 'configure-safe-resume',
        title: 'Automatize somente shells',
        body: 'Em um shell puro, ative Executar ao retomar. O comando roda uma vez ao criar ou restaurar aquela sessão, sem repetir ao trocar entre Canvas e Workbench. Agentes nunca recebem autoexecução. Não salve senhas nem tokens no comando.',
      },
    ],
  },
  {
    id: 'workspace-folders',
    icon: 'FolderTree',
    title: 'Organize workspaces em pastas',
    tagline: 'Agrupe projetos por cliente, time ou ambiente na barra lateral.',
    steps: [
      { id: 'open-canvas-sidebar', title: 'Abra a barra lateral', body: 'Expanda a barra lateral do Canvas (o botão de recolher no cabeçalho dela) pra ver a lista completa de workspaces.', action: { kind: 'openPage', path: '/canvas?workspace={workspace}' } },
      { id: 'create-workspace-folder', title: 'Crie uma pasta', body: 'Digite um nome em Nova pasta no fim da lista e confirme. Ela aparece na raiz, pronta pra receber workspaces.' },
      { id: 'file-workspace-into-folder', title: 'Guarde um workspace nela', body: 'Arraste qualquer workspace pro cabeçalho da pasta pra movê-lo pra lá; arraste pro espaço vazio da lista pra mandar de volta pra raiz.' },
      { id: 'create-workspace-in-folder', title: 'Crie um workspace já dentro de uma pasta', body: 'Passe o mouse no cabeçalho de uma pasta e use o ícone de mais pra abrir o Novo workspace com essa pasta pré-selecionada como destino, ou escolha qualquer pasta no campo Pasta do próprio diálogo — sem precisar arrastar depois.' },
      { id: 'nest-workspace-folders', title: 'Aninhe e gerencie pastas', body: 'Arraste uma pasta sobre outra pra transformá-la em subpasta, ou use o ícone de "nova subpasta" no cabeçalho de uma pasta pra criar uma já dentro dela — sem limite de profundidade. Renomeie com o ícone de lápis ou duplo-clique, e apague com o ícone de lixeira: workspaces e subpastas dentro sempre sobem pra raiz em vez de serem removidos.' },
    ],
  },
  {
    id: 'creative-image-workflow',
    icon: 'Images',
    title: 'Crie um personagem e uma campanha completa',
    tagline: 'Valide uma cadeia real: personagem, aplicação da marca e carrossel com referências reutilizadas.',
    steps: [
      {
        id: 'create-director',
        title: 'Crie o Diretor Criativo',
        body: 'Eu adiciono um único agente Codex para controlar todas as etapas. Use uma conta ou assinatura Codex autenticada com ImageGen disponível; nenhuma chave de API é necessária.',
        action: { kind: 'createAgent', title: 'Diretor Criativo XYZ', provider: 'codex', position: { x: 40, y: 60 } },
        check: { kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Diretor Criativo XYZ' },
      },
      {
        id: 'prepare-briefs',
        title: 'Prepare os briefings reutilizáveis',
        body: 'Eu crio um briefing completo para a Formiga Atômica e outro para a campanha fictícia XYZ. Você pode testar imediatamente e editar qualquer detalhe nas Notas depois.',
        action: [
          { kind: 'createNote', title: 'Briefing do Personagem XYZ', position: { x: 40, y: 460 }, content: '# Personagem\nFormiga atômica heroica, carismática e ágil, anatomia de formiga estilizada, roupa esportiva moderna e silhueta reconhecível.\n\n## Direção de arte\nAnime contemporâneo, linhas limpas, acabamento premium, expressão amigável, personagem inteiro e iluminação consistente.\n\n## Paleta\nVermelho vivo, branco, preto e pequenos acentos violeta.\n\n## Consistência\nPreservar rosto, antenas, proporções, roupa e identidade visual em todas as etapas. Não adicionar personagens extras nem fundos artificiais.' },
          { kind: 'createNote', title: 'Campanha da Marca XYZ', position: { x: 40, y: 800 }, content: '# Marca XYZ\nMarca de tecnologia criativa para pessoas e agentes trabalharem juntos.\n\n## Paleta\nVioleta #7C4DFF, ciano #22D3EE, preto e branco.\n\n## Carrossel\n1. Crie com pessoas e agentes\n2. Um workspace, progresso visível\n3. Entregue trabalhos melhores\n\n## Regras\nFormato 4:5 para Instagram, composição consistente, espaço seguro para copy e logo legível sem deformação.' },
        ],
        check: { kind: 'nodeExists', nodeType: 'note', titleIncludes: 'Campanha da Marca XYZ' },
      },
      {
        id: 'prepare-character-stage',
        title: 'Monte a etapa do personagem',
        body: 'Eu crio e conecto o primeiro workflow. Ele pedirá três masters transparentes e salvará os PNGs em generated/images/xyz-character.',
        action: [
          { kind: 'createImageWorkflow', title: '01 — Personagem Master', position: { x: 620, y: 60 }, prompt: 'Crie três imagens master de corpo inteiro da Formiga Atômica descrita no briefing conectado. Cada resultado deve ser uma pose distinta, manter exatamente a mesma identidade visual e usar fundo PNG realmente transparente com canal alpha.', count: 3, transparentBackground: true, outputDirectory: 'generated/images/xyz-character', filePrefix: 'atomic-ant-master' },
          { kind: 'connect', fromTitle: 'Briefing do Personagem XYZ', toTitle: '01 — Personagem Master' },
          { kind: 'connect', fromTitle: 'Diretor Criativo XYZ', toTitle: '01 — Personagem Master' },
        ],
        check: { kind: 'edgeExists', fromTitle: 'Diretor Criativo XYZ', toTitle: '01 — Personagem Master' },
      },
      {
        id: 'generate-character',
        title: 'Gere e valide o personagem',
        body: 'Fazer por mim dispara o workflow no Diretor Criativo. Este passo só avança quando os três arquivos existirem no workspace e os três nodes Imagem tiverem sido criados no Canvas.',
        action: { kind: 'runImageWorkflow', title: '01 — Personagem Master' },
        check: { kind: 'imageWorkflowSucceeded', title: '01 — Personagem Master', minOutputs: 3 },
      },
      {
        id: 'prepare-brand-stage',
        title: 'Aplique uma marca ao personagem',
        body: 'Eu gero um logo PNG de teste da marca XYZ, crio a segunda etapa e conecto automaticamente o primeiro master aprovado, o logo, os dois briefings e o mesmo Codex.',
        action: [
          { kind: 'createSampleImage', title: 'Logo de Teste XYZ', path: '.orkestrai/tours/xyz-sample-logo.png', label: 'XYZ', background: '#7C4DFF', foreground: '#FFFFFF', position: { x: 1140, y: 920 } },
          { kind: 'createImageWorkflow', title: '02 — Personagem com Marca', position: { x: 1600, y: 60 }, prompt: 'Use a primeira referência como identidade exata do personagem e a segunda como logo exato da marca XYZ. Crie duas poses promocionais de corpo inteiro com o logo aplicado de forma natural e legível na roupa. Preserve rosto, antenas, anatomia, roupa, paleta e estilo do personagem. Entregue PNG com fundo realmente transparente.', count: 2, transparentBackground: true, outputDirectory: 'generated/images/xyz-branded', filePrefix: 'atomic-ant-xyz' },
          { kind: 'connect', fromTitle: 'Diretor Criativo XYZ', toTitle: '02 — Personagem com Marca' },
          { kind: 'connect', fromTitle: 'Briefing do Personagem XYZ', toTitle: '02 — Personagem com Marca' },
          { kind: 'connect', fromTitle: 'Campanha da Marca XYZ', toTitle: '02 — Personagem com Marca' },
          { kind: 'connectWorkflowOutput', fromWorkflowTitle: '01 — Personagem Master', outputIndex: 0, toWorkflowTitle: '02 — Personagem com Marca' },
          { kind: 'connect', fromTitle: 'Logo de Teste XYZ', toTitle: '02 — Personagem com Marca' },
        ],
      },
      {
        id: 'generate-branded-character',
        title: 'Gere o personagem com a marca',
        body: 'A execução usa as duas referências na ordem mostrada pelo workflow. O tour aguarda os dois resultados reais antes de liberar a etapa do carrossel.',
        action: { kind: 'runImageWorkflow', title: '02 — Personagem com Marca' },
        check: { kind: 'imageWorkflowSucceeded', title: '02 — Personagem com Marca', minOutputs: 2 },
      },
      {
        id: 'prepare-carousel-stage',
        title: 'Monte o carrossel a partir do resultado',
        body: 'Eu crio a terceira etapa e reutilizo automaticamente o primeiro personagem com a marca, além do briefing da campanha. O exemplo usa três slides para validar rápido; o seletor permite aumentar para dez.',
        action: [
          { kind: 'createImageWorkflow', title: '03 — Carrossel XYZ', position: { x: 2580, y: 60 }, prompt: 'Crie um carrossel coerente de três imagens 4:5 para Instagram usando o personagem com marca conectado como identidade visual. Siga a ordem e o conteúdo dos três slides da nota Campanha da Marca XYZ. Preserve personagem, roupa, logo, paleta, iluminação e linguagem visual entre todos os slides. Mantenha áreas seguras e composição clara para leitura em celular.', count: 3, transparentBackground: false, outputDirectory: 'generated/images/xyz-carousel', filePrefix: 'xyz-carousel-slide' },
          { kind: 'connect', fromTitle: 'Diretor Criativo XYZ', toTitle: '03 — Carrossel XYZ' },
          { kind: 'connect', fromTitle: 'Campanha da Marca XYZ', toTitle: '03 — Carrossel XYZ' },
          { kind: 'connect', fromTitle: 'Briefing do Personagem XYZ', toTitle: '03 — Carrossel XYZ' },
          { kind: 'connectWorkflowOutput', fromWorkflowTitle: '02 — Personagem com Marca', outputIndex: 0, toWorkflowTitle: '03 — Carrossel XYZ' },
        ],
      },
      {
        id: 'generate-carousel',
        title: 'Gere e confira a entrega completa',
        body: 'Fazer por mim executa a última etapa. O caso de uso só termina após três slides persistidos e visíveis no Canvas. O grafo final preserva cada prompt, referência, arquivo, conexão, execução e origem.',
        action: { kind: 'runImageWorkflow', title: '03 — Carrossel XYZ' },
        check: { kind: 'imageWorkflowSucceeded', title: '03 — Carrossel XYZ', minOutputs: 3 },
      },
    ],
  },
  {
    id: 'desktop-diagnostics',
    icon: 'Activity',
    title: 'Diagnosticar o app desktop',
    tagline: 'Inspecione uma ação com falha e reúna um log local limitado para o suporte.',
    steps: [
      { id: 'open-developer-tools', title: 'Abra as Ferramentas do desenvolvedor', body: 'Abra Visualizar > Ferramentas do desenvolvedor ou pressione Ctrl+Shift+I no Windows e Linux. Mantenha o Console visível e reproduza a ação que não respondeu.' },
      { id: 'read-console-error', title: 'Capture o primeiro erro relevante', body: 'Copie o primeiro erro vermelho e o stack depois de reproduzir o problema. O Console é a visualização mais rápida para Uso, Workbench e outras ações do renderer que falham sem mensagem visível.' },
      { id: 'open-desktop-logs', title: 'Abra os logs persistentes', body: 'Escolha Ajuda > Abrir pasta de logs e envie o orkestrai.log junto do relato. Os arquivos giram automaticamente, credenciais comuns são ocultadas e a saída normal dos agentes não é persistida.' },
    ],
  },
];
