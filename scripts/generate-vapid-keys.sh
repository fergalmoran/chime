#!/usr/bin/env bash
# Generates a VAPID key pair for the API's Web Push (instant delivery to the Chrome extension).
#
#   scripts/generate-vapid-keys.sh                  # print WebPush__PublicKey=… / WebPush__PrivateKey=… lines
#   scripts/generate-vapid-keys.sh >> prod.env      # append them to an env file (keep it out of git)
#   scripts/generate-vapid-keys.sh --user-secrets   # store them in the API's dotnet user-secrets (development)
#
# Use a different pair per environment. Changing a deployed pair makes existing browser subscriptions fail
# until each extension re-checks with the API (at most a day later).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_project="$(dirname "$here")/api/src/api"

die() { echo "error: $*" >&2; exit 1; }
b64u() { base64 -w0 | tr '+/' '-_' | tr -d '='; }

mode=env
case "${1:-}" in
    "") ;;
    --user-secrets) mode=secrets ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
esac

command -v openssl >/dev/null || die "openssl not found"

pem="$(mktemp)"
trap 'shred -u "$pem" 2>/dev/null || rm -f "$pem"' EXIT
openssl ecparam -name prime256v1 -genkey -noout -out "$pem" 2>/dev/null

# Public key: uncompressed P-256 point (last 65 bytes of the DER SubjectPublicKeyInfo).
public_key="$(openssl ec -in "$pem" -pubout -outform DER 2>/dev/null | tail -c 65 | b64u)"
# Private key: the 32-byte scalar at offset 7 of the DER ECPrivateKey.
private_key="$(openssl ec -in "$pem" -outform DER 2>/dev/null | head -c 39 | tail -c 32 | b64u)"
[[ ${#public_key} -eq 87 && ${#private_key} -eq 43 ]] || die "unexpected key encoding; check your openssl version"

if [[ $mode == secrets ]]; then
    command -v dotnet >/dev/null || die "dotnet not found"
    dotnet user-secrets set "WebPush:PublicKey" "$public_key" --project "$api_project" >/dev/null
    dotnet user-secrets set "WebPush:PrivateKey" "$private_key" --project "$api_project" >/dev/null
    echo "Stored WebPush:PublicKey and WebPush:PrivateKey in the API's user-secrets." >&2
else
    printf 'WebPush__PublicKey=%s\nWebPush__PrivateKey=%s\n' "$public_key" "$private_key"
fi
