#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/scripts/require-ubuntu-22.04.sh"
: "${TARO_APP_API_BASE_URL:?Set TARO_APP_API_BASE_URL to the approved HTTPS API origin}"
[[ "$TARO_APP_API_BASE_URL" == https://* ]] || { echo "TARO_APP_API_BASE_URL must use HTTPS" >&2; exit 1; }
cd "$repo_dir"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || { echo "release build requires a clean Git worktree" >&2; exit 1; }

npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run build:weapp
test -s dist/player/assets/minigba-core.wasm
sha256sum dist/player/assets/minigba-core.wasm
du -sb dist
