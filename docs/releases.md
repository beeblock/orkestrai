# Releases e auto-update do Orkestrai

O código-fonte, o workflow, os instaladores, os blockmaps e os manifests de
atualização ficam em `beeblock/orkestrai`. O repositório público legado
`beeblock/orkestrai-releases` é preservado somente como ponte para instalações
que ainda consultam o feed antigo.

## Falha na inicialização e migrações interrompidas

Desde a 0.39.1, as três migrações históricas de pastas de workspaces podem
retomar um estado parcial compatível, sem apagar registros. Colunas, chave
estrangeira e índice existentes são verificados antes da recuperação. Uma
estrutura incompatível continua bloqueada e exige análise; não deve ser
convertida automaticamente em um banco vazio.

A 0.39.2 também recupera o schema incompleto observado em uma instalação real:
grupos com id, name, created_at, updated_at e parent_id, mas sem position ou
collapsed; workspaces com group_id, mas sem position. Colunas recuperáveis
ausentes são adicionadas pelo Schema do Svelar, sem recriar tabelas ou alterar
valores existentes. Todas as definições e a propriedade do índice são
validadas antes de escrever. Identidade e nome não são inventados.

Um parent_id legado adicionado por ALTER TABLE pode não ter a FK declarada.
Esse formato é preservado: WorkspaceGroupService já valida pais e remove os
vínculos de filhos/workspaces antes de excluir uma pasta. Referências órfãs
ou FKs incompatíveis continuam bloqueadas sem apagar ou reatribuir dados.
Falhas de coluna incluem automaticamente metadados esperados/atuais limitados,
sem valores de registros nem defaults arbitrários, para diagnóstico pelo log.

O fixture tests/fixtures/reported-workspace-schema.mjs é DDL independente
transcrito das capturas do schema real; não é criado pelas migrações em teste.
O teste empacotado usa a cadeia histórica completa e verifica registros,
relações, novas colunas e o backup anterior à recuperação. A release executa
esse teste no pacote Intel já assinado/notarizado. O runner macOS é Intel e
não executa o binário ARM: o pacote ARM é testado localmente em Apple Silicon.

O lote SQLite e seu histórico ficam na mesma transação. Antes de migrar um
banco existente, a API de backup do SQLite inclui páginas confirmadas no WAL,
o snapshot passa por quick_check e usa permissões privadas. Apenas o backup
automático concluído mais recente é mantido. Inicializações sem migrações
pendentes não criam outra cópia. Isso substitui a cópia simples do arquivo no
boot, que não incluía necessariamente os dados do WAL.

O atualizador inicia antes do servidor. Uma falha abre um diálogo nativo em
pt-BR/en/es para baixar a versão atual, tentar novamente ou acessar os logs,
mesmo sem HTTP ou renderer. A 0.23.0 distribuída não pode receber esse novo
fluxo enquanto falha antes de iniciar seu atualizador: é necessária uma
substituição manual única do aplicativo. Preserve a pasta de dados.

Agentes responsáveis por uma release devem usar a skill
`.agents/skills/orkestrai-release` (espelhada para Claude em
`.claude/skills/orkestrai-release`). Ela cobre preflight, publicação, recuperação
de falhas e auditoria do feed público.

## Pin temporário de segurança do node-forge

A 0.39.2 fixa o código revisado do PR upstream
https://github.com/digitalbazaar/forge/pull/1152 no commit imutável
ceba34402e329f0365134f23fe19898756527d65, com SHA-512 no lockfile. O PR ainda
não foi integrado nem publicado oficialmente: não é uma versão oficial
estável. Comparado à 1.4.0, só muda o controle de elementos do DigestAlgorithm,
o teste upstream, o changelog e o número de pré-release já existente no upstream.
Não há dependências de runtime ou scripts de instalação adicionais.

O patch local `patches/node-forge+1.4.1-0.patch`, aplicado pelo postinstall
existente, também exige valor vazio para parâmetros NULL presentes. Um teste
independente mostrou que o PR ainda aceitava bytes em NULL; a verificação
adicional recusa essa estrutura inválida sem mudar assinaturas válidas.
Referência de codificação: https://www.rfc-editor.org/rfc/rfc8017.html#section-9.2.

