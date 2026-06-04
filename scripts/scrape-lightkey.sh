#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scrape-lightkey.sh — Download Lightkey fixtures for a manufacturer and
#                      convert them to OrbitDMX rig JSON.
#
# Usage:
#   ./scripts/scrape-lightkey.sh "Fun Generation"
#   ./scripts/scrape-lightkey.sh "Eurolite" --outdir src/fixtures
#   ./scripts/scrape-lightkey.sh --list   # list all available manufacturers
#
# Requirements: curl, python3
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES_URL="https://lightkeyapp.com/en/fixtures"
OUTDIR="${PROJECT_DIR}/src/fixtures"
DRY_RUN=""

# ── Parse args ────────────────────────────────────────────────────────────────
LIST_ONLY=""
MANUFACTURER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)     LIST_ONLY=1; shift ;;
    --outdir)   OUTDIR="$2"; shift 2 ;;
    --dry-run)  DRY_RUN="--dry-run"; shift ;;
    -*)         echo "Unknown option: $1" >&2; exit 1 ;;
    *)          MANUFACTURER="$1"; shift ;;
  esac
done

# ── Fetch the fixtures page ──────────────────────────────────────────────────
echo "Fetching Lightkey fixture library..."
PAGE_HTML=$(curl -sL "$FIXTURES_URL")

if [[ -n "$LIST_ONLY" ]]; then
  echo ""
  echo "Available manufacturers:"
  echo "$PAGE_HTML" | grep -oE 'data-manufacturer="[^"]+"' | sed 's/data-manufacturer="//;s/"$//' | sort -u
  exit 0
fi

if [[ -z "$MANUFACTURER" ]]; then
  echo "Usage: $0 <manufacturer> [--outdir path] [--dry-run]" >&2
  echo "       $0 --list" >&2
  exit 1
fi

# ── Extract download URLs for the manufacturer ──────────────────────────────
# URL-encode manufacturer name for matching  
MANUFACTURER_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MANUFACTURER'))")

echo "Looking for fixtures by: $MANUFACTURER"

# Extract all .lightkeyfxt URLs that contain the manufacturer name
URLS=$(echo "$PAGE_HTML" \
  | grep -oE "href=\"[^\"]*${MANUFACTURER_ENCODED}[^\"]*\.lightkeyfxt" \
  | sed 's/^href="//' \
  || true)

if [[ -z "$URLS" ]]; then
  echo "No fixtures found for '$MANUFACTURER'" >&2
  echo "Use --list to see available manufacturers." >&2
  exit 1
fi

URL_COUNT=$(echo "$URLS" | wc -l | tr -d ' ')
echo "Found $URL_COUNT fixture(s)"

# ── Download to temp directory ───────────────────────────────────────────────
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Downloading to $TMPDIR ..."
echo "$URLS" | while IFS= read -r url; do
  filename=$(python3 -c "import urllib.parse; print(urllib.parse.unquote('${url##*/}'))")
  echo "  ↓ $filename"
  curl -sL -o "$TMPDIR/$filename" "$url"
done

# ── Convert ──────────────────────────────────────────────────────────────────
echo ""
echo "Converting to OrbitDMX rig JSON..."
python3 "$SCRIPT_DIR/convert-lightkey.py" "$TMPDIR" --outdir "$OUTDIR" $DRY_RUN

echo ""
echo "Output directory: $OUTDIR"
