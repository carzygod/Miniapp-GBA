#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/scripts/require-ubuntu-22.04.sh"
: "${MINIGBA_WECHAT_APP_ID:?Set MINIGBA_WECHAT_APP_ID}"
: "${MINIGBA_MINIPROGRAM_PRIVATE_KEY:?Set MINIGBA_MINIPROGRAM_PRIVATE_KEY to the key file}"
: "${MINIGBA_RELEASE_VERSION:?Set MINIGBA_RELEASE_VERSION}"

cd "$repo_dir"
test -s dist/app.json
node scripts/upload.cjs
