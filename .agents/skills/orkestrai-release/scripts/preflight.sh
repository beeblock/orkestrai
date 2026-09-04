#!/usr/bin/env bash

set -euo pipefail

VERSION="${1:-}"
MODE="${2:-new}"
SOURCE_REPO="beeblock/orkestrai"
RELEASE_REPO="$SOURCE_REPO"
LEGACY_REPO="beeblock/orkestrai-releases"
LEGACY_TRANSITION_VERSION="0.1.4"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'usage: preflight.sh <major.minor.patch> [new|recover]'
[[ "$MODE" == "new" || "$MODE" == "recover" ]] || fail 'mode must be new or recover'

for command in git gh node npm; do
  command -v "$command" >/dev/null 2>&1 || fail "missing required command: $command"
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'not inside a Git repository'
cd "$ROOT"

[[ "$(git branch --show-current)" == "main" ]] || fail 'release must run from main'
[[ "$(node -p "require('./package.json').version")" == "$VERSION" ]] || fail 'package.json version does not match'
[[ "$(node -p "require('./package-lock.json').version")" == "$VERSION" ]] || fail 'package-lock.json version does not match'
[[ "$(node -p "require('./package-lock.json').packages[''].version")" == "$VERSION" ]] || fail 'package-lock root package version does not match'

