# Releases e auto-update do Orkestrai

O código-fonte, o workflow, os instaladores, os blockmaps e os manifests de
atualização ficam em `beeblock/orkestrai`. O repositório público legado
`beeblock/orkestrai-releases` é preservado somente como ponte para instalações
que ainda consultam o feed antigo.

Agentes responsáveis por uma release devem usar a skill
`.agents/skills/orkestrai-release` (espelhada para Claude em
`.claude/skills/orkestrai-release`). Ela cobre preflight, publicação, recuperação
de falhas e auditoria do feed público.

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

## Criar uma versão

1. Atualize a versão em `package.json` e `package-lock.json`:

   ```bash
   npm version 0.1.1 --no-git-tag-version
   ```

2. Atualize no mesmo commit o `CHANGELOG.md` em inglês e os três catálogos
   traduzidos em `src/lib/i18n/docs/`. O workflow usa o `CHANGELOG.md` como
   fonte exclusiva das notas públicas da release.
3. Rode os testes e faça o commit. A CI executa auditoria de dependências,
   testes unitários, build de produção e toda a suíte E2E do Playwright. Aguarde
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
