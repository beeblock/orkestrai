# Orkestrai Release Contract

## Repositories And Credential

- Source and workflow: `beeblock/orkestrai`
- Primary update feed and installers: `beeblock/orkestrai`
- Primary credential: automatic workflow `GITHUB_TOKEN`, Contents write
- One-time transition: version `0.1.4` is also published to `beeblock/orkestrai-releases`
- Transition secret: `RELEASES_TOKEN`, restricted to `beeblock/orkestrai-releases` with Contents read/write
- Workflow: `.github/workflows/release.yml` (`Release Desktop`)

## Required Public Assets

For version `<v>`, require:

- Apple Silicon: `Orkestrai-<v>-arm64.dmg`, its blockmap, `Orkestrai-<v>-arm64-mac.zip`, and its blockmap
- macOS Intel: `Orkestrai-<v>.dmg`, its blockmap, `Orkestrai-<v>-mac.zip`, and its blockmap
- Windows x64: `Orkestrai-Setup-<v>.exe` and its blockmap
- Linux x64: `Orkestrai-<v>.AppImage` (blockmap embedded) and `Orkestrai-<v>.x86_64.rpm`
- Feeds: `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`

The Windows filename must exactly match the URL in `latest.yml`. The macOS manifest must contain both architecture ZIPs. Installer sizes and SHA-512 values must match their manifest entries.

## Publication Contract

The workflow builds each OS natively, downloads the artifacts into the publisher, runs `scripts/validate-release-artifacts.mjs`, creates or updates a draft in the primary repository, uploads all assets, compares local and remote asset counts, and only then publishes it as latest. For `0.1.4`, it prepares and validates the same assets in the legacy repository before publishing both destinations.

The publisher refuses to alter an already-public release. Failed upload retries may clobber assets only while the release is draft.

## Known Build Requirements

- Use Node 24 and npm `11.6.2` in every job, including the publisher.
- Keep the general `NODE_OPTIONS=--max-old-space-size=6144` for tooling. `npm run build` explicitly permits a 12 GB heap for the complete Vite/adapter-node process. Use the standard 14 GB `macos-15-intel` runner for both target architectures, not the 7 GB M1 runner; changing only the heap does not provide physical memory.
- Official releases require all five Apple secrets and `mac.notarize: true`; the preflight and macOS job must fail instead of publishing an unsigned build when any credential is absent.
- `scripts/package-macos.sh` retains ad-hoc signing with hardened runtime disabled and 0% manifest rollout only for explicit local builds without Apple credentials.
- Every release macOS build must pass strict deep code-sign verification, Developer ID authority and Team ID checks, Hardened Runtime inspection, Gatekeeper assessment, and stapler validation for both app bundles, plus DMG and ZIP integrity checks before upload.
- Electron stays pinned according to `AGENTS.md`; changing it can break native dependency prebuilds.
- `asar` remains disabled according to the production server constraint in `AGENTS.md`.

## Updater Behavior

- The packaged app checks on boot and every six hours.
- The renderer receives persisted updater state through Electron IPC.
- Windows NSIS, Linux AppImage and Linux RPM support unsigned replacement.
- Ad-hoc macOS builds do not download or replace applications in place; their feed rollout is 0% to stop legacy updaters, while the current app checks the primary GitHub release API and offers manual installation. In-place macOS update requires Apple signing and notarization secrets.
- User data, workspaces, settings, and voice models live outside the application bundle.

## Failure Triage

- Build OOM near the adapter-node phase: confirm the workflow heap setting.
- `npm ci` lock mismatch only in publisher: confirm the pinned npm install runs there too.
- Missing macOS credential: confirm all five Apple secrets exist; official releases intentionally refuse the unsigned fallback.
- Notarization authentication failure: regenerate the app-specific password and verify `APPLE_ID` and `APPLE_TEAM_ID`.
- Gatekeeper or stapler failure after packaging: inspect the Apple notary log before retrying the unpublished release.
- Missing Linux blockmap: do not require a separate AppImage blockmap.
- Manifest references a missing Windows asset: confirm the hyphenated `artifactName` in `package.json`.
- Primary publication authorization failure: verify workflow `contents: write` permission.
- `0.1.4` legacy publication authorization failure: verify the `RELEASES_TOKEN` secret exists and its fine-grained repository/Contents permissions; never expose its value.
