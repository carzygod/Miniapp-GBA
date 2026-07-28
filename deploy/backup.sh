#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
: "${MINIGBA_BACKUP_DIR:?Set MINIGBA_BACKUP_DIR to a dedicated backup filesystem}"
: "${MINIGBA_BACKUP_GPG_RECIPIENT:?Set MINIGBA_BACKUP_GPG_RECIPIENT}"
target="$(realpath -m "$MINIGBA_BACKUP_DIR")"
[[ "$target" == /mnt/* || "$target" == /srv/backup/* ]] || { echo "backup directory must be under /mnt or /srv/backup" >&2; exit 1; }
install -d -o root -g root -m 0700 "$target"
stage="$(mktemp -d /var/lib/minigba/backup.XXXXXX)"; trap 'rm -rf -- "$stage"' EXIT
backup_id="$(date -u +%Y%m%dT%H%M%SZ)"
runuser -u postgres -- pg_dump --format=custom --file="$stage/database.dump" minigba
tar -C /srv/minigba -czf "$stage/blobs.tar.gz" blobs
(cd "$stage" && sha256sum database.dump blobs.tar.gz > SHA256SUMS)
tar -C "$stage" -czf - database.dump blobs.tar.gz SHA256SUMS | gpg --batch --yes --encrypt --recipient "$MINIGBA_BACKUP_GPG_RECIPIENT" --output "$target/minigba-$backup_id.tar.gz.gpg"
sha256sum "$target/minigba-$backup_id.tar.gz.gpg" > "$target/minigba-$backup_id.tar.gz.gpg.sha256"
