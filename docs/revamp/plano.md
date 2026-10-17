# Revamp do Orkestrai: plano de features

Branch: `feat/ux-revamp`. Nada deste plano entra na `main` sem aprovação do dono.
Protótipo de referência: https://claude.ai/artifact/79YkJFcHQ2YdAi1zdWB1LJ

## Objetivo

A mesma equipe aparece em três modos:

- **Canvas:** o espaço da equipe.
- **Foco:** trabalho denso de código.
- **Conversa:** a equipe como colegas com nome.

Os agentes deixam de depender de uma janela aberta e viram colegas que trabalham 24/7, recebem pedidos por canais (WhatsApp, Telegram, Slack, celular) e pedem aprovação antes de ações arriscadas.

## Regras que valem para todas as fases

- As regras de negócio existentes continuam valendo. Toda interface nova chama os serviços atuais ou serviços novos com testes.
- Os 4 temas e o contraste exigido por `tests/unit/app-themes.test.ts` continuam passando. Nenhum texto de interface fica abaixo de 11 px.
- Todo texto visível passa por `m['chave']()` nos 3 idiomas.
- Toda feature nova ganha caso de uso nos catálogos de docs, tour guiado e entrada de changelog no mesmo commit.
- O canvas continua fluido no workspace real do Moedex (552 nós e 876 conexões). O teste `canvas-idle-performance` continua passando.
- Seletores usados pelo e2e são mantidos ou atualizados no mesmo commit.
- Docs, commits e código não citam nomes de produtos concorrentes.
- Mudanças de interface trazem capturas de antes e depois do workspace real, de perto e afastado.

## Legenda

- **Existe:** o backend já faz; falta interface.
- **Parcial:** parte existe; a lacuna está descrita.
- **Novo:** precisa de backend e interface.

---

## 1. Fundação

| Id | Feature | Estado | Lacuna |
|---|---|---|---|
| F1 | Barra superior com os modos Canvas, Foco e Conversa, o sino de atenção e a busca ⌘K, em macOS e Windows | Parcial | `WorkspaceModeSwitch` só tem Canvas e Workbench, e fica na sidebar. A barra de título própria só existe no Windows. |
| F2 | Identidade de cada agente: nome curto, cor e avatar, persistidos e iguais em todas as telas | Novo | Campo no payload do terminal e regra de cor estável por agente. |
| F3 | Status unificado no cliente: estado, desde quando, ação atual, tarefa, floor, provider, modelo e máquina | Parcial | O snapshot do `ControlCenterService` existe. Faltam um store compartilhado, o modelo e o esforço como campos (hoje estão em `args`), a máquina e o `startedAt` da tarefa. |
| F4 | Tipografia de destaque condensada e glifos de status padronizados | Novo | Instalar uma fonte local OFL com eixo de largura e criar tokens. |
| F5 | Eventos ao vivo para gates, rotinas, lições, ferramentas e integrações | Parcial | Esses serviços não fazem broadcast. `workspace-events.ts` descarta frames acima de 4 KB e só repassa 3 tipos. |

## 2. Precisa de você (central de atenção)

| Id | Feature | Estado | Lacuna |
|---|---|---|---|
| A1 | Uma central com tudo que espera o dono | Parcial | `AttentionService` e `AttentionCenter` existem. Ainda não chegam lá: gates de aprovação, sessão de dispositivo encerrada, cota de provider esgotada, revisão de design, ferramentas em rascunho, lições pendentes, revisões prontas e pedidos de entrada. |
| A2 | O agente pergunta ao dono, com opções de resposta, e a resposta volta para ele | Novo | `ask` só aceita agente como destino. Falta um destino "dono" no bridge e no MCP e uma rota de resposta para o inbox do agente. |
| A3 | Decidir no lugar: aprovar gate, responder, reiniciar simulador e integrar floor, em qualquer modo, no celular e nos canais | Parcial | As rotas de gate e de floor existem. Falta a ação unificada a partir do item de atenção. |
| A4 | Integração de floor com aprovação por política: o agente pede e o dono aprova | Novo | Hoje o `floorLand` do bridge integra direto. |
| A5 | Resumo "desde sua última visita": concluídas, pedem você, trabalhando, eventos importantes | Novo | Falta marcar a última visita e consultar a atividade a partir de uma data (`listActivity` não filtra por data). As estatísticas existentes só estão disponíveis pelo bridge. |

