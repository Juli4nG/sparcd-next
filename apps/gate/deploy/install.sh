#!/usr/bin/env bash
# Install or update the gate and Caddy on Ubuntu 24.04. Run as root from a
# checkout of the repo:
#   sudo SITE_ADDRESS=server.example.org bash apps/gate/deploy/install.sh
# Re-running updates the code and config and keeps /etc/sparcd-next/gate.env.
set -euo pipefail

: "${SITE_ADDRESS:?set SITE_ADDRESS to the public host name, e.g. server.example.org}"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

GATE_SRC="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$GATE_SRC/../.." && pwd)"
APP=/opt/sparcd-next/gate
ENV_FILE=/etc/sparcd-next/gate.env

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https openssl

if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

id sparcd >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin sparcd

# Code: owned by root, readable by the service.
install -d -m 0755 "$APP" "$APP/deploy" "$APP/settings-example"
install -m 0644 "$GATE_SRC"/*.mjs "$GATE_SRC/package.json" "$APP/"
install -m 0644 "$GATE_SRC/deploy/smoke.mjs" "$APP/deploy/"
install -m 0644 "$GATE_SRC"/settings-example/* "$APP/settings-example/"
(cd "$APP" && npm install --omit=dev --no-audit --no-fund --no-package-lock --loglevel=error)

# Secrets: written once, root-only. systemd reads it before dropping to sparcd.
install -d -m 0700 /etc/sparcd-next
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  sed -e "s|^ACCESS_MASTER_KEY=.*|ACCESS_MASTER_KEY=$(openssl rand -base64 32)|"       -e "s|^DATA_KEY=.*|DATA_KEY=$(openssl rand -base64 32)|" \
      -e "s|^ALLOWED_HOSTS=.*|ALLOWED_HOSTS=${SITE_ADDRESS}|" \
      "$GATE_SRC/deploy/gate.env.example" > "$ENV_FILE"
  umask 022
  echo "wrote $ENV_FILE; fill in UPSTREAM, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, and back up DATA_KEY"
fi
chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"

# Static files. The home page starts as apps/sparcd-home until a build replaces it.
install -d -m 0755 /srv/sparcd-next/upload /srv/sparcd-next/tag /srv/sparcd-next/home
[ -f /srv/sparcd-next/home/index.html ] || install -m 0644 "$REPO"/apps/sparcd-home/{index.html,favicon.ico,sparcd.png} /srv/sparcd-next/home/

install -m 0644 "$GATE_SRC/deploy/sparcd-gate.service" /etc/systemd/system/sparcd-gate.service
install -m 0644 "$GATE_SRC/deploy/Caddyfile" /etc/caddy/Caddyfile
install -d -m 0755 /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=SITE_ADDRESS=%s\n' "$SITE_ADDRESS" > /etc/systemd/system/caddy.service.d/sparcd.conf

systemctl daemon-reload
systemctl enable sparcd-gate caddy
systemctl restart caddy
if grep -q '^S3_ACCESS_KEY_ID=.\+' "$ENV_FILE"; then
  systemctl restart sparcd-gate
  echo "gate restarted"
else
  echo "gate not started: fill in $ENV_FILE, run 'cli.mjs init', then: systemctl restart sparcd-gate"
fi
