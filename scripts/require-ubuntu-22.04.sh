#!/usr/bin/env bash
set -euo pipefail

if [[ ! -r /etc/os-release ]]; then
  echo "Ubuntu 22.04 is required" >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "22.04" ]]; then
  echo "Ubuntu 22.04 is required; found ${PRETTY_NAME:-unknown}" >&2
  exit 1
fi

if grep -qiE '(microsoft|wsl)' /proc/sys/kernel/osrelease 2>/dev/null; then
  echo "A bare-metal host is required; WSL is not supported" >&2
  exit 1
fi

if command -v systemd-detect-virt >/dev/null; then
  detected_virt="$(systemd-detect-virt 2>/dev/null || true)"
  if [[ -n "$detected_virt" && "$detected_virt" != "none" ]]; then
    echo "A bare-metal host is required; detected virtualization: $detected_virt" >&2
    exit 1
  fi
fi

if [[ -f /.dockerenv || -f /run/.containerenv ]]; then
  echo "A bare-metal host is required; containers are not supported" >&2
  exit 1
fi
