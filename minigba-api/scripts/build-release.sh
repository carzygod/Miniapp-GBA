#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/scripts/require-ubuntu-22.04.sh"
source "$repo_dir/toolchains/versions.env"
: "${MINIGBA_RELEASE_VERSION:?Set MINIGBA_RELEASE_VERSION}"
: "${MINIGBA_TEST_DATABASE_URL:?Set MINIGBA_TEST_DATABASE_URL to a dedicated database whose name ends in _test}"
[[ "$MINIGBA_RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo "invalid release version" >&2; exit 1; }
[[ "$(go version)" == "go version go${GO_VERSION} linux/amd64" ]] || { echo "Go ${GO_VERSION} linux/amd64 is required" >&2; exit 1; }

cd "$repo_dir"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || { echo "release build requires a clean Git worktree" >&2; exit 1; }
go mod download
go vet ./...
go test -race -cover ./...
mkdir -p build dist/reports
commit="$(git rev-parse --verify HEAD)"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
go build -trimpath -ldflags="-s -w -X github.com/minigba-cloud/minigba-api/internal/buildinfo.Version=$MINIGBA_RELEASE_VERSION -X github.com/minigba-cloud/minigba-api/internal/buildinfo.Commit=$commit -X github.com/minigba-cloud/minigba-api/internal/buildinfo.BuildTime=$build_time" -o build/minigba-api ./cmd/api
go run ./cmd/sbom -output dist/reports/sbom.cdx.json -licenses dist/reports/licenses.tsv
go version -m build/minigba-api > dist/reports/go-build-info.txt

stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
install -m 0755 build/minigba-api "$stage/minigba-api"
install -m 0644 api/openapi.yaml "$stage/openapi.yaml"
install -m 0644 deploy/minigba-api.service "$stage/minigba-api.service"
install -m 0644 deploy/nginx-high-port.conf "$stage/nginx-high-port.conf"
install -m 0644 LICENSE "$stage/LICENSE-MiniGBA-Apache-2.0.txt"
install -m 0644 THIRD_PARTY_NOTICES.md "$stage/THIRD_PARTY_NOTICES.md"
install -m 0644 go.mod "$stage/go.mod"
install -m 0644 go.sum "$stage/go.sum"
cp -R dist/reports "$stage/reports"
printf '%s\n' "$MINIGBA_RELEASE_VERSION" > "$stage/VERSION"
(cd "$stage" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
archive="dist/minigba-api-${MINIGBA_RELEASE_VERSION}-linux-amd64.tar.gz"
tar -C "$stage" -czf "$archive" .
sha256sum "$archive" > "$archive.sha256"
