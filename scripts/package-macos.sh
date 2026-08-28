#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# electron-builder cannot reliably collect transitive production dependencies
# when the project-level node_modules is a symlink to another checkout. Package
# from a clean temporary install in that case so local test builds match CI.
if [[ -L "$ROOT_DIR/node_modules" && "${ORKESTRAI_MAC_STAGED:-false}" != "true" ]]; then
  if [[ ! -d "$ROOT_DIR/build" ]]; then
    printf 'ERROR: Run npm run build before packaging macOS.\n' >&2
    exit 1
  fi

  stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/orkestrai-macos-package.XXXXXX")"
  cleanup_stage() {
    rm -rf "$stage_dir"
  }
  trap cleanup_stage EXIT

  printf 'node_modules is a symlink; creating a clean packaging stage at %s\n' "$stage_dir"
  git ls-files --cached --others --exclude-standard -z \
    | rsync -a --from0 --files-from=- "$ROOT_DIR/" "$stage_dir/"
  rsync -a "$ROOT_DIR/build/" "$stage_dir/build/"

  (
    cd "$stage_dir"
    npm ci
    ORKESTRAI_MAC_STAGED=true bash scripts/package-macos.sh "$@"
  )

  mkdir -p "$ROOT_DIR/release"
  rsync -a "$stage_dir/release/" "$ROOT_DIR/release/"
  exit 0
fi

builder_args=(--mac "$@" --publish never)
required_signing_env=(
  CSC_LINK
  CSC_KEY_PASSWORD
  APPLE_ID
  APPLE_APP_SPECIFIC_PASSWORD
  APPLE_TEAM_ID
)

# Signing traverses the unpacked application concurrently. The macOS runner's
# default soft limit is too low once production dependencies exceed a few
# thousand files.
requested_open_file_limit="${ORKESTRAI_MAC_OPEN_FILE_LIMIT:-unlimited}"
hard_open_file_limit="$(ulimit -Hn)"
if [[ "$requested_open_file_limit" != "unlimited" && ! "$requested_open_file_limit" =~ ^[0-9]+$ ]]; then
  printf 'ERROR: ORKESTRAI_MAC_OPEN_FILE_LIMIT must be a positive integer or unlimited.\n' >&2
  exit 1
fi
if [[ "$hard_open_file_limit" =~ ^[0-9]+$ ]] && \
  { [[ "$requested_open_file_limit" == "unlimited" ]] || (( hard_open_file_limit < requested_open_file_limit )); }; then
  requested_open_file_limit="$hard_open_file_limit"
fi
if ! ulimit -n "$requested_open_file_limit"; then
  printf 'ERROR: Unable to raise the macOS open-file limit to %s.\n' "$requested_open_file_limit" >&2
  exit 1
fi
printf 'macOS open-file limit: %s\n' "$(ulimit -Sn)"

if [[ "${ORKESTRAI_REQUIRE_MAC_SIGNING:-false}" == "true" ]]; then
  for variable in "${required_signing_env[@]}"; do
    if [[ -z "${!variable:-}" ]]; then
      printf 'ERROR: %s is required for an official macOS release.\n' "$variable" >&2
      exit 1
    fi
  done
fi

if [[ -z "${CSC_LINK:-}" ]]; then
  unset CSC_LINK CSC_NAME CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  npx electron-builder "${builder_args[@]}" -c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.notarize=false
  if [[ -f release/latest-mac.yml ]]; then
    node scripts/set-mac-update-policy.mjs release/latest-mac.yml
  fi
else
  npx electron-builder "${builder_args[@]}"
fi
