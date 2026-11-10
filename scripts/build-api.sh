#!/usr/bin/env bash
# Builds the API Docker image and pushes it to GitHub Container Registry.
#
#   scripts/build-api.sh [--tag v0.2.0] [--platform linux/amd64] [--no-push]
#
# Image: ghcr.io/fergalmoran/chime-api (override with CHIME_API_IMAGE).
# Tags pushed: the short git SHA, :latest, and --tag if given.
# Builds on the *local* Docker daemon (--context default), never a remote one, whatever context is active.
# Logs in to ghcr.io with `gh auth token` if you aren't already (needs the write:packages scope).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$here")"
api_dir="$repo_root/api"

die() { echo "error: $*" >&2; exit 1; }

image="${CHIME_API_IMAGE:-ghcr.io/fergalmoran/chime-api}"
platform="linux/amd64"
extra_tag=""
push=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --tag) extra_tag="${2:?}"; shift 2 ;;
        --platform) platform="${2:?}"; shift 2 ;;
        --no-push) push=0; shift ;;
        -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
done

docker=(docker --context default)

# --- Preconditions --------------------------------------------------------------------------------
command -v docker >/dev/null || die "docker not found"
[[ -f "$api_dir/Dockerfile" ]] || die "$api_dir/Dockerfile is missing"
"${docker[@]}" info >/dev/null 2>&1 || die "local Docker daemon isn't reachable"

sha="$(git -C "$repo_root" rev-parse --short HEAD)"
if [[ -n "$(git -C "$repo_root" status --porcelain -- api)" ]]; then
    echo "warning: api/ has uncommitted changes; the :$sha tag won't match the commit exactly" >&2
fi

tags=("$image:$sha" "$image:latest")
[[ -n "$extra_tag" ]] && tags+=("$image:$extra_tag")

# --- Build ----------------------------------------------------------------------------------------
build_args=(--platform "$platform"
    --label "org.opencontainers.image.source=https://github.com/fergalmoran/chime"
    --label "org.opencontainers.image.revision=$(git -C "$repo_root" rev-parse HEAD)"
    --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)")
for t in "${tags[@]}"; do build_args+=(-t "$t"); done

echo "==> Building $image ($sha, $platform)"
"${docker[@]}" build "${build_args[@]}" "$api_dir"

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
EOF
