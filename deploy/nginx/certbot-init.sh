#!/bin/bash
# Run this ONCE on first deployment to obtain the TLS certificate.
# Safe to re-run: writes a temporary HTTP-only nginx config to bootstrap
# the ACME challenge, then restores the full HTTPS config after the cert
# is issued.
#
# Usage:
#   cd deploy/
#   cp .env.example .env && vim .env   # fill in DOMAIN and secrets
#   bash nginx/certbot-init.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example and fill in the values."
  exit 1
fi

source .env

if [ -z "${DOMAIN:-}" ]; then
  echo "ERROR: DOMAIN is not set in .env"
  exit 1
fi

TEMPLATE="nginx/conf.d/bridge.conf.template"
FULL_BACKUP="nginx/conf.d/bridge.conf.template.full"

# Preserve the real (full HTTPS) template on first run.
if [ ! -f "$FULL_BACKUP" ]; then
  cp "$TEMPLATE" "$FULL_BACKUP"
fi

echo "==> Writing HTTP-only bootstrap template..."
cat > "$TEMPLATE" <<'NGINX_CONF'
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 404;
    }
}
NGINX_CONF

echo "==> Starting bridge + nginx (HTTP only)..."
docker compose up -d bridge nginx
sleep 3

echo "==> Requesting Let's Encrypt certificate for $DOMAIN..."
# --entrypoint certbot overrides the renew-loop entrypoint defined in
# docker-compose.yml so we can pass the `certonly` subcommand.
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "admin@${DOMAIN}" \
  --agree-tos \
  --no-eff-email \
  -d "${DOMAIN}"

echo "==> Restoring full HTTPS template..."
cp "$FULL_BACKUP" "$TEMPLATE"

echo "==> Restarting nginx with full TLS config..."
docker compose restart nginx

echo ""
echo "Done! Your bridge server is running at https://${DOMAIN}"
echo ""
echo "Next steps:"
echo "  1. Generate an admin pair code:"
echo "     curl -X POST https://${DOMAIN}/admin/pair-codes \\"
echo "       -H 'x-admin-token: <BRIDGE_ADMIN_TOKEN>' \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"ttl_secs\": 600}'"
echo ""
echo "  2. In EchoMind desktop: Cloud Bridge → fill in server URL and pair code → pair"
echo ""
echo "  3. After pairing, set ECHOMIND_BRIDGE_TOKEN in .env if running the VPS bot."
