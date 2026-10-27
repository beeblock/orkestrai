# Revisão da Adventure — 26/10/2026

Escopo: branch local `feat/adventure`, originalmente em `3943430b` (oito commits sobre a main). Revisão de domínio, persistência, HTTP, renderer, janela Electron, documentação, testes e assets. O pedido é instalar uma **prévia local**, sem merge, push ou release.

## Bloqueio corrigido para viabilizar o teste

**[P1, corrigido] O build de produção não compilava.** `src/routes/adventure/+page.svelte` importava `uuidv7` de `@beeblock/svelar/support`. Esse módulo depende de `crypto.randomBytes` e `Buffer` do Node. Rollup abortou a compilação do navegador com `"randomBytes" is not exported by "__vite-browser-external"`. Compilar o componente isoladamente e rodar os testes de domínio não detectam esse problema.

Correção mínima: o identificador de um relato de batalha passa a usar `crypto.randomUUID()` do navegador, como outros identificadores de requisições do app. Os IDs persistentes das entidades continuam sendo UUID v7 no servidor. Changelog raiz e os três catálogos foram atualizados juntos.

## Achados confirmados que precisam de correção antes do merge

### [P2] Reenvio após perda da resposta duplica recompensas

Local: `src/routes/adventure/+page.svelte`, funções `merge`/`report`; `domain/adventure/engine.ts`, `applyReport`.

O cliente mantém o lote quando a requisição falha, mas gera outro `reportId` a cada tentativa e ainda mistura o próximo intervalo no mesmo lote. Se o servidor já gravou e apenas a resposta se perdeu, a tentativa seguinte paga o mesmo ouro/XP/abates/baús novamente. O servidor só compara o ID com `lastReportId`.

Reprodução executada com as funções originais `merge`/`report` extraídas do componente e o motor real: produzir 5 de ouro, aplicar no servidor e simular erro de rede após a gravação, reenviar sem produzir nada novo. As duas requisições levam IDs distintos; o saldo termina em **10**, em vez de 5.

Correção esperada: um lote imutável com identidade estável durante os retries; acumular o intervalo seguinte separadamente. A idempotência do servidor também precisa resistir à chegada de outro lote entre duas tentativas do anterior. Cobrir a perda da resposta depois do commit, não só repetir manualmente o mesmo ID na API.

### [P2] Uma interrupção longa deixa a fila do progresso permanentemente inválida

Local: `src/routes/adventure/+page.svelte`, `merge`/`report`; `contracts/schemas/adventure.schema.ts`, `adventureReportSchema`.

A fila cresce sem dividir os relatos. O servidor aceita no máximo uma hora, 200 baús, 20 chefes e 50 resultados de fases por requisição. Ao ultrapassar qualquer limite durante uma indisponibilidade, cada retry recebe 400, conserva o lote e acrescenta mais dados. O jogo não consegue voltar a sincronizar por conta própria; reiniciar descarta a fila em memória.

Reprodução com a função original e o schema real: lote com `elapsedMs=3600001` é recusado; a tentativa seguinte leva `3605001` e também é recusada. Os limites das listas podem disparar antes do limite de tempo.

Correção esperada: dividir o progresso em lotes válidos e recuperáveis, com identidade por lote, e distinguir recusa permanente de falha transitória. Não resolver descartando silenciosamente as recompensas.

### [P2] Fabricar mão secundária ignora a classe escolhida

Local: `src/lib/modules/agent-room/domain/adventure/cube.ts`, `craft`; `CampCube.svelte`, `craftNow`.

A tela permite escolher classe para arma **e mão secundária**, mas `craft` só repassa `classId` quando `slot === 'weapon'`. Para `offhand`, `rollItem` sorteia a classe da guilda. O usuário pode gastar ouro e gemas e receber equipamento da classe errada.

Reprodução real: `craft(() => 0.42, {slot:'offhand', level:1, classId:'sorceress', cubeLevel:2, magicFind:0, difficulty:'normal', partyClasses:['knight']})` devolve um item de **knight**. Deve respeitar a classe também nos demais slots específicos de classe, usando a mesma regra compartilhada pela UI.

### [P2] O acampamento continua lendo e alterando o workspace anterior após navegação interna

Local: `src/routes/adventure/camp/+page.svelte:36` (também linhas 40–41 e 59–65).

`workspaceId`, `tab` e `selectedHero` são inicializados a partir da URL somente na montagem. O SvelteKit reaproveita o componente ao navegar para a mesma rota com outros parâmetros. O acampamento aberto pelo herói de outro workspace, ou de outro herói, mantém o estado anterior.

