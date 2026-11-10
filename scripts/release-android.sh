#!/usr/bin/env bash
# Releases the Android app: tags HEAD as android-v<version>, pushes the tag, and waits for the
# Android workflow (.github/workflows/android.yml) to build the signed .aab and .apk, publish the .aab to the
# Google Play alpha (closed testing) track, and attach both to a GitHub release.
#
#   scripts/release-android.sh [--version 0.2.0 | --bump patch|minor|major] [--set-secrets] [--no-watch] [--yes]
#
# Version defaults to the latest android-v* tag with the patch number bumped (0.1.0 if there's none yet).
# HEAD must be clean and already pushed to origin.
# --set-secrets uploads the CI secrets from this machine before tagging:
#   ~/.config/chime/upload-keystore.jks + .env  ->  CHIME_UPLOAD_KEYSTORE_BASE64 / CHIME_UPLOAD_KEYSTORE_PASSWORD
#   android/app/google-services.json            ->  CHIME_GOOGLE_SERVICES_JSON_BASE64
#   ~/.config/chime/play-service-account.json   ->  CHIME_PLAY_SERVICE_ACCOUNT_JSON (or set CHIME_PLAY_SERVICE_ACCOUNT)
# --secrets-only does just that and stops. Rerun it whenever the keystore or google-services.json changes.
# When the build passes, the .aab and .apk are downloaded to android/dist/.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$here")"
cd "$repo_root"

die() { echo "error: $*" >&2; exit 1; }

version=""
bump="patch"
set_secrets=0
watch=1
assume_yes=0
tag_requested=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) version="${2:?}"; shift 2 ;;
        --bump) bump="${2:?}"; shift 2 ;;
        --set-secrets) set_secrets=1; shift ;;
        --secrets-only) set_secrets=1; tag_requested=0; shift ;;
        --no-watch) watch=0; shift ;;
        -y|--yes) assume_yes=1; shift ;;
        -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
done

command -v gh >/dev/null || die "gh isn't installed"
gh auth status >/dev/null 2>&1 || die "gh isn't logged in: run 'gh auth login'"
repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
workflow="android.yml"
secrets=(CHIME_UPLOAD_KEYSTORE_BASE64 CHIME_UPLOAD_KEYSTORE_PASSWORD CHIME_GOOGLE_SERVICES_JSON_BASE64
    CHIME_PLAY_SERVICE_ACCOUNT_JSON)

# --- Secrets --------------------------------------------------------------------------------------
if (( set_secrets )); then
    config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/chime"
    keystore="${CHIME_KEYSTORE_PATH:-$config_dir/upload-keystore.jks}"
    env_file="$config_dir/upload-keystore.env"
    google_services="android/app/google-services.json"
    play_account="${CHIME_PLAY_SERVICE_ACCOUNT:-$config_dir/play-service-account.json}"
    [[ -f "$keystore" ]] || die "$keystore is missing (android/scripts/release-build.sh creates it on first run)"
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

# --- Version --------------------------------------------------------------------------------------
git fetch --quiet --tags origin
if [[ -z "$version" ]]; then
    latest="$(git tag -l 'android-v*' --sort=-v:refname | head -1)"
    if [[ -z "$latest" ]]; then
        version="0.1.0"
    else
        IFS=. read -r major minor patch <<<"${latest#android-v}"
        case "$bump" in
            major) version="$((major + 1)).0.0" ;;
            minor) version="$major.$((minor + 1)).0" ;;
            patch) version="$major.$minor.$((patch + 1))" ;;
            *) die "--bump must be patch, minor or major" ;;
        esac
    fi
fi
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must look like 1.2.3 (got '$version')"
tag="android-v$version"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists"

# --- Preconditions --------------------------------------------------------------------------------
[[ -z "$(git status --porcelain)" ]] || die "working tree isn't clean: commit or stash first"
head="$(git rev-parse HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD)"
[[ -n "$(git branch -r --contains "$head" 2>/dev/null)" ]] \
    || die "HEAD ($branch @ ${head:0:7}) isn't on origin yet: push it first"
[[ "$branch" == "trunk" ]] || echo "warning: releasing from '$branch', not trunk" >&2

echo "==> Releasing $tag from $branch @ $(git log -1 --format='%h %s')"
if (( ! assume_yes )); then
    read -r -p "    Create and push $tag? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || die "aborted"
fi

git tag -a "$tag" -m "Android $version"
git push origin "refs/tags/$tag"

if (( ! watch )); then
    echo "==> Pushed $tag. Follow it with: gh run list -R $repo --workflow $workflow"
    exit 0
fi

# --- Watch the build ------------------------------------------------------------------------------
echo "==> Waiting for the $workflow run"
run_id=""
for _ in $(seq 1 30); do
    run_id="$(gh run list -R "$repo" --workflow "$workflow" --event push --commit "$head" \
        --json databaseId,headBranch -q ".[] | select(.headBranch == \"$tag\") | .databaseId" | head -1)"
    [[ -n "$run_id" ]] && break
    sleep 2
done
[[ -n "$run_id" ]] || die "no workflow run showed up for $tag; check https://github.com/$repo/actions"

gh run watch "$run_id" -R "$repo" --exit-status || die "build failed: gh run view $run_id -R $repo --log-failed"

mkdir -p android/dist
gh release download "$tag" -R "$repo" -p '*.aab' -p '*.apk' -D android/dist --clobber

cat <<EOF

==> Done: $tag
    Release: https://github.com/$repo/releases/tag/$tag
    Bundle:  $(ls -t android/dist/*.aab | head -1)  (published to Play: ${CHIME_PLAY_TRACK:-alpha} track)
    APK:     $(ls -t android/dist/*.apk | head -1)  (sideload; upload-key signed)
EOF
