#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

go fmt ./...
git diff --exit-code -- '*.go'
go vet ./...
go test -race -cover ./...
go build -trimpath -o build/minigba-api ./cmd/api