## 3. Canvas

| Id | Feature | Estado | Lacuna |
|---|---|---|---|
| C1 | Controles flutuantes translúcidos: ferramentas em 5 grupos com busca, painel lateral de workspaces, equipe e partituras, minimapa com zoom, card de resumo | Parcial | O dock e a sidebar existem. A reorganização mantém handlers, seletores e2e e `data-portal-occluder`. |
| C2 | Cabeçalho padrão dos nós: status, avatar, nome, papel e modelo; rodapé com floor e assuntos | Parcial | Restilizar `NodeShell`, que também é usado no Workbench. |
| C3 | Barra contextual do nó selecionado: Terminal/Conversa, Foco, Perfil, Conectar, Pausar | Novo | |
| C4 | Faixa de ação dentro do nó: aprovar, responder, reiniciar | Novo | Depende de A1 a A3. |
| C5 | Terminal em formato de conversa: a mesma sessão mostrada como mensagens formatadas, tabelas e arquivos | Novo | Usar as mensagens trocadas (compositor, `agentReply`, `say`) e os eventos de atividade, sem interpretar a TUI. |
| C6 | Vários assuntos por agente, cada um retomável | Novo | Ligar cada assunto a uma sessão retomável do provider. |
| C7 | Notas escritas pelos agentes, ligadas a eles e empilhadas automaticamente por equipe | Parcial | Notas e conexões existem. Falta empilhar e expandir sob demanda. |
| C8 | Conexões discretas, destacadas só na seleção, com fluxo animado quando agentes conversam | Parcial | `OrkestraiEdge` e o estado de fala existem. |
| C9 | Zoom semântico: afastado mostra o nome grande e o status, e os grupos ganham títulos grandes | Parcial | O modo overview existe, mas mostra caixas vazias. |
| C10 | Áreas por equipe ou por floor, com opção de agrupar automaticamente | Parcial | `GroupCanvasNode` existe. |
| C11 | Desenho à mão livre: caneta, setas e texto manuscrito | Parcial | Formas existem. Traço livre é novo. |
| C12 | Partituras: salvar uma seleção (agentes, papéis, notas, portais e conexões) e reabrir em qualquer workspace | Parcial | Os presets de equipe existem. Falta salvar trechos do canvas. |
| C13 | Compositor flutuante global com @ para agentes, notas, portais e arquivos, imagem colada e rascunho por destino | Parcial | Cada terminal já tem compositor com menção. |

## 4. Foco

| Id | Feature | Estado | Lacuna |
|---|---|---|---|
| D1 | Sidebar com floors e agentes (status, tempo, ação), Precisa de você, Tarefas, Revisões, Skills e Máquinas | Parcial | O Workbench (`/terminal`) existe. |
| D2 | Abas de sessão e divisões arrastáveis: terminal, portal, diff, arquivos e editor | Parcial | `FocusedCanvasNode`. |
| D3 | Terminal renderizado por GPU, com histórico restaurado e busca | Parcial | O addon de busca existe. Faltam o renderizador WebGL com fallback e a restauração do histórico. |
| D4 | Revisão: diff por arquivo, comentário por linha enviado em lote ao agente, antes e depois visual, integração com confirmação | Parcial | Review Center, diff e git existem. O envio de comentários de linha ao agente é novo. |
| D5 | Barra de status com uso por provider, roteamento, máquinas e celular | Parcial | |
| D6 | Mesmo pedido para N agentes em floors separados, comparar e integrar o melhor | Parcial | Council e exploração existem. A comparação lado a lado e a integração do escolhido são novas. |

