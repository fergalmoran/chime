#!/usr/bin/env bash
# Builds a signed release bundle (.aab) for upload to Google Play.
#
#   android/scripts/release-build.sh [--version-name 0.2.0] [--version-code N] [--api-url https://…]
#
# Signing: uses the Play *upload* key. On first run it creates one at
#   ~/.config/chime/upload-keystore.jks  (password in ~/.config/chime/upload-keystore.env)
# Override with CHIME_KEYSTORE_PATH / CHIME_KEYSTORE_PASSWORD / CHIME_KEY_ALIAS / CHIME_KEY_PASSWORD.
# Back both files up. With Play App Signing a lost upload key can be reset via Play support, but it's a hassle.
#
# Version code defaults to minutes since 2026-01-01 UTC: always increasing, wherever it's built.
# Version name defaults to the latest android-v* git tag, else 0.1.0.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
android_dir="$(dirname "$here")"
cd "$android_dir"

die() { echo "error: $*" >&2; exit 1; }

version_name=""
version_code=""
api_url=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version-name) version_name="${2:?}"; shift 2 ;;
        --version-code) version_code="${2:?}"; shift 2 ;;
        --api-url) api_url="${2:?}"; shift 2 ;;
        -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
done

if [[ -z "$version_name" ]]; then
    tag="$(git describe --tags --abbrev=0 --match 'android-v*' 2>/dev/null || true)"
    version_name="${tag#android-v}"
    version_name="${version_name:-0.1.0}"
fi
if [[ -z "$version_code" ]]; then
    version_code=$(( ($(date -u +%s) - 1767225600) / 60 ))
fi
if ! [[ "$version_code" =~ ^[0-9]+$ ]] || (( version_code < 1 || version_code > 2100000000 )); then
    die "version code must be an integer between 1 and 2100000000"
fi

# --- Preconditions --------------------------------------------------------------------------------
[[ -f app/google-services.json ]] || die "app/google-services.json is missing (push notifications need it)"
grep -q '"package_name": "com.podnoms.chime"' app/google-services.json \
    || die "app/google-services.json isn't for com.podnoms.chime"
client_id="$(./gradlew -q --no-daemon properties 2>/dev/null | sed -n 's/^chime.googleWebClientId: //p' || true)"
[[ -n "$client_id" ]] || die "chime.googleWebClientId isn't set (android/gradle.properties); Google sign-in would be hidden"
command -v keytool >/dev/null || die "keytool not found: install a JDK or put one on PATH"

# --- Upload key -----------------------------------------------------------------------------------
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/chime"
export CHIME_KEYSTORE_PATH="${CHIME_KEYSTORE_PATH:-$config_dir/upload-keystore.jks}"
export CHIME_KEY_ALIAS="${CHIME_KEY_ALIAS:-upload}"
env_file="$config_dir/upload-keystore.env"

if [[ -z "${CHIME_KEYSTORE_PASSWORD:-}" && -f "$env_file" ]]; then
    # shellcheck source=/dev/null
    source "$env_file"
    export CHIME_KEYSTORE_PASSWORD
fi

if [[ ! -f "$CHIME_KEYSTORE_PATH" ]]; then
    [[ -z "${CHIME_KEYSTORE_PASSWORD:-}" ]] || die "CHIME_KEYSTORE_PASSWORD is set but $CHIME_KEYSTORE_PATH doesn't exist"
    echo "==> Creating a new upload key at $CHIME_KEYSTORE_PATH"
    mkdir -p "$config_dir" && chmod 700 "$config_dir"
    CHIME_KEYSTORE_PASSWORD="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)"
    export CHIME_KEYSTORE_PASSWORD
    # PKCS12 keystores use one password for the store and the key. 27+ years: Play requires validity past 2033.
    keytool -genkeypair -noprompt -keystore "$CHIME_KEYSTORE_PATH" -storetype PKCS12 \
        -alias "$CHIME_KEY_ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
        -dname "CN=Chime upload key, O=Podnoms" \
        -storepass "$CHIME_KEYSTORE_PASSWORD" >/dev/null
    umask 077
    printf 'CHIME_KEYSTORE_PASSWORD=%q\n' "$CHIME_KEYSTORE_PASSWORD" > "$env_file"
    chmod 600 "$CHIME_KEYSTORE_PATH" "$env_file"
    echo "    Password saved to $env_file"
    echo "    BACK UP BOTH FILES (e.g. in your password manager)."
fi
[[ -n "${CHIME_KEYSTORE_PASSWORD:-}" ]] || die "no keystore password: set CHIME_KEYSTORE_PASSWORD or create $env_file"

# --- Build ----------------------------------------------------------------------------------------
echo "==> Building com.podnoms.chime $version_name ($version_code)"
gradle_args=(-Pchime.versionCode="$version_code" -Pchime.versionName="$version_name")
[[ -n "$api_url" ]] && gradle_args+=(-Pchime.releaseApiUrl="$api_url")

# --no-daemon: never reuse an IDE-started daemon (e.g. one running on VS Code's bundled JRE, which lacks jlink).
./gradlew --no-daemon "${gradle_args[@]}" :app:testDebugUnitTest :app:bundleRelease

aab="app/build/outputs/bundle/release/app-release.aab"
[[ -f "$aab" ]] || die "build finished but $aab wasn't produced"
mkdir -p dist
out="dist/chime-$version_name-$version_code.aab"
cp "$aab" "$out"

# --- Verify the signature --------------------------------------------------------------------------
fingerprint() { keytool -list -v -keystore "$CHIME_KEYSTORE_PATH" -alias "$CHIME_KEY_ALIAS" \
    -storepass "$CHIME_KEYSTORE_PASSWORD" | sed -n "s/^[[:space:]]*$1: //p"; }
key_sha1="$(fingerprint SHA1)"
key_sha256="$(fingerprint SHA256)"
signed_sha1="$(keytool -printcert -jarfile "$out" | sed -n 's/^[[:space:]]*SHA1: //p' | head -1)"
[[ "$signed_sha1" == "$key_sha1" ]] || die "$out isn't signed with the upload key (got '${signed_sha1:-unsigned}')"

cat <<EOF

==> Done: android/$out
    Version:      $version_name ($version_code)
    API URL:      ${api_url:-https://chime.ferg.al}
    Upload key:   SHA-1   $key_sha1
                  SHA-256 $key_sha256

Upload it in Play Console -> Test and release -> (Internal testing) -> Create new release.
Google sign-in on Play-installed builds needs an Android OAuth client (Google Cloud -> podnoms-chime ->
Clients) with the *app signing* key's SHA-1 from Play Console -> Test and release -> App integrity.
Add one with the upload key's SHA-1 too if you'll sideload release builds. (Push doesn't need either.)
EOF
