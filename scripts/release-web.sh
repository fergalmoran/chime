#!/usr/bin/env bash
# Releases the web Docker image via GitHub Actions by pushing a web-v<semver> tag. See --help.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/release.sh
source scripts/lib/release.sh
release_image_main web "$@"
