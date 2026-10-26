# Adventure — segunda revisão local, 26/10/2026

Fonte revisada: `feat/adventure`, `d8d6ba9a`, os dez commits posteriores ao relatório `53333e0c`. Pedido: revisar e instalar outra prévia local, sem publicar. A alteração preexistente em `AGENTS.md` foi preservada.

## Verificações

- Suíte completa executada nesta revisão: **2.664 testes passaram**, 13 pulados, zero falhas, dois workers.
- A fabricação de mão secundária agora usa `classSlot`, em acordo com a interface.
- O cliente coleta o combate separadamente do envio, mantém o ID e o corpo de um relato selado nos retries e divide os intervalos acumulados. A deduplicação agora guarda 32 IDs, cobrindo a chegada de outros relatos durante uma tentativa.
- A página do acampamento acompanha os parâmetros de navegação e descarta respostas de outro workspace. A ficha da faixa passou a medir sua altura e limitar o conteúdo à janela.
- O servidor anuncia as fases de preparação antes das operações síncronas; o desktop estende o prazo durante essas fases e detecta a saída do processo. A suíte cobre inclusive um processo filho real com event loop bloqueado.

## Novos achados

### [P2] Identidade autodeclarada contorna o escopo dos agentes na Adventure

Locais: `BridgeController.adventureAct`, `BridgeService.callerAgent` e `AdventureService.actAs`.

A rota valida o token compartilhado do workspace, mas a identidade vem apenas do campo `from` enviado pelo cliente. `callerAgent` procura esse nome/id e aceita seu indicador `maestro`; não confere o token da sessão viva, como outros endpoints da ponte fazem com `resolveBridgeAgent`. Assim, uma chamada de especialista pode declarar o líder e executar uma ação da guilda, ou declarar outro especialista e alterar seu herói. O problema fica restrito ao estado do jogo; não foi demonstrada elevação para operações do projeto ou do sistema.

O teste de escopo existente alterna `from` para simular líder/especialista, sem autenticar qual terminal fez a chamada. Ele prova a regra do serviço, mas também mostra a falta da vinculação de identidade na entrada HTTP. A reprodução HTTP isolada é registrada abaixo.

Correção esperada: derivar o chamador da sessão autenticada e checar a consistência de `from`; manter a verificação de posse das ações e a mutação sob o mesmo estado transacional. Incluir chamada sem identidade de terminal e tentativa de declarar líder/outro colega nos testes de contrato.

### [P2] O primeiro atraso longo ainda perde abates ao reenviar os lotes

Local: `domain/adventure/engine.ts`, `applyReport`, inicialização de `paidUntil`.

Enquanto `account.battleUntil` é nulo, o crédito começa em `now - REPORT_MAX_MS` (dez minutos), ignorando quando a conta/combate começou. Isso funciona para uma conta já inicializada com um relato pago, mas não se o servidor ficar indisponível antes do primeiro relato confirmado.

Reprodução com o motor real: conta criada às 12:00; seis relatos válidos, distintos, de cinco minutos, enviados às 12:30, cada um com 100 abates. Esperado: **600 abates**. Resultado: **330** (100, 100, 100, 10, 10, 10). Os relatos são confirmados e saem da fila, então os 270 abates perdidos não voltam; isso afeta contadores e desbloqueios de pets. Nesse cenário, o ouro baixo de teste foi pago por inteiro: não se deve afirmar que toda recompensa foi perdida.

Correção esperada: ancorar o primeiro intervalo no início real elegível, com limite de ausência e sem permitir reclamar tempo anterior à conta; cobrir uma indisponibilidade antes do primeiro envio bem-sucedido, além do caso após um relato inicial.

### [P2] “Ouvir” não inicializa o mixer com as configurações salvas

Locais: `src/routes/settings/+page.svelte`, `mixer`/`setMixer`, e `adventure-audio.ts`, `previewChannel`.

A tela deriva os controles do mixer salvo, mas só chama `configureSound` depois que algum controle muda. Em uma janela principal recém-aberta, o módulo de áudio continua com `DEFAULT_MIXER`; a faixa nativa tem outro renderer e sua configuração não inicializa o módulo da janela principal. Música, combate e habilidades salvos como ligados aparecem disponíveis na tela, porém podem ficar silenciosos ao clicar em Ouvir.

Reprodução com o módulo real e o mesmo AudioContext instrumentado dos testes: mixer salvo com combate ligado, primeira prévia antes de `configureSound` inicia **zero vozes**; depois de configurar o mesmo mixer, uma arma inicia vozes normalmente. A confirmação pela tela é registrada abaixo.

Correção esperada: aplicar o mixer carregado antes de disponibilizar a prévia, preservando a distinção entre rascunho e configuração salva. Testar abrir/reabrir Configurações com canais anteriormente ativados, sem tocar em um switch/slider antes de Ouvir.

