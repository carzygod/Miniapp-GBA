#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/scripts/require-ubuntu-22.04.sh"
[[ "${EUID}" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
: "${MINIGBA_PUBLIC_PORT:?Set MINIGBA_PUBLIC_PORT to an unused high port}"
[[ "$MINIGBA_PUBLIC_PORT" =~ ^[0-9]+$ ]] && (( MINIGBA_PUBLIC_PORT >= 10240 && MINIGBA_PUBLIC_PORT <= 65535 )) || { echo "port must be 10240-65535" >&2; exit 1; }
if ss -H -ltn "sport = :$MINIGBA_PUBLIC_PORT" | grep -q .; then echo "port is already in use" >&2; exit 1; fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl gnupg nginx openssl postgresql postgresql-client
id -u minigba >/dev/null 2>&1 || useradd --system --home /var/lib/minigba --create-home --shell /usr/sbin/nologin minigba
install -d -o root -g root -m 0755 /opt/minigba/releases
install -d -o minigba -g minigba -m 0750 /srv/minigba/blobs /srv/minigba/tmp /var/lib/minigba
install -d -o root -g minigba -m 0750 /etc/minigba /etc/minigba/credentials
if [[ ! -e /etc/minigba/api.env ]]; then install -o root -g minigba -m 0640 "$repo_dir/deploy/api.env.example" /etc/minigba/api.env; fi
if [[ ! -e /etc/minigba/credentials/token-signing-key ]]; then umask 0027; openssl rand -hex 32 > /etc/minigba/credentials/token-signing-key; chown root:minigba /etc/minigba/credentials/token-signing-key; fi
if [[ ! -e /etc/minigba/credentials/wechat-app-secret ]]; then install -o root -g minigba -m 0640 /dev/null /etc/minigba/credentials/wechat-app-secret; fi

runuser -u postgres -- psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='minigba') THEN CREATE ROLE minigba LOGIN; END IF; END $$;
SELECT 'CREATE DATABASE minigba OWNER postgres' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='minigba')\gexec
SQL

install -o root -g root -m 0644 "$repo_dir/deploy/minigba-api.service" /etc/systemd/system/minigba-api.service
sed "s/__PUBLIC_PORT__/$MINIGBA_PUBLIC_PORT/g" "$repo_dir/deploy/nginx-high-port.conf" > /etc/nginx/sites-available/minigba-api
ln -sfn /etc/nginx/sites-available/minigba-api /etc/nginx/sites-enabled/minigba-api
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl daemon-reload
echo "Bootstrap complete. Set the WeChat credentials in /etc/minigba, then install a release."