## 5. Conversa (equipe de colegas)

| Id | Feature | Estado | Lacuna |
|---|---|---|---|
| E1 | Canais da equipe com histórico, onde os agentes postam progresso, conversam entre si e mencionam o dono | Parcial | Huddles têm histórico, mas as conversas entre agentes são por pares. Faltam uma linha do tempo única por canal e uma API para o agente postar. |
| E2 | Mensagem direta com cada agente | Parcial | |
| E3 | Cartões de ação na conversa: aprovação, pergunta, skill aprendida, rotina, revisão | Novo | Depende de A1 e A2. |
| E4 | Perfil do agente: identidade, instruções (papéis), tela atual, memória, skills, rotinas e canais | Parcial | Papéis, memória, rotinas e aprendizado existem separados. |
| E5 | Memória com a origem de cada item e "Esquecer" de verdade, por agente | Parcial | Hoje o DELETE só arquiva. A memória tem `createdByNodeId`. |
| E6 | Skills aprendidas: o agente propõe uma skill a partir da tarefa, o dono aprova e ela vira um SKILL.md do workspace | Parcial | As lições existem. Falta transformar lição em skill. |
| E7 | Ensinar mostrando: gravar um fluxo no Portal ou no Computer, gerar uma skill com parâmetros e gates de risco, testar e agendar | Novo | |
| E8 | Rotinas em linguagem natural, com resultado postado no canal | Parcial | As rotinas existem. Faltam criar por frase e postar no canal. |

## 6. Bots 24/7 (colegas sempre ligados)

| Id | Feature | Estado | Lacuna |
|---|---|---|---|
| B1 | O bot como entidade própria: nome, papel, instruções, avatar, máquina, provider e modelo, permissões, orçamento e canais. Ele tem sessões, mas não depende de um terminal aberto no canvas | Novo | Hoje um agente é um nó de terminal com uma sessão de PTY. |
| B2 | Ciclo de vida sem janela: roda no Core 24/7; estados ativo, dormindo, pausado e erro; acorda por mensagem, agenda ou evento; dorme quando ocioso; retoma a sessão do provider | Parcial | O Core 24/7 local existe (segundo plano e início no login). Falta um supervisor de bots. |
| B3 | Gatilhos: mensagem no canal ou DM, @menção, agenda, eventos (PR, CI, webhook, e-mail, arquivo) e conclusão de outra tarefa | Parcial | As rotinas têm parte disso. |
| B4 | Canais externos com entrada: Telegram, Slack, WhatsApp, e-mail e Discord | Parcial | Enviar já funciona. Receber é novo; hoje nada empurra mensagens recebidas para o app. |
| B5 | Mesma memória e identidade em todos os canais, respostas assinadas e política de quem pode falar com cada bot | Novo | |
| B6 | Aprovação remota: ações arriscadas pausam e pedem aprovação no celular ou no canal; política por bot do que ele pode fazer sem pedir | Parcial | Os gates existem. Falta entregar o pedido fora do app. |
| B7 | Quando um site bloqueia automação, pede login ou captcha, o bot passa aquele passo para o dono e retoma depois | Novo | |
| B8 | Bots em grupo: conversam no canal, dividem tarefas e passam o trabalho adiante | Parcial | O inbox já tem o tipo `handoff`. |
| B9 | Orçamento por bot: limite diário ou semanal, parada e alerta | Parcial | O limite de uso por agente (95%) existe, mas não vira alerta. |
| B10 | Auditoria por bot: o que fez, quando e com qual evidência | Parcial | Os eventos de atividade e a auditoria de autonomia existem. |
| B11 | Máquinas: este Mac; outro Mac ou Linux via SSH, com agentes e floors remotos, portas encaminhadas e reconexão; nuvem 24/7 | Novo | |

## 7. Celular

