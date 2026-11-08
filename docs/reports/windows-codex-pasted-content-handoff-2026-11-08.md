# Repasse ao Claude Code: Windows / Codex / Pasted Content

Data: 8 de novembro de 2026. A investigação original continua inconclusiva.

## Restrição atual do dono

**NÃO fazer release, criar tag, iniciar Release Desktop ou instalar localmente.**
O dono quer que o Claude Code investigue antes de decidir a publicação.
Não interromper os agentes do app instalado para testar. Pouco espaço em disco.

## Onde trabalhar e qual código está em cada lugar

O clone usado pelo Codex é um repositório Git separado:

```text
/private/tmp/orkestrai-release-20261108/pantheon
branch de repasse: fix/terminal-delivery-review-20261108
origin: https://github.com/beeblock/orkestrai.git
```

Essa branch parte da `main` em `dae90d3586c34ea27c59b82d56f09a062c824ded`.
Ela acrescenta este repasse e uma correção do teste de recuperação, que passa
a aguardar a identidade e o READY do novo processo, em vez da tela do processo morto.
Para conferir antes de editar:

```bash
cd /private/tmp/orkestrai-release-20261108/pantheon
git status --short --branch
git log -5 --oneline
git remote -v
```

O checkout habitual do dono **não foi atualizado nem trocado de branch**:

```text
/Users/rzeradev/projects/beeblock/pantheon
branch: feat/subscription-lending
modificado: AGENTS.md
não rastreados, anteriores a esta rodada:
  docs/reports/orca-orchestration-comparison-2026-11-02.md
  docs/reports/superapp-throughput-audit-2026-11-02.md
```

Não fazer reset, clean, checkout da main ou sobrescrever esses arquivos.
Usar o clone de repasse ou um worktree novo da branch de repasse. O prefixo
`orkestrai-release` no caminho é apenas o nome antigo do diretório; não há
autorização vigente para publicar.

Commits relevantes:

| Commit | Estado / conteúdo |
| --- | --- |
| `e858de939586b3d619b81a536f74ab7dc4bc3941` | Base publicada como v0.52.7; contém a proteção de entrada que agravou o caso relatado. |
| `47fabc69cdb12f59a9d547e94b7371aadc209732` | Correções de protocolo, Enter manual, PTY ausente e confirmação após desaparecimento da PTY. Já enviado e integrado na main. |
| `dae90d3586c34ea27c59b82d56f09a062c824ded` | Preparação da 0.52.8, apenas versão/docs/resultados. Já enviado à main. Não é uma release publicada. |

A branch `fix/terminal-delivery-recovery-20261108` deste clone chega ao `dae90d35`,
mas a versão remota dessa branch foi enviada apenas até `47fabc69`. Para continuar
a investigação, preferir `fix/terminal-delivery-review-20261108`, não aquela ref antiga.

## Relato real, ainda sem causa original comprovada

- Windows **nativo**, Codex CLI **0.167.0**, informação fornecida pelo dono.
- Workspace pesado, com mais de 300 imagens geradas; workspaces novos/leves
  funcionavam. Há relatos de degradação após cerca de uma hora aberto.
- Líder envia aos especialistas e especialistas ao líder: aparece `[Pasted Content]`,
  a mensagem não é confirmada e os agentes ficam parados, com fila acumulada.
- Antes, Enter manual às vezes fazia começar. Depois da proteção nova, apareceu
  `Terminal delivery in progress. Your typing is kept separate. Press Ctrl+C to
  interrupt and take control.` mesmo sem o dono digitar, e Enter deixou de funcionar.
- Ctrl+C pode limpar a mensagem colada ou encerrar a CLI. O dono também recebeu
  `Sessão PTY não encontrada`. A saída visual do texto não prova exclusão no SQLite.
- Não tive acesso ao Windows real nem capturei um log atual desse incidente.
  Não atribuir os logs antigos Downloads/orkestrai (5)–(9).log a esta reprodução.
- O banner é compatível com a base 0.52.7. A versão efetivamente instalada no
  Windows não foi conferida independentemente nesta rodada.

**Não foi demonstrado que o problema original de Pasted Content foi eliminado.**
Os testes abaixo comprovam cenários específicos, não o funcionamento desse workspace.

## O que foi reproduzido e alterado

1. Quatro testes novos falham com a lógica de 0.52.7: mouse SGR (pressionar,
   soltar, roda) e resposta de cursor duplicada viram falsa digitação retida.
   Com qualquer entrada retida antes do CR, o caminho que libera Enter sozinho falha.
2. `onKey` e `onData` do xterm agora preservam a origem da entrada. Uma allowlist
   estrita reconhece relatórios completos, inclusive respostas tardias/duplicadas.
   Texto/colagem não são liberados só porque o cliente declara `source: terminal`.
   F3 modificado, que pode ter os mesmos bytes de uma resposta do cursor, continua tecla.
3. Enter manual que ajuda uma mensagem automática não altera mais a revisão de
   edição humana. Se esse Enter também se perde, a recuperação ainda pode agir.
   Os Enters extras entram na tolerância de tamanho da colagem, sem redigitar seu corpo.
