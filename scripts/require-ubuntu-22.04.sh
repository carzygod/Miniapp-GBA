#!/usr/bin/env bash
set -euo pipefail

source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "22.04" ]]; then
  echo "Ubuntu 22.04 is required; found ${PRETTY_NAME:-unknown}" >&2
  exit 1
fi
if command -v systemd-detect-virt >/dev/null && [[ "$(systemd-detect-virt --vm 2>/dev/null || true)" != "none" ]]; then
  echo "A bare-metal host is required; virtual machines are not supported" >&2
  exit 1
fi