### [P2] A splash ainda não existe quando chega “Preparando seus dados”

Local: `electron/main.cjs`, `showSplashPreparing`, `startServer` e sequência de `app.whenReady`/retry.

A extensão do prazo do Core foi implementada, mas a janela de splash continua sendo criada **depois** de `await ensureServer()`. Durante backup/migração, `showSplashPreparing` retorna imediatamente porque `splashWindow` é nula. O código também marca `toldSplash=true`, sem guardar/reapresentar o aviso quando houver janela. A abertura normal e a tentativa de recuperação têm essa ordem.

Consequência: o Core pode preparar os dados corretamente por mais de 30 segundos, mas o dono não vê o aviso prometido e pode entender que o app não abriu. Criar/mostrar o indicador antes da espera, respeitando o início em segundo plano, e testar a existência da janela durante a preparação. Os testes atuais cobrem o waiter e o texto, não o ciclo de vida da BrowserWindow.

### [P2] A música agenda todas as batidas perdidas de uma vez após atraso

Local: `adventure-audio.ts`, `schedule`.

O `while (state.nextTime < currentTime + lookahead)` não limita o atraso nem pula compassos passados. Se o scheduler do renderer fica atrasado em relação ao relógio de áudio, a próxima chamada cria os osciladores, fontes e filtros de todo esse intervalo, com horários já passados.

Reprodução usando o módulo real e o AudioContext instrumentado: iniciar a trilha de batalha, avançar o relógio de áudio dez minutos sem chamar o timer e executar uma chamada do scheduler. Foram criadas **10.710 vozes** nessa única chamada. A medição usa nós instrumentados, não demonstra consumo de CPU/memória equivalente no Electron real e não foi executado um teste de carga com milhares de fontes reais na máquina do dono.

Correção esperada: descartar batidas vencidas, reposicionar o próximo tempo e manter o agendamento limitado ao lookahead. Cobrir atrasos/retomadas com limite de vozes por callback. Afeta a música quando o canal está ligado; o padrão continua com música desligada.

## Teste no build e instalação

- **Build completo e postbuild passaram**, incluindo Computer host e mensagens do desktop.
- Teste exploratório sobre o build de produção, com dois workspaces de teste, banco e todos os diretórios de configuração isolados. Nenhuma CLI de provider foi executada. As sete abas do acampamento carregaram, com imagens, em 1024 × 768; heróis também foram conferidos em 1280 × 850. Temas claro e escuro.
- Navegação interna Alpha → Beta sem recarregar: o switch de tentar novamente enviou o POST para **Beta**, concordando com a URL. A sobreposição de equipamentos/atributos da revisão anterior não apareceu na nova composição.
- Faixa com o controlador/preload reais no Electron 42.11.18: a ficha permaneceu inteira nos tamanhos pequeno (**290 px** de altura), normal (**320 px**) e grande (**360 px**), inclusive com o indicador de trabalho. [Medições](assets/adventure-review-round2-2026-10-26/native-card-checks.json).
- Retry real no Electron, HTTP e SQLite: interromper a resposta **depois** de gravar um relato de dois abates/dois de ouro. As tentativas A e A tiveram corpo idêntico, o saldo permaneceu em **779** e os abates em **97**; o lote B seguinte mudou o saldo para **783** e os abates para **100**. [Captura dos três relatos](assets/adventure-review-round2-2026-10-26/native-retry.json). Só a presença dos agentes foi simulada para iniciar o combate, sem gastar tokens.
- Reprodução HTTP do escopo: mesmo Bearer do workspace, **sem token de terminal**, ação `settings` com `from=Alpha QA engineer` → **403**; trocando apenas `from` para `Alpha Technical leader` → **200**. [Resultado](assets/adventure-review-round2-2026-10-26/http-checks.json).
- Reprodução da prévia de som na tela: configurações salvas com Attacks ligado, primeira entrada em Configurações; instrumentar `start()` dos osciladores/fontes do AudioContext real. Primeiro Listen iniciou **zero** fontes; desligar/ligar Attacks e repetir iniciou **seis**. Não foi necessário salvar nem reabrir a página para demonstrar a diferença.
- [Resultados do motor e do scheduler instrumentado](assets/adventure-review-round2-2026-10-26/domain-repros.json). O scheduler foi testado com nós instrumentados; não foi criado um pico artificial de dez mil fontes de áudio na máquina do dono.

### Evidência visual

- [Heróis, tema escuro, 1280 px](assets/adventure-review-round2-2026-10-26/heroes-dark.png).
- [Heróis, tema claro, 1024 px](assets/adventure-review-round2-2026-10-26/heroes-light-1024.png).
- [Mapa ilustrado, tema escuro](assets/adventure-review-round2-2026-10-26/map-dark-1024.png).
- [Cubo, tema claro](assets/adventure-review-round2-2026-10-26/cube-light-1024.png).
- [Ficha inteira na faixa nativa](assets/adventure-review-round2-2026-10-26/strip-card-normal.png).