4. Erros de input/resize de PTY inexistente agora levam código estável e sessionId.
   A UI também recupera terminais recém-criados, que não tinham `onRespawn`.
   Erro de sessão antiga não pode recuperar a nova; teclas antigas não são redirecionadas.
5. `checkConfirmation` consulta o histórico salvo mesmo se a PTY sumiu, antes de
   reenfileirar o original. Testes SQLite cobrem os dois sentidos e um recibo já gravado.
6. O aviso deixou de recomendar Ctrl+C como recuperação genérica. Ctrl+C continua
   sendo um interrupt: não foi transformado em recuperação sem perda da CLI.

## Arquivos centrais

```text
src/lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts
src/lib/modules/agent-room/infrastructure/pty/pty-ws.ts
src/lib/modules/agent-room/domain/terminal-input.ts
src/lib/modules/agent-room/application/services/AgentTerminalDeliveryService.ts
src/lib/modules/agent-room/application/services/AgentInboxService.ts
src/lib/modules/agent-room/infrastructure/transcript/AgentTranscript.ts
src/lib/components/agent-room/TerminalNode.svelte
src/lib/components/agent-room/terminal-input-buffer.ts
src/lib/components/agent-room/canvas/TerminalCanvasNode.svelte
```

No primeiro arquivo, olhar `writeHumanInput`, `holdsHumanInput`,
`flushDeferredHumanInput`, `startDelivery`, `retryPendingAutomaticPaste` e
`releaseDeliveryBarrierWhenReady`. No serviço de entrega, olhar
`preparePromptConfirmation`; na inbox, `deliverBatch`, `checkConfirmation` e
`restorePending`. Relatório anterior: `docs/reports/terminal-delivery-regression-2026-11-08.md`.

## O que ainda merece investigação; não são causas reais confirmadas

- Qual guarda impede recuperar o Enter no Windows afetado: limite de duas
  tentativas, revisão humana alterada, estado nativo working desatualizado,
  timestamp de turno, ou `hasPendingAutomaticPaste` retornando false?
- A prova do composer usa regex sobre saída ANSI recente. Redesenhos ainda podem
  não ser reconhecidos. Mais delays/regex sem uma captura real não provam solução.
- `submission.unverified` é lembrado após um turno sem recibo exato; verificar
  se o throw antecipado impede recuperação posterior de uma colagem ainda presente.
- `checkConfirmation` preserva sent indefinidamente com PTY viva e sem recibo.
  Se Ctrl+C só limpar o composer e não matar a PTY, o teste de substituição da PTY
  **não** cobre essa situação. O conteúdo fica salvo, mas pode continuar sem avançar.
- Verificar conversa/root de armazenamento exatos e como um preferredSessionId
  antigo pode impedir encontrar o recibo. A ausência do recibo não é prova de não envio.
- Não desbloquear tudo com timeout, outro turno concluído ou replay cego: isso
  pode misturar texto do dono ou executar uma entrega duas vezes.
- Os testes curtos novos não cobrem o envelhecimento real da UI com centenas de
  imagens. O soak opcional de 65 minutos **não foi executado nesta rodada**.

## Evidências e limites dos testes

- Rodada local combinada: **196 passaram**, incluindo inbox SQLite, ownership,
  transporte, import de pacote, docs e Codex real 0.167 com Chromium.
- CI nativo Windows passou Codex **0.166.0 e 0.167.0**: 126 testes de guardas por
  versão, quatro casos com CLI real e um caso extra de navegador.
- No navegador por versão: 6 recibos automáticos exatos; 3 Enter perdidos de
  propósito recuperados; 2 respostas de cursor e 2 eventos de mouse; uma tecla física;
  uma resposta separada do dono; nenhum conteúdo misturado.
- Os modelos de teste são respostas de um endpoint loopback controlado. Não usam
  contas/tokens do dono. Há ferramentas e transcripts reais, mas não o serviço real do provedor.
- A fixture Chromium tem dois xterms reais e usa o binding de entrada de produção;
  não é o Canvas inteiro com 300 imagens. As consultas de cursor/modos de mouse são
  induzidas na fixture. Não tratar isso como reprodução do workspace problemático.
- CI de `47fabc69`: 3257 testes da suíte geral passaram, mais 3 de OCR separados;
  build completo e os quatro shards de navegador passaram. O CI inicial concluiu
  com sucesso; a publicação de bundle foi pulada porque não era push na main.
- Build local limitado a 4 GiB abortou por heap. Não é build local bem-sucedido.
  Usei o build de CI com proveniência verificada, não gerei instalador local.
- A recuperação no app completo falhou inicialmente: o teste aceitava id nulo e o
  READY da tela morta como prontidão. A versão do teste nesta branch exige id novo,
  saída marcada com PID novo e só então digita. Passou isolada e **2/2 repetições**.
  Não houve alteração adicional no app para fazê-la passar.

