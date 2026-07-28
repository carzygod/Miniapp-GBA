#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/scripts/require-ubuntu-22.04.sh"
[[ "${EUID}" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
[[ "$#" -eq 1 ]] || { echo "usage: $0 <release.tar.gz>" >&2; exit 1; }
archive="$(realpath "$1")"; checksum_file="$archive.sha256"
[[ -f "$archive" && -f "$checksum_file" ]] || { echo "release and .sha256 are required" >&2; exit 1; }
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$checksum_file")")
while IFS= read -r entry; do [[ "$entry" != /* && "/$entry/" != *"/../"* ]] || { echo "unsafe archive path: $entry" >&2; exit 1; }; done < <(tar -tzf "$archive")

stage="$(mktemp -d /opt/minigba/releases/.stage.XXXXXX)"
trap 'rm -rf -- "$stage"' EXIT
tar -xzf "$archive" -C "$stage"
(cd "$stage" && sha256sum -c SHA256SUMS)
version="$(tr -d '\r\n' < "$stage/VERSION")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo "invalid release version" >&2; exit 1; }
release="/opt/minigba/releases/$version"
[[ ! -e "$release" ]] || { echo "release already exists" >&2; exit 1; }
mv "$stage" "$release"; trap - EXIT
chown -R root:root "$release"; chmod 0755 "$release/minigba-api"

runuser -u postgres -- env MINIGBA_DATABASE_URL='postgres://postgres@/minigba?host=/var/run/postgresql&sslmode=disable' "$release/minigba-api" migrate
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d minigba <<'SQL'
GRANT USAGE ON SCHEMA public TO minigba;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO minigba;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO minigba;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO minigba;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO minigba;
SQL

previous="$(readlink -f /opt/minigba/current 2>/dev/null || true)"
ln -sfn "$release" /opt/minigba/current
systemctl enable --now nginx minigba-api
if ! curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/health/ready >/dev/null; then
  if [[ -n "$previous" ]]; then ln -sfn "$previous" /opt/minigba/current; systemctl restart minigba-api; fi
  echo "release health check failed; previous release restored" >&2
  exit 1
fi
echo "Installed MiniGBA API $version"