Reprodução no build de produção: abrir Alpha na aba Mapa; clicar em um link interno para `/adventure/camp?workspace=<Beta>&tab=heroes&hero=<herói Beta>`. A URL vira Beta, mas o Mapa e os seis heróis de Alpha continuam visíveis. Ao clicar em “Retry a lost stage”, o POST foi para **`/workspaces/<Alpha>/adventure/actions`**, com `autoRetry:true`, apesar da URL apontar para Beta. Após recarregar a página inteira, Beta aparece corretamente.

Correção esperada: acompanhar os parâmetros de navegação, limpar o estado anterior ao trocar de workspace e descartar respostas de requisições da geração anterior. Testar navegação dentro do app, não somente abrir cada URL em uma página nova.

### [P2] A ficha do herói fica cortada pela janela nativa

Local: `src/routes/adventure/+page.svelte:376`, posicionamento da `.card`, e `ROOM_ABOVE=170`; `electron/adventure-window.cjs`, altura da faixa.

A ficha é posicionada acima do herói sem considerar seu tamanho contra o limite superior da janela transparente. Na janela nativa padrão de **3440 × 320**, a ficha do líder trabalhando, em português, mediu `top=-48.875`, `height=277.875`, `bottom=229`: o nome e a classe ficam fora da janela. Mesmo o líder desconectado em inglês chegou a `top=-3.78125`. Adicionar mais texto/avisos aumenta o corte.

Correção esperada: medir e limitar o popover ao viewport nativo, com espaço/scroll adequado, ou ajustar a altura da janela antes de abrir a ficha; testar os três tamanhos, textos longos, idiomas e estados de atenção/trabalho. `overflow:visible` dentro da página não ultrapassa o limite da BrowserWindow.

Evidência: [ficha cortada no Electron](assets/adventure-review-2026-10-26/strip-card-active-native.png).

### [P2] Equipamentos se sobrepõem aos atributos em uma janela de 1024 px

Local: `src/lib/components/agent-room/adventure/camp/CampHeroes.svelte:341` e a grade de equipamentos.

O breakpoint de 1180 px transforma `.top` em `150px 1fr`. A grade de equipamentos ocupa quatro colunas de 56 px mais espaçamentos e vai para a coluna de 150 px, transbordando sobre os atributos da coluna ao lado. Reproduzido em **1024 × 768**, tema claro, português: ícones e nomes cobrem “Dano por golpe”, “Vida”, “Redução de dano” e outras linhas. Não é apenas overflow horizontal da página: `scrollWidth` continua em 1024 e o usuário não consegue separar os elementos rolando.

Correção esperada: dar aos equipamentos uma coluna com largura suficiente ou reorganizar as áreas/colunas no breakpoint. Validar a largura mínima da janela do app e zoom de texto.

Evidência: [equipamentos sobre os atributos](assets/adventure-review-2026-10-26/camp-heroes-light-1024.png).

### [P2] Cores das raridades tornam o texto ilegível no tema claro

Local: `src/lib/components/agent-room/adventure/camp/CampLog.svelte:20`; a mesma paleta também colore nomes em `ItemDetails.svelte`.

As cores fixas usadas nos efeitos e nas bordas dos itens também viram cor do texto, sem adaptação ao tema. No Registro, texto de 12,5 px teve contraste aproximado de **1,35:1** para Comum na linha alternada, **1,74:1** para Incomum e **1,91:1** para Lendário no fundo claro. O mínimo para esse texto é [4,5:1 segundo WCAG 2.2, SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). As linhas de itens comuns parecem desabilitadas e quase desaparecem.

Correção esperada: separar cores decorativas da raridade de cores de texto por tema, preservando a identificação por nome/ícone. Verificar também o tooltip de equipamento, conjuntos e registro de Paragon.

