# Shared helpers for the tag-based release scripts (release-api.sh, release-web.sh, release-android.sh).
# Each release is an annotated git tag <prefix>v<semver> (e.g. api-v0.2.0) whose push triggers that
# component's GitHub Actions workflow. Source this file; it doesn't do anything on its own.

die() { echo "error: $*" >&2; exit 1; }

# Common flags. Callers loop over "$@" and hand each argument to release_parse_common first:
#   release_parse_common "$@" && { shift "$RELEASE_SHIFT"; continue; }
RELEASE_VERSION=""
RELEASE_BUMP="patch"
RELEASE_WATCH=1
RELEASE_YES=0
release_parse_common() {
    RELEASE_SHIFT=1
    case "$1" in
        --major | --minor | --patch) RELEASE_BUMP="${1#--}" ;;
        --version) RELEASE_VERSION="${2:?--version needs a value, e.g. 1.2.3}"; RELEASE_SHIFT=2 ;;
        --no-watch) RELEASE_WATCH=0 ;;
        -y | --yes) RELEASE_YES=1 ;;
        *) return 1 ;;
    esac
}

RELEASE_COMMON_HELP="  --major | --minor | --patch   which part of the latest version to bump (default: --patch)
  --version X.Y.Z               release exactly this version instead
  --no-watch                    push the tag and return without waiting for the workflow
  -y, --yes                     don't ask for confirmation"

release_init() {
    command -v gh >/dev/null || die "gh isn't installed"
    gh auth status >/dev/null 2>&1 || die "gh isn't logged in: run 'gh auth login'"
    RELEASE_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
}

# release_next_version <tag prefix, e.g. api-v>: sets RELEASE_TAG and RELEASE_VERSION.
# With no tags yet, a bump starts from 0.0.0 (so the first --patch release is 0.0.1, --minor 0.1.0).
release_next_version() {
    local prefix="$1" latest major minor patch
    git fetch --quiet --tags origin
    if [[ -z "$RELEASE_VERSION" ]]; then
        latest="$(git tag -l "${prefix}*" --sort=-v:refname | grep -E "^${prefix}[0-9]+\.[0-9]+\.[0-9]+$" | head -1 || true)"
        IFS=. read -r major minor patch <<<"${latest#"$prefix"}"
        major="${major:-0}" minor="${minor:-0}" patch="${patch:-0}"
        case "$RELEASE_BUMP" in
            major) RELEASE_VERSION="$((major + 1)).0.0" ;;
            minor) RELEASE_VERSION="$major.$((minor + 1)).0" ;;
            patch) RELEASE_VERSION="$major.$minor.$((patch + 1))" ;;
        esac
        RELEASE_PREVIOUS="${latest:-none}"
    else
        RELEASE_PREVIOUS="$(git tag -l "${prefix}*" --sort=-v:refname | head -1)"
        RELEASE_PREVIOUS="${RELEASE_PREVIOUS:-none}"
    fi
    [[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
        || die "version must be semver like 1.2.3 or 1.2.3-rc.1 (got '$RELEASE_VERSION')"
    RELEASE_TAG="${prefix}${RELEASE_VERSION}"
    ! git rev-parse -q --verify "refs/tags/$RELEASE_TAG" >/dev/null || die "tag $RELEASE_TAG already exists"
}

# The tag goes on HEAD, which must be committed and already on origin so CI builds exactly that.
release_check_head() {
    [[ -z "$(git status --porcelain)" ]] || die "working tree isn't clean: commit or stash first"
    RELEASE_HEAD="$(git rev-parse HEAD)"
    RELEASE_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    [[ -n "$(git branch -r --contains "$RELEASE_HEAD" 2>/dev/null)" ]] \
        || die "HEAD ($RELEASE_BRANCH @ ${RELEASE_HEAD:0:7}) isn't on origin yet: push it first"
    [[ "$RELEASE_BRANCH" == "trunk" ]] || echo "warning: releasing from '$RELEASE_BRANCH', not trunk" >&2
}

# release_tag_and_push <message>
release_tag_and_push() {
    echo "==> $RELEASE_TAG (previous: $RELEASE_PREVIOUS) on $RELEASE_BRANCH @ $(git log -1 --format='%h %s')"
    if (( ! RELEASE_YES )); then
        local answer
        read -r -p "    Create and push $RELEASE_TAG? [y/N] " answer
        [[ "$answer" =~ ^[Yy]$ ]] || die "aborted"
    fi
    git tag -a "$RELEASE_TAG" -m "$1"
    git push origin "refs/tags/$RELEASE_TAG"
}

# release_watch <workflow file>: waits for the run the tag push started; exits non-zero if it fails.
# Returns 1 (without failing) when --no-watch was given.
release_watch() {
    local workflow="$1" run_id=""
    if (( ! RELEASE_WATCH )); then
        echo "==> Pushed $RELEASE_TAG. Follow it with: gh run list -R $RELEASE_REPO --workflow $workflow"
        return 1
    fi
    echo "==> Waiting for the $workflow run"
    for _ in $(seq 1 30); do
        run_id="$(gh run list -R "$RELEASE_REPO" --workflow "$workflow" --event push --commit "$RELEASE_HEAD" \
            --json databaseId,headBranch -q ".[] | select(.headBranch == \"$RELEASE_TAG\") | .databaseId" | head -1)"
        [[ -n "$run_id" ]] && break
        sleep 2
    done
    [[ -n "$run_id" ]] || die "no $workflow run showed up for $RELEASE_TAG; check https://github.com/$RELEASE_REPO/actions"
    gh run watch "$run_id" -R "$RELEASE_REPO" --exit-status \
        || die "$workflow failed: gh run view $run_id -R $RELEASE_REPO --log-failed"
}

# release_image_main <api|web> "$@": the whole of release-api.sh / release-web.sh. Tags HEAD as
# <component>-vX.Y.Z; the push makes .github/workflows/<component>.yml test the app and publish
# ghcr.io/<owner>/chime-<component>:X.Y.Z, :X.Y and :latest (plus :sha-<commit>).
release_image_main() {
    local component="$1"; shift
    while [[ $# -gt 0 ]]; do
        release_parse_common "$@" && { shift "$RELEASE_SHIFT"; continue; }
        case "$1" in
            -h | --help)
                cat <<HELP
Releases the $component Docker image: tags HEAD as $component-v<version> and pushes the tag. GitHub Actions
(.github/workflows/$component.yml) then tests it and publishes ghcr.io/<owner>/chime-$component:<version>
and :<major>.<minor> and :latest. HEAD must be clean and already pushed to origin.

  scripts/release-$component.sh [--major | --minor | --patch | --version X.Y.Z] [--no-watch] [--yes]

$RELEASE_COMMON_HELP

The version bumps from the latest $component-v* tag (0.0.0 if there isn't one).
To build and push an image from this machine instead, use scripts/build-$component.sh.
HELP
                exit 0 ;;
            *) die "unknown argument: $1 (see --help)" ;;
        esac
    done

    release_init
    release_next_version "$component-v"
    release_check_head
    release_tag_and_push "$component $RELEASE_VERSION"
    release_watch "$component.yml" || return 0

    local image="ghcr.io/${RELEASE_REPO,,}-$component"
    local minor="${RELEASE_VERSION%.*}"
    cat <<DONE

==> Done: $RELEASE_TAG
    Published: $image:$RELEASE_VERSION
DONE
    [[ "$RELEASE_VERSION" == *-* ]] || printf '               %s\n' "$image:$minor" "$image:latest"
}
