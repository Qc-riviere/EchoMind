#!/bin/bash
# Run this ONCE on first deployment to obtain the TLS certificate.
# After this, the certbot container handles automatic renewal every 12 hours.
#
# Usage:
#   cd deploy/
#   cp .env.example .env && vim .env   # fill in DOMAIN and secrets
#   bash nginx/certbot-init.sh

set -euo pipefail

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example and fill in the values."
  exit 1
fi

source .env

if [ -z "${DOMAIN:-}" ]; then
  echo "ERROR: DOMAIN is not set in .env"
  exit 1
fi

echo "==> Starting nginx (HTTP only) for ACME challenge..."
# Temporarily use a minimal HTTP-only config to get the cert
docker compose up -d nginx

echo "==> Waiting for nginx to be ready..."
sleep 3

echo "==> Requesting Let's Encrypt certificate for $DOMAIN..."
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "admin@${DOMAIN}" \
  --agree-tos \
  --no-eff-email \
  -d "${DOMAIN}"

echo "==> Certificate obtained. Reloading nginx with full TLS config..."
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