| Id | Feature | Estado | Lacuna |
|---|---|---|---|
| M1 | App de celular, primeiro como PWA instalável: aprovações, Conversa, canvas em leitura, terminais retomáveis e uso | Parcial | O cliente remoto (`/remote`) existe, mas é um convidado desktop por relay e não mostra gates nem atenção. |
| M2 | Pareamento por QR, vários computadores e notificação push com ação | Novo | |
| M3 | Escolher quais avisos chegam: aprovação, pergunta, bloqueio, conclusão | Parcial | |

## 8. Integrações de desenvolvimento

| Id | Feature | Estado | Lacuna |
|---|---|---|---|
| G1 | GitHub nativo: PRs, issues, CI, revisar e aprovar, abrir PR a partir do floor | Parcial | |
| G2 | Issues do Linear ligadas às tarefas | Parcial | |
| G3 | Mais CLIs de agentes por adapters (Gemini, Copilot, Amp, Goose, Cline, Qwen…) | Parcial | O registro de adapters existe. |
| G4 | Várias contas por provider, com uso por conta | Novo | |

## 9. Qualidade e desempenho (contínuo)

- Trocar polling por eventos onde ainda há polling: gates (5 s), status remoto (1 s), quadros.
- Guardar em cache o Markdown já renderizado.
- Manter o orçamento de quadros no Moedex.
- Regenerar as capturas de referência visual dos testes quando a mudança for intencional.

---

## Fases de entrega (na branch)

1. **Fundação e novo Canvas:** F1–F4, C1–C3, C8, C9 e o sino em todos os modos. Interface nova sobre os dados que já existem.
2. **Atenção completa e Conversa v1:** A1–A5, C4, E1–E4 e F5.
3. **Bots 24/7 locais:** B1–B3, B6, B8–B10, E5, E6 e E8.
4. **Canais externos e celular:** B4, B5, B7 e M1–M3.
5. **Foco completo e integrações:** D1–D6 e G1–G4.
6. **Máquinas, ensino e canvas avançado:** B11, E7, C5–C7 e C10–C13.

Cada fase termina com testes unitários e e2e, build, instalação local ad-hoc e capturas no workspace do Moedex.

## Decisões do dono

1. **Nuvem 24/7:** hospedar (onde, custo mensal, quem paga) ou começar só com máquina própria via SSH?
2. **WhatsApp:** API oficial do WhatsApp Business (conta Meta Business, número dedicado, custo por conversa) ou ponte pelo app desktop via Computer (sem custo, mas exige o Mac ligado)?
3. **Celular:** PWA primeiro e app nativo depois?
4. **Bots:** rodam com as assinaturas atuais pelas CLIs (Claude, Codex…), sem API paga por token?
5. **Fonte condensada:** adicionar uma fonte OFL como dependência?

---

## Status na branch (17/10/2026)

