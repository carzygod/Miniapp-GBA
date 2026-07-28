#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/scripts/require-ubuntu-22.04.sh"
cd "$repo_dir"

npm ci --ignore-scripts
npm run typecheck
npm test
npm run build:weapp
test -s dist/player/assets/minigba-core.wasm
sha256sum dist/player/assets/minigba-core.wasm
du -sb dist
