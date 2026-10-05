#!/usr/bin/env bash
# VPS-DOG agent one-liner installer.
#
#   curl -fsSL https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh | bash -s -- -s <server> -t <token>
#
# It detects the architecture, downloads the matching release binary, writes
# /etc/vps-dog/agent.yaml and /etc/systemd/system/vps-dog.service, then enables
# and starts the service.
#
# Flags:
#   -s <url>     worker base URL                 (required)
#   -t <token>   agent token from the dashboard  (required)
#   -n <name>    node display name               (default: hostname)
#   -r <region>  region label, e.g. HK
#   -i <secs>    report interval                 (default: 30)
#   -k           skip TLS verification           (self-signed worker)
#   -v <ver>     agent version to install        (default: latest release)
#   -u           uninstall instead of installing
#   -h           show help
set -euo pipefail

REPO="${VPSDOG_REPO:-heshang2011/vps-dog}"
BIN_NAME="vps-dog"
BIN_PATH="/usr/local/bin/${BIN_NAME}"
CONFIG_DIR="/etc/vps-dog"
CONFIG_PATH="${CONFIG_DIR}/agent.yaml"
SERVICE_PATH="/etc/systemd/system/${BIN_NAME}.service"

SERVER=""
TOKEN=""
NODE_NAME="$(hostname 2>/dev/null || echo vps-dog)"
REGION=""
INTERVAL="30"
TLS_SKIP="false"
VERSION=""
UNINSTALL="false"

log()  { printf '\033[36m[vps-dog]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[vps-dog]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[vps-dog]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
  cat <<'EOF'
Flags:
  -s <url>     worker base URL                 (required)
  -t <token>   agent token from the dashboard  (required)
  -n <name>    node display name               (default: hostname)
  -r <region>  region label, e.g. HK
  -i <secs>    report interval                 (default: 30)
  -k           skip TLS verification           (self-signed worker)
  -v <ver>     agent version to install        (default: latest release)
  -u           uninstall instead of installing
  -h           show help
EOF
}

while getopts ':s:t:n:r:i:v:kuh' opt; do
  case "$opt" in
    s) SERVER="$OPTARG" ;;
    t) TOKEN="$OPTARG" ;;
    n) NODE_NAME="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    i) INTERVAL="$OPTARG" ;;
    v) VERSION="$OPTARG" ;;
    k) TLS_SKIP="true" ;;
    u) UNINSTALL="true" ;;
    h) usage; exit 0 ;;
    :) die "option -${OPTARG} requires an argument" ;;
    \?) die "unknown option -${OPTARG} (try -h)" ;;
  esac
done

# ── preflight ────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || die "this installer supports Linux only (found $(uname -s))"

if [ "$(id -u)" -ne 0 ]; then
  die "must run as root: curl -fsSL <url> | sudo bash -s -- -s <server> -t <token>"
fi

if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
  die "systemd was not found; install the binary manually and run it under your init system"
fi

if [ "$UNINSTALL" = "true" ]; then
  log "stopping and disabling ${BIN_NAME}"
  systemctl disable --now "${BIN_NAME}" 2>/dev/null || true
  rm -f "$SERVICE_PATH"
  systemctl daemon-reload 2>/dev/null || true
  systemctl reset-failed "${BIN_NAME}" 2>/dev/null || true
  log "service removed. Config kept at ${CONFIG_PATH}; delete it with: rm -rf ${CONFIG_DIR} ${BIN_PATH}"
  exit 0
fi

[ -n "$SERVER" ] || die "-s <server> is required"
[ -n "$TOKEN" ]  || die "-t <token> is required"

case "$SERVER" in
  http://*|https://*) ;;
  *) die "-s must start with http:// or https:// (got '${SERVER}')" ;;
esac
SERVER="${SERVER%/}"

# These values are interpolated into a double-quoted YAML scalar below. A quote
# or newline would let them inject extra YAML keys (e.g. a node name of
# `x"\ntls_skip_verify: true` would silently disable TLS verification), so reject
# anything outside the safe set rather than trying to escape it.
for pair in "server:${SERVER}" "token:${TOKEN}" "name:${NODE_NAME}" "region:${REGION}"; do
  label="${pair%%:*}"
  value="${pair#*:}"
  case "$value" in
    *'"'*|*'\'*|*'
'*) die "-${label} must not contain a double quote, backslash or newline" ;;
  esac
done

case "$INTERVAL" in
  ''|*[!0-9]*) die "-i <interval> must be a whole number of seconds" ;;
esac

# ── detect architecture ──────────────────────────────────────────────────
case "$(uname -m)" in
  x86_64|amd64)  ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  armv7l|armv7)  ARCH="armv7" ;;
  armv6l|armv6)  ARCH="armv7" ;;
  i386|i486|i586|i686) ARCH="386" ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)"
fi
[ -n "$VERSION" ] || die "could not determine the latest release; pass -v <version>"
VERSION="${VERSION#v}"

ASSET="${BIN_NAME}-linux-${ARCH}"
URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET}"
log "installing ${BIN_NAME} ${VERSION} for linux/${ARCH}"

# ── download ─────────────────────────────────────────────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then DOWNLOADER="wget"
else die "curl or wget is required"
fi

fetch() { # fetch <url> <dest>
  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL --retry 3 --connect-timeout 15 -o "$2" "$1"
  else
    wget -q -T 15 -O "$2" "$1"
  fi
}

log "downloading ${URL}"
fetch "$URL" "${TMP}/${BIN_NAME}" || die "download failed: ${URL}"

if [ ! -s "${TMP}/${BIN_NAME}" ]; then
  die "downloaded file is empty"
fi

# ── install ──────────────────────────────────────────────────────────────
install -m 0755 "${TMP}/${BIN_NAME}" "${BIN_PATH}"
log "installed binary at ${BIN_PATH}"

mkdir -p "$CONFIG_DIR"
chmod 0750 "$CONFIG_DIR"

umask 077
cat > "$CONFIG_PATH" <<EOF
# VPS-DOG agent configuration — generated by install.sh
server: "${SERVER}"
token: "${TOKEN}"
name: "${NODE_NAME}"
EOF
if [ -n "$REGION" ]; then
  printf 'region: "%s"\n' "$REGION" >> "$CONFIG_PATH"
fi
cat >> "$CONFIG_PATH" <<EOF
interval: ${INTERVAL}
tls_skip_verify: ${TLS_SKIP}
EOF
chmod 0600 "$CONFIG_PATH"
log "wrote ${CONFIG_PATH}"

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=VPS-DOG monitoring agent
Documentation=https://github.com/${REPO}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${BIN_PATH} -c ${CONFIG_PATH}
Restart=always
RestartSec=5
StartLimitIntervalSec=0
User=root
Environment=VPSDOG_CONFIG=${CONFIG_PATH}
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${CONFIG_DIR}

[Install]
WantedBy=multi-user.target
EOF
log "wrote ${SERVICE_PATH}"

systemctl daemon-reload
systemctl enable --now "${BIN_NAME}"

sleep 1
if systemctl is-active --quiet "${BIN_NAME}"; then
  log "service is running"
  log "check status with: systemctl status ${BIN_NAME}"
  log "follow logs with:  journalctl -u ${BIN_NAME} -f"
else
  warn "service is not active yet; inspect it with: journalctl -u ${BIN_NAME} -n 50 --no-pager"
  exit 1
fi
