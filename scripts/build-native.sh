#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/scripts/require-ubuntu-22.04.sh"

cmake -S "$repo_dir" -B "$repo_dir/build/native" -G Ninja \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DBUILD_TESTING=ON
cmake --build "$repo_dir/build/native" --parallel
ctest --test-dir "$repo_dir/build/native" --output-on-failure

