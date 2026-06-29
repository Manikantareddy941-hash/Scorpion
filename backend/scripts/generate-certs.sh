#!/usr/bin/env bash
#
# Generate a self-signed SAN certificate for the Scorpion backend HTTPS listener
# (TLS_CERT / TLS_KEY) used by the K8s admission webhook and local dev.
#
# NOT for production — use a real CA or cert-manager there. This exists so the
# kube-apiserver (and `curl https://localhost:8443`) can reach the webhook over
# TLS with the right Subject Alternative Names.
#
# Usage:
#   scripts/generate-certs.sh [out_dir]
# Env overrides:
#   SERVICE_NAME (default: scorpion-backend)  NAMESPACE (default: default)
#   DAYS (default: 365)
#
set -euo pipefail

OUT_DIR="${1:-certs}"
SERVICE="${SERVICE_NAME:-scorpion-backend}"
NAMESPACE="${NAMESPACE:-default}"
DAYS="${DAYS:-365}"

mkdir -p "$OUT_DIR"

# SANs the apiserver / local clients may use to reach the webhook service.
cat > "$OUT_DIR/san.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions    = v3_ext
prompt             = no
[dn]
CN = ${SERVICE}.${NAMESPACE}.svc
[v3_ext]
subjectAltName     = @alt_names
basicConstraints   = critical, CA:FALSE
keyUsage           = critical, digitalSignature, keyEncipherment
extendedKeyUsage   = serverAuth
[alt_names]
DNS.1 = ${SERVICE}
DNS.2 = ${SERVICE}.${NAMESPACE}
DNS.3 = ${SERVICE}.${NAMESPACE}.svc
DNS.4 = ${SERVICE}.${NAMESPACE}.svc.cluster.local
DNS.5 = localhost
IP.1  = 127.0.0.1
EOF

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$OUT_DIR/tls.key" \
  -out    "$OUT_DIR/tls.crt" \
  -days   "$DAYS" \
  -config "$OUT_DIR/san.cnf" \
  -extensions v3_ext

chmod 600 "$OUT_DIR/tls.key"

echo
echo "Wrote:"
echo "  $OUT_DIR/tls.crt  ->  point TLS_CERT at this"
echo "  $OUT_DIR/tls.key  ->  point TLS_KEY  at this"
echo
echo "caBundle for k8s/validating-webhook.yaml (base64, single line):"
base64 -w0 "$OUT_DIR/tls.crt" 2>/dev/null || base64 "$OUT_DIR/tls.crt"
echo