| Id | Status | O que existe agora |
|---|---|---|
| F1 | Feito | Barra superior única com Canvas, Foco e Conversa, busca ⌘K, sino e microfone, em macOS e Windows. |
| F2 | Parcial | Cor e iniciais estáveis por agente, iguais em todas as telas. Nome curto e avatar escolhidos pelo dono ainda não. |
| F3 | Feito | Store compartilhado de status ao vivo (estado, desde quando, tarefa, floor, modelo). |
| F4 | Feito | Archivo (OFL) condensada nos títulos e glifos de status padronizados. |
| F5 | Parcial | Gates, fluxos, ferramentas, lições, revisões e propostas viram itens de atenção com broadcast. Rotinas e integrações ainda não emitem eventos próprios. |
| A1 | Feito | Gates de autonomia, aprovações de fluxo, ferramentas em rascunho, lições pendentes, revisões, propostas de design e limite de uso. Sessão de dispositivo encerrada ainda não é detectada. |
| A2 | Feito | `orkestrai ask-owner` / `ask_owner` com opções; a resposta volta para a caixa de entrada do agente. |
| A3 | Feito | Decisão no lugar (sino, nó, Foco, Conversa, celular e convidado remoto) por um endpoint único. Reiniciar simulador não entrou. |
| A4 | Não feito | Integração de floor continua direta; política de aprovação não foi criada. |
| A5 | Feito | Cartão "desde a última visita" no Canvas (última visita por navegador). |
| C1 | Feito | Dock no topo com grupos, barra lateral flutuante com equipe e partituras, minimapa e zoom, cartão de resumo. |
| C2 | Parcial | Cabeçalho com status, avatar, provider e modelo. Rodapé com floor e assuntos não. |
| C3 | Feito | Barra do nó selecionado (Foco, Mensagem, Mais) e troca terminal/conversa no cabeçalho. |
| C4 | Feito | Faixa de atenção no nó com responder, resolver, adiar, aprovar e recusar. |
| C5 | Feito | Face de conversa do agente (mensagens da Conversa, sem ler a TUI). |
| C6 | Não feito | Vários assuntos retomáveis por agente. |
| C7 | Feito | Pilhas de notas por agente. |
| C8 | Feito | Conexões discretas, destacadas na seleção. |
| C9 | Feito | Zoom semântico com nome e status grandes; títulos de grupo condensados. |
| C10 | Não feito | Agrupamento automático por equipe ou floor além do "Organizar" existente. |
| C11 | Feito | Caneta (traço livre vira forma). Texto manuscrito não. |
| C12 | Feito | Partituras: salvar seleção e colocar em qualquer workspace. |
| C13 | Feito | Compositor flutuante com @ e envio pela caixa de entrada do agente. Imagem colada e rascunho por destino não. |
| D1 | Parcial | Foco renomeado, com Precisa de você na barra lateral. Reorganização completa da barra lateral não. |
| D2–D6 | Não feito | Sem mudanças além do que o Workbench já tinha. |
| E1 | Feito | Canal da equipe com posts, conversas entre agentes e tarefas concluídas. |
| E2 | Feito | Conversa direta com cada agente. |
| E3 | Feito | Cartões de pergunta com opções; aprovações no Precisa de você. |
| E4 | Feito | Perfil com estado, tarefa, memória, rotinas, sempre ligado e canais. |
| E5 | Não feito | "Esquecer de verdade" na memória. |
| E6 | Não feito | Lição vira skill. |
| E7 | Não feito | Ensinar mostrando. |
| E8 | Feito | Rotina descrita em linguagem natural (o agente cria com as próprias tools). Postagem automática do resultado no canal não. |
| B1–B2 | Parcial | O agente com modo "acorda quando chamado" ou "sempre rodando" no Core é o colega 24/7; perfil mostra e configura. Entidade "bot" separada do nó não. |
| B3 | Parcial | Gatilhos por mensagem (Conversa, Telegram, Slack) e rotinas existentes. |
| B4 | Parcial | Telegram e Slack com entrada e resposta. WhatsApp pelo Computer (já existente); e-mail e Discord não. |
| B5 | Parcial | Mesma conversa e memória em todos os canais; lista de quem pode falar por canal. |
| B6 | Feito | Aprovação remota no celular e por convidado remoto. |
| B7 | Não feito | Passar login/captcha ao dono e retomar. |
| B8 | Não feito | Bots em grupo dividindo tarefas no canal. |
| B9 | Parcial | Limite de uso por agente agora vira item de atenção. Orçamento diário/semanal não. |
| B10 | Parcial | Atividade recente no perfil. Auditoria completa por bot não. |
| B11 | Parcial | Máquinas SSH do ~/.ssh/config abrem shell ou CLI de agente remota. Floors remotos, ponte e nuvem não. |
| M1 | Feito | Página de celular instalável (Precisa de você, Conversa, Equipe) pela rede local. |
| M2 | Parcial | Pareamento por QR. Vários computadores e push não. |
| M3 | Não feito | Escolha de quais avisos chegam ao celular. |
| G1–G3 | Não feito | GitHub nativo, Linear e novas CLIs. |
| G4 | Já existia | Perfis de multi-conta na Central de Providers. |