Isso corrige https://github.com/advisories/GHSA-86w9-cpqp-85rv sem fazer o
downgrade incompatível de Postman sugerido pelo npm audit. O bloqueio
`npm audit --audit-level=moderate` permanece intacto. O teste independente
`tests/fixtures/forge-signature-validation.mjs` gera chaves efêmeras sem
persisti-las, verifica assinaturas válidas, recusa cinco formatos malformados
e confirma importação de chave privada. Ele roda também contra a dependência
do pacote Intel assinado antes do upload. É uma regressão de parsing, não uma
demonstração de ataque sem chave privada. Substitua esse pin pela release
oficial quando ela incorporar o fix e passar pelos mesmos testes.

## Dependências de segurança na 0.39.3

O gate `npm audit --audit-level=moderate` permanece completo. http-cache-semantics
4.3.0, Joi 17.13.8 e source-map-js 1.2.2 corrigem os avisos publicados desde a
última release. O downloader legado do empacotador continua usando a mesma
API `bootstrap` de global-agent 4.1.3; um teste local de proxy HTTP confirma a
compatibilidade. Essa versão remove roarr/sprintf-js, ainda sem correção oficial.

O braces sem correção oficial era trazido exclusivamente pelo patch-package.
Os cinco patches existentes continuam em `patches/`, sem alterações. O novo
`scripts/apply-dependency-patches.mjs` usa jsdiff 9.0.0 e o contrato versionado
`patches/dependency-patches.json`: verifica as versões e os SHA-256 exatos antes
e depois dos oito arquivos, confina os alvos, recusa symlinks e valida tudo antes
de escrever. Arquivos temporários são preparados antes das trocas atômicas;
ENOSPC não trunca os módulos instalados. A aplicação é idempotente e preserva
LF/CRLF. Mudança de versão ou fonte desconhecida bloqueia a instalação e exige
revisão dos patches, nunca aplicação com contexto aproximado. Os testes cobrem
todos os patches, fonte inesperada, arquivo ausente, versão divergente, symlink,
hash incompatível, patch sem contrato e falta de espaço.

Não há advisories ignorados nem pacote renomeado para ocultar vulnerabilidade.
O install-time check de NULL do node-forge permanece obrigatório e é testado
novamente no pacote Intel assinado antes da publicação.

## Dependências de segurança na 0.40.0

