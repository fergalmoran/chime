#!/usr/bin/env bash
# Releases the api Docker image via GitHub Actions by pushing a api-v<semver> tag. See --help.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/release.sh
source scripts/lib/release.sh
release_image_main api "$@"