CI inicial, código `47fabc69`:
https://github.com/beeblock/orkestrai/actions/runs/42506235665

CI da main preparada `dae90d35`:
https://github.com/beeblock/orkestrai/actions/runs/42507186202

Ambos são **CI**, não Release Desktop, e **ambos concluíram com sucesso**.
O segundo valida a main `dae90d35`, incluindo build, Windows e todos os shards
de navegador. O fortalecimento do teste de identidade nesta branch foi validado
localmente, sem alterar o código do app. Nenhum desses resultados reproduz o
workspace pesado do dono depois de uma hora; não confirma a causa original.

## Logs e build disponíveis neste Mac

```text
/private/tmp/orkestrai-delivery-recovery-qa-20261108.noindex/
  reproduction-before.log
  combined-final.log
  windows-0166.log
  windows-0167.log
  candidate-test-build.log
  production-browser.log                 # falha inicial do teste de recuperação
  production-recovery-exact-session.log   # 1 passou com id/READY exatos
  production-recovery-repeat.log          # 2/2 passaram
  build.log                              # OOM do build local com limite de 4 GiB
  candidate-lock-47f.json
```

O build usado nos testes locais veio do CI de **47fabc69**, com versão de pacote
**0.52.7**, anterior apenas à preparação de versão/docs. Sua proveniência foi
verificada com SHA, versão e lockfile daquele commit, incluindo 3124 arquivos.
**Esse build foi removido para liberar espaço**; o manifesto foi preservado em
`candidate-provenance-47f.json` ao lado dos logs. Não há build local pronto.

Se for necessário testar o código da main preparada, o CI já disponibiliza um
artefato com identidade correta para `dae90d35` / 0.52.8. Só baixar se necessário:

```bash
gh run download 42507186202 --repo beeblock/orkestrai \
  --name browser-candidate-dae90d3586c34ea27c59b82d56f09a062c824ded --dir build
node scripts/production-bundle.mjs verify build dae90d3586c34ea27c59b82d56f09a062c824ded
```

Isso baixa um build de teste, não um instalador, e não autoriza publicação.
Não misturar o build 0.52.7 com o lock/versão 0.52.8 na verificação de identidade.

As dependências locais são majoritariamente links somente de leitura para o
node_modules do dono. Não executar npm ci/postinstall/rebuild nesse arranjo sem
substituir os links por dependências privadas. Os testes de CI usam o lock exato.
`run.py` nessa pasta isola HOME, USERPROFILE, APPDATA, LOCALAPPDATA, XDG_CONFIG_HOME,
CODEX_HOME, DB_PATH, ORKESTRAI_DATA_DIR e temporários. Não rodar provisioning/testes
com o HOME real do dono. Não compilar enquanto Playwright serve esse build.

## Publicação, site e instalação

- Nenhuma tag `v0.52.8`, release 0.52.8 ou workflow Release Desktop novo foi criado.
- Nenhuma instalação/reinicialização local nesta investigação. Info.plist do Mac
  confirmou **0.52.6 instalada**. Não usar esse app como se contivesse o fix 47fabc69.
- A versão 0.52.8 está apenas preparada na main; precisa de nova decisão do dono.
- Clone do site: `/private/tmp/orkestrai-release-20261108/orkestra-site`, main.
  `71450c0` adicionou as notas e `d3d6f41` marcou-as como **não publicadas**, após
  a suspensão pedida pelo dono. Site: `https://github.com/beeblock/orkestrai-site`.
- Não apagar bancos, imagens, Floors ou volumes Docker para investigar. Há só
  **7,6 GiB livres na última medição**; preservar os logs e evitar duplicar dependências.
  Removi primeiro 136,5 MiB de temporários/resultados de QA. Após nova cobrança,
  removi mais **1,62 GiB**: nove worktrees antigos limpos cujos HEADs são ancestrais
  da main, HOME/bancos isolados antigos de QA, cache de conteúdo do npm e o build
  local. Preservei o checkout do dono, a branch de repasse e o worktree de testes
  com commit único `059ab992`, que não foi comprovado como integrado.
  `disk-cleanup-final.json` contém os caminhos, bytes e HEADs integrados removidos.
  `run.py` recria o HOME isolado necessário; não usar o HOME do dono por isso.
- Medições de tamanho: Docker.raw alocado cerca de 43 GiB; cache Hugging Face
  5,4 GiB (modelos); cache de runtimes do Codex 1,3 GiB. Modelos, runtimes em uso
  e volumes Docker não foram removidos. Não considerar os 43 GiB inteiros descartáveis.
- Executei também a [recuperação de blocos recomendada pelo Docker](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/macfaqs/),
  com saída 0; Docker.raw continuou aparecendo como 43 GiB. `docker image prune -f`
  recuperou 0 B. Não atribuir a essas operações todos os ganhos de espaço observados.

O próximo resultado esperado é identificar por que a entrega real fica colada e
provar o fluxo completo líder ↔ especialistas no cenário que degrada. Os passes
acima não autorizam anunciar que esse resultado já foi alcançado.