Evidência: [Registro no tema claro](assets/adventure-review-2026-10-26/camp-light-pt.png). Critérios de revisão de UI: [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

## Paridade das ferramentas dos agentes

A branch expõe estado e ações pela UI e por rotas HTTP internas. Não adiciona operações de Adventure ao contrato da ponte, CLI ou MCP. Isso fica pendente do requisito de paridade do `AGENTS.md`: operações aplicáveis aos agentes devem compartilhar validação, escopo, documentação e testes de contrato. Instalar uma prévia local não representa aprovação desse requisito para publicação.

## Verificação automatizada

- Branch original: **2.633 testes passaram**, 13 pulados, zero falhas (325 arquivos passaram; três pulados). Dois workers e timeout de 20 s.
- Testes focados da Adventure: **105 passaram**.
- Os 18 componentes Svelte alterados compilam individualmente.
- Após a correção do import: **34 testes passaram** nos catálogos de Adventure, docs e tours.
- O primeiro build completo reproduziu o bloqueio P1 descrito acima.

- Após a correção, **build completo e postbuild passaram**, incluindo Computer host e mensagens do desktop.
- Teste exploratório no build de produção: sete abas do acampamento, navegação interna entre dois workspaces, inglês/português/espanhol, temas claro/escuro, larguras de 1280 e 1024 px. Sem erro JavaScript no navegador nessas telas.
- Teste nativo: Electron 42.11.18, controlador e preload reais da branch em harness isolado; faixa transparente em 3440 × 320 e 760 × 320, heróis ociosos e trabalhando, animação, ficha e botão do acampamento. O status de trabalho foi simulado apenas na resposta de presença para não executar CLIs ou gastar tokens; combate, renderer, serviço e SQLite eram reais.
- A perda da resposta também foi reproduzida **no Electron com HTTP e SQLite reais**: primeiro lote de 3 de ouro foi gravado, a resposta foi interrompida e o próximo lote levou 7 (incluindo os 3 anteriores). O saldo esperado era 781 e terminou em **784**. IDs distintos nas duas tentativas.
- A suspeita inicial de enviar o relato para o workspace errado ao trocar a faixa **não foi reproduzida**; o achado de workspace acima é específico da navegação do acampamento.

## Visual e desempenho observados

A direção visual funciona bem no tema escuro: sprites, equipamentos, painel de heróis e abas usam uma linguagem coerente com o app. A largura compacta nativa funcionou e não apresentou overflow horizontal. As três falhas visuais acima impedem aprovar a apresentação em todos os tamanhos/temas.

Capturas adicionais: [heróis no tema escuro](assets/adventure-review-2026-10-26/camp-heroes.png) e [faixa compacta](assets/adventure-review-2026-10-26/strip-compact-native.png).

Amostras de `ps`, uma por segundo durante oito segundos por cenário, somente nos processos do Electron isolado, em um monitor de escala 1:

| Cenário (faixa de 3440 × 320) | Renderer | Processo gráfico | Main |
| --- | --- | --- | --- |
| Batalha ativa | mediana 6,1%; 5,3–9,0% | mediana 9,2%; 7,7–10,1% | 0% |
| Acampamento ocioso | mediana 6,0%; 4,7–6,5% | mediana 8,05%; 6,3–9,3% | 0% |

A animação continua consumindo CPU quando o time acampa. Há rAF contínuo na faixa e em cada `SpriteView`, e a BrowserWindow desativa `backgroundThrottling`. Essas amostras não demonstram vazamento nem estabilidade por 24 horas; ainda faltam teste prolongado, monitor Retina/alta taxa de atualização, Windows/Linux e verificação manual de arraste entre monitores. O harness não substitui o teste integral de todos os IPCs do app empacotado.

## [P1] Primeiro boot pode falhar ao preparar um banco grande (problema adicional de integração)

Local: `electron/main.cjs:722` e `electron/startup-recovery.cjs:2` (limite de 30 segundos), em conjunto com `scripts/run-startup-migrations.mjs`.

O pacote local trouxe um caso real que o banco pequeno dos testes não cobre: com o banco existente de aproximadamente 2,3 GiB, o Core foi encerrado antes de completar o backup e as migrações. O log registrou `The internal server did not respond .../core/health` exatamente 30 segundos depois da abertura. A janela principal nem chegou a existir; apareceu a recuperação nativa. O prazo já existe na main, mas a adição das três tabelas faz esta branch precisar novamente dessa preparação.

Para concluir **esta instalação local**, fechei o app sem Core ativo e executei o mesmo helper de migrações/backup do pacote, com os serviços de segundo plano retidos e sem abrir porta HTTP. Ele concluiu em **55,221 segundos**, aplicou somente as três migrações da Adventure e retornou `quick_check: ok`. Não houve reset, edição manual do schema ou descarte do banco. O boot normal seguinte passou.

Isso é uma preparação pontual desta máquina, **não uma correção de código para os demais usuários**. Antes de publicar a branch, o boot precisa distinguir preparação em andamento de um Core que morreu/travou, conceder tempo compatível com backup/migração e não interromper uma operação saudável só por demorar mais de 30 segundos. Cobrir a integração com uma preparação lenta; aumentar apenas o timeout da verificação local não basta, porque o desktop também encerra o Core.

## Instalação local

- Fonte instalada: `feat/adventure`, commit `65a02341` (original `3943430b` mais a correção mínima do build). A versão no `package.json` continua **0.45.0**; trata-se de uma prévia da branch, não de um novo release público.
- Pacote macOS **arm64**, assinatura **ad-hoc**, sem Developer ID, uso de chave do Keychain para assinatura, notarização, push ou release. Gerado pelo wrapper oficial em modo `--dir`, evitando DMG/ZIP extras.
- Cópia feita pelo instalador local com staging e verificação de assinatura/entitlements antes da substituição. O primeiro health check falhou pelo P1 acima e reteve a cópia anterior; a preparação e as verificações foram concluídas antes de finalizar o rollback compacto.
- Core instalado respondeu na API com versão 0.45.0 e executável dentro de `/Applications/Orkestrai.app`.
- Os **19 workspaces**, seus IDs e o idioma **pt-BR** foram conferidos antes/depois e permaneceram iguais.
- No app instalado, ativei “Aventura acima do Dock” pelo menu Mais. A janela nativa apareceu e desenhou os heróis do workspace real. Clicar em “Abrir o acampamento” navegou a janela principal para `/adventure/camp` e carregou os quatro heróis desse workspace, sem erro de inicialização.
- A cópia original 0.44.1 foi compactada, o ZIP foi testado e ficou como único rollback fora de Applications. Intermediários do pacote, saída temporária do Vite e runtimes isolados dos testes foram removidos; ficaram aproximadamente **17 GiB livres** ao finalizar.

A instalação é uma prévia para avaliação, com os achados acima ainda presentes; não é aprovação para merge ou release.

## Resolução dos achados — 26/10/2026

Todos os achados acima foram corrigidos em commits separados na `feat/adventure`, cada um com testes e com changelog, docs e catálogos atualizados nos três idiomas.

| Achado | Commit | Como foi resolvido | Cobertura |
| --- | --- | --- | --- |
| [P2] Reenvio duplica recompensas | `99ce278d` | Relatos selados com id estável, reenviados sem mudança; o próximo intervalo fica num relato separado. O servidor guarda os últimos 32 ids, então funciona mesmo com outro relato chegando entre duas tentativas. | `adventure-outbox.test.ts` e um teste de serviço que grava, perde a resposta e reenvia com outro relato no meio. |
| [P2] Fila inválida após interrupção longa | `99ce278d` | Os relatos são divididos dentro dos limites que o servidor aceita e paga por inteiro. Um relógio de batalha paga em sequência os relatos de uma ausência, sem passar do tempo real. O controller responde 4xx para recusa e 500 para falha transitória, e a faixa só tenta de novo nos 500. Depois de 8 h sem servidor o grupo acampa. | Divisão de mais de 1 h de batalha; seis relatos de 5 min após 30 min de ausência pagos por inteiro; recusa final contra falha transitória. |
| [P2] Mão secundária com a classe errada | `e910179c` | `craft` usa `classSlot` para todo espaço de classe, a mesma regra da tela. | Arma e mão secundária para três classes que a guilda não tem. |
| [P2] Acampamento preso ao workspace anterior | `91441d01` | O acampamento acompanha os parâmetros de cada navegação, limpa o progresso anterior e ignora respostas do workspace que deixou. Também ganhou um botão Voltar. | Playwright no servidor de desenvolvimento: navegação interna Alpha → Beta com o POST indo para Beta, e o Voltar retornando à conversa. |
| [P2] Ficha cortada na janela nativa | `91441d01` | A ficha é medida e posicionada acima do herói quando cabe; senão fica ao lado, encostada no topo, com rolagem se for maior que a janela. | Playwright em 1600 × 290, 320 e 360 px (tamanhos pequeno, normal e grande): ficha dentro da janela. |
| [P2] Equipamentos sobre os atributos em 1024 px | `91441d01` (e a ficha nova em `681f1b1e`) | Container queries com área própria para o armory. | 1024 × 768 no tema claro: sobreposição zero e `scrollWidth` 1024. |
| [P2] Raridades ilegíveis no tema claro | `91441d01` | Tokens de texto por tema (`--adventure-ink-*`, no mínimo 4,5:1 em todas as superfícies). Bordas e brilhos seguem com as cores decorativas. | Contraste calculado para as 9 raridades, únicos, conjuntos, Paragon e chefes. |
| [P1] Primeiro boot com banco grande | `c037dc63` | O servidor anuncia cada etapa lenta (backup, migração, compactação) antes de começar. O desktop espera enquanto houver preparação (até 30 min) e depois dá os 30 s normais. A tela inicial avisa que está preparando os dados. | Relógio falso, processo filho real que bloqueia o event loop por 1,8 s, e a fixture empacotada confere as etapas anunciadas. |
| Paridade com a ponte dos agentes | `e24ebc87` | `orkestrai adventure` e as ferramentas MCP `adventure_read`/`adventure_act` usam o mesmo schema das ações. Especialistas mexem só no próprio herói; o líder, na guilda inteira. | Testes de contrato da CLI, do mapeamento MCP e dos escopos da ponte com banco real. |

Pedidos do dono feitos na mesma rodada:

- `cf382cf7`: baús abrem sozinhos, cada herói veste sozinho as melhorias claras e as sobras viram ouro.
- `f6f06cd0`: artes empacotadas, com cache permanente e sem blocos provisórios enquanto carregam.
- `681f1b1e`: acampamento redesenhado como tela de RPG e equilíbrio das classes da guilda.
- `c3c584e0`: mesa de som por canal, com som próprio para cada arma e habilidade e trilha composta.