Handlebars fica fixado na versão oficial 4.7.10 para os consumidores Postman e
Bruno, sem rebaixar seus runtimes. Esse patch corrige os advisories
[GHSA-xw65-4hp5-5hc7](https://github.com/advisories/GHSA-xw65-4hp5-5hc7),
[GHSA-8r5x-fm3f-whwj](https://github.com/advisories/GHSA-8r5x-fm3f-whwj) e
[GHSA-p8wg-vrv2-v86f](https://github.com/advisories/GHSA-p8wg-vrv2-v86f).
Os testes verificam a versão resolvida por cada consumidor, renderização
compatível, rejeição de AST malformada e de acesso ao construtor, e escape de
terminadores de script pré-compilado. Os testes existentes também executam
as visualizações do Postman e os scripts do Bruno. O gate completo
`npm audit --audit-level=moderate` permanece obrigatório, sem exceções.

## Runtime nativo do Computer

O hook `scripts/after-pack.mjs` inclui o runtime do Cua correspondente ao sistema
e à arquitetura do instalador, não à máquina de build. Isso também cobre um
instalador Intel gerado em Apple Silicon. O pacote vem do endereço exato fixado
no `package-lock.json`, com verificação SHA-512 antes da extração, sem executar
scripts do pacote. Binários, metadados e aviso de licença são incluídos antes da
assinatura; pacote ausente, incompatível ou adulterado interrompe o build.

O mesmo hook recompila o SQLite já copiado para o runtime e a arquitetura exatos
do Electron, antes da assinatura, e verifica o entry point da ABI no binário.
Isso evita reutilizar um binário do Node por causa de marcadores antigos de
rebuild, inclusive ao gerar o pacote Intel em Apple Silicon. A verificação local
usa um banco em memória sob o Electron e não altera os dados do usuário.

## Credenciais

O workflow usa o `GITHUB_TOKEN` automático do próprio repositório, com
`contents: write`, para criar releases em `beeblock/orkestrai`. Nenhum PAT é
necessário para as versões normais.

A versão `0.1.4` é a release única de transição. Ela precisa ser publicada com
os mesmos artefatos no repositório principal e no legado, para que as versões
até `0.1.3` recebam um aplicativo configurado para o novo feed. Para essa versão,
mantenha também um fine-grained personal access token com:

- acesso somente ao repositório `beeblock/orkestrai-releases`;
- permissão **Contents: Read and write**;
- sem permissões adicionais.

Cadastre o token em `beeblock/orkestrai` como secret de Actions chamado
`RELEASES_TOKEN`. Não remova o repositório legado nem a release `0.1.4`: uma
instalação antiga pode permanecer offline por meses antes de fazer a migração.

## Proteções de desempenho contra regressão

A CI obrigatória do mesmo SHA da release executa os testes abaixo; não remova
esses casos nem flexibilize limites para contornar uma falha de publicação.

- `tests/feature/agent-inbox.test.ts`: ask padrão retorna em menos de 12 s
  (espera configurada de 8 s), um terminal lento não serializa outros agentes,
  respostas concorrentes não duplicam e a recuperação cobre reinício, lotes,
  falha de consulta, paginação e sinais novos durante uma recuperação.
- `tests/feature/floor-service.test.ts`: integração e commit na main com
  alterações locais, repetição após hook recusado, exclusões, permissões de
  execução e caminhos literais sem incluir arquivos privados ignorados.
- `tests/unit/heavy-run-service.test.ts` e
  `tests/unit/orkestrai-cli-inbox.test.ts`: limite da fila, perda de reserva,
  encerramento da árvore do comando e parada por falta de espaço.
- `tests/e2e/canvas-idle-performance.spec.ts`: arestas elásticas convergem e
  ficam sem alterações no path em repouso; um canvas de 290 nós e 727 arestas
  passa por pan/zoom sem desmontar nós, erros de página ou intervalo entre
  frames de 500 ms ou mais. Esse limite detecta travamentos graves, não prova
  60 FPS nem mede CPU do Electron no workspace real.

Execute as suítes e o build em sequência. O Playwright usa banco e diretórios
de usuário isolados e um build estável; remova seus traces depois. A tag só
pode ser criada com a CI completa verde no mesmo SHA. O pacote portátil
testado é verificado por procedência e hash antes do empacotamento nativo.

Para acompanhar o time real, use `orkestrai stats` para latências p50/p95,
idade das caixas de entrada, cards, Floors e fila pesada. Cruze esses números
com os eventos do Control Center e os commits para separar comunicação,
tempo trabalhando e tempo esperando integração; esses dois últimos tempos
não são contadores prontos do `stats`. Compare janelas
equivalentes, número de agentes, tamanho do canvas e carga de builds; não use
quantidade de ferramentas ou cards done como substituto de commits
integrados. Arraste/zoom no Moedex, CPU do Electron e tempo de conclusão de
trabalho arbitrário continuam exigindo validação em uso real. Testes verdes
não garantem um prazo do modelo ou do provider.

## Criar uma versão

A CI envia um artifact `production-build-<SHA>` somente depois de testes e E2E
bem-sucedidos em um push de `main`. A release resolve o ID desse artifact no
run concluído do mesmo commit e verifica o digest do download, a versão, o
hash do lockfile e o SHA-256 de cada arquivo. Assim, não repete o build web
em macOS, Windows e Linux. O bundle contém somente código/assets portáveis;
binários nativos são recusados no artifact e continuam sendo preparados
para o Electron e a arquitetura de cada pacote. Se o artifact já expirou
ou uma CI antiga não o enviou, cada target faz o build do checkout verificado.
Um artifact encontrado, mas com digest ou procedência inválidos, bloqueia
o pipeline; não é tratado como ausência e não recebe fallback silencioso.
Artifacts de CI não substituem instaladores públicos assinados.

O `.gitattributes` mantém `package-lock.json` em LF em todos os checkouts,
inclusive no Windows com `core.autocrlf=true`, sem relaxar a comparação exata
do hash. A CI e o empacotamento Windows exercitam essa conversão com Git real.

O hook do SQLite instala explicitamente o prebuild da versão Electron e CPU
do pacote e verifica a ABI antes de assinar. Não dependa apenas de
`electron-rebuild --force` depois da cópia: o empacotador remove `binding.gyp`,
e a descoberta pode terminar sem reconstruir o módulo. Ausência do prebuild
correto bloqueia a release; o binário do checkout para testes não é alterado.

1. Atualize a versão em `package.json` e `package-lock.json`:

   ```bash
   npm version 0.1.1 --no-git-tag-version
   ```

2. Atualize no mesmo commit o `CHANGELOG.md` em inglês e os três catálogos
   traduzidos em `src/lib/i18n/docs/`. O workflow usa o `CHANGELOG.md` como
   fonte exclusiva das notas públicas da release.
3. Rode os testes e faça o commit. A CI executa auditoria de dependências,
   testes unitários, transporte nativo do Computer no Windows, build de produção
   e toda a suíte E2E do Playwright. O teste nativo mantém prazo de 20 segundos
   para o processo e 30 segundos para a asserção, incluindo a inicialização fria
   do PowerShell. Aguarde
   a CI de `main` terminar com sucesso nesse mesmo SHA; tanto o preflight local
   quanto o workflow de release bloqueiam a tag/publicação se a CI estiver
   ausente, pendente, cancelada ou falhar.
4. Crie uma tag anotada ou leve exatamente igual à versão:

   ```bash
   git tag v0.1.1
   git push origin main v0.1.1
   ```

O workflow `Release Desktop` compila:

- macOS Apple Silicon: DMG, ZIP e blockmaps;
- macOS Intel: DMG, ZIP e blockmaps;
- Windows x64: instalador NSIS e blockmap;
- Linux x64: AppImage, RPM e manifest `latest-linux.yml` (o electron-builder não gera blockmap separado para AppImage).

O build macOS usa o runner padrão `macos-15-intel` de 14 GB de RAM, em vez do
runner M1 de 7 GB. O heap do build web permite até 12 GB; os binários nativos
são selecionados pela arquitetura de cada instalador, não pela do runner.
Os dois pacotes continuam exigindo assinatura Developer ID e notarização.
Consulte as [especificações dos runners do GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Apple Silicon e Intel agora usam duas instâncias independentes desse runner,
com `max-parallel: 2` e `fail-fast: false`. Assinatura e notarização podem
acontecer ao mesmo tempo; cada CPU conserva todos os gates. Cada artifact
leva um manifest com nome próprio. O publisher verifica ambos os manifests,
tamanhos e SHA-512 antes de combiná-los em um único `latest-mac.yml` e executar
a validação completa. Não use merge de artifacts com manifests de mesmo nome:
isso perderia uma arquitetura. O tempo final ainda depende da fila dos
runners e da Apple; meça o workflow concluído antes de prometer um prazo.

Depois dos builds, `scripts/validate-release-artifacts.mjs` confere versão,
arquivos referenciados, tamanho e SHA-512 dos manifests `latest-mac.yml`,
`latest.yml` e `latest-linux.yml`. A release fica em draft durante o upload e só
é publicada quando todas as validações passam. Na `0.1.4`, os dois destinos são
preparados e validados antes da publicação; a partir da `0.1.5`, somente o
repositório principal recebe releases novas.

## Assinatura

Windows NSIS, Linux AppImage e Linux RPM atualizam mesmo sem assinatura. Windows mostra o
aviso esperado do SmartScreen até existir um certificado.

No macOS, a troca automática exige Developer ID Application e notarização. Sem
isso, `scripts/package-macos.sh` assina o bundle inteiro de forma ad-hoc para
evitar a mensagem falsa de aplicativo danificado e grava `stagingPercentage: 0`
no feed para bloquear updaters antigos. O app novo consulta a release principal
diretamente e oferece o download manual seguro sem tocar na instalação atual.
No primeiro uso, tente abrir o app e feche o aviso. Depois abra **Ajustes do
Sistema → Privacidade e Segurança**, desça até **Segurança**, clique em **Abrir
Mesmo Assim**, autentique e confirme **Abrir**. O botão aparece por cerca de uma
hora após a tentativa. Para eliminar esse passo e habilitar a troca automática,
cadastre:

- `MAC_CSC_LINK`: certificado `.p12` em base64;
- `MAC_CSC_KEY_PASSWORD`: senha do `.p12`;
- `APPLE_ID`;
- `APPLE_APP_SPECIFIC_PASSWORD`;
- `APPLE_TEAM_ID`.

O fallback ad-hoc existe somente para builds locais. O workflow oficial define
`ORKESTRAI_REQUIRE_MAC_SIGNING=true` e falha imediatamente se qualquer um dos
cinco secrets estiver ausente. Com as credenciais presentes, o electron-builder
assina com Developer ID Application, habilita Hardened Runtime, envia o app ao
serviço de notarização da Apple e anexa o ticket ao bundle.

Antes do upload, o CI valida nas duas arquiteturas: assinatura profunda,
autoridade Developer ID, Team ID, flag de Hardened Runtime, aceitação pelo
Gatekeeper e ticket com `stapler`. DMG e ZIP também continuam passando por
verificação de integridade.

Também execute `node scripts/validate-macos-permissions.mjs <Orkestrai.app>`:
o app e cada helper precisam de `com.apple.security.device.audio-input` e
`com.apple.security.automation.apple-events`. Uma assinatura válida sem esses
entitlements não comprova que o microfone ou a automação funcionam.
Para QA local com a identidade já presente no Keychain, peça autorização
explícita ao proprietário antes de iniciar. O macOS pode pedir a senha várias
vezes porque o bundle contém muitos binários; cancelar um pedido não cancela
o empacotamento inteiro. Nunca altere permissões do Keychain automaticamente.
Somente após essa autorização, use
`ORKESTRAI_MAC_ALLOW_KEYCHAIN_PROMPTS=true ORKESTRAI_MAC_LOCAL_SIGNING_IDENTITY="Developer ID Application: ..." npm run package:mac -- --arm64`.
Sem a autorização explícita, o wrapper recusa esse modo antes de assinar.
O build local padrão continua ad-hoc, sem consultar uma identidade do Keychain.
Ele não depende de CI nem de push: gere o pacote, substitua a instalação local
e reteste. Esse modo desabilita Hardened Runtime, não publica e não declara
notarização. Validação de assinatura oficial é uma etapa separada da release,
não um pré-requisito para o teste local padrão.
O workflow oficial continua exigindo todos os secrets e a notarização da Apple.

### Pacote assinado de QA sem publicar

Prefira a CI quando a chave local exigir interação com o Keychain. Depois de
commitar, enviar `main` e passar a CI nesse SHA, execute:

```sh
gh workflow run release.yml --repo beeblock/orkestrai --ref main -f tag="$(git rev-parse HEAD)" -f build_only=true
```

Esse modo gera apenas o instalador Apple Silicon assinado e notarizado, verifica
as permissões reais do app e helpers e disponibiliza o artifact
`release-macos-arm64` no run. Não cria tag, release pública nem altera feeds de
atualização. Baixe o
artifact desse run, instale o DMG exato e valide hardware/interação. As etapas
seguintes fazem checkout do SHA resolvido na validação, nunca de uma referência
que possa avançar durante o build. O fluxo normal por tag mantém as cinco etapas
e só publica depois de validar os artefatos de todas as plataformas.

## Recuperação

Se um build ou upload falhar, a release permanece ausente ou como draft e não é
vista pelo updater. Para falha transitória sem mudança no código, execute o
workflow novamente informando a mesma tag em **Run workflow**. Se a correção
alterar a fonte, confirme em todos os destinos aplicáveis que a release ainda
não existe (ou é draft), faça commit/push e mova a tag para o novo commit antes
de disparar o workflow. O job aceita completar um draft e substitui assets com
o mesmo nome, mas se recusa a modificar uma release que já esteja pública.

Nunca publique manualmente uma release incompleta: o `electron-updater` depende
do manifest e do instalador correspondente estarem disponíveis ao mesmo tempo.

O job macOS precisa passar `codesign --verify --deep --strict` nos bundles das
duas arquiteturas, `hdiutil verify` nos DMGs e `unzip -t` nos ZIPs antes do
upload. Um checksum correto não substitui essa verificação: a `0.1.2` tinha
arquivos íntegros, mas uma assinatura ad-hoc parcial que o Gatekeeper reportava
como aplicativo danificado.

## Bootstrap do auto-update na 0.1.1

`electron-updater` precisa permanecer em `dependencies`, nunca em
`devDependencies`: o electron-builder remove dependências de desenvolvimento do
aplicativo final. As versões `0.0.1` e `0.1.0` foram distribuídas sem esse
módulo e não conseguem buscar a própria correção. Esses usuários fazem uma
instalação manual única da `0.1.1`; a pasta de dados fica fora do bundle e é
preservada. O teste `packaged updater` em `release-artifacts.test.ts` protege
essa regra nas próximas releases.