A direção visual ficou mais coesa: ilustração de acampamento, pedestal, mapa e ornamentos combinam com os sprites. A versão de 1024 px empilha equipamento e atributos, eliminando a colisão anterior. As capturas mostram dados fictícios, sem conversas do dono.

### Limites da verificação

Esta é uma prévia local, **não aprovação de merge/release**: os cinco P2 acima continuam no código revisado. Não foram executados testes de 24 horas, suspensão real prolongada com áudio, Retina, múltiplos monitores, Windows/Linux nem a matriz completa de idiomas nesta rodada. A revisão anterior já havia testado os três idiomas; nesta rodada, os testes isolados usaram inglês e o smoke test instalado usou português. Os testes nativos isolados não concedem nem demonstram permissões do macOS.

### Instalação e espaço

- **Prévia 0.45.0 de `d8d6ba9a` instalada e aberta** em `/Applications/Orkestrai.app`. Sem push, merge, tag ou release. O relatório é um commit posterior, apenas documental.
- Pacote arm64 criado com `bash scripts/package-macos.sh --arm64 --dir`, assinatura ad-hoc e variáveis de certificado removidas. `codesign --verify --deep --strict` passou no candidato e no app instalado. O verificador confirmou entitlements de microfone/automação no app e em quatro helpers. Isso não equivale a QA com Developer ID/Hardened Runtime.
- Cópia/validação/substituição/health check/arquivo de recuperação concluídos pelo instalador local, com **exit 0**. Código `main.cjs`, controlador da Adventure e versão do build conferidos contra a fonte empacotada. Só um rollback ZIP verificado foi mantido, fora de `/Applications`; nenhum staging `.app` ficou para trás.
- Novo Core iniciado do executável instalado; API saudável, **mesmos 19 IDs de workspace**, idioma **pt-BR** e `adventureStrip=true`. Sem reset de banco ou edição manual de migrations.
- O preparo do banco grande completou sem o timeout antigo de 30 s. O monitor CDP observou o endpoint aberto, mas **nenhuma página por 72,52 s**; splash e janela só surgiram depois. Isso confirma o problema visual descrito acima. O stdout das fases não era persistido no log principal; essa medição não é uma duração exata do backup.
- Botão da faixa abriu o acampamento na janela principal pelo IPC real. Conferidos título em português, sete abas, zero imagens quebradas e ausência de overflow horizontal. A captura do workspace real foi mantida somente no temporário local; as evidências versionadas usam fixtures.
- Limpeza após o handoff: **1,99 GiB** de caches npm/Electron/node-gyp, caches HTTP/código/gráficos com o app fechado, saída intermediária do Svelte, dados dos testes isolados e `release/mac-arm64`. O instalador também retirou o bundle e o ZIP de recuperação anteriores. **Aproximadamente 15 GiB livres ao concluir**; o espaço disponível também varia com os demais processos do computador.
- Preservados banco, backup de banco mais recente, rollback mais recente, modelos de voz, browser usado pelos testes, projetos e `.orkestrai/adventure/raw`. O `build/` testado continua disponível.

## Resolução — 26/10/2026

| Achado | Commit | Correção | Cobertura |
| --- | --- | --- | --- |
| Identidade autodeclarada nas ações | `16a83558` | O chamador vem do token da sessão viva (`x-orkestrai-agent-token`). Chamada sem token é recusada, e um `from` diferente do terminal também (403 `agent-identity`). A checagem de escopo roda dentro da mesma transação da ação. | Teste de contrato com sessões PTY reais: sem token, especialista declarando o líder, próprio herói, herói alheio, ação da guilda e líder autenticado. |
| Abates perdidos antes do primeiro envio | `0ab73b7b` | O primeiro crédito parte do início da Aventura (`questsSince`), limitado à ausência máxima e nunca posterior a agora. | O cenário do relatório (conta às 12:00, seis relatos de 100 abates às 12:30) agora soma 600; o tempo que não passou continua cortado. |
| "Ouvir" com o mixer padrão | `babe1222` | `previewChannel` recebe e aplica o mixer da tela (salvo ou em edição) antes de tocar, e a prévia ignora o espaçamento entre repetições. | Janela com o padrão antigo prevendo um mixer salvo com ataques ligados: inicia vozes. |
| Splash ausente durante a preparação | `e78f39f6` | Lançamento interativo (e a recuperação manual) cria a splash antes de esperar o servidor. O estado de preparação é guardado e aplicado quando a splash termina de carregar. Lançamentos em segundo plano e no login seguem sem janela. | Regra do lançamento interativo, ordem no `main.cjs` e aviso adiado. |
| Música acumulando batidas | `babe1222` | O agendador pula as batidas vencidas e retoma no tempo certo. | Relógio de áudio dez minutos à frente: uma chamada agenda só algumas notas. |
