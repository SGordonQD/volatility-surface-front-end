#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_FRONTEND_DIR="${1:-${TARGET_FRONTEND_DIR:-}}"

if [[ -z "${TARGET_FRONTEND_DIR}" ]]; then
  echo "Usage: $0 /absolute/path/to/other-repo/frontend"
  echo "Or set TARGET_FRONTEND_DIR env var."
  exit 1
fi

if [[ ! -d "${TARGET_FRONTEND_DIR}" ]]; then
  echo "Target frontend directory does not exist: ${TARGET_FRONTEND_DIR}"
  exit 1
fi

SOURCE_DIST="${ROOT_DIR}/dist"
TARGET_DIST="${TARGET_FRONTEND_DIR}/dist"

if [[ ! -d "${SOURCE_DIST}" ]]; then
  echo "Source dist not found at ${SOURCE_DIST}. Run npm run build first."
  exit 1
fi

rm -rf "${TARGET_DIST}"
mkdir -p "${TARGET_DIST}"
cp -R "${SOURCE_DIST}/." "${TARGET_DIST}/"

echo "Copied build output:"
echo "  from: ${SOURCE_DIST}"
echo "  to:   ${TARGET_DIST}"
