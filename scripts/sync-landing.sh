#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC="$ROOT/landing/index.html"
DST="$ROOT/docs/index.html"

cp "$SRC" "$DST"
echo "✓ Synced landing/index.html → docs/index.html"
