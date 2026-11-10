#!/usr/bin/env bash
# Builds the web Docker image and pushes it to GitHub Container Registry.
#
#   scripts/build-web.sh [--tag v0.2.0] [--api-url https://…] [--google-client-id …] [--no-push]
#
# Image: ghcr.io/fergalmoran/chime-web (override with CHIME_WEB_IMAGE).
# Tags pushed: the short git SHA, :latest, and --tag if given.
# Builds on the *local* Docker daemon (--context default), never a remote one, whatever context is active.
# Logs in to ghcr.io with `gh auth token` if you aren't already (needs the write:packages scope).
# --api-url / --google-client-id override the VITE_* build args; they're baked into the client bundle.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$here")"
web_dir="$repo_root/web"

die() { echo "error: $*" >&2; exit 1; }

image="${CHIME_WEB_IMAGE:-ghcr.io/fergalmoran/chime-web}"
platform="linux/amd64"
extra_tag=""
api_url=""
google_client_id=""
push=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --tag) extra_tag="${2:?}"; shift 2 ;;
        --api-url) api_url="${2:?}"; shift 2 ;;
        --google-client-id) google_client_id="${2:?}"; shift 2 ;;
        --platform) platform="${2:?}"; shift 2 ;;
        --no-push) push=0; shift ;;
        -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
done

docker=(docker --context default)

# --- Preconditions --------------------------------------------------------------------------------
command -v docker >/dev/null || die "docker not found"
[[ -f "$web_dir/Dockerfile" ]] || die "$web_dir/Dockerfile is missing"
"${docker[@]}" info >/dev/null 2>&1 || die "local Docker daemon isn't reachable"

sha="$(git -C "$repo_root" rev-parse --short HEAD)"
if [[ -n "$(git -C "$repo_root" status --porcelain -- web)" ]]; then
    echo "warning: web/ has uncommitted changes; the :$sha tag won't match the commit exactly" >&2
fi

tags=("$image:$sha" "$image:latest")
[[ -n "$extra_tag" ]] && tags+=("$image:$extra_tag")

# --- Build ----------------------------------------------------------------------------------------
build_args=(--platform "$platform"
    --label "org.opencontainers.image.source=https://github.com/fergalmoran/chime"
    --label "org.opencontainers.image.revision=$(git -C "$repo_root" rev-parse HEAD)"
    --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)")
[[ -n "$api_url" ]] && build_args+=(--build-arg "VITE_API_URL=$api_url")
[[ -n "$google_client_id" ]] && build_args+=(--build-arg "VITE_GOOGLE_CLIENT_ID=$google_client_id")
for t in "${tags[@]}"; do build_args+=(-t "$t"); done

echo "==> Building $image ($sha, $platform)"
"${docker[@]}" build "${build_args[@]}" "$web_dir"

if (( ! push )); then
    printf '\n==> Built (not pushed):\n'; printf '    %s\n' "${tags[@]}"
    exit 0
fi

# --- Push -----------------------------------------------------------------------------------------
registry="${image%%/*}"
if [[ "$registry" == "ghcr.io" ]] && ! grep -q '"ghcr.io"' "${DOCKER_CONFIG:-$HOME/.docker}/config.json" 2>/dev/null; then
    command -v gh >/dev/null || die "not logged in to ghcr.io and gh isn't installed: run 'docker login ghcr.io'"
    echo "==> Logging in to ghcr.io as $(gh api user -q .login)"
    gh auth token | "${docker[@]}" login ghcr.io -u "$(gh api user -q .login)" --password-stdin
fi

for t in "${tags[@]}"; do
    echo "==> Pushing $t"
    "${docker[@]}" push "$t"
done

digest="$("${docker[@]}" inspect --format '{{index .RepoDigests 0}}' "$image:$sha" 2>/dev/null || true)"
cat <<EOF

==> Done
    Tags:    ${tags[*]}
    Digest:  ${digest:-unknown}
    API URL: ${api_url:-https://chime.ferg.al (Dockerfile default)}
EOF
