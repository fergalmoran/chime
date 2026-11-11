#!/usr/bin/env bash
# Releases the Android app: tags HEAD as android-v<version>, pushes the tag, and waits for the
# Android workflow (.github/workflows/android.yml) to build the signed .aab and .apk, publish the .aab to the
# Google Play alpha (closed testing) track, and attach both to a GitHub release.
#
#   scripts/release-android.sh [--major | --minor | --patch | --version X.Y.Z] [--set-secrets] [--no-watch] [--yes]
#
#   --major | --minor | --patch   which part of the latest android-v* version to bump (default: --patch)
#   --version X.Y.Z               release exactly this version instead
#   --no-watch                    push the tag and return without waiting for the workflow
#   -y, --yes                     don't ask for confirmation
#   --set-secrets                 upload the CI secrets from this machine before tagging:
#       ~/.config/chime/upload-keystore.jks + .env  ->  CHIME_UPLOAD_KEYSTORE_BASE64 / CHIME_UPLOAD_KEYSTORE_PASSWORD
#       android/app/google-services.json            ->  CHIME_GOOGLE_SERVICES_JSON_BASE64
#       ~/.config/chime/play-service-account.json   ->  CHIME_PLAY_SERVICE_ACCOUNT_JSON (or set CHIME_PLAY_SERVICE_ACCOUNT)
#   --secrets-only                upload the secrets and stop. Rerun whenever any of those files change.
#
# HEAD must be clean and already pushed to origin. When the build passes, the .aab and .apk are
# downloaded to android/dist/.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/release.sh
source scripts/lib/release.sh

set_secrets=0
tag_requested=1
while [[ $# -gt 0 ]]; do
    release_parse_common "$@" && { shift "$RELEASE_SHIFT"; continue; }
    case "$1" in
        --set-secrets) set_secrets=1; shift ;;
        --secrets-only) set_secrets=1; tag_requested=0; shift ;;
        -h | --help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
done

release_init
repo="$RELEASE_REPO"
secrets=(CHIME_UPLOAD_KEYSTORE_BASE64 CHIME_UPLOAD_KEYSTORE_PASSWORD CHIME_GOOGLE_SERVICES_JSON_BASE64
    CHIME_PLAY_SERVICE_ACCOUNT_JSON)

# --- Secrets --------------------------------------------------------------------------------------
if (( set_secrets )); then
    config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/chime"
    keystore="${CHIME_KEYSTORE_PATH:-$config_dir/upload-keystore.jks}"
    env_file="$config_dir/upload-keystore.env"
    google_services="android/app/google-services.json"
    play_account="${CHIME_PLAY_SERVICE_ACCOUNT:-$config_dir/play-service-account.json}"
    [[ -f "$keystore" ]] || die "$keystore is missing (scripts/build-android.sh creates it on first run)"
    [[ -f "$google_services" ]] || die "$google_services is missing"
    [[ -f "$play_account" ]] || die "$play_account is missing: create a service account key for Play publishing (see .github/workflows/android.yml)"
    grep -q '"type": *"service_account"' "$play_account" || die "$play_account isn't a service account key"
    if [[ -z "${CHIME_KEYSTORE_PASSWORD:-}" ]]; then
        [[ -f "$env_file" ]] || die "no keystore password: set CHIME_KEYSTORE_PASSWORD or create $env_file"
        # shellcheck source=/dev/null
        source "$env_file"
    fi
    [[ -n "${CHIME_KEYSTORE_PASSWORD:-}" ]] || die "CHIME_KEYSTORE_PASSWORD is empty"

    echo "==> Uploading Android release secrets to $repo"
    base64 -w0 "$keystore" | gh secret set CHIME_UPLOAD_KEYSTORE_BASE64 -R "$repo"
    printf '%s' "$CHIME_KEYSTORE_PASSWORD" | gh secret set CHIME_UPLOAD_KEYSTORE_PASSWORD -R "$repo"
    base64 -w0 "$google_services" | gh secret set CHIME_GOOGLE_SERVICES_JSON_BASE64 -R "$repo"
    gh secret set CHIME_PLAY_SERVICE_ACCOUNT_JSON -R "$repo" < "$play_account"
fi
(( tag_requested )) || exit 0

existing="$(gh secret list -R "$repo" --json name -q '.[].name')"
for s in "${secrets[@]}"; do
    grep -qx "$s" <<<"$existing" || die "repository secret $s isn't set: rerun with --set-secrets"
done

# --- Tag and watch --------------------------------------------------------------------------------
release_next_version "android-v"
release_check_head
release_tag_and_push "Android $RELEASE_VERSION"
release_watch "android.yml" || exit 0

tag="$RELEASE_TAG"
mkdir -p android/dist
gh release download "$tag" -R "$repo" -p '*.aab' -p '*.apk' -D android/dist --clobber

cat <<EOF

==> Done: $tag
    Release: https://github.com/$repo/releases/tag/$tag
    Bundle:  $(ls -t android/dist/*.aab | head -1)  (published to Play: ${CHIME_PLAY_TRACK:-alpha} track)
    APK:     $(ls -t android/dist/*.apk | head -1)  (sideload; upload-key signed)
EOF
