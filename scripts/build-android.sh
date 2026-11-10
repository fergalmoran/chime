#!/usr/bin/env bash
# Builds a signed release APK (plus the Play bundle and R8 mapping) into android/dist/, and optionally installs it.
#
#   scripts/build-android.sh [--install] [--version-name 0.2.0] [--version-code N] [--api-url https://…]
#
# Signing, versioning and the API URL are handled by android/scripts/release-build.sh; other arguments go to it.
# The APK is signed with the Play *upload* key, so Google sign-in needs an Android OAuth client with that key's SHA-1.
# --install sideloads it with adb onto the one connected device. A build installed from Play is signed with a
#   different key, so adb refuses to update it: uninstall Chime from the phone first.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$here")"
android_dir="$repo_root/android"

die() { echo "error: $*" >&2; exit 1; }

install=0
passthrough=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --install) install=1; shift ;;
        -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) passthrough+=("$1"); shift ;;
    esac
done

# Check for a device before spending minutes on the build.
if (( install )); then
    command -v adb >/dev/null || die "adb not found (needed for --install)"
    devices="$(adb devices | awk 'NR > 1 && $2 == "device"' | wc -l)"
    (( devices == 1 )) || die "--install needs exactly one connected device (found $devices; see 'adb devices')"
fi

if [[ -n "$(git -C "$repo_root" status --porcelain -- android)" ]]; then
    echo "warning: android/ has uncommitted changes" >&2
fi

started="$(date +%s)"
"$android_dir/scripts/release-build.sh" "${passthrough[@]}"

# The newest APK in dist/ written by this run.
apk="$(find "$android_dir/dist" -maxdepth 1 -name 'chime-*.apk' -newermt "@$started" -printf '%T@ %p\n' 2>/dev/null \
    | sort -n | tail -1 | cut -d' ' -f2-)"
[[ -n "$apk" ]] || die "release-build.sh finished but no new APK appeared in android/dist/"

if (( ! install )); then
    printf '\n==> APK: %s\n    Install with: scripts/build-android.sh --install (or adb install -r "%s")\n' "$apk" "$apk"
    exit 0
fi

echo "==> Installing $(basename "$apk")"
if ! out="$(adb install -r "$apk" 2>&1)"; then
    echo "$out" >&2
    grep -q 'INSTALL_FAILED_UPDATE_INCOMPATIBLE' <<<"$out" \
        && die "the installed Chime is signed with a different key (e.g. from Play): uninstall it first (adb uninstall com.podnoms.chime)"
    die "adb install failed"
fi
echo "==> Installed. Watch sign-in with: adb logcat -s ChimeGoogleSignIn"
