#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/scripts/require-ubuntu-22.04.sh"
[[ -z "$(git -C "$repo_dir" status --porcelain --untracked-files=normal)" ]] || { echo "release build requires a clean Git worktree" >&2; exit 1; }

: "${EMSDK:?Set EMSDK to the pinned emsdk checkout}"
source "$EMSDK/emsdk_env.sh" >/dev/null

emcmake cmake -S "$repo_dir" -B "$repo_dir/build/weapp" -G Ninja \
  -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DBUILD_TESTING=OFF
cmake --build "$repo_dir/build/weapp" --parallel --target minigba-core-wasm

mkdir -p "$repo_dir/dist"
cp "$repo_dir/build/weapp/minigba-core.wasm" "$repo_dir/dist/minigba-core.wasm"
node "$repo_dir/scripts/verify-wasm.mjs" "$repo_dir/dist/minigba-core.wasm"
node "$repo_dir/tests/wasm-smoke.mjs" "$repo_dir/dist/minigba-core.wasm"
sha256sum "$repo_dir/dist/minigba-core.wasm" > "$repo_dir/dist/minigba-core.wasm.sha256"
