#!/usr/bin/env bash
# Rebuild the macOS .icns from the full-bleed master.
#
# macOS 26 (Tahoe) composites every app icon onto its own squircle plate and
# masks it. Art that already contains a rounded tile with transparent margin
# gets the treatment twice: the system plate shows through the margin as a pale
# frame and our own corners are clipped inside it. The master below is therefore
# FULL-BLEED — opaque edge to edge, no rounded corners — and the single mask the
# system applies is the only one.
#
# Windows (icon.ico) and Linux (icon.png) keep the pre-rounded tile: neither
# platform masks, so there the tile is the shape.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-$HERE/../buildResources/icon-macos.png}"
OUT="${2:-$HERE/../buildResources/icon.icns}"

[ -f "$SRC" ] || { echo "missing master: $SRC" >&2; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
SET="$WORK/icon.iconset"; mkdir -p "$SET"

for s in 16 32 128 256 512; do
    sips -z "$s" "$s" "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
    sips -z "$((s * 2))" "$((s * 2))" "$SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done

iconutil -c icns "$SET" -o "$OUT"
echo "✅ $OUT"
