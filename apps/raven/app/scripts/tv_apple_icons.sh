#!/usr/bin/env bash
# Draws the Apple TV app icon and Top Shelf images from the web's vector mark, the same mark and
# ground as the phone's icon and the Android TV banner. tvOS stacks an icon's layers for its
# parallax, so each icon is a back layer (the ground) and a front layer (the mark on nothing), at
# the sizes Apple asks: 400 by 240 and 800 by 480 for the home screen, 1280 by 768 for the store.
# The Top Shelf images are the banner's mark and wordmark across 1920 by 720 and 2320 by 720, at
# 1x and 2x. config-tv's `appleTVImages` reads them from `assets/images/tv_apple/`.
set -euo pipefail
cd "$(dirname "$0")/.."
MARK=../web/public/brand/raven-mark-on-dark.svg
FONT=assets/fonts/YoungSerif.ttf
GROUND='#15201e'
BARK='#e6e1d6'
OUT=assets/images/tv_apple
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
icon() {
  local name=$1 w=$2 h=$3
  local mark_h=$((h * 70 / 100))
  magick -size "${w}x${h}" "xc:${GROUND}" -depth 8 -strip "$OUT/${name}-back.png"
  magick -background none -density 1200 "$MARK" -resize "x${mark_h}" "$WORK/mark.png"
  magick -size "${w}x${h}" xc:none "$WORK/mark.png" -gravity center -composite \
    -depth 8 -strip "$OUT/${name}-front.png"
}
shelf() {
  local name=$1 w=$2 h=$3
  local mark_h=$((h * 52 / 100)) point=$((h * 22 / 100)) gap=$((h * 8 / 100))
  # The mark and the wordmark are drawn apart, as the banner's are, then set side by side and centred.
  magick -background none -density 1200 "$MARK" -resize "x${mark_h}" "$WORK/mark.png"
  magick -background none -fill "$BARK" -font "$FONT" -pointsize "$point" label:Raven "$WORK/word.png"
  magick "$WORK/mark.png" \( -size "${gap}x1" xc:none \) "$WORK/word.png" -background none \
    -gravity center +append "$WORK/lockup.png"
  magick -size "${w}x${h}" "xc:${GROUND}" "$WORK/lockup.png" -gravity center -composite \
    -depth 8 -strip "$OUT/${name}.png"
}
icon icon-small 400 240
icon icon-small-2x 800 480
icon icon-large 1280 768
shelf top-shelf 1920 720
shelf top-shelf-2x 3840 1440
shelf top-shelf-wide 2320 720
shelf top-shelf-wide-2x 4640 1440
