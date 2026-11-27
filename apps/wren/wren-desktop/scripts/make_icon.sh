#!/usr/bin/env bash
# Makes Wren for Mac's icon from the phone app's: the full-bleed mark on macOS's rounded plate
# (824 of 1024, radius 185, as Apple's grid draws it) as resources/icon.png, and resources/icon.icns
# from it with sips and iconutil. Run it when the phone app's icon changes.
#
#   ./scripts/make_icon.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SOURCE="../wren-app/assets/images/icon.png"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

magick -size 824x824 xc:none -fill white -draw 'roundrectangle 0,0 823,823 185,185' "$STAGE/mask.png"
magick "$SOURCE" -resize 824x824 "$STAGE/mask.png" -alpha off -compose CopyOpacity -composite "$STAGE/plate.png"
magick "$STAGE/plate.png" -background none -gravity center -extent 1024x1024 resources/icon.png

ICONSET="$STAGE/icon.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" resources/icon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" resources/icon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o resources/icon.icns