[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail 'tracked worktree changes remain'
if [[ -n "$(git status --porcelain --untracked-files=normal | grep '^??' || true)" ]]; then
  printf 'WARN: unrelated untracked files exist; do not stage them.\n'
fi

git fetch origin main --quiet
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || fail 'local main is not synchronized with origin/main'
[[ "$(git remote get-url origin)" == *"beeblock/orkestrai"* ]] || fail 'origin is not beeblock/orkestrai'

TODAY="$(date +%F)"
grep -Eq "^## $VERSION - $TODAY$" CHANGELOG.md || fail "CHANGELOG.md has no English $VERSION section dated $TODAY"
for catalog in src/lib/i18n/docs/pt-BR.ts src/lib/i18n/docs/en.ts src/lib/i18n/docs/es.ts; do
  grep -Fq "Orkestrai $VERSION" "$catalog" || fail "$catalog does not mention Orkestrai $VERSION"
done

COMPANION_ROOT="$(dirname "$ROOT")"
SITE_REPO="$COMPANION_ROOT/orkestra-site"
LEGACY_REPO_ROOT="$COMPANION_ROOT/orkestrai-releases"

verify_companion_repo() {
  local repo="$1"
  local expected_remote="$2"
  [[ -d "$repo/.git" ]] || fail "missing companion repository: $repo"
  [[ "$(git -C "$repo" branch --show-current)" == "main" ]] || fail "$repo must be on main"
  [[ -z "$(git -C "$repo" status --porcelain)" ]] || fail "$repo has uncommitted changes"
  [[ "$(git -C "$repo" remote get-url origin)" == *"$expected_remote"* ]] || fail "$repo origin is not $expected_remote"
  git -C "$repo" fetch origin main --quiet
  [[ "$(git -C "$repo" rev-parse HEAD)" == "$(git -C "$repo" rev-parse origin/main)" ]] || fail "$repo is not synchronized with origin/main"
}

verify_companion_repo "$SITE_REPO" "beeblock/orkestrai-site"

for catalog in src/lib/content/site/pt-BR.ts src/lib/content/site/en.ts src/lib/content/site/es.ts; do
  grep -Fq "$VERSION" "$SITE_REPO/$catalog" || fail "$SITE_REPO/$catalog does not mention $VERSION"
done

if [[ "$VERSION" == "$LEGACY_TRANSITION_VERSION" ]]; then
  verify_companion_repo "$LEGACY_REPO_ROOT" "$LEGACY_REPO"
  for changelog in CHANGELOG.md CHANGELOG.en.md CHANGELOG.es.md; do
    grep -Fq "## $VERSION" "$LEGACY_REPO_ROOT/$changelog" || fail "$LEGACY_REPO_ROOT/$changelog does not mention $VERSION"
  done
fi

gh auth status >/dev/null 2>&1 || fail 'GitHub CLI is not authenticated'
gh repo view "$SOURCE_REPO" >/dev/null 2>&1 || fail 'cannot access source repository'
SOURCE_IS_PRIVATE="$(gh repo view "$SOURCE_REPO" --json isPrivate --jq .isPrivate)"
if [[ "$SOURCE_IS_PRIVATE" == "true" && "$VERSION" != "$LEGACY_TRANSITION_VERSION" ]]; then
  fail 'source repository must be public before creating a release'
fi

SOURCE_SHA="$(git rev-parse HEAD)"
CI_RUN="$(gh run list \
  --repo "$SOURCE_REPO" \
  --workflow CI \
  --branch main \
  --event push \
  --commit "$SOURCE_SHA" \
  --limit 1 \
  --json status,conclusion,url,headSha \
  --jq '.[0] // {}')"
CI_SHA="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.headSha || "")' "$CI_RUN")"
CI_STATUS="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.status || "missing")' "$CI_RUN")"
CI_CONCLUSION="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.conclusion || "")' "$CI_RUN")"
CI_URL="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.url || "")' "$CI_RUN")"
[[ "$CI_SHA" == "$SOURCE_SHA" ]] || fail "no main push CI run found for $SOURCE_SHA"
[[ "$CI_STATUS" == "completed" ]] || fail "CI for $SOURCE_SHA is not complete: $CI_URL"
[[ "$CI_CONCLUSION" == "success" ]] || fail "CI for $SOURCE_SHA did not pass ($CI_CONCLUSION): $CI_URL"

CONFIGURED_SECRETS="$(gh secret list --repo "$SOURCE_REPO" --json name --jq '.[].name')"
for secret in MAC_CSC_LINK MAC_CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  printf '%s\n' "$CONFIGURED_SECRETS" | grep -qx "$secret" || fail "$secret is not configured for signed macOS releases"
done

if [[ "$VERSION" == "$LEGACY_TRANSITION_VERSION" ]]; then
  gh repo view "$LEGACY_REPO" >/dev/null 2>&1 || fail 'cannot access legacy releases repository'
  [[ "$(gh repo view "$LEGACY_REPO" --json isPrivate --jq .isPrivate)" == "false" ]] || fail 'legacy transition repository must be public'
  printf '%s\n' "$CONFIGURED_SECRETS" | grep -qx RELEASES_TOKEN || fail 'RELEASES_TOKEN is not configured for the transition release'
fi

TAG="v$VERSION"
RELEASE_JSON="$(gh release view "$TAG" --repo "$RELEASE_REPO" --json isDraft,url 2>/dev/null || true)"
LEGACY_RELEASE_JSON=""
if [[ "$VERSION" == "$LEGACY_TRANSITION_VERSION" ]]; then
  LEGACY_RELEASE_JSON="$(gh release view "$TAG" --repo "$LEGACY_REPO" --json isDraft,url 2>/dev/null || true)"
fi

if [[ "$MODE" == "new" ]]; then
  [[ -z "$RELEASE_JSON" ]] || fail "$TAG already exists as a release in $RELEASE_REPO"
  [[ -z "$LEGACY_RELEASE_JSON" ]] || fail "$TAG already exists as a release in $LEGACY_REPO"
  ! git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null || fail "local tag $TAG already exists"
  [[ -z "$(git ls-remote --tags origin "refs/tags/$TAG")" ]] || fail "remote tag $TAG already exists"
else
  for release_json in "$RELEASE_JSON" "$LEGACY_RELEASE_JSON"; do
    if [[ -n "$release_json" ]]; then
      IS_DRAFT="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(String(data.isDraft))' "$release_json")"
      [[ "$IS_DRAFT" == "true" ]] || fail "$TAG is public and immutable; prepare a new patch version"
    fi
  done
fi

printf 'Release preflight passed for Orkestrai %s (%s mode).\n' "$VERSION" "$MODE"
