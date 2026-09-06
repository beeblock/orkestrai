# Build do Orkestrai no Windows

Guia para compilar o app desktop nativamente numa máquina Windows (o caminho
recomendado para produzir o instalador NSIS — cross-build via Docker/wine em
Mac ARM não é confiável).

## Pré-requisitos

- **Node.js 24+** (o servidor de produção usa type stripping do Node 24)
- **Git**
- Não precisa de Visual Studio nem de MSVC: os módulos nativos usam prebuilds.

## Passo a passo

```powershell
git clone <url-do-repo> pantheon
cd pantheon
npm install                  # NÃO use `npm ci`: o lock commitado foi gerado com npm 11.6.x e
                             # npm mais novo (testado: 11.18) o rejeita como "fora de sync" (por
                             # isso os builds cross fixam npm@11.6.2 — ver package-cross.sh).
                             # `npm install` reconcilia o lock LOCALMENTE; não commite essa
                             # mudança (desalinha os builds cross). Alternativa: fixar npm@11.6.2.
npm run build                # build web (vite -> build/)
npm run electron:rebuild     # baixa o prebuild do better-sqlite3 p/ o ABI do Electron (-o = só ele)
npx electron-builder --win nsis --x64 --publish never "-c.npmRebuild=false"   # instalador
# ou, portátil:
npx electron-builder --win zip --x64 --publish never "-c.npmRebuild=false"
```

> As aspas em `"-c.npmRebuild=false"` são obrigatórias no PowerShell (sem elas o
> PowerShell quebra o token e o electron-builder tenta ler `.npmRebuild=false`
> como arquivo de config). No bash (WSL/Docker) pode ser sem aspas.

Artefatos em `release/`:

- `Orkestrai-Setup-<versão>.exe` — instalador NSIS (unsigned: o SmartScreen vai
  avisar; "Mais informações" → "Executar assim mesmo")
- `Orkestrai-<versão>-win.zip` — versão portátil (descompactar e rodar `Orkestrai.exe`)

## Decisões de empacotamento (não mude sem ler)

- **Electron pinado em 42 (ABI 146)**: o `better-sqlite3` só publica
  prebuilds de Electron até ABI 146. Se atualizar o Electron, a build passa a
  exigir compilar `better-sqlite3` do zero (aí sim precisa de Visual Studio
  Build Tools). O `node-pty` traz prebuilds win32-x64 no próprio tarball.
- **`asar: false`** no `package.json`: o servidor de produção
  (`scripts/orkestrai-server.mjs`) é ESM e o loader ESM do Node não resolve
  pacotes dentro do asar. Não reative.
- **`node_modules` de UI excluídos do `files`**: `@tabler`, `@xterm`,
  `@codemirror`, `@lezer`, `codemirror`, `@xyflow`, `layerchart`, `bits-ui` e
  `pusher-js` são frontend puro — o Vite já os compila para `build/client`, então
  as cópias em `node_modules` são peso morto (só `@tabler` = ~17k arquivos). Com
  `asar: false`, cada arquivo é gravado individualmente pelo NSIS, então cortá-los
  reduz ~48% dos arquivos e acelera muito a instalação no Windows. **Não** exclua
  pacotes de runtime (o servidor Node os importa fora do bundle): `drizzle-orm`,
  `@beeblock/svelar`, `ws`, `better-sqlite3`, `node-pty`, `bullmq`, `zod`,
  `effect`, `pdfkit`, `@aws-sdk/*`. Validação: `build/` self-contained + boot do
  servidor sem `MODULE_NOT_FOUND` + janela abrindo no canvas.
- **Sem assinatura de código**: não temos certificado. Instalador e exe saem
  unsigned (avisos do Windows são esperados).
- **Runtime de console da ponte**: o hook `scripts/after-pack.mjs` baixa o
  `node.exe` x64 pinado na versão usada pelo projeto, valida o arquivo contra o
  SHA-256 oficial fixado no código e o inclui em
  `resources/orkestrai-cli-runtime/node.exe`. Esse binário é intencional: o
  executável Electron usa o subsistema gráfico do Windows e, quando chamado
  pelo WSL, não devolve `stdout`/`stderr`; por isso não pode ser usado como
  runtime da CLI ou do MCP. Não remova o hook nem substitua a validação por um
  download sem checksum.
- **`-c.npmRebuild=false` no comando (não no `package.json`)**: sem Visual Studio,
  o rebuild nativo interno do electron-builder falha em `node-pty` e
  `msgpackr-extract` (não publicam prebuild-download para o ABI do Electron — só
  trazem binários N-API no tarball, que já funcionam sem recompilar). O
  `better-sqlite3`, esse sim, é resolvido pelo `npm run electron:rebuild` acima
  (por isso o script usa `-o better-sqlite3`; `-w` NÃO restringe nas versões atuais
  do `@electron/rebuild` e acaba mandando compilar os outros dois). **Não** mova
  `npmRebuild: false` para o `package.json`: é config global e quebraria o build do
  Mac (`electron-builder --mac dmg`), que depende desse rebuild para alinhar o
  `better-sqlite3` ao ABI do Electron.

## Runtime no Windows

- **Dados do app**: `%APPDATA%\orkestrai\` (SQLite, backups rotativos,
  `bin/orkestrai.cmd` da CLI da ponte — entra no PATH dos terminais PTY
  automaticamente a cada boot do servidor interno).
- **PTY**: `node-pty` usa **conpty** nativo do Windows 10+ (fallback winpty).
  Shells: `powershell.exe` por padrão; WSL funciona apontando o terminal para
  `wsl.exe` (Windows e WSL lado a lado no mesmo canvas). O launcher WSL usa o
  runtime de console incluído no app quando disponível e mantém o `node` da
  própria distribuição como fallback, preservando respostas da ponte e o
  transporte JSON-RPC sem depender de um executável gráfico.
- **CLIs de agente** (claude, codex, kimi) precisam estar instaladas e no
  PATH (o app também procura em locais comuns de instalação).

## Testes (opcional mas recomendado)

```powershell
npm test          # vitest (unit + feature)
npx playwright test   # e2e contra build de producao (PORT=5199)
```

## Build das outras plataformas

- **macOS**: `npx electron-builder --mac --arm64` (e/ou `--x64` para Intel). O
  alvo do `package.json` gera DMG e ZIP; o ZIP é obrigatório para o auto-update.
- **Linux/Windows a partir do Mac**: `scripts/package-cross.sh linux|windows|windows-zip|clean`
  (Docker; ver comentários no script)
